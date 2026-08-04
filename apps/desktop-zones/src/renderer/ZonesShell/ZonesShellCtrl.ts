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
  thumb?: string;
};

export type GroupCard = {
  id: string;
  title: string;
  rel: string;
  path: string;
  files: ZoneFile[];
};

export type NavCrumb = {
  path: string;
  title: string;
};

export type NavPage = {
  path: string;
  title: string;
  crumbs: NavCrumb[];
  files: ZoneFile[];
  /** Virtual wallpaper library (not a real filesystem folder). */
  kind?: 'dir' | 'wallpaper';
};

const WALLPAPER_NAV_PATH = '__wallpaper__';

export const GROUP_PREVIEW = 4;

type TData = TitleBarShellData & {
  meta: string;
  banner: string;
  bannerWarn: boolean;
  hasRoot: boolean;
  customRoot: string;
  loose: ZoneFile[];
  groups: GroupCard[];
  systemDesktop: ZoneFile[];
  systemDesktopRoot: string;
  nav: NavPage | null;
  undoEnabled: boolean;
  wallpapers: Array<{ name: string; path: string; thumb: string }>;
  appBgName: string | null;
  studioItems: Array<{ name: string; path: string; thumb: string; badge?: string }>;
  studioKind: 'wallpaper' | 'browse' | 'jimeng';
  jimengFavorites: Array<{
    id: string;
    title: string;
    coverUrl: string;
    downloadUrl: string;
    author?: string;
    source?: 'favorite' | 'home';
  }>;
  jimengUpdatedAt: string;
  jimengFilter: 'all' | 'favorite' | 'home';
  /** True when Jimeng follower admin window is open. */
  jimengSplitOpen: boolean;
  /** @deprecated follower has no in-shell pane width */
  jimengPaneWidth: number;
};

export type NameDialog = {
  mode: 'create' | 'rename';
  value: string;
  /** rename target path */
  path?: string;
};

export type ConfirmDialog = {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
};

type TState = {
  busy: boolean;
  dropTargetRel: string | null;
  /** Drop highlight for current browse folder */
  dropBrowse: boolean;
  dragging: boolean;
  ctx: { x: number; y: number; file: ZoneFile } | null;
  /** Vue watches this to open WallpaperStudio */
  studioRequest: number | null;
  nameDialog: NameDialog | null;
  confirmDialog: ConfirmDialog | null;
  carouselScrollEnd: number | null;
  jimengPanel: boolean;
};

export function fileIconKind(file: ZoneFile): 'dir' | 'image' | 'file' {
  if (file.isDir) return 'dir';
  const e = (file.ext || '').toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico'].includes(e)) {
    return 'image';
  }
  return 'file';
}

export function previewItems<T>(items: T[], n = GROUP_PREVIEW): T[] {
  return items.slice(0, n);
}

function pathBasename(p: string): string {
  const norm = p.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i >= 0 ? norm.slice(i + 1) : norm;
}

export class ZonesShellCtrl extends TitleBarShellCtrl<
  TData,
  Record<string, never>,
  TState
