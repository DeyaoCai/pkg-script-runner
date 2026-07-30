/**
 * Headless check: settings.html + preload.cjs hydration.
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const trayRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(trayRoot, 'dist');
const ui = path.join(trayRoot, 'ui');

ipcMain.handle('tray:get-settings', () => ({
  screenshotHotkey: 'Alt+E',
  activateHotkey: 'Alt+Q',
  screenshotHistoryLimit: 10,
  fontId: 'jetbrains',
  glassAlpha: 70,
  theme: 'dark',
  shellMosaicCols: 2,
  shellLayout: 'grid',
  alwaysOnTop: false,
  persistLogs: false,
}));
ipcMain.handle('tray:diag-log', (_e, event, detail) => {
  console.log('[settings-ui]', event, detail ?? '');
});
ipcMain.handle('tray:set-settings', () => ({ settings: {}, hotkeyError: null }));
ipcMain.handle('tray:hotkeys-suspend', () => {});
ipcMain.handle('tray:hotkeys-resume', () => ({ ok: true, screenshotError: null, activateError: null }));
ipcMain.handle('tray:window-close', () => {});
ipcMain.handle('tray:open-diag-log', () => '');

app.whenReady().then(async () => {
  const preload = path.join(dist, 'preload.cjs');
  if (!fs.existsSync(preload)) {
    console.error('missing preload.cjs — run pnpm build:dev first');
    app.exit(2);
    return;
  }
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.webContents.on('console-message', (_e, _level, msg) => {
    console.log('[renderer]', msg);
  });
  win.webContents.on('preload-error', (_e, p, err) => {
    console.error('[preload-error]', p, err);
  });

  await win.loadFile(path.join(ui, 'settings.html'));

  await new Promise((r) => setTimeout(r, 2500));

  const report = await win.webContents.executeJavaScript(`(() => {
    const btn = document.getElementById('shotHotkeyBtn');
    return {
      hasTrayApi: typeof window.trayApi !== 'undefined',
      hasGetSettings: typeof window.trayApi?.getSettings === 'function',
      hasApplyFn: typeof window.__applyTraySettings === 'function',
      shotBtn: btn ? btn.textContent : null,
      err: document.getElementById('err')?.textContent || '',
    };
  })()`);

  console.log('REPORT', JSON.stringify(report, null, 2));
  const ok =
    report.hasTrayApi &&
    report.hasGetSettings &&
    report.shotBtn &&
    !report.shotBtn.includes('加载中');
  app.exit(ok ? 0 : 1);
});
