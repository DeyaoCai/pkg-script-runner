<template>
  <aside class="differ-tree">
    <div class="head">
      <strong>Differ</strong>
      <span class="muted">{{ ctrl.data.changes.length }} 个变更</span>
      <button
        type="button"
        class="btn"
        :disabled="!ctrl.data.tree.length"
        @click="ctrl.expandAll()"
      >
        展开全部
      </button>
      <button
        type="button"
        class="btn"
        :disabled="!ctrl.data.tree.length"
        @click="ctrl.collapseAll()"
      >
        收起全部
      </button>
      <button type="button" class="btn refresh" @click="ctrl.refresh()">刷新</button>
    </div>
    <ul class="list">
      <li v-if="!ctrl.data.changes.length" class="hint muted">无变更（或非 Git 仓库）</li>
      <GitChangeTreeNode
        v-for="node in ctrl.data.tree"
        :key="node.kind === 'dir' ? node.path : node.change.path"
        :node="node"
        :ctrl="ctrl"
        :selected-path="ctrl.data.selectedPath"
        :depth="0"
      />
    </ul>
  </aside>
</template>

<script setup lang="ts">
import GitChangeTreeNode from './GitChangeTreeNode.vue';
import type { DifferTreeCtrl } from './DifferTreeCtrl.ts';

defineProps<{ ctrl: DifferTreeCtrl }>();
</script>

<style scoped>
.differ-tree {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--side);
  flex: 1;
}

.head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-height: var(--tab-h);
  padding: 4px 8px;
  border-bottom: 1px solid var(--line);
  font-size: 12px;
  flex-shrink: 0;
}

.head strong {
  color: var(--cyan);
  font-weight: 600;
}

.btn {
  border: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
  font-size: 11px;
}

.btn.refresh {
  margin-left: auto;
}

.btn:hover:not(:disabled) {
  color: var(--cyan);
  border-color: var(--cyan);
}

.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  overflow: auto;
  flex: 1;
  min-height: 0;
}

.hint {
  padding: 10px;
  font-size: 12px;
}

.muted {
  color: var(--muted);
}
</style>
