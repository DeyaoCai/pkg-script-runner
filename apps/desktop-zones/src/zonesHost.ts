/**
 * Desktop Zones host — standalone or embedded in tray (same Electron process).
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import { resolveEnvAssetPath } from '@pkg-runner/assets';
import {
  attachMaximizedEvents,
  framelessWindowOptions,
  registerWindowIpc,
} from '@pkg-runner/shell/main';
import { chromeBackground, type BrandTone } from '@pkg-runner/tokens';
import {
  applyOrganize,
  openDesktopFolder,
  previewOrganize,
  renameItem,
  setUndoLogPath,
  trashItem,
  undoAvailable,
  undoLast,
  type MoveOp,
} from './fileOps.js';
import {
  coerceSharedSettings,
  defaultSharedSettings,
  readSharedSettingsFromDisk,
  type SharedSettings,
} from './sharedUi.js';
import { openPath, revealInFolder, scanDesktopZones } from './zones.js';

export type ZonesHostMode = 'standalone' | 'embedded';

export type ZonesHostOptions = {
  mode?: ZonesHostMode;
  startHidden?: boolean;
  /** Tray injects live shared-settings (theme / brandColor / glass / font). */
  getSharedSettings?: () => unknown;
};

const __dirnameHost = path.dirname(fileURLToPath(import.meta.url));

/** Avoid colliding with editor/runner `window:*` handlers in the tray process. */
const ZONES_WINDOW_CHANNELS = {
  minimize: 'zones:window-minimize',
  maximize: 'zones:window-maximize',
  close: 'zones:window-close',
  isMaximized: 'zones:window-isMaximized',
  maximizedChanged: 'zones:window-maximized-changed',
} as const;

function zonesAppRoot(): string {
  const fromEnv = process.env.PKG_ZONES_APP_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);

  const fromSrc = path.resolve(__dirnameHost, '..');
  if (fs.existsSync(path.join(fromSrc, 'package.json'))) return fromSrc;

  const fromTrayDist = path.resolve(__dirnameHost, '..', '..', 'desktop-zones');
  if (fs.existsSync(path.join(fromTrayDist, 'dist', 'renderer', 'index.html'))) {
    return fromTrayDist;
  }

  return fromSrc;
}

function zonesPreloadPath(): string {
  const embeddedCjs = path.join(__dirnameHost, 'zones', 'preload.cjs');
  if (fs.existsSync(embeddedCjs)) return embeddedCjs;
  const nextCjs = path.join(__dirnameHost, 'preload.cjs');
  if (fs.existsSync(nextCjs)) return nextCjs;
  const nextJs = path.join(__dirnameHost, 'preload.js');
  if (fs.existsSync(nextJs)) return nextJs;
  console.error('[zones] missing preload', { embeddedCjs, nextCjs });
  return embeddedCjs;
}

function uiIndex(): string {
  return path.join(zonesAppRoot(), 'dist', 'renderer', 'index.html');
}

let hostMode: ZonesHostMode = 'standalone';
let mainWindow: BrowserWindow | null = null;
let ipcRegistered = false;
let startHidden = false;
let softHidden = false;
let detachMaximized: (() => void) | null = null;
let sharedUi: SharedSettings = defaultSharedSettings();
let getSharedSettingsFn: (() => unknown) | null = null;

function colorEnv(): BrandTone {
  return process.env.PKG_RUNNER_COLOR_ENV?.trim().toLowerCase() === 'test'
    ? 'test'
    : 'prod';
}

function windowBackgroundForTheme(theme: 'dark' | 'light'): string {
  return chromeBackground(colorEnv(), theme);
}

function pushSharedUiToRenderer(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('zones:shared-settings', sharedUi);
}

/** Apply tray / disk shared settings (theme · brandColor · glass · font). */
export function applyZonesSettings(raw: unknown): void {
  const next = coerceSharedSettings(raw);
  if (!next) return;
  const themeChanged = next.theme !== sharedUi.theme;
  sharedUi = next;
  if (themeChanged && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(windowBackgroundForTheme(sharedUi.theme));
  }
  pushSharedUiToRenderer();
}

function resolveInitialSharedUi(): SharedSettings {
  if (getSharedSettingsFn) {
    const next = coerceSharedSettings(getSharedSettingsFn());
    if (next) return next;
  }
  return readSharedSettingsFromDisk();
}

function isVisuallyOpen(): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (softHidden) return false;
  if (mainWindow.isMinimized()) return false;
  return mainWindow.isVisible();
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  softHidden = false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function hideWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  softHidden = true;
  mainWindow.hide();
}

