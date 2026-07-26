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
  normalizeFontId,
  trayCmdPath,
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
import { killChildren, launchChild } from './childLauncher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const TRAY_ICON = path.join(APP_ROOT, 'assets', 'tray.png');

app.setName('pkg-runner-tray');
if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'pkg-runner-tray'));
}

registerScreenshotScheme();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let prefs: SharedPrefs = loadPrefs();
let tray: Tray | null = null;
let settingsWin: BrowserWindow | null = null;
let historyWin: BrowserWindow | null = null;
let registeredScreenshotHotkey = '';
let registeredActivateHotkey = '';
let hotkeysSuspended = false;
let isQuitting = false;
let cmdWatcher: fs.FSWatcher | null = null;

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
  self: 'screenshot' | 'activate',
): string | null {
  if (!accel) return null;
  const s = (prefs.screenshotHotkey || '').trim();
  const a = (prefs.activateHotkey || '').trim();
  if (self !== 'screenshot' && accel === s) return '与截屏热键冲突';
  if (self !== 'activate' && accel === a) return '与显示 Runner 热键冲突';
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
  const ok = globalShortcut.register(next, () => launchChild('runner'));
  if (!ok) return { ok: false, error: '热键已被占用或无效' };
  registeredActivateHotkey = next;
  return { ok: true, error: null as string | null };
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
  const act = registerActivateShortcut();
  return {
    ok: shot.ok && act.ok,
    screenshotError: shot.error,
    activateError: act.error,
  };
}

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
  try {
    return await startScreenshotSession({
      appRoot: APP_ROOT,
      preloadPath: path.join(__dirname, 'screenshot-preload.js'),
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

  if (typeof patch.screenshotHotkey === 'string') {
    prefs.screenshotHotkey = normalizeHotkey(patch.screenshotHotkey);
  }
  if (typeof patch.activateHotkey === 'string') {
    prefs.activateHotkey = normalizeHotkey(patch.activateHotkey);
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
  if (patch.theme != null) prefs.theme = normalizeTheme(patch.theme);
  if (patch.shellMosaicCols != null) {
    prefs.shellMosaicCols = normalizeShellMosaicCols(patch.shellMosaicCols);
  }
  if (patch.shellLayout != null) {
    prefs.shellLayout = normalizeShellLayout(patch.shellLayout);
  }
  if (typeof patch.alwaysOnTop === 'boolean') prefs.alwaysOnTop = patch.alwaysOnTop;
  if (typeof patch.persistLogs === 'boolean') prefs.persistLogs = patch.persistLogs;

  savePrefs(prefs);
  const res = registerAllShortcuts();
  if (!res.ok) {
    prefs.screenshotHotkey = prevShot;
    prefs.activateHotkey = prevAct;
    savePrefs(prefs);
    registerAllShortcuts();
    hotkeyError = res.screenshotError || res.activateError || '热键注册失败';
  }
  updateTrayMenu();
  return { settings: settingsFromPrefs(prefs), hotkeyError };
}

function panelPreload(): string {
  return path.join(__dirname, 'preload.js');
}

function openSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 480,
    height: 640,
    title: '设置',
    autoHideMenuBar: true,
    webPreferences: {
      preload: panelPreload(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  void settingsWin.loadFile(path.join(APP_ROOT, 'ui', 'settings.html'));
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
    autoHideMenuBar: true,
    webPreferences: {
      preload: panelPreload(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  void historyWin.loadFile(path.join(APP_ROOT, 'ui', 'history.html'));
  historyWin.on('closed', () => {
    historyWin = null;
  });
}

function updateTrayMenu() {
  if (!tray) return;
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '设置…',
      click: () => openSettingsWindow(),
    },
    { type: 'separator' },
    {
      label: '打开 Runner',
      click: () => launchChild('runner'),
    },
    {
      label: '打开编辑器',
      click: () => launchChild('editor'),
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
      label: '退出',
      click: () => {
        isQuitting = true;
        killChildren();
        app.quit();
      },
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
  tray.setToolTip('Pkg Runner');
  updateTrayMenu();
  tray.on('click', () => openSettingsWindow());
  tray.on('double-click', () => launchChild('runner'));
}

function handleTrayCmdFile(): void {
  try {
    const file = trayCmdPath();
    if (!fs.existsSync(file)) return;
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as { cmd?: string };
    if (parsed.cmd === 'open-settings') openSettingsWindow();
    fs.unlinkSync(file);
  } catch {
    /* ignore */
  }
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
  ipcMain.handle('tray:get-settings', () => settingsFromPrefs(prefs));
  ipcMain.handle('tray:set-settings', (_e, patch: Partial<SharedSettings>) => {
    return applySettingsPatch(patch && typeof patch === 'object' ? patch : {});
  });
  ipcMain.handle('tray:hotkeys-suspend', () => {
    suspendHotkeys();
  });
  ipcMain.handle('tray:hotkeys-resume', () => resumeHotkeys());
  ipcMain.handle('tray:window-close', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    win?.close();
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
    openSettingsWindow();
  });

  app.whenReady().then(() => {
    prefs = loadPrefs();
    trimScreenshotHistory(prefs.screenshotHistoryLimit);
    registerIpc();
    createTray();
    registerAllShortcuts();
    watchTrayCmd();
    warmScreenshotWindow({
      appRoot: APP_ROOT,
      preloadPath: path.join(__dirname, 'screenshot-preload.js'),
    });
    if (process.argv.some((a) => a === '--open-settings')) {
      openSettingsWindow();
    }
  });

  app.on('window-all-closed', () => {
    /* tray stays */
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    cmdWatcher?.close();
  });

  app.on('before-quit', () => {
    isQuitting = true;
    destroyScreenshotSession();
    if (isQuitting) killChildren();
  });
}
