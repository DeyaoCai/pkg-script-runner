import { Controller } from '@pkg-runner/controller';
import type { TNavSnapshot, TGitChangeDto } from '../bridge.ts';
import type { TEditorTab, TOpenFileOpts } from '../types.ts';
import { ProjectToolbarCtrl } from '../components/ProjectToolbar/ProjectToolbarCtrl.ts';
import { RepoRouterCtrl } from '../components/RepoRouter/RepoRouterCtrl.ts';
import { FileTreeCtrl } from '../components/FileTree/FileTreeCtrl.ts';
import { EditorTabsCtrl } from '../components/EditorTabs/EditorTabsCtrl.ts';
import { DifferTreeCtrl } from '../components/DifferTree/DifferTreeCtrl.ts';
import { BottomTermCtrl } from '../components/BottomTerm/BottomTermCtrl.ts';
import { MdSplitCtrl } from '../components/MdSplit/MdSplitCtrl.ts';
import { isMarkdownPath } from '../renderMd.ts';
import {
  loadLayout,
  saveLayout,
  normalizeLayout,
  type TLayoutSizes,
  type TMdViewMode,
} from '../layoutSizes.ts';
import type { TRepoDto } from '../bridge.ts';

export type { TMdViewMode };

type TData = {
  workspaceRoot: string | null;
  cwd: string | null;
  projectRoot: string | null;
  boundRoot: string | null;
  cwdRel: string;
  canGoParent: boolean;
  projectLocked: boolean;
  recentWorkspaces: string[];
  repos: TRepoDto[];
  tabs: TEditorTab[];
  activeTabId: string | null;
  gitChanges: TGitChangeDto[];
  selectedChangePath: string | null;
  diffText: string;
  diffStaged: boolean;
  statusMessage: string;
  recentFiles: string[];
  /** Design zone repo root — independent of Review repo */
  designRoot: string | null;
  /** selected MD doc under designRoot (read-only preview) */
  designDocPath: string | null;
  designDocText: string;
  designDocError: string;
  designDocBinary: boolean;
};

type TProps = Record<string, never>;

type TState = {
  loadingTree: boolean;
  loadingGit: boolean;
  saving: boolean;
  bootstrapped: boolean;
  /** left 开发 tool window */
  leftTool: 'files' | 'differ';
  /** 设计区 bottom agents panel */
  agentsOpen: boolean;
  /** 设计 MD: source | split | preview */
  mdViewMode: TMdViewMode;
  /** Resizable pane sizes + chrome flags (localStorage). */
  layout: TLayoutSizes;
};

function fileName(relPath: string): string {
  const parts = relPath.split(/[\\/]/);
  return parts[parts.length - 1] || relPath;
}

function tabIdFor(relPath: string): string {
  return relPath.replace(/\\/g, '/');
}

function emptyNav(): Pick<
  TData,
  | 'workspaceRoot'
  | 'cwd'
  | 'projectRoot'
  | 'boundRoot'
  | 'cwdRel'
  | 'canGoParent'
  | 'projectLocked'
  | 'recentWorkspaces'
  | 'recentFiles'
  | 'repos'
> {
  return {
    workspaceRoot: null,
    cwd: null,
    projectRoot: null,
    boundRoot: null,
    cwdRel: '',
    canGoParent: false,
    projectLocked: false,
    recentWorkspaces: [],
    recentFiles: [],
    repos: [],
  };
}

export class CodeEditorShellCtrl extends Controller<TData, TProps, TState> {
  declare controllers: {
    toolbar: ProjectToolbarCtrl;
    repos: RepoRouterCtrl;
    designRepos: RepoRouterCtrl;
    tree: FileTreeCtrl;
    docs: FileTreeCtrl;
    md: MdSplitCtrl;
    editor: EditorTabsCtrl;
    git: DifferTreeCtrl;
    term: BottomTermCtrl;
  };

  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private layoutSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private prevBoundRoot: string | null = null;
  private externalPollTimer: ReturnType<typeof setInterval> | null = null;
  private checkingExternal = false;
  private writingPaths = new Set<string>();
  private onWindowFocus: (() => void) | null = null;

