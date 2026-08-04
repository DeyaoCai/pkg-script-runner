<template>
  <Teleport to="body">
    <div
      class="wp-studio"
      :class="{ 'console-hidden': !consoleVisible }"
      role="dialog"
      aria-modal="true"
      :aria-label="current?.name || '壁纸预览'"
    >
      <button
        type="button"
        class="wp-studio-close"
        title="关闭 (Esc)"
        aria-label="关闭"
        @click.stop="emit('close')"
      >
        ×
      </button>

      <div
        ref="stageEl"
        class="wp-studio-stage"
        :class="{ 'is-dragging': dragging }"
        @wheel.prevent="onWheel"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <div
          class="wp-studio-viewport"
          :class="{ 'with-zoom-transition': !dragging && !springing }"
          :style="imgStyle"
        >
          <Transition name="wp-fade">
            <img
              v-if="current?.thumb"
              :key="current.path || current.name"
              class="wp-studio-img"
              :src="current.thumb"
              :alt="current.name"
              draggable="false"
              @load="onImgLoad"
            />
          </Transition>
        </div>
        <div class="wp-studio-scrim" aria-hidden="true" />
      </div>

      <div
        class="wp-studio-console-dock"
        @pointerenter="showConsole"
        @pointerleave="hideConsole"
      >
        <div
          class="wp-studio-console"
          @click.stop
          @pointerdown.stop
        >
        <div class="wp-studio-strip-wrap">
          <button
            type="button"
            class="wp-studio-page-btn wp-studio-page-prev"
            title="上一屏 (Shift+←)"
            :disabled="!canPagePrev"
            @click="pageStep(-1)"
          >
            ‹
          </button>
          <div
            ref="stripEl"
            class="wp-studio-strip"
            role="listbox"
            aria-label="壁纸列表"
          >
            <button
              v-for="(item, i) in items"
              :key="item.path || item.name"
              type="button"
              class="wp-studio-chip"
              role="option"
              :aria-selected="i === index"
              :class="{
                'is-active': i === index,
                'is-applied': item.name === activeName,
              }"
              :title="item.name"
              @click="selectIndex(i)"
            >
              <img v-if="item.thumb" :src="item.thumb" :alt="item.name" loading="lazy" />
            </button>
          </div>
          <button
            type="button"
            class="wp-studio-page-btn wp-studio-page-next"
            title="下一屏 (Shift+→)"
            :disabled="!canPageNext"
            @click="pageStep(1)"
          >
            ›
          </button>
        </div>

        <div class="wp-studio-bar">
          <div class="wp-studio-nav">
            <button
              type="button"
              class="wp-studio-icon-btn"
              title="上一张 (←)"
              :disabled="items.length < 2"
              @click="step(-1)"
            >
              ‹
            </button>
            <button
              type="button"
              class="wp-studio-icon-btn"
              title="下一张 (→)"
              :disabled="items.length < 2"
              @click="step(1)"
            >
              ›
            </button>
          </div>

          <div class="wp-studio-zoom" title="拖拽平移 · 滚轮缩放 · Alt 放大 · Ctrl 缩小 · Shift 加大步进">
            <button
              type="button"
              class="wp-studio-icon-btn"
              title="缩小 (Ctrl)"
              :disabled="scale <= MIN_SCALE + 0.001"
              @click="nudgeZoom(1 / ZOOM_STEP)"
            >
              −
            </button>
            <button
              type="button"
              class="wp-studio-zoom-label"
              title="复位 100%"
              @click="resetView"
            >
              {{ zoomLabel }}
            </button>
            <button
              type="button"
              class="wp-studio-icon-btn"
              title="放大 (Alt)"
              :disabled="scale >= MAX_SCALE - 0.001"
              @click="nudgeZoom(ZOOM_STEP)"
            >
              +
            </button>
          </div>

          <div class="wp-studio-meta">
            <div class="wp-studio-title" :title="current?.name">{{ current?.name || '—' }}</div>
            <div class="wp-studio-sub">
              {{ index + 1 }} / {{ items.length }}
              <span v-if="current?.badge" class="wp-studio-badge">{{ current.badge }}</span>
              <span v-else-if="current?.name === activeName" class="wp-studio-badge">当前应用背景</span>
            </div>
          </div>

          <div v-if="resolvedActions.length" class="wp-studio-actions">
            <button
              v-for="act in resolvedActions"
              :key="act.id"
              type="button"
              class="wp-studio-btn"
              :class="{
                primary: act.variant === 'primary',
                ghost: act.variant === 'ghost',
              }"
              :disabled="busy || isActionDisabled(act)"
              @click="onActionClick(act)"
            >
              {{ act.label }}
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

