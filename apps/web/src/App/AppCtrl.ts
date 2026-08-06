import { Controller } from '@pkg-runner/controller';
import {
  BRAND_PRESET_PROD,
  applyBrandColor as setBrandTone,
  applyColorEnv as setColorEnv,
  applyFontId,
  applyGlass as setGlass,
  applySharedUiSettings,
  applyTheme as setUiTheme,
  normalizeBrandColor,
} from '@pkg-runner/tokens';
import type {
  AppSettings,
  JobInfo,
  LogPayload,
  ProjectPayload,
  ProjectsState,
  PkgRunnerApi,
  PkgRunnerColorEnv,
  UiStateSnapshot,
} from '../env';
import { ansiToHtml } from '../lib/ansi';
import { filterBestScore, fuzzyBestScore, sameDir } from '../lib/fuzzy';
import { tryPkgApi } from '../composables/usePkgApi';
import { ScriptsPanelCtrl } from '../components/ScriptsPanel/ScriptsPanelCtrl';
import { LogPanelCtrl } from '../components/LogPanel/LogPanelCtrl';
import { TitleBarCtrl } from '../components/TitleBar/TitleBarCtrl';
import { PortsPanelCtrl } from '../components/PortsPanel/PortsPanelCtrl';

export type LogSession = {
  id: string;
  kind: 'system' | 'job' | 'shell';
  title: string;
  dir: string | null;
  scriptName?: string;
  text: string;
  html: string | null;
  running: boolean;
  /** 已点停止、进程树尚未杀完 */
  stopping: boolean;
  code: number | null;
  cwd?: string;
};

export const SYSTEM_ID = 'system';

/** 输出面板内存上限（降到约 200KB，避免 ansi→HTML 打满主线程） */
const LOG_TEXT_MAX = 200_000;
const LOG_TEXT_KEEP = 150_000;

const GLASS_BLUR_KEY = 'pkg-runner:glass-blur';

export type AppData = {
  workspaceRoot: string | null;
  recentWorkspaces: string[];
  projects: ProjectsState['projects'];
  activeProject: string | null;
  project: ProjectPayload | null;
  jobs: JobInfo[];
  settings: AppSettings;
  logSessions: Record<string, LogSession>;
  activeLogId: string;
  persistLogs: boolean;
  maximized: boolean;
  meta: string;
  metaError: boolean;
  projectSearch: string;
  scriptSearch: string;
  projectsWidth: number;
  scriptsWidth: number;
  theme: 'dark' | 'light';
  colorEnv: PkgRunnerColorEnv;
  glassAlpha: number;
  glassBlur: number;
  fontId: string;
};

type TProps = Record<string, never>;

export type AppUiState = Record<string, never>;

function loadWidth(key: string, fallback: number): number {
  try {
    const n = Number(localStorage.getItem(key));
    if (Number.isFinite(n) && n > 0) return n;
  } catch {
    /* ignore */
  }
  return fallback;
}

function readLocalBlur(): number {
  try {
    const n = Number(localStorage.getItem(GLASS_BLUR_KEY));
    if (Number.isFinite(n)) return Math.min(40, Math.max(0, Math.round(n)));
  } catch {
    /* ignore */
  }
  return 22;
}

function defaultSettings(): AppSettings {
  return {
    fontId: 'jetbrains',
    glassAlpha: 55,
    glassBlur: 22,
    theme: 'dark',
    brandTone: 'prod',
    brandColor: BRAND_PRESET_PROD,
    shellMosaicCols: 2,
    shellLayout: 'grid',
    alwaysOnTop: false,
    activateHotkey: '',
    editorHotkey: '',
    zonesHotkey: '',
    settingsHotkey: '',
    historyHotkey: '',
    screenshotHotkey: '',
    hotkeysEnabled: true,
    screenshotHistoryLimit: 10,
    persistLogs: false,
  };
}

/**
 * 主窗口 Ctrl：业务 data + 壳 state；子面板经 controllers。
 */
export class AppCtrl extends Controller<AppData, TProps, AppUiState> {
  readonly api: PkgRunnerApi | null;
  private cleanupBoot: (() => void) | undefined;
  private metaFlashTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly shellPendingData = new Map<string, string>();
  /** 主机正在杀树的 job id（jobs 已摘掉、exit 未到） */
  private stoppingIds = new Set<string>();
  /** 待刷 ansi→html 的 session；每帧最多算一次可见面板 */
  private readonly logHtmlDirty = new Set<string>();
  private logHtmlRaf: number | null = null;

