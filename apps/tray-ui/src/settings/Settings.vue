<template>
  <div class="app">
    <TitleBarShell :ctrl="ctrl">
      <TitleBarMeta>
        <template v-if="ctrl.data.settingsSubPath">
          <code :title="ctrl.data.settingsSubPath">{{ ctrl.data.settingsSubPath }}</code>
          <span class="path-meta">{{ ctrl.data.settingsSubMeta }}</span>
        </template>
        <span v-else class="path-meta">{{ ctrl.data.settingsSubMeta }}</span>
      </TitleBarMeta>
    </TitleBarShell>

    <div class="shell">
    <div class="field-card">
      <div class="field-sec">窗口</div>
      <div class="field-row wrap">
        <label class="field">唤起</label>
        <button type="button" class="btn" @click="ctrl.showRunner()">打开 Runner</button>
        <button type="button" class="btn" @click="ctrl.showEditor()">打开编辑器</button>
        <button type="button" class="btn" @click="ctrl.showZones()">打开桌面整理</button>
      </div>
      <p class="field-hint">{{ ctrl.data.appHint }}</p>
    </div>

    <div class="field-card">
      <div class="field-sec">外观</div>
      <div class="field-row">
        <label class="field">主题</label>
        <div class="seg" role="group" aria-label="主题">
          <button
            type="button"
            :class="{ 'is-active': ctrl.data.theme === 'dark' }"
            @click="ctrl.applyThemeUi('dark')"
          >
            深色
          </button>
          <button
            type="button"
            :class="{ 'is-active': ctrl.data.theme === 'light' }"
            @click="ctrl.applyThemeUi('light')"
          >
            浅色
          </button>
        </div>
      </div>
      <div class="field-row">
        <label class="field">字体</label>
        <select v-model="ctrl.data.fontId">
          <option v-for="f in ctrl.fonts" :key="f.id" :value="f.id">{{ f.label }}</option>
        </select>
      </div>
      <div class="field-row wrap">
        <label class="field" title="主色调种子：铺底由此低饱和派生；点缀用同一色的鲜明形态">
          主色调
        </label>
        <input
          type="color"
          class="brand-color"
          :value="ctrl.data.brandColor"
          title="拾色器"
          @input="ctrl.setBrandColorUi(($event.target as HTMLInputElement).value)"
        />
        <input
          type="text"
          class="brand-hex"
          maxlength="7"
          spellcheck="false"
          title="十六进制颜色"
          :value="ctrl.data.brandColor"
          @change="ctrl.setBrandColorUi(($event.target as HTMLInputElement).value)"
          @keydown.enter.prevent="ctrl.setBrandColorUi(($event.target as HTMLInputElement).value)"
        />
        <button
          type="button"
          class="btn brand-preset"
          data-brand-preset="prod"
          :class="{ 'is-active': ctrl.brandIsProd }"
          :title="ctrl.presetProd"
          @click="ctrl.setBrandColorUi(ctrl.presetProd)"
        >
          <span class="swatch" :style="{ background: ctrl.presetProd }"></span>正式
        </button>
        <button
          type="button"
          class="btn brand-preset"
          data-brand-preset="test"
          :class="{ 'is-active': ctrl.brandIsTest }"
          :title="ctrl.presetTest"
          @click="ctrl.setBrandColorUi(ctrl.presetTest)"
        >
          <span class="swatch" :style="{ background: ctrl.presetTest }"></span>测试
        </button>
      </div>
      <p class="field-hint">正式 / 测试为预设主色；自定义色会同时影响铺底与点缀。</p>
      <div class="field-row">
        <label class="field">面板不透明度</label>
        <input
          type="range"
          class="grow"
          min="10"
          max="100"
          step="1"
          :value="ctrl.data.glassAlpha"
          @input="ctrl.setGlassUi(Number(($event.target as HTMLInputElement).value), ctrl.data.glassBlur)"
        />
        <span class="alpha-val">{{ ctrl.data.glassAlpha }}%</span>
      </div>
      <div class="field-row">
        <label class="field">背景模糊</label>
        <input
          type="range"
          class="grow"
          min="0"
          max="40"
          step="1"
          :value="ctrl.data.glassBlur"
          @input="ctrl.setGlassUi(ctrl.data.glassAlpha, Number(($event.target as HTMLInputElement).value))"
        />
        <span class="alpha-val">{{ ctrl.data.glassBlur }}px</span>
      </div>
      <p class="field-hint">不透明度与模糊作用于标题栏、面板、卡片等同一套毛玻璃层。</p>
      <label class="field-check">
        <input type="checkbox" v-model="ctrl.data.alwaysOnTop" />
        <span>Runner 始终置顶</span>
      </label>
    </div>

    <div class="field-card">
      <div class="field-sec">Runner</div>
      <div class="field-row">
        <label class="field">Shell 列数</label>
        <input
          type="number"
          class="num-sm"
          min="1"
          max="4"
          step="1"
          v-model.number="ctrl.data.shellMosaicCols"
        />
      </div>
      <div class="field-row">
        <label class="field">Shell 布局</label>
        <div class="seg" role="group" aria-label="Shell 布局">
          <button
            type="button"
            :class="{ 'is-active': ctrl.data.shellLayout === 'grid' }"
            @click="ctrl.applyLayoutUi('grid')"
          >
            网格
          </button>
          <button
            type="button"
            :class="{ 'is-active': ctrl.data.shellLayout === 'single' }"
            @click="ctrl.applyLayoutUi('single')"
          >
            单页
          </button>
        </div>
      </div>
      <label class="field-check">
        <input type="checkbox" v-model="ctrl.data.persistLogs" />
        <span>脚本日志落盘</span>
      </label>
    </div>

    <div class="field-card">
      <div class="field-sec">热键</div>
      <label class="field-check">
        <input type="checkbox" v-model="ctrl.data.hotkeysEnabled" />
        <span>启用全局热键</span>
      </label>
      <p class="field-hint">窗口热键为显示/关闭切换；未设置则不绑定。默认均为空。</p>
      <div class="field-row">
        <label class="field">截屏</label>
        <button
          type="button"
          class="btn grow"
          :class="{ recording: ctrl.data.recording === 'screenshot' }"
          @click="ctrl.startRecord('screenshot')"
        >
          {{ ctrl.hotkeyLabel('screenshot') }}
        </button>
        <button type="button" class="btn" @click="ctrl.clearHotkey('screenshot')">清除</button>
      </div>
      <div class="field-row">
        <label class="field">Runner</label>
        <button
          type="button"
          class="btn grow"
          :class="{ recording: ctrl.data.recording === 'activate' }"
          @click="ctrl.startRecord('activate')"
        >
          {{ ctrl.hotkeyLabel('activate') }}
        </button>
        <button type="button" class="btn" @click="ctrl.clearHotkey('activate')">清除</button>
      </div>
      <div class="field-row">
        <label class="field">编辑器</label>
        <button
          type="button"
          class="btn grow"
          :class="{ recording: ctrl.data.recording === 'editor' }"
          @click="ctrl.startRecord('editor')"
        >
          {{ ctrl.hotkeyLabel('editor') }}
        </button>
        <button type="button" class="btn" @click="ctrl.clearHotkey('editor')">清除</button>
      </div>
      <div class="field-row">
        <label class="field">桌面整理</label>
        <button
          type="button"
          class="btn grow"
          :class="{ recording: ctrl.data.recording === 'zones' }"
          @click="ctrl.startRecord('zones')"
        >
          {{ ctrl.hotkeyLabel('zones') }}
        </button>
        <button type="button" class="btn" @click="ctrl.clearHotkey('zones')">清除</button>
      </div>
      <div class="field-row">
        <label class="field">设置</label>
        <button
          type="button"
          class="btn grow"
          :class="{ recording: ctrl.data.recording === 'settings' }"
          @click="ctrl.startRecord('settings')"
        >
          {{ ctrl.hotkeyLabel('settings') }}
        </button>
        <button type="button" class="btn" @click="ctrl.clearHotkey('settings')">清除</button>
      </div>
      <div class="field-row">
        <label class="field">截屏历史窗</label>
        <button
          type="button"
          class="btn grow"
          :class="{ recording: ctrl.data.recording === 'history' }"
          @click="ctrl.startRecord('history')"
        >
          {{ ctrl.hotkeyLabel('history') }}
        </button>
        <button type="button" class="btn" @click="ctrl.clearHotkey('history')">清除</button>
      </div>
      <div class="field-row">
        <label class="field">历史条数</label>
        <input
          type="number"
          class="num-sm"
          min="1"
          max="100"
          v-model.number="ctrl.data.historyLimit"
        />
        <span class="muted">条</span>
      </div>
    </div>

    <div class="field-card">
      <div class="field-sec">应用背景</div>
      <div class="field-row wrap">
        <button type="button" class="btn" @click="ctrl.openWallpapersFolder()">壁纸目录</button>
        <button
          type="button"
          class="btn"
          :disabled="!ctrl.data.appBackground || ctrl.data.busy"
          @click="ctrl.setAppBackground(null)"
        >
          清除背景
        </button>
      </div>
      <p class="field-hint">
        全局窗口背景（Runner / 编辑器 / 桌面整理 / 设置）。当前：{{
          ctrl.data.appBackground || '无'
        }}
      </p>
      <div v-if="ctrl.data.wallpapers.length" class="wp-grid">
        <button
          v-for="(wp, i) in ctrl.data.wallpapers"
          :key="wp.path"
          type="button"
          class="wp-card"
          :class="{ 'is-active': ctrl.data.appBackground === wp.name }"
          :title="wp.name"
          @click="openStudio(i)"
        >
          <img v-if="wp.thumb" :src="wp.thumb" :alt="wp.name" loading="lazy" />
          <span class="wp-name">{{ wp.name }}</span>
          <span class="wp-hint">点击预览</span>
        </button>
      </div>
      <p v-else class="field-hint">壁纸目录为空，可点「壁纸目录」放入图片。</p>
    </div>

    <WallpaperStudio
      v-if="studioOpen"
      v-model="studioIndex"
      :items="ctrl.data.wallpapers"
      :active-name="ctrl.data.appBackground"
      :busy="ctrl.data.busy"
      @close="studioOpen = false"
      @apply-app="onStudioApplyApp"
      @apply-system="onStudioApplySystem"
      @clear="onStudioClear"
    />

    <p class="status" :class="{ ok: ctrl.data.statusOk }">{{ ctrl.data.statusText }}</p>
  </div>

  <div class="footer">
    <button type="button" class="btn" title="打开诊断日志" @click="ctrl.openDiag()">日志</button>
    <div class="footer-actions">
      <button type="button" class="btn" @click="ctrl.close()">关闭</button>
      <button
        type="button"
        class="btn"
        title="写入并立即生效，不关闭窗口"
        :disabled="ctrl.data.busy"
        @click="ctrl.apply()"
      >
        {{ ctrl.data.applyLabel }}
      </button>
      <button
        type="button"
        class="btn primary"
        title="写入并关闭"
        :disabled="ctrl.data.busy"
        @click="ctrl.save()"
      >
        {{ ctrl.data.saveLabel }}
      </button>
    </div>
  </div>
  </div>
