<template>
  <div class="md-preview-body">
    <div v-if="error && !isBinary" class="err">{{ error }}</div>
    <div v-else-if="isBinary" class="unsupported">
      <p class="title">无法预览此文件</p>
      <p class="muted path" v-tip="relPath || ''">{{ fileName || relPath }}</p>
      <div class="actions">
        <button type="button" class="open-btn" @click="emit('openSystem')">
          使用已安装的软件打开
        </button>
        <button type="button" class="sec-btn" @click="emit('reveal')">
          在资源管理器中显示
        </button>
      </div>
    </div>
    <div v-else-if="!relPath" class="empty muted">{{ emptyHint }}</div>
    <div v-else class="prose" v-html="html" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { renderMarkdown } from '../../renderMd.ts';

const props = withDefaults(
  defineProps<{
    relPath: string | null;
    content: string;
    error?: string;
    emptyHint?: string;
    isBinary?: boolean;
    fileName?: string;
  }>(),
  {
    error: '',
    emptyHint: '从右侧目录打开文档（只读预览）',
    isBinary: false,
    fileName: '',
  },
);

const emit = defineEmits<{
  openSystem: [];
  reveal: [];
}>();

const html = computed(() => renderMarkdown(props.content).html);
</script>

<style scoped>
.md-preview-body {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  position: relative;
}

.empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  font-size: 12px;
}

.err {
  margin: 0;
  padding: 12px;
  font-size: 12px;
  color: var(--bad);
}

.unsupported {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  text-align: center;
}

.unsupported .title {
  margin: 0;
  font-size: 14px;
  color: var(--text);
}

.unsupported .path {
  margin: 0;
  font-size: 12px;
  max-width: min(480px, 80%);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.unsupported .actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin-top: 6px;
}

.open-btn,
.sec-btn {
  border: 1px solid var(--line);
  background: transparent;
  color: var(--text);
  border-radius: 4px;
  padding: 6px 14px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}

.open-btn {
  border-color: var(--cyan);
  color: var(--cyan);
  background: var(--color-accent-soft);
}

.open-btn:hover,
.sec-btn:hover {
  border-color: var(--cyan);
  color: var(--cyan);
}

.prose {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px 20px 32px;
  line-height: 1.65;
  color: var(--text);
}

.prose :deep(h1),
.prose :deep(h2),
.prose :deep(h3),
.prose :deep(h4) {
  color: var(--text);
  margin: 1.2em 0 0.5em;
  line-height: 1.3;
}

.prose :deep(h1) {
  font-size: 1.6em;
  border-bottom: 1px solid var(--line);
  padding-bottom: 0.3em;
}

.prose :deep(h2) {
  font-size: 1.35em;
}

.prose :deep(p) {
  margin: 0.7em 0;
}

.prose :deep(a) {
  color: var(--cyan);
}

.prose :deep(code) {
  font-family: var(--mono);
  font-size: 0.92em;
  background: var(--color-accent-soft);
  padding: 0.1em 0.35em;
  border-radius: 4px;
}

.prose :deep(pre) {
  background: var(--side);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 12px 14px;
  overflow: auto;
}

.prose :deep(pre code) {
  background: transparent;
  padding: 0;
}

.prose :deep(blockquote) {
  margin: 0.8em 0;
  padding: 0.2em 0 0.2em 12px;
  border-left: 3px solid var(--cyan);
  color: var(--muted);
}

.prose :deep(ul),
.prose :deep(ol) {
  padding-left: 1.4em;
}

.prose :deep(hr) {
  border: none;
  border-top: 1px solid var(--line);
  margin: 1.4em 0;
}

.prose :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
}

.prose :deep(th),
.prose :deep(td) {
  border: 1px solid var(--line);
  padding: 6px 10px;
}

.prose :deep(th) {
  background: var(--side);
}

.prose :deep(img) {
  max-width: 100%;
  height: auto;
}

.muted {
  color: var(--muted);
}
</style>
