/**
 * Standalone Runner entry (dev:runner / runner-only portable).
 * Full app uses tray main + embedded runnerHost.
 */
import { app } from 'electron';
import {
  registerRunnerSecondInstanceHandlers,
  registerRunnerStandaloneLifecycle,
  startRunnerHost,
} from './runnerHost.js';
import { applyPkgRunnerUserData, pkgRunnerProfileName } from './appProfile.js';

app.setName('pkg-runner');
applyPkgRunnerUserData();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.warn(
    `[pkg-runner] 同 profile（${pkgRunnerProfileName()}）已有实例在运行，本进程退出`,
  );
  app.exit(0);
}

registerRunnerSecondInstanceHandlers();
registerRunnerStandaloneLifecycle();

app.whenReady().then(() => startRunnerHost({ mode: 'standalone' }));
