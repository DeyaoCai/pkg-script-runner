import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  screen,
  shell,
} from 'electron';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pty, { type IPty } from 'node-pty';
import { loadProjectScripts, pmRunArgs } from './pkg.js';
import {
  loadPrefs,
  savePrefs,
  sameDir,
  type Prefs,
} from './prefs.js';
import {
  coerceSharedSettings,
  defaultSharedSettings,
  type SharedSettings,
} from './sharedSettings.js';
import {
  requestTrayOpenSettings,
  requestTrayPatchSettings,
  requestTrayPublishSettings,
  pullSettingsFromTray,
} from './trayCmd.js';
import {
  appendJobDiskLog,
  appendSystemDiskLog,
  clearDiskLogs,
  closeAllDiskLogs,
  closeJobDiskLog,
  ensureLogsDir,
  flushAllDiskLogs,
  getLogsDir,
  setPersistLogs,
} from './logSink.js';
import { flushLogsNow, startControlServer } from './controlServer.js';
import { diagLog, diagLogPath, readDiagTail } from './diagLog.js';

export type RunnerHostMode = 'standalone' | 'embedded';

export type RunnerHostOptions = {
  mode?: RunnerHostMode;
  /** Embedded: tray supplies settings synchronously (no tray-cmd / HTTP pull). */
  getSharedSettings?: () => SharedSettings;
};

let hostMode: RunnerHostMode = 'standalone';
let getSharedSettingsFn: (() => SharedSettings) | null = null;

const __dirnameHost = path.dirname(fileURLToPath(import.meta.url));

/** Runner app root (dist-ui, ui). Override via PKG_RUNNER_APP_DIR — must be lazy (tray sets env after import). */
function runnerAppRoot(): string {
  const fromEnv = process.env.PKG_RUNNER_APP_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(__dirnameHost, '..');
}

/**
 * Where preload.cjs lives:
 * - embedded tray: dist/runner/preload.cjs (next to tray main.js)
 * - standalone runner: dist/preload.cjs (next to runner main.js)
 */
function runnerDistDir(): string {
  const embedded = path.join(__dirnameHost, 'runner');
  if (fs.existsSync(path.join(embedded, 'preload.cjs'))) return embedded;
  if (fs.existsSync(path.join(__dirnameHost, 'preload.cjs'))) return __dirnameHost;
  if (fs.existsSync(path.join(__dirnameHost, 'preload.js'))) return __dirnameHost;
  return path.join(runnerAppRoot(), 'dist');
}

function uiDistIndex(): string {
  return path.join(runnerAppRoot(), 'dist-ui', 'index.html');
}

/** Vite UI 开发服（@pkg-runner/web），可用 PKG_RUNNER_UI_URL 覆盖 */
const UI_DEV_URL = process.env.PKG_RUNNER_UI_URL?.trim() || 'http://127.0.0.1:5175';

function panelPreload(): string {
  const dir = runnerDistDir();
  const cjs = path.join(dir, 'preload.cjs');
  if (fs.existsSync(cjs)) return cjs;
  const js = path.join(dir, 'preload.js');
  if (fs.existsSync(js)) {
    diagLog('runner', 'preload.legacy-js', { file: js });
    return js;
  }
  diagLog('runner', 'preload.missing', {
    tried: [cjs, js],
    dirnameHost: __dirnameHost,
    appRoot: runnerAppRoot(),
  });
  console.error('[runner] missing preload at', cjs);
  return cjs;
}

async function loadMainWindow(win: BrowserWindow): Promise<void> {
  const preferDev =
    !!process.env.PKG_RUNNER_UI_URL?.trim() ||
    !!process.env.VITE_DEV_SERVER_URL?.trim() ||
    !app.isPackaged ||
    process.env.PKG_RUNNER_UI_DEV === '1';
  if (preferDev) {
    try {
      const res = await fetch(UI_DEV_URL, { method: 'HEAD' });
      if (res.ok || res.status === 404) {
        await win.loadURL(UI_DEV_URL);
        return;
      }
    } catch {
      /* fall through to dist-ui / archived vanilla */
    }
  }
  const distIndex = uiDistIndex();
  if (fs.existsSync(distIndex)) {
    diagLog('runner', 'ui.load', { file: distIndex });
    await win.loadFile(distIndex);
    return;
  }
  const vanilla = path.join(runnerAppRoot(), 'ui', 'index.vanilla.html');
  diagLog('runner', 'ui.load.fallback', { file: vanilla, missingDist: distIndex });
  await win.loadFile(vanilla);
}

let mainWindow: BrowserWindow | null = null;
let initialDir: string | null = null;
let isQuitting = false;
/** 本机 HTTP 控制面 stop 钩子 */
let stopControlServer: (() => void) | null = null;
let prefs: Prefs = {
  projects: [],
  activeProject: null,
};
/** UI settings from tray (in-memory only; tray reads disk). */
let shared: SharedSettings = defaultSharedSettings();
/** True after tray POST /v1/settings applied at least once. */
let traySettingsReceived = false;

/** Keep in sync with ui/tokens.css --neutral-850 / --neutral-50 (= --color-bg-base). */
const WINDOW_BG = {
  dark: '#1b1d21',
  light: '#f4f5f7',
} as const;

function windowBackgroundForTheme(theme: 'dark' | 'light'): string {
  return theme === 'light' ? WINDOW_BG.light : WINDOW_BG.dark;
}

type GlassLabKind = 'acrylic' | 'mica' | 'tabbed' | 'acrylic-clip' | 'css-only';

