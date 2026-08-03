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
  open: (filePath: string) => ipcRenderer.invoke('zones:open', filePath),
  reveal: (filePath: string) => ipcRenderer.invoke('zones:reveal', filePath),
  previewOrganize: () => ipcRenderer.invoke('organize:preview'),
  applyOrganize: (ops: unknown) => ipcRenderer.invoke('organize:apply', ops),
  undoOrganize: () => ipcRenderer.invoke('organize:undo'),
  undoAvailable: () => ipcRenderer.invoke('organize:undo-available'),
  rename: (target: string, newName: string) =>
    ipcRenderer.invoke('fs:rename', target, newName),
  trash: (target: string) => ipcRenderer.invoke('fs:trash', target),
  openDesktop: () => ipcRenderer.invoke('desktop:open-folder'),
  quit: () => ipcRenderer.invoke('app:quit'),
  ...windowApi,
});
