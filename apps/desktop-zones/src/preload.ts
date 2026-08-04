import { contextBridge, ipcRenderer } from 'electron';
import { createWindowPreloadApi } from '@pkg-runner/shell/preload';

function resolveColorEnv(): 'prod' | 'test' {
  return process.env.PKG_RUNNER_COLOR_ENV?.trim().toLowerCase() === 'test'
    ? 'test'
    : 'prod';
}

const windowApi = createWindowPreloadApi(ipcRenderer, {
  minimize: 'zones:window-minimize',
  maximize: 'zones:window-maximize',
  close: 'zones:window-close',
  isMaximized: 'zones:window-isMaximized',
  maximizedChanged: 'zones:window-maximized-changed',
});

contextBridge.exposeInMainWorld('desktopZones', {
  getColorEnv: (): 'prod' | 'test' => resolveColorEnv(),
  getSharedSettings: () => ipcRenderer.invoke('zones:get-shared-settings'),
  onSharedSettings: (cb: (settings: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, settings: unknown) => {
      cb(settings);
    };
    ipcRenderer.on('zones:shared-settings', handler);
    return () => {
      ipcRenderer.removeListener('zones:shared-settings', handler);
    };
  },
  scan: () => ipcRenderer.invoke('zones:scan'),
  listDir: (dirPath: string) => ipcRenderer.invoke('zones:list-dir', dirPath),
  getPrefs: () => ipcRenderer.invoke('zones:get-prefs'),
  setCustomRoot: () => ipcRenderer.invoke('zones:set-custom-root'),
  clearCustomRoot: () => ipcRenderer.invoke('zones:clear-custom-root'),
  addTracked: (opts?: { name?: string; path?: string }) =>
    ipcRenderer.invoke('zones:add-tracked', opts),
  removeTracked: (rel: string) => ipcRenderer.invoke('zones:remove-tracked', rel),
  open: (filePath: string) => ipcRenderer.invoke('zones:open', filePath),
  reveal: (filePath: string) => ipcRenderer.invoke('zones:reveal', filePath),
  undoOrganize: () => ipcRenderer.invoke('organize:undo'),
  undoAvailable: () => ipcRenderer.invoke('organize:undo-available'),
  rename: (target: string, newName: string) =>
    ipcRenderer.invoke('fs:rename', target, newName),
  trash: (target: string) => ipcRenderer.invoke('fs:trash', target),
  moveIntoGroup: (from: string, groupRel: string) =>
    ipcRenderer.invoke('fs:move-into-group', from, groupRel),
  moveIntoDir: (from: string, destDir: string) =>
    ipcRenderer.invoke('fs:move-into-dir', from, destDir),
  openDesktop: () => ipcRenderer.invoke('desktop:open-folder'),
  listWallpapers: () => ipcRenderer.invoke('wallpaper:list'),
  setWallpaper: (filePath: string) => ipcRenderer.invoke('wallpaper:set', filePath),
  getAppBackground: () => ipcRenderer.invoke('wallpaper:get-app-bg'),
  setAppBackground: (nameOrPath: string | null) =>
    ipcRenderer.invoke('wallpaper:set-app-bg', nameOrPath),
  openWallpapersFolder: () => ipcRenderer.invoke('wallpaper:open-folder'),
  openJimeng: (url?: string) => ipcRenderer.invoke('zones:jimeng-open', url),
  hideJimeng: (opts?: { restoreHost?: boolean }) =>
    ipcRenderer.invoke('zones:jimeng-hide', opts),
  getJimengLayout: () => ipcRenderer.invoke('zones:jimeng-layout'),
  setShellMode: (mode: 'desktop' | 'jimeng') =>
    ipcRenderer.invoke('zones:shell-mode', mode),
  onJimengLayout: (cb: (layout: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, layout: unknown) => {
      cb(layout);
    };
    ipcRenderer.on('zones:jimeng-layout', handler);
    return () => {
      ipcRenderer.removeListener('zones:jimeng-layout', handler);
    };
  },
  onShellMode: (cb: (mode: 'desktop' | 'jimeng') => void) => {
    const handler = (_: Electron.IpcRendererEvent, layout: unknown) => {
      const open =
        layout && typeof layout === 'object' && (layout as { open?: boolean }).open;
      cb(open ? 'jimeng' : 'desktop');
    };
    ipcRenderer.on('zones:jimeng-layout', handler);
    return () => {
      ipcRenderer.removeListener('zones:jimeng-layout', handler);
    };
  },
  getJimengFavoritesCache: () => ipcRenderer.invoke('zones:jimeng-favorites-cache'),
  syncJimengFavorites: () => ipcRenderer.invoke('zones:jimeng-sync-favorites'),
  /** Pass favorite id (plain string). Avoid Vue proxies — they fail IPC clone. */
  downloadJimengFavorite: (idOrItem: string | { id?: string }) => {
    const id =
      typeof idOrItem === 'string'
        ? idOrItem
        : String(idOrItem?.id || '');
    return ipcRenderer.invoke('zones:jimeng-download-one', id);
  },
  downloadJimengFavorites: (ids?: string[]) =>
    ipcRenderer.invoke('zones:jimeng-download-many', ids),
  startJimengSse: () => ipcRenderer.invoke('zones:jimeng-sse-start'),
  stopJimengSse: () => ipcRenderer.invoke('zones:jimeng-sse-stop'),
  getJimengControlEndpoint: () => ipcRenderer.invoke('zones:jimeng-control-endpoint'),
  onJimengHub: (cb: (ev: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, ev: unknown) => {
      cb(ev);
    };
    ipcRenderer.on('zones:jimeng-hub', handler);
    return () => {
      ipcRenderer.removeListener('zones:jimeng-hub', handler);
    };
  },
  quit: () => ipcRenderer.invoke('app:quit'),
  ...windowApi,
});
