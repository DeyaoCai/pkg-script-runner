/**
 * Code Editor host — runnable standalone or embedded in tray (same Electron process).
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, type Rectangle } from 'electron';
import { fileURLToPath } from 'node:url';
import {
  framelessWindowOptions,
  attachMaximizedEvents,
  registerWindowIpc,
  revealPath,
  openPathWithDefault,
} from '@pkg-runner/shell/main';
import { resolveEnvAssetPath } from '@pkg-runner/assets';
import { chromeBackground, type BrandTone } from '@pkg-runner/tokens';
import {
  coerceSharedSettings,
  defaultSharedSettings,
  readSharedSettingsFromDisk,
  type SharedSettings,
} from './sharedUi.js';
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
import {
  onWorkspacePrefsChange,
  readWorkspacePrefs,
  writeWorkspacePrefs,
} from '../../../shared/workspaceSync.js';
import { TermBridge } from './termBridge.js';

export type EditorHostMode = 'standalone' | 'embedded';

export type EditorHostOptions = {
  mode?: EditorHostMode;
  /** Soft-hide after load (tray warm). */
  startHidden?: boolean;
  /** Initial directory to open (CLI / explorer). */
  openDir?: string | null;
  /** Tray injects live shared-settings (theme / brandColor / glass / font). */
  getSharedSettings?: () => unknown;
};

const __dirnameHost = path.dirname(fileURLToPath(import.meta.url));

/** Editor app root (dist/renderer). Lazy — tray sets PKG_EDITOR_APP_DIR after import. */
function editorAppRoot(): string {
  const fromEnv = process.env.PKG_EDITOR_APP_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);

  const asStandalone = path.resolve(__dirnameHost, '..', '..');
  if (
    fs.existsSync(path.join(asStandalone, 'dist', 'renderer', 'index.html')) ||
    fs.existsSync(path.join(asStandalone, 'package.json'))
  ) {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(asStandalone, 'package.json'), 'utf8'),
      ) as { name?: string };
      if (!pkg.name || pkg.name === '@pkg-runner/code-editor') return asStandalone;
    } catch {
      if (fs.existsSync(path.join(asStandalone, 'dist', 'renderer', 'index.html'))) {
        return asStandalone;
      }
    }
  }

  // tray/dist → apps/code-editor
  return path.resolve(__dirnameHost, '..', '..', 'code-editor');
}

function editorPreloadPath(): string {
  const embeddedCjs = path.join(__dirnameHost, 'editor', 'preload.cjs');
  if (fs.existsSync(embeddedCjs)) return embeddedCjs;
  const nextToHost = path.join(__dirnameHost, 'preload.js');
  if (fs.existsSync(nextToHost)) return nextToHost;
  const nextCjs = path.join(__dirnameHost, 'preload.cjs');
  if (fs.existsSync(nextCjs)) return nextCjs;
  console.error('[editor] missing preload', { embeddedCjs, nextToHost });
  return embeddedCjs;
}

function rendererIndex(): string {
  return path.join(editorAppRoot(), 'dist', 'renderer', 'index.html');
}

/** 软隐藏：屏外 + opacity 1（opacity 0 不参与 Win DWM，无法稳住其它无边框窗拖动） */
const PARK_ORIGIN = { x: -12000, y: -12000 } as const;

let hostMode: EditorHostMode = 'standalone';
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let startHidden = false;
let softHidden = false;
let parkedBounds: Rectangle | null = null;
let ipcRegistered = false;
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
let unsubWorkspace: (() => void) | null = null;
/** True while this host is writing prefs — skip re-broadcast to own renderer. */
let persistingLocal = false;
let sharedUi: SharedSettings = defaultSharedSettings();
let getSharedSettingsFn: (() => unknown) | null = null;

function colorEnv(): BrandTone {
  return process.env.PKG_RUNNER_COLOR_ENV?.trim().toLowerCase() === 'test'
    ? 'test'
    : 'prod';
}

function windowBackgroundForTheme(theme: 'dark' | 'light'): string {
  return chromeBackground(colorEnv(), theme);
}

function pushSharedUiToRenderer(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('editor:shared-settings', sharedUi);
}

