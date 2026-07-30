<template>
  <header class="titlebar" aria-label="窗口标题栏">
    <div class="titlebar-brand titlebar-drag">
      <span class="mark">PR</span>
      <div class="brand-text">
        <strong>Pkg Runner</strong>
        <span class="sub">scripts · tray</span>
      </div>
    </div>
    <div class="titlebar-mid titlebar-drag">
      <div class="meta" :class="{ error: app.data.metaError }">{{ app.data.meta }}</div>
    </div>
    <div class="titlebar-actions">
      <button type="button" class="win-btn" title="最小化" aria-label="最小化" @click="ctrl.minimize()">
        <span class="ico ico-min"></span>
      </button>
      <button type="button" class="win-btn" title="最大化" aria-label="最大化" @click="ctrl.maximize()">
        <span :class="ctrl.maxIconClass"></span>
      </button>
      <button
        type="button"
        class="win-btn close"
        title="关闭到托盘"
        aria-label="关闭"
        @click="ctrl.closeWin()"
      >
        <span class="ico ico-close"></span>
      </button>
    </div>
  </header>
</template>

<script lang="ts" setup>
import { inject } from 'vue';
import { APP_CTRL_KEY } from '../../appContext';

const app = inject(APP_CTRL_KEY)!;
const ctrl = app.controllers.titleBar;
</script>

<style lang="less" scoped></style>
