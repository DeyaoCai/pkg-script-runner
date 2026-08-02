import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  globalShortcut,
  ipcMain,
  nativeImage,
  shell,
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromeBackground } from '@pkg-runner/tokens';
import {
  loadPrefs,
  savePrefs,
  settingsFromPrefs,
  formatHotkeyLabel,
  normalizeScreenshotHistoryLimit,
  normalizeScreenshotDrawColor,
  normalizeHotkey,
  normalizeGlassAlpha,
  normalizeShellMosaicCols,
  normalizeShellLayout,
  normalizeTheme,
  normalizeBrandColor,
  brandColorForTone,
  normalizeFontId,
  trayCmdPath,
  trayCmdReplyPath,
  watchSharedSettings,
  sharedSettingsPath,
  type SharedPrefs,
  type SharedSettings,
} from './prefs.js';
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
import {
  trimScreenshotHistory,
  ensureScreenshotHistoryDir,
} from './screenshotHistory.js';
import {
  showEditorWindow,
  shutdownEditorHost,
  startEditorHost,
  toggleEditorWindow,
  warmEditorWindow,
} from '../../code-editor/src/main/editorHost.js';
import {
  applyRunnerSettings,
  showRunnerWindow,
  shutdownRunnerHost,
  startRunnerHost,
  toggleRunnerWindow,
  warmRunnerWindow,
} from '../../runner/src/runnerHost.js';
import { diagLog, diagLogPath, readDiagTail } from './diagLog.js';
import {
  ensureAppShortcutsOnPackagedLaunch,
  installAppShortcuts,
} from './desktopShortcut.js';
import {
  destroyCompositorKeepalive,
  ensureCompositorKeepalive,
} from './compositorKeepalive.js';
import {
  applyPkgRunnerUserData,
  pkgRunnerColorEnv,
  pkgRunnerProfileName,
} from '../../runner/src/appProfile.js';
import { resolveEnvAssetPath } from '../../runner/src/appIcons.js';

function toggleEditor(): void {
  toggleEditorWindow();
}

function toggleRunner(): void {
  // 首次开 Runner 再挂 DWM keepalive，避免启动期多一扇窗抢合成
  ensureCompositorKeepalive();
  toggleRunnerWindow();
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

app.setName('pkg-runner');
const profileRoot = applyPkgRunnerUserData();

/** 运行环境色板（icon / data-env）；与设置里的主图强调色正交 */
function activeBrandTone(): 'prod' | 'test' {
  return pkgRunnerColorEnv();
}

function syncBrandEnvFromPrefs(): void {
  // 不再用 prefs.brandTone / brandColor 覆盖 COLOR_ENV
  if (prefs) prefs.brandTone = activeBrandTone();
}

/** 任务栏 / 标题栏用较大 icon；托盘用 tray* */
function resolveAppIconPath(): string {
  return resolveEnvAssetPath(APP_ROOT, 'icon');
}

function resolveTrayIconPath(): string {
  // Win 托盘缩到 16px：用较大的 icon-* 比 tray-* 更易辨认棕/蓝
  const kind = process.platform === 'win32' ? 'icon' : 'tray';
  const p = resolveEnvAssetPath(APP_ROOT, kind);
  if (activeBrandTone() === 'test' && !/-test\.png$/i.test(path.basename(p))) {
    diagLog('tray', 'icon.missing-test', {
      tried: path.join(APP_ROOT, 'assets', `${kind}-test.png`),
    });
  }
  return p;
}

function trayEnvLabel(): string {
  return activeBrandTone() === 'test' ? '测试' : '正式';
}

function applyBrandIcons(): void {
  syncBrandEnvFromPrefs();
  if (tray) {
    const trayIconPath = resolveTrayIconPath();
    let icon = nativeImage.createFromPath(trayIconPath);
    if (icon.isEmpty()) {
      icon = nativeImage.createEmpty();
    } else if (process.platform === 'win32') {
      icon = icon.resize({ width: 16, height: 16 });
    }
    try {
      tray.setImage(icon);
    } catch {
      /* ignore */
    }
    diagLog('tray', 'icon.apply', {
      env: activeBrandTone(),
      file: path.basename(trayIconPath),
    });
  }
  const appIcon = resolveAppIconPath();
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      win.setIcon(appIcon);
    } catch {
      /* ignore */
    }
  }
  updateTrayMenu();
}