type GlassLabSpec = {
  title: string;
  material: 'none' | 'acrylic' | 'mica' | 'tabbed';
  transparent: boolean;
  osRound: boolean;
};

const GLASS_LAB_SPECS: Record<GlassLabKind, GlassLabSpec> = {
  acrylic: {
    title: 'Acrylic + OS 圆角',
    material: 'acrylic',
    transparent: true,
    osRound: true,
  },
  mica: {
    title: 'Mica + OS 圆角',
    material: 'mica',
    transparent: false,
    osRound: true,
  },
  tabbed: {
    title: 'Tabbed + OS 圆角',
    material: 'tabbed',
    transparent: false,
    osRound: true,
  },
  'acrylic-clip': {
    title: 'Acrylic + CSS clip',
    material: 'acrylic',
    transparent: true,
    osRound: false,
  },
  'css-only': {
    title: '纯 CSS（对照）',
    material: 'none',
    transparent: true,
    osRound: false,
  },
};

const glassLabWindows = new Map<string, BrowserWindow>();
let glassHubWindow: BrowserWindow | null = null;


type RunJob = {
  id: string;
  dir: string;
  scriptName: string;
  proc: ChildProcess;
};

const jobs = new Map<string, RunJob>();

/** 真终端：node-pty（可跑 Claude Code 等交互 CLI） */
type ShellSession = {
  id: string;
  /** 所属项目根（用于 Tab 过滤） */
  projectDir: string;
  cwd: string;
  title: string;
  pty: IPty | null;
};

const shells = new Map<string, ShellSession>();

function isShellId(id: string): boolean {
  return id.startsWith('shell::');
}

function jobKey(dir: string, scriptName: string): string {
  const d = process.platform === 'win32' ? path.resolve(dir).toLowerCase() : path.resolve(dir);
  return `${d}::${scriptName}`;
}

function jobsSnapshot(): Array<{ id: string; dir: string; scriptName: string }> {
  return [...jobs.values()].map(({ id, dir, scriptName }) => ({ id, dir, scriptName }));
}

function syncJobsUi() {
  const list = jobsSnapshot();
  send('pkg:jobs', list);
  const busy =
    list.length > 0 || [...shells.values()].some((s) => s.pty != null);
  send('pkg:running', busy);
}

function appendSystemLog(chunk: string) {
  send('pkg:log', { kind: 'system', chunk });
  appendSystemDiskLog(chunk);
}

function appendJobLog(id: string, scriptName: string, dir: string, chunk: string) {
  send('pkg:log', { kind: 'job', id, scriptName, dir, chunk });
  appendJobDiskLog(id, scriptName, dir, chunk);
}

function sendShellData(id: string, data: string) {
  send('pkg:shell-data', { id, data });
}

/** 强杀进程树；Windows 用同步 taskkill，避免退出时还没杀完就退了 */
function killProc(proc: ChildProcess) {
  const pid = proc.pid;
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 8000,
      });
      return;
    }
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
    try {
      if (!proc.killed) proc.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }
}

function stopJob(id: string, reason = '已停止') {
  const job = jobs.get(id);
  if (!job) return false;
  jobs.delete(id);
  killProc(job.proc);
  appendJobLog(id, job.scriptName, job.dir, `\n[${reason}]\n`);
  syncJobsUi();
  return true;
}

function stopAllJobs(reason = '已全部停止') {
  if (jobs.size === 0) return;
  const list = [...jobs.values()];
  jobs.clear();
  for (const job of list) {
    killProc(job.proc);
    appendJobLog(job.id, job.scriptName, job.dir, `\n[${reason}]\n`);
  }
  appendSystemLog(`\n[${reason} · ${list.length} 个任务]\n`);
  syncJobsUi();
}

function defaultPtyShell(): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    return { file: 'powershell.exe', args: ['-NoLogo'] };
  }
  const sh = process.env.SHELL || '/bin/bash';
  return { file: sh, args: [] };
}

function killShellPty(session: ShellSession) {
  const term = session.pty;
  if (!term) return;
  session.pty = null;
  const pid = term.pid;
  try {
    term.kill();
  } catch {
    /* ignore */
  }
  if (pid && process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 8000,
      });
    } catch {
      /* ignore */
    }
  }
}

