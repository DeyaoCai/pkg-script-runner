import {
  TitleBarShellCtrl,
  defaultTitleBarShellData,
  type TitleBarShellData,
} from '@pkg-runner/shell/renderer';
import type { TWindowBridge } from '@pkg-runner/shell/renderer';

export type ZoneFile = {
  path: string;
  name: string;
  ext: string;
  isDir: boolean;
};

export type ZoneBucket = {
  id: string;
  title: string;
  files: ZoneFile[];
};

export type MoveOp = {
  from: string;
  to: string;
  zoneId: string;
};

type TData = TitleBarShellData & {
  meta: string;
  banner: string;
  bannerWarn: boolean;
  zones: ZoneBucket[];
  applyEnabled: boolean;
  undoEnabled: boolean;
};

type TState = {
  busy: boolean;
  ctx: { x: number; y: number; file: ZoneFile } | null;
};

export class ZonesShellCtrl extends TitleBarShellCtrl<
  TData,
  Record<string, never>,
  TState
> {
  private pendingOps: MoveOp[] | null = null;
  private offMax: (() => void) | null = null;

  constructor() {
    const env =
      typeof window !== 'undefined' && window.desktopZones?.getColorEnv?.() === 'test'
        ? 'test'
        : 'prod';
    super({
      data: {
        ...defaultTitleBarShellData({
          productName: 'Desktop Zones',
          subtitle: env === 'test' ? '' : '桌面整理',
          colorEnv: env,
        }),
        meta: '扫描中…',
        banner: '',
        bannerWarn: false,
        zones: [],
        applyEnabled: false,
        undoEnabled: false,
      },
      props: {},
      state: { busy: false, ctx: null },
    });
  }

  getWindowApi(): TWindowBridge | null {
    const api = window.desktopZones;
    if (!api?.windowMinimize) return null;
    return {
      windowMinimize: () => api.windowMinimize(),
      windowMaximize: () => api.windowMaximize(),
      windowClose: () => api.windowClose(),
      windowIsMaximized: () => api.windowIsMaximized(),
      onMaximizedChange: (cb) => api.onMaximizedChange(cb),
    };
  }

  mount(): void {
    void this.refreshMaximized();
    this.offMax?.();
    this.offMax = this.bindMaximizedEvents();
    void this.refresh();
  }

  unmount(): void {
    this.offMax?.();
    this.offMax = null;
  }

  showBanner(text: string, warn = false): void {
    this.setData({ banner: text, bannerWarn: warn });
  }

  hideBanner(): void {
    this.setData({ banner: '', bannerWarn: false });
  }

  hideCtx(): void {
    this.setState({ ctx: null });
  }

  showCtx(x: number, y: number, file: ZoneFile): void {
    this.setState({ ctx: { x, y, file } });
  }

  async refresh(): Promise<void> {
    this.setData({ meta: '扫描中…', zones: [] });
    this.hideCtx();
    try {
      const data = await window.desktopZones.scan();
      if (data.error) {
        this.setData({
          meta: `${data.root} — ${data.error}`,
          zones: data.zones || [],
        });
      } else {
        const total = data.zones.reduce((n, z) => n + z.files.length, 0);
        this.setData({
          meta: `${data.root} · ${total} 项`,
          zones: data.zones,
        });
      }
    } catch (e) {
      this.setData({
        meta: e instanceof Error ? e.message : String(e),
        zones: [],
      });
    }
    const undoEnabled = await window.desktopZones.undoAvailable();
    this.setData({ undoEnabled });
  }

  async onRefresh(): Promise<void> {
    this.pendingOps = null;
    this.setData({ applyEnabled: false });
    this.hideBanner();
    await this.refresh();
  }

  async onPreview(): Promise<void> {
    const preview = await window.desktopZones.previewOrganize();
    if (preview.error) {
      this.showBanner(preview.error, true);
      this.pendingOps = null;
      this.setData({ applyEnabled: false });
      return;
    }
    this.pendingOps = preview.ops;
    this.setData({ applyEnabled: !!preview.ops.length });
    if (!preview.ops.length) {
      this.showBanner('桌面根目录没有需要整理的文件');
      return;
    }
    const byZone: Record<string, number> = {};
    for (const op of preview.ops) {
      byZone[op.zoneId] = (byZone[op.zoneId] || 0) + 1;
    }
    const detail = Object.entries(byZone)
      .map(([k, n]) => `${k}:${n}`)
      .join(' · ');
    this.showBanner(
      `将移动 ${preview.ops.length} 项到分类文件夹（${detail}）。确认后点「执行整理」。`,
    );
  }

  async onApply(): Promise<void> {
    if (!this.pendingOps?.length) return;
    if (
      !window.confirm(
        `确认移动 ${this.pendingOps.length} 个文件到桌面分类文件夹？`,
      )
    ) {
      return;
    }
    const res = await window.desktopZones.applyOrganize(this.pendingOps);
    this.pendingOps = null;
    this.setData({ applyEnabled: false });
    if (res.failed?.length) {
      this.showBanner(
        `已移动 ${res.moved} 项，失败 ${res.failed.length} 项：${res.failed[0].error}`,
        true,
      );
    } else {
      this.showBanner(`已移动 ${res.moved} 项。可用「撤销」还原。`);
    }
    await this.refresh();
  }

  async onUndo(): Promise<void> {
    if (!window.confirm('撤销最近一次整理？')) return;
    const res = await window.desktopZones.undoOrganize();
    if (!res.ok && res.error) {
      this.showBanner(res.error, true);
    } else {
      this.showBanner(
        `已还原 ${res.restored ?? 0} 项` +
          (res.skipped?.length ? `，跳过 ${res.skipped.length} 项` : ''),
      );
    }
    await this.refresh();
  }

  onOpenDesktop(): void {
    void window.desktopZones.openDesktop();
  }

  async onOpenFile(file: ZoneFile): Promise<void> {
    await window.desktopZones.open(file.path);
  }

  async onCtxAction(act: string): Promise<void> {
    const file = this.state.ctx?.file;
    this.hideCtx();
    if (!file) return;
    if (act === 'open') {
      await window.desktopZones.open(file.path);
    } else if (act === 'reveal') {
      await window.desktopZones.reveal(file.path);
    } else if (act === 'rename') {
      const next = window.prompt('新文件名', file.name);
      if (!next || next === file.name) return;
      const res = await window.desktopZones.rename(file.path, next);
      if (!res.ok) {
        this.showBanner(`重命名失败: ${res.error}`, true);
        return;
      }
      this.showBanner(`已重命名为 ${next}`);
      await this.refresh();
    } else if (act === 'trash') {
      if (!window.confirm(`删除到回收站？\n${file.name}`)) return;
      const res = await window.desktopZones.trash(file.path);
      if (!res.ok) {
        this.showBanner(`删除失败: ${res.error}`, true);
        return;
      }
      this.showBanner(`已移入回收站: ${file.name}`);
      await this.refresh();
    }
  }
}
