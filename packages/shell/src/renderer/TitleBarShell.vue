<template>
  <header class="titlebar titlebar-shell" aria-label="窗口标题栏">
    <div class="titlebar-brand titlebar-drag">
      <img
        v-if="markSrc"
        class="mark"
        :src="markSrc"
        width="28"
        height="28"
        alt=""
        draggable="false"
      />
      <div class="brand-text">
        <strong>{{ ctrl.data.productName }}</strong>
        <span v-if="showSubtitle" class="sub">{{ ctrl.data.subtitle }}</span>
      </div>
      <span v-if="ctrl.showEnvBadge" class="env-badge" title="测试色板">测试</span>
    </div>

    <div class="titlebar-main">
      <div v-if="$slots.leading" class="titlebar-leading">
        <slot name="leading" />
      </div>
      <div class="titlebar-meta-slot">
        <slot />
      </div>
    </div>

    <div class="titlebar-actions">
      <slot name="actions" />
      <WindowControls
        v-if="ctrl.windowBridge"
        :bridge="ctrl.windowBridge"
        :maximized="ctrl.data.maximized"
        @update:maximized="ctrl.setMaximized($event)"
      />
    </div>
  </header>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import defaultLogoUrl from '@pkg-runner/assets/media/logo.png';
import WindowControls from './WindowControls.vue';
import type { TitleBarShellCtrl, TitleBarShellData } from './TitleBarShellCtrl';

const props = defineProps<{
  ctrl: TitleBarShellCtrl<TitleBarShellData, object, object>;
}>();

/** null / undefined → shared brand logo; "" → hide mark */
const markSrc = computed(() => {
  const custom = props.ctrl.data.logoUrl;
  if (custom === '') return null;
  if (typeof custom === 'string' && custom.length > 0) return custom;
  return defaultLogoUrl;
});

/** Hide subtitle when it only duplicates the env badge (e.g. both "测试"). */
const showSubtitle = computed(() => {
  const sub = props.ctrl.data.subtitle?.trim();
  if (!sub) return false;
  if (props.ctrl.showEnvBadge && (sub === '测试' || sub.toLowerCase() === 'test')) {
    return false;
  }
  return true;
});
</script>