> {
  private offMax: (() => void) | null = null;
  private offJimengHub: (() => void) | null = null;
  private offJimengLayout: (() => void) | null = null;
  private confirmResolve: ((ok: boolean) => void) | null = null;
  private bannerTimer: ReturnType<typeof setTimeout> | null = null;
  /** Restore Jimeng split after WallpaperStudio closes. */
  private jimengSplitBeforeStudio = false;

  constructor() {
    const env =
      typeof window !== 'undefined' && window.desktopZones?.getColorEnv?.() === 'test'
        ? 'test'
        : 'prod';
    super({
      data: {
        ...defaultTitleBarShellData({
          productName: 'Desktop Zones',
          subtitle: env === 'test' ? '' : '自定义桌面',
          colorEnv: env,
        }),
        meta: '扫描中…',
        banner: '',
        bannerWarn: false,
        hasRoot: false,
        customRoot: '',
        loose: [],
        groups: [],
        systemDesktop: [],
        systemDesktopRoot: '',
        nav: null,
        undoEnabled: false,
        wallpapers: [],
        appBgName: null,
        studioItems: [],
        studioKind: 'wallpaper',
        jimengFavorites: [],
        jimengUpdatedAt: '',
        jimengFilter: 'all',
        jimengSplitOpen: false,
        jimengPaneWidth: 0,
      },
      props: {},
      state: {
        busy: false,
        dropTargetRel: null,
        dropBrowse: false,
        dragging: false,
        ctx: null,
        studioRequest: null,
        nameDialog: null,
        confirmDialog: null,
        carouselScrollEnd: null,
        jimengPanel: false,
      },
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
    this.offJimengHub?.();
    this.offJimengHub = window.desktopZones.onJimengHub((ev) => {
      this.onJimengHubEvent(ev);
    });
    this.offJimengLayout?.();
    this.offJimengLayout = window.desktopZones.onJimengLayout((layout) => {
      this.applyJimengLayout(layout);
    });
    void window.desktopZones.getJimengLayout().then((layout) => {
      this.applyJimengLayout(layout);
    });
    void this.refresh();
    void this.refreshWallpapers();
    void this.loadJimengCache();
  }

  unmount(): void {
    this.offMax?.();
    this.offMax = null;
    this.offJimengHub?.();
    this.offJimengHub = null;
    this.offJimengLayout?.();
    this.offJimengLayout = null;
    void window.desktopZones.hideJimeng();
    if (this.bannerTimer) {
      clearTimeout(this.bannerTimer);
      this.bannerTimer = null;
    }
  }

  applyJimengLayout(layout: {
    open?: boolean;
    jimengWidth?: number;
  } | null): void {
    if (!layout) return;
    this.setData({
      jimengSplitOpen: !!layout.open,
      jimengPaneWidth: 0,
    });
  }

  private onJimengHubEvent(ev: {
    kind: string;
    updatedAt?: string;
    items?: TData['jimengFavorites'];
    message?: string;
    needLogin?: boolean;
    error?: string;
  }): void {
    if (ev.kind === 'snapshot' || ev.kind === 'items_patch') {
      if (!Array.isArray(ev.items)) return;
      // Ignore empty catch-up patches only — full snapshot may clear the list.
      if (ev.kind === 'items_patch' && !ev.items.length && this.data.jimengFavorites.length) {
        return;
      }
      this.setData({
        jimengFavorites: ev.items,
        jimengUpdatedAt: ev.updatedAt || new Date().toISOString(),
      });
      return;
    }
    if (ev.kind === 'status' && this.state.jimengPanel) {
      const msg = ev.message || ev.error;
      if (msg) this.showBanner(msg, !!(ev.needLogin || ev.error));
    }
  }

  showBanner(text: string, warn = false): void {
    if (this.bannerTimer) {
      clearTimeout(this.bannerTimer);
      this.bannerTimer = null;
    }
    this.setData({ banner: text, bannerWarn: warn });
    const ms = warn ? 4500 : 2600;
    this.bannerTimer = setTimeout(() => {
      this.bannerTimer = null;
      this.hideBanner();
    }, ms);
  }

  hideBanner(): void {
    if (this.bannerTimer) {
      clearTimeout(this.bannerTimer);
      this.bannerTimer = null;
    }
    this.setData({ banner: '', bannerWarn: false });
  }

  hideCtx(): void {
    this.setState({ ctx: null });
  }

  showCtx(x: number, y: number, file: ZoneFile): void {
    this.setState({ ctx: { x, y, file } });
  }

  /** Escape / Backspace navigation & dismiss overlays. Returns true if handled. */
  handleKeydown(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      if (this.state.ctx) {
        this.hideCtx();
        return true;
      }
      if (this.state.nameDialog) {
        this.closeNameDialog();
        return true;
      }
      if (this.state.confirmDialog) {
        this.answerConfirm(false);
        return true;
      }
      if (this.state.jimengPanel) {
        this.closeJimengPanel();
        return true;
      }
      if (this.data.jimengSplitOpen) {
        void this.onHideJimengPane();
        return true;
      }
      if (this.data.nav) {
        this.navBack();
        return true;
      }
      return false;
    }
    if (e.key === 'Backspace') {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        return false;
      }
      if (this.data.nav) {
        this.navBack();
        return true;
      }
    }
    return false;
  }

  consumeStudioRequest(): number | null {
    const i = this.state.studioRequest;
    if (i == null) return null;
    this.setState({ studioRequest: null });
    return i;
  }

  private beginStudioOverJimeng(): void {
    // Jimeng is a separate window — no need to hide for z-order over Zones.
    this.jimengSplitBeforeStudio = false;
  }

  private wallpaperFiles(): ZoneFile[] {
    return this.data.wallpapers.map((w) => {
      const base = w.name || w.path;
      const dot = base.lastIndexOf('.');
      return {
        path: w.path,
        name: w.name,
        ext: dot >= 0 ? base.slice(dot).toLowerCase() : '',
        isDir: false,
        thumb: w.thumb,
      };
    });
  }

  private syncWallpaperNav(): void {
    if (this.data.nav?.kind !== 'wallpaper') return;
    this.setData({
      nav: {
        kind: 'wallpaper',
        path: WALLPAPER_NAV_PATH,
        title: '壁纸',
        crumbs: [{ path: WALLPAPER_NAV_PATH, title: '壁纸' }],
        files: this.wallpaperFiles(),
      },
    });
  }

  /** Enter wallpaper library as a browse sub-page (like a tracked group). */
  enterWallpaper(): void {
    this.setData({
      nav: {
        kind: 'wallpaper',
        path: WALLPAPER_NAV_PATH,
        title: '壁纸',
        crumbs: [{ path: WALLPAPER_NAV_PATH, title: '壁纸' }],
        files: this.wallpaperFiles(),
      },
    });
  }

  openWallpaperStudio(index = 0): void {
    const items = this.data.wallpapers.filter((w) => !!w.thumb);
    if (!items.length) {
      this.showBanner('暂无壁纸可预览', true);
      return;
    }
    this.beginStudioOverJimeng();
    const i = Math.min(Math.max(0, index), items.length - 1);
    this.setData({ studioItems: items, studioKind: 'wallpaper' });
    this.setState({ studioRequest: i });
  }

  /** Open wallpaper studio focused on a specific item (by path). */
  openWallpaperAt(path: string): void {
    const items = this.data.wallpapers.filter((w) => !!w.thumb);
    if (!items.length) {
      this.showBanner('暂无壁纸可预览', true);
      return;
    }
    this.beginStudioOverJimeng();
    let i = items.findIndex((w) => w.path === path);
    if (i < 0) i = 0;
    this.setData({ studioItems: items, studioKind: 'wallpaper' });
    this.setState({ studioRequest: i });
  }

  findImagePeers(file: ZoneFile, peers?: ZoneFile[]): ZoneFile[] {
    if (peers?.length) return peers;
    const lists: Array<ZoneFile[] | undefined> = [
      this.data.nav?.files,
      this.data.loose,
      this.data.systemDesktop,
      ...this.data.groups.map((g) => g.files),
    ];
    for (const list of lists) {
      if (list?.some((f) => f.path === file.path)) return list;
    }
    return [file];
  }

  openImagePreview(file: ZoneFile, peers?: ZoneFile[]): void {
    const pool = this.findImagePeers(file, peers).filter(
      (f) => !f.isDir && (!!f.thumb || fileIconKind(f) === 'image'),
    );
    const items = pool
      .map((f) => ({
        name: f.name,
        path: f.path,
        thumb: f.thumb || '',
      }))
      .filter((x) => !!x.thumb);
    if (!items.length) {
      this.showBanner('无法预览该图片', true);
      return;
    }
    this.beginStudioOverJimeng();
    let idx = items.findIndex((x) => x.path === file.path);
    if (idx < 0) idx = 0;
    this.setData({ studioItems: items, studioKind: 'browse' });
    this.setState({ studioRequest: idx });
  }

  /** All carousel slots: wallpaper first, then tracked groups. */
  allGroupSlots(): Array<{ kind: 'wallpaper' } | { kind: 'group'; group: GroupCard }> {
    return [
      { kind: 'wallpaper' },
      ...this.data.groups.map((g) => ({ kind: 'group' as const, group: g })),
    ];
  }

  /** Vue watches to scroll carousel to the end (after create / track). */
  requestCarouselEnd(): void {
    this.setState({ carouselScrollEnd: Date.now() });
  }

  async refresh(): Promise<void> {
    this.setData({ meta: '扫描中…' });
    this.hideCtx();
    try {
      const data = await window.desktopZones.scan();
      const loose = data.loose || [];
      const groups = data.groups || [];
      const systemDesktop = data.systemDesktop || [];
      const hasRoot = data.hasRoot === true;
      this.setData({
        hasRoot,
        customRoot: data.root || '',
        loose,
        groups,
        systemDesktop,
        systemDesktopRoot: data.systemDesktopRoot || '',
      });
      if (!hasRoot) {
        this.setData({ meta: '未选择桌面目录', nav: null });
      } else if (data.error) {
        this.setData({ meta: `${data.root} — ${data.error}` });
      } else {
        this.setData({
          meta: `${data.root} · ${groups.length} 分组 · 未分组 ${loose.length}`,
        });
      }
      if (this.data.nav) {
        await this.reloadNav();
      }
    } catch (e) {
      this.setData({
        meta: e instanceof Error ? e.message : String(e),
        hasRoot: false,
        loose: [],
        groups: [],
        systemDesktop: [],
        nav: null,
      });
    }
    const undoEnabled = await window.desktopZones.undoAvailable();
    this.setData({ undoEnabled });
  }

  async reloadNav(): Promise<void> {
    const nav = this.data.nav;
    if (!nav) return;
    if (nav.kind === 'wallpaper') {
      this.syncWallpaperNav();
      return;
    }
    const res = await window.desktopZones.listDir(nav.path);
    if (!res.ok) {
      this.showBanner(res.error || '无法打开目录', true);
      this.setData({ nav: null });
      return;
    }
    this.setData({
      nav: {
        ...nav,
        title: res.name || nav.title,
        files: res.files || [],
      },
    });
  }

  async enterDir(
    dirPath: string,
    title: string,
    crumbs?: NavCrumb[],
  ): Promise<void> {
    this.setState({ busy: true });
    try {
      const res = await window.desktopZones.listDir(dirPath);
      if (!res.ok) {
        this.showBanner(res.error || '无法打开目录', true);
        return;
      }
      const crumb = { path: res.path, title: title || res.name };
      let nextCrumbs: NavCrumb[];
      if (crumbs) {
        nextCrumbs = crumbs;
      } else if (this.data.nav) {
        nextCrumbs = [...this.data.nav.crumbs, crumb];
      } else {
        nextCrumbs = [crumb];
      }
      this.setData({
        nav: {
          path: res.path,
          title: crumb.title,
          crumbs: nextCrumbs,
          files: res.files || [],
        },
      });
    } finally {
      this.setState({ busy: false });
    }
  }

  enterGroup(group: GroupCard): void {
    void this.enterDir(group.path, group.title, [{ path: group.path, title: group.title }]);
  }

  onItemActivate(file: ZoneFile, peers?: ZoneFile[]): void {
    if (this.data.nav?.kind === 'wallpaper') {
      this.openWallpaperAt(file.path);
      return;
    }
    if (file.isDir) {
      void this.enterDir(file.path, file.name);
      return;
    }
    if (file.thumb || fileIconKind(file) === 'image') {
      this.openImagePreview(file, peers);
      return;
    }
    void this.onOpenFile(file);
  }

  navBack(): void {
    const nav = this.data.nav;
    if (!nav || nav.kind === 'wallpaper' || nav.crumbs.length <= 1) {
      this.setData({ nav: null });
      return;
    }
    const crumbs = nav.crumbs.slice(0, -1);
    const last = crumbs[crumbs.length - 1]!;
    void this.enterDir(last.path, last.title, crumbs);
  }

  navToCrumb(index: number): void {
    const nav = this.data.nav;
    if (!nav || nav.kind === 'wallpaper') return;
    if (index < 0 || index >= nav.crumbs.length - 1) return;
    const crumbs = nav.crumbs.slice(0, index + 1);
    const crumb = crumbs[crumbs.length - 1]!;
    void this.enterDir(crumb.path, crumb.title, crumbs);
  }

  goHome(): void {
    this.setData({ nav: null });
  }

  async onRefresh(): Promise<void> {
    this.hideBanner();
    await this.refresh();
  }

  async onPickCustomRoot(): Promise<void> {
    this.setState({ busy: true });
    try {
      const res = await window.desktopZones.setCustomRoot();
      if (res.cancelled) return;
      if (!res.ok) {
        this.showBanner(res.error || '选择目录失败', true);
        return;
      }
      this.setData({ nav: null });
      this.showBanner('已设置桌面目录。可用右侧「+」新建分组。');
      await this.refresh();
    } finally {
      this.setState({ busy: false });
    }
  }

  askConfirm(opts: ConfirmDialog): Promise<boolean> {
    return new Promise((resolve) => {
      this.confirmResolve?.(false);
      this.confirmResolve = resolve;
      this.setState({ confirmDialog: opts });
    });
  }

  answerConfirm(ok: boolean): void {
    const resolve = this.confirmResolve;
    this.confirmResolve = null;
    this.setState({ confirmDialog: null });
    resolve?.(ok);
  }

  async onClearCustomRoot(): Promise<void> {
    const ok = await this.askConfirm({
      title: '清除目录',
      message: '清除当前桌面目录？追踪分组列表会一并清空。',
      confirmLabel: '清除',
      danger: true,
    });
    if (!ok) return;
    this.setState({ busy: true });
    try {
      const res = await window.desktopZones.clearCustomRoot();
      if (!res.ok) {
        this.showBanner(res.error || '清除失败', true);
        return;
      }
      this.setData({ nav: null });
      this.showBanner('已清除桌面目录');
      await this.refresh();
    } finally {
      this.setState({ busy: false });
    }
  }

  async onCreateTracked(): Promise<void> {
    if (!this.data.hasRoot) {
      this.showBanner('请先选择桌面目录', true);
      return;
    }
    this.setState({ nameDialog: { mode: 'create', value: '' } });
  }

  openRenameDialog(file: ZoneFile): void {
    this.setState({
      nameDialog: { mode: 'rename', value: file.name, path: file.path },
    });
  }

  closeNameDialog(): void {
    this.setState({ nameDialog: null });
  }

  setNameDialogValue(value: string): void {
    const d = this.state.nameDialog;
    if (!d) return;
    this.setState({ nameDialog: { ...d, value } });
  }

  async submitNameDialog(): Promise<void> {
    const d = this.state.nameDialog;
    if (!d) return;
    const name = d.value.trim();
    if (!name) {
      this.showBanner(d.mode === 'rename' ? '请输入新文件名' : '请输入分组名称', true);
      return;
    }
    if (d.mode === 'create') {
      this.setState({ busy: true });
      try {
        const res = await window.desktopZones.addTracked({ name });
        if (!res.ok) {
          this.showBanner(res.error || '创建分组失败', true);
          return;
        }
        this.setState({ nameDialog: null });
        this.showBanner(`已创建并追踪：${name}`);
        await this.refresh();
        this.requestCarouselEnd();
      } finally {
        this.setState({ busy: false });
      }
      return;
    }

    // rename
    if (!d.path) return;
    if (name === pathBasename(d.path)) {
      this.setState({ nameDialog: null });
      return;
    }
    this.setState({ busy: true });
    try {
      const res = await window.desktopZones.rename(d.path, name);
      if (!res.ok) {
        this.showBanner(`重命名失败: ${res.error}`, true);
        return;
      }
      this.setState({ nameDialog: null });
      this.showBanner(`已重命名为 ${name}`);
      await this.refresh();
    } finally {
      this.setState({ busy: false });
    }
  }

  async onAddTracked(): Promise<void> {
    if (!this.data.hasRoot) {
      this.showBanner('请先选择桌面目录', true);
      return;
    }
    this.setState({ busy: true });
    try {
      const res = await window.desktopZones.addTracked();
      if (res.cancelled) return;
      if (!res.ok) {
        this.showBanner(res.error || '添加分组失败', true);
        return;
      }
      this.showBanner('已添加追踪分组');
      await this.refresh();
    } finally {
      this.setState({ busy: false });
    }
  }

  async onRemoveTracked(rel: string, title: string): Promise<void> {
    const ok = await this.askConfirm({
      title: '取消追踪',
      message: `取消追踪分组「${title}」？\n不会删除磁盘上的文件夹。`,
      confirmLabel: '取消追踪',
      danger: true,
    });
    if (!ok) return;
    const res = await window.desktopZones.removeTracked(rel);
    if (!res.ok) {
      this.showBanner(res.error || '取消追踪失败', true);
      return;
    }
    this.showBanner(`已取消追踪：${title}`);
    if (this.data.nav?.path) {
      // if browsing that group, go home
      this.setData({ nav: null });
    }
    await this.refresh();
  }

  onDragStart(e: DragEvent, file: ZoneFile): void {
    if (this.data.nav?.kind === 'wallpaper') {
      e.preventDefault();
      return;
    }
    if (!e.dataTransfer) return;
    e.dataTransfer.setData('text/plain', file.path);
    e.dataTransfer.effectAllowed = 'move';
    this.setState({ dragging: true });
  }

  onBrowseContext(e: MouseEvent, file: ZoneFile): void {
    if (this.data.nav?.kind === 'wallpaper') return;
    this.showCtx(e.clientX, e.clientY, file);
  }

  onDragEnd(): void {
    this.setState({ dragging: false, dropTargetRel: null, dropBrowse: false });
  }

  onDragOverGroup(e: DragEvent, rel: string): void {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (this.state.dropTargetRel !== rel) {
      this.setState({ dropTargetRel: rel, dropBrowse: false });
    }
  }

  onDragLeaveGroup(rel: string): void {
    if (this.state.dropTargetRel === rel) {
      this.setState({ dropTargetRel: null });
    }
  }

  onDragOverBrowse(e: DragEvent): void {
    if (!this.data.nav || this.data.nav.kind === 'wallpaper') return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (!this.state.dropBrowse) {
      this.setState({ dropBrowse: true, dropTargetRel: null });
    }
  }

  onDragLeaveBrowse(): void {
    if (this.state.dropBrowse) {
      this.setState({ dropBrowse: false });
    }
  }

  async onDropGroup(e: DragEvent, rel: string): Promise<void> {
    e.preventDefault();
    this.setState({ dropTargetRel: null, dropBrowse: false, dragging: false });
    const from = e.dataTransfer?.getData('text/plain')?.trim();
    if (!from) return;
    this.setState({ busy: true });
    try {
      const res = await window.desktopZones.moveIntoGroup(from, rel);
      if (!res.ok) {
        this.showBanner(res.error || '移动失败', true);
        return;
      }
      this.showBanner('已移入分组');
      await this.refresh();
    } finally {
      this.setState({ busy: false });
    }
  }

  async onDropBrowse(e: DragEvent): Promise<void> {
    e.preventDefault();
    this.setState({ dropBrowse: false, dropTargetRel: null, dragging: false });
    if (this.data.nav?.kind === 'wallpaper') return;
    const dest = this.data.nav?.path;
    const from = e.dataTransfer?.getData('text/plain')?.trim();
    if (!from || !dest) return;
    this.setState({ busy: true });
    try {
      const res = await window.desktopZones.moveIntoDir(from, dest);
      if (!res.ok) {
        this.showBanner(res.error || '移动失败', true);
        return;
      }
      this.showBanner('已移入当前文件夹');
      await this.refresh();
    } finally {
      this.setState({ busy: false });
    }
  }

  async onUndo(): Promise<void> {
    this.setState({ busy: true });
    try {
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
    } finally {
      this.setState({ busy: false });
    }
  }

  onOpenDesktop(): void {
    if (!this.data.hasRoot) {
      this.showBanner('请先选择桌面目录', true);
      return;
    }
    void window.desktopZones.openDesktop();
  }

  async refreshWallpapers(opts?: { bust?: boolean }): Promise<void> {
    try {
      const [wallpapers, bg] = await Promise.all([
        window.desktopZones.listWallpapers(),
        window.desktopZones.getAppBackground(),
      ]);
      const bust = opts?.bust ? Date.now() : 0;
      const list = (wallpapers || []).map((w) => {
        if (!bust || !w.thumb) return { ...w };
        const sep = w.thumb.includes('?') ? '&' : '?';
        return { ...w, thumb: `${w.thumb}${sep}v=${bust}` };
      });
      this.setData({
        wallpapers: list,
        appBgName: bg?.name ?? null,
      });
      this.syncWallpaperNav();
    } catch {
      this.setData({ wallpapers: [], appBgName: null });
      this.syncWallpaperNav();
    }
  }

  /** After Jimeng → wallpaper download: refresh wallpaper grid + local favorites. */
  private async refreshAfterJimengDownload(): Promise<void> {
    await Promise.all([this.refreshWallpapers({ bust: true }), this.loadJimengCache()]);
  }

  onOpenWallpapersFolder(): void {
    void window.desktopZones.openWallpapersFolder();
  }

  async loadJimengCache(): Promise<void> {
    try {
      const cache = await window.desktopZones.getJimengFavoritesCache();
      this.setData({
        jimengFavorites: cache.items || [],
        jimengUpdatedAt: cache.updatedAt || '',
      });
    } catch {
      /* ignore */
    }
  }

  async onHideJimengPane(): Promise<void> {
    const res = await window.desktopZones.hideJimeng();
    this.applyJimengLayout(res.layout || { open: false, jimengWidth: 0 });
  }

  async onOpenJimeng(): Promise<void> {
    // Toggle follower admin window.
    if (this.data.jimengSplitOpen) {
      await this.onHideJimengPane();
      return;
    }
    const res = await window.desktopZones.openJimeng();
    if (!res.ok) {
      this.showBanner(res.error || '无法打开即梦后台', true);
      return;
    }
    this.applyJimengLayout(res.layout || null);
    this.showBanner('已打开即梦管理窗（跟屁虫）。采完可关；桌面仍可用本机收藏。');
  }

  openJimengPanel(): void {
    this.setState({ jimengPanel: true });
    void this.loadJimengCache();
  }

  closeJimengPanel(): void {
    this.setState({ jimengPanel: false });
  }

  setJimengFilter(filter: 'all' | 'favorite' | 'home'): void {
    this.setData({ jimengFilter: filter });
  }

  filteredJimengItems(): TData['jimengFavorites'] {
    const f = this.data.jimengFilter;
    if (f === 'all') return this.data.jimengFavorites;
    return this.data.jimengFavorites.filter((x) => (x.source || 'favorite') === f);
  }

  /** Open shared WallpaperStudio for Jimeng items (actions configured in Vue). */
  openJimengPreview(id: string): void {
    this.beginStudioOverJimeng();
    const list = this.filteredJimengItems().filter((x) => !!(x.downloadUrl || x.coverUrl));
    if (!list.length) {
      this.restoreJimengAfterStudio();
      this.showBanner('暂无可预览图片', true);
      return;
    }
    const items = list.map((x) => ({
      name: x.title || x.id,
      path: x.id,
      thumb: x.downloadUrl || x.coverUrl,
      badge: x.source === 'home' ? '推荐' : '收藏',
    }));
    let idx = items.findIndex((x) => x.path === id);
    if (idx < 0) idx = 0;
    this.setData({ studioItems: items, studioKind: 'jimeng' });
    this.setState({ studioRequest: idx });
  }

  /** Call when WallpaperStudio closes to restore Jimeng split if needed. */
  restoreJimengAfterStudio(): void {
    if (!this.jimengSplitBeforeStudio) return;
    this.jimengSplitBeforeStudio = false;
    void window.desktopZones.openJimeng().then((r) => {
      this.applyJimengLayout(r.layout || null);
    });
  }

  jimengItemByStudioPath(path: string): TData['jimengFavorites'][number] | null {
    return this.data.jimengFavorites.find((x) => x.id === path) || null;
  }

  async onSyncJimengFavorites(): Promise<void> {
    this.setState({ busy: true, jimengPanel: true });
    try {
      const res = await window.desktopZones.syncJimengFavorites();
      this.setData({
        jimengFavorites: res.items || [],
        jimengUpdatedAt: res.ok ? new Date().toISOString() : this.data.jimengUpdatedAt,
      });
      if (res.needLogin) {
        this.showBanner(res.error || '请先登录即梦', true);
        return;
      }
      if (!res.ok) {
        this.showBanner(res.error || '尚未截获到收藏', true);
        return;
      }
      const fav = res.items.filter((x) => (x.source || 'favorite') === 'favorite').length;
      this.showBanner(`本机 ${fav} 条收藏。可下载到壁纸后长期使用。`);
    } finally {
      this.setState({ busy: false });
    }
  }

  async onDownloadJimengOne(item: {
    id: string;
    title?: string;
    coverUrl?: string;
    downloadUrl?: string;
    author?: string;
    source?: 'favorite' | 'home';
  }): Promise<void> {
    const id = String(item?.id || '').trim();
    if (!id) {
      this.showBanner('无效收藏项', true);
      return;
    }
    this.setState({ busy: true });
    try {
      // Pass plain id only — Vue reactive item proxies break Electron IPC clone.
      const res = await window.desktopZones.downloadJimengFavorite(id);
      if (!res.ok) {
        this.showBanner(res.error || '下载失败', true);
        return;
      }
      this.showBanner(res.skipped ? `已存在：${res.name}` : `已下载：${res.name}`);
      await this.refreshAfterJimengDownload();
    } catch (e) {
      this.showBanner(e instanceof Error ? e.message : String(e), true);
    } finally {
      this.setState({ busy: false });
    }
  }

  async onDownloadJimengAll(): Promise<void> {
    const list = this.filteredJimengItems();
    if (!list.length) {
      this.showBanner('请先截获收藏列表', true);
      return;
    }
    this.setState({ busy: true });
    try {
      const res = await window.desktopZones.downloadJimengFavorites(list.map((x) => x.id));
      if (res.error && !res.downloaded && !res.skipped) {
        this.showBanner(res.error, true);
        return;
      }
      this.showBanner(
        `已写入壁纸库：新增 ${res.downloaded}，跳过 ${res.skipped}` +
          (res.failed ? `，失败 ${res.failed}` : ''),
        !!res.failed,
      );
      await this.refreshAfterJimengDownload();
    } finally {
      this.setState({ busy: false });
    }
  }

  async onSetAppBackground(item: { name: string; path: string }): Promise<void> {
    this.setState({ busy: true });
    try {
      const res = await window.desktopZones.setAppBackground(item.path);
      if (!res.ok) {
        this.showBanner(`设置应用背景失败: ${res.error || 'unknown'}`, true);
        return;
      }
      this.setData({ appBgName: res.name });
      this.showBanner(`已设为全局应用背景：${item.name}`);
    } finally {
      this.setState({ busy: false });
    }
  }

  async onClearAppBackground(): Promise<void> {
    this.setState({ busy: true });
    try {
      const res = await window.desktopZones.setAppBackground(null);
      if (!res.ok) {
        this.showBanner(`清除应用背景失败: ${res.error || 'unknown'}`, true);
        return;
      }
      this.setData({ appBgName: null });
      this.showBanner('已清除全局应用背景');
    } finally {
      this.setState({ busy: false });
    }
  }

  async onSetWallpaper(item: { name: string; path: string }): Promise<void> {
    this.setState({ busy: true });
    try {
      const res = await window.desktopZones.setWallpaper(item.path);
      if (!res.ok) {
        this.showBanner(`设置系统壁纸失败: ${res.error || 'unknown'}`, true);
      } else {
        this.showBanner(`已设为系统桌面壁纸：${item.name}`);
      }
    } finally {
      this.setState({ busy: false });
    }
  }

  async onOpenFile(file: ZoneFile): Promise<void> {
    await window.desktopZones.open(file.path);
  }

  /** Direct child folder of custom root → can become a tracked group. */
  canTrackAsGroup(file: ZoneFile): boolean {
    if (!file.isDir || !this.data.customRoot) return false;
    const root = this.data.customRoot.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const full = file.path.replace(/\\/g, '/').replace(/\/+$/, '');
    const parent = full.includes('/') ? full.slice(0, full.lastIndexOf('/')) : '';
    if (parent.toLowerCase() !== root) return false;
    return !this.data.groups.some(
      (g) => g.path.replace(/\\/g, '/').toLowerCase() === full.toLowerCase(),
    );
  }

  async onTrackAsGroup(file: ZoneFile): Promise<void> {
    if (!this.canTrackAsGroup(file)) {
      this.showBanner('只能追踪自定义桌面根下的一级文件夹', true);
      return;
    }
    this.setState({ busy: true });
    try {
      const res = await window.desktopZones.addTracked({ path: file.path });
      if (!res.ok) {
        this.showBanner(res.error || '加入追踪失败', true);
        return;
      }
      this.showBanner(`已追踪分组：${file.name}`);
      await this.refresh();
      this.requestCarouselEnd();
    } finally {
      this.setState({ busy: false });
    }
  }

  async onCtxAction(act: string): Promise<void> {
    const file = this.state.ctx?.file;
    this.hideCtx();
    if (!file) return;
    if (act === 'open') {
      if (file.isDir) {
        void this.enterDir(file.path, file.name, this.data.nav ? undefined : [{ path: file.path, title: file.name }]);
        return;
      }
      if (file.thumb || fileIconKind(file) === 'image') {
        this.openImagePreview(file, this.data.nav?.files);
        return;
      }
      await window.desktopZones.open(file.path);
    } else if (act === 'reveal') {
      await window.desktopZones.reveal(file.path);
    } else if (act === 'copy-path') {
      try {
        await navigator.clipboard.writeText(file.path);
        this.showBanner('已复制路径');
      } catch {
        this.showBanner('复制失败', true);
      }
    } else if (act === 'track') {
      await this.onTrackAsGroup(file);
    } else if (act === 'rename') {
      this.openRenameDialog(file);
    } else if (act === 'trash') {
      const ok = await this.askConfirm({
        title: '删除到回收站',
        message: `确定将「${file.name}」移入回收站？`,
        confirmLabel: '删除',
        danger: true,
      });
      if (!ok) return;
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
