<template>
  <div
    class="app-shell"
  >
    <TitleBarShell :ctrl="ctrl">
      <TitleBarMeta :text="ctrl.data.meta" :title="ctrl.data.meta" />
      <template #actions>
        <TitleBarAction :disabled="ctrl.state.busy" @click="ctrl.onRefresh()">刷新</TitleBarAction>
        <TitleBarAction accent :disabled="ctrl.state.busy" @click="ctrl.onPickCustomRoot()">
          {{ ctrl.data.hasRoot ? '更换目录' : '选择目录' }}
        </TitleBarAction>
        <TitleBarAction
          :disabled="!ctrl.data.hasRoot || ctrl.state.busy"
          @click="ctrl.onAddTracked()"
        >
          添加已有
        </TitleBarAction>
        <TitleBarAction
          :disabled="!ctrl.data.undoEnabled || ctrl.state.busy"
          @click="ctrl.onUndo()"
        >
          撤销
        </TitleBarAction>
        <TitleBarAction
          v-if="ctrl.data.hasRoot"
          :disabled="ctrl.state.busy"
          @click="ctrl.onClearCustomRoot()"
        >
          清除目录
        </TitleBarAction>
        <TitleBarAction :disabled="!ctrl.data.hasRoot" @click="ctrl.onOpenDesktop()">
          打开目录
        </TitleBarAction>
        <TitleBarAction @click="ctrl.onOpenWallpapersFolder()">壁纸目录</TitleBarAction>
        <TitleBarAction
          :accent="ctrl.data.jimengSplitOpen"
          @click="ctrl.onOpenJimeng()"
        >
          {{ ctrl.data.jimengSplitOpen ? '收起即梦后台' : '即梦后台' }}
        </TitleBarAction>
        <TitleBarAction @click="ctrl.openJimengPanel()">即梦收藏</TitleBarAction>
        <TitleBarAction
          v-if="ctrl.data.appBgName"
          :disabled="ctrl.state.busy"
          @click="ctrl.onClearAppBackground()"
        >
          清除背景
        </TitleBarAction>
      </template>
    </TitleBarShell>

    <div class="zones-body">
    <p v-if="ctrl.data.banner" class="banner" :class="{ warn: ctrl.data.bannerWarn }">
      <span class="banner-text">{{ ctrl.data.banner }}</span>
      <button type="button" class="banner-dismiss" title="关闭" @click="ctrl.hideBanner()">×</button>
    </p>

    <div v-if="ctrl.state.busy" class="busy-bar" aria-hidden="true" />

    <WallpaperStudio
      v-if="studioOpen"
      v-model="studioIndex"
      :items="ctrl.data.studioItems"
      :active-name="ctrl.data.studioKind === 'wallpaper' ? ctrl.data.appBgName : null"
      :busy="ctrl.state.busy"
      :show-actions="ctrl.data.studioKind === 'wallpaper'"
      :actions="studioActions"
      @close="onStudioClose"
      @action="onStudioAction"
      @apply-app="onStudioApplyApp"
      @apply-system="onStudioApplySystem"
      @clear="onStudioClear"
    />

    <div v-if="!ctrl.data.hasRoot" class="setup">
      <p class="setup-title">选择一个目录作为自定义桌面</p>
      <p class="setup-desc">顶部为分组卡片；下方左侧未追踪项，右侧为系统桌面文件。</p>
      <button type="button" class="setup-btn" :disabled="ctrl.state.busy" @click="ctrl.onPickCustomRoot()">
        选择目录
      </button>
    </div>

    <template v-else>
      <!-- 分组轮播：箭头浮层，卡片左缘与下方两列对齐 -->
      <div
        class="group-row"
        :class="{ 'is-dragging': ctrl.state.dragging }"
      >
        <div class="group-carousel-wrap">
          <button
            type="button"
            class="page-btn page-btn-prev"
            title="上一屏"
            :disabled="!canCarouselPrev"
            @click="carouselStep(-1)"
          >
            ‹
          </button>

          <div
            ref="carouselEl"
            class="group-carousel"
            @scroll.passive="syncCarouselEdges"
            @wheel.prevent="onCarouselWheel"
          >
            <div class="group-carousel-track">
              <template
                v-for="(slot, si) in ctrl.allGroupSlots()"
                :key="si + (slot.kind === 'group' ? slot.group.id : 'wp')"
              >
                <!-- 壁纸：固定第一组语义 -->
                <section
                  v-if="slot.kind === 'wallpaper'"
                  class="zone group-card wallpaper-group"
                  title="点击进入壁纸库"
                >
                  <header class="zone-head">
                    <button
                      type="button"
                      class="zone-title-btn"
                      title="进入壁纸库"
                      @click="ctrl.enterWallpaper()"
                    >
                      壁纸
                    </button>
                    <span class="zone-count">{{ ctrl.data.wallpapers.length }}</span>
                  </header>
                  <div class="preview-grid" @click="ctrl.enterWallpaper()">
                    <div
                      v-for="wp in previewItems(ctrl.data.wallpapers)"
                      :key="wp.path"
                      class="tile"
                      :title="wp.name"
                      @click.stop="ctrl.openWallpaperAt(wp.path)"
                    >
                      <span class="tile-icon is-image">
                        <LazyThumb v-if="wp.thumb" :src="wp.thumb" :alt="wp.name" />
                      </span>
                      <span class="tile-label">{{ wp.name }}</span>
                    </div>
                    <div v-if="!ctrl.data.wallpapers.length" class="preview-empty">
                      暂无壁纸 · 点击进入
                    </div>
                  </div>
                </section>

                <section
                  v-else
                  class="zone group-card"
                  :class="{ 'is-drop': ctrl.state.dropTargetRel === slot.group.rel }"
                  @dragover="ctrl.onDragOverGroup($event, slot.group.rel)"
                  @dragleave="ctrl.onDragLeaveGroup(slot.group.rel)"
                  @drop="ctrl.onDropGroup($event, slot.group.rel)"
                >
                  <header class="zone-head">
                    <button
                      type="button"
                      class="zone-title-btn"
                      :title="slot.group.path"
                      @click="ctrl.enterGroup(slot.group)"
                    >
                      {{ slot.group.title }}
                    </button>
                    <span class="zone-actions">
                      <span class="zone-count">{{ slot.group.files.length }}</span>
                      <button
                        type="button"
                        class="untrack-btn"
                        title="取消追踪"
                        @click.stop="ctrl.onRemoveTracked(slot.group.rel, slot.group.title)"
                      >
                        ×
                      </button>
                    </span>
                  </header>
                  <div class="preview-grid" @click="ctrl.enterGroup(slot.group)">
                    <div
                      v-for="f in previewItems(slot.group.files)"
                      :key="f.path"
                      class="tile"
                      draggable="true"
                      :title="f.path"
                      @dragstart.stop="ctrl.onDragStart($event, f)"
                      @dragend="ctrl.onDragEnd()"
                      @click.stop="ctrl.onItemActivate(f, slot.group.files)"
                      @contextmenu.prevent.stop="ctrl.showCtx($event.clientX, $event.clientY, f)"
                    >
                      <span class="tile-icon" :class="f.thumb ? 'is-image' : 'is-' + fileIconKind(f)">
                        <LazyThumb v-if="f.thumb" :src="f.thumb" :alt="f.name" />
                        <template v-else-if="fileIconKind(f) === 'dir'">📁</template>
                        <template v-else-if="fileIconKind(f) === 'image'">🖼</template>
                        <template v-else>📄</template>
                      </span>
                      <span class="tile-label">{{ f.name }}</span>
                    </div>
                    <div v-if="!slot.group.files.length" class="preview-empty">拖放到此 · 点击进入</div>
                  </div>
                </section>
              </template>
            </div>
          </div>

          <button
            type="button"
            class="page-btn page-btn-next"
            title="下一屏"
            :disabled="!canCarouselNext"
            @click="carouselStep(1)"
          >
            ›
          </button>
        </div>

        <button
          type="button"
          class="add-group-btn"
          title="新建分组（创建文件夹并追踪）"
          :disabled="ctrl.state.busy"
          @click="ctrl.onCreateTracked()"
        >
          <span class="add-plus">+</span>
          <span class="add-label">新建分组</span>
        </button>
      </div>

      <!-- 子页面：递归浏览 -->
      <div v-if="ctrl.data.nav" class="browse">
        <div class="browse-bar">
          <button type="button" class="back-btn" title="返回上级（Esc）" @click="ctrl.navBack()">
            ← 返回
          </button>
          <div class="crumbs">
            <button type="button" class="crumb-btn" @click="ctrl.goHome()">首页</button>
            <template v-for="(c, i) in ctrl.data.nav.crumbs" :key="c.path + i">
              <span class="crumb-sep">/</span>
              <button
                type="button"
                class="crumb-btn"
                :class="{ current: i === ctrl.data.nav.crumbs.length - 1 }"
                @click="ctrl.navToCrumb(i)"
              >
                {{ c.title }}
              </button>
            </template>
          </div>
          <span v-if="ctrl.data.nav.kind === 'wallpaper'" class="browse-hint">
            点击预览 · 可设为应用背景 / 系统壁纸
          </span>
          <span v-else class="browse-hint">拖放到此处可移入当前文件夹</span>
        </div>
        <div
          class="tile-grid browse-drop"
          :class="{
            'is-drop': ctrl.state.dropBrowse && ctrl.data.nav.kind !== 'wallpaper',
            'is-busy': ctrl.state.busy,
          }"
          @dragover="ctrl.onDragOverBrowse($event)"
          @dragleave="ctrl.onDragLeaveBrowse()"
          @drop="ctrl.onDropBrowse($event)"
        >
          <div v-if="!ctrl.data.nav.files.length" class="empty-block">
            <template v-if="ctrl.data.nav.kind === 'wallpaper'">
              暂无壁纸 · 可从即梦下载或放入壁纸目录
            </template>
            <template v-else>空文件夹 · 可从下方或系统桌面拖入文件</template>
          </div>
          <button
            v-for="f in ctrl.data.nav.files"
            :key="f.path"
            type="button"
            class="tile tile-btn"
            :draggable="ctrl.data.nav.kind !== 'wallpaper'"
            :title="f.path"
            @dragstart="ctrl.onDragStart($event, f)"
            @dragend="ctrl.onDragEnd()"
            @click="ctrl.onItemActivate(f, ctrl.data.nav.files)"
            @contextmenu.prevent.stop="ctrl.onBrowseContext($event, f)"
          >
            <span class="tile-icon" :class="f.thumb ? 'is-image' : 'is-' + fileIconKind(f)">
              <LazyThumb v-if="f.thumb" :src="f.thumb" :alt="f.name" />
              <template v-else-if="fileIconKind(f) === 'dir'">📁</template>
              <template v-else-if="fileIconKind(f) === 'image'">🖼</template>
              <template v-else>📄</template>
            </span>
            <span class="tile-label">{{ f.name }}</span>
          </button>
        </div>
      </div>

      <!-- 首页两列 -->
      <div v-else class="two-cols">
        <section class="zone col">
          <header class="zone-head">
            <span class="zone-title">自定义桌面 · 未追踪</span>
            <span class="zone-count">{{ ctrl.data.loose.length }}</span>
          </header>
          <div class="tile-grid in-col">
            <div v-if="!ctrl.data.loose.length" class="empty-block">
              暂无未追踪项 · 根目录文件会出现在这里
            </div>
            <button
              v-for="f in ctrl.data.loose"
              :key="f.path"
              type="button"
              class="tile tile-btn"
              draggable="true"
              :title="f.path"
              @dragstart="ctrl.onDragStart($event, f)"
              @dragend="ctrl.onDragEnd()"
              @click="ctrl.onItemActivate(f, ctrl.data.loose)"
              @contextmenu.prevent.stop="ctrl.showCtx($event.clientX, $event.clientY, f)"
            >
              <span class="tile-icon" :class="f.thumb ? 'is-image' : 'is-' + fileIconKind(f)">
                <LazyThumb v-if="f.thumb" :src="f.thumb" :alt="f.name" />
                <template v-else-if="fileIconKind(f) === 'dir'">📁</template>
                <template v-else-if="fileIconKind(f) === 'image'">🖼</template>
                <template v-else>📄</template>
              </span>
              <span class="tile-label">{{ f.name }}</span>
            </button>
          </div>
        </section>

        <section class="zone col">
          <header class="zone-head">
            <span class="zone-title" :title="ctrl.data.systemDesktopRoot">系统桌面</span>
            <span class="zone-count">{{ ctrl.data.systemDesktop.length }}</span>
          </header>
          <div class="tile-grid in-col">
            <div v-if="!ctrl.data.systemDesktop.length" class="empty-block">系统桌面为空</div>
            <button
              v-for="f in ctrl.data.systemDesktop"
              :key="f.path"
              type="button"
              class="tile tile-btn"
              draggable="true"
              :title="f.path"
              @dragstart="ctrl.onDragStart($event, f)"
              @dragend="ctrl.onDragEnd()"
              @click="ctrl.onItemActivate(f, ctrl.data.systemDesktop)"
              @contextmenu.prevent.stop="ctrl.showCtx($event.clientX, $event.clientY, f)"
            >
              <span class="tile-icon" :class="f.thumb ? 'is-image' : 'is-' + fileIconKind(f)">
                <LazyThumb v-if="f.thumb" :src="f.thumb" :alt="f.name" />
                <template v-else-if="fileIconKind(f) === 'dir'">📁</template>
                <template v-else-if="fileIconKind(f) === 'image'">🖼</template>
                <template v-else>📄</template>
              </span>
              <span class="tile-label">{{ f.name }}</span>
            </button>
          </div>
        </section>
      </div>
    </template>

    <div
      v-if="ctrl.state.nameDialog"
      class="modal-mask"
      @click.self="ctrl.closeNameDialog()"
    >
      <div
        class="modal"
        role="dialog"
        aria-modal="true"
        :aria-label="ctrl.state.nameDialog.mode === 'rename' ? '重命名' : '新建分组'"
        @click.stop
      >
        <h3 class="modal-title">
          {{ ctrl.state.nameDialog.mode === 'rename' ? '重命名' : '新建分组' }}
        </h3>
        <p class="modal-desc">
          {{
            ctrl.state.nameDialog.mode === 'rename'
              ? '修改名称（含扩展名）'
              : '将在桌面根目录创建文件夹并加入追踪'
          }}
        </p>
        <input
          ref="nameInputEl"
          class="modal-input"
          type="text"
          maxlength="120"
          :placeholder="ctrl.state.nameDialog.mode === 'rename' ? '新文件名' : '分组名称'"
          :value="ctrl.state.nameDialog.value"
          :disabled="ctrl.state.busy"
          @input="onNameInput"
          @keydown.enter.prevent="ctrl.submitNameDialog()"
          @keydown.esc.prevent="ctrl.closeNameDialog()"
        />
        <div class="modal-actions">
          <button type="button" class="modal-btn" :disabled="ctrl.state.busy" @click="ctrl.closeNameDialog()">
            取消
          </button>
          <button
            type="button"
            class="modal-btn primary"
            :disabled="ctrl.state.busy || !ctrl.state.nameDialog.value.trim()"
            @click="ctrl.submitNameDialog()"
          >
            {{ ctrl.state.nameDialog.mode === 'rename' ? '确定' : '创建' }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="ctrl.state.confirmDialog"
      class="modal-mask"
      @click.self="ctrl.answerConfirm(false)"
    >
      <div
        class="modal"
        role="dialog"
        aria-modal="true"
        :aria-label="ctrl.state.confirmDialog.title"
        @click.stop
      >
        <h3 class="modal-title">{{ ctrl.state.confirmDialog.title }}</h3>
        <p class="modal-desc modal-confirm-msg">{{ ctrl.state.confirmDialog.message }}</p>
        <div class="modal-actions">
          <button type="button" class="modal-btn" @click="ctrl.answerConfirm(false)">取消</button>
          <button
            type="button"
            class="modal-btn primary"
            :class="{ danger: ctrl.state.confirmDialog.danger }"
            @click="ctrl.answerConfirm(true)"
          >
            {{ ctrl.state.confirmDialog.confirmLabel || '确定' }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="ctrl.state.jimengPanel"
      class="modal-mask"
      @click.self="ctrl.closeJimengPanel()"
    >
      <div
        class="modal jimeng-modal"
        role="dialog"
        aria-modal="true"
        aria-label="即梦图片"
        @click.stop
      >
        <div class="jimeng-head">
          <h3 class="modal-title">即梦图片</h3>
          <button type="button" class="banner-dismiss" title="关闭" @click="ctrl.closeJimengPanel()">
            ×
          </button>
        </div>
        <p class="modal-desc">
          「即梦收藏」只读本机已截获数据，不打开后台也能用。需要新图时再开「即梦后台」逛收藏（静默旁路，不代打接口），然后「下载到壁纸」。
          <span v-if="ctrl.data.jimengUpdatedAt">
            · 更新于 {{ ctrl.data.jimengUpdatedAt.replace('T', ' ').slice(0, 19) }}
          </span>
        </p>
        <div class="jimeng-toolbar">
          <button type="button" class="modal-btn" :disabled="ctrl.state.busy" @click="ctrl.onOpenJimeng()">
            即梦后台
          </button>
          <button
            type="button"
            class="modal-btn"
            :disabled="ctrl.state.busy"
            @click="ctrl.onSyncJimengFavorites()"
          >
            刷新本机
          </button>
          <button
            type="button"
            class="modal-btn primary"
            :disabled="ctrl.state.busy || !ctrl.filteredJimengItems().length"
            @click="ctrl.onDownloadJimengAll()"
          >
            下载到壁纸
          </button>
        </div>
        <div class="jimeng-filters">
          <button
            type="button"
            class="jimeng-filter"
            :class="{ active: ctrl.data.jimengFilter === 'all' }"
            @click="ctrl.setJimengFilter('all')"
          >
            全部
          </button>
          <button
            type="button"
            class="jimeng-filter"
            :class="{ active: ctrl.data.jimengFilter === 'favorite' }"
            @click="ctrl.setJimengFilter('favorite')"
          >
            收藏
          </button>
          <button
            type="button"
            class="jimeng-filter"
            :class="{ active: ctrl.data.jimengFilter === 'home' }"
            @click="ctrl.setJimengFilter('home')"
          >
            推荐
          </button>
        </div>
        <div class="jimeng-grid">
          <div v-if="!ctrl.filteredJimengItems().length" class="empty-block">
            暂无本机数据。点「即梦后台」登录并打开收藏浏览后，再回这里刷新。
          </div>
          <div v-for="item in ctrl.filteredJimengItems()" :key="item.id" class="jimeng-card">
            <button
              type="button"
              class="jimeng-cover"
              title="预览"
              @click="ctrl.openJimengPreview(item.id)"
            >
              <LazyThumb v-if="item.coverUrl" :src="item.coverUrl" :alt="item.title" />
              <span class="jimeng-badge" :class="item.source === 'home' ? 'home' : 'fav'">
                {{ item.source === 'home' ? '推荐' : '收藏' }}
              </span>
            </button>
            <div class="jimeng-meta">
              <div class="jimeng-title" :title="item.title">{{ item.title }}</div>
              <div v-if="item.author" class="jimeng-author">{{ item.author }}</div>
            </div>
            <button
              type="button"
              class="modal-btn primary jimeng-dl"
              :disabled="ctrl.state.busy"
              @click="ctrl.onDownloadJimengOne(item)"
            >
              下载
            </button>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="ctrl.state.ctx"
      ref="ctxEl"
      class="ctx"
      :style="{ left: `${ctxPos.x}px`, top: `${ctxPos.y}px` }"
      @click.stop
    >
      <button type="button" @click="ctrl.onCtxAction('open')">
        {{ ctrl.state.ctx.file.isDir ? '打开文件夹' : '打开' }}
      </button>
      <button type="button" @click="ctrl.onCtxAction('reveal')">在资源管理器中显示</button>
      <button type="button" @click="ctrl.onCtxAction('copy-path')">复制路径</button>
      <button
        v-if="ctrl.state.ctx.file && ctrl.canTrackAsGroup(ctrl.state.ctx.file)"
        type="button"
        @click="ctrl.onCtxAction('track')"
      >
        加入追踪
      </button>
      <button type="button" @click="ctrl.onCtxAction('rename')">重命名</button>
      <button type="button" class="danger" @click="ctrl.onCtxAction('trash')">删除到回收站</button>
    </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import TitleBarShell from '@pkg-runner/shell/renderer/TitleBarShell.vue';
import TitleBarMeta from '@pkg-runner/shell/renderer/TitleBarMeta.vue';
import TitleBarAction from '@pkg-runner/shell/renderer/TitleBarAction.vue';
import WallpaperStudio, {
  type WallpaperStudioAction,
  type WallpaperStudioItem,
} from '@pkg-runner/shell/renderer/WallpaperStudio.vue';
import {
  fileIconKind,
  previewItems,
  type ZonesShellCtrl,
} from './ZonesShellCtrl';
import LazyThumb from './LazyThumb.vue';

const props = defineProps<{
  ctrl: ZonesShellCtrl;
}>();

const studioOpen = ref(false);
const studioIndex = ref(0);

const JIMENG_STUDIO_ACTIONS: WallpaperStudioAction[] = [
  { id: 'download', label: '下载此图', variant: 'primary', disabled: 'no-current' },
];

/** Wallpaper → default buttons; browse → none; jimeng → download. */
const studioActions = computed<WallpaperStudioAction[] | null>(() => {
  const kind = props.ctrl.data.studioKind;
  if (kind === 'jimeng') return JIMENG_STUDIO_ACTIONS;
  if (kind === 'browse') return [];
  return null;
});
const nameInputEl = ref<HTMLInputElement | null>(null);
const carouselEl = ref<HTMLElement | null>(null);
const ctxEl = ref<HTMLElement | null>(null);
const ctxPos = ref({ x: 0, y: 0 });
const canCarouselPrev = ref(false);
const canCarouselNext = ref(false);

function openStudio(index: number): void {
  studioIndex.value = index;
  studioOpen.value = true;
}

function onNameInput(e: Event): void {
  props.ctrl.setNameDialogValue((e.target as HTMLInputElement).value);
}

function syncCarouselEdges(): void {
  const el = carouselEl.value;
  if (!el) {
    canCarouselPrev.value = false;
    canCarouselNext.value = false;
    return;
  }
  const max = Math.max(0, el.scrollWidth - el.clientWidth);
  canCarouselPrev.value = el.scrollLeft > 2;
  canCarouselNext.value = el.scrollLeft < max - 2;
}

/** Card left/right in the carousel's scroll coordinate space. */
function carouselCardMetrics(el: HTMLElement): Array<{ left: number; right: number }> {
  const cards = Array.from(el.querySelectorAll('.group-card')) as HTMLElement[];
  const rootLeft = el.getBoundingClientRect().left;
  const scroll = el.scrollLeft;
  return cards.map((card) => {
    const r = card.getBoundingClientRect();
    const left = scroll + (r.left - rootLeft);
    return { left, right: left + r.width };
  });
}

/**
 * Flip roughly one viewport:
 * - next → scroll so the nearest incomplete card on the right becomes the first
 * - prev → scroll so the nearest incomplete card on the left becomes the last
 */
function carouselStep(dir: -1 | 1): void {
  const el = carouselEl.value;
  if (!el) return;
  const metrics = carouselCardMetrics(el);
  if (!metrics.length) return;

  const eps = 2;
  const viewL = el.scrollLeft;
  const viewR = viewL + el.clientWidth;
  const max = Math.max(0, el.scrollWidth - el.clientWidth);

  if (dir > 0) {
    const target = metrics.find((m) => m.right > viewR + eps);
    if (!target) return;
    el.scrollTo({ left: Math.min(max, Math.max(0, target.left)), behavior: 'smooth' });
  } else {
    // Rightmost card that is not fully inside (cuts the left edge or sits fully to the left).
    let target: { left: number; right: number } | undefined;
    for (let i = metrics.length - 1; i >= 0; i--) {
      const m = metrics[i]!;
      if (m.left < viewL - eps) {
        target = m;
        break;
      }
    }
    if (!target) return;
    el.scrollTo({
      left: Math.min(max, Math.max(0, target.right - el.clientWidth)),
      behavior: 'smooth',
    });
  }
}

function scrollCarouselEnd(): void {
  const el = carouselEl.value;
  if (!el) return;
  el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' });
}

function onCarouselWheel(e: WheelEvent): void {
  const el = carouselEl.value;
  if (!el) return;
  const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if (!delta) return;
  el.scrollLeft += delta;
  syncCarouselEdges();
}

function onKeydown(e: KeyboardEvent): void {
  if (studioOpen.value && e.key === 'Escape') {
    studioOpen.value = false;
    e.preventDefault();
    return;
  }
  if (props.ctrl.handleKeydown(e)) {
    e.preventDefault();
  }
}

function placeCtxMenu(anchorX: number, anchorY: number): void {
  const el = ctxEl.value;
  const pad = 8;
  if (!el) {
    ctxPos.value = { x: anchorX, y: anchorY };
    return;
  }
  const { width, height } = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let x = anchorX;
  let y = anchorY;

  // Prefer opening to the right/below the cursor; flip if needed.
  if (x + width > vw - pad) {
    x = Math.max(pad, anchorX - width);
  }
  if (x + width > vw - pad) {
    x = Math.max(pad, vw - width - pad);
  }
  if (y + height > vh - pad) {
    y = Math.max(pad, anchorY - height);
  }
  if (y + height > vh - pad) {
    y = Math.max(pad, vh - height - pad);
  }

  ctxPos.value = { x, y };
}

watch(
  () => props.ctrl.state.ctx,
  async (ctx) => {
    if (!ctx) return;
    // First paint at cursor, then clamp with real size.
    ctxPos.value = { x: ctx.x, y: ctx.y };
    await nextTick();
    placeCtxMenu(ctx.x, ctx.y);
  },
);

watch(
  () => props.ctrl.state.studioRequest,
  (v) => {
    if (v == null) return;
    const i = props.ctrl.consumeStudioRequest();
    if (i != null) openStudio(i);
  },
);

watch(
  () => props.ctrl.state.nameDialog,
  async (d) => {
    if (!d) return;
    await nextTick();
    nameInputEl.value?.focus();
    nameInputEl.value?.select();
  },
);

watch(
  () => props.ctrl.state.carouselScrollEnd,
  async (v) => {
    if (v == null) return;
    await nextTick();
    scrollCarouselEnd();
    syncCarouselEdges();
  },
);

watch(
  () => [props.ctrl.data.groups.length, props.ctrl.data.hasRoot] as const,
  async () => {
    await nextTick();
    syncCarouselEdges();
  },
);

async function onStudioApplyApp(item: { name: string; path: string }): Promise<void> {
  await props.ctrl.onSetAppBackground(item);
}

async function onStudioApplySystem(item: { name: string; path: string }): Promise<void> {
  await props.ctrl.onSetWallpaper(item);
}

async function onStudioClear(): Promise<void> {
  await props.ctrl.onClearAppBackground();
}

function onStudioClose(): void {
  studioOpen.value = false;
  props.ctrl.restoreJimengAfterStudio();
}

async function onStudioAction(payload: {
  id: string;
  item: WallpaperStudioItem | null;
}): Promise<void> {
  if (payload.id === 'download' && payload.item) {
    const jimeng = props.ctrl.jimengItemByStudioPath(payload.item.path);
    if (!jimeng) {
      props.ctrl.showBanner('找不到对应收藏项', true);
      return;
    }
    await props.ctrl.onDownloadJimengOne(jimeng);
  }
}

function onDocClick(): void {
  props.ctrl.hideCtx();
}

onMounted(() => {
  props.ctrl.mount();
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKeydown);
  nextTick(() => syncCarouselEdges());
  window.addEventListener('resize', syncCarouselEdges);
});

onUnmounted(() => {
  props.ctrl.unmount();
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onKeydown);
  window.removeEventListener('resize', syncCarouselEdges);
  studioOpen.value = false;
});
</script>

