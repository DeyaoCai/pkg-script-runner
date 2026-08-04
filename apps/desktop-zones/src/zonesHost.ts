/**
 * Desktop Zones host — standalone or embedded in tray (same Electron process).
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import { resolveEnvAssetPath } from '@pkg-runner/assets';
import {
  attachMaximizedEvents,
  attachWindowStateTracker,
  framelessWindowOptions,
  registerWindowIpc,
  resolveWindowCreateBounds,
} from '@pkg-runner/shell/main';
import { chromeBackground, type BrandTone } from '@pkg-runner/tokens';
import {
  appBackgroundUrl,
  listWallpapers,
  normalizeAppBackgroundName,
  openWallpapersFolder,
  registerWallpaperProtocol,
  setDesktopWallpaper,
} from '@pkg-runner/wallpaper';
import {
  moveIntoGroup,
  moveIntoDir,
  openDesktopFolder,
  renameItem,
  setUndoLogPath,
  trashItem,
  undoAvailable,
  undoLast,
} from './fileOps.js';
import {
  coerceSharedSettings,
  defaultSharedSettings,
  readSharedSettingsFromDisk,
  sharedSettingsPath,
  type SharedSettings,
} from './sharedUi.js';
import { listDirContents, isUnderAllowedRoots, openPath, revealInFolder, scanZones, setSystemDesktopResolver } from './zones.js';
import { registerZonesFileProtocol } from './zonesMedia.js';
import {
  addTrackedRel,
  createTrackedGroup,
  getZonesPrefs,
  removeTrackedRel,
  setCustomRoot,
  setZonesPrefsPath,
} from './zonesPrefs.js';
import {
  closeJimengWindow,
  getJimengLayout,
  hideJimengEmbedded,
  setJimengHostWindow,
  setJimengLayoutListener,
  showJimengEmbedded,
  type JimengLayout,
} from './jimengWindow.js';
import {
  downloadJimengFavorite,
  downloadJimengFavorites,
  readFavoritesCache,
  setJimengCacheListener,
  syncJimengFavorites,
  type JimengFavoriteItem,
} from './jimengFavorites.js';
import { shutdownJimengSseBridge } from './jimengSseBridge.js';
import { registerJimengCaptureIpc } from './jimengIntercept.js';
import {
  maskJimengItems,
  registerJimengMediaProtocol,
  registerJimengMediaScheme,
  registerJimengMediaUrls,
} from './jimengMedia.js';

export { registerJimengMediaScheme };

function jimengCacheForRenderer() {
  const cache = readFavoritesCache();
  registerJimengMediaUrls(cache.items);
  return {
    updatedAt: cache.updatedAt,
    items: maskJimengItems(cache.items),
  };
}

function pushJimengCacheToRenderer(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const cache = readFavoritesCache();
  registerJimengMediaUrls(cache.items);
  try {
    mainWindow.webContents.send('zones:jimeng-hub', {
      kind: 'snapshot',
      updatedAt: cache.updatedAt,
      items: maskJimengItems(cache.items),
    });
  } catch {
    /* ignore */
  }
}

export type ZonesHostMode = 'standalone' | 'embedded';

export type ZonesHostOptions = {
  mode?: ZonesHostMode;
  startHidden?: boolean;
  getSharedSettings?: () => unknown;
  onVisibilityChange?: (visible: boolean) => void;
  /** Tray: patch shared-settings (appBackground etc.) */
  patchSharedSettings?: (patch: Partial<SharedSettings>) => void;
};

const __dirnameHost = path.dirname(fileURLToPath(import.meta.url));

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
let detachWindowState: (() => void) | null = null;
let sharedUi: SharedSettings = defaultSharedSettings();
let getSharedSettingsFn: (() => unknown) | null = null;
let patchSharedSettingsFn: ((patch: Partial<SharedSettings>) => void) | null =
  null;
let onVisibilityChangeFn: ((visible: boolean) => void) | null = null;
let lastEmittedVisible: boolean | null = null;
let isQuitting = false;

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

function currentAppBackgroundName(): string | null {
  return normalizeAppBackgroundName(sharedUi.appBackground);
}

