import { contextBridge, ipcRenderer } from 'electron';

export type SharedSettings = {
  screenshotHotkey: string;
  activateHotkey: string;
  screenshotHistoryLimit: number;
  fontId: string;
  glassAlpha: number;
  theme: 'dark' | 'light';
  shellMosaicCols: number;
  shellLayout: 'grid' | 'single';
  alwaysOnTop: boolean;
  persistLogs: boolean;
};

const api = {
  getSettings: (): Promise<SharedSettings> => ipcRenderer.invoke('tray:get-settings'),
  setSettings: (
    patch: Partial<SharedSettings>,
  ): Promise<{
    settings: SharedSettings;
    hotkeyError: string | null;
  }> => ipcRenderer.invoke('tray:set-settings', patch),
  suspendHotkeys: (): Promise<void> => ipcRenderer.invoke('tray:hotkeys-suspend'),
  resumeHotkeys: (): Promise<{
    ok: boolean;
    screenshotError: string | null;
    activateError: string | null;
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
  closeWindow: (): Promise<void> => ipcRenderer.invoke('tray:window-close'),
  onHistoryChanged: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('pkg:ss-history', handler);
    return () => ipcRenderer.removeListener('pkg:ss-history', handler);
  },
};

contextBridge.exposeInMainWorld('trayApi', api);

declare global {
  interface Window {
    trayApi: typeof api;
  }
}
