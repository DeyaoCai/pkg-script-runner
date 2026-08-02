import { Controller } from '@pkg-runner/controller';
import { BRAND_PRESET_PROD, readCssVar } from '@pkg-runner/tokens';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { CodeEditorShellCtrl } from '../../CodeEditorShell/CodeEditorShellCtrl.ts';

export type TTermTab = {
  id: string;
  cwd: string;
  title: string;
  alive: boolean;
};

type TTermView = {
  term: Terminal;
  fit: FitAddon;
  el: HTMLDivElement;
};

type TData = {
  tabs: TTermTab[];
  /** keyboard / action focus among shells */
  focusId: string | null;
  busy: boolean;
  error: string;
};

type TProps = Record<string, never>;

type TState = {
  open: boolean;
  height: number;
  /** how many shells shown side-by-side on one page (no row wrap) */
  columnsPerPage: number;
  /** 0-based current page */
  pageIndex: number;
  /** derived: ceil(tabs / columns), at least 1 */
  pageCount: number;
};

const MIN_H = 120;
const MAX_H = 560;
const DEFAULT_H = 220;
const MAX_COLS = 4;

function termTheme() {
  return {
    background: readCssVar('--panel', '#16181c'),
    foreground: readCssVar('--text', '#e8eaed'),
    cursor: readCssVar('--cyan', BRAND_PRESET_PROD),
    selectionBackground: readCssVar(
      '--color-accent-soft',
      'color-mix(in srgb, var(--tone) 28%, transparent)',
    ),
  };
}

export class BottomTermCtrl extends Controller<TData, TProps, TState> {
  private shell: CodeEditorShellCtrl | null = null;
  private host: HTMLElement | null = null;
  private views = new Map<string, TTermView>();
  private ro: ResizeObserver | null = null;
  private offData: (() => void) | null = null;
  private offExit: (() => void) | null = null;

  constructor() {
    super({
      data: {
        tabs: [],
        focusId: null,
        busy: false,
        error: '',
      },
      props: {},
      state: {
        open: false,
        height: DEFAULT_H,
        columnsPerPage: 1,
        pageIndex: 0,
        pageCount: 1,
      },
    });
  }

  bindShell(shell: CodeEditorShellCtrl): void {
    this.shell = shell;
  }

  get focusTab(): TTermTab | null {
    return this.data.tabs.find((t) => t.id === this.data.focusId) ?? null;
  }

  get canPagePrev(): boolean {
    return this.state.pageIndex > 0;
  }

  get canPageNext(): boolean {
    return this.state.pageIndex < this.state.pageCount - 1;
  }

  /** Tabs visible on the current page (horizontal only). */
  get visibleTabs(): TTermTab[] {
    const n = Math.max(1, this.state.columnsPerPage);
    const start = this.state.pageIndex * n;
    return this.data.tabs.slice(start, start + n);
  }

  /** Recompute pageCount and clamp / align pageIndex. */
  private syncPaging(opts?: { stickToFocus?: boolean }): void {
    const cols = Math.max(1, this.state.columnsPerPage);
    const total = this.data.tabs.length;
    const pageCount = Math.max(1, Math.ceil(total / cols) || 1);
    let pageIndex = this.state.pageIndex;

    if (opts?.stickToFocus) {
      const idx = this.data.tabs.findIndex((t) => t.id === this.data.focusId);
      pageIndex = idx < 0 ? 0 : Math.floor(idx / cols);
    }

    if (pageIndex > pageCount - 1) pageIndex = pageCount - 1;
    if (pageIndex < 0) pageIndex = 0;

    this.setState({ pageCount, pageIndex });
  }

  toggle(): void {
    if (this.state.open) this.hide();
    else void this.show();
  }

  hide(): void {
    this.setState({ open: false });
    this.persistPrefs();
  }

  async show(): Promise<void> {
    this.setState({ open: true });
    this.persistPrefs();
    if (!this.data.tabs.length) {
      await this.addTab();
    } else {
      this.syncPaneLayout();
      this.scheduleFit();
    }
  }

  setHeight(h: number): void {
    const height = Math.max(MIN_H, Math.min(MAX_H, Math.round(h)));
    this.setState({ height });
    this.shell?.patchLayout({ shellHeight: height });
    this.scheduleFit();
  }

  setColumnsPerPage(n: number): void {
    const cols = Math.max(1, Math.min(MAX_COLS, Math.round(n)));
    this.setState({ columnsPerPage: cols });
    this.syncPaging({ stickToFocus: true });
    this.syncPaneLayout();
    this.scheduleFit();
    this.persistPrefs();
  }

