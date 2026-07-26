<template>
  <div class="design-workspace">
    <!-- 12. Docs 区 = 14 MD 分屏 / 文件预览 + 13 MD 目录（仓库栏在 Shell 顶行） -->
    <div class="preview-zone">
      <div class="md-preview" :style="{ minWidth: 0 }">
        <!-- 与 Review EditorTabs 同构：文件名标签，不要 “MD 预览” 区标题 -->
        <div class="tabs">
          <button
            v-if="ctrl.data.designDocPath"
            type="button"
            class="tab active"
            :class="{ dirty: isDirty }"
            v-tip="ctrl.data.designDocPath"
          >
            <span
              >{{ docName }}{{ isDirty ? ' •' : '' }}</span
            >
            <span class="x" v-tip="'关闭'" @click.stop="ctrl.closeDesignDoc()"
              >×</span
            >
          </button>
          <div v-else class="empty-tabs muted">未打开文件</div>
          <div class="tab-actions">
            <button
              v-if="useMdSplit && ctrl.controllers.md.data.relPath"
              type="button"
              class="act"
              :disabled="!isDirty"
              v-tip="'保存 (Ctrl+S)'"
              @click="ctrl.saveDesignDoc()"
            >
              {{ isDirty ? '保存' : '已保存' }}
            </button>
            <div
              v-if="useMdSplit"
              class="mode-switch"
              role="group"
              aria-label="MD 视图模式"
            >
              <button
                v-for="m in mdModes"
                :key="m.id"
                type="button"
                class="mode-btn"
                :class="{ active: ctrl.state.mdViewMode === m.id }"
                v-tip="m.tip"
                @click="ctrl.setMdViewMode(m.id)"
              >
                {{ m.label }}
              </button>
            </div>
          </div>
        </div>
        <MdSplit
          v-if="useMdSplit"
          :ctrl="ctrl.controllers.md"
          :mode="ctrl.state.mdViewMode"
          :source-pct="ctrl.state.layout.mdSourcePct"
          :outline-width="ctrl.state.layout.outlineWidth"
          @patch-layout="ctrl.patchLayout($event)"
        />
        <FilePreview
          v-else
          :rel-path="ctrl.data.designDocPath"
          :content="ctrl.data.designDocText"
          :error="ctrl.data.designDocError"
          :is-binary="ctrl.data.designDocBinary"
          :file-name="docName"
          read-only
          empty-hint="从右侧目录打开文档"
          @open-system="ctrl.openDesignWithSystem()"
          @reveal="onReveal"
        />
      </div>
      <Splitter
        v-show="ctrl.state.layout.docsOpen"
        axis="x"
        @drag="docsTreeDrag.onDrag"
        @end="docsTreeDrag.onEnd"
      />
      <aside
        v-show="ctrl.state.layout.docsOpen"
        class="docs-tree"
        :style="{ width: `${ctrl.state.layout.docsTreeWidth}px` }"
      >
        <FileTree :ctrl="ctrl.controllers.docs" />
      </aside>
    </div>

    <Splitter
      v-if="ctrl.state.agentsOpen"
      axis="y"
      @drag="agentDrag.onDrag"
      @end="agentDrag.onEnd"
    />

    <!-- 15. Agent -->
    <div
      v-show="ctrl.state.agentsOpen"
      class="agents"
      :style="{ height: `${ctrl.state.layout.agentHeight}px` }"
    >
      <div class="sec-head">
        <span>Agent 列表</span>
        <button
          type="button"
          class="hide"
          v-tip="'隐藏'"
          @click="ctrl.toggleAgents()"
        >
          ▾
        </button>
      </div>
      <p class="hint muted">运行中的 Agent / 任务将列在这里</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { CodeEditorShellCtrl, TMdViewMode } from '../../CodeEditorShell/CodeEditorShellCtrl.ts';
import { isMarkdownPath } from '../../renderMd.ts';
import { makeDrag } from '../../pointerDrag.ts';
import FileTree from '../FileTree/FileTree.vue';
import FilePreview from './FilePreview.vue';
import MdSplit from '../MdSplit/MdSplit.vue';
import Splitter from '../Splitter.vue';

