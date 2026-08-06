import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  screen,
  shell,
} from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pty, { type IPty } from 'node-pty';
import { loadProjectScripts, pmRunArgs } from './pkg.js';
import { loadPrefs, sameDir, type Prefs } from './prefs.js';
import {
  migrateLegacyRunnerProjects,
  onWorkspacePrefsChange,
  openWorkspaceDir,
  pickWorkspaceDir,
  readWorkspacePrefs,
  selectWorkspaceRepo,
  workspaceProjectsState,
  activeScriptDir,
} from '../../shared/workspaceSync.js';
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
import {
  SYSTEM_ID as UI_SYSTEM_ID,
  appendUiSessionText,
  clearUiSessionText,
  ensureUiSession,
  ensureUiSystemSession,
  listUiSessions,
  removeUiSession,
  resetUiStateStore,
} from './uiStateStore.js';
import { flushLogsNow, startControlServer } from './controlServer.js';
import { diagLog, diagLogPath, readDiagTail } from './diagLog.js';
import { chromeBackground } from '@pkg-runner/tokens';
import { pkgRunnerColorEnv, type PkgRunnerColorEnv } from './appProfile.js';
import { resolveEnvAssetPath } from '@pkg-runner/assets';
import {
  killByPid,
  killByPort,
  killPidTree,
  killPidTreeSync,
  listClassifiedPorts,
  reapUnmanagedPorts,
  type PortsActionResult,
} from './portManager.js';
import {
  lastSpawnInWinJobError,
  spawnInWinJob,
  tryOwnProcess,
  type ProcessJob,
} from './winProcessJob.js';

export type RunnerHostMode = 'standalone' | 'embedded';

export type RunnerHostOptions = {
  mode?: RunnerHostMode;
  /** Embedded: tray supplies settings synchronously (no tray-cmd / HTTP pull). */
  getSharedSettings?: () => SharedSettings;
  /** Tray session restore: fired when the runner window is shown or hidden. */
  onVisibilityChange?: (visible: boolean) => void;
};

let hostMode: RunnerHostMode = 'standalone';
let getSharedSettingsFn: (() => SharedSettings) | null = null;
let onVisibilityChangeFn: ((visible: boolean) => void) | null = null;
let lastEmittedVisible: boolean | null = null;

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
const UI_DEV_URL = process.env.PKG_RUNNER_UI_URL?.trim() || 'http://127.0.0.1:5200';

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
  const t0 = Date.now();
  const uiUrl =
    process.env.PKG_RUNNER_UI_URL?.trim() ||
    process.env.VITE_DEV_SERVER_URL?.trim() ||
    '';
  const forceVite =
    process.env.PKG_RUNNER_UI_DEV === '1' ||
    process.env.PKG_RUNNER_UI_DEV === 'true';

  const tryVite = async (url: string, attempts: number, timeoutMs: number): Promise<boolean> => {
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(url, {
          method: 'HEAD',
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.ok || res.status === 404) {
          await win.loadURL(url);
          diagLog('runner', 'ui.load', {
            via: 'vite',
            url,
            attempt: i + 1,
            ms: Date.now() - t0,
          });
          return true;
        }
      } catch {
        if (i + 1 < attempts) await new Promise((r) => setTimeout(r, 200));
      }
    }
    return false;
  };

  // 显式 Vite：多试几次，避免 400ms 一次失败就静默落到陈旧 dist-ui
  if (uiUrl || forceVite) {
    const url = uiUrl || UI_DEV_URL;
    const ok = await tryVite(url, forceVite ? 8 : 2, forceVite ? 800 : 400);
    if (ok) return;
    diagLog('runner', 'ui.vite-miss', { url, forceVite });
    if (forceVite) {
      console.warn(
        `[runner] Vite UI 未就绪 (${url})，仍尝试加载；请确认 pnpm dev 已起 @pkg-runner/web`,
      );
    }
  }

  const distIndex = uiDistIndex();
  if (fs.existsSync(distIndex)) {
    await win.loadFile(distIndex);
    diagLog('runner', 'ui.load', {
      via: 'dist-ui',
      file: distIndex,
      ms: Date.now() - t0,
    });
    return;
  }
  // dist 没有时再试本地 Vite（仅 unpackaged；短超时）
  if (!uiUrl && !forceVite && !app.isPackaged) {
    try {
      const res = await fetch(UI_DEV_URL, {
        method: 'HEAD',
        signal: AbortSignal.timeout(300),
      });
      if (res.ok || res.status === 404) {
        await win.loadURL(UI_DEV_URL);
        diagLog('runner', 'ui.load', {
          via: 'vite-fallback',
          url: UI_DEV_URL,
          ms: Date.now() - t0,
        });
        return;
      }
    } catch {
      /* fall through */
    }
  }
  const stub = path.join(runnerAppRoot(), 'ui', 'index.html');
  diagLog('runner', 'ui.load.missing', {
    missingDist: distIndex,
    ms: Date.now() - t0,
  });
  if (fs.existsSync(stub)) {
    await win.loadFile(stub);
    return;
  }
  throw new Error(
    `Runner UI missing: build @pkg-runner/web → dist-ui (looked for ${distIndex})`,
  );
}

let mainWindow: BrowserWindow | null = null;
let initialDir: string | null = null;
let isQuitting = false;
/** 本机 HTTP 控制面 stop 钩子 */
let stopControlServer: (() => void) | null = null;
/** 控制面实际监听端口（分类 self 用） */
let controlListenPort: number | null = null;
let prefs: Prefs = {
  projects: [],
  activeProject: null,
};
/** UI settings from tray (in-memory only; tray reads disk). */
let shared: SharedSettings = defaultSharedSettings();
/** True after tray POST /v1/settings applied at least once. */
let traySettingsReceived = false;