  constructor() {
    const toolbar = new ProjectToolbarCtrl();
    const repos = new RepoRouterCtrl('review');
    const designRepos = new RepoRouterCtrl('design');
    const tree = new FileTreeCtrl('code');
    const docs = new FileTreeCtrl('docs');
    const md = new MdSplitCtrl();
    const editor = new EditorTabsCtrl();
    const git = new DifferTreeCtrl();
    const term = new BottomTermCtrl();
    const layout = loadLayout();

    super({
      data: {
        ...emptyNav(),
        tabs: [],
        activeTabId: null,
        gitChanges: [],
        selectedChangePath: null,
        diffText: '',
        diffStaged: false,
        statusMessage: '',
        designRoot: null,
        designDocPath: null,
        designDocText: '',
        designDocError: '',
        designDocBinary: false,
      },
      props: {},
      state: {
        loadingTree: false,
        loadingGit: false,
        saving: false,
        bootstrapped: false,
        leftTool: layout.leftTool,
        agentsOpen: layout.agentsOpen,
        mdViewMode: layout.mdViewMode,
        layout,
      },
    });

    this.controllers = {
      toolbar,
      repos,
      designRepos,
      tree,
      docs,
      md,
      editor,
      git,
      term,
    };
    toolbar.bindShell(this);
    repos.bindShell(this);
    designRepos.bindShell(this);
    tree.bindShell(this);
    docs.bindShell(this);
    md.bindShell(this);
    editor.bindShell(this);
    git.bindShell(this);
    term.bindShell(this);
  }

  /** Click active Files/Differ again to hide sidebar; otherwise switch + show. */
  setLeftTool(tool: 'files' | 'differ'): void {
    if (this.state.leftTool === tool && this.state.layout.reviewSidebarOpen) {
      this.patchLayout({ reviewSidebarOpen: false });
      return;
    }
    this.setState({ leftTool: tool });
    this.patchLayout({ leftTool: tool, reviewSidebarOpen: true });
    if (tool === 'differ') {
      void this.refreshGit();
    }
  }

  toggleDocs(): void {
    this.patchLayout({ docsOpen: !this.state.layout.docsOpen });
  }

  toggleAgents(): void {
    const agentsOpen = !this.state.agentsOpen;
    this.setState({ agentsOpen });
    this.patchLayout({ agentsOpen });
  }

  /** Toggle left 开发 zone. If it would leave both closed, open 设计 instead. */
  toggleDevZone(): void {
    const { devOpen, designOpen } = this.state.layout;
    if (devOpen && !designOpen) {
      this.patchLayout({ devOpen: false, designOpen: true });
      return;
    }
    this.patchLayout({ devOpen: !devOpen });
  }

  /** Toggle right 设计 zone. If it would leave both closed, open 开发 instead. */
  toggleDesignZone(): void {
    const { devOpen, designOpen } = this.state.layout;
    if (designOpen && !devOpen) {
      this.patchLayout({ designOpen: false, devOpen: true });
      return;
    }
    this.patchLayout({ designOpen: !designOpen });
  }

  setMdViewMode(mode: TMdViewMode): void {
    if (mode === this.state.mdViewMode) return;
    this.setState({ mdViewMode: mode });
    this.patchLayout({ mdViewMode: mode });
  }

  patchLayout(patch: Partial<TLayoutSizes>): void {
    const layout = normalizeLayout({ ...this.state.layout, ...patch });
    this.setState({
      layout,
      ...(patch.leftTool !== undefined ? { leftTool: layout.leftTool } : {}),
      ...(patch.agentsOpen !== undefined
        ? { agentsOpen: layout.agentsOpen }
        : {}),
      ...(patch.mdViewMode !== undefined
        ? { mdViewMode: layout.mdViewMode }
        : {}),
    });
    if (this.layoutSaveTimer) clearTimeout(this.layoutSaveTimer);
    this.layoutSaveTimer = setTimeout(() => saveLayout(layout), 200);
  }

