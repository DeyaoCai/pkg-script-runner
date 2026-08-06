<template>
  <section class="scripts-panel glass-surface" aria-labelledby="scriptsLabel">
    <div class="scripts-mode-bar" role="group" aria-label="脚本列模式">
      <div class="seg scripts-mode-seg">
        <button
          type="button"
          class="seg-btn scripts-mode-ico-btn"
          :class="{ 'is-active': ctrl.mode === 'scripts' }"
          title="脚本"
          aria-label="脚本"
          @click="ctrl.setMode('scripts')"
        >
          <svg class="scripts-mode-ico" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M7 6.5h10a1 1 0 0 1 0 2H7a1 1 0 1 1 0-2Zm0 4.5h10a1 1 0 0 1 0 2H7a1 1 0 1 1 0-2Zm0 4.5h7a1 1 0 0 1 0 2H7a1 1 0 1 1 0-2Z"
            />
          </svg>
        </button>
        <button
          type="button"
          class="seg-btn scripts-mode-ico-btn"
          :class="{ 'is-active': ctrl.mode === 'running' }"
          title="运行中"
          aria-label="运行中"
          @click="ctrl.setMode('running')"
        >
          <svg class="scripts-mode-ico" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M8.2 5.4a1.2 1.2 0 0 1 1.9-.9l9 5.6a1.2 1.2 0 0 1 0 2.1l-9 5.6a1.2 1.2 0 0 1-1.9-.9V5.4Z"
            />
          </svg>
          <span v-if="ctrl.runningCount" class="scripts-mode-count">{{ ctrl.runningCount }}</span>
        </button>
        <button
          type="button"
          class="seg-btn scripts-mode-ico-btn"
          :class="{ 'is-active': ctrl.mode === 'favorites' }"
          title="收藏"
          aria-label="收藏"
          @click="ctrl.setMode('favorites')"
        >
          <svg class="scripts-mode-ico" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="m12 4.2 2.3 4.7 5.2.8-3.8 3.7.9 5.2L12 16.1l-4.6 2.5.9-5.2-3.8-3.7 5.2-.8L12 4.2Z"
            />
          </svg>
          <span v-if="ctrl.favoriteCount" class="scripts-mode-count">{{
            ctrl.favoriteCount
          }}</span>
        </button>
      </div>
    </div>

    <div class="scripts-head">
      <span id="scriptsLabel">{{ ctrl.label }}</span>
      <div class="scripts-head-actions">
        <button
          v-if="ctrl.mode === 'running'"
          type="button"
          class="btn"
          :disabled="!ctrl.runningCount"
          title="停止全部运行中的脚本"
          @click="ctrl.onStopAll()"
        >
          全部停止
        </button>
      </div>
    </div>

    <div
      v-if="ctrl.mode === 'scripts'"
      class="scripts"
      role="group"
      aria-labelledby="scriptsLabel"
    >
      <div v-if="!app.data.workspaceRoot" class="empty" role="status">选择工作区以查看 scripts</div>
      <div v-else-if="!app.data.projects.length" class="empty" role="status">
        工作区内未发现仓库
      </div>
      <div v-else-if="!ctrl.scriptGroups.length" class="empty" role="status">没有匹配的脚本</div>
      <div
        v-for="g in ctrl.scriptGroups"
        :key="g.dir"
        class="script-job-group"
        :class="{ 'is-collapsed': ctrl.isGroupCollapsed(g.dir) }"
      >
        <button
          type="button"
          class="script-job-group-head"
          :title="g.dir"
          :aria-expanded="!ctrl.isGroupCollapsed(g.dir)"
          @click="ctrl.onToggleGroup($event, g.dir)"
        >
          <span class="script-job-group-caret" aria-hidden="true">{{
            ctrl.isGroupCollapsed(g.dir) ? '▸' : '▾'
          }}</span>
          <span class="script-job-group-label">{{ g.label }}</span>
          <span class="script-job-group-count">{{ g.jobs.length }}</span>
        </button>
        <template v-if="!ctrl.isGroupCollapsed(g.dir)">
          <div v-if="!g.jobs.length" class="empty script-group-empty" role="status">
            没有 scripts
          </div>
          <div
            v-for="s in g.jobs"
            :key="`${s.dir}::${s.scriptName}`"
            class="script-row script-row-job"
            :class="{
              'is-running': ctrl.isRunning(s.dir, s.scriptName),
              'is-stopping': ctrl.isStopping(s.dir, s.scriptName),
              'is-favorited': ctrl.isFavorite(s.dir, s.scriptName),
            }"
            role="button"
            tabindex="0"
            :data-script="s.scriptName"
            :title="s.command"
            :aria-label="ctrl.actionLabel(s.dir, s.scriptName)"
            :aria-pressed="ctrl.isRunning(s.dir, s.scriptName)"
            :aria-busy="ctrl.isStopping(s.dir, s.scriptName)"
            @click="ctrl.onClick($event, s.dir, s.scriptName)"
            @dblclick.prevent="ctrl.onActivate(s.dir, s.scriptName)"
            @keydown.enter.prevent="ctrl.onActivate(s.dir, s.scriptName)"
            @mouseenter="ctrl.showPop($event, s.dir, s.scriptName, s.command)"
            @mouseleave="ctrl.scheduleHide()"
          >
            <span
              class="script-run-status"
              aria-hidden="true"
              :title="
                ctrl.isStopping(s.dir, s.scriptName)
                  ? '正在停止…'
                  : ctrl.isRunning(s.dir, s.scriptName)
                    ? '运行中'
                    : undefined
              "
            ></span>
            <span class="script-job-meta">
              <span class="script-name">{{ s.scriptName }}</span>
            </span>
            <button
              type="button"
              class="script-fav-btn"
              :class="{ 'is-on': ctrl.isFavorite(s.dir, s.scriptName) }"
              :title="ctrl.isFavorite(s.dir, s.scriptName) ? '取消收藏' : '加入收藏'"
              :aria-label="ctrl.isFavorite(s.dir, s.scriptName) ? '取消收藏' : '加入收藏'"
              :aria-pressed="ctrl.isFavorite(s.dir, s.scriptName)"
              @click="ctrl.onToggleFavorite($event, s.dir, s.scriptName)"
            >
              ★
            </button>
          </div>
        </template>
      </div>
    </div>

    <div
      v-else-if="ctrl.mode === 'running'"
      class="scripts"
      role="group"
      aria-labelledby="scriptsLabel"
    >
      <div v-if="!app.activeJobsList.length" class="empty" role="status">
        当前没有运行中的脚本
      </div>
      <div v-else-if="!ctrl.runningGroups.length" class="empty" role="status">没有匹配的运行项</div>
      <div
        v-for="g in ctrl.runningGroups"
        :key="g.dir"
        class="script-job-group"
        :class="{ 'is-collapsed': ctrl.isGroupCollapsed(g.dir) }"
      >
        <div class="script-job-group-head" :title="g.dir">
          <button
            type="button"
            class="script-job-group-toggle"
            :aria-expanded="!ctrl.isGroupCollapsed(g.dir)"
            :aria-label="ctrl.isGroupCollapsed(g.dir) ? '展开' : '折叠'"
            @click="ctrl.onToggleGroup($event, g.dir)"
          >
            <span class="script-job-group-caret" aria-hidden="true">{{
              ctrl.isGroupCollapsed(g.dir) ? '▸' : '▾'
            }}</span>
            <span class="script-job-group-label">{{ g.label }}</span>
            <span class="script-job-group-count">{{ g.jobs.length }}</span>
          </button>
          <button
            type="button"
            class="script-job-group-stop"
            :disabled="g.jobs.every((j) => j.stopping)"
            :title="`停止 ${g.label} 下全部`"
            @click="ctrl.onStopGroup($event, g.dir)"
          >
            停组
          </button>
        </div>
        <template v-if="!ctrl.isGroupCollapsed(g.dir)">
          <div
            v-for="j in g.jobs"
            :key="j.id"
            class="script-row script-row-job"
            :class="{
              'is-running': !j.stopping,
              'is-stopping': j.stopping,
              'is-active-log': app.data.activeLogId === j.id,
            }"
            role="button"
            tabindex="0"
            :title="j.dir"
            :aria-label="`${g.label} · ${j.scriptName}`"
            :aria-busy="j.stopping"
            @click="ctrl.onFocusJob(j.id)"
            @keydown.enter.prevent="ctrl.onFocusJob(j.id)"
          >
            <span
              class="script-run-status"
              aria-hidden="true"
              :title="j.stopping ? '正在停止…' : '运行中'"
            ></span>
            <span class="script-job-meta">
              <span class="script-name">{{ j.scriptName }}</span>
            </span>
            <button
              type="button"
              class="script-job-stop"
              :disabled="j.stopping"
              :title="j.stopping ? '正在停止…' : `停止 ${j.scriptName}`"
              @click="ctrl.onStopJob($event, j.id)"
            >
              {{ j.stopping ? '…' : '停' }}
            </button>
          </div>
        </template>
      </div>
    </div>

    <div v-else class="scripts" role="group" aria-labelledby="scriptsLabel">
      <div v-if="!ctrl.data.favorites.length" class="empty" role="status">
        在「脚本」列表点 ★ 加入收藏
      </div>
      <div v-else-if="!ctrl.favoriteGroups.length" class="empty" role="status">没有匹配的收藏</div>
      <div
        v-for="g in ctrl.favoriteGroups"
        :key="g.dir"
        class="script-job-group"
        :class="{ 'is-collapsed': ctrl.isGroupCollapsed(g.dir) }"
      >
        <button
          type="button"
          class="script-job-group-head"
          :title="g.dir"
          :aria-expanded="!ctrl.isGroupCollapsed(g.dir)"
          @click="ctrl.onToggleGroup($event, g.dir)"
        >
          <span class="script-job-group-caret" aria-hidden="true">{{
            ctrl.isGroupCollapsed(g.dir) ? '▸' : '▾'
          }}</span>
          <span class="script-job-group-label">{{ g.label }}</span>
          <span class="script-job-group-count">{{ g.jobs.length }}</span>
        </button>
        <template v-if="!ctrl.isGroupCollapsed(g.dir)">
          <div
            v-for="f in g.jobs"
            :key="`${f.dir}::${f.scriptName}`"
            class="script-row script-row-job"
            :class="{
              'is-running': ctrl.isRunning(f.dir, f.scriptName),
              'is-stopping': ctrl.isStopping(f.dir, f.scriptName),
            }"
            role="button"
            tabindex="0"
            :title="f.dir"
            :aria-label="`${g.label} · ${f.scriptName}`"
            :aria-busy="ctrl.isStopping(f.dir, f.scriptName)"
            @click="ctrl.onClickFav($event, f.dir, f.scriptName)"
            @dblclick.prevent="ctrl.onActivateFav(f.dir, f.scriptName)"
            @keydown.enter.prevent="ctrl.onActivateFav(f.dir, f.scriptName)"
          >
            <span
              class="script-run-status"
              aria-hidden="true"
              :title="
                ctrl.isStopping(f.dir, f.scriptName)
                  ? '正在停止…'
                  : ctrl.isRunning(f.dir, f.scriptName)
                    ? '运行中'
                    : undefined
              "
            ></span>
            <span class="script-job-meta">
              <span class="script-name">{{ f.scriptName }}</span>
            </span>
            <button
              type="button"
              class="script-fav-btn is-on"
              title="取消收藏"
              aria-label="取消收藏"
              aria-pressed="true"
              @click="ctrl.onToggleFavorite($event, f.dir, f.scriptName)"
            >
              ★
            </button>
          </div>
        </template>
      </div>
    </div>
  </section>

  <Teleport to="body">
    <div
      v-if="ctrl.state.popover && ctrl.mode === 'scripts'"
      class="script-popover"
      role="tooltip"
      :style="{ left: ctrl.state.popover.x + 'px', top: ctrl.state.popover.y + 'px' }"
    >
      <div class="script-popover-name">{{ ctrl.state.popover.name }}</div>
      <pre class="script-popover-cmd">{{ ctrl.state.popover.command }}</pre>
      <div class="script-popover-hint">
        {{
          ctrl.isStopping(ctrl.state.popover.dir, ctrl.state.popover.name)
            ? '正在停止…'
            : ctrl.state.popover.running
              ? '双击或 Enter 停止'
              : '双击或 Enter 运行'
        }}
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
