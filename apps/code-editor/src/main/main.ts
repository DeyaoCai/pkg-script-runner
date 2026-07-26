import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  framelessWindowOptions,
  attachMaximizedEvents,
  registerWindowIpc,
  revealPath,
  openPathWithDefault,
} from '@pkg-runner/shell/main';
import {
  listDir,
  readFileText,
  writeFileText,
  assertInsideRoot,
  toRelPath,
  isFile,
  statFile,
} from './fsBridge.js';
import { gitStatus, gitDiff } from './gitBridge.js';
import {
  loadPrefs,
  savePrefs,
  setWorkspace,
  openIncomingDir,
  enterDir,
  goParent,
  goWorkspaceRoot,
  goProjectRoot,
  updateRecentFiles,
  boundRoot,
  cwdRelToBound,
  canGoParent,
  isProjectDir,
  discoverRepos,
  selectRepo,
  shellPrefsOf,
  patchShellPrefs,
  type TPrefs,
  type TShellPrefs,
} from './prefs.js';
import { TermBridge } from './termBridge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '../..');
const PREFS_PATH = () => path.join(app.getPath('userData'), 'prefs.json');

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

let mainWindow: BrowserWindow | null = null;
let prefs: TPrefs = {
  workspaceRoot: null,
  cwd: null,
  projectRoot: null,
  recentFiles: [],
  recentWorkspaces: [],
  workspaces: {},
  shellOpen: false,
  shellColumnsPerPage: 1,
  designRoot: null,
};
let initialOpenDir: string | null = null;
const termBridge = new TermBridge(() => mainWindow);

function persist(): void {
  savePrefs(PREFS_PATH(), prefs);
}

function activeRoot(): string {
  const root = boundRoot(prefs);
  if (!root) throw new Error('no workspace');
  return root;
}

function navSnapshot() {
  const bound = boundRoot(prefs);
  let repos = prefs.workspaceRoot
    ? discoverRepos(prefs.workspaceRoot).map((r) => ({
        abs: r.abs,
        rel: r.rel,
        name: r.name,
        active: false,
      }))
    : [];

  // Nested package/git selected via tree may not appear in discoverRepos
  // (scan stops at parent package.json). Always surface the active project.
  if (prefs.workspaceRoot && prefs.projectRoot) {
    const pr = path.resolve(prefs.projectRoot);
    const ws = path.resolve(prefs.workspaceRoot);
    const existing = repos.find((r) => samePathLoose(r.abs, pr));
    if (existing) {
      for (const r of repos) {
        r.active = samePathLoose(r.abs, pr);
      }
    } else {
      const rel = samePathLoose(pr, ws)
        ? ''
        : path.relative(ws, pr).split(path.sep).join('/');
      const name = !rel ? '工作区' : path.basename(pr);
      repos.push({ abs: pr, rel, name, active: true });
      repos.sort((a, b) => {
        if (!a.rel && b.rel) return -1;
        if (a.rel && !b.rel) return 1;
        return a.rel.localeCompare(b.rel, undefined, { sensitivity: 'base' });
      });
    }
  }

  return {
    workspaceRoot: prefs.workspaceRoot,
    cwd: prefs.cwd,
    projectRoot: prefs.projectRoot,
    boundRoot: bound,
    cwdRel: cwdRelToBound(prefs),
    canGoParent: canGoParent(prefs),
    projectLocked: !!prefs.projectRoot,
    recentFiles: prefs.recentFiles,
    recentWorkspaces: prefs.recentWorkspaces,
    repos,
  };
}

