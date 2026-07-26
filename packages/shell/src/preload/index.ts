import type { IpcRenderer, IpcRendererEvent } from 'electron';
import { WINDOW_CHANNELS, type TWindowChannels } from '../main/channels.js';
import type { TWindowBridge } from '../windowBridge.js';

export type { TWindowBridge };

/** Build the window.* preload API used by frameless editor shells. */
export function createWindowPreloadApi(
  ipcRenderer: IpcRenderer,
  channels?: Partial<TWindowChannels>,
): TWindowBridge {
  const ch: TWindowChannels = { ...WINDOW_CHANNELS, ...channels };
  return {
    windowMinimize: () => ipcRenderer.invoke(ch.minimize),
    windowMaximize: () => ipcRenderer.invoke(ch.maximize),
    windowClose: () => ipcRenderer.invoke(ch.close),
    windowIsMaximized: () => ipcRenderer.invoke(ch.isMaximized),
    onMaximizedChange: (cb) => {
      const handler = (_: IpcRendererEvent, maximized: boolean) => {
        cb(maximized);
      };
      ipcRenderer.on(ch.maximizedChanged, handler);
      return () => {
        ipcRenderer.removeListener(ch.maximizedChanged, handler);
      };
    },
  };
}
