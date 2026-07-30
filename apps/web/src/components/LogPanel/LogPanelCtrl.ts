import { Controller } from '@pkg-runner/controller';
import type { AppCtrl, LogSession } from '../../App/AppCtrl';
import { SYSTEM_ID } from '../../App/AppCtrl';

type TData = Record<string, never>;
type TProps = Record<string, never>;
type TState = Record<string, never>;

function isMosaicPaneKind(s: LogSession) {
  return s.kind === 'job' || s.kind === 'shell';
}

export class LogPanelCtrl extends Controller<TData, TProps, TState> {
  constructor(readonly app: AppCtrl) {
    super({ data: {}, props: {}, state: {} });
  }

  get label(): string {
    const name = this.app.data.project?.name;
    const jobTabs = this.app.visibleLogs.filter((s) => s.kind !== 'system').length;
    if (!name) return '输出';
    return `输出 · ${name}${jobTabs > 0 ? `（${jobTabs}）` : ''}`;
  }

  get activeSession(): LogSession | undefined {
    const id = this.app.data.activeLogId;
    return this.app.visibleLogs.find((s) => s.id === id) || this.app.visibleLogs[0];
  }

  get paneMode(): boolean {
    const s = this.activeSession;
    return !!s && isMosaicPaneKind(s);
  }

  get mosaicMode(): boolean {
    return this.paneMode && this.app.data.settings.shellLayout === 'grid';
  }

  get panes(): LogSession[] {
    if (!this.paneMode) return [];
    const list = this.app.visibleLogs.filter(isMosaicPaneKind);
    if (this.mosaicMode) return list;
    const active = this.activeSession;
    return active && isMosaicPaneKind(active) ? [active] : [];
  }

  get viewsClass() {
    return {
      'is-shell-mosaic': this.mosaicMode,
      'is-shell-single': this.paneMode && !this.mosaicMode,
    };
  }

  async togglePersistLogs(): Promise<void> {
    const api = this.app.api;
    if (!api?.requestTraySettingsPatch) {
      this.app.flashMeta('落盘开关请在托盘设置中修改，或等待 Runner 连接托盘', true);
      return;
    }
    try {
      const next = !this.app.data.persistLogs;
      await api.requestTraySettingsPatch({ persistLogs: next });
      this.app.flashMeta(next ? '已请求开启落盘' : '已请求关闭落盘', false);
    } catch (e) {
      this.app.flashMeta(e instanceof Error ? e.message : String(e), true);
    }
  }

  async openLogsDir(): Promise<void> {
    if (!this.app.api?.openLogsDir) {
      this.app.flashMeta('Runner API 不可用', true);
      return;
    }
    const res = await this.app.api.openLogsDir();
    if (res?.error) this.app.flashMeta(res.error, true);
    else if (res?.dir) this.app.flashMeta(`已打开：${res.dir}`, false);
  }

  async clearDisk(): Promise<void> {
    if (!this.app.api?.clearDiskLogs) {
      this.app.flashMeta('Runner API 不可用', true);
      return;
    }
    const res = await this.app.api.clearDiskLogs();
    this.app.flashMeta(`已清除 ${res?.removed ?? 0} 个日志文件`, false);
  }

  selectTab(id: string): void {
    this.app.setData({ activeLogId: id });
  }

  onTabKeydown(e: KeyboardEvent, id: string): void {
    const tabs = this.app.visibleLogs;
    const i = tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.selectTab(id);
      return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') {
      return;
    }
    e.preventDefault();
    let next = i;
    if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = tabs.length - 1;
    this.selectTab(tabs[next]!.id);
    document.querySelector<HTMLElement>(`.log-tab[data-log-tab="${tabs[next]!.id}"]`)?.focus();
  }

  isSystem(id: string): boolean {
    return id === SYSTEM_ID;
  }
}
