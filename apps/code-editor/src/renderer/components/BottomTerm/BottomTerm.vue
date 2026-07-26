<template>
  <section
    v-show="ctrl.state.open"
    class="bottom-term"
    :style="{ height: `${ctrl.state.height}px` }"
  >
    <div
      class="grip"
      v-tip="'拖拽调整高度'"
      @pointerdown="onResizeStart"
    />
    <header class="bar">
      <div class="cols" v-tip="'一页并排显示几个 Shell（仅横向）'">
        <button
          v-for="n in colChoices"
          :key="n"
          type="button"
          class="btn col"
          :class="{ on: ctrl.state.columnsPerPage === n }"
          @click="ctrl.setColumnsPerPage(n)"
        >
          {{ n }}
        </button>
      </div>
      <div class="pager">
        <button
          type="button"
          class="btn icon"
          v-tip="'上一页'"
          :disabled="ctrl.state.pageIndex <= 0"
          @click="ctrl.pagePrev()"
        >
          ‹
        </button>
        <div class="tabs">
          <button
            v-for="t in visibleTabs"
            :key="t.id"
            type="button"
            class="tab"
            :class="{
              active: t.id === ctrl.data.focusId,
              dead: !t.alive,
            }"
            v-tip="t.cwd"
            @click="ctrl.selectTab(t.id)"
            @auxclick.middle.prevent="ctrl.closeTab(t.id)"
          >
            <span class="tab-title"
              >{{ t.title }}{{ t.alive ? '' : ' ·' }}</span
            >
            <span
              class="tab-x"
              v-tip="'关闭'"
              @click.stop="ctrl.closeTab(t.id)"
              >×</span
            >
          </button>
        </div>
        <span class="page-ind muted" v-tip="'当前页 / 总页数'"
          >{{ ctrl.state.pageIndex + 1 }}/{{ ctrl.state.pageCount }}</span
        >
        <button
          type="button"
          class="btn icon"
          v-tip="'下一页'"
          :disabled="ctrl.state.pageIndex >= ctrl.state.pageCount - 1"
          @click="ctrl.pageNext()"
        >
          ›
        </button>
      </div>
      <button
        type="button"
        class="btn add"
        v-tip="'新建 Shell'"
        :disabled="ctrl.data.busy"
        @click="ctrl.addTab()"
      >
        +
      </button>
      <span v-if="ctrl.data.error" class="err">{{ ctrl.data.error }}</span>
      <span class="spacer" />
      <button
        type="button"
        class="btn"
        v-tip="'清屏（当前焦点）'"
        :disabled="!ctrl.data.focusId"
        @click="ctrl.clearFocused()"
      >
        清屏
      </button>
      <button
        type="button"
        class="btn"
        v-tip="'重启当前焦点 Shell'"
        :disabled="ctrl.data.busy"
        @click="ctrl.restartFocused()"
      >
        重启
      </button>
      <button type="button" class="btn" v-tip="'隐藏'" @click="ctrl.hide()">
        ▾
      </button>
    </header>
    <div ref="hostRef" class="xterm-host" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import type { BottomTermCtrl } from './BottomTermCtrl.ts';
import '@xterm/xterm/css/xterm.css';

const props = defineProps<{ ctrl: BottomTermCtrl }>();
const hostRef = ref<HTMLElement | null>(null);
const colChoices = [1, 2, 3, 4] as const;

/** Slice current page tabs — computed so Vue tracks tabs / page / cols. */
const visibleTabs = computed(() => {
  const cols = Math.max(1, props.ctrl.state.columnsPerPage);
  const start = props.ctrl.state.pageIndex * cols;
  return props.ctrl.data.tabs.slice(start, start + cols);
});

let resizing = false;
let startY = 0;
let startH = 0;