function windowBackgroundForTheme(theme: 'dark' | 'light'): string {
  return chromeBackground(pkgRunnerColorEnv(), theme);
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
  /** Win Job Object：启动时圈养整树；停时 Terminate，无需 wmic 侦察 */
  processJob: ProcessJob | null;
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
  const stopping = [...stoppingJobs];
  for (const j of list) {
    ensureUiSession(j.id, {
      kind: 'job',
      title: j.scriptName,
      scriptName: j.scriptName,
      dir: j.dir,
      running: true,
      stopping: false,
    });
  }
  for (const id of stopping) {
    ensureUiSession(id, { stopping: true, running: true });
  }
  if (!isRunnerUiLive()) return;
  send('pkg:jobs', list);
  send('pkg:stopping', stopping);
  const busy =
    list.length > 0 ||
    stopping.length > 0 ||
    [...shells.values()].some((s) => s.pty != null);
  send('pkg:running', busy);
}

/** UI IPC 合并：吵脚本（Sequelize debug 等）否则每 chunk 打满渲染进程 */
const LOG_IPC_FLUSH_MS = 64;
const SHELL_IPC_FLUSH_MS = 32;

type PendingUiLog =
  | { kind: 'system'; chunk: string }
  | { kind: 'job'; id: string; scriptName: string; dir: string; chunk: string };

const pendingUiLogs = new Map<string, PendingUiLog>();
let logIpcFlushTimer: ReturnType<typeof setTimeout> | null = null;

const pendingShellData = new Map<string, string>();
let shellIpcFlushTimer: ReturnType<typeof setTimeout> | null = null;

/** 窗可见时才向渲染进程推增量；隐藏时只写主进程 store */
function isRunnerUiLive(): boolean {
  return isRunnerVisuallyOpen();
}

function dropPendingUiIpcWithoutSend(): void {
  if (logIpcFlushTimer) {
    clearTimeout(logIpcFlushTimer);
    logIpcFlushTimer = null;
  }
  if (shellIpcFlushTimer) {
    clearTimeout(shellIpcFlushTimer);
    shellIpcFlushTimer = null;
  }
  pendingUiLogs.clear();
  pendingShellData.clear();
}

export type UiStateSnapshot = {
  sessions: ReturnType<typeof listUiSessions>;
  jobs: Array<{ id: string; dir: string; scriptName: string }>;
  stopping: string[];
};

function buildUiStateSnapshot(): UiStateSnapshot {
  ensureUiSystemSession();
  return {
    sessions: listUiSessions(),
    jobs: jobsSnapshot(),
    stopping: [...stoppingJobs],
  };
}

function pushUiStateSnapshot(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  dropPendingUiIpcWithoutSend();
  send('pkg:ui-state', buildUiStateSnapshot());
}

function flushPendingUiLogs(onlyKey?: string): void {
  if (!isRunnerUiLive()) {
    dropPendingUiIpcWithoutSend();
    return;
  }
  if (onlyKey) {
    const p = pendingUiLogs.get(onlyKey);
    if (!p) return;
    pendingUiLogs.delete(onlyKey);
    if (p.kind === 'system') sendPlain('pkg:log', { kind: 'system', chunk: p.chunk });
    else sendPlain('pkg:log', { kind: 'job', id: p.id, scriptName: p.scriptName, dir: p.dir, chunk: p.chunk });
    if (pendingUiLogs.size === 0 && logIpcFlushTimer) {
      clearTimeout(logIpcFlushTimer);
      logIpcFlushTimer = null;
    }
    return;
  }
  if (logIpcFlushTimer) {
    clearTimeout(logIpcFlushTimer);
    logIpcFlushTimer = null;
  }
  if (pendingUiLogs.size === 0) return;
  const batch = [...pendingUiLogs.values()];
  pendingUiLogs.clear();
  for (const p of batch) {
    if (p.kind === 'system') sendPlain('pkg:log', { kind: 'system', chunk: p.chunk });
    else sendPlain('pkg:log', { kind: 'job', id: p.id, scriptName: p.scriptName, dir: p.dir, chunk: p.chunk });
  }
}

function scheduleUiLogFlush(): void {
  if (!isRunnerUiLive()) return;
  if (logIpcFlushTimer) return;
  logIpcFlushTimer = setTimeout(() => {
    logIpcFlushTimer = null;
    flushPendingUiLogs();
  }, LOG_IPC_FLUSH_MS);
}

function appendSystemLog(chunk: string) {
  appendSystemDiskLog(chunk);
  appendUiSessionText(UI_SYSTEM_ID, chunk, { kind: 'system', title: '系统' });
  if (!isRunnerUiLive()) return;
  const key = 'system';
  const prev = pendingUiLogs.get(key);
  if (prev?.kind === 'system') prev.chunk += chunk;
  else pendingUiLogs.set(key, { kind: 'system', chunk });
  scheduleUiLogFlush();
}

function appendJobLog(id: string, scriptName: string, dir: string, chunk: string) {
  appendJobDiskLog(id, scriptName, dir, chunk);
  appendUiSessionText(id, chunk, {
    kind: 'job',
    title: scriptName,
    scriptName,
    dir,
    running: true,
  });
  if (!isRunnerUiLive()) return;
  const prev = pendingUiLogs.get(id);
  if (prev?.kind === 'job') {
    prev.chunk += chunk;
    prev.scriptName = scriptName;
    prev.dir = dir;
  } else {
    pendingUiLogs.set(id, { kind: 'job', id, scriptName, dir, chunk });
  }
  scheduleUiLogFlush();
}

