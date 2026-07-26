<template>
  <div class="shell">
    <!-- 1. 应用头部 -->
    <ProjectToolbar :ctrl="ctrl.controllers.toolbar" />

    <div class="body">
      <!-- 最左：开发轨 + 活动栏（始终可见）-->
      <aside class="edge edge-left" aria-label="开发工具栏">
        <button
          type="button"
          class="zone-rail"
          :class="{ active: ctrl.state.layout.devOpen }"
          v-tip="ctrl.state.layout.devOpen ? '隐藏开发区' : '显示开发区'"
          @click="ctrl.toggleDevZone()"
        >
          开发</button>
        <ActivityBar :ctrl="ctrl" />
      </aside>

      <div ref="bodyEl" class="mid">
        <!-- 2. 开发区内容 -->
        <section
          v-show="ctrl.state.layout.devOpen"
          class="zone zone-dev"
          aria-label="开发"
          :style="devZoneStyle"
        >
          <ProjectNav
            :ctrl="ctrl.controllers.toolbar"
            :repos="ctrl.controllers.repos"
          />
          <div class="workspace">
            <div class="code-zone">
              <aside
                v-show="ctrl.state.layout.reviewSidebarOpen"
                class="tool"
                :class="`tool-${ctrl.state.leftTool}`"
                :style="{ width: `${ctrl.state.layout.treeWidth}px` }"
              >
                <FileTree
                  v-show="ctrl.state.leftTool === 'files'"
                  :ctrl="ctrl.controllers.tree"
                />
                <DifferTree
                  v-show="ctrl.state.leftTool === 'differ'"
                  :ctrl="ctrl.controllers.git"
                />
              </aside>
              <Splitter
                v-show="ctrl.state.layout.reviewSidebarOpen"
                axis="x"
                @drag="treeDrag.onDrag"
                @end="treeDrag.onEnd"
              />
              <div class="file-detail">
                <EditorTabs
                  v-show="ctrl.state.leftTool === 'files'"
                  :ctrl="ctrl.controllers.editor"
                />
                <DiffPane
                  v-show="ctrl.state.leftTool === 'differ'"
                  :ctrl="ctrl.controllers.git"
                />
              </div>
            </div>
            <BottomTerm :ctrl="ctrl.controllers.term" />
          </div>
        </section>

        <Splitter
          v-show="bothZonesOpen"
          axis="x"
          emphasis
          @drag="zoneDrag.onDrag"
          @end="zoneDrag.onEnd"
        />

        <!-- 9. 设计区内 -->
        <section
          v-show="ctrl.state.layout.designOpen"
          class="zone zone-design"
          aria-label="设计"
          :style="designZoneStyle"
        >
          <DesignProjectNav
            :ctrl="ctrl"
            :repos="ctrl.controllers.designRepos"
          />
          <DesignPane :ctrl="ctrl" />
        </section>
      </div>

      <!-- 最右：设计轨 + 活动栏（始终可见）-->
      <aside class="edge edge-right" aria-label="设计工具栏">
        <button
          type="button"
          class="zone-rail"
          :class="{ active: ctrl.state.layout.designOpen }"
          v-tip="ctrl.state.layout.designOpen ? '隐藏设计区' : '显示设计区'"
          @click="ctrl.toggleDesignZone()"
        >
          设计
        </button>
        <DesignActivityBar :ctrl="ctrl" />
      </aside>
    </div>

    <div class="status">
      <span>{{ ctrl.data.statusMessage || '就绪' }}</span>
      <span v-if="ctrl.state.saving" class="muted">保存中…</span>
      <div class="zones" role="group" aria-label="分区显隐">
        <button
          type="button"
          class="zone-btn"
          :class="{ active: ctrl.state.layout.devOpen }"
          v-tip="ctrl.state.layout.devOpen ? '隐藏开发区' : '显示开发区'"
          @click="ctrl.toggleDevZone()"
        >
          开发</button>
        <button
          type="button"
          class="zone-btn"
          :class="{ active: ctrl.state.layout.designOpen }"
          v-tip="ctrl.state.layout.designOpen ? '隐藏设计区' : '显示设计区'"
          @click="ctrl.toggleDesignZone()"
        >
          设计
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { CodeEditorShellCtrl } from './CodeEditorShellCtrl.ts';
import ProjectToolbar from '../components/ProjectToolbar/ProjectToolbar.vue';
import ProjectNav from '../components/ProjectNav/ProjectNav.vue';
import DesignProjectNav from '../components/ProjectNav/DesignProjectNav.vue';
import ActivityBar from '../components/ActivityBar/ActivityBar.vue';
import DesignActivityBar from '../components/DesignPane/DesignActivityBar.vue';
import FileTree from '../components/FileTree/FileTree.vue';
import DifferTree from '../components/DifferTree/DifferTree.vue';
import DiffPane from '../components/DifferTree/DiffPane.vue';
import EditorTabs from '../components/EditorTabs/EditorTabs.vue';
import BottomTerm from '../components/BottomTerm/BottomTerm.vue';
import DesignPane from '../components/DesignPane/DesignPane.vue';
import Splitter from '../components/Splitter.vue';
import { makeDrag } from '../pointerDrag.ts';

