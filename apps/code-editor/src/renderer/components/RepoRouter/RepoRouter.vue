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
    <div v-if="ctrl.state.menuOpen" class="panel">
      <div class="panel-head">
        <span>仓库</span>
        <span class="muted count">{{ ctrl.data.repos.length }}</span>
        <span class="spacer" />
        <button type="button" class="tool" @click="ctrl.expandAll()">展开</button>
        <button type="button" class="tool" @click="ctrl.collapseAll()">收起</button>
      </div>
      <div v-if="!ctrl.data.workspaceRoot" class="hint">先选择工作区</div>
      <div v-else-if="!ctrl.data.repos.length" class="hint">工作区内未发现仓库</div>
      <ul v-else class="list">
        <RepoDropTreeNode
          v-for="node in ctrl.data.tree"
          :key="node.kind === 'dir' ? node.path : node.abs"
          :node="node"
          :ctrl="ctrl"
          :depth="0"
        />
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
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

function onDocPointer(ev: PointerEvent): void {
  if (!props.ctrl.state.menuOpen) return;
  const el = rootEl.value;
  if (el && ev.target instanceof Node && el.contains(ev.target)) return;
  props.ctrl.closeMenu();
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointer, true);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer, true);
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

.panel {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 40;
  width: 280px;
  max-height: min(420px, 70vh);
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}

.panel-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  flex-shrink: 0;
}

.count {
  font-size: 11px;
}

.spacer {
  flex: 1;
}

.tool {
  border: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 11px;
  cursor: pointer;
  text-transform: none;
  letter-spacing: 0;
}

.tool:hover {
  color: var(--cyan);
  border-color: var(--cyan);
}

.hint {
  padding: 12px;
  color: var(--muted);
  font-size: 12px;
}

.list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  overflow: auto;
  flex: 1;
  min-height: 0;
}

.muted {
  color: var(--muted);
}
</style>
