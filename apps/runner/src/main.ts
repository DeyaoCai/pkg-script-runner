/**
 * Standalone Runner entry (dev:runner / runner-only portable).
 * Full app uses tray main + embedded runnerHost.
 */
import { app } from 'electron';
import path from 'node:path';
import {
  registerRunnerSecondInstanceHandlers,
  registerRunnerStandaloneLifecycle,
  startRunnerHost,
} from './runnerHost.js';

app.setName('pkg-runner');
try {
  app.setPath('userData', path.join(app.getPath('appData'), 'pkg-runner'));
} catch {
  /* ignore */
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.warn('[pkg-runner] 已有实例在运行，本进程退出');
  app.exit(0);
}

registerRunnerSecondInstanceHandlers();
registerRunnerStandaloneLifecycle();

app.whenReady().then(() => startRunnerHost({ mode: 'standalone' }));
