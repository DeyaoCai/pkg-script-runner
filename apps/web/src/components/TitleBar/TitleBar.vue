<template>
  <header class="titlebar" aria-label="窗口标题栏">
    <div class="titlebar-brand titlebar-drag">
      <img class="mark" :src="logoUrl" width="28" height="28" alt="" draggable="false" />
      <div class="brand-text">
        <strong>Pkg Runner</strong>
        <span class="sub">
          <template v-if="app.data.colorEnv === 'test'">测试 · scripts · tray</template>
          <template v-else>scripts · tray</template>
        </span>
      </div>
      <span v-if="app.data.colorEnv === 'test'" class="env-badge" title="测试色板">测试</span>
    </div>

    <div class="titlebar-nav" ref="navEl">
      <button
        type="button"
        class="tb-chip ws-chip"
        :disabled="ctrl.state.busy"
        :title="
          app.data.workspaceRoot
            ? `${app.data.workspaceRoot}\n点击重新选择工作区`
            : '选择工作区目录（与 Code Editor 共用）'
        "
        @click="ctrl.onPickWorkspace()"
      >
        <span class="chip-label">工作区</span>
        <span class="chip-value">{{ workspaceLabel }}</span>
      </button>

      <div class="repo-dd">
        <button
          ref="repoBtnEl"
          type="button"
          class="tb-chip repo-chip"
          :disabled="!app.data.workspaceRoot || ctrl.state.busy"
          :title="activeRepoTitle"
          @click="ctrl.toggleRepoMenu()"
        >
          <span class="chip-label">项目</span>
          <span class="chip-value">{{ activeRepoLabel }}</span>
          <span class="chip-caret">{{ ctrl.state.repoMenuOpen ? '▴' : '▾' }}</span>
        </button>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="ctrl.state.repoMenuOpen"
        ref="repoPanelEl"
        class="repo-panel glass-surface"
        :style="repoPanelStyle"
      >
        <div class="repo-panel-head">
          <span>仓库</span>
          <span class="muted">{{ app.data.projects.length }}</span>
          <input
            type="search"
            class="repo-search"
            spellcheck="false"
            placeholder="筛选…"
            :value="app.data.projectSearch"
            @input="app.setProjectSearch(($event.target as HTMLInputElement).value)"
          />
        </div>
        <div v-if="!app.data.projects.length" class="repo-hint">工作区内未发现仓库</div>
        <div v-else-if="!app.filteredProjects.length" class="repo-hint">没有匹配的仓库</div>
        <ul v-else class="repo-list">
          <li v-for="p in app.filteredProjects" :key="p.dir">
            <button
              type="button"
              class="repo-item"
              :class="{ active: ctrl.isActive(p.dir) }"
              :title="p.dir"
              @click="ctrl.onSelectRepo(p.dir)"
            >
              <span class="repo-name">{{ p.name }}</span>
              <span class="repo-meta">
                <span v-if="p.scriptCount" class="repo-scripts">{{ p.scriptCount }} scripts</span>
                <span class="repo-rel">{{ p.rel || '.' }}</span>
              </span>
            </button>
          </li>
        </ul>
      </div>
    </Teleport>

    <div class="titlebar-mid titlebar-drag">
      <div class="meta" :class="{ error: app.data.metaError }">{{ app.data.meta }}</div>
    </div>
    <div class="titlebar-actions">
      <button
        type="button"
        class="btn titlebar-tool"
        title="端口管理：扫描监听 / 清理漂移"
        aria-label="端口管理"
        @click="ctrl.openPorts()"
      >
        端口
      </button>
      <button type="button" class="win-btn" title="最小化" aria-label="最小化" @click="ctrl.minimize()">
        <span class="ico ico-min"></span>
      </button>
      <button type="button" class="win-btn" title="最大化" aria-label="最大化" @click="ctrl.maximize()">
        <span :class="ctrl.maxIconClass"></span>
      </button>
      <button
        type="button"
        class="win-btn close"
        title="关闭到托盘"
        aria-label="关闭"
        @click="ctrl.closeWin()"
      >
        <span class="ico ico-close"></span>
      </button>
    </div>
  </header>
</template>

<script lang="ts" setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { APP_CTRL_KEY } from '../../appContext';
import logoUrl from '@pkg-runner/assets/media/logo.png';

