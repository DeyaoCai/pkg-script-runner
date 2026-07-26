import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import { WINDOW_CHANNELS } from './channels.js';

/** Shared frameless BrowserWindow defaults for editor apps. */
export function framelessWindowOptions(
  partial: BrowserWindowConstructorOptions,
): BrowserWindowConstructorOptions {
  return {
    show: false,
    frame: false,
    backgroundColor: '#16181c',
    ...partial,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      ...partial.webPreferences,
    },
  };
}

/** Emit maximize state changes to the renderer. */
export function attachMaximizedEvents(
  win: BrowserWindow,
  channel: string = WINDOW_CHANNELS.maximizedChanged,
): () => void {
  const emit = () => {
    if (win.isDestroyed()) return;
    win.webContents.send(channel, win.isMaximized());
  };
  win.on('maximize', emit);
  win.on('unmaximize', emit);
  return () => {
    win.removeListener('maximize', emit);
    win.removeListener('unmaximize', emit);
  };
}