</template>

<script lang="ts" setup>
import { onMounted, onUnmounted, ref } from 'vue';
import TitleBarShell from '@pkg-runner/shell/renderer/TitleBarShell.vue';
import TitleBarMeta from '@pkg-runner/shell/renderer/TitleBarMeta.vue';
import WallpaperStudio from '@pkg-runner/shell/renderer/WallpaperStudio.vue';
import { SettingsCtrl } from './SettingsCtrl';

const ctrl = new SettingsCtrl();
const studioOpen = ref(false);
const studioIndex = ref(0);

function openStudio(index: number): void {
  studioIndex.value = index;
  studioOpen.value = true;
}

async function onStudioApplyApp(item: { name: string; path: string }): Promise<void> {
  await ctrl.setAppBackground(item.name);
}

async function onStudioApplySystem(item: { name: string; path: string }): Promise<void> {
  await ctrl.setSystemWallpaper(item);
}

async function onStudioClear(): Promise<void> {
  await ctrl.setAppBackground(null);
}

onMounted(() => ctrl.mount());
onUnmounted(() => {
  studioOpen.value = false;
  ctrl.unmount();
});
</script>

<style lang="less" scoped>
.app {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.shell {
  flex: 1;
  padding: 18px 20px 12px;
  overflow-x: hidden;
  overflow-y: auto;
  min-width: 0;
}

select,
input[type='number'],
input[type='text'] {
  border-radius: 7px;
  border: 1px solid var(--line);
  background: var(--bg-input);
  color: var(--fg);
  padding: 6px 8px;
  font: inherit;
  min-height: 32px;
}

select {
  min-width: 168px;
}

input[type='range'] {
  flex: 1;
  accent-color: var(--accent);
}

.brand-color {
  width: 36px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: transparent;
  cursor: pointer;
}

.brand-hex {
  width: 92px;
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  letter-spacing: 0.02em;
}

.brand-preset[data-brand-preset='prod'] {
  border-color: var(--preset-prod);
  color: var(--preset-prod);
}

.brand-preset[data-brand-preset='test'] {
  border-color: var(--preset-test);
  color: var(--preset-test);
}

.brand-preset.is-active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}