function applyAppBackgroundPatch(name: string | null): {
  ok: boolean;
  name: string | null;
  url: string | null;
  error?: string;
} {
  if (patchSharedSettingsFn) {
    patchSharedSettingsFn({ appBackground: name });
    sharedUi = { ...sharedUi, appBackground: name };
    return { ok: true, name, url: appBackgroundUrl(name) };
  }
  // standalone: persist into shared-settings.json
  sharedUi = { ...sharedUi, appBackground: name };
  try {
    const disk = readSharedSettingsFromDisk();
    fs.writeFileSync(
      sharedSettingsPath(),
      `${JSON.stringify({ ...disk, appBackground: name }, null, 2)}\n`,
      'utf8',
    );
  } catch (e) {
    return {
      ok: false,
      name: null,
      url: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  pushSharedUiToRenderer();
  return { ok: true, name, url: appBackgroundUrl(name) };
}

function isVisuallyOpen(): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (softHidden) return false;
  if (mainWindow.isMinimized()) return false;
  return mainWindow.isVisible();
}

function emitVisibility(): void {
  const visible = isVisuallyOpen();
  if (lastEmittedVisible === visible) return;
  lastEmittedVisible = visible;
  onVisibilityChangeFn?.(visible);
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  softHidden = false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  emitVisibility();
}

function hideWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  softHidden = true;
  mainWindow.hide();
  emitVisibility();
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

function zonesWindowStatePath(): string {
  return path.join(app.getPath('userData'), 'zones-window.json');
}

function createWindow(): void {
  if (process.platform !== 'win32') {
    console.error('[zones] 仅支持 Windows');
    return;
  }

  const preload = zonesPreloadPath();
  const appIcon = resolveEnvAssetPath('icon', colorEnv());
  const minWidth = 800;
  const minHeight = 520;
  const bounds = resolveWindowCreateBounds(zonesWindowStatePath(), {
    width: 1440,
    height: 820,
    minWidth,
    minHeight,
  });

  mainWindow = new BrowserWindow(
    framelessWindowOptions({
      width: bounds.width,
      height: bounds.height,
      ...(typeof bounds.x === 'number' && typeof bounds.y === 'number'
        ? { x: bounds.x, y: bounds.y }
        : {}),
      minWidth,
      minHeight,
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

  detachWindowState?.();
  detachWindowState = attachWindowStateTracker(mainWindow, {
    filePath: zonesWindowStatePath(),
    minWidth,
    minHeight,
    shouldSkipSave: () => softHidden,
  });

  mainWindow.webContents.on('did-finish-load', () => {
    pushSharedUiToRenderer();
    setTimeout(pushSharedUiToRenderer, 120);
  });

  loadUi(mainWindow);

  mainWindow.once('ready-to-show', () => {
    if (bounds.isMaximized && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.maximize();
    }
    if (startHidden) {
      softHidden = true;
      mainWindow?.hide();
      emitVisibility();
      return;
    }
    showWindow();
  });

  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    if (hostMode === 'embedded') {
      e.preventDefault();
      hideWindow();
    }
  });

  mainWindow.on('closed', () => {
    closeJimengWindow();
    detachMaximized?.();
    detachMaximized = null;
    detachWindowState?.();
    detachWindowState = null;
    mainWindow = null;
    softHidden = false;
    emitVisibility();
  });
}

function pushJimengLayout(layout?: JimengLayout): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send('zones:jimeng-layout', layout ?? getJimengLayout());
  } catch {
    /* ignore */
  }
}

