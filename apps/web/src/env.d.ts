/// <reference types="vite/client" />

export type ProjectPayload = {
  dir: string;
  name: string;
  packageManager: string;
  scripts: Array<{ name: string; command: string }>;
};

export type ProjectsState = {
  workspaceRoot: string | null;
  recentWorkspaces: string[];
  projects: Array<{
    dir: string;
    name: string;
    scriptCount: number;
    rel: string;
  }>;
  activeProject: string | null;
};

export type LogPayload =
  | { kind: 'system'; chunk: string }
  | { kind: 'job'; id: string; scriptName: string; dir: string; chunk: string };

export type JobInfo = { id: string; dir: string; scriptName: string };

export type PortOwner = 'self' | 'job' | 'shell' | 'unmanaged';

export type ClassifiedPort = {
  port: number;
  pid: number;
  processName: string;
  localAddress: string;
  owner: PortOwner;
  jobId?: string;
  shellId?: string;
};

export type PortsListResult = {
  ok: boolean;
  action: 'list';
  ports: ClassifiedPort[];
  orphans: number;
  error?: string;
  at: string;
};

export type PortsKillResult = {
  ok: boolean;
  action: 'kill';
  killed: Array<{
    ok: boolean;
    port?: number;
    pid?: number;
    processName?: string;
    error?: string;
  }>;
  error?: string;
  at: string;
};

export type PortsReapResult = {
  ok: boolean;
  action: 'reap';
  nodeOnly: boolean;
  killed: Array<{
    ok: boolean;
    port?: number;
    pid?: number;
    processName?: string;
    error?: string;
  }>;
  skipped: ClassifiedPort[];
  error?: string;
  at: string;
};

export type AppSettings = {
  fontId: string;
  glassAlpha: number;
  theme: 'dark' | 'light';
  brandTone: 'prod' | 'test';
  brandColor: string;
  shellMosaicCols: number;
  shellLayout: 'grid' | 'single';
  alwaysOnTop: boolean;
  activateHotkey: string;
  screenshotHotkey: string;
  screenshotHistoryLimit: number;
  persistLogs: boolean;
};

export type PkgRunnerColorEnv = 'prod' | 'test';

export type PkgRunnerApi = {
  /** Sync — apply before first paint (`data-env`). */
  getColorEnv: () => PkgRunnerColorEnv;
  getInitialDir: () => Promise<string | null>;
  getProjects: () => Promise<ProjectsState>;
  addProject: (dir: string) => Promise<{ dir: string; name: string }>;
  setActiveProject: (dir: string | null) => Promise<ProjectsState>;
  removeProject: (dir: string) => Promise<ProjectsState>;
  pickDir: () => Promise<string | null>;
  pickWorkspace: () => Promise<ProjectsState>;
  loadProject: (dir: string) => Promise<ProjectPayload>;
  runScript: (dir: string, scriptName: string) => Promise<string>;
  stop: (jobId?: string) => Promise<void>;
  shellOpen: (
    dir: string,
    size?: { cols?: number; rows?: number },
  ) => Promise<{ id: string; dir: string; cwd: string; title: string }>;
  shellWrite: (id: string, data: string) => Promise<boolean>;
  shellResize: (id: string, cols: number, rows: number) => Promise<boolean>;
  shellClose: (id: string) => Promise<boolean>;
  shellCwd: (id: string) => Promise<{ cwd: string; title: string; dir: string } | null>;
  getJobs: () => Promise<JobInfo[]>;
  getSettings: () => Promise<AppSettings>;
  openTraySettings: () => Promise<void>;
  requestTraySettingsPatch: (patch: Partial<AppSettings>) => Promise<void>;
  suspendHotkeys: () => Promise<void>;
  resumeHotkeys: () => Promise<void>;
  getPersistLogs: () => Promise<boolean>;
  openLogsDir: () => Promise<{ ok: boolean; dir: string; error: string | null }>;
  clearDiskLogs: () => Promise<{ ok: boolean; removed: number; dir: string }>;
  portsList: () => Promise<PortsListResult>;
  portsKill: (payload: {
    port?: number | null;
    pid?: number | null;
  }) => Promise<PortsKillResult>;
  portsReap: (payload?: { nodeOnly?: boolean }) => Promise<PortsReapResult>;
  openGlassLabs?: () => Promise<void>;
  openGlassLab?: (kind: string) => Promise<void>;
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<boolean>;
  windowClose: () => Promise<void>;
  windowIsMaximized: () => Promise<boolean>;
  windowDragStart?: (payload: { screenX: number; screenY: number }) => void;
  windowDragMove?: (payload: { screenX: number; screenY: number }) => void;
  windowDragEnd?: () => void;
  onMaximized: (cb: (maximized: boolean) => void) => () => void;
  onLog: (cb: (payload: LogPayload) => void) => () => void;
  onRunning: (cb: (running: boolean) => void) => () => void;
  onJobs: (cb: (jobs: JobInfo[]) => void) => () => void;
  onStopping: (cb: (ids: string[]) => void) => () => void;
  onExit: (
    cb: (payload: { id: string; scriptName: string; code: number | null }) => void,
  ) => () => void;
  onShellData: (cb: (payload: { id: string; data: string }) => void) => () => void;
  onOpenDir: (cb: (dir: string) => void) => () => void;
  onFocusSession: (cb: (payload: { id: string; dir: string | null }) => void) => () => void;
  onShellSession: (
    cb: (payload: { id: string; dir: string; cwd: string; title: string }) => void,
  ) => () => void;
  onSettings: (cb: (settings: AppSettings) => void) => () => void;
  onPersistLogs: (cb: (enabled: boolean) => void) => () => void;
  onProjects: (cb: (state: ProjectsState) => void) => () => void;
};

declare global {
  interface Window {
    pkgRunner: PkgRunnerApi;
  }
}

export {};
