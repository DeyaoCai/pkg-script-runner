/// <reference types="vite/client" />

export type SharedSettings = {
  screenshotHotkey: string;
  activateHotkey: string;
  editorHotkey: string;
  hotkeysEnabled: boolean;
  screenshotHistoryLimit: number;
  fontId: string;
  glassAlpha: number;
  theme: 'dark' | 'light';
  brandTone: 'prod' | 'test';
  brandColor: string;
  shellMosaicCols: number;
  shellLayout: 'grid' | 'single';
  alwaysOnTop: boolean;
  persistLogs: boolean;
};

export type TrayProfileInfo = {
  profile: string;
  colorEnv: 'prod' | 'test';
  userData: string;
  settingsPath: string;
  packaged: boolean;
};

export type ScreenshotHistoryItem = {
  id: string;
  createdAt: number;
  text: string;
  captions: string[];
  thumbDataUrl: string;
};

export type TrayApi = {
  getSettings: () => Promise<SharedSettings>;
  getProfile: () => Promise<TrayProfileInfo>;
  setSettings: (
    patch: Partial<SharedSettings>,
  ) => Promise<{ settings: SharedSettings; hotkeyError: string | null }>;
  suspendHotkeys: () => Promise<void>;
  resumeHotkeys: () => Promise<{
    ok: boolean;
    screenshotError: string | null;
    activateError: string | null;
    editorError: string | null;
  }>;
  startScreenshot: () => Promise<{ ok: boolean; error?: string }>;
  listScreenshotHistory: () => Promise<ScreenshotHistoryItem[]>;
  removeScreenshotHistory: (id: string) => Promise<boolean>;
  clearScreenshotHistory: () => Promise<number>;
  copyScreenshotHistory: (
    id: string,
    which: 'image' | 'text' | 'both',
  ) => Promise<{ ok: boolean; error?: string }>;
  exportScreenshotHistory: (
    ids: string[],
    format: 'md' | 'html',
  ) => Promise<{
    ok: boolean;
    error?: string;
    path?: string;
    count?: number;
    format?: string;
  }>;
  openScreenshotHistoryDir: () => Promise<{
    ok: boolean;
    dir: string;
    error: string | null;
  }>;
  closeWindow: () => Promise<void>;
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<boolean>;
  windowClose: () => Promise<void>;
  windowIsMaximized: () => Promise<boolean>;
  onMaximizedChange: (cb: (maximized: boolean) => void) => () => void;
  showRunner: () => Promise<{ ok: boolean }>;
  showEditor: () => Promise<{ ok: boolean }>;
  showZones: () => Promise<{ ok: boolean }>;
  diagLog: (event: string, detail?: unknown) => Promise<void>;
  openDiagLog: () => Promise<string>;
  getDiagTail: (maxLines?: number) => Promise<string>;
  onSettings: (cb: (settings: SharedSettings) => void) => () => void;
  onHistoryChanged: (cb: () => void) => () => void;
};

declare global {
  interface Window {
    trayApi?: TrayApi;
    __bootEnv?: 'prod' | 'test';
    __applyTraySettings?: (settings: SharedSettings) => void;
    __applyTrayProfile?: (profile: TrayProfileInfo) => void;
  }
}

export {};
