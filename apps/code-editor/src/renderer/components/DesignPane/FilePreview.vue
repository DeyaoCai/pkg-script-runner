<template>
  <div class="file-preview">
    <div v-if="error && !isBinary" class="err">{{ error }}</div>
    <div v-else-if="isBinary" class="unsupported">
      <p class="title">无法在编辑器中预览此文件</p>
      <p class="muted path" v-tip="relPath || ''">
        {{ fileName || relPath }}
        <span v-if="fileSize"> · {{ formatSize(fileSize) }}</span>
      </p>
      <div class="actions">
        <button
          type="button"
          class="open-btn"
          v-tip="'使用系统已关联的软件打开'"
          @click="emit('openSystem')"
        >
          使用已安装的软件打开
        </button>
        <button
          type="button"
          class="sec-btn"
          v-tip="'在文件浏览器中显示'"
          @click="emit('reveal')"
        >
          在资源管理器中显示
        </button>
      </div>
    </div>
    <div v-show="showEditor" ref="host" class="cm-host" />
    <div v-if="!relPath && !error" class="empty muted">{{ emptyHint }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { createEditor, type TCmHandle } from '../../cmFactory.ts';

const props = withDefaults(
  defineProps<{
    relPath: string | null;
    content: string;
    rev?: number;
    error?: string;
    emptyHint?: string;
    readOnly?: boolean;
    isBinary?: boolean;
    fileName?: string;
    fileSize?: number;
  }>(),
  {
    rev: -1,
    error: '',
    emptyHint: '未打开文件',
    readOnly: false,
    isBinary: false,
    fileName: '',
    fileSize: 0,
  },
);

const emit = defineEmits<{
  change: [text: string];
  save: [];
  blur: [];
  openSystem: [];
  reveal: [];
}>();

const host = ref<HTMLElement | null>(null);
let cm: TCmHandle | null = null;
let boundPath: string | null = null;
let boundRev = -1;

const showEditor = computed(
  () => !!props.relPath && !props.isBinary && !props.error,
);

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function ensureEditor() {
  if (!host.value || cm || !showEditor.value) return;
  cm = createEditor(host.value, {
    doc: props.content,
    relPath: props.relPath ?? 'untitled.txt',
    readOnly: props.readOnly,
    onChange(text) {
      emit('change', text);
    },
    onSave() {
      emit('save');
    },
    onBlur() {
      emit('blur');
    },
  });
  boundPath = props.relPath;
  boundRev = props.rev;
}

function syncDoc() {
  if (!showEditor.value) {
    if (cm) {
      cm.setDoc('', 'untitled.txt');
      boundPath = null;
      boundRev = -1;
    }
    return;
  }
  ensureEditor();
  if (!cm) return;
  const pathChanged = boundPath !== props.relPath || boundRev !== props.rev;
  const previewStale =
    props.readOnly && cm.getDoc() !== props.content;
  if (pathChanged || previewStale) {
    cm.setDoc(props.content, props.relPath ?? 'untitled.txt');
    boundPath = props.relPath;
    boundRev = props.rev;
  }
}

function gotoLine(line: number) {
  cm?.gotoLine(line);
}

defineExpose({ gotoLine });

watch(
  () =>
    [
      props.relPath,
      props.content,
      props.rev,
      props.isBinary,
      props.error,
      props.readOnly,
    ] as const,
  () => {
    void nextTick(() => syncDoc());
  },
);

onMounted(() => {
  syncDoc();
});

onBeforeUnmount(() => {
  cm?.destroy();
  cm = null;
});
</script>

<style scoped>
.file-preview {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  position: relative;
  background: var(--bg);
}

.cm-host {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

.cm-host :deep(.cm-editor) {
  height: 100%;
  max-height: 100%;
}

.cm-host :deep(.cm-scroller) {
  overflow: auto;
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

.muted {
  color: var(--muted);
}
</style>
