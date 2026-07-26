<template>
  <div ref="splitEl" class="split" :class="`mode-${mode}`">
    <div
      v-show="mode !== 'preview'"
      class="pane editor"
      :style="editorPaneStyle"
    >
      <div class="pane-head">源码</div>
      <div ref="editorHost" class="cm-host" />
      <div v-if="!ctrl.data.relPath" class="empty muted">从右侧目录打开 Markdown</div>
    </div>

    <Splitter
      v-show="mode === 'split'"
      axis="x"
      @drag="sourceDrag.onDrag"
      @end="onSourceDragEnd"
    />

    <div
      v-show="mode !== 'source'"
      class="pane preview"
      :style="previewPaneStyle"
    >
      <div class="pane-head">预览</div>
      <div class="preview-body">
        <aside
          v-if="mode === 'preview'"
          class="outline"
          :style="{ width: `${outlineWidth}px` }"
        >
          <div class="outline-head">大纲</div>
          <nav v-if="ctrl.data.outline.length" class="outline-list">
            <button
              v-for="item in ctrl.data.outline"
              :key="item.id"
              type="button"
              class="outline-item"
              :class="{
                active: item.id === ctrl.data.activeOutlineId,
                [`lv-${item.level}`]: true,
              }"
              :title="item.text"
              @click="jumpTo(item.id)"
            >
              {{ item.text }}
            </button>
          </nav>
          <p v-else class="outline-empty muted">无标题</p>
        </aside>
        <Splitter
          v-if="mode === 'preview'"
          axis="x"
          @drag="outlineDrag.onDrag"
          @end="outlineDrag.onEnd"
        />
        <div
          v-if="ctrl.data.relPath || ctrl.data.previewHtml"
          ref="proseEl"
          class="prose"
          v-html="ctrl.data.previewHtml"
          @scroll="onProseScroll"
        />
        <div v-else class="empty muted">预览将显示在这里</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue';
import type { TMdViewMode } from '../../CodeEditorShell/CodeEditorShellCtrl.ts';
import type { TLayoutSizes } from '../../layoutSizes.ts';
import { makeDrag } from '../../pointerDrag.ts';
import type { MdSplitCtrl } from './MdSplitCtrl.ts';
import Splitter from '../Splitter.vue';

const props = defineProps<{
  ctrl: MdSplitCtrl;
  mode: TMdViewMode;
  sourcePct: number;
  outlineWidth: number;
}>();

const emit = defineEmits<{
  patchLayout: [patch: Partial<TLayoutSizes>];
}>();

const splitEl = ref<HTMLElement | null>(null);
const editorHost = ref<HTMLElement | null>(null);
const proseEl = ref<HTMLElement | null>(null);
let scrollLock = false;

const editorPaneStyle = computed(() => {
  if (props.mode === 'split') {
    return { flex: `0 0 ${props.sourcePct}%` };
  }
  return { flex: '1 1 0' };
});

const previewPaneStyle = computed(() => {
  if (props.mode === 'split') {
    return { flex: '1 1 0' };
  }
  return { flex: '1 1 0' };
});

const sourceDrag = makeDrag(
  () => props.sourcePct,
  (base, dx) => {
    const w = splitEl.value?.clientWidth || 1;
    emit('patchLayout', { mdSourcePct: base + (dx / w) * 100 });
  },
);

const outlineDrag = makeDrag(
  () => props.outlineWidth,
  (base, dx) => emit('patchLayout', { outlineWidth: base + dx }),
);

function onSourceDragEnd() {
  sourceDrag.onEnd();
  nextTick(() => props.ctrl.requestMeasure());
}

onMounted(() => {
  if (editorHost.value) props.ctrl.mountEditor(editorHost.value);
});

onBeforeUnmount(() => {
  props.ctrl.unmountEditor();
});

watch(
  () => props.mode,
  async (mode) => {
    if (mode === 'preview') return;
    await nextTick();
    props.ctrl.requestMeasure();
  },
);

watch(
  () => props.sourcePct,
  async () => {
    if (props.mode === 'preview') return;
    await nextTick();
    props.ctrl.requestMeasure();
  },
);

function jumpTo(id: string) {
  const root = proseEl.value;
  if (!root) return;
  const target = root.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
  if (!target) return;
  scrollLock = true;
  props.ctrl.setActiveOutline(id);
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  window.setTimeout(() => {
    scrollLock = false;
  }, 400);
}

