/// <reference types="vite/client" />

import type { MoveOp, ZoneBucket, ZoneFile } from './ZonesShell/ZonesShellCtrl';

export type { MoveOp, ZoneBucket, ZoneFile };

export type ZonesScanResult = {
  root: string;
  zones: ZoneBucket[];
  error?: string;
};

export type DesktopZonesApi = {
  getColorEnv: () => 'prod' | 'test';
  getSharedSettings: () => Promise<unknown>;
  onSharedSettings: (cb: (settings: unknown) => void) => () => void;
  scan: () => Promise<ZonesScanResult>;
  open: (filePath: string) => Promise<unknown>;
  reveal: (filePath: string) => Promise<unknown>;
  previewOrganize: () => Promise<{
    ops: MoveOp[];
    error?: string;
  }>;
  applyOrganize: (ops: MoveOp[]) => Promise<{
    moved: number;
    failed?: Array<{ from: string; error: string }>;
  }>;
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
  openDesktop: () => Promise<unknown>;
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