.brand-preset .swatch {
  display: inline-block;
  vertical-align: -2px;
  margin-right: 6px;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  border: 1px solid color-mix(in srgb, var(--fg) 20%, transparent);
}

.grow {
  flex: 1;
  min-width: 0;
}

.recording {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.status {
  min-height: 1.2em;
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--danger);
}

.status.ok {
  color: var(--ok);
}

.footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 12px 20px 16px;
  border-top: 1px solid var(--line);
  background: var(--bg-raised);
  -webkit-backdrop-filter: blur(var(--glass-blur, 22px));
  backdrop-filter: blur(var(--glass-blur, 22px));
  flex-shrink: 0;
}

.footer-actions {
  display: flex;
  gap: 8px;
}

.alpha-val {
  min-width: 40px;
  color: var(--muted);
  text-align: right;
}

.wp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: 10px;
  margin-top: 10px;
}

.wp-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0 0 8px;
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
  background: var(--panel);
  -webkit-backdrop-filter: blur(var(--glass-blur, 22px));
  backdrop-filter: blur(var(--glass-blur, 22px));
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: zoom-in;
}

.wp-card.is-active {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--line));
}

.wp-card img {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  display: block;
  background: #111;
}

.wp-name {
  padding: 0 8px;
  font-size: 11px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wp-hint {
  padding: 0 8px;
  font-size: 11px;
  color: var(--muted);
}

.wp-actions {
  display: none;
}

.num-sm {
  width: 88px;
}

.muted {
  color: var(--muted);
}

.btn:disabled {
  cursor: wait;
}
</style>
