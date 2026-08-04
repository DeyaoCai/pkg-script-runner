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
  attachMaximizedEvents,
  framelessWindowOptions,
  registerWindowIpc,
} from '@pkg-runner/shell/main';
import {
  loadPrefs,
  savePrefs,
  settingsFromPrefs,
  formatHotkeyLabel,
  normalizeScreenshotHistoryLimit,
  normalizeScreenshotDrawColor,
  normalizeHotkey,
  normalizeGlassAlpha,
  normalizeGlassBlur,
  normalizeShellMosaicCols,
  normalizeShellLayout,
  normalizeTheme,
  normalizeBrandColor,
  brandColorForTone,
  normalizeFontId,
  normalizeAppBackground,
  trayCmdPath,
  trayCmdReplyPath,
  watchSharedSettings,
  sharedSettingsPath,
  type SharedPrefs,
  type SharedSettings,
} from './prefs.js';
import {
  listWallpapers,
  openWallpapersFolder,
  registerWallpaperProtocol,
  setDesktopWallpaper,
  wallpapersDir,
} from '@pkg-runner/wallpaper';
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
  applyEditorSettings,
  showEditorWindow,
  shutdownEditorHost,
  startEditorHost,
  toggleEditorWindow,
  warmEditorWindow,
} from '../../code-editor/src/main/editorHost.js';
import {
  applyZonesSettings,
  registerJimengMediaScheme,
  showZonesWindow,
  shutdownZonesHost,
  startZonesHost,
  toggleZonesWindow,
} from '../../desktop-zones/src/zonesHost.js';
import {
  applyRunnerSettings,
  showRunnerWindow,
  shutdownRunnerHost,
  startRunnerHost,
  toggleRunnerWindow,
  warmRunnerWindow,
} from '../../runner/src/runnerHost.js';
import { diagLog, diagLogPath, readDiagTail } from './diagLog.js';
import { loadUiSession, patchUiSession } from './uiSession.js';
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
import { resolveEnvAssetPath } from '@pkg-runner/assets';

function toggleEditor(): void {
  toggleEditorWindow();
}

function toggleZones(): void {
  toggleZonesWindow();
}

function toggleRunner(): void {
  // 首次开 Runner 再挂 DWM keepalive，避免启动期多一扇窗抢合成
  ensureCompositorKeepalive();
  toggleRunnerWindow();
}

function toggleBrowserWindow(
  get: () => BrowserWindow | null,
  open: () => void,
): void {
  const win = get();
  if (!win || win.isDestroyed()) {
    open();
    return;
  }
  if (win.isVisible() && !win.isMinimized()) {
    win.hide();
  } else {
    win.show();
    win.focus();
  }
}

function toggleSettings(): void {
  toggleBrowserWindow(() => settingsWin, openSettingsWindow);
}

function toggleHistory(): void {
  toggleBrowserWindow(() => historyWin, openHistoryWindow);
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
  return resolveEnvAssetPath('icon', activeBrandTone());
}

function resolveTrayIconPath(): string {
  // Win 托盘缩到 16px：用较大的 icon-* 比 tray-* 更易辨认正式/测试
  const kind = process.platform === 'win32' ? 'icon' : 'tray';
  const p = resolveEnvAssetPath(kind, activeBrandTone());
  if (activeBrandTone() === 'test' && !/-test\.png$/i.test(path.basename(p))) {
    diagLog('tray', 'icon.missing-test', { kind, path: p });
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

// 尽早设置，避免 runnerHost / editorHost / zonesHost 解析不到 resources 下的 UI
if (app.isPackaged) {
  if (!process.env.PKG_RUNNER_APP_DIR?.trim()) {
    process.env.PKG_RUNNER_APP_DIR = path.join(process.resourcesPath, 'runner');
  }
  if (!process.env.PKG_EDITOR_APP_DIR?.trim()) {
    process.env.PKG_EDITOR_APP_DIR = path.join(process.resourcesPath, 'code-editor');
  }
  if (!process.env.PKG_ZONES_APP_DIR?.trim()) {
    process.env.PKG_ZONES_APP_DIR = path.join(
      process.resourcesPath,
      'desktop-zones',
    );
  }
}

registerScreenshotScheme();
registerJimengMediaScheme();

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
let settingsWinDetachMax: (() => void) | null = null;
let settingsWindowIpcRegistered = false;
type WindowHotkeyId =
  | 'screenshot'
  | 'activate'
  | 'editor'
  | 'zones'
  | 'settings'
  | 'history';

const registeredHotkeys: Record<WindowHotkeyId, string> = {
  screenshot: '',
  activate: '',
  editor: '',
  zones: '',
  settings: '',
  history: '',
};
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
    zonesHotkey: settings.zonesHotkey,
    settingsHotkey: settings.settingsHotkey,
    historyHotkey: settings.historyHotkey,
  });
  applyRunnerSettings(settings);
  applyEditorSettings(settings);
  applyZonesSettings(settings);
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