function flushPendingShellData(onlyId?: string): void {
  if (!isRunnerUiLive()) {
    if (onlyId) pendingShellData.delete(onlyId);
    else dropPendingUiIpcWithoutSend();
    return;
  }
  if (onlyId) {
    const data = pendingShellData.get(onlyId);
    if (data == null) return;
    pendingShellData.delete(onlyId);
    sendPlain('pkg:shell-data', { id: onlyId, data });
    if (pendingShellData.size === 0 && shellIpcFlushTimer) {
      clearTimeout(shellIpcFlushTimer);
      shellIpcFlushTimer = null;
    }
    return;
  }
  if (shellIpcFlushTimer) {
    clearTimeout(shellIpcFlushTimer);
    shellIpcFlushTimer = null;
  }
  if (pendingShellData.size === 0) return;
  const batch = [...pendingShellData.entries()];
  pendingShellData.clear();
  for (const [id, data] of batch) {
    sendPlain('pkg:shell-data', { id, data });
  }
}

function scheduleShellDataFlush(): void {
  if (!isRunnerUiLive()) return;
  if (shellIpcFlushTimer) return;
  shellIpcFlushTimer = setTimeout(() => {
    shellIpcFlushTimer = null;
    flushPendingShellData();
  }, SHELL_IPC_FLUSH_MS);
}

function sendShellData(id: string, data: string) {
  appendUiSessionText(id, data, { kind: 'shell', running: true });
  if (!isRunnerUiLive()) return;
  const prev = pendingShellData.get(id);
  pendingShellData.set(id, prev ? prev + data : data);
  scheduleShellDataFlush();
}

/** 正在异步杀掉的 job（已从 jobs 摘掉，禁止立刻同 key 再 start） */
const stoppingJobs = new Set<string>();
const pendingKills = new Map<string, Promise<void>>();

/**
 * 停脚本：优先 Job Object（O(1)）；否则单次 taskkill /T。
 * 不再做 wmic BFS / 全机 node 扫。
 */
