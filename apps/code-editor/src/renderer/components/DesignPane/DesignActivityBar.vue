<template>
  <!-- 11. 面板区（最右侧）—— 仅 Docs + Agent -->
  <nav class="bar" aria-label="设计工具">
    <button
      type="button"
      class="tab"
      :class="{ active: ctrl.state.layout.docsOpen }"
      v-tip="ctrl.state.layout.docsOpen ? '隐藏文档目录' : '显示文档目录'"
      @click="ctrl.toggleDocs()"
    >
      <span class="icon" aria-hidden="true">¶</span>
      <span class="label">Docs</span>
    </button>
    <button
      type="button"
      class="tab agents-tab"
      :class="{ active: ctrl.state.agentsOpen }"
      v-tip="ctrl.state.agentsOpen ? '隐藏 Agent 列表' : '显示 Agent 列表'"
      @click="ctrl.toggleAgents()"
    >
      <span class="icon" aria-hidden="true">◉</span>
      <span class="label">Agent</span>
    </button>
  </nav>
</template>

<script setup lang="ts">
import type { CodeEditorShellCtrl } from '../../CodeEditorShell/CodeEditorShellCtrl.ts';

defineProps<{ ctrl: CodeEditorShellCtrl }>();
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
  border-left: 1px solid var(--line);
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
  box-shadow: inset -2px 0 0 var(--cyan);
  background: var(--color-accent-soft);
}

.agents-tab {
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
</style>
