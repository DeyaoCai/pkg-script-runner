<template>
  <li class="node">
    <template v-if="node.kind === 'dir'">
      <button
        type="button"
        class="row dir"
        :style="{ paddingLeft: `${8 + depth * 12}px` }"
        v-tip="node.path || '根'"
        @click="ctrl.toggleDir(node.path)"
      >
        <span class="twisty">{{ expanded ? '▾' : '▸' }}</span>
        <span class="name">{{ node.name }}</span>
        <span class="count muted">{{ node.repoCount }}</span>
      </button>
      <ul v-if="expanded" class="kids">
        <RepoDropTreeNode
          v-for="child in node.children"
          :key="child.kind === 'dir' ? child.path : child.abs"
          :node="child"
          :ctrl="ctrl"
          :depth="depth + 1"
        />
      </ul>
    </template>
    <button
      v-else
      type="button"
      class="row repo"
      :class="{ active: node.active, workspace: !node.rel }"
      :style="{ paddingLeft: `${8 + depth * 12}px` }"
      v-tip="node.abs"
      @click="ctrl.select(node.abs)"
    >
      <span class="twisty">·</span>
      <span class="name">{{ node.name }}</span>
      <span v-if="!node.rel" class="tag muted">根</span>
    </button>
  </li>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import RepoDropTreeNode from './RepoDropTreeNode.vue';
import type { RepoRouterCtrl, TRepoTreeNode } from './RepoRouterCtrl.ts';

const props = defineProps<{
  node: TRepoTreeNode;
  ctrl: RepoRouterCtrl;
  depth: number;
}>();

const expanded = computed(() =>
  props.node.kind === 'dir' ? props.ctrl.isExpanded(props.node.path) : false,
);
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
  padding: 4px 8px 4px 0;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  min-width: 0;
}

.row:hover {
  background: var(--color-accent-soft);
}

.row.repo.active {
  background: var(--color-accent-soft-strong);
  box-shadow: inset 2px 0 0 var(--cyan);
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
  font-weight: 600;
}

.row.repo .name {
  color: var(--cyan);
}

.row.workspace .name {
  color: var(--text);
  font-weight: 700;
}

.tag {
  margin-left: auto;
  font-size: 10px;
  flex-shrink: 0;
  padding-right: 6px;
}

.count {
  margin-left: auto;
  font-size: 10px;
  padding-right: 6px;
  flex-shrink: 0;
}

.muted {
  color: var(--muted);
}
</style>