function samePathLoose(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

function createWindow(): void {
  mainWindow = new BrowserWindow(
    framelessWindowOptions({
      width: 1280,
      height: 840,
      minWidth: 900,
      minHeight: 560,
      title: 'Code Editor',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
      },
    }),
  );

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  attachMaximizedEvents(mainWindow);

  const devUrl = process.env.CODE_EDITOR_DEV_URL?.trim();
  if (devUrl && !app.isPackaged) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(APP_ROOT, 'dist/renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpc(): void {
  ipcMain.handle('nav:get', () => navSnapshot());

  ipcMain.handle('workspace:pick', async () => {
    const win = mainWindow;
    if (!win) return navSnapshot();
    const r = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: '选择工作区目录',
    });
    if (r.canceled || !r.filePaths[0]) return navSnapshot();
    prefs = setWorkspace(prefs, r.filePaths[0]);
    persist();
    return navSnapshot();
  });

  ipcMain.handle('workspace:open', (_e, dir: string) => {
    if (!dir || typeof dir !== 'string') return navSnapshot();
    // OS / bootstrap path — may select repo inside current workspace
    prefs = openIncomingDir(prefs, dir);
    persist();
    return navSnapshot();
  });

  ipcMain.handle('nav:enter', (_e, relOrAbs: string) => {
    prefs = enterDir(prefs, relOrAbs);
    persist();
    return navSnapshot();
  });

  ipcMain.handle('nav:parent', () => {
    prefs = goParent(prefs);
    persist();
    return navSnapshot();
  });

  ipcMain.handle('nav:workspace-root', () => {
    prefs = goWorkspaceRoot(prefs);
    persist();
    return navSnapshot();
  });

  ipcMain.handle('nav:bound-root', () => {
    prefs = goProjectRoot(prefs);
    persist();
    return navSnapshot();
  });

  ipcMain.handle('repo:select', (_e, repoAbs: string) => {
    prefs = selectRepo(prefs, repoAbs);
    persist();
    return navSnapshot();
  });

  ipcMain.handle('repo:list', () => {
    return navSnapshot().repos;
  });

  ipcMain.handle('nav:is-project', (_e, relPath: string) => {
    try {
      const abs = assertInsideRoot(activeRoot(), relPath);
      return isProjectDir(abs);
    } catch {
      return false;
    }
  });

  ipcMain.handle('prefs:recent-files', (_e, files: string[]) => {
    prefs = updateRecentFiles(prefs, files);
    persist();
    return navSnapshot();
  });

  ipcMain.handle('prefs:shell-get', (): TShellPrefs => shellPrefsOf(prefs));

  ipcMain.handle(
    'prefs:shell-set',
    (_e, patch: Partial<TShellPrefs>): TShellPrefs => {
      prefs = patchShellPrefs(prefs, patch ?? {});
      persist();
      return shellPrefsOf(prefs);
    },
  );

  ipcMain.handle('design:get-root', () => prefs.designRoot);

  /** Set design repo from current workspace catalog; null clears. */
  ipcMain.handle('design:set-root', (_e, abs: string | null) => {
    if (abs == null || abs === '') {
      prefs = { ...prefs, designRoot: null };
      persist();
      return null;
    }
    if (typeof abs !== 'string') throw new Error('无效路径');
    const ws = prefs.workspaceRoot;
    if (!ws) throw new Error('请先选择工作区');
    const resolved = path.resolve(abs);
    const allowed = discoverRepos(ws).some((r) =>
      samePathLoose(r.abs, resolved),
    );
    if (!allowed) {
      throw new Error('仓库不在当前工作区');
    }
    prefs = { ...prefs, designRoot: resolved };
    persist();
    return prefs.designRoot;
  });

  ipcMain.handle('design:reveal-root', async () => {
    const root = prefs.designRoot;
    if (!root) throw new Error('未选择设计仓库');
    await revealPath(root);
  });

  function designRootOrThrow(): string {
    const root = prefs.designRoot;
    if (!root) throw new Error('未选择设计仓库');
    return root;
  }

  ipcMain.handle('design:list', (_e, relDir?: string) => {
    return listDir(designRootOrThrow(), relDir || '', { docsOnly: true });
  });

  ipcMain.handle('design:read', (_e, relPath: string) => {
    return readFileText(designRootOrThrow(), relPath);
  });

  ipcMain.handle('design:write', (_e, relPath: string, content: string) => {
    return writeFileText(designRootOrThrow(), relPath, content);
  });

  ipcMain.handle('design:reveal', async (_e, relPath?: string | null) => {
    const root = designRootOrThrow();
    if (relPath == null || relPath === '') {
      await revealPath(root);
      return;
    }
    const abs = assertInsideRoot(root, relPath);
    await revealPath(abs);
  });

  ipcMain.handle('design:openPath', async (_e, relPath: string) => {
    const abs = assertInsideRoot(designRootOrThrow(), relPath);
    await openPathWithDefault(abs);
  });

  ipcMain.handle('fs:list', (_e, relDir?: string) => {
    const root = activeRoot();
    // Always list relative to bound (repo) root — never workspace cwd browsing
    return listDir(root, relDir || '');
  });

  ipcMain.handle('fs:is-file', (_e, relPath: string) => {
    return isFile(activeRoot(), relPath);
  });

  ipcMain.handle('fs:stat', (_e, relPath: string) => {
    return statFile(activeRoot(), relPath);
  });

  ipcMain.handle('fs:read', (_e, relPath: string) => {
    return readFileText(activeRoot(), relPath);
  });

  ipcMain.handle('fs:write', (_e, relPath: string, content: string) => {
    return writeFileText(activeRoot(), relPath, content);
  });

  ipcMain.handle('fs:save-as', async (_e, defaultName?: string) => {
    const win = mainWindow;
    if (!win) return null;
    const root = activeRoot();
    const r = await dialog.showSaveDialog(win, {
      defaultPath: path.join(prefs.cwd || root, defaultName || 'untitled.txt'),
      title: '另存为',
    });
    if (r.canceled || !r.filePath) return null;
    const abs = assertInsideRoot(root, r.filePath);
    const relPath = toRelPath(root, abs);
    return { relPath };
  });

  ipcMain.handle('git:status', () => gitStatus(activeRoot()));

  ipcMain.handle(
    'git:diff',
    (
      _e,
      relPath: string,
      opts: { staged?: boolean; index?: string; worktree?: string } = {},
    ) => {
      return gitDiff(activeRoot(), relPath, opts);
    },
  );

  ipcMain.handle('shell:showItem', async (_e, relPath?: string | null) => {
    const root = activeRoot();
    const abs =
      relPath == null || relPath === ''
        ? root
        : assertInsideRoot(root, relPath);
    await revealPath(abs);
  });

  ipcMain.handle('shell:openPath', async (_e, relPath: string) => {
    const abs = assertInsideRoot(activeRoot(), relPath);
    await openPathWithDefault(abs);
  });

  ipcMain.handle('app:initial-open-dir', () => {
    const d = initialOpenDir;
    initialOpenDir = null;
    return d;
  });

  registerWindowIpc({ getWindow: () => mainWindow });

  for (const ch of [
    'term:start',
    'term:write',
    'term:resize',
    'term:kill',
    'term:kill-all',
    'term:list',
  ] as const) {
    ipcMain.removeHandler(ch);
  }

  ipcMain.handle(
    'term:start',
    (_e, cwd: string, size?: { cols?: number; rows?: number }) => {
      return termBridge.start(cwd, size);
    },
  );

  ipcMain.handle('term:write', (_e, id: string, data: string) => {
    return termBridge.write(id, data);
  });

  ipcMain.handle(
    'term:resize',
    (_e, id: string, cols: number, rows: number) => {
      return termBridge.resize(id, cols, rows);
    },
  );

  ipcMain.handle('term:kill', (_e, id: string) => {
    return termBridge.kill(id);
  });

  ipcMain.handle('term:kill-all', () => {
    termBridge.disposeAll();
  });

  ipcMain.handle('term:list', () => termBridge.list());
}

