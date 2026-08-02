<template>
  <div class="app-shell" id="appShell">
    <div class="app-atmosphere" aria-hidden="true"></div>
    <TitleBar />
    <div class="body-pad" id="bodyPad">
      <main class="main-split" id="mainSplit">
        <ScriptsPanel />
        <div
          class="split-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整脚本栏宽度"
          title="拖动调整宽度 · 双击还原"
          @pointerdown="ctrl.onScriptsResize($event)"
          @dblclick="ctrl.setScriptsWidth(176)"
        ></div>
        <LogPanel />
      </main>
    </div>
    <PortsPanel />
  </div>
</template>

<script lang="ts" setup>
import { onMounted, onUnmounted, provide } from 'vue';
import { AppCtrl } from './AppCtrl';
import { APP_CTRL_KEY } from '../appContext';
import TitleBar from '../components/TitleBar/TitleBar.vue';
import ScriptsPanel from '../components/ScriptsPanel/ScriptsPanel.vue';
import LogPanel from '../components/LogPanel/LogPanel.vue';
import PortsPanel from '../components/PortsPanel/PortsPanel.vue';

const ctrl = new AppCtrl();
provide(APP_CTRL_KEY, ctrl);

onMounted(() => ctrl.mount());
onUnmounted(() => ctrl.unmount());
</script>

<style lang="less" scoped></style>