export type WallpaperStudioItem = {
  name: string;
  path: string;
  thumb: string;
  /** Optional chip next to index (e.g. 收藏 / 推荐) */
  badge?: string;
};

export type WallpaperStudioAction = {
  id: string;
  label: string;
  variant?: 'primary' | 'ghost' | 'default';
  /**
   * When to disable:
   * - true / false
   * - 'no-current' — no selected item
   * - 'no-active' — no activeName (wallpaper clear)
   */
  disabled?: boolean | 'no-current' | 'no-active';
};

const DEFAULT_WALLPAPER_ACTIONS: WallpaperStudioAction[] = [
  { id: 'clear', label: '清除背景', variant: 'ghost', disabled: 'no-active' },
  { id: 'apply-system', label: '系统壁纸', disabled: 'no-current' },
  { id: 'apply-app', label: '应用背景', variant: 'primary', disabled: 'no-current' },
];

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const ZOOM_STEP = 1.2;
/** Shift 按下时的放大乘数 */
const ZOOM_STEP_SHIFT = 2;
/** Overscroll rubber-band constant (iOS-like). */
const RUBBER = 0.55;
/** Underdamped spring for pan bounce-back. */
const SPRING_K = 220;
const SPRING_C = 16;
const SPRING_M = 1;

const props = withDefaults(
  defineProps<{
    items: WallpaperStudioItem[];
    modelValue?: number;
    activeName?: string | null;
    busy?: boolean;
    /**
     * false = hide action buttons.
     * Ignored when `actions` is provided (including empty array).
     */
    showActions?: boolean;
    /** Configured footer buttons. Omit to use wallpaper defaults when showActions. */
    actions?: WallpaperStudioAction[] | null;
  }>(),
  {
    modelValue: 0,
    activeName: null,
    busy: false,
    showActions: true,
    actions: null,
  },
);

const emit = defineEmits<{
  'update:modelValue': [index: number];
  close: [];
  action: [payload: { id: string; item: WallpaperStudioItem | null }];
  /** @deprecated prefer action id=apply-app */
  'apply-app': [item: WallpaperStudioItem];
  /** @deprecated prefer action id=apply-system */
  'apply-system': [item: WallpaperStudioItem];
  /** @deprecated prefer action id=clear */
  clear: [];
}>();

const index = ref(0);
const stageEl = ref<HTMLElement | null>(null);
const stripEl = ref<HTMLElement | null>(null);
const scale = ref(1);
const tx = ref(0);
const ty = ref(0);
const dragging = ref(false);
const springing = ref(false);
const consoleVisible = ref(false);
/** Natural pixel size of the current image (for contain-edge pan clamp). */
const imgNatural = ref({ w: 0, h: 0 });
/** After page jump, align active chip to strip start; single-step uses nearest. */
let stripAlign: 'nearest' | 'start' = 'nearest';
let dragOriginX = 0;
let dragOriginY = 0;
let dragStartTx = 0;
let dragStartTy = 0;
let activePointerId: number | null = null;
let springRaf = 0;
let springVelX = 0;
let springVelY = 0;
let springTargetX = 0;
let springTargetY = 0;
let springLastTs = 0;

function showConsole(): void {
  consoleVisible.value = true;
}

function hideConsole(): void {
  consoleVisible.value = false;
}

watch(
  () => props.modelValue,
  (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) {
      index.value = clampIndex(v);
    }
  },
  { immediate: true },
);

watch(index, (v) => {
  emit('update:modelValue', v);
  imgNatural.value = { w: 0, h: 0 };
  resetView();
  void nextTick(() => ensureActiveChipVisible(stripAlign));
  stripAlign = 'nearest';
});

