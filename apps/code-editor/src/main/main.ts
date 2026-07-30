/**
 * Standalone Code Editor entry (dev:code-editor / portable).
 * Full app uses tray main + embedded editorHost.
 */
import { app, Menu } from 'electron';
import path from 'node:path';
import {
  registerEditorSecondInstanceHandlers,
  registerEditorStandaloneLifecycle,
  startEditorHost,
} from './editorHost.js';

app.setName('code-editor');
try {
  app.setPath('userData', path.join(app.getPath('appData'), 'code-editor'));
} catch {
  /* ignore */
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.exit(0);
}

registerEditorSecondInstanceHandlers();
registerEditorStandaloneLifecycle();

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const argDir = process.argv.find(
    (a, i) =>
      i > 0 &&
      !a.startsWith('-') &&
      !a.includes('electron') &&
      !a.endsWith('.js'),
  );
  const startHidden = process.argv.includes('--hidden');
  return startEditorHost({
    mode: 'standalone',
    startHidden,
    openDir: argDir ?? null,
  });
});