function loadUi(win: BrowserWindow): void {
  const devUrl = process.env.PKG_ZONES_UI_URL?.trim();
  if (devUrl) {
    void win.loadURL(devUrl);
    return;
  }
  const html = uiIndex();
  if (!fs.existsSync(html)) {
    console.error('[zones] missing UI', html);
  }
  void win.loadFile(html);
}

function createWindow(): void {
  if (process.platform !== 'win32') {
    console.error('[zones] 仅支持 Windows');
    return;
  }

  const preload = zonesPreloadPath();
  const appIcon = resolveEnvAssetPath('icon', colorEnv());

  mainWindow = new BrowserWindow(
    framelessWindowOptions({
      width: 1100,
      height: 720,
      minWidth: 800,
      minHeight: 520,
      skipTaskbar: false,
      hasShadow: true,
      show: false,
      icon: appIcon,
      backgroundColor: windowBackgroundForTheme(sharedUi.theme),
      title: colorEnv() === 'test' ? 'Desktop Zones · 测试' : 'Desktop Zones',
      webPreferences: {
        preload,
      },
    }),
  );

  detachMaximized?.();
  detachMaximized = attachMaximizedEvents(
    mainWindow,
    ZONES_WINDOW_CHANNELS.maximizedChanged,
  );

  mainWindow.webContents.on('did-finish-load', () => {
    pushSharedUiToRenderer();
    setTimeout(pushSharedUiToRenderer, 120);
  });

  loadUi(mainWindow);

  mainWindow.once('ready-to-show', () => {
    if (startHidden) {
      softHidden = true;
      mainWindow?.hide();
      return;
    }
    showWindow();
  });

  mainWindow.on('closed', () => {
    detachMaximized?.();
    detachMaximized = null;
    mainWindow = null;
    softHidden = false;
  });
}

function registerIpc(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;

  setUndoLogPath(path.join(app.getPath('userData'), 'organize-undo.json'));

  ipcMain.handle('zones:scan', () => scanDesktopZones());
  ipcMain.handle('zones:open', (_e, filePath: string) => openPath(String(filePath)));
  ipcMain.handle('zones:reveal', (_e, filePath: string) => {
    revealInFolder(String(filePath));
    return { ok: true };
  });
  ipcMain.handle('organize:preview', () => previewOrganize());
  ipcMain.handle('organize:apply', (_e, ops: MoveOp[]) => {
    if (!Array.isArray(ops)) {
      return { ok: false, moved: 0, failed: [{ from: '', error: 'bad ops' }] };
    }
    return applyOrganize(ops);
  });
  ipcMain.handle('organize:undo', () => undoLast());
  ipcMain.handle('organize:undo-available', () => undoAvailable());
  ipcMain.handle('fs:rename', (_e, target: string, newName: string) =>
    renameItem(String(target), String(newName)),
  );
  ipcMain.handle('fs:trash', (_e, target: string) => trashItem(String(target)));
  ipcMain.handle('desktop:open-folder', () => {
    openDesktopFolder();
    return { ok: true };
  });
  ipcMain.handle('app:quit', () => {
    if (hostMode === 'embedded') {
      if (mainWindow && !mainWindow.isDestroyed()) {
        hideWindow();
      }
      return { ok: true };
    }
    app.quit();
    return { ok: true };
  });
  ipcMain.handle('zones:get-shared-settings', () => sharedUi);
  ipcMain.handle('zones:get-color-env', () => colorEnv());

  registerWindowIpc({
    getWindow: () => mainWindow,
    channels: ZONES_WINDOW_CHANNELS,
    onClose: (win) => {
      if (hostMode === 'embedded') {
        hideWindow();
        return;
      }
      win.close();
    },
  });
}

/** 始终显示（设置页「打开」等） */
export function showZonesWindow(): void {
  startHidden = false;
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  showWindow();
}

/** 显示 ↔ 隐藏 */
export function toggleZonesWindow(): void {
  startHidden = false;
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (isVisuallyOpen()) hideWindow();
  else showWindow();
}

export async function startZonesHost(opts: ZonesHostOptions = {}): Promise<void> {
  hostMode = opts.mode ?? 'standalone';
  startHidden = !!opts.startHidden;
  getSharedSettingsFn = opts.getSharedSettings ?? null;
  sharedUi = resolveInitialSharedUi();
  registerIpc();

  if (hostMode === 'standalone') {
    createWindow();
  } else if (startHidden) {
    createWindow();
  }
}

export function shutdownZonesHost(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.destroy();
    } catch {
      /* ignore */
    }
  }
  mainWindow = null;
}

export function registerZonesStandaloneLifecycle(): void {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    console.warn('[desktop-zones] 已有实例在运行，本进程退出');
    app.exit(0);
    return;
  }
  app.on('second-instance', () => {
    showZonesWindow();
  });
  app.whenReady().then(() => {
    void startZonesHost({ mode: 'standalone' });
  });
}
