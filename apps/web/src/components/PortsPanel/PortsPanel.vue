<template>
  <Teleport to="body">
    <div
      v-if="ctrl.state.open"
      class="modal ports-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="portsModalTitle"
    >
      <div class="modal-backdrop" @click="ctrl.close()"></div>
      <div class="modal-card ports-card glass-surface" @click.stop>
        <div class="modal-title-row">
          <div id="portsModalTitle" class="modal-title">端口管理</div>
          <div class="modal-title-actions">
            <button
              type="button"
              class="btn"
              :disabled="ctrl.state.loading"
              title="重新扫描监听端口"
              @click="ctrl.refresh()"
            >
              {{ ctrl.state.loading ? '扫描中…' : '刷新' }}
            </button>
            <button type="button" class="btn" @click="ctrl.close()">关闭</button>
          </div>
        </div>

        <p class="ports-lead">
          对照 Runner 托管的脚本 / Shell，标出未托管的漂移监听。结束会杀进程树。
        </p>

        <div class="ports-toolbar">
          <div class="ports-filters" role="group" aria-label="归属筛选">
            <button
              v-for="f in filterChips"
              :key="f.id"
              type="button"
              class="btn toggle-btn"
              :class="{ active: ctrl.state.filter === f.id }"
              :title="f.title"
              @click="ctrl.setFilter(f.id)"
            >
              {{ f.label }}
              <span class="chip-n">{{ f.count }}</span>
            </button>
          </div>
          <div class="ports-actions">
            <button
              type="button"
              class="btn toggle-btn"
              :class="{ active: ctrl.state.nodeOnly }"
              title="默认开启：只显示 node / vite / deno / bun 等开发进程"
              @click="ctrl.setNodeOnly(!ctrl.state.nodeOnly)"
            >
              仅 Node
            </button>
            <button
              type="button"
              class="btn danger"
              :disabled="ctrl.state.reaping || nodeOrphanCount === 0"
              title="清理漂移的 Node/Vite 等开发服务进程"
              @click="ctrl.askReap(true)"
            >
              {{ ctrl.state.reaping ? '清理中…' : '清 Node 漂移' }}
            </button>
          </div>
        </div>

        <div class="ports-search-row">
          <input
            type="search"
            class="ports-search"
            spellcheck="false"
            placeholder="过滤端口 / PID / 进程名…"
            aria-label="过滤端口、PID 或进程名"
            :value="ctrl.state.query"
            @input="ctrl.setQuery(($event.target as HTMLInputElement).value)"
          />
          <button
            v-if="ctrl.state.query"
            type="button"
            class="btn"
            title="清除搜索"
            @click="ctrl.setQuery('')"
          >
            清除
          </button>
        </div>

        <div v-if="ctrl.state.error" class="ports-error" role="alert">{{ ctrl.state.error }}</div>
        <div v-else-if="ctrl.state.status" class="ports-status">{{ ctrl.state.status }}</div>

        <div class="ports-table-wrap">
          <table class="ports-table" v-if="ctrl.visiblePorts.length">
            <thead>
              <tr>
                <th>端口</th>
                <th>归属</th>
                <th>进程</th>
                <th>PID</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="p in ctrl.visiblePorts"
                :key="`${p.port}-${p.pid}-${p.localAddress}`"
                :class="{ orphan: p.owner === 'unmanaged' }"
              >
                <td class="mono">{{ p.port }}</td>
                <td>
                  <span class="owner" :data-owner="p.owner">{{ ctrl.ownerLabel(p.owner) }}</span>
                  <span v-if="p.jobId || p.shellId" class="ref" :title="p.jobId || p.shellId">
                    {{ shortRef(p.jobId || p.shellId || '') }}
                  </span>
                </td>
                <td class="proc" :title="`${p.processName} · ${p.localAddress}`">
                  {{ p.processName }}
                </td>
                <td class="mono dim">{{ p.pid }}</td>
                <td class="kill-cell">
                  <button
                    v-if="ctrl.canKill(p)"
                    type="button"
                    class="btn danger"
                    :disabled="ctrl.isKilling(p) || ctrl.hasKillConfirm(p)"
                    title="结束该端口进程树"
                    @click="ctrl.askKillPort(p)"
                  >
                    {{
                      ctrl.isKilling(p)
                        ? '结束中…'
                        : ctrl.hasKillConfirm(p)
                          ? '待确认'
                          : '结束'
                    }}
                  </button>
                  <span v-else class="dim">—</span>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="ports-empty">
            {{
              ctrl.state.loading
                ? '正在扫描…'
                : ctrl.state.query || ctrl.state.filter !== 'all'
                  ? '没有匹配的监听端口（试试放宽筛选）'
                  : '没有监听端口'
            }}
          </div>
        </div>
      </div>

      <!-- 不挡列表：可继续点「结束」往栈上叠 -->
      <div
        v-if="ctrl.state.confirms.length"
        class="ports-confirm-stack"
        aria-live="polite"
      >
        <div
          v-for="(c, i) in ctrl.state.confirms"
          :key="c.id"
          class="ports-confirm-card glass-surface"
          role="alertdialog"
          aria-modal="false"
          :style="stackStyle(i, ctrl.state.confirms.length)"
          @click.stop
        >
          <div class="ports-confirm-title">
            确认操作
            <span v-if="ctrl.state.confirms.length > 1" class="ports-confirm-n">
              {{ i + 1 }}/{{ ctrl.state.confirms.length }}
            </span>
          </div>
          <p class="ports-confirm-msg">{{ c.message }}</p>
          <div class="ports-confirm-actions">
            <button type="button" class="btn" @click="ctrl.cancelConfirm(c.id)">取消</button>
            <button type="button" class="btn danger solid" @click="ctrl.acceptConfirm(c.id)">
              确定
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script lang="ts" setup>
import { computed, inject, onBeforeUnmount, onMounted } from 'vue';
import { isNodeishProcess } from '@pkg-runner/shared/nodeishProcess';
import { APP_CTRL_KEY } from '../../appContext';
import type { PortsOwnerFilter } from './PortsPanelCtrl';