/** Win 任务栏分组：dev/test 与正式分开，避免吃到安装包快捷方式的缓存图标 */
if (process.platform === 'win32') {
  app.setAppUserModelId(
    pkgRunnerColorEnv() === 'test' ? 'com.pkg.runner.dev' : 'com.pkg.runner',
  );
}

// 尽早设置，避免 runnerHost / editorHost 解析不到 resources 下的 UI
if (app.isPackaged) {
  if (!process.env.PKG_RUNNER_APP_DIR?.trim()) {
    process.env.PKG_RUNNER_APP_DIR = path.join(process.resourcesPath, 'runner');
  }
  if (!process.env.PKG_EDITOR_APP_DIR?.trim()) {
    process.env.PKG_EDITOR_APP_DIR = path.join(process.resourcesPath, 'code-editor');
  }
}

registerScreenshotScheme();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  diagLog('tray', 'single-instance.blocked', {
    profile: pkgRunnerProfileName(),
    userData: profileRoot,
    note: '同 profile 已有实例；开发与安装版默认分 profile，可并存',
  });
  console.warn(
    `[pkg-runner] 同 profile（${pkgRunnerProfileName()}）已有实例在运行，本进程退出。`,
  );
  app.quit();
}

let prefs: SharedPrefs = loadPrefs();
syncBrandEnvFromPrefs();
let tray: Tray | null = null;
let settingsWin: BrowserWindow | null = null;
let historyWin: BrowserWindow | null = null;
let registeredScreenshotHotkey = '';
let registeredActivateHotkey = '';
let registeredEditorHotkey = '';
let hotkeysSuspended = false;
let isQuitting = false;
let cmdWatcher: fs.FSWatcher | null = null;
let stopSharedWatch: (() => void) | null = null;
let appReady = false;
let pendingOpenSettings = false;
let warmHeavyTimer: ReturnType<typeof setTimeout> | null = null;
/** 错峰预热的后续 timer，退出时一并清 */
const warmChainTimers = new Set<ReturnType<typeof setTimeout>>();