const HOTKEY_LABELS: Record<WindowHotkeyId, string> = {
  screenshot: '截屏',
  activate: '显示/关闭 Runner',
  editor: '显示/关闭 编辑器',
  zones: '显示/关闭 桌面整理',
  settings: '显示/关闭 设置',
  history: '显示/关闭 截屏历史',
};

function hotkeyAccelFor(id: WindowHotkeyId): string {
  switch (id) {
    case 'screenshot':
      return (prefs.screenshotHotkey || '').trim();
    case 'activate':
      return (prefs.activateHotkey || '').trim();
    case 'editor':
      return (prefs.editorHotkey || '').trim();
    case 'zones':
      return (prefs.zonesHotkey || '').trim();
    case 'settings':
      return (prefs.settingsHotkey || '').trim();
    case 'history':
      return (prefs.historyHotkey || '').trim();
  }
}

function hotkeyAction(id: WindowHotkeyId): () => void {
  switch (id) {
    case 'screenshot':
      return () => {
        void beginScreenshot();
      };
    case 'activate':
      return () => toggleRunner();
    case 'editor':
      return () => toggleEditor();
    case 'zones':
      return () => toggleZones();
    case 'settings':
      return () => toggleSettings();
    case 'history':
      return () => toggleHistory();
  }
}

function hotkeyConflict(accel: string, self: WindowHotkeyId): string | null {
  if (!accel) return null;
  for (const id of Object.keys(HOTKEY_LABELS) as WindowHotkeyId[]) {
    if (id === self) continue;
    if (accel === hotkeyAccelFor(id)) return `与「${HOTKEY_LABELS[id]}」热键冲突`;
  }
  return null;
}

function registerOneShortcut(id: WindowHotkeyId): { ok: boolean; error: string | null } {
  unregisterAccel(registeredHotkeys[id]);
  registeredHotkeys[id] = '';
  const next = hotkeyAccelFor(id);
  if (!next) return { ok: true, error: null };
  const conflict = hotkeyConflict(next, id);
  if (conflict) return { ok: false, error: conflict };
  const ok = globalShortcut.register(next, hotkeyAction(id));
  if (!ok) return { ok: false, error: '热键已被占用或无效' };
  registeredHotkeys[id] = next;
  return { ok: true, error: null };
}

function clearRegisteredShortcuts() {
  for (const id of Object.keys(registeredHotkeys) as WindowHotkeyId[]) {
    unregisterAccel(registeredHotkeys[id]);
    registeredHotkeys[id] = '';
  }
  try {
    globalShortcut.unregisterAll();
  } catch {
    /* ignore */
  }
}

