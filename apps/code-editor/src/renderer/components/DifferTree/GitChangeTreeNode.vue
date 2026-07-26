<template>
  <li class="node">
    <template v-if="node.kind === 'dir'">
      <button
        type="button"
        class="row dir"
        :style="{ paddingLeft: `${8 + depth * 12}px` }"
        @click="ctrl.toggleDir(node.path)"
      >
        <span class="twisty">{{ expanded ? '▾' : '▸' }}</span>
        <span class="name">{{ node.name }}</span>
        <span class="count muted">{{ node.fileCount }}</span>
      </button>
      <ul v-if="expanded" class="kids">
        <GitChangeTreeNode
          v-for="child in node.children"
          :key="child.kind === 'dir' ? child.path : child.change.path"
          :node="child"
          :ctrl="ctrl"
          :selected-path="selectedPath"
          :depth="depth + 1"
        />
      </ul>
    </template>
    <template v-else>
      <div
        class="file-row"
        :class="{ active: node.change.path === selectedPath }"
        :style="{ paddingLeft: `${8 + depth * 12}px` }"
      >
        <button type="button" class="row file" @click="onSelectFile">
          <span class="twisty"> </span>
          <span class="badge">{{ statusLabel(node.change) }}</span>
          <span class="name" v-tip="node.change.path">{{ node.name }}</span>
        </button>
        <button
          type="button"
          class="open"
          v-tip="'打开源文件'"
          @click="ctrl.openFile(node.change.path)"
        >
          →
        </button>
      </div>
    </template>
  </li>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import GitChangeTreeNode from './GitChangeTreeNode.vue';
import {
  statusLabel,
  type DifferTreeCtrl,
  type TChangeTreeNode,
} from './DifferTreeCtrl.ts';

const props = defineProps<{
  node: TChangeTreeNode;
  ctrl: DifferTreeCtrl;
  selectedPath: string | null;
  depth: number;
}>();

const expanded = computed(() =>
  props.node.kind === 'dir' ? props.ctrl.isExpanded(props.node.path) : false,
);

function onSelectFile(): void {
  if (props.node.kind !== 'file') return;
  void props.ctrl.selectChange(props.node.change);
}
</script>

<style scoped>
.node {
  list-style: none;
}

.kids {
  list-style: none;
  margin: 0;
  padding: 0;
}

.row {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  border: none;
  background: transparent;
  color: var(--text);
  text-align: left;
  padding: 3px 8px 3px 0;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  min-width: 0;
}

.row:hover {
  background: var(--color-accent-soft);
}

.file-row {
  display: flex;
  align-items: center;
}

.file-row.active {
  background: var(--color-accent-soft-strong);
}

.twisty {
  width: 12px;
  flex-shrink: 0;
  color: var(--muted);
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.row.dir .name {
  color: var(--text);
  font-weight: 600;
}

.row.file .name {
  color: var(--muted);
}

.count {
  margin-left: auto;
  font-size: 10px;
  padding-right: 6px;
}

.badge {
  flex-shrink: 0;
  width: 18px;
  text-align: center;
  color: var(--warn);
  font-size: 11px;
}

.open {
  border: none;
  background: transparent;
  color: var(--cyan);
  cursor: pointer;
  padding: 2px 8px;
  flex-shrink: 0;
}

.muted {
  color: var(--muted);
}
</style>