function onProseScroll() {
  if (scrollLock || props.mode !== 'preview') return;
  const root = proseEl.value;
  if (!root || !props.ctrl.data.outline.length) return;
  const top = root.scrollTop + 12;
  let current = props.ctrl.data.outline[0]?.id ?? null;
  for (const item of props.ctrl.data.outline) {
    const el = root.querySelector<HTMLElement>(`#${CSS.escape(item.id)}`);
    if (!el) continue;
    if (el.offsetTop <= top) current = item.id;
    else break;
  }
  if (current !== props.ctrl.data.activeOutlineId) {
    props.ctrl.setActiveOutline(current);
  }
}
</script>

<style scoped>
.split {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
  background: var(--bg);
}

.pane {
  min-width: 120px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}

.pane-head {
  height: 28px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font-size: 11px;
  flex-shrink: 0;
  background: var(--panel);
}

.cm-host {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.cm-host :deep(.cm-editor) {
  height: 100%;
  max-height: 100%;
}

.cm-host :deep(.cm-scroller) {
  overflow: auto;
}

.empty {
  position: absolute;
  inset: 28px 0 0 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  font-size: 12px;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
}

.preview-body {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.outline {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--line);
  background: var(--side);
  min-height: 0;
  min-width: 0;
}

.outline-head {
  height: 28px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  font-size: 11px;
  color: var(--muted);
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}

.outline-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 6px 0;
}

.outline-item {
  display: block;
  width: 100%;
  border: none;
  background: transparent;
  color: var(--muted);
  text-align: left;
  padding: 4px 10px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-left: 2px solid transparent;
}

.outline-item:hover {
  color: var(--text);
  background: var(--color-accent-soft);
}

.outline-item.active {
  color: var(--cyan);
  border-left-color: var(--cyan);
  background: var(--color-accent-soft);
}

.outline-item.lv-1 {
  padding-left: 10px;
  font-weight: 600;
}

.outline-item.lv-2 {
  padding-left: 18px;
}

.outline-item.lv-3 {
  padding-left: 26px;
}

.outline-item.lv-4 {
  padding-left: 34px;
}

.outline-item.lv-5 {
  padding-left: 42px;
}

.outline-item.lv-6 {
  padding-left: 50px;
}

.outline-empty {
  margin: 0;
  padding: 12px 10px;
  font-size: 12px;
}

.preview .prose {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 16px 20px 32px;
  line-height: 1.65;
  color: var(--text);
  scroll-behavior: smooth;
}

.preview .prose :deep(h1),
.preview .prose :deep(h2),
.preview .prose :deep(h3),
.preview .prose :deep(h4),
.preview .prose :deep(h5),
.preview .prose :deep(h6) {
  color: var(--text);
  margin: 1.2em 0 0.5em;
  line-height: 1.3;
  scroll-margin-top: 8px;
}

.preview .prose :deep(h1) {
  font-size: 1.6em;
  border-bottom: 1px solid var(--line);
  padding-bottom: 0.3em;
}

.preview .prose :deep(h2) {
  font-size: 1.35em;
}

.preview .prose :deep(p) {
  margin: 0.7em 0;
}

.preview .prose :deep(a) {
  color: var(--cyan);
}

.preview .prose :deep(code) {
  font-family: var(--mono);
  font-size: 0.92em;
  background: var(--color-accent-soft);
  padding: 0.1em 0.35em;
  border-radius: 4px;
}

.preview .prose :deep(pre) {
  background: var(--side);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 12px 14px;
  overflow: auto;
}

.preview .prose :deep(pre code) {
  background: transparent;
  padding: 0;
}

.preview .prose :deep(blockquote) {
  margin: 0.8em 0;
  padding: 0.2em 0 0.2em 12px;
  border-left: 3px solid var(--cyan);
  color: var(--muted);
}

.preview .prose :deep(ul),
.preview .prose :deep(ol) {
  padding-left: 1.4em;
}

.preview .prose :deep(hr) {
  border: none;
  border-top: 1px solid var(--line);
  margin: 1.4em 0;
}

.preview .prose :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
}

.preview .prose :deep(th),
.preview .prose :deep(td) {
  border: 1px solid var(--line);
  padding: 6px 10px;
}

.preview .prose :deep(th) {
  background: var(--side);
}

.preview .prose :deep(img) {
  max-width: 100%;
  height: auto;
}

.muted {
  color: var(--muted);
}
</style>