const props = defineProps<{ ctrl: CodeEditorShellCtrl }>();

/** Docs tree is on the right — drag left grows tree. */
const docsTreeDrag = makeDrag(
  () => props.ctrl.state.layout.docsTreeWidth,
  (base, dx) => props.ctrl.patchLayout({ docsTreeWidth: base - dx }),
);

/** Agent is bottom — drag up grows height. */
const agentDrag = makeDrag(
  () => props.ctrl.state.layout.agentHeight,
  (base, _dx, dy) => props.ctrl.patchLayout({ agentHeight: base - dy }),
);

const mdModes: { id: TMdViewMode; label: string; tip: string }[] = [
  { id: 'source', label: '源码', tip: '仅编辑源码' },
  { id: 'split', label: '分屏', tip: '左编辑右预览' },
  { id: 'preview', label: '预览', tip: '仅渲染预览' },
];

const docName = computed(() => {
  const p = props.ctrl.data.designDocPath;
  if (!p) return '';
  const parts = p.split('/');
  return parts[parts.length - 1] || p;
});

const isDirty = computed(() => props.ctrl.controllers.md.data.dirty);

/** Empty or .md → MD view (source / split / preview). */
const useMdSplit = computed(() => {
  const p = props.ctrl.data.designDocPath;
  if (!p) return true;
  if (props.ctrl.data.designDocBinary || props.ctrl.data.designDocError) {
    return false;
  }
  return isMarkdownPath(p);
});

function onReveal() {
  const p = props.ctrl.data.designDocPath;
  if (p) void props.ctrl.revealDesignPath(p);
}
</script>

<style scoped>
.design-workspace {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
}

.preview-zone {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.md-preview {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  overflow: hidden;
}

.tabs {
  display: flex;
  align-items: stretch;
  height: var(--tab-h);
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  overflow-x: auto;
  flex-shrink: 0;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  border: none;
  border-right: 1px solid var(--line);
  background: var(--bg);
  color: var(--text);
  padding: 0 10px;
  cursor: default;
  font-family: inherit;
  font-size: 12px;
  white-space: nowrap;
  box-shadow: inset 0 -2px 0 var(--cyan);
}

.tab.dirty {
  font-style: italic;
}

.tab .x {
  opacity: 0.5;
  padding: 0 2px;
  cursor: pointer;
}

.tab .x:hover {
  opacity: 1;
  color: var(--bad);
}

.empty-tabs {
  padding: 0 12px;
  display: flex;
  align-items: center;
  font-size: 12px;
}

.tab-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  flex-shrink: 0;
  position: sticky;
  right: 0;
  background: var(--panel);
  border-left: 1px solid var(--line);
}

.act {
  border: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
}

.act:hover:not(:disabled) {
  color: var(--cyan);
  border-color: var(--cyan);
}

.act:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.mode-switch {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  border: 1px solid var(--line);
  border-radius: 4px;
  overflow: hidden;
}

.mode-btn {
  border: none;
  border-right: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  padding: 2px 8px;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
}

.mode-btn:last-child {
  border-right: none;
}

.mode-btn:hover {
  color: var(--cyan);
}

.mode-btn.active {
  color: var(--cyan);
  background: var(--color-accent-soft);
}

.docs-tree {
  flex-shrink: 0;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--side);
}

.docs-tree :deep(.tree) {
  border-left: none;
}

.agents {
  flex-shrink: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--line);
  background: var(--panel);
  overflow: hidden;
}

.sec-head {
  height: 28px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--muted);
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
  min-width: 0;
}

.hide {
  border: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  border-radius: 4px;
  padding: 0 6px;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
}

.hide:hover {
  color: var(--cyan);
  border-color: var(--cyan);
}

.hint {
  margin: 0;
  padding: 16px 12px;
  font-size: 12px;
}

.muted {
  color: var(--muted);
  font-size: 11px;
}
</style>