const app = inject(APP_CTRL_KEY)!;
const ctrl = app.controllers.ports;

/** 清漂移目标数（始终按 Node 系 unmanaged，与列表开关无关） */
const nodeOrphanCount = computed(
  () =>
    ctrl.state.ports.filter(
      (p) => p.owner === 'unmanaged' && isNodeishProcess(p.processName),
    ).length,
);

const filterChips = computed(() => {
  const chips: Array<{
    id: PortsOwnerFilter;
    label: string;
    title: string;
    count: number;
  }> = [
    {
      id: 'all',
      label: '全部',
      title: '显示全部监听',
      count: ctrl.countByOwner('all'),
    },
    {
      id: 'unmanaged',
      label: '漂移',
      title: '未托管监听（端口漂移）',
      count: ctrl.countByOwner('unmanaged'),
    },
    {
      id: 'job',
      label: '脚本',
      title: 'Runner 脚本任务',
      count: ctrl.countByOwner('job'),
    },
    {
      id: 'shell',
      label: 'Shell',
      title: '交互终端相关',
      count: ctrl.countByOwner('shell'),
    },
    {
      id: 'self',
      label: '自身',
      title: 'Runner / 控制面自身',
      count: ctrl.countByOwner('self'),
    },
  ];
  return chips;
});

function shortRef(id: string): string {
  if (id.startsWith('shell::')) return 'shell';
  const parts = id.split('::');
  return parts[parts.length - 1] || id;
}

function stackStyle(index: number, total: number): Record<string, string> {
  // 后入在上；下面的卡片略偏移露出叠层
  const fromTop = total - 1 - index;
  const x = fromTop * 10;
  const y = fromTop * 10;
  return {
    zIndex: String(10 + index),
    transform: `translate(${x}px, ${y}px)`,
  };
}

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || !ctrl.state.open) return;
  if (ctrl.state.confirms.length) {
    ctrl.cancelConfirm();
    return;
  }
  ctrl.close();
}

onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<style lang="less" scoped>
.ports-modal {
  z-index: 320;
}

.ports-confirm-stack {
  position: absolute;
  right: 28px;
  bottom: 28px;
  z-index: 8;
  width: min(380px, calc(100% - 48px));
  height: 0;
  pointer-events: none;
}

.ports-confirm-card {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 100%;
  padding: 16px 18px 14px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--panel);
  box-shadow: 0 12px 40px color-mix(in srgb, #000 35%, transparent);
  pointer-events: auto;
}

.ports-confirm-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: var(--fs-14);
  font-weight: 700;
  margin-bottom: 8px;
}

.ports-confirm-n {
  font-size: var(--fs-12);
  font-weight: 600;
  color: var(--muted);
}

.ports-confirm-msg {
  margin: 0 0 14px;
  font-size: var(--fs-13);
  line-height: 1.45;
  color: var(--text);
}

.ports-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.ports-card {
  width: min(720px, 100%);
  max-height: min(80vh, 640px);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.ports-lead {
  margin: 0 0 10px;
  font-size: var(--fs-12);
  color: var(--muted);
  line-height: 1.45;
}

.ports-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.ports-filters,
.ports-actions {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}

.ports-filters .chip-n {
  margin-left: 4px;
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
  font-weight: 600;
}

.ports-filters .toggle-btn.active .chip-n {
  opacity: 1;
}

.ports-search-row {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 8px;
}

.ports-search {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--row);
  color: var(--text);
  font-size: var(--fs-12);
  font-family: var(--font);
}

.ports-search::placeholder {
  color: var(--muted);
}

.ports-search:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
}

.ports-error {
  margin-bottom: 8px;
  font-size: var(--fs-12);
  color: var(--color-fg-danger);
}

.ports-status {
  margin-bottom: 8px;
  font-size: var(--fs-12);
  color: var(--muted);
}

.ports-table-wrap {
  min-height: 0;
  flex: 1;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--row);
}

.ports-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-12);
}

.ports-table th,
.ports-table td {
  padding: 7px 10px;
  text-align: left;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  vertical-align: middle;
}

.ports-table th {
  position: sticky;
  top: 0;
  background: var(--panel);
  color: var(--muted);
  font-weight: 650;
  z-index: 1;
}

.ports-table tr.orphan td {
  background: color-mix(in srgb, var(--color-warning-bg, var(--caution-100)) 35%, transparent);
}

.owner {
  display: inline-block;
  font-weight: 650;
}

.owner[data-owner='unmanaged'] {
  color: var(--color-warning-fg, var(--caution-500));
}

.owner[data-owner='job'],
.owner[data-owner='shell'] {
  color: var(--accent);
}

.owner[data-owner='self'] {
  color: var(--muted);
}

.ref {
  display: block;
  margin-top: 2px;
  color: var(--muted);
  font-size: var(--fs-12);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.proc {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mono {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
}

.dim {
  color: var(--muted);
}

.kill-cell {
  text-align: right;
  white-space: nowrap;
}

.kill-cell .btn {
  padding: 2px 8px;
  font-size: var(--fs-12);
}

.ports-empty {
  padding: 28px 12px;
  text-align: center;
  color: var(--muted);
  font-size: var(--fs-12);
}
</style>