function registerAllShortcuts() {
  if (hotkeysSuspended || !prefs.hotkeysEnabled) {
    clearRegisteredShortcuts();
    return { ok: true, error: null as string | null };
  }
  let ok = true;
  let error: string | null = null;
  for (const id of Object.keys(HOTKEY_LABELS) as WindowHotkeyId[]) {
    const res = registerOneShortcut(id);
    if (!res.ok) {
      ok = false;
      error = error || `${HOTKEY_LABELS[id]}：${res.error}`;
    }
  }
  return { ok, error };
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
  const prevHotkeys = {
    screenshotHotkey: prefs.screenshotHotkey,
    activateHotkey: prefs.activateHotkey,
    editorHotkey: prefs.editorHotkey,
    zonesHotkey: prefs.zonesHotkey,
    settingsHotkey: prefs.settingsHotkey,
    historyHotkey: prefs.historyHotkey,
  };

  if (typeof patch.screenshotHotkey === 'string') {
    prefs.screenshotHotkey = normalizeHotkey(patch.screenshotHotkey);
  }
  if (typeof patch.activateHotkey === 'string') {
    prefs.activateHotkey = normalizeHotkey(patch.activateHotkey);
  }
  if (typeof patch.editorHotkey === 'string') {
    prefs.editorHotkey = normalizeHotkey(patch.editorHotkey);
  }
  if (typeof patch.zonesHotkey === 'string') {
    prefs.zonesHotkey = normalizeHotkey(patch.zonesHotkey);
  }
  if (typeof patch.settingsHotkey === 'string') {
    prefs.settingsHotkey = normalizeHotkey(patch.settingsHotkey);
  }
  if (typeof patch.historyHotkey === 'string') {
    prefs.historyHotkey = normalizeHotkey(patch.historyHotkey);
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
  if (patch.glassBlur != null) prefs.glassBlur = normalizeGlassBlur(patch.glassBlur);
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
  if ('appBackground' in patch) {
    prefs.appBackground = normalizeAppBackground(patch.appBackground);
  }

  savePrefs(prefs);
  const res = registerAllShortcuts();
  if (!res.ok) {
    prefs.screenshotHotkey = prevHotkeys.screenshotHotkey;
    prefs.activateHotkey = prevHotkeys.activateHotkey;
    prefs.editorHotkey = prevHotkeys.editorHotkey;
    prefs.zonesHotkey = prevHotkeys.zonesHotkey;
    prefs.settingsHotkey = prevHotkeys.settingsHotkey;
    prefs.historyHotkey = prevHotkeys.historyHotkey;
    savePrefs(prefs);
    registerAllShortcuts();
    hotkeyError = res.error || '热键注册失败';
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

/** Vue MPA from @pkg-runner/tray-ui → dist-ui/; dev: PKG_TRAY_UI_URL=http://127.0.0.1:5202 */
function loadTrayPanelPage(
  win: BrowserWindow,
  page: 'settings' | 'history',
  query?: Record<string, string>,
): void {
  const base = process.env.PKG_TRAY_UI_URL?.trim();
  if (base) {
    const root = base.endsWith('/') ? base : `${base}/`;
    const u = new URL(`${page}.html`, root);
    if (query) {
      for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    }
    void win.loadURL(u.toString());
    return;
  }
  const file = path.join(APP_ROOT, 'dist-ui', `${page}.html`);
  if (!fs.existsSync(file)) {
    diagLog('tray', 'panel.ui-missing', { file, page });
    console.error(
      `[tray] missing ${file} — run: pnpm --filter @pkg-runner/tray-ui build`,
    );
  }
  void win.loadFile(file, query ? { query } : undefined);
}

/** Avoid colliding with editor/zones `window:*` handlers in this process. */
const SETTINGS_WINDOW_CHANNELS = {
  minimize: 'tray-settings:window-minimize',
  maximize: 'tray-settings:window-maximize',
  close: 'tray-settings:window-close',
  isMaximized: 'tray-settings:window-isMaximized',
  maximizedChanged: 'tray-settings:window-maximized-changed',
} as const;

function ensureSettingsWindowIpc(): void {
  if (settingsWindowIpcRegistered) return;
  settingsWindowIpcRegistered = true;
  registerWindowIpc({
    getWindow: () => settingsWin,
    channels: SETTINGS_WINDOW_CHANNELS,
    onClose: (win) => {
      win.close();
    },
  });
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
  ensureSettingsWindowIpc();
  settingsWin = new BrowserWindow(
    framelessWindowOptions({
      width: 520,
      height: 720,
      minWidth: 420,
      minHeight: 480,
      title: `设置 · ${envLabel}`,
      icon: appIcon,
      backgroundColor: chromeBg,
      webPreferences: panelWebPreferences(),
    }),
  );
  settingsWinDetachMax?.();
  settingsWinDetachMax = attachMaximizedEvents(
    settingsWin,
    SETTINGS_WINDOW_CHANNELS.maximizedChanged,
  );
  settingsWin.webContents.on('preload-error', (_e, preloadPath, error) => {
    console.error('[tray] settings preload-error', preloadPath, error);
    diagLog('tray', 'settings.preload-error', {
      preloadPath,
      error: error instanceof Error ? error.message : String(error),
    });
  });
  settingsWin.once('ready-to-show', () => {
    if (!settingsWin || settingsWin.isDestroyed()) return;
    settingsWin.show();
    settingsWin.focus();
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
  loadTrayPanelPage(settingsWin, 'settings', {
    env: activeBrandTone() === 'test' ? 'test' : 'prod',
  });
  settingsWin.on('closed', () => {
    settingsWinDetachMax?.();
    settingsWinDetachMax = null;
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
  loadTrayPanelPage(historyWin, 'history');
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
    {
      label: '显示/隐藏桌面整理',
      click: () => toggleZones(),
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
      reloadPrefsFromDisk();
      publishSettings();
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
  ipcMain.handle('tray:list-wallpapers', () => listWallpapers());
  ipcMain.handle('tray:set-desktop-wallpaper', (_e, filePath: string) =>
    setDesktopWallpaper(String(filePath)),
  );
  ipcMain.handle('tray:open-wallpapers-folder', () => {
    openWallpapersFolder();
    return { ok: true as const, dir: wallpapersDir() };
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
  ipcMain.handle('tray:show-zones', () => {
    showZonesWindow();
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
      if (!process.env.PKG_ZONES_APP_DIR?.trim()) {
        process.env.PKG_ZONES_APP_DIR = path.join(
          process.resourcesPath,
          'desktop-zones',
        );
      }
      if (!process.env.PKG_WALLPAPERS?.trim()) {
        process.env.PKG_WALLPAPERS = path.join(process.resourcesPath, 'wallpapers');
      }
      if (!process.env.PKG_JIMENG_WALLPAPERS?.trim()) {
        process.env.PKG_JIMENG_WALLPAPERS = path.join(process.resourcesPath, 'jimeng');
      }
    } else if (!process.env.PKG_WALLPAPERS?.trim()) {
      process.env.PKG_WALLPAPERS = path.resolve(
        __dirname,
        '..',
        '..',
        '..',
        'packages',
        'wallpaper',
        'wallpapers',
      );
      if (!process.env.PKG_JIMENG_WALLPAPERS?.trim()) {
        process.env.PKG_JIMENG_WALLPAPERS = path.resolve(
          __dirname,
          '..',
          '..',
          '..',
          'packages',
          'wallpaper',
          'jimeng',
        );
      }
    }
    if (!process.env.PKG_JIMENG_WALLPAPERS?.trim() && process.env.PKG_WALLPAPERS?.trim()) {
      process.env.PKG_JIMENG_WALLPAPERS = path.join(
        path.dirname(process.env.PKG_WALLPAPERS),
        'jimeng',
      );
    }
    const t0 = Date.now();
    diagLog('tray', 'app.ready', { prefsPath: sharedSettingsPath() });
    prefs = loadPrefs();
    // migrate zones-local wallpaper pref → shared
    if (!prefs.appBackground) {
      try {
        const legacy = path.join(app.getPath('userData'), 'zones-wallpaper.json');
        if (fs.existsSync(legacy)) {
          const raw = JSON.parse(fs.readFileSync(legacy, 'utf8')) as {
            appBackground?: unknown;
          };
          const name = normalizeAppBackground(raw.appBackground);
          if (name) {
            prefs.appBackground = name;
            savePrefs(prefs);
            diagLog('tray', 'wallpaper.migrate', { name });
          }
        }
      } catch {
        /* ignore */
      }
    }
    syncBrandEnvFromPrefs();
    trimScreenshotHistory(prefs.screenshotHistoryLimit);
    registerWallpaperProtocol();
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
      onVisibilityChange: (visible) => patchUiSession({ runner: visible }),
    });
    await startEditorHost({
      mode: 'embedded',
      getSharedSettings: () => settingsFromPrefs(prefs),
      onVisibilityChange: (visible) => patchUiSession({ editor: visible }),
    });
    await startZonesHost({
      mode: 'embedded',
      getSharedSettings: () => settingsFromPrefs(prefs),
      onVisibilityChange: (visible) => patchUiSession({ zones: visible }),
      patchSharedSettings: (patch) => {
        applySettingsPatch(patch);
      },
    });
    // 默认不预热 BrowserWindow：Chromium 冷启动 + Vite 会抢 CPU/磁盘卡主机
    // 需要预热：PKG_RUNNER_WARM=1（错峰单路，不叠三窗）
    publishSettings();
    watchTrayCmd();
    stopSharedWatch = watchSharedSettings(onSharedSettingsChanged);
    diagLog('tray', 'hosts.ready', { ms: Date.now() - t0 });

    const session = loadUiSession();
    if (session.runner || session.editor || session.zones) {
      diagLog('tray', 'ui.session.restore', session);
      if (session.runner) {
        ensureCompositorKeepalive();
        showRunnerWindow();
      }
      if (session.editor) showEditorWindow();
      if (session.zones) showZonesWindow();
    }

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
      shutdownZonesHost();
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
    shutdownZonesHost();
  });

  app.on('will-quit', (e) => {
    // 托盘应用即使窗已关，HTTP/fs.watch 等也可能拖住事件循环 → 强制 exit
    e.preventDefault();
    forceQuitProcess();
  });
}