  /** Design zone repo — same workspace catalog as Dev, independent selection. */
  async selectDesignRepo(repoAbs: string): Promise<void> {
    try {
      await this.saveDesignDoc();
      const root = await this.bridge.setDesignRoot(repoAbs);
      this.setData({
        designRoot: root,
        designDocPath: null,
        designDocText: '',
        designDocError: '',
        designDocBinary: false,
        statusMessage: root ? `设计仓库 · ${root}` : this.data.statusMessage,
      });
      this.controllers.md.clear();
      this.controllers.designRepos.syncFromShell();
      if (root) await this.controllers.docs.reload();
      else this.controllers.docs.clear();
    } catch (e) {
      this.setData({
        statusMessage: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async showDesignInExplorer(): Promise<void> {
    try {
      await this.bridge.revealDesignRoot();
    } catch (e) {
      this.setData({
        statusMessage: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async revealDesignPath(relPath: string): Promise<void> {
    try {
      await this.bridge.revealDesignPath(relPath);
    } catch (e) {
      this.setData({
        statusMessage: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /** Open a design-zone doc (MD → split edit/preview; other text → FilePreview). */
  async openDesignDoc(relPath: string): Promise<void> {
    const norm = relPath.replace(/\\/g, '/');
    await this.saveDesignDoc();
    try {
      const result = await this.bridge.readDesignFile(norm);
      if (!result.ok) {
        this.setData({
          designDocPath: norm,
          designDocText: '',
          designDocError: result.error,
          designDocBinary: false,
        });
        this.controllers.md.clear();
        return;
      }
      if (result.kind === 'binary') {
        this.setData({
          designDocPath: norm,
          designDocText: '',
          designDocError: '',
          designDocBinary: true,
        });
        this.controllers.md.clear();
        return;
      }
      this.setData({
        designDocPath: norm,
        designDocText: result.content,
        designDocError: '',
        designDocBinary: false,
        statusMessage: `文档 · ${norm}`,
      });
      if (isMarkdownPath(norm)) {
        this.controllers.md.load(norm, result.content);
      } else {
        this.controllers.md.clear();
      }
    } catch (e) {
      this.setData({
        designDocPath: norm,
        designDocText: '',
        designDocError: e instanceof Error ? e.message : String(e),
        designDocBinary: false,
      });
      this.controllers.md.clear();
    }
  }

  async saveDesignDoc(): Promise<void> {
    const md = this.controllers.md;
    const rel = md.data.relPath;
    if (!rel || !md.data.dirty || !this.data.designRoot) return;
    try {
      const content = md.getDoc();
      await this.bridge.writeDesignFile(rel, content);
      md.markClean();
      this.setData({
        designDocText: content,
        statusMessage: `已保存 · ${rel}`,
      });
    } catch (e) {
      this.setData({
        statusMessage: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async closeDesignDoc(): Promise<void> {
    await this.saveDesignDoc();
    this.setData({
      designDocPath: null,
      designDocText: '',
      designDocError: '',
      designDocBinary: false,
    });
    this.controllers.md.clear();
  }

  async openDesignWithSystem(relPath?: string | null): Promise<void> {
    const path = relPath ?? this.data.designDocPath;
    if (!path) return;
    try {
      await this.bridge.openDesignPath(path);
      this.setData({ statusMessage: `已用系统应用打开 · ${path}` });
    } catch (e) {
      this.setData({
        statusMessage: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async hydrateDesignRoot(): Promise<void> {
    try {
      const stored = await this.bridge.getDesignRoot();
      const root = this.clampDesignRoot(stored);
      if (stored && !root) {
        await this.bridge.setDesignRoot(null);
      }
      this.setData({
        designRoot: root,
        designDocPath: null,
        designDocText: '',
        designDocError: '',
        designDocBinary: false,
      });
      this.controllers.md.clear();
      this.controllers.designRepos.syncFromShell();
      if (root) await this.controllers.docs.reload();
      else this.controllers.docs.clear();
    } catch {
      this.setData({ designRoot: null });
      this.controllers.md.clear();
      this.controllers.designRepos.syncFromShell();
      this.controllers.docs.clear();
    }
  }

  /** Keep designRoot only if it is still a repo under the current workspace. */
  private clampDesignRoot(root: string | null): string | null {
    if (!root || !this.data.workspaceRoot) return null;
    const hit = this.data.repos.find(
      (r) =>
        r.abs.replace(/[\\/]+$/, '').toLowerCase() ===
        root.replace(/[\\/]+$/, '').toLowerCase(),
    );
    return hit?.abs ?? null;
  }

  get activeTab(): TEditorTab | null {
    return this.data.tabs.find((t) => t.id === this.data.activeTabId) ?? null;
  }

  get bridge() {
    return window.codeEditor;
  }

  /** Open path (or current repo root) in the OS file manager. */
  async showInExplorer(relPath?: string | null): Promise<void> {
    try {
      await this.bridge.showItem(relPath ?? null);
    } catch (e) {
      this.setData({
        statusMessage: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /** Open file with the OS default application. */
  async openWithSystem(relPath: string): Promise<void> {
    try {
      await this.bridge.openPath(relPath);
      this.setData({ statusMessage: `已用系统应用打开 · ${relPath}` });
    } catch (e) {
      this.setData({
        statusMessage: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /** @deprecated use boundRoot — kept for tree checks */
  get activeRoot(): string {
    return this.data.boundRoot ?? '';
  }

  async bootstrap(): Promise<void> {
    if (this.state.bootstrapped) return;
    const initial = await this.bridge.getInitialOpenDir();
    if (initial) {
      await this.applyNav(await this.bridge.openWorkspace(initial));
    } else {
      await this.applyNav(await this.bridge.getNav());
    }
    this.setState({ bootstrapped: true });
    await this.hydrateDesignRoot();
    await this.restoreRecentFiles();
    this.startExternalWatch();
  }

  startExternalWatch(): void {
    this.stopExternalWatch();
    this.externalPollTimer = setInterval(() => {
      void this.checkExternalChanges();
    }, 1500);
    this.onWindowFocus = () => {
      void this.checkExternalChanges();
    };
    window.addEventListener('focus', this.onWindowFocus);
    document.addEventListener('visibilitychange', this.onWindowFocus);
  }

  stopExternalWatch(): void {
    if (this.externalPollTimer) {
      clearInterval(this.externalPollTimer);
      this.externalPollTimer = null;
    }
    if (this.onWindowFocus) {
      window.removeEventListener('focus', this.onWindowFocus);
      document.removeEventListener('visibilitychange', this.onWindowFocus);
      this.onWindowFocus = null;
    }
  }

  /** Compare open tabs against disk mtime. */
  async checkExternalChanges(): Promise<void> {
    if (this.checkingExternal || !this.data.boundRoot || !this.data.tabs.length) {
      return;
    }
    this.checkingExternal = true;
    try {
      let changed = false;
      let tabs = [...this.data.tabs];
      for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i]!;
        if (this.writingPaths.has(tab.relPath)) continue;
        const st = await this.bridge.statFile(tab.relPath);
        if (!st.ok) {
          if (!tab.externalConflict) {
            tabs[i] = { ...tab, externalConflict: true };
            changed = true;
            this.setData({
              statusMessage: `磁盘文件已删除或不可读 · ${tab.relPath}`,
            });
          }
          continue;
        }
        // allow small clock skew / same write
        if (st.mtimeMs <= tab.diskMtimeMs + 1) continue;

        if (!tab.dirty) {
          const result = await this.bridge.readFile(tab.relPath);
          if (!result.ok) continue;
          if (result.kind === 'binary') {
            tabs[i] = {
              ...tab,
              kind: 'binary',
              content: '',
              savedContent: '',
              dirty: false,
              diskMtimeMs: result.mtimeMs,
              size: result.size,
              externalConflict: false,
              rev: tab.rev + 1,
            };
          } else {
            tabs[i] = {
              ...tab,
              kind: 'text',
              content: result.content,
              savedContent: result.content,
              dirty: false,
              diskMtimeMs: result.mtimeMs,
              size: result.size,
              externalConflict: false,
              rev: tab.rev + 1,
            };
          }
          changed = true;
          this.setData({
            statusMessage: `已同步外部修改 · ${tab.relPath}`,
          });
        } else if (!tab.externalConflict) {
          tabs[i] = { ...tab, externalConflict: true };
          changed = true;
          this.setData({
            statusMessage: `外部已修改，与本地未保存冲突 · ${tab.relPath}`,
          });
        } else {
          // refresh disk mtime marker only when already in conflict? keep flag
        }
      }
      if (changed) {
        this.setData({ tabs });
        this.controllers.editor.syncFromShell();
      }
    } finally {
      this.checkingExternal = false;
    }
  }

  /** Discard local edits and reload from disk. */
  async reloadFromDisk(tabId?: string): Promise<void> {
    const id = tabId ?? this.data.activeTabId;
    if (!id) return;
    const tab = this.data.tabs.find((t) => t.id === id);
    if (!tab) return;
    const result = await this.bridge.readFile(tab.relPath);
    if (!result.ok) {
      this.setData({ statusMessage: result.error });
      return;
    }
    const tabs = this.data.tabs.map((t) => {
      if (t.id !== id) return t;
      if (result.kind === 'binary') {
        return {
          ...t,
          kind: 'binary' as const,
          content: '',
          savedContent: '',
          dirty: false,
          diskMtimeMs: result.mtimeMs,
          size: result.size,
          externalConflict: false,
          rev: t.rev + 1,
        };
      }
      return {
        ...t,
        kind: 'text' as const,
        content: result.content,
        savedContent: result.content,
        dirty: false,
        diskMtimeMs: result.mtimeMs,
        size: result.size,
        externalConflict: false,
        rev: t.rev + 1,
      };
    });
    this.setData({ tabs, statusMessage: `已从磁盘重新加载 · ${tab.relPath}` });
    this.controllers.editor.syncFromShell();
  }

  /** Keep local buffer; next save will overwrite disk. */
  keepLocalOverwrite(tabId?: string): void {
    const id = tabId ?? this.data.activeTabId;
    if (!id) return;
    const tabs = this.data.tabs.map((t) =>
      t.id === id ? { ...t, externalConflict: false } : t,
    );
    this.setData({
      tabs,
      statusMessage: '将保留本地修改，保存时覆盖磁盘',
    });
    this.controllers.editor.syncFromShell();
  }

  async applyNav(nav: TNavSnapshot, opts: { clearTabs?: boolean } = {}): Promise<void> {
    const boundChanged =
      !!this.prevBoundRoot &&
      !!nav.boundRoot &&
      this.prevBoundRoot.toLowerCase() !== nav.boundRoot.toLowerCase();
    const shouldClear =
      opts.clearTabs || boundChanged || (!!this.prevBoundRoot && !nav.boundRoot);

    this.setData({
      workspaceRoot: nav.workspaceRoot,
      cwd: nav.cwd,
      projectRoot: nav.projectRoot,
      boundRoot: nav.boundRoot,
      cwdRel: nav.cwdRel,
      canGoParent: nav.canGoParent,
      projectLocked: nav.projectLocked,
      recentWorkspaces: nav.recentWorkspaces,
      recentFiles: nav.recentFiles,
      repos: nav.repos ?? [],
    });

    if (shouldClear) {
      this.setData({
        tabs: [],
        activeTabId: null,
        gitChanges: [],
        selectedChangePath: null,
        diffText: '',
      });
    }

    this.prevBoundRoot = nav.boundRoot;
    this.controllers.toolbar.syncFromShell();
    this.controllers.repos.syncFromShell();

    // Design repo is workspace-scoped — drop if no longer in catalog
    const designOk = this.clampDesignRoot(this.data.designRoot);
    if (this.data.designRoot && !designOk) {
      this.setData({
        designRoot: null,
        designDocPath: null,
        designDocText: '',
        designDocError: '',
        designDocBinary: false,
      });
      void this.bridge.setDesignRoot(null);
      this.controllers.md.clear();
      this.controllers.docs.clear();
    } else if (designOk && designOk !== this.data.designRoot) {
      this.setData({ designRoot: designOk });
    }
    this.controllers.designRepos.syncFromShell();
    if (this.data.designRoot) void this.controllers.docs.reload();
    else this.controllers.docs.clear();

    if (nav.projectRoot) {
      await this.controllers.tree.reload();
      await this.refreshGit();
      this.setData({ statusMessage: `仓库 · ${nav.projectRoot}` });
    } else if (nav.workspaceRoot) {
      this.controllers.tree.clear();
      this.setData({
        gitChanges: [],
        selectedChangePath: null,
        diffText: '',
        statusMessage: `工作区 · 请选择仓库（发现 ${nav.repos?.length ?? 0} 个）`,
      });
    } else {
      this.controllers.tree.clear();
      this.setData({
        gitChanges: [],
        selectedChangePath: null,
        diffText: '',
        statusMessage: '请选择工作区目录',
      });
    }
  }

  async pickWorkspace(): Promise<void> {
    await this.applyNav(await this.bridge.pickWorkspace(), { clearTabs: true });
  }

  async openWorkspace(dir: string): Promise<void> {
    await this.applyNav(await this.bridge.openWorkspace(dir), { clearTabs: true });
  }

  async selectRepo(repoAbs: string): Promise<void> {
    await this.applyNav(await this.bridge.selectRepo(repoAbs), { clearTabs: true });
  }

  /** Nested repo dir under current repo → switch lock to that abs path */
  async selectNestedRepo(relPath: string): Promise<void> {
    const root = this.data.projectRoot;
    if (!root) return;
    const sep = root.includes('\\') ? '\\' : '/';
    const abs = `${root.replace(/[\\/]+$/, '')}${sep}${relPath.replace(/\//g, sep)}`;
    await this.selectRepo(abs);
  }

  async enterDir(relPath: string): Promise<void> {
    const before = this.data.boundRoot;
    const nav = await this.bridge.enterDir(relPath);
    const lockedNow =
      !!nav.projectRoot &&
      (!before || before.toLowerCase() !== (nav.boundRoot || '').toLowerCase());
    await this.applyNav(nav, { clearTabs: lockedNow });
  }

  async goParent(): Promise<void> {
    await this.applyNav(await this.bridge.goParent());
  }

  async goWorkspaceRoot(): Promise<void> {
    await this.applyNav(await this.bridge.goWorkspaceRoot(), { clearTabs: true });
  }

  async goBoundRoot(): Promise<void> {
    await this.applyNav(await this.bridge.goBoundRoot());
  }

  private async restoreRecentFiles(): Promise<void> {
    const files = this.data.recentFiles;
    if (!files?.length || !this.data.boundRoot) return;
    const kept: string[] = [];
    for (const rel of files.slice(0, 8)) {
      const ok = await this.bridge.isFile(rel);
      if (!ok) continue;
      const opened = await this.openFile(rel);
      if (opened) kept.push(rel);
    }
    const rest = files.slice(8).filter((p) => !kept.includes(p));
    const next = [...kept, ...rest];
    if (next.join('\0') !== files.join('\0')) {
      await this.applyNav(await this.bridge.updateRecentFiles(next));
    }
  }

  async openFile(relPath: string, opts: TOpenFileOpts = {}): Promise<boolean> {
    const norm = relPath.replace(/\\/g, '/');
    const id = tabIdFor(norm);
    const existing = this.data.tabs.find((t) => t.id === id);
    if (existing) {
      this.setData({ activeTabId: existing.id });
      this.controllers.editor.syncFromShell();
      if (opts.line != null) {
        this.controllers.editor.requestGotoLine(opts.line);
      }
      return true;
    }
    const result = await this.bridge.readFile(norm);
    if (!result.ok) {
      this.setData({ statusMessage: result.error });
      return false;
    }
    const isBinary = result.kind === 'binary';
    const content = isBinary ? '' : result.content;
    const tab: TEditorTab = {
      id,
      relPath: norm,
      name: fileName(norm),
      kind: isBinary ? 'binary' : 'text',
      content,
      savedContent: content,
      dirty: false,
      diskMtimeMs: result.mtimeMs,
      size: result.size,
      externalConflict: false,
      rev: 1,
    };
    this.setData({
      tabs: [...this.data.tabs, tab],
      activeTabId: id,
    });
    this.controllers.editor.syncFromShell();
    this.schedulePersistRecent();
    if (opts.line != null) {
      queueMicrotask(() => this.controllers.editor.requestGotoLine(opts.line!));
    }
    return true;
  }

  setActiveTab(id: string): void {
    this.setData({ activeTabId: id });
    this.controllers.editor.syncFromShell();
  }

  closeTab(id: string): void {
    const tabs = this.data.tabs.filter((t) => t.id !== id);
    let activeTabId = this.data.activeTabId;
    if (activeTabId === id) {
      activeTabId = tabs[tabs.length - 1]?.id ?? null;
    }
    this.setData({ tabs, activeTabId });
    this.controllers.editor.syncFromShell();
    this.schedulePersistRecent();
  }

  closeOtherTabs(keepId: string): void {
    const keep = this.data.tabs.find((t) => t.id === keepId);
    if (!keep) return;
    this.setData({ tabs: [keep], activeTabId: keepId });
    this.controllers.editor.syncFromShell();
    this.schedulePersistRecent();
  }

  closeAllTabs(): void {
    this.setData({ tabs: [], activeTabId: null });
    this.controllers.editor.syncFromShell();
    this.schedulePersistRecent();
  }

  onEditorChange(id: string, content: string): void {
    const tabs = this.data.tabs.map((t) => {
      if (t.id !== id) return t;
      return { ...t, content, dirty: content !== t.savedContent };
    });
    this.setData({ tabs });
    this.controllers.editor.syncFromShell();
  }

  async saveTab(id: string): Promise<void> {
    const tab = this.data.tabs.find((t) => t.id === id);
    if (!tab || !tab.dirty || tab.kind === 'binary') return;
    this.setState({ saving: true });
    this.writingPaths.add(tab.relPath);
    try {
      const written = await this.bridge.writeFile(tab.relPath, tab.content);
      const tabs = this.data.tabs.map((t) =>
        t.id === tab.id
          ? {
              ...t,
              savedContent: t.content,
              dirty: false,
              diskMtimeMs: written.mtimeMs,
              externalConflict: false,
            }
          : t,
      );
      this.setData({ tabs, statusMessage: `已保存 · ${tab.relPath}` });
      this.controllers.editor.syncFromShell();
    } catch (e) {
      this.setData({
        statusMessage: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setTimeout(() => this.writingPaths.delete(tab.relPath), 800);
      this.setState({ saving: false });
    }
  }

  async saveDirtyTabs(ids?: string[]): Promise<void> {
    const targets = this.data.tabs.filter(
      (t) => t.dirty && (!ids || ids.includes(t.id)),
    );
    for (const t of targets) {
      await this.saveTab(t.id);
    }
    if (targets.length) await this.refreshGit();
  }

  async saveActive(): Promise<void> {
    const tab = this.activeTab;
    if (!tab || !tab.dirty) return;
    await this.saveTab(tab.id);
    await this.refreshGit();
  }

  async refreshGit(): Promise<void> {
    if (!this.data.boundRoot) {
      this.setData({ gitChanges: [], diffText: '', selectedChangePath: null });
      return;
    }
    this.setState({ loadingGit: true });
    try {
      const gitChanges = await this.bridge.gitStatus();
      this.setData({ gitChanges });
      const sel = this.data.selectedChangePath;
      if (sel && gitChanges.some((c) => c.path === sel)) {
        const hit = gitChanges.find((c) => c.path === sel)!;
        await this.loadDiff(sel, this.data.diffStaged, hit);
      } else if (gitChanges[0]) {
        await this.selectGitChange(gitChanges[0]);
      } else {
        this.setData({ selectedChangePath: null, diffText: '' });
      }
      this.controllers.git.syncFromShell();
    } catch (e) {
      this.setData({
        gitChanges: [],
        diffText: '',
        statusMessage: e instanceof Error ? e.message : String(e),
      });
    } finally {
      this.setState({ loadingGit: false });
    }
  }

  async selectChange(relPath: string, staged = false): Promise<void> {
    this.setData({ selectedChangePath: relPath, diffStaged: staged });
    await this.loadDiff(relPath, staged);
    this.controllers.git.syncFromShell();
  }

  async selectGitChange(change: {
    path: string;
    staged: boolean;
    unstaged: boolean;
    index: string;
    worktree: string;
  }): Promise<void> {
    const staged = change.staged && !change.unstaged;
    this.setData({ selectedChangePath: change.path, diffStaged: staged });
    await this.loadDiff(change.path, staged, change);
    this.controllers.git.syncFromShell();
  }

  async loadDiff(
    relPath: string,
    staged: boolean,
    meta?: { index?: string; worktree?: string },
  ): Promise<void> {
    try {
      const change =
        meta ??
        this.data.gitChanges.find((c) => c.path === relPath) ??
        undefined;
      const diffText = await this.bridge.gitDiff(relPath, {
        staged,
        index: change?.index,
        worktree: change?.worktree,
      });
      this.setData({
        diffText,
        statusMessage: diffText.trim()
          ? `Diff · ${relPath}`
          : `无文本 Diff · ${relPath}`,
      });
    } catch (e) {
      this.setData({
        diffText: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async jumpFromDiff(relPath: string, line: number): Promise<void> {
    await this.revealInFiles(relPath, { line });
  }

  /** Differ → Files: switch tool window and open the file. */
  async revealInFiles(
    relPath: string,
    opts: TOpenFileOpts = {},
  ): Promise<boolean> {
    this.setLeftTool('files');
    return this.openFile(relPath, opts);
  }

  /** Expand the file tree to `relPath` and highlight it. */
  async locateInTree(relPath: string): Promise<void> {
    await this.controllers.tree.locate(relPath);
  }

  schedulePersistRecent(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      void this.persistRecent();
    }, 400);
  }

  async persistRecent(): Promise<void> {
    if (!this.data.boundRoot) return;
    const files = this.data.tabs.map((t) => t.relPath);
    await this.applyNav(await this.bridge.updateRecentFiles(files));
  }
}