<style scoped>
.app-shell {
  --group-card-w: 200px;
  --group-card-h: 236px;
  --add-group-w: 88px;
  --tile-size: 84px;
  --zone-head-h: 36px;
  --content-gutter: 16px;
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

/* Same frost as titlebar / .glass-surface: --panel fill + --glass-blur */
.zone,
.group-card.zone,
.page-btn,
.back-btn,
.browse .tile-grid,
.ctx,
.modal,
.jimeng-modal {
  -webkit-backdrop-filter: blur(var(--glass-blur, 22px));
  backdrop-filter: blur(var(--glass-blur, 22px));
}

/* Split margins removed — Jimeng is a follower BrowserWindow. */
.zones-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.banner {
  margin: 0;
  padding: 10px 14px;
  font-size: 13px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 10px;
}

.banner-text {
  flex: 1;
  min-width: 0;
}

.banner-dismiss {
  flex: 0 0 auto;
  margin: 0;
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.banner-dismiss:hover {
  color: var(--text);
  background: color-mix(in srgb, var(--text) 8%, transparent);
}

.banner.warn {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  border-bottom-color: color-mix(in srgb, var(--danger) 35%, transparent);
}

.busy-bar {
  position: relative;
  height: 2px;
  flex: 0 0 auto;
  overflow: hidden;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}

.busy-bar::after {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 35%;
  background: var(--accent);
  animation: busy-slide 0.9s ease-in-out infinite;
}

@keyframes busy-slide {
  0% {
    left: -35%;
  }
  100% {
    left: 100%;
  }
}

.setup {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 32px 20px;
  text-align: center;
}

.setup-title {
  margin: 0;
  font-size: 18px;
  font-weight: 650;
}

.setup-desc {
  margin: 0;
  max-width: 420px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--muted, color-mix(in srgb, var(--text) 55%, transparent));
}

.setup-btn {
  margin-top: 8px;
  padding: 10px 18px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--line));
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--text);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.group-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px var(--content-gutter) 8px;
  flex: 0 0 auto;
  border-bottom: 1px solid var(--line);
  transition: background 0.15s ease;
}