  private persistPrefs(): void {
    void this.shell?.bridge.setShellPrefs({
      open: this.state.open,
      columnsPerPage: this.state.columnsPerPage,
    });
  }

  /** Load open / columns from prefs + height from layout after host is mounted. */
  async hydratePrefs(): Promise<void> {
    if (!this.shell) return;
    try {
      const savedH = this.shell.state.layout.shellHeight;
      if (Number.isFinite(savedH)) {
        this.setState({
          height: Math.max(MIN_H, Math.min(MAX_H, Math.round(savedH))),
        });
      }
      const p = await this.shell.bridge.getShellPrefs();
      const cols = Math.max(1, Math.min(MAX_COLS, p.columnsPerPage || 1));
      this.setState({ columnsPerPage: cols });
      this.syncPaging();
      if (p.open) {
        this.setState({ open: true });
        await this.ensureShellAfterNav();
      } else {
        this.setState({ open: false });
      }
    } catch {
      /* ignore */
    }
  }

  /** Retry shell creation once workspace/repo is known (bootstrap or applyNav). */
  async ensureShellAfterNav(): Promise<void> {
    if (!this.state.open || this.data.busy) return;
    if (this.data.tabs.length) {
      this.setData({ error: '' });
      this.syncPaneLayout();
      this.scheduleFit();
      return;
    }
    const cwd = this.cwdForShell();
    if (!cwd) return;
    this.setData({ error: '' });
    await this.addTab();
  }

  pagePrev(): void {
    if (this.state.pageIndex <= 0) return;
    this.setState({ pageIndex: this.state.pageIndex - 1 });
    this.syncPaging();
    this.focusFirstOnPage();
    this.syncPaneLayout();
    this.scheduleFit();
  }

  pageNext(): void {
    if (this.state.pageIndex >= this.state.pageCount - 1) return;
    this.setState({ pageIndex: this.state.pageIndex + 1 });
    this.syncPaging();
    this.focusFirstOnPage();
    this.syncPaneLayout();
    this.scheduleFit();
  }

  private focusFirstOnPage(): void {
    const first = this.visibleTabs[0];
    if (first) this.setData({ focusId: first.id });
  }

  private cwdForShell(): string | null {
    return this.shell?.data.projectRoot || this.shell?.data.workspaceRoot || null;
  }

  async addTab(): Promise<void> {
    if (!this.shell || !this.host || this.data.busy) return;
    const cwd = this.cwdForShell();
    if (!cwd) {
      this.setData({ error: '请先选择工作区 / 仓库' });
      this.setState({ open: true });
      return;
    }
    this.setData({ busy: true, error: '' });
    this.setState({ open: true });
    try {
      const info = await this.shell.bridge.termStart(cwd, {
        cols: 80,
        rows: 24,
      });
      this.createView(info.id);
      const tab: TTermTab = {
        id: info.id,
        cwd: info.cwd,
        title: info.title,
        alive: true,
      };
      const tabs = [...this.data.tabs, tab];
      this.setData({
        tabs,
        focusId: info.id,
        busy: false,
        error: '',
      });
      this.syncPaging({ stickToFocus: true });
      this.syncPaneLayout();
      this.views
        .get(info.id)
        ?.term.writeln(`\x1b[90mcwd: ${info.cwd}\x1b[0m`);
      this.scheduleFit();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const hint = /No handler registered/i.test(raw)
        ? '请重启应用（main 需重新 build）'
        : raw;
      this.setData({ busy: false, error: hint });
    }
  }

  selectTab(id: string): void {
    if (!this.data.tabs.some((t) => t.id === id)) return;
    this.setData({ focusId: id });
    this.syncPaging({ stickToFocus: true });
    this.syncPaneLayout();
    this.scheduleFit();
  }

  async closeTab(id: string): Promise<void> {
    const tabs = this.data.tabs.filter((t) => t.id !== id);
    this.disposeView(id);
    void this.shell?.bridge.termKill(id);
    let focusId = this.data.focusId;
    if (focusId === id) {
      focusId = tabs[tabs.length - 1]?.id ?? null;
    }
    this.setData({ tabs, focusId });
    if (!tabs.length) {
      this.setState({ open: false, pageIndex: 0, pageCount: 1 });
      return;
    }
    this.syncPaging({ stickToFocus: true });
    this.syncPaneLayout();
    this.scheduleFit();
  }

