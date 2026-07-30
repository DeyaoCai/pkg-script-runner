/**
 * Windows DWM：仅一个无边框可见窗时，拖动易闪。
 * 挂一个「不透明 + opacity 1 + 屏外」的小窗参与合成（transparent / opacity 0 无效）。
 */
import { BrowserWindow } from 'electron';
import { diagLog } from './diagLog.js';

let keepalive: BrowserWindow | null = null;

export function ensureCompositorKeepalive(): void {
  if (process.platform !== 'win32') return;
  if (keepalive && !keepalive.isDestroyed()) return;

  keepalive = new BrowserWindow({
    width: 8,
    height: 8,
    x: -4000,
    y: -4000,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#111111',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    keepalive.setIgnoreMouseEvents(true, { forward: true });
    keepalive.setOpacity(1);
    keepalive.showInactive();
    diagLog('tray', 'compositor.keepalive.on');
  } catch (err) {
    diagLog('tray', 'compositor.keepalive.error', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  keepalive.on('closed', () => {
    keepalive = null;
  });
}

export function destroyCompositorKeepalive(): void {
  if (!keepalive || keepalive.isDestroyed()) {
    keepalive = null;
    return;
  }
  try {
    keepalive.destroy();
  } catch {
    /* ignore */
  }
  keepalive = null;
}