/** Apply tray / disk shared settings (theme · brandColor · glass · font). */
export function applyEditorSettings(raw: unknown): void {
  const next = coerceSharedSettings(raw);
  if (!next) return;
  const themeChanged = next.theme !== sharedUi.theme;
  sharedUi = next;
  if (themeChanged && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(windowBackgroundForTheme(sharedUi.theme));
  }
  pushSharedUiToRenderer();
}

function resolveInitialSharedUi(): SharedSettings {
  if (getSharedSettingsFn) {
    const next = coerceSharedSettings(getSharedSettingsFn());
    if (next) return next;
  }
  return readSharedSettingsFromDisk();
}

function persist(): void {
  persistingLocal = true;
  try {
    writeWorkspacePrefs(prefs);
  } finally {
    persistingLocal = false;
  }
}

function activeRoot(): string {
  const root = boundRoot(prefs);
  if (!root) throw new Error('no workspace');
  return root;
}

function samePathLoose(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
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

function editorDiag(event: string, detail?: unknown): void {
  try {
    const file = path.join(app.getPath('userData'), 'diag.log');
    const line =
      JSON.stringify({
        t: new Date().toISOString(),
        src: 'editor',
        evt: event,
        d: detail,
      }) + '\n';
    fs.appendFileSync(file, line, 'utf8');
  } catch {
    /* ignore */
  }
}

function parkWindowOffscreen(win: BrowserWindow): void {
  const b = win.getBounds();
  if (b.x > -5000 && b.y > -5000) {
    parkedBounds = { ...b };
  }
  win.setOpacity(1);
  win.setBounds({
    x: PARK_ORIGIN.x,
    y: PARK_ORIGIN.y,
    width: Math.max(b.width, 900),
    height: Math.max(b.height, 560),
  });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setSkipTaskbar(true);
  if (!win.isVisible()) win.showInactive();
  win.blur();
}

function restoreParkedBounds(win: BrowserWindow): void {
  if (!parkedBounds) return;
  win.setBounds(parkedBounds);
  parkedBounds = null;
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  softHidden = false;
  startHidden = false;
  try {
    restoreParkedBounds(mainWindow);
    mainWindow.setSkipTaskbar(false);
    mainWindow.setIgnoreMouseEvents(false);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.setOpacity(1);
    const pin = mainWindow.isAlwaysOnTop();
    mainWindow.setAlwaysOnTop(true);
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    mainWindow.moveTop();
    mainWindow.setAlwaysOnTop(pin);
  } catch {
    try {
      mainWindow.show();
      mainWindow.focus();
    } catch {
      /* ignore */
    }
  }
}

function hideWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  softHidden = true;
  try {
    parkWindowOffscreen(mainWindow);
  } catch {
    try {
      mainWindow.hide();
    } catch {
      /* ignore */
    }
  }
  editorDiag('window.hide', { soft: true, mode: hostMode });
}

function isEditorVisuallyOpen(): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (softHidden) return false;
  if (mainWindow.isMinimized()) return false;
  return mainWindow.isVisible();
}

/** 始终显示（设置页「打开」等，不切换隐藏） */
export function showEditorWindow(): void {
  startHidden = false;
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  editorDiag('window.show', { soft: true, mode: hostMode, force: true });
  showWindow();
}

/** 显示 ↔ 隐藏（托盘热键 / 同进程直接调用） */
export function toggleEditorWindow(): void {
  startHidden = false;
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (isEditorVisuallyOpen()) {
    hideWindow();
  } else {
    editorDiag('window.show', { soft: true, mode: hostMode });
    showWindow();
  }
}

/** 托盘预热：创建后屏外停靠（opacity 1），热键只恢复 bounds */
export function warmEditorWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    editorDiag('warm.skip', { reason: 'already' });
    return;
  }
  startHidden = true;
  createWindow();
  editorDiag('warm.create', { mode: hostMode });
}

export function openEditorDir(dir: string): void {
  if (!dir || typeof dir !== 'string') {
    showWindow();
    return;
  }
  try {
    prefs = openIncomingDir(prefs, dir);
    persist();
    mainWindow?.webContents.send('nav:external-open', navSnapshot());
  } catch {
    /* ignore */
  }
  showWindow();
}

