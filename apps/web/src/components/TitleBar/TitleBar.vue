<template>
  <TitleBarShell :ctrl="ctrl">
    <template #leading>
      <div ref="navEl" class="titlebar-leading-items">
        <TitleBarChip
          label="工作区"
          :value="workspaceLabel"
          :disabled="ctrl.state.busy"
          :title="
            app.data.workspaceRoot
              ? `${app.data.workspaceRoot}\n点击重新选择工作区`
              : '选择工作区目录（与 Code Editor 共用）'
          "
          @click="ctrl.onPickWorkspace()"
        />

        <div class="repo-dd">
          <TitleBarChip
            ref="repoChip"
            label="项目"
            :value="activeRepoLabel"
            :caret="ctrl.state.repoMenuOpen ? '▴' : '▾'"
            :disabled="!app.data.workspaceRoot || ctrl.state.busy"
            :title="activeRepoTitle"
            @click="ctrl.toggleRepoMenu()"
          />
        </div>
      </div>
    </template>

    <TitleBarMeta
      v-if="app.data.meta || app.data.metaError"
      :text="app.data.meta"
      :error="app.data.metaError"
    />

    <template #actions>
      <TitleBarAction
        title="端口管理：扫描监听 / 清理漂移"
        aria-label="端口管理"
        @click="ctrl.openPorts()"
      >
        端口
      </TitleBarAction>
    </template>
  </TitleBarShell>

  <ShellPanel
    :open="ctrl.state.repoMenuOpen"
    :anchor="repoAnchor"
    :ignore="[navEl]"
    @close="ctrl.closeRepoMenu()"
  >
    <template #head>
      <span>仓库</span>
      <span class="ui-panel-muted">{{ app.data.projects.length }}</span>
      <input
        type="search"
        class="ui-panel-search"
        spellcheck="false"
        placeholder="筛选…"
        :value="app.data.projectSearch"
        @input="app.setProjectSearch(($event.target as HTMLInputElement).value)"
      />
    </template>

    <div v-if="!app.data.projects.length" class="ui-panel-hint">工作区内未发现仓库</div>
    <div v-else-if="!app.filteredProjects.length" class="ui-panel-hint">没有匹配的仓库</div>
    <ul v-else class="ui-panel-list">
      <li v-for="p in app.filteredProjects" :key="p.dir">
        <button
          type="button"
          class="ui-panel-item"
          :class="{ 'is-active': ctrl.isActive(p.dir) }"
          :title="p.dir"
          @click="ctrl.onSelectRepo(p.dir)"
        >
          <span class="ui-panel-item-title">{{ p.name }}</span>
          <span class="ui-panel-item-meta">
            <span v-if="p.scriptCount">{{ p.scriptCount }} scripts</span>
            <span>{{ p.rel || '.' }}</span>
          </span>
        </button>
      </li>
    </ul>
  </ShellPanel>
</template>

<script lang="ts" setup>
import { computed, inject, onMounted, ref, watch } from 'vue';
import TitleBarShell from '@pkg-runner/shell/renderer/TitleBarShell.vue';
import TitleBarChip from '@pkg-runner/shell/renderer/TitleBarChip.vue';
import TitleBarMeta from '@pkg-runner/shell/renderer/TitleBarMeta.vue';
import TitleBarAction from '@pkg-runner/shell/renderer/TitleBarAction.vue';
import ShellPanel from '@pkg-runner/shell/renderer/ShellPanel.vue';
import { APP_CTRL_KEY } from '../../appContext';

const app = inject(APP_CTRL_KEY)!;
const ctrl = app.controllers.titleBar;
const navEl = ref<HTMLElement | null>(null);
const repoChip = ref<InstanceType<typeof TitleBarChip> | null>(null);

ctrl.syncFromApp();

const repoAnchor = computed(
  () => (repoChip.value?.$el as HTMLElement | undefined) ?? null,
);

const workspaceLabel = computed(() => {
  const root = app.data.workspaceRoot;
  if (!root) return '选择工作区';
  return root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || root;
});

const activeRepoLabel = computed(() => {
  const dir = app.data.activeProject;
  if (!dir) return '选择项目';
  const hit = app.data.projects.find((p) => p.dir === dir);
  return hit?.name || dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || dir;
});

const activeRepoTitle = computed(() => {
  const dir = app.data.activeProject;
  if (!dir) return '选择仓库项目';
  const p = app.data.project;
  if (p && p.dir === dir) {
    return `${p.name} · ${p.packageManager} · ${p.scripts.length} scripts\n${p.dir}`;
  }
  return dir;
});

watch(
  () => [app.data.colorEnv, app.data.maximized] as const,
  () => ctrl.syncFromApp(),
);

onMounted(() => ctrl.syncFromApp());
</script>

<style lang="less" scoped>
.repo-dd {
  position: relative;
  min-width: 0;
}
</style>