const ctrl = new CodeEditorShellCtrl();
const bodyEl = ref<HTMLElement | null>(null);

const bothZonesOpen = computed(
  () => ctrl.state.layout.devOpen && ctrl.state.layout.designOpen,
);

const devZoneStyle = computed(() => {
  if (!ctrl.state.layout.devOpen) return undefined;
  if (bothZonesOpen.value) {
    return { flex: `0 0 ${ctrl.state.layout.reviewPct}%` };
  }
  return { flex: '1 1 0' };
});

const designZoneStyle = computed(() => {
  if (!ctrl.state.layout.designOpen) return undefined;
  return { flex: '1 1 0' };
});

const zoneDrag = makeDrag(
  () => ctrl.state.layout.reviewPct,
  (base, dx) => {
    const w = bodyEl.value?.clientWidth || 1;
    ctrl.patchLayout({ reviewPct: base + (dx / w) * 100 });
  },
);

const treeDrag = makeDrag(
  () => ctrl.state.layout.treeWidth,
  (base, dx) => ctrl.patchLayout({ treeWidth: base + dx }),
);

onMounted(() => {
  void ctrl.bootstrap().then(() => {
    ctrl.controllers.editor.syncFromShell();
    ctrl.controllers.git.syncFromShell();
    ctrl.controllers.toolbar.syncFromShell();
    ctrl.controllers.repos.syncFromShell();
    ctrl.controllers.designRepos.syncFromShell();
  });
});
</script>

<style scoped>
.shell {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.edge {
  width: var(--activity-w);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--color-bg-sunken, var(--bg));
}

.edge-left {
  border-right: 1px solid var(--line);
}

.edge-right {
  border-left: 1px solid var(--line);
}

.zone-rail {
  height: var(--zone-rail-h, 40px);
  flex-shrink: 0;
  border: none;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
  color: var(--muted);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
  letter-spacing: 0.04em;
}

.zone-rail:hover {
  color: var(--cyan);
  background: var(--color-accent-soft);
}

.zone-rail.active {
  color: var(--cyan);
  box-shadow: inset 0 -2px 0 var(--cyan);
}

.edge :deep(.bar) {
  width: 100%;
  flex: 1;
  border: none;
  background: transparent;
}

.mid {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.zone {
  min-width: 200px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.zone-design {
  min-width: 240px;
}

.workspace {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.code-zone {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.tool {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  border-right: 1px solid var(--line);
  background: var(--side);
}

.tool :deep(.tree),
.tool :deep(.differ-tree) {
  width: 100%;
  height: 100%;
  border-right: none;
  flex: 1;
  min-height: 0;
}

.file-detail {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.status {
  display: flex;
  align-items: center;
  height: 22px;
  padding: 0 10px;
  border-top: 1px solid var(--line);
  background: var(--panel);
  color: var(--muted);
  font-size: 11px;
  flex-shrink: 0;
  gap: 8px;
}

.zones {
  margin-left: auto;
  display: flex;
  align-items: center;
  border: 1px solid var(--line);
  border-radius: 4px;
  overflow: hidden;
}

.zone-btn {
  border: none;
  border-right: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  padding: 1px 10px;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  line-height: 16px;
}

.zone-btn:last-child {
  border-right: none;
}

.zone-btn:hover {
  color: var(--cyan);
}

.zone-btn.active {
  color: var(--cyan);
  background: var(--color-accent-soft);
}

.muted {
  color: var(--muted);
}
</style>
