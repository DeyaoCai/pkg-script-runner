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
        <input
          v-if="ctrl.mode === 'scripts'"
          id="searchInput"
          type="search"
          spellcheck="false"
          placeholder="模糊或 /正则/"
          aria-label="按脚本名或命令筛选；可用 /pattern/flags 正则"
          title="模糊匹配脚本名/命令；正则请写 /dev|build/i"
          :value="app.data.scriptSearch"
          @input="app.setScriptSearch(($event.target as HTMLInputElement).value)"
        />
        <button
          v-else-if="ctrl.mode === 'running'"
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
      <div v-if="!app.data.project" class="empty" role="status">在标题栏选择项目以查看 scripts</div>
      <div v-else-if="!app.data.project.scripts.length" class="empty" role="status">
        package.json 里没有 scripts
      </div>
      <div v-else-if="!app.filteredScripts.length" class="empty" role="status">没有匹配的脚本</div>
      <div
        v-for="s in app.filteredScripts"
        :key="s.name"
        class="script-row"
        :class="{
          'is-running': ctrl.isRunning(s.name),
          'is-stopping': ctrl.isStopping(s.name),
          'is-favorited': ctrl.isFavoriteCurrent(s.name),
        }"
        role="button"
        tabindex="0"
        :data-script="s.name"
        :title="s.command"
        :aria-label="ctrl.actionLabel(s.name)"
        :aria-pressed="ctrl.isRunning(s.name)"
        :aria-busy="ctrl.isStopping(s.name)"
        @click="ctrl.onClick($event, s.name)"
        @dblclick.prevent="ctrl.onActivate(s.name)"
        @keydown.enter.prevent="ctrl.onActivate(s.name)"
        @mouseenter="ctrl.showPop($event, s.name, s.command)"
        @mouseleave="ctrl.scheduleHide()"
      >
        <span
          class="script-run-status"
          aria-hidden="true"
          :title="
            ctrl.isStopping(s.name) ? '正在停止…' : ctrl.isRunning(s.name) ? '运行中' : undefined
          "
        ></span>
        <span class="script-name">{{ s.name }}</span>
        <button
          type="button"
          class="script-fav-btn"
          :class="{ 'is-on': ctrl.isFavoriteCurrent(s.name) }"
          :title="ctrl.isFavoriteCurrent(s.name) ? '取消收藏' : '加入收藏'"
          :aria-label="ctrl.isFavoriteCurrent(s.name) ? '取消收藏' : '加入收藏'"
          :aria-pressed="ctrl.isFavoriteCurrent(s.name)"
          @click="ctrl.onToggleFavoriteCurrent($event, s.name)"
        >
          ★
        </button>
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
      <div
        v-for="g in ctrl.runningGroups"
        :key="g.dir"
        class="script-job-group"
      >
        <div class="script-job-group-head" :title="g.dir">
          <span class="script-job-group-label">{{ g.label }}</span>
          <span class="script-job-group-count">{{ g.jobs.length }}</span>
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
      </div>
    </div>

    <div v-else class="scripts" role="group" aria-labelledby="scriptsLabel">
      <div v-if="!ctrl.data.favorites.length" class="empty" role="status">
        在「脚本」列表点 ★ 加入收藏
      </div>
      <div
        v-for="g in ctrl.favoriteGroups"
        :key="g.dir"
        class="script-job-group"
      >
        <div class="script-job-group-head" :title="g.dir">
          <span class="script-job-group-label">{{ g.label }}</span>
          <span class="script-job-group-count">{{ g.jobs.length }}</span>
        </div>
        <div
          v-for="f in g.jobs"
          :key="`${f.dir}::${f.scriptName}`"
          class="script-row script-row-job"
          :class="{
            'is-running': ctrl.isFavRunning(f.dir, f.scriptName),
            'is-stopping': ctrl.isFavStopping(f.dir, f.scriptName),
          }"
          role="button"
          tabindex="0"
          :title="f.dir"
          :aria-label="`${g.label} · ${f.scriptName}`"
          :aria-busy="ctrl.isFavStopping(f.dir, f.scriptName)"
          @click="ctrl.onClickFav($event, f.dir, f.scriptName)"
          @dblclick.prevent="ctrl.onActivateFav(f.dir, f.scriptName)"
          @keydown.enter.prevent="ctrl.onActivateFav(f.dir, f.scriptName)"
        >
          <span
            class="script-run-status"
            aria-hidden="true"
            :title="
              ctrl.isFavStopping(f.dir, f.scriptName)
                ? '正在停止…'
                : ctrl.isFavRunning(f.dir, f.scriptName)
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
          ctrl.isStopping(ctrl.state.popover.name)
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