  async restartFocused(): Promise<void> {
    const cur = this.focusTab;
    const cwd = cur?.cwd || this.cwdForShell();
    if (!cwd || !this.shell || !this.host) {
      this.setData({ error: '请先选择工作区 / 仓库' });
      return;
    }
    const replaceId = cur?.id ?? null;
    this.setData({ busy: true, error: '' });
    try {
      const info = await this.shell.bridge.termStart(cwd, {
        cols: 80,
        rows: 24,
      });
      this.createView(info.id);
      const tab: TTermTab = {
        id: info.id,
        cwd: info.cwd,
        title: cur?.title || info.title,
        alive: true,
      };
      let tabs = [...this.data.tabs];
      if (replaceId) {
        this.disposeView(replaceId);
        void this.shell.bridge.termKill(replaceId);
        tabs = tabs.map((t) => (t.id === replaceId ? tab : t));
      } else {
        tabs = [...tabs, tab];
      }
      this.setData({
        tabs,
        focusId: info.id,
        busy: false,
        error: '',
      });
      this.syncPaging({ stickToFocus: true });
      this.syncPaneLayout();
      this.views
        .get(info.id)
        ?.term.writeln(`\x1b[90mcwd: ${info.cwd}\x1b[0m`);
      this.scheduleFit();
    } catch (e) {
      this.setData({
        busy: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  private createView(id: string): void {
    if (!this.host || this.views.has(id)) return;
    const el = document.createElement('div');
    el.className = 'xterm-pane';
    el.dataset.termId = id;
    this.host.appendChild(el);

    const term = new Terminal({
      cursorBlink: true,
      fontFamily:
        readCss('--mono', '') ||
        'JetBrains Mono, Consolas, ui-monospace, monospace',
      fontSize: 13,
      theme: termTheme(),
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    term.onData((data) => {
      void this.shell?.bridge.termWrite(id, data);
    });
    el.addEventListener('mousedown', () => {
      if (this.data.focusId !== id) this.selectTab(id);
    });
    this.views.set(id, { term, fit, el });
  }

  private disposeView(id: string): void {
    const view = this.views.get(id);
    if (!view) return;
    view.term.dispose();
    view.el.remove();
    this.views.delete(id);
  }

  /** Horizontal page layout only — never wrap to a second row. */
  private syncPaneLayout(): void {
    if (!this.host) return;

    const vis = this.visibleTabs;
    const visible = new Set(vis.map((t) => t.id));
    const n = Math.max(1, vis.length);
    const pct = `${100 / n}%`;

    for (const t of this.data.tabs) {
      const view = this.views.get(t.id);
      if (!view) continue;
      this.host.appendChild(view.el);
      const on = visible.has(t.id);
      const last = on && t.id === vis[vis.length - 1]?.id;
      view.el.classList.toggle('is-visible', on);
      view.el.classList.toggle('is-focus', on && t.id === this.data.focusId);
      view.el.classList.toggle('is-last', !!last);
      if (on) {
        // Equal columns via flex-basis % so 2/3 panes don't collapse/overflow.
        view.el.style.flex = `1 1 ${pct}`;
        view.el.style.maxWidth = pct;
        view.el.style.minWidth = '0';
      } else {
        view.el.style.flex = '';
        view.el.style.maxWidth = '';
        view.el.style.minWidth = '';
      }
    }
  }

  mount(host: HTMLElement): void {
    this.host = host;

    this.offData = this.shell!.bridge.onTermData(({ id, data }) => {
      this.views.get(id)?.term.write(data);
    });
    this.offExit = this.shell!.bridge.onTermExit(({ id }) => {
      const tabs = this.data.tabs.map((t) =>
        t.id === id ? { ...t, alive: false } : t,
      );
      this.setData({ tabs });
    });

    this.ro = new ResizeObserver(() => this.fitAndResize());
    this.ro.observe(host);
  }

  /** Re-apply horizontal page layout and fit visible panes. */
  refreshLayout(): void {
    this.syncPaging();
    this.syncPaneLayout();
    this.scheduleFit();
  }

  private scheduleFit(): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.fitAndResize());
    });
  }

  fitAndResize(): void {
    if (!this.state.open || !this.host) return;
    for (const t of this.visibleTabs) {
      const view = this.views.get(t.id);
      if (!view) continue;
      if (view.el.clientWidth < 4 || view.el.clientHeight < 4) continue;
      try {
        view.fit.fit();
        void this.shell?.bridge.termResize(
          t.id,
          view.term.cols,
          view.term.rows,
        );
      } catch {
        /* ignore */
      }
    }
  }

  clearFocused(): void {
    const id = this.data.focusId;
    if (!id) return;
    this.views.get(id)?.term.clear();
  }

  unmount(): void {
    this.offData?.();
    this.offExit?.();
    this.offData = null;
    this.offExit = null;
    this.ro?.disconnect();
    this.ro = null;
    for (const id of [...this.views.keys()]) {
      this.disposeView(id);
    }
    void this.shell?.bridge.termKillAll();
    this.setData({ tabs: [], focusId: null });
    this.host = null;
  }
}