  declare controllers: {
    scripts: ScriptsPanelCtrl;
    log: LogPanelCtrl;
    titleBar: TitleBarCtrl;
    ports: PortsPanelCtrl;
  };

  constructor() {
    super({
      data: {
        workspaceRoot: null,
        recentWorkspaces: [],
        projects: [],
        activeProject: null,
        project: null,
        jobs: [],
        settings: defaultSettings(),
        logSessions: {},
        activeLogId: SYSTEM_ID,
        persistLogs: false,
        maximized: false,
        meta: '选择工作区，再点仓库运行脚本',
        metaError: false,
        projectSearch: '',
        scriptSearch: '',
        projectsWidth: loadWidth('pkg-runner:projects-w', 220),
        scriptsWidth: loadWidth('pkg-runner:scripts-w', 200),
        theme: 'dark',
        colorEnv: 'prod',
        glassAlpha: 55,
        glassBlur: readLocalBlur(),
        fontId: 'jetbrains',
      },
      props: {},
      state: {},
    });
    this.api = tryPkgApi();
    this.controllers = {
      scripts: new ScriptsPanelCtrl(this),
      log: new LogPanelCtrl(this),
      titleBar: new TitleBarCtrl(this),
      ports: new PortsPanelCtrl(this),
    };
    this.ensureSystemSession();
    this.applyColorEnv(this.api?.getColorEnv?.() ?? 'prod');
    if (this.api) {
      this.cleanupBoot = this.bindIpc(this.api);
    }
  }

  /** Register IPC before Vue mount so early main-process pushes are not missed. */
  private bindIpc(api: PkgRunnerApi): () => void {
    const unsubs = [
      api.onLog((p) => {
        this.handleLogPayload(p);
      }),
      api.onUiState((state) => {
        this.applyUiStateSnapshot(state);
      }),
      api.onJobs((list) => {
        void this.setData({ jobs: list });
        this.reconcileJobSessionFlags();
      }),
      ...(typeof api.onStopping === 'function'
        ? [
            api.onStopping((ids) => {
              this.stoppingIds = new Set(ids);
              this.reconcileJobSessionFlags();
            }),
          ]
        : []),
      api.onExit((payload) => {
        this.stoppingIds.delete(payload.id);
        const s = this.data.logSessions[payload.id];
        if (s) {
          s.running = false;
          s.stopping = false;
          s.code = payload.code;
        }
      }),
      api.onShellData((payload) => {
        const prev = this.shellPendingData.get(payload.id) || '';
        this.shellPendingData.set(payload.id, prev + payload.data);
        window.dispatchEvent(new CustomEvent('pkg:shell-data', { detail: payload }));
      }),
      api.onOpenDir((dir) => {
        void this.addProjectFromDir(dir);
      }),
      ...(typeof api.onFocusSession === 'function'
        ? [
            api.onFocusSession((payload) => {
              void this.focusSessionFromHost(payload);
            }),
          ]
        : []),
      ...(typeof api.onShellSession === 'function'
        ? [
            api.onShellSession((payload) => {
              void this.ensureShellSessionFromHost(payload);
            }),
          ]
        : []),
      api.onSettings((s) => {
        this.applySettings(s);
      }),
      // 必须 void：Vite 会把单语句块压成 `r=>this.setData(...)`，Proxy 经 contextBridge 回传会 "could not be cloned" → 黑屏
      api.onPersistLogs((enabled) => {
        void this.setData({ persistLogs: enabled });
      }),
      api.onMaximized((v) => {
        void this.setData({ maximized: v });
      }),
      api.onProjects((state) => {
        void this.applyProjectsState(state);
      }),
    ];
    void this.syncFromHost(api);
    return () => unsubs.forEach((u) => u());
  }