watch(
  () => props.items.length,
  () => {
    index.value = clampIndex(index.value);
    void nextTick(() => ensureActiveChipVisible('nearest'));
  },
);

const canPagePrev = computed(() => index.value > 0);
const canPageNext = computed(() => index.value < props.items.length - 1);

const current = computed(() => props.items[index.value] ?? null);

const resolvedActions = computed(() => {
  if (props.actions != null) return props.actions;
  return props.showActions ? DEFAULT_WALLPAPER_ACTIONS : [];
});

function isActionDisabled(act: WallpaperStudioAction): boolean {
  if (act.disabled === true) return true;
  if (act.disabled === false) return false;
  if (act.disabled === 'no-current') return !current.value;
  if (act.disabled === 'no-active') return !props.activeName;
  if (act.id === 'clear') return !props.activeName;
  return !current.value;
}

function onActionClick(act: WallpaperStudioAction): void {
  const item = current.value;
  emit('action', { id: act.id, item });
  // Backward-compatible emits for existing wallpaper callers.
  if (act.id === 'clear') emit('clear');
  else if (act.id === 'apply-system' && item) emit('apply-system', item);
  else if (act.id === 'apply-app' && item) emit('apply-app', item);
}

watch(
  () => current.value?.path || current.value?.thumb,
  () => {
    imgNatural.value = { w: 0, h: 0 };
  },
);

const zoomLabel = computed(() => `${Math.round(scale.value * 100)}%`);

const imgStyle = computed(() => ({
  transform: `translate3d(${tx.value}px, ${ty.value}px, 0) scale(${scale.value})`,
}));

function clampIndex(i: number): number {
  const n = props.items.length;
  if (n <= 0) return 0;
  return ((i % n) + n) % n;
}

function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

function onImgLoad(e: Event): void {
  const img = e.target as HTMLImageElement;
  imgNatural.value = {
    w: img.naturalWidth || 0,
    h: img.naturalHeight || 0,
  };
  clampPan();
}

/** Display size of the image at scale=1 with object-fit: contain. */
function containedBaseSize(stageW: number, stageH: number): { dw: number; dh: number } {
  const { w: nw, h: nh } = imgNatural.value;
  if (nw <= 0 || nh <= 0 || stageW <= 0 || stageH <= 0) {
    return { dw: 0, dh: 0 };
  }
  const fit = Math.min(stageW / nw, stageH / nh);
  return { dw: nw * fit, dh: nh * fit };
}

/**
 * Pan so image edges don't leave a gap when the zoomed image is larger than the stage.
 * Uses contain geometry (not full stage), so letterboxed axes clamp correctly.
 */
function panLimits(s: number): { maxTx: number; maxTy: number } {
  const el = stageEl.value;
  if (!el || s <= 0) return { maxTx: 0, maxTy: 0 };
  const { width: W, height: H } = el.getBoundingClientRect();
  const { dw, dh } = containedBaseSize(W, H);
  if (dw <= 0 || dh <= 0) return { maxTx: 0, maxTy: 0 };
  return {
    maxTx: Math.max(0, (dw * s - W) / 2),
    maxTy: Math.max(0, (dh * s - H) / 2),
  };
}

function stageSize(): { w: number; h: number } {
  const el = stageEl.value;
  if (!el) return { w: 400, h: 400 };
  const { width, height } = el.getBoundingClientRect();
  return { w: Math.max(1, width), h: Math.max(1, height) };
}

/** Diminishing overscroll distance past an edge. */
function rubberDelta(over: number, dimension: number): number {
  if (over <= 0 || dimension <= 0) return 0;
  return (over * dimension * RUBBER) / (dimension + RUBBER * over);
}

function withRubber(value: number, max: number, dim: number): number {
  if (value > max) return max + rubberDelta(value - max, dim);
  if (value < -max) return -max - rubberDelta(-value - max, dim);
  return value;
}

