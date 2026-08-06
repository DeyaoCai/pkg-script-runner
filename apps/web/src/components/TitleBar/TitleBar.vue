<template>
  <TitleBarShell :ctrl="ctrl">
    <template #leading>
      <div class="titlebar-leading-items">
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

        <label
          class="tb-search-chip"
          title="作用于脚本 / 运行中 / 收藏；模糊或正则，如 /dev:|dist:/"
        >
          <input
            id="scriptSearchInput"
            class="tb-search-input"
            type="search"
            spellcheck="false"
            placeholder="项目或脚本 · /正则/"
            aria-label="筛选脚本、运行中与收藏；可用 /pattern/flags 正则"
            :disabled="!app.data.workspaceRoot"
            :value="app.data.scriptSearch"
            @input="app.setScriptSearch(($event.target as HTMLInputElement).value)"
          />
        </label>
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
</template>

<script lang="ts" setup>
import { computed, inject, onMounted, watch } from 'vue';
import TitleBarShell from '@pkg-runner/shell/renderer/TitleBarShell.vue';
import TitleBarChip from '@pkg-runner/shell/renderer/TitleBarChip.vue';
import TitleBarMeta from '@pkg-runner/shell/renderer/TitleBarMeta.vue';
import TitleBarAction from '@pkg-runner/shell/renderer/TitleBarAction.vue';
import { APP_CTRL_KEY } from '../../appContext';

const app = inject(APP_CTRL_KEY)!;
const ctrl = app.controllers.titleBar;

ctrl.syncFromApp();

const workspaceLabel = computed(() => {
  const root = app.data.workspaceRoot;
  if (!root) return '选择工作区';
  return root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || root;
});

watch(
  () => [app.data.colorEnv, app.data.maximized] as const,
  () => ctrl.syncFromApp(),
);

onMounted(() => ctrl.syncFromApp());
</script>

<style lang="less" scoped>
.titlebar-leading-items {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.tb-search-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: var(--chip-height, 32px);
  min-height: var(--chip-height, 32px);
  padding: 0 10px;
  box-sizing: border-box;
  max-width: min(320px, 36vw);
  min-width: 140px;
  flex: 1 1 160px;
  border: 1px solid var(--border, var(--line));
  border-radius: 8px;
  background: var(--row, var(--panel));
  cursor: text;
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.tb-search-chip:focus-within {
  border-color: var(--accent);
}

.tb-search-input {
  flex: 1;
  min-width: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 0 !important;
  border-radius: 0;
  outline: none;
  box-shadow: none;
  background: transparent;
  color: var(--text, var(--fg));
  font: inherit;
  font-size: var(--fs-13, 13px);
  font-weight: 650;
  appearance: none;
  -webkit-appearance: none;
}

.tb-search-input:focus {
  border: 0 !important;
  outline: none;
  box-shadow: none;
}

.tb-search-input::placeholder {
  color: var(--muted);
  font-weight: 500;
  opacity: 0.85;
}

.tb-search-input:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
