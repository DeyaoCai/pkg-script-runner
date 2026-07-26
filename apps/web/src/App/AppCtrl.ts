import { Controller } from '@pkg-runner/controller';
import type { AppSettings, JobInfo, LogPayload, ProjectPayload, ProjectsState, PkgRunnerApi } from '../env';
import { ansiToHtml } from '../lib/ansi';
import { applyDocumentFonts } from '../lib/fonts';
import { fuzzyBestScore, sameDir } from '../lib/fuzzy';
import { tryPkgApi } from '../composables/usePkgApi';
import { ProjectsPanelCtrl } from '../components/ProjectsPanel/ProjectsPanelCtrl';
import { ScriptsPanelCtrl } from '../components/ScriptsPanel/ScriptsPanelCtrl';
import { LogPanelCtrl } from '../components/LogPanel/LogPanelCtrl';
import { TitleBarCtrl } from '../components/TitleBar/TitleBarCtrl';
import { ThemePanelCtrl } from '../components/ThemePanel/ThemePanelCtrl';

export type LogSession = {
  id: string;
  kind: 'system' | 'job' | 'shell';
  title: string;
  dir: string | null;
  scriptName?: string;
  text: string;
  html: string | null;
  running: boolean;
  code: number | null;
  cwd?: string;
};

export const SYSTEM_ID = 'system';

const THEME_KEY = 'pkg-runner-theme';
const GLASS_ALPHA_KEY = 'pkg-runner:glass-alpha';
const GLASS_BLUR_KEY = 'pkg-runner:glass-blur';
const FONT_KEY = 'pkg-runner:font';