function registerIpc(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;

  setUndoLogPath(path.join(app.getPath('userData'), 'organize-undo.json'));
  setZonesPrefsPath(path.join(app.getPath('userData'), 'zones-prefs.json'));
  setSystemDesktopResolver(() => app.getPath('desktop'));

  ipcMain.handle('zones:scan', () => scanZones());
  ipcMain.handle('zones:list-dir', (_e, dirPath: string) => listDirContents(String(dirPath)));
  ipcMain.handle('zones:get-prefs', () => getZonesPrefs());
  ipcMain.handle('zones:set-custom-root', async () => {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    const opts: Electron.OpenDialogOptions = {
      title: '选择桌面目录',
      properties: ['openDirectory', 'createDirectory'],
    };
    const res = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    if (res.canceled || !res.filePaths[0]) {
      return { ok: false, cancelled: true, prefs: getZonesPrefs() };
    }
    try {
      const prefs = setCustomRoot(res.filePaths[0]);
      return { ok: true, prefs };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        prefs: getZonesPrefs(),
      };
    }
  });
  ipcMain.handle('zones:clear-custom-root', () => {
    try {
      const prefs = setCustomRoot(null);
      return { ok: true, prefs };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        prefs: getZonesPrefs(),
      };
    }
  });
  ipcMain.handle('zones:add-tracked', async (_e, payload?: { name?: string; path?: string }) => {
    const prefs = getZonesPrefs();
    if (!prefs.customRoot) {
      return { ok: false, error: '请先选择桌面目录', prefs };
    }
    const trackPath = typeof payload?.path === 'string' ? payload.path.trim() : '';
    if (trackPath) {
      try {
        return { ok: true, prefs: addTrackedRel(trackPath) };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          prefs: getZonesPrefs(),
        };
      }
    }
    const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
    if (name) {
      try {
        return { ok: true, prefs: createTrackedGroup(name) };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          prefs: getZonesPrefs(),
        };
      }
    }
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    const dialogOpts: Electron.OpenDialogOptions = {
      title: '选择要追踪的子目录',
      defaultPath: prefs.customRoot,
      properties: ['openDirectory', 'createDirectory'],
    };
    const res = win
      ? await dialog.showOpenDialog(win, dialogOpts)
      : await dialog.showOpenDialog(dialogOpts);
    if (res.canceled || !res.filePaths[0]) {
      return { ok: false, cancelled: true, prefs: getZonesPrefs() };
    }
    try {
      return { ok: true, prefs: addTrackedRel(res.filePaths[0]) };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        prefs: getZonesPrefs(),
      };
    }
  });
  ipcMain.handle('zones:remove-tracked', (_e, rel: string) => {
    try {
      return { ok: true, prefs: removeTrackedRel(String(rel)) };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        prefs: getZonesPrefs(),
      };
    }
  });
  ipcMain.handle('zones:open', (_e, filePath: string) => openPath(String(filePath)));
  ipcMain.handle('zones:reveal', (_e, filePath: string) => {
    revealInFolder(String(filePath));
    return { ok: true };
  });
  ipcMain.handle('organize:undo', () => undoLast());
  ipcMain.handle('organize:undo-available', () => undoAvailable());
  ipcMain.handle('fs:rename', (_e, target: string, newName: string) =>
    renameItem(String(target), String(newName)),
  );
  ipcMain.handle('fs:trash', (_e, target: string) => trashItem(String(target)));
  ipcMain.handle('fs:move-into-group', (_e, from: string, groupRel: string) =>
    moveIntoGroup(String(from), String(groupRel)),
  );
  ipcMain.handle('fs:move-into-dir', (_e, from: string, destDir: string) =>
    moveIntoDir(String(from), String(destDir)),
  );
  ipcMain.handle('desktop:open-folder', () => {
    openDesktopFolder();
    return { ok: true };
  });
  ipcMain.handle('wallpaper:list', () => listWallpapers());
  ipcMain.handle('wallpaper:set', (_e, filePath: string) =>
    setDesktopWallpaper(String(filePath)),
  );
  ipcMain.handle('wallpaper:get-app-bg', () => {
    const name = currentAppBackgroundName();
    return { name, url: appBackgroundUrl(name) };
  });
  ipcMain.handle('wallpaper:set-app-bg', (_e, nameOrPath: string | null) => {
    if (nameOrPath == null || nameOrPath === '') {
      return applyAppBackgroundPatch(null);
    }
    const name = normalizeAppBackgroundName(String(nameOrPath));
    if (!name) {
      return { ok: false, error: 'file not found', name: null, url: null };
    }
    return applyAppBackgroundPatch(name);
  });
  ipcMain.handle('wallpaper:open-folder', () => {
    openWallpapersFolder();
    return { ok: true };
  });
  ipcMain.handle('zones:jimeng-open', (_e, url?: string) => {
    try {
      showJimengEmbedded(typeof url === 'string' && url.trim() ? url.trim() : undefined);
      const layout = getJimengLayout();
      pushJimengLayout(layout);
      return { ok: true, layout };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle('zones:jimeng-hide', () => {
    hideJimengEmbedded();
    const layout = getJimengLayout();
    pushJimengLayout(layout);
    return { ok: true, layout };
  });
  ipcMain.handle('zones:jimeng-layout', () => getJimengLayout());
  ipcMain.handle('zones:shell-mode', (_e, mode?: string) => {
    // Compat: jimeng = open follower; desktop = hide follower.
    const m = mode === 'jimeng' ? 'jimeng' : 'desktop';
    if (m === 'jimeng') {
      try {
        showJimengEmbedded();
        const layout = getJimengLayout();
        pushJimengLayout(layout);
        return { ok: true, mode: 'jimeng' as const, layout };
      } catch (e) {
        return {
          ok: false,
          mode: 'desktop' as const,
          error: e instanceof Error ? e.message : String(e),
          layout: getJimengLayout(),
        };
      }
    }
    hideJimengEmbedded();
    const layout = getJimengLayout();
    pushJimengLayout(layout);
    return { ok: true, mode: 'desktop' as const, layout };
  });
  ipcMain.handle('zones:jimeng-favorites-cache', () => jimengCacheForRenderer());
  ipcMain.handle('zones:jimeng-sync-favorites', async () => {
    const res = await syncJimengFavorites();
    registerJimengMediaUrls(res.items || []);
    return {
      ...res,
      items: maskJimengItems(res.items || []),
    };
  });
  ipcMain.handle('zones:jimeng-download-one', (_e, idOrItem: string | JimengFavoriteItem) => {
    // Prefer id-only: Vue reactive proxies are not structured-cloneable over IPC.
    const id =
      typeof idOrItem === 'string'
        ? idOrItem.trim()
        : String((idOrItem && typeof idOrItem === 'object' ? idOrItem.id : '') || '').trim();
    if (!id) return { ok: false, error: '无效收藏项' };
    const fromCache = readFavoritesCache().items.find((x) => String(x.id) === id);
    if (!fromCache) {
      return { ok: false, error: '本地缓存中找不到该项，请先刷新收藏' };
    }
    return downloadJimengFavorite(fromCache);
  });
  ipcMain.handle('zones:jimeng-download-many', (_e, ids?: string[]) =>
    downloadJimengFavorites(Array.isArray(ids) ? ids.map(String) : undefined),
  );
  ipcMain.handle('zones:jimeng-sse-start', () => ({ ok: true }));
  ipcMain.handle('zones:jimeng-sse-stop', () => ({ ok: true }));
  ipcMain.handle('zones:jimeng-control-endpoint', () => ({
    ok: false,
    error: '即梦数据仅本机持久化，不经 Runner',
  }));
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

export function showZonesWindow(): void {
  startHidden = false;
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  showWindow();
}

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
  patchSharedSettingsFn = opts.patchSharedSettings ?? null;
  onVisibilityChangeFn = opts.onVisibilityChange ?? null;
  lastEmittedVisible = null;
  sharedUi = resolveInitialSharedUi();
  registerWallpaperProtocol();
  registerZonesFileProtocol((abs) => isUnderAllowedRoots(abs));
  registerJimengMediaProtocol();
  {
    const cache = readFavoritesCache();
    registerJimengMediaUrls(cache.items);
  }
  registerJimengCaptureIpc();
  setJimengCacheListener(() => {
    pushJimengCacheToRenderer();
  });
  setJimengHostWindow(() => mainWindow);
  setJimengLayoutListener((layout) => {
    pushJimengLayout(layout);
  });
  registerIpc();

  if (hostMode === 'standalone') {
    createWindow();
  } else if (startHidden) {
    createWindow();
  }
}

export function shutdownZonesHost(): void {
  isQuitting = true;
  shutdownJimengSseBridge();
  hideJimengEmbedded();
  closeJimengWindow();
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
  registerJimengMediaScheme();
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

