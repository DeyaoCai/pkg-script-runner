<template>
  <section class="scripts-panel glass-surface" aria-labelledby="scriptsLabel">
    <div class="scripts-head">
      <span id="scriptsLabel">{{ ctrl.label }}</span>
      <div class="scripts-head-actions">
        <input
          id="searchInput"
          type="search"
          spellcheck="false"
          placeholder="模糊搜索…"
          aria-label="按脚本名或命令筛选"
          title="按脚本名或命令模糊筛选"
          :value="app.data.scriptSearch"
          @input="app.setScriptSearch(($event.target as HTMLInputElement).value)"
        />
      </div>
    </div>
    <div class="scripts" role="group" aria-labelledby="scriptsLabel">
      <div v-if="!app.data.project" class="empty" role="status">选择左侧项目以查看 scripts</div>
      <div v-else-if="!app.data.project.scripts.length" class="empty" role="status">
        package.json 里没有 scripts
      </div>
      <div v-else-if="!app.filteredScripts.length" class="empty" role="status">没有匹配的脚本</div>
      <button
        v-for="s in app.filteredScripts"
        :key="s.name"
        type="button"
        class="script-row"
        :class="{ 'is-running': ctrl.isRunning(s.name) }"
        :data-script="s.name"
        :title="s.command"
        :aria-label="ctrl.actionLabel(s.name)"
        :aria-pressed="ctrl.isRunning(s.name)"
        @click="ctrl.onClick($event, s.name)"
        @dblclick.prevent="ctrl.onActivate(s.name)"
        @mouseenter="ctrl.showPop($event, s.name, s.command)"
        @mouseleave="ctrl.scheduleHide()"
      >
        <span
          class="script-run-status"
          aria-hidden="true"
          :title="ctrl.isRunning(s.name) ? '运行中' : undefined"
        ></span>
        <span class="script-name">{{ s.name }}</span>
      </button>
    </div>
  </section>

  <Teleport to="body">
    <div
      v-if="ctrl.state.popover"
      class="script-popover"
      role="tooltip"
      :style="{ left: ctrl.state.popover.x + 'px', top: ctrl.state.popover.y + 'px' }"
    >
      <div class="script-popover-name">{{ ctrl.state.popover.name }}</div>
      <pre class="script-popover-cmd">{{ ctrl.state.popover.command }}</pre>
      <div class="script-popover-hint">
        {{ ctrl.state.popover.running ? '双击或 Enter 停止' : '双击或 Enter 运行' }}
      </div>
    </div>
  </Teleport>
</template>

<script lang="ts" setup>
import { inject } from 'vue';
import { APP_CTRL_KEY } from '../../appContext';

const app = inject(APP_CTRL_KEY)!;
const ctrl = app.controllers.scripts;
</script>

<style lang="less" scoped></style>
