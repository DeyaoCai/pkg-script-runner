<template>
  <div class="pkg-win no-drag">
    <button
      type="button"
      class="pkg-win-btn"
      v-tip="'最小化'"
      @click="onMinimize"
    >
      ─
    </button>
    <button
      type="button"
      class="pkg-win-btn"
      v-tip="maximized ? '还原' : '最大化'"
      @click="onMaximize"
    >
      {{ maximized ? '❐' : '□' }}
    </button>
    <button
      type="button"
      class="pkg-win-btn close"
      v-tip="'关闭'"
      @click="onClose"
    >
      ×
    </button>
  </div>
</template>

<script setup lang="ts">
import type { TWindowBridge } from '../windowBridge.ts';

const props = defineProps<{
  bridge: TWindowBridge;
  maximized: boolean;
}>();

const emit = defineEmits<{
  'update:maximized': [value: boolean];
}>();

async function onMinimize(): Promise<void> {
  await props.bridge.windowMinimize();
}

async function onMaximize(): Promise<void> {
  const v = await props.bridge.windowMaximize();
  if (typeof v === 'boolean') emit('update:maximized', v);
}

async function onClose(): Promise<void> {
  await props.bridge.windowClose();
}
</script>
