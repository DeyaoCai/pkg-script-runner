import { contextBridge, ipcRenderer } from 'electron';
import { createWindowPreloadApi } from '@pkg-runner/shell/preload';

export type SharedSettings = {
  screenshotHotkey: string;
  activateHotkey: string;
  editorHotkey: string;
  zonesHotkey: string;
  settingsHotkey: string;
  historyHotkey: string;
  hotkeysEnabled: boolean;
  screenshotHistoryLimit: number;
  fontId: string;
  glassAlpha: number;
  glassBlur: number;
  theme: 'dark' | 'light';
  brandTone: 'prod' | 'test';
  brandColor: string;
  shellMosaicCols: number;
  shellLayout: 'grid' | 'single';
  alwaysOnTop: boolean;
  persistLogs: boolean;
  appBackground: string | null;
};

export type TrayProfileInfo = {
  profile: string;
  colorEnv: 'prod' | 'test';
  userData: string;
  settingsPath: string;
  packaged: boolean;
};

const windowApi = createWindowPreloadApi(ipcRenderer, {
  minimize: 'tray-settings:window-minimize',
  maximize: 'tray-settings:window-maximize',
  close: 'tray-settings:window-close',
  isMaximized: 'tray-settings:window-isMaximized',
  maximizedChanged: 'tray-settings:window-maximized-changed',
});

const api = {
  getSettings: (): Promise<SharedSettings> => ipcRenderer.invoke('tray:get-settings'),
  getProfile: (): Promise<TrayProfileInfo> => ipcRenderer.invoke('tray:get-profile'),
  setSettings: (
    patch: Partial<SharedSettings>,
  ): Promise<{
    settings: SharedSettings;
    hotkeyError: string | null;
  }> => ipcRenderer.invoke('tray:set-settings', patch),
  listWallpapers: () => ipcRenderer.invoke('tray:list-wallpapers'),
  setDesktopWallpaper: (filePath: string) =>
    ipcRenderer.invoke('tray:set-desktop-wallpaper', filePath),
  openWallpapersFolder: () => ipcRenderer.invoke('tray:open-wallpapers-folder'),
  suspendHotkeys: (): Promise<void> => ipcRenderer.invoke('tray:hotkeys-suspend'),
  resumeHotkeys: (): Promise<{
    ok: boolean;
    error: string | null;
  }> => ipcRenderer.invoke('tray:hotkeys-resume'),
  startScreenshot: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('pkg:ss-start'),
  listScreenshotHistory: (): Promise<
    Array<{
      id: string;
      createdAt: number;
      text: string;
      captions: string[];
      thumbDataUrl: string;
    }>
  > => ipcRenderer.invoke('pkg:ss-history-list'),
  removeScreenshotHistory: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('pkg:ss-history-remove', id),
  clearScreenshotHistory: (): Promise<number> =>
    ipcRenderer.invoke('pkg:ss-history-clear'),
  copyScreenshotHistory: (
    id: string,
    which: 'image' | 'text' | 'both',
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('pkg:ss-history-copy', id, which),
  exportScreenshotHistory: (
    ids: string[],
    format: 'md' | 'html',
  ): Promise<{
    ok: boolean;
    error?: string;
    path?: string;
    count?: number;
    format?: string;
  }> => ipcRenderer.invoke('pkg:ss-history-export', { ids, format }),
  openScreenshotHistoryDir: (): Promise<{
    ok: boolean;
    dir: string;
    error: string | null;
  }> => ipcRenderer.invoke('pkg:open-ss-history-dir'),
  /** Closes the calling window (settings or history). */
  closeWindow: (): Promise<void> => ipcRenderer.invoke('tray:window-close'),
  showRunner: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('tray:show-runner'),
  showEditor: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('tray:show-editor'),
  showZones: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('tray:show-zones'),
  diagLog: (event: string, detail?: unknown): Promise<void> =>
    ipcRenderer.invoke('tray:diag-log', event, detail),
  openDiagLog: (): Promise<string> => ipcRenderer.invoke('tray:open-diag-log'),
  getDiagTail: (maxLines?: number): Promise<string> =>
    ipcRenderer.invoke('tray:get-diag-tail', maxLines),
  onSettings: (cb: (settings: SharedSettings) => void) => {
    const handler = (_: unknown, settings: SharedSettings) => cb(settings);
    ipcRenderer.on('tray:settings', handler);
    return () => ipcRenderer.removeListener('tray:settings', handler);
  },
  onHistoryChanged: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('pkg:ss-history', handler);
    return () => ipcRenderer.removeListener('pkg:ss-history', handler);
  },
  /** Settings TitleBarShell bridge (settings window only). */
  ...windowApi,
};

contextBridge.exposeInMainWorld('trayApi', api);

declare global {
  interface Window {
    trayApi: typeof api;
  }
}