.group-row.is-dragging {
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}

.group-carousel-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
}

.page-btn {
  position: absolute;
  top: 50%;
  z-index: 3;
  width: 32px;
  height: 32px;
  margin: 0;
  padding: 0;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--text);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  transform: translateY(-50%);
  box-shadow: 0 4px 14px color-mix(in srgb, var(--shadow, #000) 28%, transparent);
}

.page-btn-prev {
  left: 6px;
}

.page-btn-next {
  right: 6px;
}

.page-btn:disabled {
  opacity: 0;
  pointer-events: none;
}

.page-btn:not(:disabled):hover {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
  color: var(--accent);
}

.group-carousel {
  width: 100%;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-snap-type: x mandatory;
  scrollbar-width: thin;
  -webkit-overflow-scrolling: touch;
}

.group-carousel::-webkit-scrollbar {
  height: 6px;
}

.group-carousel::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: color-mix(in srgb, var(--text) 22%, transparent);
}

.group-carousel-track {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  height: var(--group-card-h);
  padding-bottom: 2px;
}

.group-carousel .group-card {
  flex: 0 0 var(--group-card-w);
  width: var(--group-card-w);
  height: var(--group-card-h);
  scroll-snap-align: start;
}

.add-group-btn {
  flex: 0 0 var(--add-group-w);
  width: var(--add-group-w);
  height: var(--group-card-h);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 0;
  border-radius: 14px;
  border: 1px dashed color-mix(in srgb, var(--accent) 45%, var(--line));
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}

