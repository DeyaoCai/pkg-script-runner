<template>
  <section class="log-panel glass-surface">
    <div class="scripts-head" id="logPanelHead">
      <span id="logPanelLabel">{{ ctrl.label }}</span>
      <div class="scripts-head-actions">
        <button
          type="button"
          class="btn toggle-btn"
          :class="{ active: app.data.persistLogs }"
          title="切换脚本日志落盘（写入托盘配置）"
          @click="ctrl.togglePersistLogs()"
        >
          落盘{{ app.data.persistLogs ? '开' : '关' }}
        </button>
        <button type="button" class="btn" title="打开落盘日志目录" @click="ctrl.openLogsDir()">
          目录
        </button>
        <button type="button" class="btn" title="清除已落盘的日志文件" @click="ctrl.clearDisk()">
          清记录
        </button>
        <button type="button" class="btn" title="清空当前输出框" @click="app.clearActiveLog()">
          清空
        </button>
      </div>
    </div>

    <div class="log-tabs-wrap">
      <div class="log-tabs" role="tablist" aria-label="输出标签">
        <div
          v-for="s in app.visibleLogs"
          :key="s.id"
          class="log-tab"
          :class="{ active: app.data.activeLogId === s.id, running: s.running }"
          role="tab"
          :tabindex="app.data.activeLogId === s.id ? 0 : -1"
          :data-log-tab="s.id"
          :aria-selected="app.data.activeLogId === s.id"
          :aria-label="s.title"
          @click="ctrl.selectTab(s.id)"
          @keydown="ctrl.onTabKeydown($event, s.id)"
        >
          <span class="log-tab-label">{{ s.title }}</span>
          <button
            v-if="s.kind === 'job'"
            type="button"
            class="log-tab-restart"
            aria-label="重启"
            title="重新运行"
            @click.stop="app.restartJob(s.id)"
          >
            ↻
          </button>
          <button
            v-if="!ctrl.isSystem(s.id) && s.running"
            type="button"
            class="log-tab-stop"
            aria-label="停止"
            :title="s.kind === 'shell' ? '强制结束终端' : '停止此脚本'"
            @click.stop="app.stopJob(s.id)"
          >
            ■
          </button>
          <button
            v-else-if="!ctrl.isSystem(s.id)"
            type="button"
            class="log-tab-close"
            :aria-label="`关闭 ${s.title}`"
            :title="s.kind === 'shell' ? '关闭 Shell' : '关闭此输出'"
            @click.stop="app.closeSession(s.id)"
          >
            ×
          </button>
        </div>
      </div>
      <button
        type="button"
        class="log-tab-add"
        title="新建交互终端（当前项目目录）"
        aria-label="新建 Shell"
        @click="app.openShell()"
      >
        +
      </button>
      <span
        class="log-tab-layout"
        :data-layout="app.data.settings.shellLayout === 'grid' ? 'grid' : 'single'"
        :title="
          app.data.settings.shellLayout === 'grid'
            ? 'Shell 布局：网格（在托盘设置中修改）'
            : 'Shell 布局：单个（在托盘设置中修改）'
        "
      >
        {{ app.data.settings.shellLayout === 'grid' ? '网格' : '单个' }}
      </span>
    </div>

    <div v-if="!ctrl.paneMode" class="log-views">
      <div
        v-for="s in app.visibleLogs"
        :key="s.id"
        class="log-view"
        :hidden="app.data.activeLogId !== s.id"
        :data-log-id="s.id"
      >
        <div v-if="!s.text" class="empty log-empty-hint">
          双击或 Enter 运行脚本 · 输出会出现在这里
        </div>
        <pre
          v-else
          class="log"
          tabindex="0"
          role="textbox"
          aria-readonly="true"
          :data-log-id="s.id"
          v-html="app.getSessionHtml(s)"
        />
      </div>
    </div>

    <div v-else class="log-views" :class="ctrl.viewsClass">
      <div
        v-for="s in ctrl.panes"
        :key="s.id"
        class="shell-pane"
        :class="{
          'is-active': app.data.activeLogId === s.id,
          'is-running': s.running,
          'is-job-pane': s.kind === 'job',
        }"
        :data-log-id="s.id"
        @click="ctrl.selectTab(s.id)"
      >
        <div class="shell-pane-head">
          <span class="shell-pane-title">{{ s.title }}</span>
          <div class="shell-pane-actions">
            <button
              v-if="s.kind === 'job'"
              type="button"
              class="shell-pane-btn"
              title="重新运行"
              aria-label="重启"
              @click.stop="app.restartJob(s.id)"
            >
              ↻
            </button>
            <button
              v-if="s.running"
              type="button"
              class="shell-pane-btn"
              :title="s.kind === 'shell' ? '强制结束终端' : '停止此脚本'"
              aria-label="停止"
              @click.stop="app.stopJob(s.id)"
            >
              ■
            </button>
            <button
              v-else
              type="button"
              class="shell-pane-btn"
              title="关闭"
              :aria-label="`关闭 ${s.title}`"
              @click.stop="app.closeSession(s.id)"
            >
              ×
            </button>
          </div>
        </div>
        <TerminalView
          v-if="s.kind === 'shell'"
          :session-id="s.id"
          :active="app.data.activeLogId === s.id || ctrl.mosaicMode"
        />
        <pre
          v-else
          class="log"
          tabindex="0"
          role="textbox"
          aria-readonly="true"
          :data-log-id="s.id"
          v-html="app.getSessionHtml(s)"
        />
      </div>
    </div>
  </section>
</template>

<script lang="ts" setup>
import { inject } from 'vue';
import { APP_CTRL_KEY } from '../../appContext';
import TerminalView from '../TerminalView/TerminalView.vue';

const app = inject(APP_CTRL_KEY)!;
const ctrl = app.controllers.log;
</script>

<style lang="less" scoped></style>