function createWindow(): void {
  const preload = editorPreloadPath();
  editorDiag('window.create', {
    preload,
    root: editorAppRoot(),
    startHidden,
    mode: hostMode,
  });

  const appIcon = resolveEnvAssetPath('icon', colorEnv());
  mainWindow = new BrowserWindow(
    framelessWindowOptions({
      width: 1280,
      height: 840,
      minWidth: 900,
      minHeight: 560,
      title: colorEnv() === 'test' ? 'Code Editor · 测试' : 'Code Editor',
      icon: appIcon,
      show: false,
      backgroundColor: windowBackgroundForTheme(sharedUi.theme),
      webPreferences: {
        preload,
      },
    }),
  );

  mainWindow.once('ready-to-show', () => {
    if (startHidden) {
      softHidden = true;
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          parkedBounds = {
            x: 80,
            y: 60,
            width: 1280,
            height: 840,
          };
          parkWindowOffscreen(mainWindow);
        }
      } catch {
        /* ignore */
      }
      editorDiag('window.warm-hidden', { soft: true, park: true });
      return;
    }
    showWindow();
  });
  attachMaximizedEvents(mainWindow);

  mainWindow.webContents.on('did-finish-load', () => {
    pushSharedUiToRenderer();
    // renderer mount may lag slightly
    setTimeout(pushSharedUiToRenderer, 120);
  });

  const devUrl = process.env.CODE_EDITOR_DEV_URL?.trim();
  if (devUrl && !app.isPackaged) {
    void mainWindow.loadURL(devUrl);
  } else {
    const index = rendererIndex();
    if (!fs.existsSync(index)) {
      editorDiag('ui.missing', { index });
      console.error('[editor] missing UI', index);
    }
    void mainWindow.loadFile(index);
  }

  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    hideWindow();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpc(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;

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

  ipcMain.handle('repo:list', () => navSnapshot().repos);

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
    if (!allowed) throw new Error('仓库不在当前工作区');
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
    return listDir(activeRoot(), relDir || '');
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
    ) => gitDiff(activeRoot(), relPath, opts),
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

  registerWindowIpc({
    getWindow: () => mainWindow,
    onClose: () => hideWindow(),
  });

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

  ipcMain.handle('editor:get-shared-settings', () => sharedUi);
}

export async function startEditorHost(
  opts: EditorHostOptions = {},
): Promise<void> {
  hostMode = opts.mode ?? 'standalone';
  startHidden = !!opts.startHidden;
  getSharedSettingsFn = opts.getSharedSettings ?? null;
  sharedUi = resolveInitialSharedUi();

  prefs = readWorkspacePrefs();
  unsubWorkspace?.();
  unsubWorkspace = onWorkspacePrefsChange((next) => {
    prefs = next;
    if (persistingLocal) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('nav:external-open', navSnapshot());
    }
  });

  const openDir =
    opts.openDir?.trim() ||
    process.env.CODE_EDITOR_OPEN_DIR?.trim() ||
    null;
  if (openDir) {
    initialOpenDir = openDir;
    try {
      prefs = openIncomingDir(prefs, openDir);
      persist();
    } catch {
      /* ignore */
    }
  }

  registerIpc();
  editorDiag('host.start', {
    mode: hostMode,
    root: editorAppRoot(),
    preload: editorPreloadPath(),
    startHidden,
  });

  // Embedded: don't create window until warm/toggle (faster tray boot).
  // Standalone: create immediately.
  if (hostMode === 'standalone') {
    createWindow();
  } else if (startHidden) {
    createWindow();
  }
}

export function shutdownEditorHost(): void {
  isQuitting = true;
  termBridge.disposeAll();
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.destroy();
    } catch {
      /* ignore */
    }
  }
  mainWindow = null;
}

export function registerEditorSecondInstanceHandlers(): void {
  app.on('second-instance', (_e, argv) => {
    const dir = argv.find(
      (a, i) =>
        i > 0 &&
        !a.startsWith('-') &&
        !a.endsWith('.exe') &&
        !a.includes('electron') &&
        !a.endsWith('.js'),
    );
    if (dir) {
      openEditorDir(dir);
      return;
    }
    toggleEditorWindow();
  });
}

export function registerEditorStandaloneLifecycle(): void {
  app.on('window-all-closed', () => {
    /* keep process for hotkey toggle when standalone */
  });

  app.on('activate', () => {
    if (!mainWindow) createWindow();
  });

  app.on('before-quit', () => {
    shutdownEditorHost();
  });
}
