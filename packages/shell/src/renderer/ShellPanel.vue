<template>
  <Teleport to="body" :disabled="!teleported">
    <div
      v-if="open"
      ref="panelEl"
      class="ui-panel glass-surface"
      :class="teleported ? 'ui-panel--anchored' : 'ui-panel--dropdown'"
      :style="panelStyle"
      role="dialog"
      @keydown.escape.stop.prevent="emit('close')"
    >
      <div v-if="$slots.head" class="ui-panel-head">
        <slot name="head" />
      </div>
      <div class="ui-panel-body">
        <slot />
      </div>
    </div>
  </Teleport>
</template>

<script lang="ts" setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    /** Anchor element for teleported placement (ignored when teleported=false). */
    anchor?: HTMLElement | null;
    /** Extra roots that should not trigger outside-close (e.g. trigger cluster). */
    ignore?: HTMLElement | null | Array<HTMLElement | null | undefined>;
    /** true = fixed + Teleport to body; false = absolute under parent. */
    teleported?: boolean;
    width?: number | 'auto';
    minWidth?: number;
    maxWidth?: number;
    offset?: number;
    zIndex?: number;
    maxHeight?: string;
  }>(),
  {
    anchor: null,
    ignore: undefined,
    teleported: true,
    width: 'auto',
    minWidth: 280,
    maxWidth: 420,
    offset: 6,
    zIndex: 300,
    maxHeight: 'min(420px, 60vh)',
  },
);

const emit = defineEmits<{
  close: [];
}>();

const panelEl = ref<HTMLElement | null>(null);
const placed = ref<Record<string, string>>({});

const panelStyle = computed(() => {
  const base: Record<string, string> = {
    maxHeight: props.maxHeight,
  };
  if (!props.teleported) {
    if (typeof props.width === 'number') base.width = `${props.width}px`;
    return base;
  }
  return { ...base, ...placed.value, zIndex: String(props.zIndex) };
});

function ignoreList(): HTMLElement[] {
  const raw = props.ignore;
  if (!raw) return [];
  return (Array.isArray(raw) ? raw : [raw]).filter((el): el is HTMLElement => !!el);
}

function place(): void {
  if (!props.open || !props.teleported) return;
  const btn = props.anchor;
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  let width: number;
  if (typeof props.width === 'number') {
    width = props.width;
  } else {
    width = Math.max(props.minWidth, Math.min(props.maxWidth, r.width + 120));
  }
  let left = r.left;
  if (left + width > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - width - 8);
  }
  placed.value = {
    position: 'fixed',
    top: `${Math.round(r.bottom + props.offset)}px`,
    left: `${Math.round(left)}px`,
    width: `${Math.round(width)}px`,
  };
}

function onDocPointer(ev: PointerEvent): void {
  if (!props.open) return;
  const t = ev.target;
  if (!(t instanceof Node)) return;
  if (panelEl.value?.contains(t)) return;
  if (props.anchor?.contains(t)) return;
  for (const el of ignoreList()) {
    if (el.contains(t)) return;
  }
  emit('close');
}

watch(
  () => [props.open, props.anchor, props.width] as const,
  async ([open]) => {
    if (!open) return;
    await nextTick();
    place();
  },
);

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointer, true);
  window.addEventListener('resize', place);
  if (props.open) place();
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer, true);
  window.removeEventListener('resize', place);
});

defineExpose({
  el: panelEl,
  place,
});
</script>