function clampPan(): void {
  const { maxTx, maxTy } = panLimits(scale.value);
  tx.value = Math.min(maxTx, Math.max(-maxTx, tx.value));
  ty.value = Math.min(maxTy, Math.max(-maxTy, ty.value));
}

function stopSpring(): void {
  if (springRaf) {
    cancelAnimationFrame(springRaf);
    springRaf = 0;
  }
  springVelX = 0;
  springVelY = 0;
  springing.value = false;
}

/** Physics spring back to pan limits (underdamped — real spring, not CSS easing). */
function bouncePan(): void {
  const { maxTx, maxTy } = panLimits(scale.value);
  springTargetX = Math.min(maxTx, Math.max(-maxTx, tx.value));
  springTargetY = Math.min(maxTy, Math.max(-maxTy, ty.value));
  const dx0 = tx.value - springTargetX;
  const dy0 = ty.value - springTargetY;
  if (Math.abs(dx0) < 0.5 && Math.abs(dy0) < 0.5) {
    clampPan();
    return;
  }

  if (springRaf) {
    cancelAnimationFrame(springRaf);
    springRaf = 0;
  }
  springVelX = 0;
  springVelY = 0;
  springing.value = true;
  springLastTs = 0;

  const tick = (now: number) => {
    if (!springLastTs) springLastTs = now;
    const dt = Math.min(0.032, (now - springLastTs) / 1000);
    springLastTs = now;

    const dx = tx.value - springTargetX;
    const dy = ty.value - springTargetY;
    const ax = (-SPRING_K * dx - SPRING_C * springVelX) / SPRING_M;
    const ay = (-SPRING_K * dy - SPRING_C * springVelY) / SPRING_M;
    springVelX += ax * dt;
    springVelY += ay * dt;
    tx.value += springVelX * dt;
    ty.value += springVelY * dt;

    const settled =
      Math.abs(tx.value - springTargetX) < 0.35 &&
      Math.abs(ty.value - springTargetY) < 0.35 &&
      Math.abs(springVelX) < 12 &&
      Math.abs(springVelY) < 12;

    if (settled) {
      tx.value = springTargetX;
      ty.value = springTargetY;
      stopSpring();
      return;
    }
    springRaf = requestAnimationFrame(tick);
  };

  springRaf = requestAnimationFrame(tick);
}

function resetView(): void {
  stopSpring();
  scale.value = 1;
  tx.value = 0;
  ty.value = 0;
  dragging.value = false;
  activePointerId = null;
}

function selectIndex(i: number): void {
  stripAlign = 'nearest';
  index.value = clampIndex(i);
}

function step(delta: number): void {
  if (props.items.length < 2) return;
  stripAlign = 'nearest';
  index.value = clampIndex(index.value + delta);
}

/**
 * How many chips fit in the strip viewport (industry filmstrip page size).
 * Used by Photos-style “jump by a screen of thumbs”.
 */
function stripPageSize(): number {
  const el = stripEl.value;
  if (!el) return 1;
  const chip = el.querySelector('.wp-studio-chip') as HTMLElement | null;
  if (!chip) return 1;
  const gap = Number.parseFloat(getComputedStyle(el).columnGap || getComputedStyle(el).gap) || 8;
  const unit = chip.offsetWidth + gap;
  if (unit <= 0) return 1;
  return Math.max(1, Math.floor((el.clientWidth + gap) / unit));
}

/**
 * Page by N thumbs (N = visible count), then snap the strip so the new
 * selection sits at the start — same model as OS photo filmstrips / CSS
 * scroll-snap galleries, not “first incomplete rect” geometry.
 */
function pageStep(dir: -1 | 1): void {
  const n = props.items.length;
  if (n < 2) return;
  const page = stripPageSize();
  const next = Math.min(n - 1, Math.max(0, index.value + dir * page));
  if (next === index.value) return;
  stripAlign = 'start';
  index.value = next;
}

function ensureActiveChipVisible(align: 'nearest' | 'start' = 'nearest'): void {
  const el = stripEl.value;
  if (!el) return;
  const chip = el.querySelectorAll('.wp-studio-chip')[index.value] as HTMLElement | undefined;
  if (!chip) return;
  chip.scrollIntoView({
    behavior: 'smooth',
    inline: align,
    block: 'nearest',
  });
}