const app = inject(APP_CTRL_KEY)!;
const ctrl = app.controllers.titleBar;
const navEl = ref<HTMLElement | null>(null);
const repoBtnEl = ref<HTMLElement | null>(null);
const repoPanelEl = ref<HTMLElement | null>(null);
const repoPanelStyle = ref<Record<string, string>>({});

const workspaceLabel = computed(() => {
  const root = app.data.workspaceRoot;
  if (!root) return '选择工作区';
  return root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || root;
});

const activeRepoLabel = computed(() => {
  const active = app.data.projects.find((p) => ctrl.isActive(p.dir));
  if (active) return active.name;
  if (app.data.activeProject) {
    return app.data.activeProject.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '项目';
  }
  return app.data.workspaceRoot ? '选择项目' : '—';
});

const activeRepoTitle = computed(() => app.data.activeProject || '选择仓库/项目');

function placeRepoPanel(): void {
  const btn = repoBtnEl.value;
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const width = Math.min(360, window.innerWidth * 0.7);
  let left = r.left;
  if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
  repoPanelStyle.value = {
    position: 'fixed',
    top: `${Math.round(r.bottom + 6)}px`,
    left: `${Math.round(left)}px`,
    width: `${Math.round(width)}px`,
    zIndex: '300',
  };
}

function onDocPointer(ev: PointerEvent): void {
  if (!ctrl.state.repoMenuOpen) return;
  const t = ev.target;
  if (!(t instanceof Node)) return;
  if (navEl.value?.contains(t)) return;
  if (repoPanelEl.value?.contains(t)) return;
  ctrl.closeRepoMenu();
}

watch(
  () => ctrl.state.repoMenuOpen,
  async (open) => {
    if (!open) return;
    await nextTick();
    placeRepoPanel();
  },
);

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointer, true);
  window.addEventListener('resize', placeRepoPanel);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer, true);
  window.removeEventListener('resize', placeRepoPanel);
});
</script>

<style lang="less" scoped>
.titlebar-nav {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-2);
  flex-shrink: 1;
  min-width: 0;
  /* no-drag 见全局 06-titlebar-controls.css（Electron hit-test 不认 scoped） */
}

.tb-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: min(280px, 30vw);
  min-width: 0;
  height: var(--chip-height);
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--row);
  color: var(--text);
  font: inherit;
  font-size: var(--fs-12);
  line-height: var(--lh-tight);
  cursor: pointer;
}

.tb-chip:disabled {
  opacity: 0.45;
  cursor: default;
}

.tb-chip:not(:disabled):hover {
  border-color: var(--accent);
}

.chip-label {
  flex-shrink: 0;
  color: var(--muted);
  font-size: var(--fs-12);
  font-weight: 600;
}

.chip-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-13);
  font-weight: 650;
}

.chip-caret {
  flex-shrink: 0;
  color: var(--muted);
  font-size: var(--fs-12);
}

.repo-dd {
  position: relative;
  min-width: 0;
}

.repo-panel {
  max-height: min(420px, 60vh);
  display: flex;
  flex-direction: column;
  border-radius: var(--app-radius);
  overflow: hidden;
  box-shadow: 0 12px 32px color-mix(in srgb, var(--color-shadow) 55%, transparent);
}

.repo-panel-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border);
  font-size: var(--fs-13);
  font-weight: 650;
  flex-shrink: 0;
}

.repo-panel-head .muted {
  color: var(--muted);
  font-weight: 500;
  font-size: var(--fs-12);
}

.repo-search {
  margin-left: auto;
  width: 140px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--row);
  color: var(--text);
  font: inherit;
  font-size: var(--fs-12);
  padding: 5px 8px;
}

.repo-hint {
  padding: var(--space-4) var(--space-3);
  color: var(--muted);
  font-size: var(--fs-12);
}

.repo-list {
  list-style: none;
  margin: 0;
  padding: var(--space-2);
  overflow: auto;
  min-height: 0;
}

.repo-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  text-align: left;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  padding: 10px var(--space-3);
  cursor: pointer;
  font: inherit;
}

.repo-item:hover {
  background: var(--row-hover);
}

.repo-item.active {
  background: var(--active);
  color: var(--color-fg-on-accent, var(--text));
}

.repo-name {
  font-size: var(--fs-13);
  font-weight: 650;
}

.repo-meta {
  display: flex;
  gap: var(--space-2);
  font-size: var(--fs-12);
  opacity: 0.85;
}

.repo-rel {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
</style>
