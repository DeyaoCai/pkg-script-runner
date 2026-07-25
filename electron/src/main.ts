import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
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
  settingsFromPrefs,
  formatHotkeyLabel,
  DEFAULT_SCREENSHOT_HOTKEY,
  DEFAULT_ACTIVATE_HOTKEY,
  DEFAULT_SCREENSHOT_HISTORY_LIMIT,
  DEFAULT_SCREENSHOT_DRAW_COLOR,
  DEFAULT_GLASS_ALPHA,
  DEFAULT_FONT_ID,
  DEFAULT_THEME,
  DEFAULT_SHELL_MOSAIC_COLS,
  DEFAULT_SHELL_LAYOUT,
  normalizeScreenshotHistoryLimit,
  normalizeScreenshotDrawColor,
  normalizeTheme,
  normalizeShellMosaicCols,
  normalizeShellLayout,
  type Prefs,
  type AppSettings,
} from './prefs.js';
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
import {
  bindScreenshotStarter,
  closeScreenshotSession,
  destroyScreenshotSession,
  isScreenshotOpen,
  registerScreenshotIpc,
  registerScreenshotScheme,
  startScreenshotSession,
  warmScreenshotWindow,
} from './screenshotSession.js';
import { trimScreenshotHistory, ensureScreenshotHistoryDir } from './screenshotHistory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const TRAY_ICON = path.join(APP_ROOT, 'assets', 'tray.png');