/** Zoom relative to a point in stage coords (origin = stage center). */
function zoomAt(nextScale: number, ox: number, oy: number): void {
  stopSpring();
  const ns = clampScale(nextScale);
  const old = scale.value;
  if (Math.abs(ns - old) < 1e-6) {
    clampPan();
    return;
  }
  const ratio = ns / old;
  tx.value = ox - (ox - tx.value) * ratio;
  ty.value = oy - (oy - ty.value) * ratio;
  scale.value = ns;
  clampPan();
}

function zoomStep(shift = false): number {
  return shift ? ZOOM_STEP_SHIFT : ZOOM_STEP;
}

function stageLocalFromClient(clientX: number, clientY: number): { ox: number; oy: number } {
  const el = stageEl.value;
  if (!el) return { ox: 0, oy: 0 };
  const rect = el.getBoundingClientRect();
  return {
    ox: clientX - rect.left - rect.width / 2,
    oy: clientY - rect.top - rect.height / 2,
  };
}

function onWheel(e: WheelEvent): void {
  const { ox, oy } = stageLocalFromClient(e.clientX, e.clientY);
  const step = zoomStep(e.shiftKey);
  // Alt 强制放大 · Ctrl 强制缩小；否则按滚轮方向缩放
  if (e.altKey && !e.ctrlKey) {
    zoomAt(scale.value * step, ox, oy);
    return;
  }
  if (e.ctrlKey && !e.altKey) {
    zoomAt(scale.value / step, ox, oy);
    return;
  }
  const factor = e.deltaY < 0 ? step : 1 / step;
  zoomAt(scale.value * factor, ox, oy);
}

function nudgeZoom(factor: number): void {
  zoomAt(scale.value * factor, 0, 0);
}

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return;
  const { ox, oy } = stageLocalFromClient(e.clientX, e.clientY);
  const step = zoomStep(e.shiftKey);

  // Alt 点击/按下 = 放大；Ctrl = 缩小
  if (e.altKey && !e.ctrlKey) {
    zoomAt(scale.value * step, ox, oy);
    return;
  }
  if (e.ctrlKey && !e.altKey) {
    zoomAt(scale.value / step, ox, oy);
    return;
  }

  // 默认拖拽平移（可过界阻尼，松手 spring 回弹）
  stopSpring();
  dragging.value = true;
  activePointerId = e.pointerId;
  dragOriginX = e.clientX;
  dragOriginY = e.clientY;
  dragStartTx = tx.value;
  dragStartTy = ty.value;
  stageEl.value?.setPointerCapture(e.pointerId);
}

function onPointerMove(e: PointerEvent): void {
  if (!dragging.value || e.pointerId !== activePointerId) return;
  const rawTx = dragStartTx + (e.clientX - dragOriginX);
  const rawTy = dragStartTy + (e.clientY - dragOriginY);
  const { maxTx, maxTy } = panLimits(scale.value);
  const { w, h } = stageSize();
  tx.value = withRubber(rawTx, maxTx, w);
  ty.value = withRubber(rawTy, maxTy, h);
}

function onPointerUp(e: PointerEvent): void {
  if (e.pointerId !== activePointerId) return;
  dragging.value = false;
  activePointerId = null;
  try {
    stageEl.value?.releasePointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
  bouncePan();
}

function onDocKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
    return;
  }
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    if (e.shiftKey) pageStep(-1);
    else step(-1);
    return;
  }
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    if (e.shiftKey) pageStep(1);
    else step(1);
    return;
  }
  if (e.key === 'PageUp') {
    e.preventDefault();
    pageStep(-1);
    return;
  }
  if (e.key === 'PageDown') {
    e.preventDefault();
    pageStep(1);
    return;
  }
  if (e.key === '+' || e.key === '=') {
    e.preventDefault();
    nudgeZoom(zoomStep(e.shiftKey));
    return;
  }
  if (e.key === '-' || e.key === '_') {
    e.preventDefault();
    nudgeZoom(1 / zoomStep(e.shiftKey));
    return;
  }
  if (e.key === '0') {
    e.preventDefault();
    resetView();
  }
}