.add-group-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
}

.add-group-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.add-plus {
  font-size: 28px;
  font-weight: 500;
  line-height: 1;
  color: var(--accent);
}

.add-label {
  font-size: 11px;
  font-weight: 600;
}

.zone {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--panel);
  overflow: hidden;
}

.group-card {
  box-sizing: border-box;
  width: var(--group-card-w);
  height: var(--group-card-h);
  flex: 0 0 auto;
  cursor: pointer;
}

.group-card.is-drop {
  border-color: color-mix(in srgb, var(--accent) 70%, var(--line));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent);
  background: color-mix(in srgb, var(--accent) 10%, var(--panel));
  transform: translateY(-1px);
}

.wallpaper-group {
  cursor: pointer;
}

.wallpaper-group:hover,
.group-card:hover {
  border-color: color-mix(in srgb, var(--accent) 35%, var(--line));
}

.zone-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  box-sizing: border-box;
  height: var(--zone-head-h);
  padding: 0 12px;
  flex: 0 0 var(--zone-head-h);
  border-bottom: 1px solid var(--line);
}

.zone-title,
.zone-title-btn {
  font-size: 13px;
  font-weight: 650;
  color: var(--text);
}

.zone-title-btn {
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-weight: 650;
  cursor: pointer;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 70%;
}