function scheduleIdleWarms(): void {
  // 启动后很久再暖，且一次只开一扇窗，避免和 hosts 初始化叠峰
  const gapMs = 8000;
  const stepMs = 6000;
  const chain: Array<{ name: string; run: () => void }> = [
    {
      name: 'runner',
      run: () => {
        try {
          warmRunnerWindow();
        } catch (err) {
          diagLog('tray:runner', 'warm.error', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    {
      name: 'editor',
      run: () => {
        try {
          warmEditorWindow();
        } catch (err) {
          diagLog('tray:editor', 'warm.error', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    {
      name: 'screenshot',
      run: () => {
        try {
          warmScreenshotWindow({
            appRoot: APP_ROOT,
            preloadPath: path.join(__dirname, 'screenshot-preload.cjs'),
          });
        } catch (err) {
          diagLog('tray', 'warm.screenshot.error', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  ];
  diagLog('tray', 'warm.schedule', { gapMs, stepMs, n: chain.length });
  chain.forEach((step, i) => {
    const t = setTimeout(() => {
      warmChainTimers.delete(t);
      if (isQuitting) return;
      diagLog('tray', 'warm.step', { name: step.name });
      step.run();
    }, gapMs + i * stepMs);
    warmChainTimers.add(t);
  });
}

function destroyAuxWindows(): void {
  for (const win of [settingsWin, historyWin]) {
    if (win && !win.isDestroyed()) {
      try {
        win.destroy();
      } catch {
        /* ignore */
      }
    }
  }
  settingsWin = null;
  historyWin = null;
}

function stopTrayWatchers(): void {
  try {
    cmdWatcher?.close();
  } catch {
    /* ignore */
  }
  cmdWatcher = null;
  try {
    stopSharedWatch?.();
  } catch {
    /* ignore */
  }
  stopSharedWatch = null;
  if (warmHeavyTimer) {
    clearTimeout(warmHeavyTimer);
    warmHeavyTimer = null;
  }
  for (const t of warmChainTimers) clearTimeout(t);
  warmChainTimers.clear();
}

/** 退出兜底：清掉所有 BrowserWindow，再强制退出（避免软隐藏窗拖住进程树） */
function forceQuitProcess(): void {
  stopTrayWatchers();
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.destroy();
    }
  } catch {
    /* ignore */
  }
  try {
    app.exit(0);
  } catch {
    process.exit(0);
  }
}

function quitApp(): void {
  if (isQuitting) return;
  isQuitting = true;
  diagLog('tray', 'app.quit');
  try {
    globalShortcut.unregisterAll();
  } catch {
    /* ignore */
  }
  try {
    tray?.destroy();
  } catch {
    /* ignore */
  }
  tray = null;
  stopTrayWatchers();
  destroyAuxWindows();
  destroyScreenshotSession();
  destroyCompositorKeepalive();
  shutdownRunnerHost();
  shutdownEditorHost();
  forceQuitProcess();
}

function publishSettings(): void {
  const settings = settingsFromPrefs(prefs);
  diagLog('tray', 'publish.start', {
    screenshotHotkey: settings.screenshotHotkey,
    activateHotkey: settings.activateHotkey,
    editorHotkey: settings.editorHotkey,
  });
  applyRunnerSettings(settings);
}

function sendTo(win: BrowserWindow | null, channel: string, ...args: unknown[]) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function unregisterAccel(accel: string) {
  if (!accel) return;
  try {
    globalShortcut.unregister(accel);
  } catch {
    /* ignore */
  }
}

function hotkeyConflict(
  accel: string,
  self: 'screenshot' | 'activate' | 'editor',
): string | null {
  if (!accel) return null;
  const s = (prefs.screenshotHotkey || '').trim();
  const a = (prefs.activateHotkey || '').trim();
  const e = (prefs.editorHotkey || '').trim();
  if (self !== 'screenshot' && accel === s) return '与截屏热键冲突';
  if (self !== 'activate' && accel === a) return '与显示 Runner 热键冲突';
  if (self !== 'editor' && accel === e) return '与显示编辑器热键冲突';
  return null;
}

function registerScreenshotShortcut() {
  unregisterAccel(registeredScreenshotHotkey);
  registeredScreenshotHotkey = '';
  const next = (prefs.screenshotHotkey || '').trim();
  if (!next) return { ok: true, error: null as string | null };
  const conflict = hotkeyConflict(next, 'screenshot');
  if (conflict) return { ok: false, error: conflict };
  const ok = globalShortcut.register(next, () => {
    void beginScreenshot();
  });
  if (!ok) return { ok: false, error: '热键已被占用或无效' };
  registeredScreenshotHotkey = next;
  return { ok: true, error: null as string | null };
}

function registerActivateShortcut() {
  unregisterAccel(registeredActivateHotkey);
  registeredActivateHotkey = '';
  const next = (prefs.activateHotkey || '').trim();
  if (!next) return { ok: true, error: null as string | null };
  const conflict = hotkeyConflict(next, 'activate');
  if (conflict) return { ok: false, error: conflict };
  const ok = globalShortcut.register(next, () => toggleRunner());
  if (!ok) return { ok: false, error: '热键已被占用或无效' };
  registeredActivateHotkey = next;
  return { ok: true, error: null as string | null };
}

function registerEditorShortcut() {
  unregisterAccel(registeredEditorHotkey);
  registeredEditorHotkey = '';
  const next = (prefs.editorHotkey || '').trim();
  if (!next) return { ok: true, error: null as string | null };
  const conflict = hotkeyConflict(next, 'editor');
  if (conflict) return { ok: false, error: conflict };
  const ok = globalShortcut.register(next, () => toggleEditor());
  if (!ok) return { ok: false, error: '热键已被占用或无效' };
  registeredEditorHotkey = next;
  return { ok: true, error: null as string | null };
}

function clearRegisteredShortcuts() {
  unregisterAccel(registeredScreenshotHotkey);
  registeredScreenshotHotkey = '';
  unregisterAccel(registeredActivateHotkey);
  registeredActivateHotkey = '';
  unregisterAccel(registeredEditorHotkey);
  registeredEditorHotkey = '';
  try {
    globalShortcut.unregisterAll();
  } catch {
    /* ignore */
  }
}

function registerAllShortcuts() {
  if (hotkeysSuspended || !prefs.hotkeysEnabled) {
    clearRegisteredShortcuts();
    return {
      ok: true,
      screenshotError: null as string | null,
      activateError: null as string | null,
      editorError: null as string | null,
    };
  }
  const shot = registerScreenshotShortcut();
  const act = registerActivateShortcut();
  const ed = registerEditorShortcut();
  return {
    ok: shot.ok && act.ok && ed.ok,
    screenshotError: shot.error,
    activateError: act.error,
    editorError: ed.error,
  };
}

function suspendHotkeys() {
  hotkeysSuspended = true;
  clearRegisteredShortcuts();
}

function resumeHotkeys() {
  hotkeysSuspended = false;
  return registerAllShortcuts();
}

async function beginScreenshot(): Promise<{ ok: boolean; error?: string }> {
  if (isScreenshotOpen()) {
    return startScreenshotSession({
      appRoot: APP_ROOT,
      preloadPath: path.join(__dirname, 'screenshot-preload.cjs'),
    });
  }
  try {
    return await startScreenshotSession({
      appRoot: APP_ROOT,
      preloadPath: path.join(__dirname, 'screenshot-preload.cjs'),
    });
  } catch (err) {
    closeScreenshotSession();
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

async function openScreenshotHistoryDir(): Promise<{
  ok: boolean;
  dir: string;
  error: string | null;
}> {
  const dir = ensureScreenshotHistoryDir();
  try {
    await shell.openPath(dir);
    return { ok: true, dir, error: null };
  } catch (e) {
    return { ok: false, dir, error: e instanceof Error ? e.message : String(e) };
  }
}

function applySettingsPatch(patch: Partial<SharedSettings>): {
  settings: SharedSettings;
  hotkeyError: string | null;
} {
  let hotkeyError: string | null = null;
  const prevShot = prefs.screenshotHotkey;
  const prevAct = prefs.activateHotkey;
  const prevEd = prefs.editorHotkey;

  if (typeof patch.screenshotHotkey === 'string') {
    prefs.screenshotHotkey = normalizeHotkey(patch.screenshotHotkey);
  }
  if (typeof patch.activateHotkey === 'string') {
    prefs.activateHotkey = normalizeHotkey(patch.activateHotkey);
  }
  if (typeof patch.editorHotkey === 'string') {
    prefs.editorHotkey = normalizeHotkey(patch.editorHotkey);
  }
  if (patch.screenshotHistoryLimit != null) {
    const next = normalizeScreenshotHistoryLimit(patch.screenshotHistoryLimit);
    if (next !== prefs.screenshotHistoryLimit) {
      prefs.screenshotHistoryLimit = next;
      trimScreenshotHistory(next);
      sendTo(historyWin, 'pkg:ss-history', true);
    }
  }
  if (typeof patch.fontId === 'string') prefs.fontId = normalizeFontId(patch.fontId);
  if (patch.glassAlpha != null) prefs.glassAlpha = normalizeGlassAlpha(patch.glassAlpha);
  const prevTheme = prefs.theme;
  if (patch.theme != null) prefs.theme = normalizeTheme(patch.theme);
  if (patch.brandColor != null) {
    const nextColor = normalizeBrandColor(
      patch.brandColor,
      prefs.brandColor || brandColorForTone(activeBrandTone()),
    );
    prefs.brandColor = nextColor;
  }
  // brandTone 始终跟运行环境；忽略 patch 里的 brandTone / 颜色推算
  prefs.brandTone = activeBrandTone();
  if (patch.shellMosaicCols != null) {
    prefs.shellMosaicCols = normalizeShellMosaicCols(patch.shellMosaicCols);
  }
  if (patch.shellLayout != null) {
    prefs.shellLayout = normalizeShellLayout(patch.shellLayout);
  }
  if (typeof patch.alwaysOnTop === 'boolean') prefs.alwaysOnTop = patch.alwaysOnTop;
  if (typeof patch.persistLogs === 'boolean') prefs.persistLogs = patch.persistLogs;
  if (typeof patch.hotkeysEnabled === 'boolean') {
    prefs.hotkeysEnabled = patch.hotkeysEnabled;
  }

  savePrefs(prefs);
  const res = registerAllShortcuts();
  if (!res.ok) {
    prefs.screenshotHotkey = prevShot;
    prefs.activateHotkey = prevAct;
    prefs.editorHotkey = prevEd;
    savePrefs(prefs);
    registerAllShortcuts();
    hotkeyError =
      res.screenshotError || res.activateError || res.editorError || '热键注册失败';
  }
  updateTrayMenu();
  publishSettings();
  if (
    prefs.theme !== prevTheme &&
    settingsWin &&
    !settingsWin.isDestroyed()
  ) {
    const isTest = activeBrandTone() === 'test';
    const light = prefs.theme === 'light';
    settingsWin.setBackgroundColor(
      light
        ? isTest
          ? '#f7f0ea'
          : '#f3f4f6'
        : isTest
          ? '#241208'
          : '#1a1d23',
    );
  }
  return { settings: settingsFromPrefs(prefs), hotkeyError };
}

function panelPreload(): string {
  const file = path.join(__dirname, 'preload.cjs');
  if (!fs.existsSync(file)) {
    console.error('[tray] missing preload.cjs at', file);
    diagLog('tray', 'preload.missing', { file });
  }
  return file;
}

function panelWebPreferences(): Electron.WebPreferences {
  return {
    preload: panelPreload(),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
  };
}

function reloadPrefsFromDisk(): SharedSettings {
  prefs = loadPrefs();
  return settingsFromPrefs(prefs);
}

function profileInfo() {
  return {
    profile: pkgRunnerProfileName(),
    colorEnv: activeBrandTone(),
    userData: profileRoot,
    settingsPath: sharedSettingsPath(),
    packaged: app.isPackaged,
  };
}

function deliverSettingsToWindow(win: BrowserWindow, settings: SharedSettings): void {
  sendTo(win, 'tray:settings', settings);
  const payload = JSON.stringify(settings);
  const profile = JSON.stringify(profileInfo());
  void win.webContents
    .executeJavaScript(
      `window.__applyTraySettings?.(${payload}); window.__applyTrayProfile?.(${profile});`,
      true,
    )
    .catch((err) => {
      diagLog('tray', 'settings.inject-fail', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
}

function pushSettingsToWindow(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return;
  deliverSettingsToWindow(win, reloadPrefsFromDisk());
}

function openSettingsWindow() {
  if (!appReady) {
    pendingOpenSettings = true;
    diagLog('tray', 'settings.defer', { reason: 'app not ready' });
    return;
  }
  diagLog('tray', 'settings.open');
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    pushSettingsToWindow(settingsWin);
    return;
  }
  const envLabel = activeBrandTone() === 'test' ? '测试' : '正式';
  const chromeBg = chromeBackground(activeBrandTone(), prefs.theme);
  const appIcon = resolveAppIconPath();
  // 原生标题栏：显示「设置 · 测试/正式」+ 环境 icon（勿用 hidden overlay，否则顶栏无标题文字）
  settingsWin = new BrowserWindow({
    width: 520,
    height: 700,
    title: `设置 · ${envLabel}`,
    icon: appIcon,
    backgroundColor: chromeBg,
    autoHideMenuBar: true,
    webPreferences: panelWebPreferences(),
  });
  settingsWin.webContents.on('preload-error', (_e, preloadPath, error) => {
    console.error('[tray] settings preload-error', preloadPath, error);
    diagLog('tray', 'settings.preload-error', {
      preloadPath,
      error: error instanceof Error ? error.message : String(error),
    });
  });
  settingsWin.webContents.on('dom-ready', () => {
    pushSettingsToWindow(settingsWin);
  });
  settingsWin.webContents.on('did-finish-load', () => {
    if (settingsWin && !settingsWin.isDestroyed()) {
      settingsWin.setTitle(`设置 · ${envLabel}`);
    }
    pushSettingsToWindow(settingsWin);
    void settingsWin!.webContents
      .executeJavaScript('typeof window.trayApi !== "undefined"')
      .then((hasApi) => {
        diagLog('tray', 'settings.bridge-check', { hasApi: !!hasApi });
      })
      .catch(() => {
        diagLog('tray', 'settings.bridge-check', { hasApi: false });
      });
  });
  void settingsWin.loadFile(path.join(APP_ROOT, 'ui', 'settings.html'), {
    query: { env: activeBrandTone() === 'test' ? 'test' : 'prod' },
  });
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
}

function openHistoryWindow() {
  if (historyWin && !historyWin.isDestroyed()) {
    historyWin.show();
    historyWin.focus();
    return;
  }
  historyWin = new BrowserWindow({
    width: 720,
    height: 560,
    title: '截屏历史',
    icon: resolveAppIconPath(),
    autoHideMenuBar: true,
    webPreferences: panelWebPreferences(),
  });
  void historyWin.loadFile(path.join(APP_ROOT, 'ui', 'history.html'));
  historyWin.on('closed', () => {
    historyWin = null;
  });
}

function updateTrayTooltip(): void {
  if (!tray) return;
  const env = trayEnvLabel();
  tray.setToolTip(`Pkg Runner · ${env} — 单击显示/隐藏 Runner`);
}

function updateTrayMenu() {
  if (!tray) return;
  updateTrayTooltip();
  const env = trayEnvLabel();
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: `Pkg Runner · ${env}${app.isPackaged ? '' : '（dev）'}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: '设置…',
      click: () => openSettingsWindow(),
    },
    { type: 'separator' },
    {
      label: '显示/隐藏 Runner',
      click: () => toggleRunner(),
    },
    {
      label: '显示/隐藏编辑器',
      click: () => toggleEditor(),
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
      click: () => openHistoryWindow(),
    },
    {
      label: '打开截屏目录',
      click: () => {
        void openScreenshotHistoryDir();
      },
    },
    { type: 'separator' },
    {
      label: '诊断日志…',
      click: () => {
        void shell.openPath(diagLogPath());
      },
    },
    {
      label: '创建桌面快捷方式',
      click: () => {
        const r = installAppShortcuts();
        if (r.ok) {
          diagLog('tray:shortcut', 'menu.ok', { path: r.desktop, target: r.target });
        } else {
          diagLog('tray:shortcut', 'menu.fail', { error: r.error });
        }
      },
    },
    {
      label: '退出',
      click: () => {
        quitApp();
      },
    },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  if (tray) return;
  const trayIconPath = resolveTrayIconPath();
  let icon = nativeImage.createFromPath(trayIconPath);
  diagLog('tray', 'icon.resolve', {
    env: pkgRunnerColorEnv(),
    file: path.basename(trayIconPath),
    path: trayIconPath,
    packaged: app.isPackaged,
    colorEnvVar: process.env.PKG_RUNNER_COLOR_ENV ?? null,
    force: process.env.PKG_RUNNER_COLOR_FORCE ?? null,
  });
  if (icon.isEmpty()) {
    icon = nativeImage.createEmpty();
  } else if (process.platform === 'win32') {
    icon = icon.resize({ width: 16, height: 16 });
  }
  tray = new Tray(icon);
  updateTrayMenu();
  tray.on('click', () => toggleRunner());
}

function handleTrayCmdFile(): void {
  try {
    const file = trayCmdPath();
    if (!fs.existsSync(file)) return;
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as {
      cmd?: string;
      id?: string;
      patch?: Partial<SharedSettings>;
    };
    if (parsed.cmd === 'open-settings') {
      openSettingsWindow();
    } else if (parsed.cmd === 'publish-settings') {
      applyRunnerSettings(reloadPrefsFromDisk());
    } else if (parsed.cmd === 'pull-settings' && typeof parsed.id === 'string') {
      const settings = reloadPrefsFromDisk();
      const replyFile = trayCmdReplyPath();
      fs.mkdirSync(path.dirname(replyFile), { recursive: true });
      fs.writeFileSync(replyFile, JSON.stringify({ id: parsed.id, settings }), 'utf8');
      diagLog('tray', 'cmd.pull-settings', {
        id: parsed.id,
        screenshotHotkey: settings.screenshotHotkey,
        activateHotkey: settings.activateHotkey,
      });
    } else if (
      parsed.cmd === 'patch-settings' &&
      parsed.patch &&
      typeof parsed.patch === 'object'
    ) {
      applySettingsPatch(parsed.patch);
    }
    fs.unlinkSync(file);
  } catch {
    /* ignore */
  }
}

function onSharedSettingsChanged(): void {
  reloadPrefsFromDisk();
  registerAllShortcuts();
  updateTrayMenu();
  pushSettingsToWindow(settingsWin);
  publishSettings();
}

function watchTrayCmd(): void {
  const file = trayCmdPath();
  const dir = path.dirname(file);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  handleTrayCmdFile();
  try {
    cmdWatcher?.close();
    cmdWatcher = fs.watch(dir, (_event, name) => {
      if (!name || name === 'tray-cmd.json') handleTrayCmdFile();
    });
  } catch {
    /* ignore */
  }
}

function registerIpc() {
  ipcMain.handle('tray:get-settings', () => {
    const settings = reloadPrefsFromDisk();
    diagLog('tray', 'ipc.get-settings', {
      screenshotHotkey: settings.screenshotHotkey,
      activateHotkey: settings.activateHotkey,
      profile: pkgRunnerProfileName(),
      settingsPath: sharedSettingsPath(),
    });
    return settings;
  });
  ipcMain.handle('tray:get-profile', () => profileInfo());
  ipcMain.handle('tray:set-settings', (_e, patch: Partial<SharedSettings>) => {
    diagLog('tray', 'ipc.set-settings', { patch });
    return applySettingsPatch(patch && typeof patch === 'object' ? patch : {});
  });
  ipcMain.handle('tray:diag-log', (_e, event: string, detail?: unknown) => {
    diagLog('settings-ui', event, detail);
  });
  ipcMain.handle('tray:open-diag-log', async () => {
    const file = diagLogPath();
    diagLog('tray', 'ipc.open-diag-log', { file });
    if (!fs.existsSync(file)) {
      diagLog('tray', 'ipc.open-diag-log', { created: true });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '', 'utf8');
    }
    await shell.openPath(file);
    return file;
  });
  ipcMain.handle('tray:get-diag-tail', (_e, maxLines?: number) =>
    readDiagTail(typeof maxLines === 'number' ? maxLines : 60),
  );
  ipcMain.handle('tray:hotkeys-suspend', () => {
    suspendHotkeys();
  });
  ipcMain.handle('tray:hotkeys-resume', () => resumeHotkeys());
  ipcMain.handle('tray:window-close', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    win?.close();
  });
  ipcMain.handle('tray:show-runner', () => {
    ensureCompositorKeepalive();
    showRunnerWindow();
    return { ok: true as const };
  });
  ipcMain.handle('tray:show-editor', () => {
    showEditorWindow();
    return { ok: true as const };
  });
  ipcMain.handle('pkg:open-ss-history-dir', () => openScreenshotHistoryDir());

  registerScreenshotIpc({
    onHistoryChanged: () => {
      sendTo(historyWin, 'pkg:ss-history', true);
    },
    onCompleteLog: () => {
      /* tray has no runner log sink */
    },
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

if (gotLock) {
  app.on('second-instance', (_e, argv) => {
    if (argv.some((a) => a === '--open-settings' || a.startsWith('--open-settings'))) {
      openSettingsWindow();
      return;
    }
    toggleRunnerWindow();
  });

  app.whenReady().then(async () => {
    appReady = true;
    if (app.isPackaged) {
      if (!process.env.PKG_RUNNER_APP_DIR?.trim()) {
        process.env.PKG_RUNNER_APP_DIR = path.join(process.resourcesPath, 'runner');
      }
      if (!process.env.PKG_EDITOR_APP_DIR?.trim()) {
        process.env.PKG_EDITOR_APP_DIR = path.join(
          process.resourcesPath,
          'code-editor',
        );
      }
    }
    const t0 = Date.now();
    diagLog('tray', 'app.ready', { prefsPath: sharedSettingsPath() });
    prefs = loadPrefs();
    syncBrandEnvFromPrefs();
    trimScreenshotHistory(prefs.screenshotHistoryLimit);
    registerIpc();
    // 先挂托盘 + 热键，再起宿主，避免等 UI/控制面才「活过来」
    createTray();
    registerAllShortcuts();
    ensureAppShortcutsOnPackagedLaunch();
    // compositor keepalive 推迟到首次开 Runner（避免启动多一扇 Chromium 窗掉帧）
    diagLog('tray', 'ui.tray-ready', { ms: Date.now() - t0 });

    await startRunnerHost({
      mode: 'embedded',
      getSharedSettings: () => settingsFromPrefs(prefs),
    });
    await startEditorHost({ mode: 'embedded' });
    // 默认不预热 BrowserWindow：Chromium 冷启动 + Vite 会抢 CPU/磁盘卡主机
    // 需要预热：PKG_RUNNER_WARM=1（错峰单路，不叠三窗）
    publishSettings();
    watchTrayCmd();
    stopSharedWatch = watchSharedSettings(onSharedSettingsChanged);
    diagLog('tray', 'hosts.ready', { ms: Date.now() - t0 });

    const wantWarm =
      process.env.PKG_RUNNER_WARM === '1' ||
      process.env.PKG_RUNNER_WARM === 'true';
    if (wantWarm) {
      scheduleIdleWarms();
    } else {
      diagLog('tray', 'warm.skip', { reason: 'default-no-warm-keep-host-calm' });
    }

    if (process.argv.some((a) => a === '--open-settings')) {
      openSettingsWindow();
    } else if (pendingOpenSettings) {
      pendingOpenSettings = false;
      openSettingsWindow();
    }
  });

  app.on('window-all-closed', () => {
    /* tray stays */
  });

  app.on('before-quit', () => {
    if (isQuitting) {
      stopTrayWatchers();
      destroyScreenshotSession();
      destroyAuxWindows();
      destroyCompositorKeepalive();
      shutdownRunnerHost();
      shutdownEditorHost();
      return;
    }
    isQuitting = true;
    diagLog('tray', 'app.quit');
    try {
      globalShortcut.unregisterAll();
    } catch {
      /* ignore */
    }
    try {
      tray?.destroy();
    } catch {
      /* ignore */
    }
    tray = null;
    stopTrayWatchers();
    destroyAuxWindows();
    destroyScreenshotSession();
    destroyCompositorKeepalive();
    shutdownRunnerHost();
    shutdownEditorHost();
  });

  app.on('will-quit', (e) => {
    // 托盘应用即使窗已关，HTTP/fs.watch 等也可能拖住事件循环 → 强制 exit
    e.preventDefault();
    forceQuitProcess();
  });
}