/** 固定应用名与 userData，避免开发态多个 Electron 抢同一把单实例锁 */
app.setName('pkg-runner');
try {
  app.setPath('userData', path.join(app.getPath('appData'), 'pkg-runner'));
} catch {
  /* ignore */
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  console.warn('[pkg-runner] 已有实例在运行，本进程退出');
  app.exit(0);
} else {
  // 截屏内存图协议：必须在 ready 前注册
  registerScreenshotScheme();
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let initialDir: string | null = null;
let isQuitting = false;
/** 本机 HTTP 控制面 stop 钩子 */
let stopControlServer: (() => void) | null = null;
let prefs: Prefs = {
  persistLogs: false,
  fontId: DEFAULT_FONT_ID,
  glassAlpha: DEFAULT_GLASS_ALPHA,
  theme: DEFAULT_THEME,
  shellMosaicCols: DEFAULT_SHELL_MOSAIC_COLS,
  shellLayout: DEFAULT_SHELL_LAYOUT,
  alwaysOnTop: false,
  screenshotHotkey: DEFAULT_SCREENSHOT_HOTKEY,
  activateHotkey: DEFAULT_ACTIVATE_HOTKEY,
  screenshotHistoryLimit: DEFAULT_SCREENSHOT_HISTORY_LIMIT,
  screenshotDrawColor: DEFAULT_SCREENSHOT_DRAW_COLOR,
  projects: [],
  activeProject: null,
};
/** 当前已注册的全局热键（空=未注册） */
let registeredScreenshotHotkey = '';
let registeredActivateHotkey = '';

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
  updateTrayMenu();
  refreshTrayTooltip();
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

function refreshTrayTooltip() {
  if (!tray) return;
  const parts = ['Pkg Runner'];
  if (prefs.alwaysOnTop) parts.push('永久置顶');
  const runningScripts = jobs.size;
  const runningShells = [...shells.values()].filter((s) => s.pty).length;
  if (runningScripts > 0) parts.push(`脚本 ${runningScripts}`);
  if (runningShells > 0) parts.push(`Shell ${runningShells}`);
  tray.setToolTip(parts.join(' · '));
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
  mainWindow?.webContents.send(channel, ...args);
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
    if (p === APP_ROOT) continue;
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

function hideToTray() {
  ensureTray();
  mainWindow?.hide();
}

function quitApp() {
  isQuitting = true;
  globalShortcut.unregisterAll();
  destroyScreenshotSession();
  stopAllAssociatedProcesses('退出前停止');
  flushAllDiskLogs();
  closeAllDiskLogs();
  destroyTray();
  app.quit();
}

function destroyTray() {
  tray?.destroy();
  tray = null;
}

function ensureTray() {
  if (!tray) createTray();
}

/** 永久置顶 */
function applyPinChrome() {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  const pin = prefs.alwaysOnTop;
  if (pin) {
    // screen-saver：尽量压过其它置顶窗（含全屏游戏外的普通窗口）
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } else {
    win.setAlwaysOnTop(false);
    win.setVisibleOnAllWorkspaces(false);
  }
}

function updateTrayMenu() {
  if (!tray) return;
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '设置…',
      click: () => openSettingsFromTray(),
    },
    { type: 'separator' },
    {
      label: prefs.screenshotHotkey
        ? `截屏（${formatHotkeyLabel(prefs.screenshotHotkey)}）`
        : '截屏',
      click: () => {
        void beginScreenshot();
      },
    },
    {
      label: '截屏历史…',
      click: () => openScreenshotHistoryFromTray(),
    },
    {
      label: '打开截屏目录',
      click: () => {
        void openScreenshotHistoryDir();
      },
    },
    { type: 'separator' },
    {
      label: '永久置顶',
      type: 'checkbox',
      checked: prefs.alwaysOnTop,
      click: (item) => {
        void applySettingsPatch({ alwaysOnTop: item.checked });
        applyPinChrome();
      },
    },
    {
      label: '日志落盘',
      type: 'checkbox',
      checked: prefs.persistLogs,
      click: (item) => setPersistLogsPref(item.checked),
    },
    {
      label: '打开日志目录',
      click: () => {
        void openLogsDir();
      },
    },
    {
      label: '清除落盘日志',
      click: () => {
        clearDiskLogsAction();
      },
    },
    { type: 'separator' },
    {
      label: '显示窗口',
      click: () => showWindow(),
    },
    {
      label: '隐藏到托盘',
      click: () => hideToTray(),
    },
    { type: 'separator' },
    {
      label: jobs.size > 0 ? `停止全部脚本（${jobs.size}）` : '停止全部脚本',
      enabled: jobs.size > 0,
      click: () => stopAllJobs(),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => quitApp(),
    },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  if (tray) return;

  let icon = nativeImage.createFromPath(TRAY_ICON);
  if (icon.isEmpty()) {
    icon = nativeImage.createEmpty();
  } else if (process.platform === 'win32') {
    icon = icon.resize({ width: 16, height: 16 });
  }

  tray = new Tray(icon);
  refreshTrayTooltip();
  updateTrayMenu();

  // 左键：显示窗口
  tray.on('click', () => {
    showWindow();
  });
  tray.on('double-click', () => {
    showWindow();
  });
}

/** 录制热键期间：已挂起全局快捷键 */
let hotkeysSuspended = false;

function unregisterAccel(accel: string) {
  if (!accel) return;
  try {
    globalShortcut.unregister(accel);
  } catch {
    /* ignore */
  }
}

function hotkeyTakenByOthers(
  accel: string,
  self: 'screenshot' | 'activate',
): string | null {
  const s = (prefs.screenshotHotkey || '').trim();
  const a = (prefs.activateHotkey || '').trim();
  if (!accel) return null;
  if (self !== 'screenshot' && accel === s) return '与截屏热键冲突';
  if (self !== 'activate' && accel === a) return '与显示/隐藏热键冲突';
  return null;
}

function registerScreenshotShortcut() {
  unregisterAccel(registeredScreenshotHotkey);
  registeredScreenshotHotkey = '';
  const next = (prefs.screenshotHotkey || '').trim();
  if (!next) return { ok: true, registered: '', error: null as string | null };
  const conflict = hotkeyTakenByOthers(next, 'screenshot');
  if (conflict) return { ok: false, registered: '', error: conflict };
  const ok = globalShortcut.register(next, () => {
    void beginScreenshot();
  });
  if (!ok) {
    console.warn(`[pkg-runner] screenshot hotkey failed: ${next}`);
    return { ok: false, registered: '', error: '热键已被占用或无效' };
  }
  registeredScreenshotHotkey = next;
  return { ok: true, registered: next, error: null as string | null };
}

/** 显示/隐藏：可见且聚焦则关到托盘，否则唤起 */
function toggleWindowFromHotkey() {
  const win = mainWindow;
  if (!win || win.isDestroyed()) {
    showWindow();
    return;
  }
  if (win.isVisible() && !win.isMinimized() && win.isFocused()) {
    hideToTray();
    return;
  }
  showWindow();
}

function registerActivateShortcut() {
  unregisterAccel(registeredActivateHotkey);
  registeredActivateHotkey = '';
  const next = (prefs.activateHotkey || '').trim();
  if (!next) return { ok: true, registered: '', error: null as string | null };
  const conflict = hotkeyTakenByOthers(next, 'activate');
  if (conflict) return { ok: false, registered: '', error: conflict };
  const ok = globalShortcut.register(next, () => toggleWindowFromHotkey());
  if (!ok) {
    console.warn(`[pkg-runner] activate hotkey failed: ${next}`);
    return { ok: false, registered: '', error: '热键已被占用或无效' };
  }
  registeredActivateHotkey = next;
  return { ok: true, registered: next, error: null as string | null };
}

function registerAllShortcuts() {
  if (hotkeysSuspended) {
    return {
      ok: true,
      screenshotError: null as string | null,
      activateError: null as string | null,
    };
  }
  const shot = registerScreenshotShortcut();
  const activate = registerActivateShortcut();
  return {
    ok: shot.ok && activate.ok,
    screenshotError: shot.error,
    activateError: activate.error,
  };
}

/** 录制热键时取消全部全局热键，避免抢键 */
function suspendHotkeys() {
  hotkeysSuspended = true;
  unregisterAccel(registeredScreenshotHotkey);
  registeredScreenshotHotkey = '';
  unregisterAccel(registeredActivateHotkey);
  registeredActivateHotkey = '';
  try {
    globalShortcut.unregisterAll();
  } catch {
    /* ignore */
  }
}

function resumeHotkeys() {
  hotkeysSuspended = false;
  return registerAllShortcuts();
}

async function beginScreenshot(): Promise<{ ok: boolean; error?: string }> {
  if (isScreenshotOpen()) {
    return startScreenshotSession({
      appRoot: APP_ROOT,
      preloadPath: path.join(__dirname, 'screenshot-preload.js'),
    });
  }

  const win = mainWindow;
  const canProtect =
    !!win && !win.isDestroyed() && typeof win.setContentProtection === 'function';
  // 优先用内容保护排除主窗（无藏窗闪烁）；不支持时再短藏
  let usedProtection = false;
  let shouldRestoreMain = false;

  if (canProtect) {
    try {
      win.setContentProtection(true);
      usedProtection = true;
      // 给合成器一帧应用 WDA_EXCLUDEFROMCAPTURE
      await new Promise<void>((r) => setTimeout(r, 16));
    } catch {
      usedProtection = false;
    }
  }

  if (!usedProtection && win && !win.isDestroyed() && win.isVisible() && !win.isMinimized()) {
    shouldRestoreMain = true;
    win.hide();
    await new Promise<void>((r) => setTimeout(r, 16));
  }

  let restored = false;
  const restoreMain = () => {
    if (restored) return;
    restored = true;
    if (win && !win.isDestroyed()) {
      try {
        if (usedProtection) win.setContentProtection(false);
      } catch {
        /* ignore */
      }
      if (shouldRestoreMain) showWindow();
    }
  };

  try {
    const res = await startScreenshotSession({
      appRoot: APP_ROOT,
      preloadPath: path.join(__dirname, 'screenshot-preload.js'),
      onSessionEnd: restoreMain,
    });
    if (!res.ok) {
      restoreMain();
      appendSystemLog(`\n[截屏] ${res.error || '启动失败'}\n`);
    }
    return res;
  } catch (err) {
    closeScreenshotSession();
    restoreMain();
    const msg = err instanceof Error ? err.message : String(err);
    appendSystemLog(`\n[截屏] ${msg}\n`);
    return { ok: false, error: msg };
  }
}

function openScreenshotHistoryFromTray() {
  showWindow();
  send('pkg:open-ss-history');
}

function openSettingsFromTray() {
  showWindow();
  send('pkg:open-settings');
}

function applySettingsPatch(patch: Partial<AppSettings>): {
  settings: AppSettings;
  hotkeyError: string | null;
} {
  let hotkeyError: string | null = null;

  if (typeof patch.fontId === 'string' && patch.fontId.trim()) {
    prefs.fontId = patch.fontId.trim();
  }
  if (patch.glassAlpha != null) {
    const n = Number(patch.glassAlpha);
    if (Number.isFinite(n)) {
      prefs.glassAlpha = Math.min(100, Math.max(10, Math.round(n)));
    }
  }
  if (patch.theme != null) {
    prefs.theme = normalizeTheme(patch.theme);
  }
  if (patch.shellMosaicCols != null) {
    prefs.shellMosaicCols = normalizeShellMosaicCols(patch.shellMosaicCols);
  }
  if (patch.shellLayout != null) {
    prefs.shellLayout = normalizeShellLayout(patch.shellLayout);
  }
  if (typeof patch.alwaysOnTop === 'boolean') {
    prefs.alwaysOnTop = patch.alwaysOnTop;
    applyPinChrome();
  }
  if (patch.screenshotHistoryLimit != null) {
    const next = normalizeScreenshotHistoryLimit(patch.screenshotHistoryLimit);
    if (next !== prefs.screenshotHistoryLimit) {
      prefs.screenshotHistoryLimit = next;
      const removed = trimScreenshotHistory(next);
      if (removed > 0) send('pkg:ss-history', true);
    }
  }

  const prevShot = prefs.screenshotHotkey;
  const prevActivate = prefs.activateHotkey;
  let hotkeysChanged = false;

  if (typeof patch.screenshotHotkey === 'string') {
    prefs.screenshotHotkey = patch.screenshotHotkey.trim();
    hotkeysChanged = true;
  }
  if (typeof patch.activateHotkey === 'string') {
    prefs.activateHotkey = patch.activateHotkey.trim();
    hotkeysChanged = true;
  }

  if (hotkeysChanged) {
    // 录制挂起期间也要真正注册一次，才能校验占用/冲突
    const wasSuspended = hotkeysSuspended;
    hotkeysSuspended = false;
    const res = registerAllShortcuts();
    if (!res.ok) {
      prefs.screenshotHotkey = prevShot;
      prefs.activateHotkey = prevActivate;
      registerAllShortcuts();
      if (wasSuspended) suspendHotkeys();
      hotkeyError =
        res.screenshotError ||
        res.activateError ||
        '热键注册失败';
    } else if (wasSuspended) {
      // 成功写入后保持生效；前端结束录制时再 resume 也无妨
      hotkeysSuspended = false;
    }
  }

  savePrefs(prefs);
  updateTrayMenu();
  refreshTrayTooltip();
  const settings = settingsFromPrefs(prefs);
  send('pkg:settings', settings);
  return { settings, hotkeyError };
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

function setPersistLogsPref(enabled: boolean) {
  prefs.persistLogs = enabled;
  savePrefs(prefs);
  setPersistLogs(enabled);
  send('pkg:persist-logs', enabled);
  updateTrayMenu();
  if (enabled) {
    appendSystemLog(`\n[落盘] 已开启（满 64KB 写入 · 单文件约 1MB 拆分 · 文件名精确到毫秒）\n[落盘] ${getLogsDir()}\n`);
  } else {
    appendSystemLog('\n[落盘] 已关闭\n');
  }
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

async function openScreenshotHistoryDir(): Promise<{
  ok: boolean;
  dir: string;
  error: string | null;
}> {
  const dir = ensureScreenshotHistoryDir();
  const error = await shell.openPath(dir);
  if (error) {
    appendSystemLog(`\n[截屏] 打开目录失败：${error}\n`);
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
      preload: path.join(__dirname, 'preload.js'),
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

  void win.loadFile(path.join(APP_ROOT, 'ui', 'glass-lab.html'), {
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
      preload: path.join(__dirname, 'preload.js'),
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

  void glassHubWindow.loadFile(path.join(APP_ROOT, 'ui', 'glass-hub.html'));
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
    // 纯 CSS 毛玻璃：透明窗 + 页面 blur / alpha（无系统 Acrylic/Mica）
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    applyPinChrome();
    mainWindow?.show();
  });

  void mainWindow.loadFile(path.join(APP_ROOT, 'ui', 'index.html'));

  mainWindow.on('show', () => {
    applyPinChrome();
  });
  // Windows 偶发丢掉置顶位，聚焦时再钉一次
  mainWindow.on('focus', () => {
    if (prefs.alwaysOnTop) applyPinChrome();
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
    hideToTray();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('did-finish-load', () => {
    send('pkg:persist-logs', prefs.persistLogs);
    send('pkg:settings', settingsFromPrefs(prefs));
    send('pkg:maximized', mainWindow?.isMaximized() ?? false);
    send('pkg:projects', projectsState());
    send('pkg:jobs', jobsSnapshot());
    send('pkg:running', jobs.size > 0);
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
    if (win === mainWindow) hideToTray();
    else win.close();
  });

  ipcMain.handle('pkg:window-is-maximized', (e) => winFromEvent(e)?.isMaximized() ?? false);

  ipcMain.handle('pkg:open-glass-labs', () => {
    openGlassHub();
  });

  ipcMain.handle('pkg:open-glass-lab', (_e, kind: string) => {
    if (kind in GLASS_LAB_SPECS) createGlassLabWindow(kind as GlassLabKind);
  });



  ipcMain.handle('pkg:get-settings', () => settingsFromPrefs(prefs));

  ipcMain.handle('pkg:set-settings', (_e, patch: Partial<AppSettings>) => {
    return applySettingsPatch(patch && typeof patch === 'object' ? patch : {});
  });

  ipcMain.handle('pkg:hotkeys-suspend', () => {
    suspendHotkeys();
  });

  ipcMain.handle('pkg:hotkeys-resume', () => {
    resumeHotkeys();
  });

  ipcMain.handle('pkg:get-persist-logs', () => prefs.persistLogs);

  ipcMain.handle('pkg:set-persist-logs', (_e, enabled: boolean) => {
    setPersistLogsPref(Boolean(enabled));
    return prefs.persistLogs;
  });

  ipcMain.handle('pkg:open-logs-dir', () => openLogsDir());

  ipcMain.handle('pkg:open-ss-history-dir', () => openScreenshotHistoryDir());

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

  registerScreenshotIpc({
    onHistoryChanged: () => send('pkg:ss-history', true),
    onCompleteLog: (msg) => appendSystemLog(msg),
    getHistoryLimit: () => prefs.screenshotHistoryLimit,
    getDrawColor: () => prefs.screenshotDrawColor,
    setDrawColor: (hex: string) => {
      const next = normalizeScreenshotDrawColor(hex);
      if (next === prefs.screenshotDrawColor) return next;
      prefs.screenshotDrawColor = next;
      savePrefs(prefs);
      return next;
    },
  });
  bindScreenshotStarter(() => beginScreenshot());
}

if (gotSingleInstanceLock) {
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

    // electron . --run-script=dev [--dir=...] / --restart-script=dev / --stop-script=dev
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
    showWindow();
  });

  app.whenReady().then(() => {
    prefs = loadPrefs();
    setPersistLogs(prefs.persistLogs);
    trimScreenshotHistory(prefs.screenshotHistoryLimit);
    initialDir = resolveInitialDir();
    if (initialDir) {
      try {
        addAndActivateProject(initialDir);
      } catch {
        /* 右键目录无 package.json 时仍打开窗口 */
      }
    }
    registerIpc();
    createTray();
    registerAllShortcuts();
    createWindow();
    warmScreenshotWindow({
      appRoot: APP_ROOT,
      preloadPath: path.join(__dirname, 'screenshot-preload.js'),
    });
    void startControlServer({
      onFlushed: (r) => {
        appendSystemLog(
          `\n[控制面] flush-logs：pending ${r.pendingBytes}B · writers ${r.writers}${r.persistEnabled ? '' : ' · 开关关闭'}\n`,
        );
      },
      runScript: (req) => runScriptFromControl(req),
      onRunScript: (r) => {
        if (r.ok) {
          appendSystemLog(
            `\n[控制面] ${r.action} ${r.script}${r.dir ? ` @ ${r.dir}` : ''}${r.wasRunning ? '（原在跑）' : ''}\n`,
          );
        } else {
          appendSystemLog(`\n[控制面] ${r.action} 失败：${r.error || '?'}\n`);
        }
      },
    })
      .then((srv) => {
        stopControlServer = () => {
          srv.stop();
          stopControlServer = null;
        };
        appendSystemLog(
          `\n[控制面] ${srv.info.baseUrl}（token 见 %APPDATA%/pkg-runner/control/http.json）\n`,
        );
      })
      .catch((err) => {
        appendSystemLog(
          `\n[控制面] 启动失败：${err instanceof Error ? err.message : String(err)}\n`,
        );
      });
  });

  app.on('window-all-closed', () => {
    // 托盘常驻，不因无窗口退出
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  app.on('before-quit', () => {
    isQuitting = true;
    try {
      stopControlServer?.();
    } catch {
      /* ignore */
    }
    closeGlassLabs();
    destroyScreenshotSession();
    stopAllAssociatedProcesses('退出前停止');
    flushAllDiskLogs();
    closeAllDiskLogs();
  });
}