  private async syncFromHost(api: PkgRunnerApi): Promise<void> {
    try {
      this.applySettings(await api.getSettings());
    } catch {
      /* tray not ready */
    }
    try {
      this.setData({ persistLogs: await api.getPersistLogs() });
    } catch {
      /* ignore */
    }
    try {
      this.setData({ maximized: await api.windowIsMaximized() });
    } catch {
      /* ignore */
    }
    try {
      await this.applyProjectsState(await api.getProjects());
    } catch {
      /* ignore */
    }
    try {
      if (typeof api.getUiState === 'function') {
        this.applyUiStateSnapshot(await api.getUiState());
      } else {
        this.setData({ jobs: await api.getJobs() });
      }
    } catch {
      try {
        this.setData({ jobs: await api.getJobs() });
      } catch {
        /* ignore */
      }
    }
  }

  /** 主进程全量投影：替换 logSessions / jobs / stopping */
  applyUiStateSnapshot(state: UiStateSnapshot): void {
    const next: Record<string, LogSession> = {};
    for (const s of state.sessions || []) {
      next[s.id] = {
        id: s.id,
        kind: s.kind,
        title: s.title,
        dir: s.dir,
        scriptName: s.scriptName,
        text: s.text || '',
        html: null,
        running: !!s.running,
        stopping: !!s.stopping,
        code: s.code,
        cwd: s.cwd,
      };
      if (s.kind === 'shell' && s.text) {
        this.shellPendingData.set(s.id, s.text);
        window.dispatchEvent(
          new CustomEvent('pkg:shell-reset', { detail: { id: s.id, data: s.text } }),
        );
      }
    }
    if (!next[SYSTEM_ID]) {
      next[SYSTEM_ID] = {
        id: SYSTEM_ID,
        kind: 'system',
        title: '系统',
        dir: null,
        text: '',
        html: null,
        running: false,
        stopping: false,
        code: null,
      };
    }
    this.stoppingIds = new Set(state.stopping || []);
    this.setData({
      logSessions: next,
      jobs: state.jobs || [],
    });
    this.reconcileJobSessionFlags();
    const active = this.data.activeLogId;
    if (!next[active]) {
      this.setActiveLogId(this.visibleLogs[0]?.id || SYSTEM_ID);
    } else {
      this.ensureLogHtml(active);
    }
    // 网格下补算可见 job HTML
    if (this.controllers.log.mosaicMode) {
      for (const s of Object.values(next)) {
        if (s.kind === 'job' || s.kind === 'system') this.ensureLogHtml(s.id);
      }
    }
  }