onMounted(() => {
  document.addEventListener('keydown', onDocKey);
  window.addEventListener('resize', clampPan);
  document.body.style.overflow = 'hidden';
  void nextTick(() => ensureActiveChipVisible('nearest'));
});

onUnmounted(() => {
  document.removeEventListener('keydown', onDocKey);
  window.removeEventListener('resize', clampPan);
  document.body.style.overflow = '';
  stopSpring();
});
</script>

<style scoped>
.wp-studio {
  position: fixed;
  inset: 0;
  z-index: 12000;
  /* Frosted scrim — letterbox / edges show page content under the preview. */
  background: color-mix(in srgb, var(--void, #000) 42%, transparent);
  -webkit-backdrop-filter: blur(var(--glass-blur, 22px)) saturate(1.1);
  backdrop-filter: blur(var(--glass-blur, 22px)) saturate(1.1);
  color: var(--text, var(--color-fg, #f3f4f6));
}

.wp-studio-close {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 3;
  width: 40px;
  height: 40px;
  margin: 0;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--neutral-0, #fff) 18%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--neutral-930, #0c0e12) 70%, transparent);
  backdrop-filter: blur(var(--glass-blur, 22px));
  -webkit-backdrop-filter: blur(var(--glass-blur, 22px));
  color: var(--text, var(--color-fg, #f3f4f6));
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}

.wp-studio-close:hover {
  background: color-mix(in srgb, var(--neutral-0, #fff) 16%, transparent);
}

.wp-studio-stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: transparent;
  touch-action: none;
  cursor: grab;
  user-select: none;
}

.wp-studio-stage.is-dragging {
  cursor: grabbing;
}

.wp-studio-viewport {
  position: absolute;
  inset: 0;
  transform-origin: center center;
  will-change: transform;
}

.wp-studio-viewport.with-zoom-transition {
  transition: transform 0.2s ease;
}

.wp-studio-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center;
  pointer-events: none;
}

.wp-fade-enter-active,
.wp-fade-leave-active {
  transition: opacity 0.28s ease;
}

.wp-fade-leave-active {
  position: absolute;
  inset: 0;
}

.wp-fade-enter-from,
.wp-fade-leave-to {
  opacity: 0;
}

.wp-studio-scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--void, #000) 20%, transparent) 0%,
    transparent 22%,
    transparent 62%,
    color-mix(in srgb, var(--void, #000) 42%, transparent) 100%
  );
  pointer-events: none;
  transition: opacity 0.25s ease;
}

.wp-studio.console-hidden .wp-studio-scrim {
  opacity: 0.2;
}

.wp-studio-console-dock {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2;
  display: flex;
  justify-content: center;
  align-items: flex-end;
  padding: 0 14px 20px;
  min-height: 88px;
  pointer-events: auto;
}

.wp-studio-console {
  position: relative;
  width: min(920px, calc(100vw - 28px));
  padding: 12px 14px 14px;
  border-radius: 18px;
  border: 1px solid var(--line, var(--color-border));
  /* Fixed frost — do not use opaque --panel (glassAlpha 100% would kill blur). */
  background: color-mix(
    in srgb,
    var(--neutral-930, #0e1014) 72%,
    transparent
  );
  backdrop-filter: blur(var(--glass-blur, 22px)) saturate(1.2);
  -webkit-backdrop-filter: blur(var(--glass-blur, 22px)) saturate(1.2);
  box-shadow:
    0 18px 48px var(--shadow, var(--color-shadow)),
    inset 0 1px 0 color-mix(in srgb, var(--neutral-0, #fff) 10%, transparent);
  color: var(--text, var(--color-fg));
  opacity: 1;
  transform: translateY(0);
  transition:
    opacity 0.22s ease,
    transform 0.22s ease;
  pointer-events: auto;
}

.wp-studio.console-hidden .wp-studio-console {
  opacity: 0;
  transform: translateY(14px);
  pointer-events: none;
}

.wp-studio-strip-wrap {
  position: relative;
  display: flex;
  align-items: stretch;
  gap: 6px;
  margin-bottom: 4px;
}

.wp-studio-strip {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 10px;
  scrollbar-width: thin;
  scroll-snap-type: x mandatory;
  scroll-behavior: smooth;
}

.wp-studio-page-btn {
  flex: 0 0 auto;
  align-self: center;
  width: 32px;
  height: 32px;
  margin: 0 0 10px;
  padding: 0;
  border-radius: 10px;
  border: 1px solid var(--line, var(--color-border));
  background: var(--row, var(--color-bg-row));
  color: var(--text, var(--color-fg));
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}

.wp-studio-page-btn:hover:not(:disabled) {
  background: var(--row-hover, var(--color-bg-row-hover));
}

.wp-studio-page-btn:disabled {
  opacity: 0.28;
  cursor: default;
}

.wp-studio-chip {
  flex: 0 0 auto;
  width: 88px;
  height: 50px;
  margin: 0;
  padding: 0;
  border-radius: 8px;
  overflow: hidden;
  border: 2px solid transparent;
  background: var(--neutral-900, var(--bg-raised, #111));
  cursor: pointer;
  scroll-snap-align: start;
}

.wp-studio-chip img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}

.wp-studio-chip.is-active {
  border-color: color-mix(in srgb, var(--neutral-0, #fff) 85%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--void, #000) 35%, transparent);
}

.wp-studio-chip.is-applied:not(.is-active) {
  border-color: color-mix(in srgb, var(--accent, var(--color-accent)) 70%, transparent);
}

.wp-studio-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.wp-studio-nav,
.wp-studio-zoom {
  display: flex;
  gap: 6px;
  align-items: center;
}

.wp-studio-icon-btn {
  width: 36px;
  height: 36px;
  margin: 0;
  padding: 0;
  border-radius: 10px;
  border: 1px solid var(--line, var(--color-border));
  background: var(--row, var(--color-bg-row));
  color: var(--text, var(--color-fg));
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.wp-studio-icon-btn:hover:not(:disabled) {
  background: var(--row-hover, var(--color-bg-row-hover));
}

.wp-studio-icon-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.wp-studio-zoom-label {
  min-width: 52px;
  height: 36px;
  margin: 0;
  padding: 0 8px;
  border-radius: 10px;
  border: 1px solid var(--line, var(--color-border));
  background: color-mix(in srgb, var(--neutral-0, #fff) 4%, transparent);
  color: var(--text, var(--color-fg));
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}

.wp-studio-zoom-label:hover {
  background: var(--row-hover, var(--color-bg-row-hover));
}

.wp-studio-meta {
  flex: 1 1 160px;
  min-width: 0;
}

.wp-studio-title {
  font-size: 14px;
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wp-studio-sub {
  margin-top: 2px;
  font-size: 12px;
  color: var(--muted, var(--color-fg-muted));
  display: flex;
  align-items: center;
  gap: 8px;
}

.wp-studio-badge {
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 650;
  color: var(--on-accent, var(--color-fg-on-accent, var(--text)));
  background: var(--accent-soft, var(--color-accent-soft));
  border: 1px solid color-mix(in srgb, var(--accent, var(--color-accent)) 40%, transparent);
}

.wp-studio-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.wp-studio-btn {
  margin: 0;
  padding: 8px 14px;
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  border-radius: 999px;
  border: 1px solid var(--line, var(--color-border));
  background: var(--row, var(--color-bg-row));
  color: var(--text, var(--color-fg));
  cursor: pointer;
}

.wp-studio-btn:hover:not(:disabled) {
  background: var(--row-hover, var(--color-bg-row-hover));
}

.wp-studio-btn.primary {
  border-color: color-mix(in srgb, var(--accent, var(--color-accent)) 45%, transparent);
  background: var(--accent-soft, var(--color-accent-soft-strong));
}

.wp-studio-btn.primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent, var(--color-accent)) 38%, transparent);
}

.wp-studio-btn.ghost {
  background: transparent;
  color: var(--muted, var(--color-fg-muted));
}

.wp-studio-btn:disabled {
  opacity: 0.45;
  cursor: wait;
}
</style>
