<template>
  <section class="diff-pane">
    <div class="head">
      <strong v-if="ctrl.data.selectedPath">{{ ctrl.data.selectedPath }}</strong>
      <strong v-else class="muted">Diff</strong>
      <span v-if="ctrl.data.selectedPath" class="hint-inline muted">
        点击行跳转到 Files 并打开源文件
      </span>
    </div>
    <div class="body">
      <div v-if="!ctrl.data.selectedPath" class="hint muted">
        从左侧选择变更查看 Diff
      </div>
      <div v-else-if="!ctrl.data.rows.length" class="hint muted">
        无文本 Diff（可能是二进制、空变更或仅模式变化）
      </div>
      <div
        v-for="(row, i) in ctrl.data.rows"
        :key="i"
        class="drow"
        :class="row.kind"
        v-tip="jumpTitle(row)"
        @click="onJump(row)"
      >
        <span class="ln">{{ lineLabel(row) }}</span>
        <span class="tx">{{ row.text }}</span>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { DifferTreeCtrl, TDiffRow } from './DifferTreeCtrl.ts';

const props = defineProps<{ ctrl: DifferTreeCtrl }>();

function lineLabel(row: TDiffRow): string {
  if (row.newLine != null) return String(row.newLine);
  if (row.oldLine != null) return String(row.oldLine);
  return '';
}

function jumpTitle(row: TDiffRow): string {
  if (row.kind === 'meta' || row.kind === 'hunk') return '';
  const line = row.newLine ?? row.oldLine;
  return line != null ? `跳转到第 ${line} 行` : '打开文件';
}

function onJump(row: TDiffRow) {
  if (row.kind === 'meta' || row.kind === 'hunk') return;
  void props.ctrl.jump(row);
}
</script>

<style scoped>
.diff-pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.head {
  display: flex;
  align-items: center;
  gap: 10px;
  height: var(--tab-h);
  padding: 0 12px;
  border-bottom: 1px solid var(--line);
  background: var(--side);
  font-size: 12px;
  flex-shrink: 0;
}

.head strong {
  color: var(--cyan);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hint-inline {
  font-size: 11px;
  flex-shrink: 0;
}

.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.5;
}

.drow {
  display: grid;
  grid-template-columns: 48px 1fr;
  cursor: pointer;
  white-space: pre;
}

.drow:hover:not(.meta):not(.hunk) {
  filter: brightness(1.15);
}

.drow.add {
  background: var(--diff-add);
}

.drow.add .tx {
  color: var(--color-success);
}

.drow.del {
  background: var(--diff-del);
}

.drow.del .tx {
  color: var(--color-fg-danger);
}

.drow.hunk {
  background: var(--diff-hunk);
  color: var(--cyan);
  cursor: default;
}

.drow.meta {
  color: var(--muted);
  cursor: default;
}

.ln {
  text-align: right;
  padding-right: 10px;
  color: var(--muted);
  user-select: none;
}

.tx {
  padding-right: 12px;
}

.hint {
  padding: 16px 12px;
  font-size: 12px;
}

.muted {
  color: var(--muted);
}
</style>
