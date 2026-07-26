<template>
  <aside
    class="projects-panel glass-surface"
    :class="{ 'is-narrow': app.data.projectsWidth < 168 }"
    aria-label="项目"
  >
    <div class="scripts-head">
      <span id="projectsLabel">项目</span>
      <div class="scripts-head-actions">
        <input
          id="projectSearchInput"
          type="search"
          spellcheck="false"
          placeholder="模糊搜索…"
          aria-label="按名称或路径筛选项目"
          title="按名称或路径模糊筛选项目"
          :value="app.data.projectSearch"
          @input="app.setProjectSearch(($event.target as HTMLInputElement).value)"
        />
        <button type="button" class="btn primary" title="添加项目目录" @click="ctrl.onAdd()">
          添加
        </button>
      </div>
    </div>
    <div class="project-list" role="group" aria-labelledby="projectsLabel">
      <div v-if="!app.data.projects.length" class="empty" role="status">
        还没有项目，点「添加」或粘贴路径
      </div>
      <div v-else-if="!app.filteredProjects.length" class="empty" role="status">没有匹配的项目</div>
      <div
        v-for="p in app.filteredProjects"
        :key="p.dir"
        class="project-item"
        :class="{ active: ctrl.isActive(p.dir) }"
      >
        <button
          type="button"
          class="project-item-select"
          :aria-current="ctrl.isActive(p.dir) ? 'true' : undefined"
          :aria-label="`选择项目 ${p.name}`"
          :title="p.dir"
          @click="app.selectProject(p.dir)"
        >
          <div class="project-item-text">
            <div class="project-item-name">
              <span
                class="project-item-ratio"
                :class="{ hot: app.runningCountFor(p.dir) > 0 }"
                :title="`执行中 ${app.runningCountFor(p.dir)} / 共 ${p.scriptCount}`"
              >
                {{ app.runningCountFor(p.dir) }}/{{ p.scriptCount }}
              </span>
              <span class="project-item-title">{{ p.name }}</span>
            </div>
            <div class="project-item-dir">{{ p.dir }}</div>
          </div>
        </button>
        <button
          type="button"
          class="btn btn-remove"
          :aria-label="`移除项目 ${p.name}`"
          title="从列表移除"
          @click="ctrl.askRemove(p.dir)"
        >
          ×
        </button>
      </div>
    </div>
    <div class="project-add-path">
      <input
        :value="ctrl.state.pathInput"
        type="text"
        spellcheck="false"
        aria-label="粘贴项目路径后回车添加"
        placeholder="粘贴路径后回车添加"
        @input="ctrl.setState({ pathInput: ($event.target as HTMLInputElement).value })"
        @keydown.enter.prevent="ctrl.onPathEnter()"
      />
    </div>
  </aside>

  <Teleport to="body">
    <div v-if="ctrl.state.confirmDir" class="modal" @keydown="ctrl.onConfirmKey($event)">
      <div class="modal-backdrop" @click="ctrl.cancelRemove()"></div>
      <div
        ref="confirmCard"
        class="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="removeProjectTitle"
        tabindex="-1"
      >
        <div class="modal-title" id="removeProjectTitle">移除项目</div>
        <div class="modal-message">
          确定从列表移除该项目？
          <br /><br />
          <strong>{{ ctrl.confirmName }}</strong>
          <br />
          {{ ctrl.state.confirmDir }}
          <br /><br />
          不会删除磁盘上的文件。
        </div>
        <div class="modal-actions">
          <button type="button" class="btn" @click="ctrl.cancelRemove()">取消</button>
          <button type="button" class="btn danger solid" @click="ctrl.confirmRemove()">移除</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script lang="ts" setup>
import { inject, ref, watch } from 'vue';
import { APP_CTRL_KEY } from '../../appContext';

const app = inject(APP_CTRL_KEY)!;
const ctrl = app.controllers.projects;
const confirmCard = ref<HTMLElement | null>(null);

watch(
  () => ctrl.state.confirmDir,
  (dir) => {
    if (dir) void ctrl.focusConfirmDanger(confirmCard.value);
  },
);
</script>

<style lang="less" scoped></style>
