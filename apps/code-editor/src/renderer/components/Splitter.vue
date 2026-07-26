<template>
  <div
    class="splitter"
    :class="[
      axis === 'x' ? 'axis-x' : 'axis-y',
      emphasis ? 'emphasis' : '',
    ]"
    role="separator"
    :aria-orientation="axis === 'x' ? 'vertical' : 'horizontal'"
    @pointerdown="onDown"
  />
</template>

<script setup lang="ts">
import { startPointerDrag } from '../pointerDrag.ts';

const props = defineProps<{
  axis: 'x' | 'y';
  /** Stronger visible gutter (e.g. 开发 / 设计 zone split). */
  emphasis?: boolean;
}>();

const emit = defineEmits<{
  /** Delta from drag start (px). */
  drag: [dx: number, dy: number];
  end: [];
}>();

function onDown(ev: PointerEvent) {
  if (ev.button !== 0) return;
  ev.preventDefault();
  startPointerDrag(
    ev,
    (dx, dy) => emit('drag', dx, dy),
    () => emit('end'),
  );
}
</script>

<style scoped>
.splitter {
  flex-shrink: 0;
  z-index: 3;
  background: transparent;
  position: relative;
}

.splitter::after {
  content: '';
  position: absolute;
  background: transparent;
  transition: background 0.12s ease;
}

.splitter:hover::after,
.splitter:active::after {
  background: color-mix(in srgb, var(--cyan) 45%, transparent);
}

.axis-x {
  width: 5px;
  margin: 0 -2px;
  cursor: ew-resize;
  align-self: stretch;
}

.axis-x::after {
  top: 0;
  bottom: 0;
  left: 2px;
  width: 1px;
}

.axis-y {
  height: 5px;
  margin: -2px 0;
  cursor: ns-resize;
  align-self: stretch;
}

.axis-y::after {
  left: 0;
  right: 0;
  top: 2px;
  height: 1px;
}

.emphasis.axis-x {
  width: 7px;
  margin: 0;
  background: var(--color-bg-sunken, var(--side));
}

.emphasis.axis-x::after {
  left: 2px;
  width: 3px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--line) 85%, var(--cyan));
}

.emphasis.axis-x:hover::after,
.emphasis.axis-x:active::after {
  background: var(--cyan);
}

.emphasis.axis-y {
  height: 7px;
  margin: 0;
  background: var(--color-bg-sunken, var(--side));
}

.emphasis.axis-y::after {
  top: 2px;
  height: 3px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--line) 85%, var(--cyan));
}

.emphasis.axis-y:hover::after,
.emphasis.axis-y:active::after {
  background: var(--cyan);
}
</style>
