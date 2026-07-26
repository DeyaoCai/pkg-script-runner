<template>
  <section class="editor">
    <div class="tabs">
      <button
        v-for="t in ctrl.data.tabs"
        :key="t.id"
        type="button"
        class="tab"
        :class="{
          active: t.id === ctrl.data.activeTabId,
          dirty: t.dirty,
          conflict: t.externalConflict,
        }"
        @click="onSelect(t.id)"
        @auxclick.middle.prevent="onClose(t.id)"
        @contextmenu.prevent="openMenu($event, t.id)"
      >
        <span
          >{{ t.name }}{{ t.dirty ? ' •' : ''
          }}{{ t.externalConflict ? ' !' : '' }}</span
        >
        <span class="x" v-tip="'关闭'" @click.stop="onClose(t.id)">×</span>
      </button>
      <div v-if="!ctrl.data.tabs.length" class="empty-tabs muted">未打开文件</div>
      <div v-else class="tab-actions">
        <button
          type="button"
          class="act"
          v-tip="'关闭其他标签'"
          :disabled="ctrl.data.tabs.length < 2"
          @click="onCloseOthers()"
        >
          关闭其他
        </button>
        <button
          type="button"
          class="act"
          v-tip="'关闭全部标签'"
          @click="onCloseAll()"
        >
          关闭全部
        </button>
      </div>
    </div>
    <div
      v-if="menu"
      ref="menuEl"
      class="ctx"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
    >
      <button type="button" class="ctx-item" @click="onMenuClose()">关闭</button>
      <button
        type="button"
        class="ctx-item"
        :disabled="ctrl.data.tabs.length < 2"
        @click="onMenuCloseOthers()"
      >
        关闭其他
      </button>
      <button type="button" class="ctx-item" @click="onMenuCloseAll()">关闭全部</button>
      <button type="button" class="ctx-item" @click="onMenuLocate()">
        在目录中显示
      </button>
      <button type="button" class="ctx-item" @click="onMenuReveal()">
        在文件浏览器中打开
      </button>
      <button type="button" class="ctx-item" @click="onMenuOpenSystem()">
        使用已安装的软件打开
      </button>
    </div>
    <FilePreview
      ref="preview"
      :rel-path="ctrl.activeTab?.relPath ?? null"
      :content="textContent"
      :rev="ctrl.activeTab?.rev ?? -1"
      :is-binary="ctrl.isBinaryTab"
      :file-name="ctrl.activeTab?.name"
      :file-size="ctrl.activeTab?.size"
      empty-hint="从左侧目录打开文件，或从 Git Diff 跳转"
      @change="onPreviewChange"
      @save="ctrl.save()"
      @blur="flushDirty"
      @open-system="ctrl.openWithSystem()"
      @reveal="ctrl.showInExplorer()"
    />
    <div v-if="ctrl.hasConflict && !ctrl.isBinaryTab" class="conflict-bar">
      <span>磁盘上的文件已被外部修改</span>
      <button type="button" class="cbtn" @click="ctrl.reloadFromDisk()">加载磁盘版本</button>
      <button type="button" class="cbtn" @click="ctrl.keepLocal()">保留本地并覆盖</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import type { EditorTabsCtrl } from './EditorTabsCtrl.ts';
import FilePreview from '../DesignPane/FilePreview.vue';

const props = defineProps<{ ctrl: EditorTabsCtrl }>();

const preview = ref<{ gotoLine: (line: number) => void } | null>(null);
const menuEl = ref<HTMLElement | null>(null);
const menu = ref<{ x: number; y: number; tabId: string } | null>(null);
let flushing = false;
let boundTabId: string | null = null;

const textContent = computed(() => {
  const tab = props.ctrl.activeTab;
  if (!tab || tab.kind === 'binary') return '';
  return tab.content;
});

async function flushDirty(): Promise<void> {
  if (flushing) return;
  const tab = props.ctrl.activeTab;
  if (!tab?.dirty) return;
  flushing = true;
  try {
    await props.ctrl.save();
  } finally {
    flushing = false;
  }
}

function onPreviewChange(text: string) {
  const id = props.ctrl.data.activeTabId;
  if (id) props.ctrl.onChange(id, text);
}

function syncPendingLine() {
  props.ctrl.syncFromShell();
  const tab = props.ctrl.activeTab;
  const tabId = tab?.id ?? null;
  if (boundTabId !== tabId) boundTabId = tabId;
  const line = props.ctrl.consumePendingLine();
  if (line != null) {
    nextTick(() => preview.value?.gotoLine(line));
  }
}