function killProc(
  proc: ChildProcess,
  opts?: {
    sync?: boolean;
    trackKey?: string;
    processJob?: ProcessJob | null;
  },
): Promise<void> {
  const pid = proc.pid;
  if (!pid) {
    diagLog('runner', 'kill.skip', { reason: 'no-pid' });
    return Promise.resolve();
  }

  const finishProc = () => {
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  };

  const runJobObject = (): boolean => {
    const job = opts?.processJob;
    if (!job?.assigned) return false;
    const t0 = Date.now();
    const ok = job.terminate();
    // 关句柄：Terminate 失败时靠 KILL_ON_JOB_CLOSE 仍清树
    job.close();
    diagLog('runner', 'kill.job', {
      via: 'job-object',
      rootPid: pid,
      ok,
      ms: Date.now() - t0,
    });
    finishProc();
    return true;
  };

  if (opts?.sync) {
    if (!runJobObject()) {
      const result = killPidTreeSync(pid);
      diagLog('runner', 'kill.tree.sync', result);
      finishProc();
    }
    return Promise.resolve();
  }

  const run = (async () => {
    try {
      if (runJobObject()) return;
      const result = await killPidTree(pid);
      diagLog('runner', 'kill.tree', result);
      finishProc();
    } catch (err) {
      diagLog('runner', 'kill.fail', {
        pid,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  })();

  const key = opts?.trackKey;
  if (key) {
    stoppingJobs.add(key);
    pendingKills.set(key, run);
    syncJobsUi();
    void run.finally(() => {
      stoppingJobs.delete(key);
      if (pendingKills.get(key) === run) pendingKills.delete(key);
      syncJobsUi();
    });
  }
  return run;
}

function managedPortRoots(): {
  jobs: Array<{ id: string; pid: number }>;
  shells: Array<{ id: string; pid: number }>;
} {
  return {
    jobs: [...jobs.values()]
      .map((j) => ({ id: j.id, pid: j.proc.pid ?? 0 }))
      .filter((j) => j.pid > 0),
    shells: [...shells.values()]
      .map((s) => ({ id: s.id, pid: s.pty?.pid ?? 0 }))
      .filter((s) => s.pid > 0),
  };
}

function classifyCtx() {
  const roots = managedPortRoots();
  return {
    jobs: roots.jobs,
    shells: roots.shells,
    controlPort: controlListenPort,
    selfPids: [process.pid],
  };
}

async function listPortsFromControl(): Promise<PortsActionResult> {
  return listClassifiedPorts(classifyCtx());
}

async function killPortFromControl(req: {
  port?: number | null;
  pid?: number | null;
}): Promise<PortsActionResult> {
  const at = new Date().toISOString();
  const port = req.port != null ? Number(req.port) : NaN;
  const pid = req.pid != null ? Number(req.pid) : NaN;
  if (Number.isFinite(port) && port > 0) {
    const killed = [await killByPort(port)];
    return {
      ok: killed.every((k) => k.ok),
      action: 'kill',
      killed,
      error: killed.find((k) => !k.ok)?.error,
      at,
    };
  }
  if (Number.isFinite(pid) && pid > 0) {
    const killed = [await killByPid(pid)];
    return {
      ok: killed.every((k) => k.ok),
      action: 'kill',
      killed,
      error: killed.find((k) => !k.ok)?.error,
      at,
    };
  }
  return {
    ok: false,
    action: 'kill',
    killed: [],
    error: 'kill 需要 port 或 pid',
    at,
  };
}

async function reapPortsFromControl(opts?: {
  nodeOnly?: boolean;
}): Promise<PortsActionResult> {
  return reapUnmanagedPorts(classifyCtx(), opts);
}

function stopJob(id: string, reason = '已停止', opts?: { syncKill?: boolean }) {
  const job = jobs.get(id);
  if (!job) return false;
  jobs.delete(id);
  // 先标记 stopping 再推 UI，避免「已从 jobs 消失但还在杀」中间态无  if (!opts?.syncKill) stoppingJobs.add(id);
  appendJobLog(id, job.scriptName, job.dir, `\n[${reason}]\n`);
  syncJobsUi();
  void killProc(job.proc, {
    sync: opts?.syncKill,
    trackKey: opts?.syncKill ? undefined : id,
    processJob: job.processJob,
  });
  return true;
}

async function stopJobAwait(id: string, reason = '已停止'): Promise<boolean> {
  const job = jobs.get(id);
  if (!job) {
    const pending = pendingKills.get(id);
    if (pending) await pending;
    return !!pending;
  }
  jobs.delete(id);
  stoppingJobs.add(id);
  appendJobLog(id, job.scriptName, job.dir, `\n[${reason}]\n`);
  syncJobsUi();
  await killProc(job.proc, { trackKey: id, processJob: job.processJob });
  return true;
}

function stopAllJobs(reason = '已全部停止', opts?: { syncKill?: boolean }) {
  if (jobs.size === 0) return;
  const list = [...jobs.values()];
  jobs.clear();
  for (const job of list) {
    if (!opts?.syncKill) stoppingJobs.add(job.id);
    appendJobLog(job.id, job.scriptName, job.dir, `\n[${reason}]\n`);
    void killProc(job.proc, {
      sync: opts?.syncKill,
      trackKey: opts?.syncKill ? undefined : job.id,
      processJob: job.processJob,
    });
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

function killShellPty(session: ShellSession, opts?: { sync?: boolean }) {
  const term = session.pty;
  if (!term) return;
  session.pty = null;
  const shellPid = term.pid;
  // shell/pty：暂无 /T（未挂 Job）；脚本任务走 Job Object
  if (shellPid) {
    if (opts?.sync) {
      diagLog('runner', 'kill.shell-tree.sync', killPidTreeSync(shellPid));
    } else {
      void killPidTree(shellPid).then((r) => {
        diagLog('runner', 'kill.shell-tree', r);
      });
    }
  }
  try {
    term.kill();
  } catch {
    /* ignore */
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
  ensureUiSession(id, {
    kind: 'shell',
    title,
    dir: projectDir,
    cwd: projectDir,
    running: true,
  });

  term.onData((data) => {
    sendShellData(id, data);
  });
  term.onExit(({ exitCode }) => {
    if (shells.get(id)?.pty === term) session.pty = null;
    ensureUiSession(id, { running: false, code: exitCode ?? null });
    sendShellData(id, `\r\n[终端已退出 ${exitCode ?? '?'}]\r\n`);
    flushPendingShellData(id);
    if (isRunnerUiLive()) {
      send('pkg:exit', { id: session.id, scriptName: session.title, code: exitCode ?? null });
    }
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
  ensureUiSession(id, { running: false, code: null });
  flushPendingShellData(id);
  if (isRunnerUiLive()) {
    send('pkg:exit', { id: session.id, scriptName: session.title, code: null });
  }
  syncJobsUi();
  return true;
}

function stopAllShellCommands() {
  for (const session of shells.values()) {
    if (!session.pty) continue;
    killShellPty(session);
    ensureUiSession(session.id, { running: false, code: null });
    flushPendingShellData(session.id);
    if (isRunnerUiLive()) {
      send('pkg:exit', { id: session.id, scriptName: session.title, code: null });
    }
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

/** 退出前：脚本 job + Shell 全部同步杀干净 */
function stopAllAssociatedProcesses(reason = '退出前停止') {
  stopAllJobs(reason, { syncKill: true });
  for (const session of [...shells.values()]) {
    killShellPty(session, { sync: true });
    shells.delete(session.id);
  }
  syncJobsUi();
}

function closeShellSession(id: string): boolean {
  const session = shells.get(id);
  if (!session) return false;
  killShellPty(session);
  shells.delete(id);
  removeUiSession(id);
  syncJobsUi();
  return true;
}

function startJob(dir: string, scriptName: string): string {
  const key = jobKey(dir, scriptName);
  if (jobs.has(key) || stoppingJobs.has(key)) {
    throw new Error(
      stoppingJobs.has(key)
        ? `脚本正在停止：${scriptName}（稍后再 start / 用 restart）`
        : `脚本已在运行：${scriptName}`,
    );
  }
  const project = loadProjectScripts(dir);
  const { cmd, args, shell } = pmRunArgs(project.packageManager, scriptName);
  const id = key;

  appendJobLog(id, scriptName, project.dir, `$ ${cmd} ${args.join(' ')}\n`);

  const env = { ...process.env, FORCE_COLOR: '1', npm_config_color: 'always' };
  const tOwn = Date.now();

  // Win：BREAKAWAY CreateProcess 入 Job（绕开 Electron 自带 Job）；失败再 spawn+Assign
  let proc: ChildProcess;
  let processJob: ProcessJob | null = null;
  let ownVia: string = 'fallback-taskkill-T';
  let ownErr: number | undefined;
  let ownStage: string | undefined;

  const broken = spawnInWinJob({
    cmd,
    args,
    cwd: project.dir,
    env,
    shell,
  });
  if (broken) {
    proc = broken.proc;
    processJob = broken.processJob;
    ownVia = 'job-object-breakaway';
  } else {
    const spawnFail = lastSpawnInWinJobError();
    if (spawnFail) {
      ownErr = spawnFail.err;
      ownStage = `breakaway:${spawnFail.stage}`;
    }
    proc = spawn(cmd, args, {
      cwd: project.dir,
      shell,
      env,
      windowsHide: true,
    });
    if (proc.pid != null) {
      const owned = tryOwnProcess(proc.pid);
      processJob = owned.job;
      if (!processJob) {
        ownErr = owned.err ?? ownErr;
        ownStage = owned.stage
          ? `assign:${owned.stage}`
          : ownStage;
      } else {
        ownVia = 'job-object-assign';
        ownErr = undefined;
        ownStage = undefined;
      }
    }
  }

  diagLog('runner', 'job.own', {
    id,
    rootPid: proc.pid ?? null,
    via: ownVia,
    err: ownErr,
    stage: ownStage,
    ms: Date.now() - tOwn,
  });

  const job: RunJob = { id, dir: project.dir, scriptName, proc, processJob };
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
      current.processJob?.close();
      appendJobLog(id, scriptName, project.dir, `\n[启动失败] ${err.message}\n`);
      ensureUiSession(id, { running: false, stopping: false, code: null });
      flushPendingUiLogs(id);
      closeJobDiskLog(id);
      syncJobsUi();
      if (isRunnerUiLive()) send('pkg:exit', { id, scriptName, code: null });
      return;
    }
    processJob?.close();
    if (current && current.proc !== proc) return;
    flushPendingUiLogs(id);
    syncJobsUi();
    if (isRunnerUiLive()) send('pkg:exit', { id, scriptName, code: null });
  });
  proc.on('close', (code) => {
    const current = jobs.get(id);
    if (current?.proc === proc) {
      jobs.delete(id);
      current.processJob?.close();
      appendJobLog(id, scriptName, project.dir, `\n[退出码 ${code ?? '?'}]\n`);
      ensureUiSession(id, { running: false, stopping: false, code: code ?? null });
      flushPendingUiLogs(id);
      closeJobDiskLog(id);
      syncJobsUi();
      if (isRunnerUiLive()) send('pkg:exit', { id, scriptName, code });
      return;
    }
    // stop 路径已 terminate+close；若仍持有未关句柄则补关
    if (!current) processJob?.close();
    if (current && current.proc !== proc) return;
    ensureUiSession(id, { running: false, stopping: false, code: code ?? null });
    flushPendingUiLogs(id);
    syncJobsUi();
    if (isRunnerUiLive()) send('pkg:exit', { id, scriptName, code });
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
  const active = activeScriptDir(readWorkspacePrefs());
  if (active) return active;
  throw new Error('未指定项目目录，且没有激活仓库（请先选择工作区/仓库）');
}

/** 控制面 / CLI → 客户端：激活项目并可选亮窗 */
function linkClientToProject(dir: string, opts?: { showWindow?: boolean }): void {
  try {
    addAndActivateProject(dir);
  } catch {
    /* ignore */
  }
  send('pkg:open-dir', dir);
  persistProjectsBroadcast();
  if (opts?.showWindow) showWindow();
}

function focusSession(id: string, dir: string | null, opts?: { showWindow?: boolean }): void {
  send('pkg:focus-session', { id, dir });
  if (opts?.showWindow) showWindow();
}

function notifyShellSession(info: {
  id: string;
  dir: string;
  cwd: string;
  title: string;
}): void {
  send('pkg:shell-session', info);
}

/** 该项目最近一个仍存活的交互 Shell */
function findShellForProject(dir: string): ShellSession | null {
  const resolved = path.resolve(dir);
  let hit: ShellSession | null = null;
  for (const s of shells.values()) {
    if (!s.pty) continue;
    if (sameDir(s.projectDir, resolved)) hit = s;
  }
  return hit;
}

function listShellSessions(dirHint?: string | null): Array<{
  id: string;
  dir: string;
  cwd: string;
  title: string;
  alive: boolean;
}> {
  const filter = dirHint && String(dirHint).trim() ? path.resolve(String(dirHint).trim()) : null;
  const out: Array<{
    id: string;
    dir: string;
    cwd: string;
    title: string;
    alive: boolean;
  }> = [];
  for (const s of shells.values()) {
    if (filter && !sameDir(s.projectDir, filter)) continue;
    out.push({
      id: s.id,
      dir: s.projectDir,
      cwd: s.cwd,
      title: s.title,
      alive: !!s.pty,
    });
  }
  return out;
}

type ShellControlAction = 'open' | 'exec' | 'close' | 'list';

type ShellControlResult = {
  ok: boolean;
  action: ShellControlAction;
  dir: string | null;
  id?: string;
  cwd?: string;
  title?: string;
  shells?: Array<{
    id: string;
    dir: string;
    cwd: string;
    title: string;
    alive: boolean;
  }>;
  closed?: string[];
  error?: string;
};

/** 供控制面：自由命令进项目 Shell */
function shellFromControl(req: {
  action: ShellControlAction;
  dir?: string | null;
  command?: string | null;
  id?: string | null;
}): ShellControlResult {
  const action = req.action;
  try {
    if (action === 'list') {
      const dir = req.dir?.trim() ? path.resolve(req.dir.trim()) : null;
      return {
        ok: true,
        action: 'list',
        dir,
        shells: listShellSessions(dir),
      };
    }

    if (action === 'close') {
      const id = req.id?.trim() || '';
      if (id) {
        const ok = closeShellSession(id);
        if (ok) send('pkg:exit', { id, scriptName: 'Shell', code: null });
        return {
          ok,
          action: 'close',
          dir: null,
          id,
          closed: ok ? [id] : [],
          error: ok ? undefined : `Shell 不存在：${id}`,
        };
      }
      const dir = resolveRunScriptDir(req.dir);
      const closed: string[] = [];
      for (const s of [...shells.values()]) {
        if (!sameDir(s.projectDir, dir)) continue;
        if (closeShellSession(s.id)) {
          closed.push(s.id);
          send('pkg:exit', { id: s.id, scriptName: s.title, code: null });
        }
      }
      linkClientToProject(dir, { showWindow: false });
      return { ok: true, action: 'close', dir, closed };
    }

    if (action === 'open') {
      const dir = resolveRunScriptDir(req.dir);
      const info = openShellSession(dir);
      linkClientToProject(dir, { showWindow: true });
      notifyShellSession(info);
      focusSession(info.id, info.dir, { showWindow: true });
      return {
        ok: true,
        action: 'open',
        dir: info.dir,
        id: info.id,
        cwd: info.cwd,
        title: info.title,
      };
    }

    if (action === 'exec') {
      const command = String(req.command || '').trim();
      if (!command) {
        return {
          ok: false,
          action: 'exec',
          dir: req.dir ?? null,
          error: '缺少 command',
        };
      }
      const dir = resolveRunScriptDir(req.dir);
      let session = findShellForProject(dir);
      let info: { id: string; dir: string; cwd: string; title: string };
      if (session) {
        info = {
          id: session.id,
          dir: session.projectDir,
          cwd: session.cwd,
          title: session.title,
        };
      } else {
        info = openShellSession(dir);
        notifyShellSession(info);
      }
      const payload = /[\r\n]$/.test(command) ? command : `${command}\r`;
      if (!writeShellSession(info.id, payload)) {
        return {
          ok: false,
          action: 'exec',
          dir: info.dir,
          id: info.id,
          error: 'Shell 已退出，无法写入',
        };
      }
      linkClientToProject(dir, { showWindow: true });
      focusSession(info.id, info.dir, { showWindow: true });
      return {
        ok: true,
        action: 'exec',
        dir: info.dir,
        id: info.id,
        cwd: info.cwd,
        title: info.title,
      };
    }

    return {
      ok: false,
      action,
      dir: req.dir ?? null,
      error: 'action 须为 open | exec | close | list',
    };
  } catch (err) {
    return {
      ok: false,
      action,
      dir: req.dir ?? null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** 供 CLI / control 桥：start | restart | stop（命名 npm script） */
async function runScriptFromControl(req: {
  action: 'start' | 'restart' | 'stop';
  script: string;
  dir?: string | null;
}): Promise<{
  ok: boolean;
  action: 'start' | 'restart' | 'stop';
  script: string;
  dir: string | null;
  jobId?: string;
  wasRunning?: boolean;
  error?: string;
}> {
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
    const wasRunning = jobs.has(key) || stoppingJobs.has(key);

    if (req.action === 'stop') {
      if (!jobs.has(key) && !stoppingJobs.has(key)) {
        return {
          ok: true,
          action: 'stop',
          script,
          dir: project.dir,
          wasRunning: false,
        };
      }
      // 等杀完再返回，CLI/控制面才知道端口已释放
      await stopJobAwait(key, 'CLI 停止');
      closeJobDiskLog(key);
      focusSession(key, project.dir, { showWindow: false });
      return {
        ok: true,
        action: 'stop',
        script,
        dir: project.dir,
        jobId: key,
        wasRunning: true,
      };
    }

    if (req.action === 'restart') {
      if (jobs.has(key) || stoppingJobs.has(key)) {
        await stopJobAwait(key, 'CLI 重启前停止');
        closeJobDiskLog(key);
      }
      const jobId = startJob(project.dir, script);
      linkClientToProject(project.dir, { showWindow: true });
      focusSession(jobId, project.dir, { showWindow: true });
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
      focusSession(key, project.dir, { showWindow: true });
      return {
        ok: false,
        action: 'start',
        script,
        dir: project.dir,
        jobId: key,
        wasRunning: true,
        error: `脚本已在运行：${script}（可用 restart）`,
      };
    }
    const jobId = startJob(project.dir, script);
    linkClientToProject(project.dir, { showWindow: true });
    focusSession(jobId, project.dir, { showWindow: true });
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

/** 流式热路径：plain POJO / string，走 structuredClone，避免双重 JSON */
function sendPlain(channel: string, ...args: unknown[]) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send(channel, ...args);
  } catch (err) {
    diagLog('runner', 'ipc.send.fail', {
      channel,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/** 快照类载荷：防御性 JSON 克隆，避免不可 clone 对象跨进程失败 */
function send(channel: string, ...args: unknown[]) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
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
  if (isRunnerUiLive()) {
    pushUiStateSnapshot();
  } else {
    send('pkg:jobs', jobsSnapshot());
    send('pkg:running', jobs.size > 0);
  }
}

function scheduleUiSnapshotBroadcast(): void {
  broadcastUiSnapshot();
  // 渲染进程 mount 可能略晚于 did-finish-load；补一次即可，勿连发拖主进程
  setTimeout(broadcastUiSnapshot, 120);
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

function isRunnerVisuallyOpen(): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) return false;
  return mainWindow.isVisible();
}

function emitVisibility(): void {
  const visible = isRunnerVisuallyOpen();
  if (lastEmittedVisible === visible) return;
  const wasVisible = lastEmittedVisible;
  lastEmittedVisible = visible;
  if (visible && !wasVisible) {
    // 亮窗：丢弃未发增量（已在 store），推全量快照，再恢复增量
    pushUiStateSnapshot();
    // jobs/running 等也补一发（快照已含 jobs；兼容旧渲染）
    if (mainWindow && !mainWindow.isDestroyed()) {
      send('pkg:jobs', jobsSnapshot());
      send('pkg:stopping', [...stoppingJobs]);
    }
  } else if (!visible && wasVisible) {
    dropPendingUiIpcWithoutSend();
  }
  onVisibilityChangeFn?.(visible);
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  emitVisibility();
}

function hideWindow() {
  mainWindow?.hide();
  emitVisibility();
}

/** 始终显示（设置页「打开」等，不切换隐藏） */
export function showRunnerWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  diagLog('runner', 'window.show');
  showWindow();
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
  return path.join(app.getPath('userData'), 'runner-toggle.signal');
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
  // brandColor 只走渲染进程 CSS；icon / 标题跟运行环境，不随拾色器改
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

/** 轻量拉一次托盘配置；无托盘则立刻放弃，不再 50ms/180ms 轮询打盘 */
async function waitForTraySettings(timeoutMs: number): Promise<void> {
  if (traySettingsReceived) return;
  if (hostMode === 'embedded' && getSharedSettingsFn) {
    applySettingsFromTray(getSharedSettingsFn());
    diagLog('runner', 'settings.wait.done', { received: traySettingsReceived, via: 'embedded' });
    return;
  }
  if (timeoutMs <= 0) {
    diagLog('runner', 'settings.wait.done', { received: false, via: 'skip' });
    return;
  }
  diagLog('runner', 'settings.wait.start', { timeoutMs });
  const raw = await pullSettingsFromTray(Math.min(280, timeoutMs));
  if (raw) applySettingsFromTray(raw);
  diagLog('runner', 'settings.wait.done', {
    received: traySettingsReceived,
    via: traySettingsReceived ? 'pull' : 'none',
  });
  // 托盘稍后可通过 POST /v1/settings 推送；standalone 无托盘时不刷屏、不空转轮询
}

function projectsState() {
  return workspaceProjectsState();
}

function persistProjectsBroadcast(): void {
  send('pkg:projects', projectsState());
}

/** 打开目录为工作区（或工作区内仓库），与 Code Editor 共用 prefs */
function addAndActivateProject(dir: string): { dir: string; name: string } {
  const state = openWorkspaceDir(dir);
  const active = state.activeProject || state.workspaceRoot;
  if (!active) throw new Error('无法打开工作区');
  const hit = state.projects.find((p) => sameDir(p.dir, active));
  return { dir: active, name: hit?.name || path.basename(active) };
}

function setActiveProject(dir: string | null) {
  if (!dir) return;
  selectWorkspaceRepo(dir);
}

function removeProject(_dir: string) {
  // 工作区模型下不再「从列表移除」仓库；保留 API 兼容，广播当前状态即可
  persistProjectsBroadcast();
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
  const colorEnv = pkgRunnerColorEnv();
  const appIcon = resolveEnvAssetPath('icon', pkgRunnerColorEnv());
  mainWindow = new BrowserWindow({
    width: 900,
    height: 520,
    minWidth: 900,
    minHeight: 520,
    title: colorEnv === 'test' ? 'Pkg Runner · 测试' : 'Pkg Runner',
    icon: appIcon,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: windowBackgroundForTheme(shared.theme),
    hasShadow: true,
    webPreferences: {
      preload: panelPreload(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  diagLog('runner', 'window.icon', {
    env: colorEnv,
    file: path.basename(appIcon),
    path: appIcon,
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
    emitVisibility();
  });

  void loadMainWindow(mainWindow);

  // 拖动时反复 focus 再 setAlwaysOnTop 会闪，仅 show 时钉一次
  mainWindow.on('show', () => {
    applyPinChrome();
    emitVisibility();
  });
  mainWindow.on('hide', () => {
    emitVisibility();
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

  /** 选择工作区目录（与 Editor「选择工作区」同源） */
  ipcMain.handle('pkg:pick-workspace', async (e) => {
    const win = winFromEvent(e) || mainWindow;
    if (!win) return projectsState();
    const r = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: '选择工作区目录',
    });
    if (r.canceled || !r.filePaths[0]) return projectsState();
    pickWorkspaceDir(r.filePaths[0]);
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



  ipcMain.handle('pkg:get-color-env', (): PkgRunnerColorEnv => pkgRunnerColorEnv());

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
    error: null as string | null,
  }));

  ipcMain.handle('pkg:get-persist-logs', () => shared.persistLogs);

  ipcMain.handle('pkg:open-logs-dir', () => openLogsDir());


  ipcMain.handle('pkg:clear-disk-logs', () => clearDiskLogsAction());

  ipcMain.handle('pkg:ports-list', () => listPortsFromControl());
  ipcMain.handle(
    'pkg:ports-kill',
    (_e, payload: { port?: number | null; pid?: number | null }) =>
      killPortFromControl({
        port: payload?.port,
        pid: payload?.pid,
      }),
  );
  ipcMain.handle(
    'pkg:ports-reap',
    (_e, payload?: { nodeOnly?: boolean }) =>
      reapPortsFromControl({ nodeOnly: payload?.nodeOnly !== false }),
  );

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
  ipcMain.handle('pkg:get-ui-state', () => buildUiStateSnapshot());
  ipcMain.handle('pkg:clear-log-session', (_e, id: string) => {
    const key = String(id || '');
    if (!key) return false;
    clearUiSessionText(key);
    return true;
  });
  ipcMain.handle('pkg:remove-log-session', (_e, id: string) => {
    const key = String(id || '');
    if (!key || key === UI_SYSTEM_ID) return false;
    removeUiSession(key);
    return true;
  });

  ipcMain.handle('pkg:stop', async (_e, jobId?: string) => {
    if (jobId) {
      if (isShellId(jobId)) stopShellCommand(jobId);
      else await stopJobAwait(jobId, '已停止');
    } else {
      stopAllJobs();
      stopAllShellCommands();
      // 等在途异步杀完，避免 UI loading 提前结束
      await Promise.all([...pendingKills.values()]);
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
        void runScriptFromControl({ action, script: scriptName, dir }).then((r) => {
          appendSystemLog(
            r.ok
              ? `\n[CLI] ${r.action} ${r.script}${r.dir ? ` @ ${r.dir}` : ''}\n`
              : `\n[CLI] ${action} 失败：${r.error || '?'}\n`,
          );
        });
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
  onVisibilityChangeFn = opts.onVisibilityChange ?? null;
  lastEmittedVisible = null;
  resetUiStateStore();

  prefs = loadPrefs();
  migrateLegacyRunnerProjects(prefs);
  onWorkspacePrefsChange(() => {
    persistProjectsBroadcast();
  });
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
  // standalone：立刻出窗，控制面/托盘配置并行，避免串行等 listen + 文件轮询
  if (hostMode === 'standalone') {
    stopToggleSignalWatch = watchRunnerToggleSignal();
    createWindow();
  }
  void startControlServer({
    onFlushed: (r) => {
      appendSystemLog(
        `\n[控制面] flush-logs：pending ${r.pendingBytes}B · writers ${r.writers}${r.persistEnabled ? '' : ' · 开关关闭'}\n`,
      );
    },
    runScript: (req) => runScriptFromControl(req),
    runShell: (req) => shellFromControl(req),
    runPorts: (req) => {
      if (req.action === 'list') return listPortsFromControl();
      if (req.action === 'kill') {
        return killPortFromControl({ port: req.port, pid: req.pid });
      }
      return reapPortsFromControl({ nodeOnly: req.nodeOnly });
    },
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
    onRunShell: (r) => {
      if (r.ok) {
        const tip =
          r.action === 'list'
            ? `list ${r.shells?.length ?? 0}`
            : r.action === 'close'
              ? `close ${(r.closed || []).length}`
              : `${r.action}${r.id ? ` ${r.id}` : ''}`;
        appendSystemLog(
          `\n[控制面] shell ${tip}${r.dir ? ` @ ${r.dir}` : ''}\n`,
        );
      } else {
        appendSystemLog(`\n[控制面] shell ${r.action} 失败：${r.error || '?'}\n`);
      }
    },
    onRunPorts: (r) => {
      if (r.action === 'list') {
        appendSystemLog(
          `\n[控制面] ports list：${r.ports.length} 条 · orphan ${r.orphans}\n`,
        );
        return;
      }
      if (r.action === 'kill') {
        const okN = r.killed.filter((k) => k.ok).length;
        appendSystemLog(
          `\n[控制面] ports kill：${okN}/${r.killed.length}${r.error ? ` · ${r.error}` : ''}\n`,
        );
        return;
      }
      const okN = r.killed.filter((k) => k.ok).length;
      appendSystemLog(
        `\n[控制面] ports reap：killed ${okN} · skipped ${r.skipped.length}${r.nodeOnly ? ' · nodeOnly' : ''}\n`,
      );
    },
  })
    .then((srv) => {
      controlListenPort = srv.info.port;
      stopControlServer = () => {
        srv.stop();
        stopControlServer = null;
        controlListenPort = null;
      };
      appendSystemLog(
        `\n[控制面] ${srv.info.baseUrl}（token 见 userData/control/http.json）\n`,
      );
      diagLog('runner', 'control.ready', {
        baseUrl: srv.info.baseUrl,
        log: diagLogPath(),
      });
    })
    .catch((err) => {
      appendSystemLog(
        `\n[控制面] 启动失败：${err instanceof Error ? err.message : String(err)}\n`,
      );
    });
  void waitForTraySettings(hostMode === 'embedded' ? 0 : 280).catch((err) => {
    diagLog('runner', 'settings.wait.fail', {
      err: err instanceof Error ? err.message : String(err),
    });
  });
  // embedded：不预开窗口，托盘起来后再按需 create（启动快很多）
}

/** 预热 Runner 窗（隐藏）。默认启动路径不调用，以免 Chromium 冷启动卡主机 */
export function warmRunnerWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    diagLog('runner', 'warm.skip', { reason: 'already' });
    return;
  }
  const t0 = Date.now();
  diagLog('runner', 'warm.start', {});
  createWindow();
  const win = mainWindow;
  if (win && !win.isDestroyed()) {
    win.once('ready-to-show', () => {
      if (!isQuitting) hideWindow();
      diagLog('runner', 'warm.done', { ms: Date.now() - t0 });
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
  dropPendingUiIpcWithoutSend();
  resetUiStateStore();
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