.zone-title-btn:hover {
  color: var(--accent);
}

.zone-count {
  font-size: 11px;
  color: var(--muted);
}

.zone-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.untrack-btn {
  margin: 0;
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.untrack-btn:hover {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}

.preview-grid {
  display: grid;
  grid-template-columns: repeat(2, var(--tile-size));
  grid-template-rows: repeat(2, var(--tile-size));
  gap: 8px;
  padding: 10px;
  flex: 0 0 auto;
  justify-content: center;
  align-content: center;
  box-sizing: border-box;
  height: calc(var(--group-card-h) - var(--zone-head-h));
}

.preview-empty,
.empty-block {
  grid-column: 1 / -1;
  padding: 16px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--muted);
}

.tile {
  position: relative;
  box-sizing: border-box;
  display: block;
  width: var(--tile-size);
  height: var(--tile-size);
  flex: 0 0 var(--tile-size);
  padding: 0;
  border-radius: 10px;
  overflow: hidden;
  background: color-mix(in srgb, var(--text) 6%, transparent);
}

.tile-btn {
  margin: 0;
  border: 0;
  background: color-mix(in srgb, var(--text) 6%, transparent);
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.tile-btn:hover,
.tile:hover {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  outline: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
}

.tile-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 22px;
  overflow: hidden;
}

