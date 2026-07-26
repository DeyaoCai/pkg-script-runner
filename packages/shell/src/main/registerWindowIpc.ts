import { ipcMain, type BrowserWindow } from 'electron';
import { WINDOW_CHANNELS, type TWindowChannels } from './channels.js';

export type TRegisterWindowIpcOpts = {
  getWindow: () => BrowserWindow | null;
  channels?: Partial<TWindowChannels>;
  /** Override close behavior (e.g. hide to tray). Default: win.close() */
  onClose?: (win: BrowserWindow) => void;
};

/** Register minimize / maximize / close / isMaximized IPC handlers. */
export function registerWindowIpc(opts: TRegisterWindowIpcOpts): void {
  const ch: TWindowChannels = { ...WINDOW_CHANNELS, ...opts.channels };

  ipcMain.handle(ch.minimize, () => {
    opts.getWindow()?.minimize();
  });

  ipcMain.handle(ch.maximize, () => {
    const win = opts.getWindow();
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });

  ipcMain.handle(ch.close, () => {
    const win = opts.getWindow();
    if (!win) return;
    if (opts.onClose) opts.onClose(win);
    else win.close();
  });

  ipcMain.handle(ch.isMaximized, () => {
    const win = opts.getWindow();
    return !!win && !win.isDestroyed() && win.isMaximized();
  });
}