app.on('second-instance', (_e, argv) => {
  const dir = argv.find((a, i) => i > 0 && !a.startsWith('-') && !a.endsWith('.exe'));
  if (dir) {
    try {
      prefs = openIncomingDir(prefs, dir);
      persist();
      mainWindow?.webContents.send('nav:external-open', navSnapshot());
    } catch {
      /* ignore invalid path */
    }
  }
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  prefs = loadPrefs(PREFS_PATH());

  const argDir = process.argv.find(
    (a, i) => i > 0 && !a.startsWith('-') && !a.includes('electron') && !a.endsWith('.js'),
  );
  if (argDir) {
    initialOpenDir = argDir;
    try {
      prefs = openIncomingDir(prefs, argDir);
      persist();
    } catch {
      /* ignore invalid path */
    }
  } else if (process.env.CODE_EDITOR_OPEN_DIR?.trim()) {
    initialOpenDir = process.env.CODE_EDITOR_OPEN_DIR.trim();
    try {
      prefs = openIncomingDir(prefs, initialOpenDir);
      persist();
    } catch {
      /* ignore invalid path */
    }
  }

  registerIpc();
  createWindow();
});

app.on('before-quit', () => {
  termBridge.disposeAll();
});

app.on('window-all-closed', () => {
  termBridge.disposeAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});