  get filteredProjects() {
    const q = this.data.projectSearch.trim();
    const list = this.data.projects;
    if (!q) return list;
    return list
      .map((p) => ({ p, score: fuzzyBestScore(q, [p.name, p.dir]) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.p);
  }

  get filteredScripts() {
    const scripts = this.data.project?.scripts || [];
    const q = this.data.scriptSearch.trim();
    if (!q) return scripts;
    return scripts
      .map((s) => ({ s, score: filterBestScore(q, [s.name, s.command]) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.s);
  }

  get visibleLogs(): LogSession[] {
    const active = this.data.activeProject;
    const list: LogSession[] = [];
    for (const s of Object.values(this.data.logSessions)) {
      if (s.kind === 'system') {
        list.push(s);
        continue;
      }
      if (!active || !s.dir || sameDir(s.dir, active)) list.push(s);
    }
    return list;
  }

  private onWindowBlurClearResize = (): void => {
    document.body.classList.remove('is-resizing-projects', 'is-resizing-scripts');
  };

  mount(): void {
    this.applyLayoutVars();
    this.bootstrap();
    window.addEventListener('blur', this.onWindowBlurClearResize);
  }

  unmount(): void {
    window.removeEventListener('blur', this.onWindowBlurClearResize);
    document.body.classList.remove('is-resizing-projects', 'is-resizing-scripts');
    if (this.logHtmlRaf != null) {
      cancelAnimationFrame(this.logHtmlRaf);
      this.logHtmlRaf = null;
    }
    this.logHtmlDirty.clear();
    this.cleanupBoot?.();
    this.cleanupBoot = undefined;
    this.controllers.titleBar.dispose();
  }

  ensureSystemSession(): void {
    if (this.data.logSessions[SYSTEM_ID]) return;
    this.data.logSessions[SYSTEM_ID] = {
      id: SYSTEM_ID,
      kind: 'system',
      title: '系统',
      dir: null,
      text: '',
      html: null,
      running: false,
      stopping: false,
      code: null,
    };
  }

  /** running / stopping：jobs 列表 + 主机 stopping 集合 */
  private reconcileJobSessionFlags(): void {
    const alive = new Set(this.data.jobs.map((j) => j.id));
    for (const [id, s] of Object.entries(this.data.logSessions)) {
      if (s.kind !== 'job') continue;
      if (alive.has(id)) {
        s.running = true;
        s.stopping = false;
      } else if (this.stoppingIds.has(id)) {
        s.running = true;
        s.stopping = true;
      } else {
        s.running = false;
        s.stopping = false;
      }
    }
  }

  isScriptBusy(dir: string, scriptName: string): boolean {
    if (this.findJob(dir, scriptName)) return true;
    return Object.values(this.data.logSessions).some(
      (s) =>
        s.kind === 'job' &&
        s.scriptName === scriptName &&
        !!s.dir &&
        sameDir(s.dir, dir) &&
        (s.running || s.stopping),
    );
  }

  isScriptStopping(dir: string, scriptName: string): boolean {
    return Object.values(this.data.logSessions).some(
      (s) =>
        s.kind === 'job' &&
        s.scriptName === scriptName &&
        !!s.dir &&
        sameDir(s.dir, dir) &&
        s.stopping,
    );
  }

  getSessionHtml(s: LogSession): string {
    if (s.html == null) s.html = ansiToHtml(s.text);
    return s.html;
  }

  /** 切输出 tab：补算 HTML（后台 tab 可能 html=null） */
  setActiveLogId(id: string): void {
    this.setData({ activeLogId: id });
    this.ensureLogHtml(id);
  }

  /** 当前是否需要为该 session 跑 ansi→HTML（隐藏 tab 只攒 text） */
  isLogHtmlLive(s: LogSession): boolean {
    if (s.kind === 'shell') return false;
    const log = this.controllers.log;
    if (log.mosaicMode) return s.kind === 'job' || s.kind === 'system';
    return s.id === this.data.activeLogId;
  }

  /** 切 tab / 布局后补算一次可见输出 */
  ensureLogHtml(id: string): void {
    const s = this.data.logSessions[id];
    if (!s || s.kind === 'shell') return;
    if (s.html == null && s.text) s.html = ansiToHtml(s.text);
  }

  private scheduleLogHtmlFlush(): void {
    if (this.logHtmlRaf != null) return;
    this.logHtmlRaf = requestAnimationFrame(() => {
      this.logHtmlRaf = null;
      const ids = [...this.logHtmlDirty];
      this.logHtmlDirty.clear();
      for (const id of ids) {
        const s = this.data.logSessions[id];
        if (!s || s.kind === 'shell') continue;
        if (this.isLogHtmlLive(s)) s.html = ansiToHtml(s.text);
        else s.html = null;
      }
    });
  }

  findJob(dir: string, scriptName: string): JobInfo | undefined {
    return this.data.jobs.find((j) => sameDir(j.dir, dir) && j.scriptName === scriptName);
  }

  runningCountFor(dir: string): number {
    return this.data.jobs.filter((j) => sameDir(j.dir, dir)).length;
  }

  takeShellPending(id: string): string {
    const data = this.shellPendingData.get(id) || '';
    this.shellPendingData.delete(id);
    return data;
  }

  appendToSession(id: string, chunk: string, meta?: Partial<LogSession>): void {
    this.ensureSystemSession();
    let s = this.data.logSessions[id];
    if (!s) {
      s = {
        id,
        kind: id.startsWith('shell::') ? 'shell' : id === SYSTEM_ID ? 'system' : 'job',
        title: meta?.title || meta?.scriptName || id,
        dir: meta?.dir ?? null,
        scriptName: meta?.scriptName,
        text: '',
        html: null,
        running: !!meta?.running,
        stopping: !!meta?.stopping,
        code: null,
        cwd: meta?.cwd,
      };
      this.data.logSessions[id] = s;
    }
    if (chunk) s.text += chunk;
    if (s.text.length > LOG_TEXT_MAX) s.text = s.text.slice(-LOG_TEXT_KEEP);
    if (meta?.title) s.title = meta.title;
    if (meta?.dir !== undefined) s.dir = meta.dir;
    if (meta?.scriptName) s.scriptName = meta.scriptName;
    if (meta?.running != null) s.running = meta.running;
    if (meta?.stopping != null) s.stopping = meta.stopping;
    if (meta?.cwd) s.cwd = meta.cwd;
    if (s.kind === 'shell') return;
    if (chunk) {
      this.logHtmlDirty.add(id);
      this.scheduleLogHtmlFlush();
    }
  }

  private handleLogPayload(payload: LogPayload): void {
    if (payload.kind === 'system') {
      this.appendToSession(SYSTEM_ID, payload.chunk);
      return;
    }
    this.appendToSession(payload.id, payload.chunk, {
      title: payload.scriptName,
      scriptName: payload.scriptName,
      dir: payload.dir,
      running: true,
    });
    if (!this.data.activeLogId || this.data.activeLogId === SYSTEM_ID) {
      this.setActiveLogId(payload.id);
    }
  }

  private updateMeta(): void {
    const p = this.data.project;
    if (!p) {
      this.setData({ meta: '选择含 package.json 的项目目录', metaError: false });
      return;
    }
    this.setData({
      meta: `${p.name} · ${p.packageManager} · ${p.scripts.length} scripts · ${p.dir}`,
      metaError: false,
    });
  }

  flashMeta(message: string, isError: boolean): void {
    if (this.metaFlashTimer) clearTimeout(this.metaFlashTimer);
    this.setData({ meta: message, metaError: isError });
    this.metaFlashTimer = setTimeout(() => {
      this.metaFlashTimer = null;
      this.updateMeta();
    }, 2800);
  }

  async applyProjectsState(state: ProjectsState): Promise<void> {
    this.setData({
      workspaceRoot: state.workspaceRoot ?? null,
      recentWorkspaces: state.recentWorkspaces ?? [],
      projects: state.projects,
      activeProject: state.activeProject,
    });
    if (!this.api) return;
    if (state.activeProject) {
      try {
        const project = await this.api.loadProject(state.activeProject);
        this.setData({ project, metaError: false });
      } catch (e) {
        this.setData({
          project: null,
          meta:
            e instanceof Error
              ? e.message
              : '该仓库没有 package.json，无法加载脚本',
          metaError: true,
        });
      }
    } else {
      this.setData({
        project: null,
        meta: state.workspaceRoot
          ? '在左侧选择仓库以加载脚本'
          : '选择工作区，再点仓库运行脚本',
        metaError: false,
      });
    }
    this.updateMeta();
    try {
      const key = `pkg-runner:search:${(state.activeProject || '').toLowerCase()}`;
      this.setData({ scriptSearch: localStorage.getItem(key) || '' });
    } catch {
      this.setData({ scriptSearch: '' });
    }
  }

  applyGlassVars(alphaPct: number, blurPx: number): void {
    const a = Math.min(100, Math.max(10, Math.round(alphaPct)));
    const b = Math.min(40, Math.max(0, Math.round(blurPx)));
    this.setData({ glassAlpha: a, glassBlur: b });
    setGlass(a, b);
  }

  applyTheme(next: 'dark' | 'light'): void {
    this.setData({ theme: setUiTheme(next) });
  }

  applyColorEnv(env: PkgRunnerColorEnv): void {
    const next = setColorEnv(env === 'test' ? 'test' : 'prod');
    this.setData({ colorEnv: next });
    document.title =
      next === 'test' ? 'Pkg Runner · 测试' : 'Pkg Runner';
  }

  applyBrandColor(hex: string): void {
    setBrandTone(normalizeBrandColor(hex, BRAND_PRESET_PROD));
  }

  setFont(id: string): void {
    this.setData({ fontId: id });
    applyFontId(id);
  }

  applySettings(s: AppSettings): void {
    Object.assign(this.data.settings, s);
    this.setData({ persistLogs: s.persistLogs });
    const env = this.api?.getColorEnv?.() ?? this.data.colorEnv ?? 'prod';
    applySharedUiSettings(s, { colorEnv: env });
    this.setData({
      theme: s.theme === 'light' ? 'light' : 'dark',
      glassAlpha: s.glassAlpha,
      fontId: s.fontId || 'jetbrains',
      colorEnv: env === 'test' ? 'test' : 'prod',
    });
    document.title =
      env === 'test' ? 'Pkg Runner · 测试' : 'Pkg Runner';
  }

  bootstrap(): (() => void) | void {
    this.ensureSystemSession();
    if (!this.api) {
      this.setData({ meta: '请在 Electron 中打开', metaError: true });
    }
  }

  async selectProject(dir: string): Promise<void> {
    if (!this.api) return;
    await this.applyProjectsState(await this.api.setActiveProject(dir));
  }

  async addProjectFromDir(dir: string): Promise<void> {
    if (!this.api || !dir.trim()) return;
    try {
      await this.api.addProject(dir.trim());
      await this.applyProjectsState(await this.api.getProjects());
    } catch (e) {
      this.setData({
        meta: e instanceof Error ? e.message : String(e),
        metaError: true,
      });
    }
  }

  /** 控制面打开的交互 Shell：在 LogPanel 建 tab */
  ensureShellSessionFromHost(payload: {
    id: string;
    dir: string;
    cwd: string;
    title: string;
  }): void {
    this.appendToSession(payload.id, '', {
      title: payload.title || 'Shell',
      dir: payload.dir,
      cwd: payload.cwd,
      running: true,
    });
    void this.setActiveLogId(payload.id);
    const pending = this.shellPendingData.get(payload.id);
    if (pending) {
      window.dispatchEvent(
        new CustomEvent('pkg:shell-data', { detail: { id: payload.id, data: pending } }),
      );
      this.shellPendingData.delete(payload.id);
    }
  }

  /** 控制面 start/restart/stop / shell：聚焦对应日志或终端 */
  async focusSessionFromHost(payload: {
    id: string;
    dir: string | null;
  }): Promise<void> {
    const dir = payload.dir?.trim() || '';
    if (dir && this.api) {
      try {
        if (!this.data.activeProject || !sameDir(this.data.activeProject, dir)) {
          await this.applyProjectsState(await this.api.setActiveProject(dir));
        }
      } catch {
        try {
          await this.addProjectFromDir(dir);
        } catch {
          /* ignore */
        }
      }
    }
    const id = String(payload.id || '').trim();
    if (!id) return;
    if (!this.data.logSessions[id]) {
      this.appendToSession(id, '', {
        title: id.startsWith('shell::') ? 'Shell' : id.split('::').pop() || id,
        dir: dir || null,
        running: true,
      });
    }
    void this.setActiveLogId(id);
  }

  async pickAndAddProject(): Promise<void> {
    if (!this.api) return;
    if (typeof this.api.pickWorkspace === 'function') {
      await this.applyProjectsState(await this.api.pickWorkspace());
      return;
    }
    const dir = await this.api.pickDir();
    if (dir) await this.addProjectFromDir(dir);
  }

  async removeProject(dir: string): Promise<void> {
    if (!this.api) return;
    await this.applyProjectsState(await this.api.removeProject(dir));
  }

  async runScript(scriptName: string): Promise<void> {
    if (!this.api || !this.data.project) return;
    const dir = this.data.project.dir;
    const existing = this.findJob(dir, scriptName);
    if (existing) {
      await this.stopJob(existing.id);
      return;
    }
    // 停止中禁止立刻再 start（与主机 stoppingJobs 对齐）
    if (this.isScriptStopping(dir, scriptName)) return;
    const id = await this.api.runScript(dir, scriptName);
    this.setActiveLogId(id);
    this.appendToSession(id, '', {
      title: scriptName,
      scriptName,
      dir,
      running: true,
      stopping: false,
    });
  }

  async stopJob(jobId: string): Promise<void> {
    const s = this.data.logSessions[jobId];
    if (s?.stopping) return;
    if (s) {
      s.stopping = true;
      s.running = true;
    }
    this.stoppingIds.add(jobId);
    await this.api?.stop(jobId);
  }

  async restartJob(jobId: string): Promise<void> {
    if (!this.api) return;
    const s = this.data.logSessions[jobId];
    if (!s || s.kind !== 'job') return;
    const dir = s.dir;
    const scriptName = s.scriptName || s.title;
    if (!dir || !scriptName) {
      this.appendToSession(SYSTEM_ID, '\n[错误] 无法重启：缺少目录或脚本名\n');
      return;
    }
    try {
      if (s.running || s.stopping) await this.stopJob(jobId);
      s.text = '';
      s.html = null;
      s.running = false;
      s.stopping = false;
      s.code = null;
      const newId = await this.api.runScript(dir, scriptName);
      this.setActiveLogId(newId);
      this.appendToSession(newId, '', {
        title: scriptName,
        scriptName,
        dir,
        running: true,
      });
    } catch (err) {
      this.appendToSession(
        SYSTEM_ID,
        `\n[错误] ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  async openShell(): Promise<void> {
    if (!this.api || !this.data.project) return;
    const info = await this.api.shellOpen(this.data.project.dir, { cols: 80, rows: 24 });
    this.appendToSession(info.id, '', {
      title: info.title || 'Shell',
      dir: info.dir,
      cwd: info.cwd,
      running: true,
    });
    this.setActiveLogId(info.id);
    const pending = this.shellPendingData.get(info.id);
    if (pending) {
      window.dispatchEvent(
        new CustomEvent('pkg:shell-data', { detail: { id: info.id, data: pending } }),
      );
      this.shellPendingData.delete(info.id);
    }
  }

  async closeSession(id: string): Promise<void> {
    if (id === SYSTEM_ID) return;
    const s = this.data.logSessions[id];
    if (!s) return;
    if (s.kind === 'shell' && this.api) await this.api.shellClose(id);
    else if (s.running && this.api) await this.api.stop(id);
    if (this.api && typeof this.api.removeLogSession === 'function') {
      try {
        await this.api.removeLogSession(id);
      } catch {
        /* ignore */
      }
    }
    delete this.data.logSessions[id];
    if (this.data.activeLogId === id) {
      this.setActiveLogId(this.visibleLogs[0]?.id || SYSTEM_ID);
    }
  }

  clearActiveLog(): void {
    const id = this.data.activeLogId;
    const s = this.data.logSessions[id];
    if (!s) return;
    s.text = '';
    s.html = '';
    s.code = null;
    if (this.api && typeof this.api.clearLogSession === 'function') {
      void this.api.clearLogSession(id);
    }
  }

  setProjectSearch(q: string): void {
    this.setData({ projectSearch: q });
    try {
      localStorage.setItem('pkg-runner:project-search', q);
    } catch {
      /* ignore */
    }
  }

  setScriptSearch(q: string): void {
    this.setData({ scriptSearch: q });
    const dir = this.data.activeProject;
    if (!dir) return;
    try {
      localStorage.setItem(`pkg-runner:search:${dir.toLowerCase()}`, q);
    } catch {
      /* ignore */
    }
  }

  setProjectsWidth(px: number): void {
    const w = Math.min(420, Math.max(108, Math.round(px)));
    this.setData({ projectsWidth: w });
    document.getElementById('bodyPad')?.style.setProperty('--projects-w', `${w}px`);
    document.querySelector('.projects-panel')?.classList.toggle('is-narrow', w < 168);
    try {
      localStorage.setItem('pkg-runner:projects-w', String(w));
    } catch {
      /* ignore */
    }
  }

  setScriptsWidth(px: number): void {
    const w = Math.min(420, Math.max(120, Math.round(px)));
    this.setData({ scriptsWidth: w });
    document.getElementById('mainSplit')?.style.setProperty('--scripts-w', `${w}px`);
    try {
      localStorage.setItem('pkg-runner:scripts-w', String(w));
    } catch {
      /* ignore */
    }
  }

  applyLayoutVars(): void {
    this.setScriptsWidth(this.data.scriptsWidth);
    const cols = Math.min(4, Math.max(1, this.data.settings.shellMosaicCols || 2));
    document.documentElement.style.setProperty('--shell-mosaic-cols', String(cols));
  }

  private beginSplitResize(
    e: PointerEvent,
    bodyClass: 'is-resizing-projects' | 'is-resizing-scripts',
    onDelta: (dx: number) => void,
  ): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const target = e.currentTarget;
    if (target instanceof Element) {
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    const onMove = (ev: PointerEvent) => {
      onDelta(ev.clientX - startX);
    };
    const onEnd = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      document.body.classList.remove(bodyClass);
      if (target instanceof Element) {
        try {
          target.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
    };
    document.body.classList.add(bodyClass);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  }

  onProjectsResize(e: PointerEvent): void {
    const startW = this.data.projectsWidth;
    this.beginSplitResize(e, 'is-resizing-projects', (dx) => {
      this.setProjectsWidth(Math.min(420, Math.max(108, startW + dx)));
    });
  }

  onScriptsResize(e: PointerEvent): void {
    const startW = this.data.scriptsWidth;
    this.beginSplitResize(e, 'is-resizing-scripts', (dx) => {
      this.setScriptsWidth(Math.min(420, Math.max(120, startW + dx)));
    });
  }
}
