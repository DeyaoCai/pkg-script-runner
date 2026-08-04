/**
 * Jimeng admin = follower BrowserWindow (跟屁虫).
 * Zones is the product frontend; Jimeng opens on demand beside it.
 * Zones title bar never covers Jimeng.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, screen, session, type WebContents } from 'electron';
import {
  registerJimengCaptureIpc,
  startJimengNetworkTap,
  stopJimengNetworkTap,
} from './jimengIntercept.js';

const __dirnameJimeng = path.dirname(fileURLToPath(import.meta.url));

function jimengPagePreloadPath(): string {
  const candidates = [
    path.join(__dirnameJimeng, 'zones', 'jimengPagePreload.cjs'),
    path.join(__dirnameJimeng, 'jimengPagePreload.cjs'),
    path.join(__dirnameJimeng, 'jimeng-page-preload.cjs'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  console.error('[jimeng] missing page preload', candidates);
  return candidates[0]!;
}

export const JIMENG_PARTITION = 'persist:jimeng';
export const JIMENG_HOME_URL = 'https://jimeng.jianying.com/ai-tool/home';

export const JIMENG_FAVORITES_URLS = [
  'https://jimeng.jianying.com/ai-tool/asset?tab=favorite',
  'https://jimeng.jianying.com/ai-tool/asset?tab=collect',
  'https://jimeng.jianying.com/ai-tool/favorite',
  'https://jimeng.jianying.com/ai-tool/personal/favorite',
  'https://jimeng.jianying.com/ai-tool/profile/favorite',
  'https://jimeng.jianying.com/ai-tool/user/favorite',
] as const;

export const JIMENG_FAVORITE_LIST_API =
  'https://jimeng.jianying.com/mweb/v1/get_favorite_list';
export const JIMENG_FAVORITE_LIST_QUERY =
  'aid=513695&web_version=7.5.0&da_version=3.3.23&aigc_features=app_lip_sync';

const MIN_W = 720;
const MIN_H = 640;
const DEFAULT_W = 960;
const DEFAULT_H = 780;
const GAP = 4;

/** Compat shape for renderer (open = follower visible). */
export type JimengLayout = {
  open: boolean;
  top: number;
  jimengWidth: number;
  zonesWidth: number;
  splitRatio: number;
};

export type JimengSurface = {
  webContents: WebContents;
  loadURL: (url: string) => Promise<void>;
  show: () => void;
  focus: () => void;
  isDestroyed: () => boolean;
};

let hostGetter: (() => BrowserWindow | null) | null = null;
let onLayout: ((layout: JimengLayout) => void) | null = null;
let jimengWin: BrowserWindow | null = null;
let followHooked: BrowserWindow | null = null;
let relocating = false;

export function getJimengSession() {
  return session.fromPartition(JIMENG_PARTITION);
}

export function setJimengHostWindow(getWin: () => BrowserWindow | null): void {
  hostGetter = getWin;
}

export function setJimengLayoutListener(cb: ((layout: JimengLayout) => void) | null): void {
  onLayout = cb;
}

/** @deprecated */
export function setJimengVisibilityListener(cb: ((visible: boolean) => void) | null): void {
  if (!cb) {
    onLayout = null;
    return;
  }
  onLayout = (layout) => cb(layout.open);
}

function hostWindow(): BrowserWindow | null {
  const win = hostGetter?.() ?? null;
  if (!win || win.isDestroyed()) return null;
  return win;
}

function pushLayout(): void {
  try {
    onLayout?.(getJimengLayout());
  } catch {
    /* ignore */
  }
}

export function isJimengEmbeddedVisible(): boolean {
  return !!jimengWin && !jimengWin.isDestroyed() && jimengWin.isVisible();
}

export function getJimengLayout(): JimengLayout {
  const host = hostWindow();
  const [cw] = host?.getContentSize() ?? [0, 0];
  const open = isJimengEmbeddedVisible();
  const jb = jimengWin && !jimengWin.isDestroyed() ? jimengWin.getBounds() : null;
  return {
    open,
    top: 0,
    jimengWidth: open && jb ? jb.width : 0,
    zonesWidth: Math.max(0, cw),
    splitRatio: 0,
  };
}

/** @deprecated no-op — follower is not an in-host split */
export function setJimengSplitRatio(ratio: number): number {
  return ratio;
}

function statePath(): string {
  return path.join(app.getPath('userData'), 'jimeng-window.json');
}

function readSavedSize(): { width: number; height: number } {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), 'utf8')) as {
      width?: number;
      height?: number;
    };
    const width = Math.max(MIN_W, Number(raw.width) || DEFAULT_W);
    const height = Math.max(MIN_H, Number(raw.height) || DEFAULT_H);
    return { width, height };
  } catch {
    return { width: DEFAULT_W, height: DEFAULT_H };
  }
}

function saveSize(win: BrowserWindow): void {
  try {
    const b = win.getBounds();
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(
      statePath(),
      JSON.stringify({ width: b.width, height: b.height }, null, 2),
      'utf8',
    );
  } catch {
    /* ignore */
  }
}

