<template>
  <div class="repo-dd" ref="rootEl">
    <button
      type="button"
      class="trigger"
      :disabled="!ctrl.data.workspaceRoot"
      v-tip="ctrl.data.activeAbs || '选择仓库'"
      @click="ctrl.toggleMenu()"
    >
      <span class="label">仓库</span>
      <span class="name">{{ activeLabel }}</span>
      <span class="caret">{{ ctrl.state.menuOpen ? '▴' : '▾' }}</span>
    </button>

    <ShellPanel
      :open="ctrl.state.menuOpen"
      :teleported="false"
      :width="280"
      :ignore="[rootEl]"
      @close="ctrl.closeMenu()"
    >
      <template #head>
        <span>仓库</span>
        <span class="ui-panel-muted">{{ ctrl.data.repos.length }}</span>
        <span class="ui-panel-spacer" />
        <button type="button" class="ui-panel-tool" @click="ctrl.expandAll()">展开</button>
        <button type="button" class="ui-panel-tool" @click="ctrl.collapseAll()">收起</button>
      </template>

      <div v-if="!ctrl.data.workspaceRoot" class="ui-panel-hint">先选择工作区</div>
      <div v-else-if="!ctrl.data.repos.length" class="ui-panel-hint">工作区内未发现仓库</div>
      <ul v-else class="ui-panel-list">
        <RepoDropTreeNode
          v-for="node in ctrl.data.tree"
          :key="node.kind === 'dir' ? node.path : node.abs"
          :node="node"
          :ctrl="ctrl"
          :depth="0"
        />
      </ul>
    </ShellPanel>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import ShellPanel from '@pkg-runner/shell/renderer/ShellPanel.vue';
import RepoDropTreeNode from './RepoDropTreeNode.vue';
import type { RepoRouterCtrl } from './RepoRouterCtrl.ts';

const props = defineProps<{ ctrl: RepoRouterCtrl }>();
const rootEl = ref<HTMLElement | null>(null);

const activeLabel = computed(() => {
  const active = props.ctrl.data.repos.find((r) => r.active);
  if (active) return active.name || '工作区';
  const pr = props.ctrl.data.activeAbs;
  if (pr) {
    return pr.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || pr;
  }
  return props.ctrl.data.workspaceRoot ? '未选择' : '—';
});
</script>

<style scoped>
.repo-dd {
  position: relative;
  flex-shrink: 0;
}

.trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  border: 1px solid var(--line);
  background: var(--color-accent-soft);
  color: var(--text);
  border-radius: 4px;
  padding: 4px 8px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
}

.trigger:disabled {
  opacity: 0.45;
  cursor: default;
}

.trigger:not(:disabled):hover {
  border-color: var(--cyan);
}

.label {
  color: var(--muted);
  flex-shrink: 0;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  color: var(--cyan);
  font-weight: 600;
}

.caret {
  color: var(--muted);
  flex-shrink: 0;
  font-size: 10px;
}
</style>