async function onSelect(id: string) {
  closeMenu();
  await flushDirty();
  props.ctrl.selectTab(id);
  syncPendingLine();
}

async function onClose(id: string) {
  closeMenu();
  await props.ctrl.saveTab(id);
  props.ctrl.closeTab(id);
  syncPendingLine();
}

async function onCloseOthers(keepId?: string) {
  closeMenu();
  await flushDirty();
  await props.ctrl.closeOthers(keepId);
  syncPendingLine();
}

async function onCloseAll() {
  closeMenu();
  await props.ctrl.closeAll();
  syncPendingLine();
}

function openMenu(ev: MouseEvent, tabId: string) {
  menu.value = { x: ev.clientX, y: ev.clientY, tabId };
}

function closeMenu() {
  menu.value = null;
}

async function onMenuClose() {
  const id = menu.value?.tabId;
  closeMenu();
  if (id) await onClose(id);
}

async function onMenuCloseOthers() {
  const id = menu.value?.tabId;
  closeMenu();
  if (id) await onCloseOthers(id);
}

async function onMenuCloseAll() {
  closeMenu();
  await onCloseAll();
}

async function onMenuLocate() {
  const id = menu.value?.tabId;
  closeMenu();
  const tab = props.ctrl.data.tabs.find((t) => t.id === id);
  if (tab) await props.ctrl.locateInTree(tab.relPath);
}

async function onMenuReveal() {
  const id = menu.value?.tabId;
  closeMenu();
  const tab = props.ctrl.data.tabs.find((t) => t.id === id);
  if (tab) await props.ctrl.showInExplorer(tab.relPath);
}

async function onMenuOpenSystem() {
  const id = menu.value?.tabId;
  closeMenu();
  const tab = props.ctrl.data.tabs.find((t) => t.id === id);
  if (tab) await props.ctrl.openWithSystem(tab.relPath);
}

function onDocPointer(ev: PointerEvent) {
  if (!menu.value) return;
  const el = menuEl.value;
  if (el && ev.target instanceof Node && el.contains(ev.target)) return;
  menu.value = null;
}

watch(
  () => [props.ctrl.data.activeTabId, props.ctrl.data.tabs, props.ctrl.state.pendingLine] as const,
  () => syncPendingLine(),
  { deep: true },
);

onMounted(() => {
  syncPendingLine();
  document.addEventListener('pointerdown', onDocPointer, true);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer, true);
  void flushDirty();
});
</script>

<style scoped>
.editor {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  position: relative;
  background: var(--bg);
}

.tabs {
  display: flex;
  align-items: stretch;
  height: var(--tab-h);
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  overflow-x: auto;
  flex-shrink: 0;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  border: none;
  border-right: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  padding: 0 10px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  white-space: nowrap;
}

.tab.active {
  color: var(--text);
  background: var(--bg);
  box-shadow: inset 0 -2px 0 var(--cyan);
}

.tab.dirty {
  font-style: italic;
}

.tab.conflict {
  color: var(--warn);
}

.tab-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  flex-shrink: 0;
  position: sticky;
  right: 0;
  background: var(--panel);
  border-left: 1px solid var(--line);
}

.act {
  border: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
}

.act:hover:not(:disabled) {
  color: var(--cyan);
  border-color: var(--cyan);
}

.act:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ctx {
  position: fixed;
  z-index: 50;
  min-width: 140px;
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

.ctx-item:hover:not(:disabled) {
  background: var(--color-accent-soft);
  color: var(--cyan);
}

.ctx-item:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.conflict-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  font-size: 12px;
  background: var(--color-warning-bg);
  color: var(--color-warning-fg);
  border-bottom: 1px solid var(--color-warning-border);
  flex-shrink: 0;
}

.cbtn {
  border: 1px solid var(--color-warning-border);
  background: transparent;
  color: inherit;
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
  font-family: inherit;
  font-size: 11px;
}

.cbtn:hover {
  border-color: var(--cyan);
  color: var(--cyan);
}

.tab .x {
  opacity: 0.5;
  padding: 0 2px;
}

.tab .x:hover {
  opacity: 1;
  color: var(--bad);
}

.empty-tabs {
  padding: 0 12px;
  display: flex;
  align-items: center;
  font-size: 12px;
}

.muted {
  color: var(--muted);
}
</style>