function openShellSession(
  dir: string,
  size?: { cols?: number; rows?: number },
): {
  id: string;
  dir: string;
  cwd: string;
  title: string;
} {
  const projectDir = path.resolve(dir);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    throw new Error('目录无效');
  }
  const n =
    [...shells.values()].filter((s) => sameDir(s.projectDir, projectDir)).length + 1;
  const id = `shell::${randomUUID()}`;
  const title = n === 1 ? 'Shell' : `Shell ${n}`;
  const cols = Math.max(20, Math.min(500, Math.round(size?.cols ?? 80)));
  const rows = Math.max(5, Math.min(200, Math.round(size?.rows ?? 24)));
  const { file, args } = defaultPtyShell();
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') env[k] = v;
  }
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  if (process.platform === 'win32') {
    env.PYTHONIOENCODING = env.PYTHONIOENCODING || 'utf-8';
  }

  let term: IPty;
  try {
    term = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: projectDir,
      env,
    });
  } catch (err) {
    throw new Error(
      `无法启动终端: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const session: ShellSession = {
    id,
    projectDir,
    cwd: projectDir,
    title,
    pty: term,
  };
  shells.set(id, session);

  term.onData((data) => {
    sendShellData(id, data);
  });
  term.onExit(({ exitCode }) => {
    if (shells.get(id)?.pty === term) session.pty = null;
    sendShellData(id, `\r\n[终端已退出 ${exitCode ?? '?'}]\r\n`);
    send('pkg:exit', { id: session.id, scriptName: session.title, code: exitCode ?? null });
    syncJobsUi();
  });

  setTimeout(() => {
    if (!shells.has(id) || shells.get(id)?.pty !== term) return;
    sendShellData(
      id,
      `\r\n\x1b[90mPkg Runner · 交互终端 · cwd: ${projectDir}\x1b[0m\r\n\x1b[90m可运行 claude / 任意 CLI\x1b[0m\r\n`,
    );
  }, 400);

  syncJobsUi();
  return { id, dir: projectDir, cwd: session.cwd, title };
}

function writeShellSession(id: string, data: string): boolean {
  const session = shells.get(id);
  if (!session?.pty) return false;
  session.pty.write(String(data ?? ''));
  return true;
}

function resizeShellSession(id: string, cols: number, rows: number): boolean {
  const session = shells.get(id);
  if (!session?.pty) return false;
  const c = Math.max(20, Math.min(500, Math.round(cols)));
  const r = Math.max(5, Math.min(200, Math.round(rows)));
  try {
    session.pty.resize(c, r);
    return true;
  } catch {
    return false;
  }
}

function stopShellCommand(id: string): boolean {
  const session = shells.get(id);
  if (!session?.pty) return false;
  killShellPty(session);
  send('pkg:exit', { id: session.id, scriptName: session.title, code: null });
  syncJobsUi();
  return true;
}

function stopAllShellCommands() {
  for (const session of shells.values()) {
    if (!session.pty) continue;
    killShellPty(session);
    send('pkg:exit', { id: session.id, scriptName: session.title, code: null });
  }
  syncJobsUi();
}

function closeAllShellSessions() {
  for (const session of [...shells.values()]) {
    killShellPty(session);
    shells.delete(session.id);
  }
  syncJobsUi();
}

/** 退出前：脚本 job + Shell 当前命令 + Shell 会话全部收掉 */
function stopAllAssociatedProcesses(reason = '退出前停止') {
  stopAllJobs(reason);
  stopAllShellCommands();
  closeAllShellSessions();
}

function closeShellSession(id: string): boolean {
  const session = shells.get(id);
  if (!session) return false;
  killShellPty(session);
  shells.delete(id);
  syncJobsUi();
  return true;
}

function startJob(dir: string, scriptName: string): string {
  const key = jobKey(dir, scriptName);
  if (jobs.has(key)) {
    throw new Error(`脚本已在运行：${scriptName}`);
  }
  const project = loadProjectScripts(dir);
  const { cmd, args, shell } = pmRunArgs(project.packageManager, scriptName);
  const id = key;

  appendJobLog(id, scriptName, project.dir, `$ ${cmd} ${args.join(' ')}\n`);

  const proc = spawn(cmd, args, {
    cwd: project.dir,
    shell,
    env: { ...process.env, FORCE_COLOR: '1', npm_config_color: 'always' },
    windowsHide: true,
  });

  const job: RunJob = { id, dir: project.dir, scriptName, proc };
  jobs.set(id, job);
  syncJobsUi();

  proc.stdout?.on('data', (buf: Buffer) => {
    appendJobLog(id, scriptName, project.dir, buf.toString('utf8'));
  });
  proc.stderr?.on('data', (buf: Buffer) => {
    appendJobLog(id, scriptName, project.dir, buf.toString('utf8'));
  });
  proc.on('error', (err) => {
    const current = jobs.get(id);
    if (current?.proc === proc) {
      jobs.delete(id);
      appendJobLog(id, scriptName, project.dir, `\n[启动失败] ${err.message}\n`);
      closeJobDiskLog(id);
      syncJobsUi();
      send('pkg:exit', { id, scriptName, code: null });
      return;
    }
    if (current && current.proc !== proc) return;
    // 已被 stopJob 摘掉
    syncJobsUi();
    send('pkg:exit', { id, scriptName, code: null });
  });
  proc.on('close', (code) => {
    const current = jobs.get(id);
    if (current?.proc === proc) {
      jobs.delete(id);
      appendJobLog(id, scriptName, project.dir, `\n[退出码 ${code ?? '?'}]\n`);
      closeJobDiskLog(id);
      syncJobsUi();
      send('pkg:exit', { id, scriptName, code });
      return;
    }
    if (current && current.proc !== proc) return;
    // 已被 stopJob / CLI 摘掉，勿重开落盘
    syncJobsUi();
    send('pkg:exit', { id, scriptName, code });
  });

  return id;
}

function resolveRunScriptDir(dirHint?: string | null): string {
  if (dirHint && String(dirHint).trim()) {
    const resolved = path.resolve(String(dirHint).trim());
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error(`目录不存在：${resolved}`);
    }
    return resolved;
  }
  if (prefs.activeProject) return prefs.activeProject;
  if (prefs.projects.length === 1) return prefs.projects[0]!;
  throw new Error('未指定项目目录，且没有唯一激活项目（请传 dir 或在 UI 激活项目）');
}

/** 供 CLI / control 桥：start | restart | stop */
function runScriptFromControl(req: {
  action: 'start' | 'restart' | 'stop';
  script: string;
  dir?: string | null;
}): {
  ok: boolean;
  action: 'start' | 'restart' | 'stop';
  script: string;
  dir: string | null;
  jobId?: string;
  wasRunning?: boolean;
  error?: string;
} {
  const script = String(req.script || '').trim();
  if (!script) {
    return {
      ok: false,
      action: req.action,
      script: '',
      dir: null,
      error: '缺少 script',
    };
  }
  try {
    const dir = resolveRunScriptDir(req.dir);
    // 校验 script 存在于 package.json
    const project = loadProjectScripts(dir);
    if (!project.scripts.some((s) => s.name === script)) {
      return {
        ok: false,
        action: req.action,
        script,
        dir: project.dir,
        error: `package.json 中无脚本：${script}`,
      };
    }
    const key = jobKey(project.dir, script);
    const wasRunning = jobs.has(key);

    if (req.action === 'stop') {
      if (!wasRunning) {
        return {
          ok: true,
          action: 'stop',
          script,
          dir: project.dir,
          wasRunning: false,
        };
      }
      stopJob(key, 'CLI 停止');
      closeJobDiskLog(key);
      return {
        ok: true,
        action: 'stop',
        script,
        dir: project.dir,
        wasRunning: true,
      };
    }

    if (req.action === 'restart') {
      if (wasRunning) {
        stopJob(key, 'CLI 重启前停止');
        closeJobDiskLog(key);
      }
      const jobId = startJob(project.dir, script);
      // 确保项目在列表中并激活，便于 UI 对上
      try {
        addAndActivateProject(project.dir);
      } catch {
        /* ignore */
      }
      send('pkg:open-dir', project.dir);
      return {
        ok: true,
        action: 'restart',
        script,
        dir: project.dir,
        jobId,
        wasRunning,
      };
    }

    // start
    if (wasRunning) {
      return {
        ok: false,
        action: 'start',
        script,
        dir: project.dir,
        wasRunning: true,
        error: `脚本已在运行：${script}（可用 restart）`,
      };
    }
    const jobId = startJob(project.dir, script);
    try {
      addAndActivateProject(project.dir);
    } catch {
      /* ignore */
    }
    send('pkg:open-dir', project.dir);
    return {
      ok: true,
      action: 'start',
      script,
      dir: project.dir,
      jobId,
      wasRunning: false,
    };
  } catch (err) {
    return {
      ok: false,
      action: req.action,
      script,
      dir: req.dir ?? null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function send(channel: string, ...args: unknown[]) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    // 保证可 structuredClone，避免 preload→渲染进程 "An object could not be cloned"
    const safe = args.map((a) =>
      a === undefined ? null : JSON.parse(JSON.stringify(a)),
    );
    mainWindow.webContents.send(channel, ...safe);
  } catch (err) {
    diagLog('runner', 'ipc.send.fail', {
      channel,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/** UI mounts after did-finish-load; re-send so settings/projects are not missed. */
function broadcastUiSnapshot(): void {
  send('pkg:persist-logs', shared.persistLogs);
  send('pkg:settings', shared);
  send('pkg:maximized', mainWindow?.isMaximized() ?? false);
  send('pkg:projects', projectsState());
  send('pkg:jobs', jobsSnapshot());
  send('pkg:running', jobs.size > 0);
}

function scheduleUiSnapshotBroadcast(): void {
  broadcastUiSnapshot();
  for (const ms of [50, 200, 600, 1500]) {
    setTimeout(broadcastUiSnapshot, ms);
  }
}

function lookLikeDirArg(raw: string): boolean {
  if (!raw || raw.startsWith('-')) return false;
  const lower = raw.toLowerCase();
  if (lower.includes('electron')) return false;
  if (lower.endsWith('.exe')) return false;
  if (lower.endsWith('main.js') || lower.endsWith('main.js.map')) return false;
  if (lower.endsWith(`${path.sep}pkg-runner`) || lower.endsWith(`${path.sep}pkg-runner\\`)) {
    return false;
  }
  if (lower === '.' || lower.endsWith(`${path.sep}.`)) return false;
  return true;
}

function resolveDirFromArgv(argv: string[]): string | null {
  for (const raw of argv.slice(1)) {
    if (!lookLikeDirArg(raw)) continue;
    const p = path.resolve(raw.replace(/^"|"$/g, ''));
    if (p === runnerAppRoot()) continue;
    try {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function resolveInitialDir(): string | null {
  return resolveDirFromArgv(process.argv);
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function hideWindow() {
  mainWindow?.hide();
}

/** 显示 ↔ 隐藏（热键 / 托盘单击） */
export function toggleRunnerWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
    diagLog('runner', 'window.hide');
    hideWindow();
  } else {
    diagLog('runner', 'window.show');
    showWindow();
  }
}

export function applyRunnerSettings(raw: unknown): void {
  applySettingsFromTray(raw);
}

export function runnerToggleSignalPath(): string {
  return path.join(app.getPath('appData'), 'pkg-runner', 'runner-toggle.signal');
}

function consumeToggleSignal(): boolean {
  const file = runnerToggleSignalPath();
  try {
    if (!fs.existsSync(file)) return false;
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

function watchRunnerToggleSignal(): () => void {
  const file = runnerToggleSignalPath();
  const dir = path.dirname(file);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  const fire = () => {
    if (consumeToggleSignal()) toggleRunnerWindow();
  };
  fire();
  let watcher: fs.FSWatcher | null = null;
  try {
    watcher = fs.watch(dir, (_event, name) => {
      if (!name || name === 'runner-toggle.signal') fire();
    });
  } catch {
    /* ignore */
  }
  return () => watcher?.close();
}

function quitApp() {
  isQuitting = true;
  stopAllAssociatedProcesses('退出前停止');
  flushAllDiskLogs();
  closeAllDiskLogs();
  app.quit();
}

/** 永久置顶 */
function applyPinChrome() {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  const pin = shared.alwaysOnTop;
  if (pin) {
    // screen-saver：尽量压过其它置顶窗（含全屏游戏外的普通窗口）
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } else {
    win.setAlwaysOnTop(false);
    win.setVisibleOnAllWorkspaces(false);
  }
}

function applySharedToRuntime(next: SharedSettings): void {
  const themeChanged = next.theme !== shared.theme;
  const pinChanged = next.alwaysOnTop !== shared.alwaysOnTop;
  const logsChanged = next.persistLogs !== shared.persistLogs;
  shared = next;
  if (themeChanged && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(windowBackgroundForTheme(shared.theme));
  }
  if (pinChanged) applyPinChrome();
  if (logsChanged) {
    setPersistLogs(shared.persistLogs);
    if (shared.persistLogs) {
      appendSystemLog(`\n[落盘] 已开启（满 64KB 写入 · 单文件约 1MB 拆分 · 文件名精确到毫秒）\n[落盘] ${getLogsDir()}\n`);
    } else {
      appendSystemLog('\n[落盘] 已关闭\n');
    }
  }
  scheduleUiSnapshotBroadcast();
}

function applySettingsFromTray(raw: unknown): void {
  const next = coerceSharedSettings(raw);
  if (!next) {
    diagLog('runner', 'settings.apply.invalid', { raw });
    return;
  }
  traySettingsReceived = true;
  diagLog('runner', 'settings.apply.ok', {
    screenshotHotkey: next.screenshotHotkey,
    activateHotkey: next.activateHotkey,
  });
  applySharedToRuntime(next);
}

function waitForTraySettings(timeoutMs: number): Promise<void> {
  if (traySettingsReceived) return Promise.resolve();
  if (hostMode === 'embedded' && getSharedSettingsFn) {
    applySettingsFromTray(getSharedSettingsFn());
    diagLog('runner', 'settings.wait.done', { received: traySettingsReceived, via: 'embedded' });
    return Promise.resolve();
  }
  diagLog('runner', 'settings.wait.start', { timeoutMs });
  return pullSettingsFromTray(Math.min(900, timeoutMs)).then((raw) => {
    if (raw) applySettingsFromTray(raw);
    if (traySettingsReceived) {
      diagLog('runner', 'settings.wait.done', { received: true, via: 'pull' });
      return;
    }
    return new Promise<void>((resolve) => {
      const started = Date.now();
      const tick = () => {
        requestTrayPublishSettings();
        if (traySettingsReceived || Date.now() - started >= timeoutMs) {
          diagLog('runner', 'settings.wait.done', {
            received: traySettingsReceived,
            elapsedMs: Date.now() - started,
            via: traySettingsReceived ? 'push' : 'none',
          });
          if (!traySettingsReceived) {
            appendSystemLog(
              '\n[配置] 未从托盘同步（请先 pnpm dev:tray；Runner 未启动不影响托盘读写配置）\n',
            );
          }
          resolve();
          return;
        }
        setTimeout(tick, 180);
      };
      tick();
    });
  });
}

function projectEntry(dir: string): { dir: string; name: string; scriptCount: number } {
  try {
    const p = loadProjectScripts(dir);
    return { dir: p.dir, name: p.name, scriptCount: p.scripts.length };
  } catch {
    const resolved = path.resolve(dir);
    return { dir: resolved, name: path.basename(resolved), scriptCount: 0 };
  }
}

function projectsState() {
  return {
    projects: prefs.projects.map(projectEntry),
    activeProject: prefs.activeProject,
  };
}

function persistProjects() {
  savePrefs(prefs);
  send('pkg:projects', projectsState());
}

/** 加入项目列表并激活；已存在则仅激活 */
function addAndActivateProject(dir: string): { dir: string; name: string } {
  const loaded = loadProjectScripts(dir);
  const existing = prefs.projects.find((p) => sameDir(p, loaded.dir));
  if (!existing) {
    prefs.projects.push(loaded.dir);
  } else {
    // 规范化路径
    const idx = prefs.projects.findIndex((p) => sameDir(p, loaded.dir));
    if (idx >= 0) prefs.projects[idx] = loaded.dir;
  }
  prefs.activeProject = loaded.dir;
  persistProjects();
  return { dir: loaded.dir, name: loaded.name };
}

function setActiveProject(dir: string | null) {
  if (!dir) {
    prefs.activeProject = null;
    persistProjects();
    return;
  }
  const hit = prefs.projects.find((p) => sameDir(p, dir));
  if (!hit) throw new Error('项目不在列表中');
  prefs.activeProject = hit;
  persistProjects();
}

function removeProject(dir: string) {
  prefs.projects = prefs.projects.filter((p) => !sameDir(p, dir));
  if (prefs.activeProject && sameDir(prefs.activeProject, dir)) {
    prefs.activeProject = prefs.projects[0] ?? null;
  }
  persistProjects();
}

async function openLogsDir(): Promise<{ ok: boolean; dir: string; error: string | null }> {
  const dir = ensureLogsDir();
  const error = await shell.openPath(dir);
  if (error) {
    appendSystemLog(`\n[落盘] 打开目录失败：${error}\n`);
    return { ok: false, dir, error };
  }
  return { ok: true, dir, error: null };
}

function clearDiskLogsAction(): { ok: boolean; removed: number; dir: string } {
  const res = clearDiskLogs();
  if (res.ok) {
    appendSystemLog(`\n[落盘] 已清除记录（${res.removed} 个文件）\n[落盘] ${res.dir}\n`);
  } else {
    appendSystemLog(`\n[落盘] 清除记录失败：${res.dir}\n`);
  }
  return res;
}

function winFromEvent(e: { sender: Electron.WebContents }): BrowserWindow | null {
  return BrowserWindow.fromWebContents(e.sender);
}

/** @type {{ win: BrowserWindow, offsetX: number, offsetY: number } | null} */
let windowDragState: { win: BrowserWindow; offsetX: number; offsetY: number } | null =
  null;

function toggleWindowMaximized(win: BrowserWindow): boolean {
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  return win.isMaximized();
}

function beginWindowDrag(
  win: BrowserWindow,
  screenX: number,
  screenY: number,
): void {
  if (win.isDestroyed()) return;
  if (win.isMaximized()) {
    const bounds = win.getBounds();
    const normal = win.getNormalBounds();
    const ratio =
      bounds.width > 0
        ? Math.min(1, Math.max(0, (screenX - bounds.x) / bounds.width))
        : 0.5;
    win.unmaximize();
    const x = Math.round(screenX - normal.width * ratio);
    const y = Math.round(Math.max(screen.getDisplayNearestPoint({ x: screenX, y: screenY }).workArea.y, screenY - 12));
    win.setBounds({ x, y, width: normal.width, height: normal.height });
  }
  const [wx, wy] = win.getPosition();
  windowDragState = {
    win,
    offsetX: screenX - wx,
    offsetY: screenY - wy,
  };
}

function createGlassLabWindow(kind: GlassLabKind) {
  const spec = GLASS_LAB_SPECS[kind];
  if (!spec) return null;

  const existing = glassLabWindows.get(kind);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return existing;
  }

  const openCount = [...glassLabWindows.values()].filter((w) => !w.isDestroyed()).length;
  const parentBounds = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null;
  const offset = 28 * openCount;
  const x = (parentBounds?.x ?? 120) + 48 + offset;
  const y = (parentBounds?.y ?? 120) + 56 + offset;

  const useMaterial = process.platform === 'win32' && spec.material !== 'none';
  const win = new BrowserWindow({
    width: 400,
    height: 420,
    x,
    y,
    title: `Glass Lab · ${spec.title}`,
    show: false,
    frame: false,
    parent: mainWindow ?? undefined,
    modal: false,
    transparent: spec.transparent,
    backgroundColor: '#00000000',
    backgroundMaterial: useMaterial ? spec.material : undefined,
    roundedCorners: spec.osRound,
    thickFrame: spec.osRound,
    hasShadow: true,
    webPreferences: {
      preload: panelPreload(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  glassLabWindows.set(kind, win);

  const applyMaterial = () => {
    if (win.isDestroyed() || process.platform !== 'win32') return;
    try {
      win.setBackgroundColor('#00000000');
      if (spec.material === 'none') win.setBackgroundMaterial('none');
      else win.setBackgroundMaterial(spec.material);
    } catch {
      /* ignore */
    }
  };

  win.once('ready-to-show', () => {
    applyMaterial();
    win.show();
    win.focus();
    setTimeout(applyMaterial, 80);
  });

  win.on('closed', () => {
    if (glassLabWindows.get(kind) === win) glassLabWindows.delete(kind);
  });

  void win.loadFile(path.join(runnerAppRoot(), 'ui', 'glass-lab.html'), {
    query: { kind },
  });

  return win;
}

function openGlassHub() {
  if (glassHubWindow && !glassHubWindow.isDestroyed()) {
    glassHubWindow.show();
    glassHubWindow.focus();
    return glassHubWindow;
  }

  const parentBounds = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null;
  glassHubWindow = new BrowserWindow({
    width: 440,
    height: 420,
    x: (parentBounds?.x ?? 100) + 24,
    y: (parentBounds?.y ?? 100) + 36,
    title: '外观试验',
    show: false,
    frame: false,
    parent: mainWindow ?? undefined,
    backgroundColor: '#1b1d21',
    hasShadow: true,
    webPreferences: {
      preload: panelPreload(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  glassHubWindow.once('ready-to-show', () => {
    glassHubWindow?.show();
    glassHubWindow?.focus();
  });

  glassHubWindow.on('closed', () => {
    glassHubWindow = null;
  });

  void glassHubWindow.loadFile(path.join(runnerAppRoot(), 'ui', 'glass-hub.html'));
  return glassHubWindow;
}

function closeGlassLabs() {
  if (glassHubWindow && !glassHubWindow.isDestroyed()) glassHubWindow.destroy();
  glassHubWindow = null;
  for (const win of glassLabWindows.values()) {
    if (!win.isDestroyed()) win.destroy();
  }
  glassLabWindows.clear();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 520,
    minWidth: 900,
    minHeight: 520,
    title: 'Pkg Runner',
    show: false,
    frame: false,
    // Opaque frameless: solid fill matches tokens --color-bg-base.
    transparent: false,
    backgroundColor: windowBackgroundForTheme(shared.theme),
    hasShadow: true,
    roundedCorners: true,
    webPreferences: {
      preload: panelPreload(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.webContents.on('preload-error', (_e, preloadPath, error) => {
    console.error('[runner] preload-error', preloadPath, error);
    diagLog('runner', 'preload.error', {
      preloadPath,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    diagLog('runner', 'ui.fail-load', { code, desc, url });
  });

  mainWindow.once('ready-to-show', () => {
    applyPinChrome();
    mainWindow?.show();
  });

  void loadMainWindow(mainWindow);

  mainWindow.on('show', () => {
    applyPinChrome();
  });
  // Windows 偶发丢掉置顶位，聚焦时再钉一次
  mainWindow.on('focus', () => {
    if (shared.alwaysOnTop) applyPinChrome();
  });

  mainWindow.on('maximize', () => {
    send('pkg:maximized', true);
  });
  mainWindow.on('unmaximize', () => {
    send('pkg:maximized', false);
  });

  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    // 常驻：有托盘时关窗不退出
    e.preventDefault();
    hideWindow();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('did-finish-load', () => {
    scheduleUiSnapshotBroadcast();
  });
}

function registerIpc() {
  ipcMain.handle('pkg:get-initial-dir', () => initialDir);

  ipcMain.handle('pkg:get-projects', () => projectsState());

  ipcMain.handle('pkg:add-project', (_e, dir: string) => {
    return addAndActivateProject(dir);
  });

  ipcMain.handle('pkg:set-active-project', (_e, dir: string | null) => {
    setActiveProject(dir);
    return projectsState();
  });

  ipcMain.handle('pkg:remove-project', (_e, dir: string) => {
    removeProject(dir);
    return projectsState();
  });

  ipcMain.handle('pkg:window-minimize', (e) => {
    winFromEvent(e)?.minimize();
  });

  ipcMain.handle('pkg:window-maximize', (e) => {
    const win = winFromEvent(e);
    if (!win) return false;
    return toggleWindowMaximized(win);
  });

  ipcMain.on(
    'pkg:window-drag-start',
    (e, payload: { screenX?: number; screenY?: number }) => {
      const win = winFromEvent(e);
      if (!win) return;
      const screenX = Number(payload?.screenX);
      const screenY = Number(payload?.screenY);
      if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return;
      beginWindowDrag(win, screenX, screenY);
    },
  );

  ipcMain.on(
    'pkg:window-drag-move',
    (_e, payload: { screenX?: number; screenY?: number }) => {
      if (!windowDragState || windowDragState.win.isDestroyed()) {
        windowDragState = null;
        return;
      }
      if (windowDragState.win.isMaximized()) return;
      const screenX = Number(payload?.screenX);
      const screenY = Number(payload?.screenY);
      if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return;
      windowDragState.win.setPosition(
        Math.round(screenX - windowDragState.offsetX),
        Math.round(screenY - windowDragState.offsetY),
      );
    },
  );

  ipcMain.on('pkg:window-drag-end', () => {
    windowDragState = null;
  });

  ipcMain.handle('pkg:window-close', (e) => {
    const win = winFromEvent(e);
    if (!win) return;
    if (win === mainWindow) hideWindow();
    else win.close();
  });

  ipcMain.handle('pkg:window-is-maximized', (e) => winFromEvent(e)?.isMaximized() ?? false);

  ipcMain.handle('pkg:open-glass-labs', () => {
    openGlassHub();
  });

  ipcMain.handle('pkg:open-glass-lab', (_e, kind: string) => {
    if (kind in GLASS_LAB_SPECS) createGlassLabWindow(kind as GlassLabKind);
  });



  ipcMain.handle('pkg:get-settings', () => {
    if (!traySettingsReceived) {
      diagLog('runner', 'ipc.get-settings.pending');
      requestTrayPublishSettings();
    }
    return JSON.parse(JSON.stringify(shared));
  });

  ipcMain.handle('pkg:open-tray-settings', () => {
    requestTrayOpenSettings();
  });

  ipcMain.handle('pkg:request-tray-settings-patch', (_e, patch: unknown) => {
    if (!patch || typeof patch !== 'object') return;
    requestTrayPatchSettings(patch as Record<string, unknown>);
  });

  ipcMain.handle('pkg:hotkeys-suspend', () => {
    /* hotkeys owned by tray */
  });

  ipcMain.handle('pkg:hotkeys-resume', () => ({
    ok: true,
    activateError: null as string | null,
  }));

  ipcMain.handle('pkg:get-persist-logs', () => shared.persistLogs);

  ipcMain.handle('pkg:open-logs-dir', () => openLogsDir());


  ipcMain.handle('pkg:clear-disk-logs', () => clearDiskLogsAction());

  ipcMain.handle('pkg:pick-dir', async () => {
    const win = mainWindow;
    if (!win) return null;
    const res = await dialog.showOpenDialog(win, {
      title: '选择项目目录（含 package.json）',
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('pkg:load', (_e, dir: string) => {
    return loadProjectScripts(dir);
  });

  ipcMain.handle('pkg:get-jobs', () => jobsSnapshot());

  ipcMain.handle('pkg:stop', (_e, jobId?: string) => {
    if (jobId) {
      if (isShellId(jobId)) stopShellCommand(jobId);
      else stopJob(jobId);
    } else {
      stopAllJobs();
      stopAllShellCommands();
    }
  });

  ipcMain.handle('pkg:run', (_e, dir: string, scriptName: string) => {
    return startJob(dir, scriptName);
  });

  ipcMain.handle(
    'pkg:shell-open',
    (_e, dir: string, size?: { cols?: number; rows?: number }) =>
      openShellSession(dir, size),
  );
  ipcMain.handle('pkg:shell-write', (_e, id: string, data: string) =>
    writeShellSession(id, data),
  );
  ipcMain.handle(
    'pkg:shell-resize',
    (_e, id: string, cols: number, rows: number) => resizeShellSession(id, cols, rows),
  );
  ipcMain.handle('pkg:shell-close', (_e, id: string) => closeShellSession(id));
  ipcMain.handle('pkg:shell-cwd', (_e, id: string) => {
    const s = shells.get(id);
    return s ? { cwd: s.cwd, title: s.title, dir: s.projectDir } : null;
  });

}

let stopToggleSignalWatch: (() => void) | null = null;

export function registerRunnerSecondInstanceHandlers(): void {
  app.on('second-instance', (_e, argv) => {
    const flushOnly = argv.some(
      (a) => a === '--flush-logs' || a === '--flush-logs=true',
    );
    if (flushOnly) {
      const result = flushLogsNow({
        onFlushed: (r) => {
          appendSystemLog(
            `\n[落盘] CLI flush：pending ${r.pendingBytes}B · writers ${r.writers}${r.persistEnabled ? '' : ' · 开关关闭'}\n`,
          );
        },
      });
      void result;
      return;
    }

    const runFlag = argv.find((a) => a.startsWith('--run-script'));
    const restartFlag = argv.find((a) => a.startsWith('--restart-script'));
    const stopFlag = argv.find((a) => a.startsWith('--stop-script'));
    const scriptFlag = runFlag || restartFlag || stopFlag;
    if (scriptFlag) {
      const eq = scriptFlag.indexOf('=');
      const scriptFromEq = eq >= 0 ? scriptFlag.slice(eq + 1).trim() : '';
      const flagIdx = argv.indexOf(scriptFlag);
      const scriptFromNext =
        !scriptFromEq && argv[flagIdx + 1] && !argv[flagIdx + 1]!.startsWith('-')
          ? argv[flagIdx + 1]!.trim()
          : '';
      const scriptName = scriptFromEq || scriptFromNext;
      const dirFlag = argv.find((a) => a.startsWith('--dir='));
      const dir = dirFlag ? dirFlag.slice('--dir='.length) : resolveDirFromArgv(argv);
      const action = restartFlag ? 'restart' : stopFlag ? 'stop' : 'start';
      if (scriptName) {
        const r = runScriptFromControl({ action, script: scriptName, dir });
        appendSystemLog(
          r.ok
            ? `\n[CLI] ${r.action} ${r.script}${r.dir ? ` @ ${r.dir}` : ''}\n`
            : `\n[CLI] ${action} 失败：${r.error || '?'}\n`,
        );
      }
      return;
    }

    const dir = resolveDirFromArgv(argv);
    if (dir) {
      initialDir = dir;
      try {
        addAndActivateProject(dir);
        send('pkg:open-dir', path.resolve(dir));
      } catch (err) {
        appendSystemLog(`\n[项目] ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }
    if (argv.some((a) => a === '--toggle')) {
      toggleRunnerWindow();
      return;
    }
    if (!dir) {
      toggleRunnerWindow();
      return;
    }
    showWindow();
  });
}

export async function startRunnerHost(opts: RunnerHostOptions = {}): Promise<void> {
  hostMode = opts.mode ?? 'standalone';
  getSharedSettingsFn = opts.getSharedSettings ?? null;

  prefs = loadPrefs();
  setPersistLogs(shared.persistLogs);
  initialDir = resolveInitialDir();
  if (initialDir) {
    try {
      addAndActivateProject(initialDir);
    } catch {
      /* ignore */
    }
  }
  registerIpc();
  try {
    const srv = await startControlServer({
      onFlushed: (r) => {
        appendSystemLog(
          `\n[控制面] flush-logs：pending ${r.pendingBytes}B · writers ${r.writers}${r.persistEnabled ? '' : ' · 开关关闭'}\n`,
        );
      },
      runScript: (req) => runScriptFromControl(req),
      applySettings: (raw) => applySettingsFromTray(raw),
      onToggleWindow: () => toggleRunnerWindow(),
      onRunScript: (r) => {
        if (r.ok) {
          appendSystemLog(
            `\n[控制面] ${r.action} ${r.script}${r.dir ? ` @ ${r.dir}` : ''}${r.wasRunning ? '（原在跑）' : ''}\n`,
          );
        } else {
          appendSystemLog(`\n[控制面] ${r.action} 失败：${r.error || '?'}\n`);
        }
      },
    });
    stopControlServer = () => {
      srv.stop();
      stopControlServer = null;
    };
    appendSystemLog(
      `\n[控制面] ${srv.info.baseUrl}（token 见 %APPDATA%/pkg-runner/control/http.json）\n`,
    );
    diagLog('runner', 'control.ready', { baseUrl: srv.info.baseUrl, log: diagLogPath() });
    await waitForTraySettings(hostMode === 'embedded' ? 0 : 2400);
  } catch (err) {
    appendSystemLog(
      `\n[控制面] 启动失败：${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
  if (hostMode === 'standalone') {
    stopToggleSignalWatch = watchRunnerToggleSignal();
    createWindow();
  }
  // embedded：不预开窗口，托盘起来后再按需 create（启动快很多）
}

/** 空闲时预热 Runner 窗（隐藏），首次 Alt+Q 不必再等 load */
export function warmRunnerWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) return;
  createWindow();
  // createWindow 会在 ready-to-show 时 show；立刻 hide，保持常驻热态
  const win = mainWindow;
  if (win && !win.isDestroyed()) {
    win.once('ready-to-show', () => {
      if (!isQuitting) hideWindow();
    });
  }
}

export function shutdownRunnerHost(): void {
  isQuitting = true;
  stopToggleSignalWatch?.();
  stopToggleSignalWatch = null;
  try {
    stopControlServer?.();
  } catch {
    /* ignore */
  }
  closeGlassLabs();
  stopAllAssociatedProcesses('退出前停止');
  flushAllDiskLogs();
  closeAllDiskLogs();
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.destroy();
    } catch {
      /* ignore */
    }
  }
  mainWindow = null;
}

export function registerRunnerStandaloneLifecycle(): void {
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    isQuitting = true;
    shutdownRunnerHost();
  });
}