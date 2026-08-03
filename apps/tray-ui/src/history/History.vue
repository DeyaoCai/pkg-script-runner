<template>
  <div class="toolbar">
    <button type="button" class="btn primary" @click="ctrl.startScreenshot()">新截屏</button>
    <button type="button" class="btn" @click="ctrl.openDir()">目录</button>
    <button type="button" class="btn" :disabled="!ctrl.canExport" @click="ctrl.exportMd()">
      导出 MD
    </button>
    <button type="button" class="btn" :disabled="!ctrl.canExport" @click="ctrl.exportHtml()">
      导出 HTML
    </button>
    <button type="button" class="btn danger" @click="ctrl.clear()">清空</button>
    <button type="button" class="btn" @click="ctrl.close()">关闭</button>
  </div>
  <div class="list">
    <div v-if="!ctrl.data.items.length" class="empty">暂无截屏 · 点「新截屏」或托盘「截屏」</div>
    <div
      v-for="item in ctrl.data.items"
      :key="item.id"
      class="item"
      :class="{ 'is-selected': ctrl.isSelected(item.id) }"
      @click="ctrl.toggle(item.id)"
    >
      <label @click.stop>
        <input
          type="checkbox"
          :checked="ctrl.isSelected(item.id)"
          @change="ctrl.toggle(item.id)"
        />
      </label>
      <img alt="" :src="item.thumbDataUrl || ''" />
      <div class="meta">
        <div class="time">{{ ctrl.formatTime(item.createdAt) }}</div>
        <div class="text">{{ ctrl.displayText(item) }}</div>
        <div class="actions">
          <button type="button" class="btn" @click.stop="ctrl.copy(item.id, 'both')">图文</button>
          <button type="button" class="btn" @click.stop="ctrl.copy(item.id, 'image')">图片</button>
          <button type="button" class="btn" @click.stop="ctrl.copy(item.id, 'text')">文案</button>
          <button type="button" class="btn" @click.stop="ctrl.remove(item.id)">删除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { onMounted, onUnmounted } from 'vue';
import { HistoryCtrl } from './HistoryCtrl';

const ctrl = new HistoryCtrl();

onMounted(() => ctrl.mount());
onUnmounted(() => ctrl.unmount());
</script>

<style lang="less" scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
}

.list {
  flex: 1;
  overflow: auto;
  padding: 12px 14px;
  min-height: 0;
}

.empty {
  color: var(--muted);
  padding: 24px 8px;
}

.item {
  display: flex;
  gap: 12px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg-raised, var(--color-bg-raised));
  margin-bottom: 10px;
  cursor: pointer;
}

.item.is-selected {
  border-color: var(--accent);
}

.item img {
  width: 96px;
  height: 64px;
  object-fit: cover;
  border-radius: 4px;
  background: var(--bg-base, #111);
}

.meta {
  flex: 1;
  min-width: 0;
}

.time {
  color: var(--muted);
  font-size: 12px;
}

.text {
  margin-top: 4px;
  white-space: pre-wrap;
  word-break: break-word;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
</style>
