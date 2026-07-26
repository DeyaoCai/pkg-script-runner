<template>
  <li class="node">
    <template v-if="node.kind === 'dir'">
      <button
        type="button"
        class="row"
        :class="{ repo: node.isRepo, selected: isSelected }"
        :data-path="node.relPath"
        :style="{ paddingLeft: `${8 + depth * 12}px` }"
        v-tip="node.isRepo ? `嵌套仓库 · 切换到 ${node.relPath}` : node.relPath"
        @click="emit('toggle', node)"
        @contextmenu.prevent="emit('menu', $event, node.relPath, 'dir')"
      >
        <span class="twisty">{{
          node.isRepo ? '⌥' : isOpen ? '▾' : '▸'
        }}</span>
        <span class="name">{{ node.name }}</span>
      </button>
      <ul v-if="!node.isRepo && isOpen && node.children?.length" class="kids">
        <FileTreeNode
          v-for="c in node.children"
          :key="c.relPath"
          :node="c"
          :expanded="expanded"
          :selected-path="selectedPath"
          :depth="depth + 1"
          @toggle="emit('toggle', $event)"
          @open="emit('open', $event)"
          @menu="(e, p, k) => emit('menu', e, p, k)"
        />
      </ul>
    </template>
    <button
      v-else
      type="button"
      class="row file"
      :class="{ selected: isSelected }"
      :data-path="node.relPath"
      :style="{ paddingLeft: `${8 + depth * 12}px` }"
      v-tip="node.relPath"
      @click="emit('open', node.relPath)"
      @contextmenu.prevent="emit('menu', $event, node.relPath, 'file')"
    >
      <span class="twisty"> </span>
      <span class="name">{{ node.name }}</span>
    </button>
  </li>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import FileTreeNode from './FileTreeNode.vue';

type TNode = {
  name: string;
  relPath: string;
  kind: 'file' | 'dir';
  isRepo?: boolean;
  children?: TNode[];
};

const props = defineProps<{
  node: TNode;
  expanded: Record<string, boolean>;
  selectedPath: string | null;
  depth: number;
}>();

const emit = defineEmits<{
  toggle: [node: TNode];
  open: [relPath: string];
  menu: [ev: MouseEvent, relPath: string, kind: 'file' | 'dir'];
}>();

const isOpen = computed(() => !!props.expanded[props.node.relPath]);

const isSelected = computed(() => {
  if (!props.selectedPath) return false;
  return (
    props.selectedPath.replace(/\\/g, '/') ===
    props.node.relPath.replace(/\\/g, '/')
  );
});
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
  padding: 3px 8px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
}

.row:hover {
  background: var(--color-accent-soft);
}

.row.selected {
  background: var(--color-accent-soft);
  outline: 1px solid var(--line);
}

.row.selected .name {
  color: var(--cyan);
}

.row.repo .name {
  color: var(--cyan);
}

.twisty {
  width: 12px;
  color: var(--muted);
  flex-shrink: 0;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.row.file .name {
  color: var(--muted);
}

.muted {
  color: var(--muted);
}
</style>
