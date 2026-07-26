<template>
  <aside class="tree" :class="variant" ref="rootEl">
    <div class="head">
      <div class="head-left">
        <button
          v-if="variant === 'code'"
          type="button"
          class="icon up"
          v-tip="'返回上级仓库'"
          :disabled="!ctrl.data.canGoParentRepo"
          @click="ctrl.goParentRepo()"
        >
          ‹
        </button>
        <span class="repo-name" v-tip="ctrl.data.repoName || titleFallback">{{
          ctrl.data.repoName || titleFallback
        }}</span>
      </div>
      <div class="head-actions">
        <button
          type="button"
          class="icon"
          v-tip="locateTip"
          :disabled="!ctrl.data.repoName"
          @click="ctrl.locateActive()"
        >
          ⊙
        </button>
        <button
          type="button"
          class="icon reveal"
          v-tip="revealTip"
          :disabled="!ctrl.data.repoName"
          @click="ctrl.showInExplorer()"
        >
          <svg
            class="glyph"
            viewBox="0 0 16 16"
            width="12"
            height="12"
            aria-hidden="true"
          >
            <path
              fill="currentColor"
              d="M6.5 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9.5h-1.5V13h-9V3.5H6.5V2zm3-1H15v5.5h-1.5V3.56L7.78 9.28l-1.06-1.06 5.72-5.72H9.5V1z"
            />
          </svg>
        </button>
        <button
          type="button"
          class="icon"
          v-tip="'刷新'"
          :disabled="!ctrl.data.repoName"
          @click="ctrl.reload()"
        >
          ↻
        </button>
      </div>
    </div>
    <div v-if="!ctrl.data.repoName" class="hint">{{ emptyHint }}</div>
    <div v-else-if="ctrl.state.loading" class="hint">加载中…</div>
    <div v-else-if="ctrl.state.error" class="err">{{ ctrl.state.error }}</div>
    <div v-else-if="!ctrl.data.roots.length" class="hint">{{ emptyRootHint }}</div>
    <ul v-else class="list">
      <FileTreeNode
        v-for="n in ctrl.data.roots"
        :key="n.relPath"
        :node="n"
        :expanded="ctrl.state.expanded"
        :selected-path="ctrl.state.selectedPath"
        :depth="0"
        @toggle="ctrl.toggleDir($event)"
        @open="ctrl.openFile($event)"
        @menu="onMenu"
      />
    </ul>
    <div
      v-if="menu"
      ref="menuEl"
      class="ctx"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
    >
      <button
        v-if="menu.kind === 'file'"
        type="button"
        class="ctx-item"
        @click="onOpenFile()"
      >
        {{ variant === 'docs' ? '预览' : '打开' }}
      </button>
      <button type="button" class="ctx-item" @click="onReveal()">
        在文件浏览器中打开
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import FileTreeNode from './FileTreeNode.vue';
import type { FileTreeCtrl } from './FileTreeCtrl.ts';

const props = defineProps<{
  ctrl: FileTreeCtrl;
  variant: 'code' | 'docs';
}>();

const rootEl = ref<HTMLElement | null>(null);
const menuEl = ref<HTMLElement | null>(null);
const menu = ref<{
  x: number;
  y: number;
  relPath: string;
  kind: 'file' | 'dir';
} | null>(null);

const titleFallback = computed(() =>
  props.variant === 'docs' ? 'MD 目录' : '目录',
);
const locateTip = computed(() =>
  props.variant === 'docs' ? '定位当前文档' : '在目录中定位当前文件',
);
const revealTip = computed(() =>
  props.variant === 'docs'
    ? '在文件浏览器中打开设计仓库根目录'
    : '在文件浏览器中打开仓库根目录',
);
const emptyHint = computed(() =>
  props.variant === 'docs'
    ? '从上方选择设计仓库'
    : '从工作区栏选择仓库，或点左侧「目录」',
);
const emptyRootHint = computed(() =>
  props.variant === 'docs' ? '无文档（.md / .txt）' : '空仓库',
);

watch(
  () => props.ctrl.state.locateSeq,
  async () => {
    const path = props.ctrl.state.selectedPath;
    if (!path) return;
    await nextTick();
    const root = rootEl.value;
    if (!root) return;
    const want = path.replace(/\\/g, '/');
    const rows = root.querySelectorAll<HTMLElement>('[data-path]');
    for (const el of rows) {
      const p = (el.dataset.path || '').replace(/\\/g, '/');
      if (p === want) {
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        break;
      }
    }
  },
);

function onMenu(ev: MouseEvent, relPath: string, kind: 'file' | 'dir') {
  menu.value = { x: ev.clientX, y: ev.clientY, relPath, kind };
}

function closeMenu() {
  menu.value = null;
}

function onOpenFile() {
  const path = menu.value?.relPath;
  closeMenu();
  if (path) void props.ctrl.openFile(path);
}

function onReveal() {
  const path = menu.value?.relPath;
  closeMenu();
  if (path) void props.ctrl.showInExplorer(path);
}

function onDocPointer(ev: PointerEvent) {
  if (!menu.value) return;
  const el = menuEl.value;
  if (el && ev.target instanceof Node && el.contains(ev.target)) return;
  menu.value = null;
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointer, true);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer, true);
});
</script>

<style scoped>
.tree {
  width: 100%;
  height: 100%;
  min-width: 0;
  background: var(--side);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tree.code {
  border-right: 1px solid var(--line);
}

.tree.docs {
  border-left: 1px solid var(--line);
}

.head {
  display: flex;
  align-items: center;
  gap: 2px;
  box-sizing: border-box;
  height: var(--tab-h);
  padding: 0 4px;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  flex-shrink: 0;
  min-width: 0;
}

.head-left,
.head-actions {
  display: flex;
  align-items: center;
  height: 100%;
  min-width: 0;
}

.head-left {
  flex: 1;
  gap: 2px;
  overflow: hidden;
}

.head-actions {
  flex-shrink: 0;
  gap: 0;
}

.repo-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: var(--tab-h);
  height: var(--tab-h);
  padding: 0 2px 0 0;
}

.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 24px;
  height: 24px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 13px;
  line-height: 0;
  flex-shrink: 0;
}

.icon.up {
  width: 20px;
  font-size: 18px;
  font-weight: 700;
  transform: translateY(-0.5px);
}

.icon .glyph {
  display: block;
  flex-shrink: 0;
}

.icon:hover:not(:disabled) {
  color: var(--cyan);
  background: var(--color-accent-soft);
}

.icon:disabled {
  opacity: 0.28;
  cursor: default;
}

.hint,
.err {
  padding: 12px 10px;
  color: var(--muted);
  font-size: 12px;
}

.err {
  color: var(--bad);
}

.list {
  list-style: none;
  margin: 0;
  padding: 6px 0;
  overflow: auto;
  flex: 1;
}

.ctx {
  position: fixed;
  z-index: 50;
  min-width: 160px;
  padding: 4px 0;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}

.ctx-item {
  display: block;
  width: 100%;
  border: none;
  background: transparent;
  color: var(--text);
  text-align: left;
  padding: 6px 12px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}

.ctx-item:hover {
  background: var(--color-accent-soft);
  color: var(--cyan);
}
</style>