.tile-icon.is-image {
  padding: 0;
  background: var(--bg-raised);
}

.tile-icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.tile-label {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1;
  padding: 4px 5px;
  font-size: 10px;
  line-height: 1.25;
  text-align: center;
  color: #f5f5f5;
  background: linear-gradient(
    180deg,
    transparent 0%,
    rgba(0, 0, 0, 0.55) 35%,
    rgba(0, 0, 0, 0.72) 100%
  );
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
}

.two-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  padding: 12px var(--content-gutter) 16px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.col {
  min-height: 220px;
  max-height: 100%;
}

.tile-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, var(--tile-size));
  gap: 8px;
  padding: 10px;
  overflow: auto;
  flex: 1;
  align-content: start;
  justify-content: start;
}

.tile-grid.in-col {
  max-height: none;
}

.browse {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: 10px var(--content-gutter) 16px;
  gap: 10px;
}

.browse-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.back-btn {
  flex: 0 0 auto;
  margin: 0;
  padding: 6px 12px;
  border-radius: 9px;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.back-btn:hover {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
  color: var(--accent);
}

.crumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.browse-hint {
  margin-left: auto;
  font-size: 11px;
  color: var(--muted);
}

.crumb-btn {
  margin: 0;
  padding: 4px 8px;
  border-radius: 8px;
  border: 0;
  background: transparent;
  color: var(--accent);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.crumb-btn.current {
  color: var(--text);
  font-weight: 650;
  cursor: default;
}

.crumb-sep {
  color: var(--muted);
  font-size: 12px;
}

.browse .tile-grid {
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--panel);
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    box-shadow 0.15s ease;
}

.browse-drop.is-drop {
  border-color: color-mix(in srgb, var(--accent) 70%, var(--line));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent);
  background: color-mix(in srgb, var(--accent) 10%, var(--panel));
}