export type AppData = {
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
    theme: 'dark',
    shellMosaicCols: 2,
    shellLayout: 'grid',
    alwaysOnTop: false,
    activateHotkey: '',
    screenshotHotkey: '',
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
  private readonly shellPendingData = new Map<string, string>();

  declare controllers: {
    projects: ProjectsPanelCtrl;
    scripts: ScriptsPanelCtrl;
    log: LogPanelCtrl;
    titleBar: TitleBarCtrl;
    theme: ThemePanelCtrl;
  };

  constructor() {
    super({
      data: {
        projects: [],
        activeProject: null,
        project: null,
        jobs: [],
        settings: defaultSettings(),
        logSessions: {},
        activeLogId: SYSTEM_ID,
        persistLogs: false,
        maximized: false,
        meta: '选择含 package.json 的项目目录',
        metaError: false,
        projectSearch: '',
        scriptSearch: '',
        projectsWidth: loadWidth('pkg-runner:projects-w', 220),
        scriptsWidth: loadWidth('pkg-runner:scripts-w', 176),
        theme: 'dark',
        glassAlpha: 55,
        glassBlur: readLocalBlur(),
        fontId: 'jetbrains',
      },
      props: {},
      state: {},
    });
    this.api = tryPkgApi();
    this.controllers = {
      projects: new ProjectsPanelCtrl(this),
      scripts: new ScriptsPanelCtrl(this),
      log: new LogPanelCtrl(this),
      titleBar: new TitleBarCtrl(this),
      theme: new ThemePanelCtrl(this),
    };
    this.ensureSystemSession();
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
      .map((s) => ({ s, score: fuzzyBestScore(q, [s.name, s.command]) }))
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

  openSettings(): void {
    void this.api?.openSharedSettings?.();
  }

  mount(): void {
    this.applyLayoutVars();
    const result = this.bootstrap();
    if (typeof result === 'function') this.cleanupBoot = result;
    else
      void Promise.resolve(result).then((fn) => {
        if (typeof fn === 'function') this.cleanupBoot = fn;
      });
  }

  unmount(): void {
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
      code: null,
    };
  }

  getSessionHtml(s: LogSession): string {
    if (s.html == null) s.html = ansiToHtml(s.text);
    return s.html;
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
        code: null,
        cwd: meta?.cwd,
      };
      this.data.logSessions[id] = s;
    }
    s.text += chunk;
    if (s.text.length > 800_000) s.text = s.text.slice(-600_000);
    s.html = null;
    if (meta?.title) s.title = meta.title;
    if (meta?.dir !== undefined) s.dir = meta.dir;
    if (meta?.scriptName) s.scriptName = meta.scriptName;
    if (meta?.running != null) s.running = meta.running;
    if (meta?.cwd) s.cwd = meta.cwd;
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
      this.setData({ activeLogId: payload.id });
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

  async applyProjectsState(state: ProjectsState): Promise<void> {
    this.setData({
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
          meta: e instanceof Error ? e.message : String(e),
          metaError: true,
        });
      }
    } else {
      this.setData({ project: null });
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
    document.documentElement.style.setProperty('--glass-alpha', String(a / 100));
    document.documentElement.style.setProperty('--glass-blur', `${b}px`);
  }

  applyTheme(next: 'dark' | 'light'): void {
    this.setData({ theme: next });
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* ignore */
    }
  }

  setFont(id: string): void {
    this.setData({ fontId: id });
    applyDocumentFonts(id);
    try {
      localStorage.setItem(FONT_KEY, id);
    } catch {
      /* ignore */
    }
  }

  applySettings(s: AppSettings): void {
    Object.assign(this.data.settings, s);
    this.applyTheme(s.theme === 'light' ? 'light' : 'dark');
    this.applyGlassVars(s.glassAlpha, this.data.glassBlur);
    this.setFont(s.fontId || 'jetbrains');
    try {
      localStorage.setItem(GLASS_ALPHA_KEY, String(this.data.glassAlpha));
    } catch {
      /* ignore */
    }
    const cols = Math.min(4, Math.max(1, s.shellMosaicCols || 2));
    document.documentElement.style.setProperty('--shell-mosaic-cols', String(cols));
  }

  async persistSettings(patch: Partial<AppSettings>) {
    if (!this.api) return;
    const res = await this.api.setSettings(patch);
    this.applySettings(res.settings);
    return res;
  }

  bootstrap(): (() => void) | void {
    this.ensureSystemSession();
    if (!this.api) {
      this.setData({ meta: '请在 Electron 中打开', metaError: true });
      return;
    }
    const api = this.api;
    const unsubs = [
      api.onLog((p) => this.handleLogPayload(p)),
      api.onJobs((list) => {
        this.setData({ jobs: list });
        for (const j of list) {
          const s = this.data.logSessions[j.id];
          if (s) s.running = true;
        }
        for (const [id, s] of Object.entries(this.data.logSessions)) {
          if (s.kind === 'job' && !list.some((j) => j.id === id)) s.running = false;
        }
      }),
      api.onExit((payload) => {
        const s = this.data.logSessions[payload.id];
        if (s) {
          s.running = false;
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
      api.onSettings((s) => this.applySettings(s)),
      api.onPersistLogs((enabled) => this.setData({ persistLogs: enabled })),
      api.onMaximized((v) => this.setData({ maximized: v })),
      api.onProjects((state) => {
        void this.applyProjectsState(state);
      }),
    ];
    if (api.onOpenSettings) {
      unsubs.push(api.onOpenSettings(() => this.openSettings()));
    }

    void (async () => {
      try {
        this.applySettings(await api.getSettings());
      } catch {
        /* ignore */
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
      await this.applyProjectsState(await api.getProjects());
      this.setData({ jobs: await api.getJobs() });
    })();

    return () => unsubs.forEach((u) => u());
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

  async pickAndAddProject(): Promise<void> {
    if (!this.api) return;
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
      await this.api.stop(existing.id);
      return;
    }
    const id = await this.api.runScript(dir, scriptName);
    this.setData({ activeLogId: id });
    this.appendToSession(id, '', {
      title: scriptName,
      scriptName,
      dir,
      running: true,
    });
  }

  async stopJob(jobId: string): Promise<void> {
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
      if (s.running) await this.api.stop(jobId);
      s.text = '';
      s.html = null;
      s.running = false;
      s.code = null;
      const newId = await this.api.runScript(dir, scriptName);
      this.setData({ activeLogId: newId });
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
    this.setData({ activeLogId: info.id });
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
    delete this.data.logSessions[id];
    if (this.data.activeLogId === id) {
      this.setData({ activeLogId: this.visibleLogs[0]?.id || SYSTEM_ID });
    }
  }

  clearActiveLog(): void {
    const s = this.data.logSessions[this.data.activeLogId];
    if (!s) return;
    s.text = '';
    s.html = '';
    s.code = null;
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
    this.setProjectsWidth(this.data.projectsWidth);
    this.setScriptsWidth(this.data.scriptsWidth);
    const cols = Math.min(4, Math.max(1, this.data.settings.shellMosaicCols || 2));
    document.documentElement.style.setProperty('--shell-mosaic-cols', String(cols));
  }

  onProjectsResize(e: PointerEvent): void {
    const startX = e.clientX;
    const startW = this.data.projectsWidth;
    const onMove = (ev: PointerEvent) => {
      this.setProjectsWidth(Math.min(420, Math.max(108, startW + (ev.clientX - startX))));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.classList.remove('is-resizing-projects');
    };
    document.body.classList.add('is-resizing-projects');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  onScriptsResize(e: PointerEvent): void {
    const startX = e.clientX;
    const startW = this.data.scriptsWidth;
    const onMove = (ev: PointerEvent) => {
      this.setScriptsWidth(Math.min(420, Math.max(120, startW + (ev.clientX - startX))));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.classList.remove('is-resizing-scripts');
    };
    document.body.classList.add('is-resizing-scripts');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }
}
