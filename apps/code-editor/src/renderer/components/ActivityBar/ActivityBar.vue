<template>
  <nav class="bar" aria-label="开发工具">
    <button
      type="button"
      class="tab"
      :class="{
        active:
          ctrl.state.leftTool === 'files' && ctrl.state.layout.reviewSidebarOpen,
      }"
      v-tip="
        ctrl.state.leftTool === 'files' && ctrl.state.layout.reviewSidebarOpen
          ? '隐藏文件目录'
          : '文件目录'
      "
      @click="ctrl.setLeftTool('files')"
    >
      <span class="icon" aria-hidden="true">☰</span>
      <span class="label">Files</span>
    </button>
    <button
      type="button"
      class="tab"
      :class="{
        active:
          ctrl.state.leftTool === 'differ' && ctrl.state.layout.reviewSidebarOpen,
      }"
      v-tip="
        ctrl.state.leftTool === 'differ' && ctrl.state.layout.reviewSidebarOpen
          ? '隐藏 Git Differ'
          : 'Git Differ'
      "
      @click="ctrl.setLeftTool('differ')"
    >
      <span class="icon" aria-hidden="true">≉</span>
      <span class="label">Differ</span>
      <span v-if="changeCount > 0" class="badge">{{ badgeText }}</span>
    </button>
    <button
      type="button"
      class="tab shell-tab"
      :class="{ active: ctrl.controllers.term.state.open }"
      v-tip="ctrl.controllers.term.state.open ? '隐藏终端 (Shell)' : '打开终端 (Shell)'"
      @click="ctrl.controllers.term.toggle()"
    >
      <span class="icon" aria-hidden="true">&gt;_</span>
      <span class="label">Shell</span>
    </button>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { CodeEditorShellCtrl } from '../../CodeEditorShell/CodeEditorShellCtrl.ts';

const props = defineProps<{ ctrl: CodeEditorShellCtrl }>();

const changeCount = computed(() => props.ctrl.data.gitChanges.length);
const badgeText = computed(() =>
  changeCount.value > 99 ? '99+' : String(changeCount.value),
);
</script>

<style scoped>
.bar {
  width: var(--activity-w);
  align-self: stretch;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
  padding: 4px 0;
  background: var(--color-bg-sunken, var(--bg));
  border-right: 1px solid var(--line);
  min-height: 0;
}

.tab {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  border: none;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  padding: 8px 2px;
  font-family: inherit;
  font-size: 9px;
  line-height: 1.15;
}

.tab:hover {
  color: var(--text);
  background: var(--color-accent-soft);
}

.tab.active {
  color: var(--cyan);
  box-shadow: inset 2px 0 0 var(--cyan);
  background: var(--color-accent-soft);
}

.shell-tab {
  margin-top: auto;
  margin-bottom: 4px;
}

.icon {
  font-size: 15px;
  line-height: 1;
}

.label {
  letter-spacing: 0.01em;
  text-align: center;
  max-width: 100%;
  word-break: break-word;
}

.badge {
  position: absolute;
  top: 4px;
  right: 1px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 7px;
  background: var(--cyan);
  color: var(--bg);
  font-size: 9px;
  line-height: 14px;
  font-weight: 700;
}
</style>
