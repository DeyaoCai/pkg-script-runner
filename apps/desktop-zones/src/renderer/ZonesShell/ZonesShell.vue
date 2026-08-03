<template>
  <div class="app-shell">
    <TitleBarShell :ctrl="ctrl">
      <TitleBarMeta :text="ctrl.data.meta" :title="ctrl.data.meta" />
      <template #actions>
        <TitleBarAction :disabled="ctrl.state.busy" @click="ctrl.onRefresh()">刷新</TitleBarAction>
        <TitleBarAction :disabled="ctrl.state.busy" @click="ctrl.onPreview()">预览整理</TitleBarAction>
        <TitleBarAction
          accent
          :disabled="!ctrl.data.applyEnabled || ctrl.state.busy"
          @click="ctrl.onApply()"
        >
          执行整理
        </TitleBarAction>
        <TitleBarAction
          :disabled="!ctrl.data.undoEnabled || ctrl.state.busy"
          @click="ctrl.onUndo()"
        >
          撤销
        </TitleBarAction>
        <TitleBarAction @click="ctrl.onOpenDesktop()">打开桌面</TitleBarAction>
      </template>
    </TitleBarShell>

    <p v-if="ctrl.data.banner" class="banner" :class="{ warn: ctrl.data.bannerWarn }">
      {{ ctrl.data.banner }}
    </p>

    <div class="zones" :class="{ 'has-banner': !!ctrl.data.banner }">
      <section v-for="z in ctrl.data.zones" :key="z.id" class="zone">
        <header class="zone-head">
          <span class="zone-title">{{ z.title }}</span>
          <span class="zone-count">{{ z.files.length }}</span>
        </header>
        <ul class="zone-list">
          <li v-if="!z.files.length" class="empty">空</li>
          <li
            v-for="f in z.files"
            :key="f.path"
            class="file"
            :title="f.path"
            @dblclick="ctrl.onOpenFile(f)"
            @contextmenu.prevent.stop="ctrl.showCtx($event.clientX, $event.clientY, f)"
          >
            <span class="file-badge">{{ f.isDir ? 'DIR' : f.ext || '·' }}</span>
            <span class="file-name">{{ f.name }}</span>
          </li>
        </ul>
      </section>
    </div>

    <div
      v-if="ctrl.state.ctx"
      class="ctx"
      :style="{ left: `${ctrl.state.ctx.x}px`, top: `${ctrl.state.ctx.y}px` }"
      @click.stop
    >
      <button type="button" @click="ctrl.onCtxAction('open')">打开</button>
      <button type="button" @click="ctrl.onCtxAction('reveal')">在资源管理器中显示</button>
      <button type="button" @click="ctrl.onCtxAction('rename')">重命名</button>
      <button type="button" class="danger" @click="ctrl.onCtxAction('trash')">删除到回收站</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import TitleBarShell from '@pkg-runner/shell/renderer/TitleBarShell.vue';
import TitleBarMeta from '@pkg-runner/shell/renderer/TitleBarMeta.vue';
import TitleBarAction from '@pkg-runner/shell/renderer/TitleBarAction.vue';
import type { ZonesShellCtrl } from './ZonesShellCtrl';

const props = defineProps<{
  ctrl: ZonesShellCtrl;
}>();

function onDocClick(): void {
  props.ctrl.hideCtx();
}

onMounted(() => {
  props.ctrl.mount();
  document.addEventListener('click', onDocClick);
});

onUnmounted(() => {
  props.ctrl.unmount();
  document.removeEventListener('click', onDocClick);
});
</script>

<style scoped>
.banner {
  margin: 0;
  padding: 10px 14px;
  font-size: 13px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
  color: var(--text);
}

.banner.warn {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  border-bottom-color: color-mix(in srgb, var(--danger) 35%, transparent);
}

.zones {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 14px;
  padding: 14px 16px 16px;
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.zone {
  display: flex;
  flex-direction: column;
  min-height: 180px;
  max-height: 52vh;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--panel);
  overflow: hidden;
}

.zone-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
}

.zone-title {
  font-size: 13px;
  font-weight: 650;
}

.zone-count {
  font-size: 11px;
  color: var(--muted);
}

.zone-list {
  list-style: none;
  margin: 0;
  padding: 6px;
  overflow: auto;
  flex: 1;
}

.file {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 8px;
  cursor: pointer;
}

.file:hover {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.file-badge {
  flex: 0 0 auto;
  min-width: 42px;
  text-align: center;
  font-size: 10px;
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
  border-radius: 999px;
  padding: 2px 6px;
}

.file-name {
  flex: 1;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty {
  padding: 18px 12px;
  color: var(--muted);
  font-size: 12px;
}

.ctx {
  position: fixed;
  z-index: 50;
  min-width: 160px;
  padding: 6px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--panel);
  box-shadow: 0 12px 32px color-mix(in srgb, var(--shadow, #000) 45%, transparent);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ctx button {
  font: inherit;
  text-align: left;
  border: 0;
  background: transparent;
  border-radius: 6px;
  padding: 8px 10px;
  color: var(--text);
  cursor: pointer;
}

.ctx button:hover {
  background: color-mix(in srgb, var(--text) 8%, transparent);
}

.ctx button.danger {
  color: var(--danger);
}
</style>