.browse-drop.is-busy {
  opacity: 0.72;
  pointer-events: none;
}

.ctx {
  position: fixed;
  z-index: 50;
  min-width: 180px;
  max-width: min(280px, calc(100vw - 16px));
  max-height: calc(100vh - 16px);
  overflow-y: auto;
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

.modal-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: var(--color-modal-scrim, color-mix(in srgb, var(--void, #000) 45%, transparent));
}

.modal {
  width: min(360px, 100%);
  padding: 18px 16px 14px;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: var(--panel);
  box-shadow: 0 18px 48px color-mix(in srgb, var(--shadow, #000) 45%, transparent);
  color: var(--text);
}

.modal-title {
  margin: 0 0 6px;
  font-size: 16px;
  font-weight: 650;
}

.modal-desc {
  margin: 0 0 14px;
  font-size: 12px;
  color: var(--muted, color-mix(in srgb, var(--text) 55%, transparent));
}

.modal-confirm-msg {
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  color: var(--text);
}

.modal-input {
  box-sizing: border-box;
  width: 100%;
  margin: 0 0 14px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: color-mix(in srgb, var(--text) 4%, transparent);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  outline: none;
}

.modal-input:focus {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--line));
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.modal-btn {
  margin: 0;
  padding: 8px 14px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.modal-btn.primary {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  font-weight: 600;
}

.modal-btn.primary.danger {
  border-color: color-mix(in srgb, var(--danger) 45%, var(--line));
  background: color-mix(in srgb, var(--danger) 22%, transparent);
}

.modal-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.jimeng-modal {
  width: min(860px, 100%);
  max-height: min(80vh, 720px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.jimeng-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.jimeng-head .modal-title {
  margin: 0;
}

.jimeng-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.jimeng-filters {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}

.jimeng-filter {
  border: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}

.jimeng-filter.active {
  color: var(--text);
  border-color: color-mix(in srgb, var(--text) 35%, var(--line));
  background: color-mix(in srgb, var(--text) 8%, transparent);
}

.jimeng-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
  overflow: auto;
  flex: 1;
  min-height: 180px;
  padding: 2px;
}

.jimeng-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 8px;
  background: var(--row);
}

.jimeng-cover {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-raised);
  border: 0;
  padding: 0;
  cursor: zoom-in;
}

.jimeng-cover :deep(img),
.jimeng-cover :deep(.lazy-thumb),
.jimeng-cover :deep(.lazy-thumb-ph) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.jimeng-badge {
  position: absolute;
  top: 6px;
  left: 6px;
  font-size: 10px;
  line-height: 1;
  padding: 3px 6px;
  border-radius: 6px;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
}

.jimeng-badge.fav {
  background: rgba(30, 120, 90, 0.8);
}

.jimeng-badge.home {
  background: rgba(90, 90, 140, 0.8);
}

.jimeng-title {
  font-size: 11px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.jimeng-author {
  font-size: 10px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.jimeng-dl {
  width: 100%;
  padding: 6px 8px;
  font-size: 12px;
}
</style>