/** Place follower beside Zones (prefer right; left if no room). */
function followerBoundsBesideHost(host: BrowserWindow): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const hb = host.getBounds();
  const saved = readSavedSize();
  const display = screen.getDisplayMatching(hb);
  const wa = display.workArea;

  let width = Math.min(saved.width, Math.max(MIN_W, wa.width - 80));
  let height = Math.min(saved.height, Math.max(MIN_H, wa.height - 40));
  height = Math.min(height, Math.max(MIN_H, hb.height));

  const rightX = hb.x + hb.width + GAP;
  const leftX = hb.x - width - GAP;
  const roomRight = wa.x + wa.width - rightX;
  const roomLeft = leftX - wa.x;

  let x: number;
  if (roomRight >= width) x = rightX;
  else if (roomLeft >= width) x = leftX;
  else {
    // Shrink to fit on the side with more space.
    if (roomRight >= roomLeft) {
      width = Math.max(MIN_W, roomRight);
      x = rightX;
    } else {
      width = Math.max(MIN_W, roomLeft);
      x = Math.max(wa.x, hb.x - width - GAP);
    }
  }

  let y = hb.y;
  if (y + height > wa.y + wa.height) y = Math.max(wa.y, wa.y + wa.height - height);
  if (y < wa.y) y = wa.y;

  return { x, y, width, height };
}

function relocateFollower(): void {
  if (relocating) return;
  const host = hostWindow();
  const win = jimengWin;
  if (!host || !win || win.isDestroyed() || !win.isVisible()) return;
  relocating = true;
  try {
    win.setBounds(followerBoundsBesideHost(host), false);
  } finally {
    relocating = false;
  }
  pushLayout();
}

function unhookFollow(): void {
  if (!followHooked || followHooked.isDestroyed()) {
    followHooked = null;
    return;
  }
  followHooked.removeListener('move', relocateFollower);
  followHooked.removeListener('resize', relocateFollower);
  followHooked = null;
}

function hookFollow(host: BrowserWindow): void {
  if (followHooked === host) return;
  unhookFollow();
  followHooked = host;
  host.on('move', relocateFollower);
  host.on('resize', relocateFollower);
}

function surfaceFromWin(win: BrowserWindow): JimengSurface {
  const wc = win.webContents;
  return {
    webContents: wc,
    loadURL: (url: string) => wc.loadURL(url),
    show: () => {
      void ensureJimengSurface({ reveal: true });
    },
    focus: () => {
      if (!win.isDestroyed()) {
        win.show();
        win.focus();
      }
    },
    isDestroyed: () => win.isDestroyed(),
  };
}

function createJimengBrowserWindow(): BrowserWindow {
  registerJimengCaptureIpc();
  const preload = jimengPagePreloadPath();
  const { width, height } = readSavedSize();
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    minWidth: MIN_W,
    minHeight: MIN_H,
    // Native frame: not Zones TitleBar — never covered by Zones chrome.
    frame: true,
    autoHideMenuBar: true,
    backgroundColor: '#0f1115',
    title: '即梦（管理）',
    webPreferences: {
      partition: JIMENG_PARTITION,
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.on('resize', () => {
    if (!relocating && win.isVisible()) saveSize(win);
  });
  win.on('closed', () => {
    try {
      stopJimengNetworkTap(win.webContents);
    } catch {
      /* ignore */
    }
    if (jimengWin === win) jimengWin = null;
    unhookFollow();
    pushLayout();
  });

  void win.webContents.loadURL(JIMENG_HOME_URL);
  void startJimengNetworkTap(win.webContents);
  return win;
}

function ensureJimengBrowserWindow(): BrowserWindow {
  if (jimengWin && !jimengWin.isDestroyed()) return jimengWin;
  jimengWin = createJimengBrowserWindow();
  return jimengWin;
}

/**
 * Ensure Jimeng admin window exists.
 * reveal: show follower beside Zones.
 */
export function ensureJimengSurface(opts?: {
  url?: string;
  reveal?: boolean;
}): JimengSurface {
  const win = ensureJimengBrowserWindow();
  const target = (opts?.url && opts.url.trim()) || '';
  if (target && win.webContents.getURL() !== target) {
    void win.webContents.loadURL(target);
  }
  void startJimengNetworkTap(win.webContents);

  if (opts?.reveal) {
    const host = hostWindow();
    if (host) {
      hookFollow(host);
      win.setBounds(followerBoundsBesideHost(host), false);
    }
    win.show();
    win.focus();
    pushLayout();
  }
  return surfaceFromWin(win);
}

export function showJimengEmbedded(url?: string): JimengSurface {
  return ensureJimengSurface({ url, reveal: true });
}

/** Hide follower (does not destroy — keeps session). */
export function hideJimengEmbedded(_opts?: { restoreHost?: boolean }): void {
  const win = jimengWin;
  if (win && !win.isDestroyed()) {
    saveSize(win);
    win.hide();
  }
  pushLayout();
}

export function getJimengWindow(): JimengSurface | null {
  if (!jimengWin || jimengWin.isDestroyed()) return null;
  return surfaceFromWin(jimengWin);
}

export function getJimengWebContents(): WebContents | null {
  if (!jimengWin || jimengWin.isDestroyed()) return null;
  return jimengWin.webContents;
}

export function openJimengWindow(url?: string): JimengSurface {
  return showJimengEmbedded(url);
}

export function closeJimengWindow(): void {
  const win = jimengWin;
  jimengWin = null;
  unhookFollow();
  if (!win || win.isDestroyed()) {
    pushLayout();
    return;
  }
  try {
    saveSize(win);
    stopJimengNetworkTap(win.webContents);
  } catch {
    /* ignore */
  }
  try {
    win.destroy();
  } catch {
    /* ignore */
  }
  pushLayout();
}
