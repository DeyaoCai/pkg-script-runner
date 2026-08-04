/// <reference types="vite/client" />

import type { ZoneFile } from './ZonesShell/ZonesShellCtrl';

export type { ZoneFile };

export type ZonesPrefs = {
  customRoot: string | null;
  tracked: string[];
};

export type GroupCard = {
  id: string;
  title: string;
  rel: string;
  path: string;
  files: ZoneFile[];
};

export type ZonesScanResult = {
  mode: 'custom';
  root: string;
  hasRoot: boolean;
  loose: ZoneFile[];
  groups: GroupCard[];
  systemDesktop: ZoneFile[];
  systemDesktopRoot: string;
  prefs: ZonesPrefs;
  error?: string;
};

export type ListDirResult = {
  ok: boolean;
  path: string;
  name: string;
  files: ZoneFile[];
  error?: string;
};

export type PrefsResult = {
  ok: boolean;
  cancelled?: boolean;
  error?: string;
  prefs: ZonesPrefs;
};

export type WallpaperItem = {
  name: string;
  path: string;
  thumb: string;
};

export type AppBackgroundState = {
  name: string | null;
  url: string | null;
};

export type JimengFavoriteItem = {
  id: string;
  title: string;
  coverUrl: string;
  downloadUrl: string;
  author?: string;
  source?: 'favorite' | 'home';
};

export type JimengFavoritesCache = {
  updatedAt: string;
  items: JimengFavoriteItem[];
};

export type JimengSyncResult = {
  ok: boolean;
  needLogin?: boolean;
  error?: string;
  items: JimengFavoriteItem[];
  capturedUrls?: string[];
};

export type JimengDownloadResult = {
  ok: boolean;
  error?: string;
  path?: string;
  skipped?: boolean;
  name?: string;
};

export type JimengHubEvent = {
  kind: 'snapshot' | 'items_patch' | 'status';
  updatedAt?: string;
  items?: JimengFavoriteItem[];
  message?: string;
  needLogin?: boolean;
  error?: string;
  source?: string;
  capturedUrl?: string;
  seq?: number;
  serverTs?: string;
};

export type JimengLayoutState = {
  open: boolean;
  top: number;
  jimengWidth: number;
  zonesWidth: number;
  splitRatio: number;
};

export type DesktopZonesApi = {
  getColorEnv: () => 'prod' | 'test';
  getSharedSettings: () => Promise<unknown>;
  onSharedSettings: (cb: (settings: unknown) => void) => () => void;
  scan: () => Promise<ZonesScanResult>;
  listDir: (dirPath: string) => Promise<ListDirResult>;
  getPrefs: () => Promise<ZonesPrefs>;
  setCustomRoot: () => Promise<PrefsResult>;
  clearCustomRoot: () => Promise<PrefsResult>;
  addTracked: (opts?: { name?: string; path?: string }) => Promise<PrefsResult>;
  removeTracked: (rel: string) => Promise<PrefsResult>;
  open: (filePath: string) => Promise<unknown>;
  reveal: (filePath: string) => Promise<unknown>;
  undoOrganize: () => Promise<{
    ok: boolean;
    restored?: number;
    skipped?: unknown[];
    error?: string;
  }>;
  undoAvailable: () => Promise<boolean>;
  rename: (
    target: string,
    newName: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  trash: (target: string) => Promise<{ ok: boolean; error?: string }>;
  moveIntoGroup: (
    from: string,
    groupRel: string,
  ) => Promise<{ ok: boolean; to?: string; error?: string }>;
  moveIntoDir: (
    from: string,
    destDir: string,
  ) => Promise<{ ok: boolean; to?: string; error?: string }>;
  openDesktop: () => Promise<unknown>;
  listWallpapers: () => Promise<WallpaperItem[]>;
  setWallpaper: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
  getAppBackground: () => Promise<AppBackgroundState>;
  setAppBackground: (
    nameOrPath: string | null,
  ) => Promise<AppBackgroundState & { ok: boolean; error?: string }>;
  openWallpapersFolder: () => Promise<unknown>;
  openJimeng: (url?: string) => Promise<{
    ok: boolean;
    error?: string;
    layout?: JimengLayoutState;
  }>;
  hideJimeng: (opts?: { restoreHost?: boolean }) => Promise<{ ok: boolean; layout?: JimengLayoutState }>;
  getJimengLayout: () => Promise<JimengLayoutState>;
  setShellMode: (mode: 'desktop' | 'jimeng') => Promise<{
    ok: boolean;
    mode: 'desktop' | 'jimeng';
    error?: string;
    layout?: JimengLayoutState;
  }>;
  onJimengLayout: (cb: (layout: JimengLayoutState) => void) => () => void;
  onShellMode: (cb: (mode: 'desktop' | 'jimeng') => void) => () => void;
  getJimengFavoritesCache: () => Promise<JimengFavoritesCache>;
  syncJimengFavorites: () => Promise<JimengSyncResult>;
  /** Prefer plain id string (IPC-safe). Object form accepted for compat. */
  downloadJimengFavorite: (idOrItem: string | JimengFavoriteItem) => Promise<JimengDownloadResult>;
  downloadJimengFavorites: (
    ids?: string[],
  ) => Promise<{
    ok: boolean;
    downloaded: number;
    skipped: number;
    failed: number;
    error?: string;
  }>;
  startJimengSse: () => Promise<{ ok: boolean; error?: string }>;
  stopJimengSse: () => Promise<{ ok: boolean }>;
  getJimengControlEndpoint: () => Promise<{
    ok: boolean;
    baseUrl?: string;
    pid?: number;
    error?: string;
  }>;
  onJimengHub: (cb: (ev: JimengHubEvent) => void) => () => void;
  quit: () => Promise<unknown>;
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<boolean>;
  windowClose: () => Promise<void>;
  windowIsMaximized: () => Promise<boolean>;
  onMaximizedChange: (cb: (maximized: boolean) => void) => () => void;
};

declare global {
  interface Window {
    desktopZones: DesktopZonesApi;
  }
}

export {};
