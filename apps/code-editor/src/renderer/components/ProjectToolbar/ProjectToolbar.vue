<template>
  <header class="toolbar">
    <div class="drag brand">Code Editor</div>
    <button
      type="button"
      class="btn ws-btn no-drag"
      :disabled="ctrl.state.busy"
      v-tip="workspaceTitle"
      @click="ctrl.onPickWorkspace()"
    >
      <span class="ws-label">{{
        ctrl.data.workspaceRoot ? '工作区' : '选择工作区'
      }}</span>
      <span v-if="ctrl.data.workspaceRoot" class="ws-path">{{
        ctrl.data.workspaceRoot
      }}</span>
    </button>
    <div class="drag filler" />
    <WindowControls
      v-if="ctrl.windowBridge"
      :bridge="ctrl.windowBridge"
      :maximized="ctrl.data.maximized"
      @update:maximized="ctrl.setMaximized($event)"
    />
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import WindowControls from '@pkg-runner/shell/renderer/WindowControls.vue';
import type { ProjectToolbarCtrl } from './ProjectToolbarCtrl.ts';

const props = defineProps<{
  ctrl: ProjectToolbarCtrl;
}>();

const workspaceTitle = computed(() => {
  const root = props.ctrl.data.workspaceRoot;
  return root ? `${root}\n点击重新选择工作区` : '选择工作区目录';
});
</script>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: var(--toolbar-h);
  padding: 0 0 0 10px;
  background: var(--side);
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
  user-select: none;
}

.brand {
  font-weight: 700;
  color: var(--cyan);
  letter-spacing: 0.02em;
  margin-right: 6px;
  padding: 8px 4px;
}

.btn {
  border: 1px solid var(--line);
  background: var(--color-accent-soft);
  color: var(--text);
  border-radius: 4px;
  padding: 4px 10px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
}

.btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.btn:not(:disabled):hover {
  border-color: var(--cyan);
}

.ws-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: min(480px, 42vw);
  min-width: 0;
}

.ws-label {
  flex-shrink: 0;
  color: var(--muted);
}

.ws-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  color: var(--text);
  direction: rtl;
  text-align: left;
}

.filler {
  flex: 1;
  min-width: 0;
  align-self: stretch;
}
</style>