function onResizeStart(ev: PointerEvent): void {
  resizing = true;
  startY = ev.clientY;
  startH = props.ctrl.state.height;
  (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
  window.addEventListener('pointermove', onResizeMove);
  window.addEventListener('pointerup', onResizeEnd);
}

function onResizeMove(ev: PointerEvent): void {
  if (!resizing) return;
  props.ctrl.setHeight(startH + (startY - ev.clientY));
}

function onResizeEnd(): void {
  resizing = false;
  window.removeEventListener('pointermove', onResizeMove);
  window.removeEventListener('pointerup', onResizeEnd);
}

onMounted(() => {
  if (hostRef.value) props.ctrl.mount(hostRef.value);
  void props.ctrl.hydratePrefs();
});

watch(
  () => props.ctrl.state.open,
  (open) => {
    // 首个 Shell 只由 ctrl.show()/addTab 创建，避免与此处重复
    if (open && props.ctrl.data.tabs.length) props.ctrl.refreshLayout();
  },
);

onBeforeUnmount(() => {
  onResizeEnd();
  props.ctrl.unmount();
});
</script>

<style scoped>
.bottom-term {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-height: 0;
  border-top: 1px solid var(--line);
  background: var(--panel);
  position: relative;
}

.grip {
  position: absolute;
  top: -3px;
  left: 0;
  right: 0;
  height: 6px;
  cursor: ns-resize;
  z-index: 2;
}

.grip:hover {
  background: color-mix(in srgb, var(--cyan) 35%, transparent);
}

.bar {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 6px;
  height: 28px;
  padding: 0 6px 0 4px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
  user-select: none;
  min-width: 0;
}

.pager {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.page-ind {
  min-width: 28px;
  text-align: center;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.cols {
  display: flex;
  align-items: center;
  gap: 1px;
  flex-shrink: 0;
  padding-right: 4px;
  border-right: 1px solid var(--line);
  margin-right: 2px;
}

.btn.col {
  min-width: 22px;
  padding: 1px 5px;
}

.btn.col.on {
  color: var(--cyan);
  border-color: var(--cyan);
  background: var(--color-accent-soft);
}

.btn.icon {
  min-width: 22px;
  padding: 1px 6px;
  font-size: 14px;
  font-weight: 700;
}

.tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  overflow-x: auto;
  flex: 1;
  flex-wrap: nowrap;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 140px;
  height: 22px;
  padding: 0 4px 0 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  flex-shrink: 0;
}

.tab:hover {
  color: var(--text);
  background: var(--color-accent-soft);
}

.tab.active {
  color: var(--cyan);
  border-color: var(--line);
  background: var(--color-accent-soft);
}

.tab.dead {
  opacity: 0.55;
}

.tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.tab-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 3px;
  color: var(--muted);
  flex-shrink: 0;
}

.tab-x:hover {
  color: var(--bad);
  background: var(--color-danger-bg, rgba(255, 80, 80, 0.15));
}

.err {
  font-size: 11px;
  color: var(--bad);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 20vw;
  flex-shrink: 1;
}

.spacer {
  flex: 0 0 4px;
}

.btn {
  border: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  border-radius: 4px;
  padding: 1px 8px;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  flex-shrink: 0;
}

.btn.add {
  padding: 1px 7px;
  font-weight: 700;
}

.btn:hover:not(:disabled) {
  color: var(--cyan);
  border-color: var(--cyan);
}

.btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.muted {
  color: var(--muted);
}

.xterm-host {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: stretch;
}

/* panes are created in JS — :deep so scoped styles apply */
.xterm-host :deep(.xterm-pane) {
  display: none;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  box-sizing: border-box;
  padding: 4px 6px 6px;
  overflow: hidden;
  border-right: 1px solid var(--line);
  position: relative;
}

.xterm-host :deep(.xterm-pane.is-visible) {
  display: flex;
}

.xterm-host :deep(.xterm-pane.is-last) {
  border-right: none;
}

.xterm-host :deep(.xterm-pane.is-focus) {
  box-shadow: inset 0 0 0 1px
    color-mix(in srgb, var(--cyan) 50%, transparent);
}

.xterm-host :deep(.xterm-pane .xterm) {
  flex: 1 1 auto;
  width: 100% !important;
  height: 100% !important;
  min-width: 0;
  min-height: 0;
}

.xterm-host :deep(.xterm-pane .xterm-viewport) {
  overflow-y: auto !important;
}

.xterm-host :deep(.xterm-pane .xterm-screen) {
  width: 100% !important;
}
</style>
