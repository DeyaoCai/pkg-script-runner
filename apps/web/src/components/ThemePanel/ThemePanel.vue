<template>
  <div
    id="themePanel"
    ref="panelRef"
    class="theme-panel"
    role="dialog"
    aria-labelledby="themePanelTitle"
  >
    <div class="theme-panel-head">
      <strong id="themePanelTitle">主题设置</strong>
      <button
        type="button"
        class="theme-panel-close"
        title="关闭"
        aria-label="关闭"
        @click="emit('close')"
      >
        ×
      </button>
    </div>
    <div class="theme-panel-body">
      <div class="font-field">
        <span>外观</span>
        <div class="theme-seg" role="group" aria-label="外观">
          <button
            type="button"
            class="theme-seg-btn"
            :class="{ 'is-active': app.data.theme === 'dark' }"
            @click="ctrl.setTheme('dark')"
          >
            暗色
          </button>
          <button
            type="button"
            class="theme-seg-btn"
            :class="{ 'is-active': app.data.theme === 'light' }"
            @click="ctrl.setTheme('light')"
          >
            浅色
          </button>
        </div>
      </div>
      <div class="font-field glass-field">
        <span>面板透明度 <em>{{ app.data.glassAlpha }}%</em></span>
        <input
          class="glass-range"
          type="range"
          min="10"
          max="100"
          step="1"
          :value="app.data.glassAlpha"
          title="应用内面板叠色不透明度"
          @input="ctrl.onAlpha($event)"
        />
      </div>
      <div class="font-field glass-field">
        <span>模糊强度 <em>{{ app.data.glassBlur }}px</em></span>
        <input
          class="glass-range"
          type="range"
          min="0"
          max="40"
          step="1"
          :value="app.data.glassBlur"
          title="backdrop-filter 模糊半径"
          @input="ctrl.onBlur($event)"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { inject, onMounted, onUnmounted, ref, watch } from 'vue';
import { APP_CTRL_KEY } from '../../appContext';

const props = defineProps<{
  anchorEl: HTMLElement | null;
}>();
const emit = defineEmits<{ close: [] }>();

const app = inject(APP_CTRL_KEY)!;
const ctrl = app.controllers.theme;
const panelRef = ref<HTMLElement | null>(null);

ctrl.setAnchor(props.anchorEl);

onMounted(async () => {
  if (panelRef.value) await ctrl.mountPanel(panelRef.value, () => emit('close'));
});

onUnmounted(() => ctrl.dispose());

watch(
  () => props.anchorEl,
  (el) => ctrl.setAnchor(el),
);

watch(
  () => [app.data.theme, app.data.glassAlpha, app.data.glassBlur],
  () => {
    void ctrl.reposition();
  },
);
</script>

<style lang="less" scoped></style>
