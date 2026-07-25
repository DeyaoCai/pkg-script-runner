import { contextBridge, ipcRenderer } from 'electron';

export type ProjectPayload = {
  dir: string;
  name: string;
  packageManager: string;
  scripts: Array<{ name: string; command: string }>;
};

export type ProjectsState = {
  projects: Array<{ dir: string; name: string; scriptCount: number }>;
  activeProject: string | null;
};

export type LogPayload =
  | { kind: 'system'; chunk: string }
  | { kind: 'job'; id: string; scriptName: string; dir: string; chunk: string };

export type JobInfo = { id: string; dir: string; scriptName: string };

const api = {
  getInitialDir: (): Promise<string | null> => ipcRenderer.invoke('pkg:get-initial-dir'),
  getProjects: (): Promise<ProjectsState> => ipcRenderer.invoke('pkg:get-projects'),
  addProject: (dir: string): Promise<{ dir: string; name: string }> =>
    ipcRenderer.invoke('pkg:add-project', dir),
  setActiveProject: (dir: string | null): Promise<ProjectsState> =>
    ipcRenderer.invoke('pkg:set-active-project', dir),
  removeProject: (dir: string): Promise<ProjectsState> =>
    ipcRenderer.invoke('pkg:remove-project', dir),
  pickDir: (): Promise<string | null> => ipcRenderer.invoke('pkg:pick-dir'),
  loadProject: (dir: string): Promise<ProjectPayload> =>
    ipcRenderer.invoke('pkg:load', dir),
  runScript: (dir: string, scriptName: string): Promise<string> =>
    ipcRenderer.invoke('pkg:run', dir, scriptName),
  stop: (jobId?: string): Promise<void> => ipcRenderer.invoke('pkg:stop', jobId),
  shellOpen: (
    dir: string,
    size?: { cols?: number; rows?: number },
  ): Promise<{ id: string; dir: string; cwd: string; title: string }> =>
    ipcRenderer.invoke('pkg:shell-open', dir, size),
  shellWrite: (id: string, data: string): Promise<boolean> =>
    ipcRenderer.invoke('pkg:shell-write', id, data),
  shellResize: (id: string, cols: number, rows: number): Promise<boolean> =>
    ipcRenderer.invoke('pkg:shell-resize', id, cols, rows),
  shellClose: (id: string): Promise<boolean> => ipcRenderer.invoke('pkg:shell-close', id),
  shellCwd: (
    id: string,
  ): Promise<{ cwd: string; title: string; dir: string } | null> =>
    ipcRenderer.invoke('pkg:shell-cwd', id),
  getJobs: (): Promise<JobInfo[]> => ipcRenderer.invoke('pkg:get-jobs'),
  getSettings: (): Promise<{
    fontId: string;
    glassAlpha: number;
    theme: 'dark' | 'light';
    shellMosaicCols: number;
    shellLayout: 'grid' | 'single';
    alwaysOnTop: boolean;
    screenshotHotkey: string;
    activateHotkey: string;
    screenshotHistoryLimit: number;
  }> => ipcRenderer.invoke('pkg:get-settings'),
  setSettings: (
    patch: Partial<{
      fontId: string;
      glassAlpha: number;
      theme: 'dark' | 'light';
      shellMosaicCols: number;
      shellLayout: 'grid' | 'single';
      alwaysOnTop: boolean;
      screenshotHotkey: string;
      activateHotkey: string;
      screenshotHistoryLimit: number;
    }>,
  ): Promise<{
    settings: {
      fontId: string;
      glassAlpha: number;
      theme: 'dark' | 'light';
      shellMosaicCols: number;
      shellLayout: 'grid' | 'single';
      alwaysOnTop: boolean;
      screenshotHotkey: string;
      activateHotkey: string;
      screenshotHistoryLimit: number;
    };
    hotkeyError: string | null;
  }> => ipcRenderer.invoke('pkg:set-settings', patch),
  suspendHotkeys: (): Promise<void> => ipcRenderer.invoke('pkg:hotkeys-suspend'),
  resumeHotkeys: (): Promise<void> => ipcRenderer.invoke('pkg:hotkeys-resume'),
  startScreenshot: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('pkg:ss-start'),
  listScreenshotHistory: (): Promise<
    Array<{
      id: string;
      createdAt: number;
      text: string;
      captions: string[];
      thumbDataUrl: string;
    }>
  > => ipcRenderer.invoke('pkg:ss-history-list'),
  removeScreenshotHistory: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('pkg:ss-history-remove', id),
  clearScreenshotHistory: (): Promise<number> =>
    ipcRenderer.invoke('pkg:ss-history-clear'),
  copyScreenshotHistory: (
    id: string,
    which: 'image' | 'text' | 'both',
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('pkg:ss-history-copy', id, which),
  exportScreenshotHistory: (
    ids: string[],
    format: 'md' | 'html',
  ): Promise<{
    ok: boolean;
    error?: string;
    path?: string;
    count?: number;
    format?: string;
  }> => ipcRenderer.invoke('pkg:ss-history-export', { ids, format }),
  exportScreenshotMarkdown: (
    ids: string[],
  ): Promise<{
    ok: boolean;
    error?: string;
    path?: string;
    mdPath?: string;
    count?: number;
  }> => ipcRenderer.invoke('pkg:ss-history-export', { ids, format: 'md' }),
  getPersistLogs: (): Promise<boolean> => ipcRenderer.invoke('pkg:get-persist-logs'),
  setPersistLogs: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('pkg:set-persist-logs', enabled),
  openLogsDir: (): Promise<{ ok: boolean; dir: string; error: string | null }> =>
    ipcRenderer.invoke('pkg:open-logs-dir'),
  openScreenshotHistoryDir: (): Promise<{
    ok: boolean;
    dir: string;
    error: string | null;
  }> => ipcRenderer.invoke('pkg:open-ss-history-dir'),
  clearDiskLogs: (): Promise<{ ok: boolean; removed: number; dir: string }> =>
    ipcRenderer.invoke('pkg:clear-disk-logs'),
  openGlassLabs: (): Promise<void> => ipcRenderer.invoke('pkg:open-glass-labs'),
  openGlassLab: (kind: string): Promise<void> => ipcRenderer.invoke('pkg:open-glass-lab', kind),
  windowMinimize: (): Promise<void> => ipcRenderer.invoke('pkg:window-minimize'),
  windowMaximize: (): Promise<boolean> => ipcRenderer.invoke('pkg:window-maximize'),
  windowClose: (): Promise<void> => ipcRenderer.invoke('pkg:window-close'),
  windowIsMaximized: (): Promise<boolean> =>
    ipcRenderer.invoke('pkg:window-is-maximized'),
  windowDragStart: (payload: { screenX: number; screenY: number }): void => {
    ipcRenderer.send('pkg:window-drag-start', payload);
  },
  windowDragMove: (payload: { screenX: number; screenY: number }): void => {
    ipcRenderer.send('pkg:window-drag-move', payload);
  },
  windowDragEnd: (): void => {
    ipcRenderer.send('pkg:window-drag-end');
  },
  onMaximized: (cb: (maximized: boolean) => void) => {
    const handler = (_: unknown, maximized: boolean) => cb(maximized);
    ipcRenderer.on('pkg:maximized', handler);
    return () => ipcRenderer.removeListener('pkg:maximized', handler);
  },
  onLog: (cb: (payload: LogPayload) => void) => {
    const handler = (_: unknown, payload: LogPayload) => cb(payload);
    ipcRenderer.on('pkg:log', handler);
    return () => ipcRenderer.removeListener('pkg:log', handler);
  },
  onRunning: (cb: (running: boolean) => void) => {
    const handler = (_: unknown, running: boolean) => cb(running);
    ipcRenderer.on('pkg:running', handler);
    return () => ipcRenderer.removeListener('pkg:running', handler);
  },
  onJobs: (cb: (jobs: JobInfo[]) => void) => {
    const handler = (_: unknown, jobs: JobInfo[]) => cb(jobs);
    ipcRenderer.on('pkg:jobs', handler);
    return () => ipcRenderer.removeListener('pkg:jobs', handler);
  },
  onExit: (cb: (payload: { id: string; scriptName: string; code: number | null }) => void) => {
    const handler = (
      _: unknown,
      payload: { id: string; scriptName: string; code: number | null },
    ) => cb(payload);
    ipcRenderer.on('pkg:exit', handler);
    return () => ipcRenderer.removeListener('pkg:exit', handler);
  },
  onShellData: (cb: (payload: { id: string; data: string }) => void) => {
    const handler = (_: unknown, payload: { id: string; data: string }) => cb(payload);
    ipcRenderer.on('pkg:shell-data', handler);
    return () => ipcRenderer.removeListener('pkg:shell-data', handler);
  },
  onOpenDir: (cb: (dir: string) => void) => {
    const handler = (_: unknown, dir: string) => cb(dir);
    ipcRenderer.on('pkg:open-dir', handler);
    return () => ipcRenderer.removeListener('pkg:open-dir', handler);
  },
  onSettings: (
    cb: (settings: {
      fontId: string;
      glassAlpha: number;
      theme: 'dark' | 'light';
      shellMosaicCols: number;
      shellLayout: 'grid' | 'single';
      alwaysOnTop: boolean;
      screenshotHotkey: string;
      activateHotkey: string;
      screenshotHistoryLimit: number;
    }) => void,
  ) => {
    const handler = (
      _: unknown,
      settings: {
        fontId: string;
        glassAlpha: number;
        theme: 'dark' | 'light';
        shellMosaicCols: number;
        shellLayout: 'grid' | 'single';
        alwaysOnTop: boolean;
        screenshotHotkey: string;
        activateHotkey: string;
        screenshotHistoryLimit: number;
      },
    ) => cb(settings);
    ipcRenderer.on('pkg:settings', handler);
    return () => ipcRenderer.removeListener('pkg:settings', handler);
  },
  onOpenSettings: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('pkg:open-settings', handler);
    return () => ipcRenderer.removeListener('pkg:open-settings', handler);
  },
  onOpenScreenshotHistory: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('pkg:open-ss-history', handler);
    return () => ipcRenderer.removeListener('pkg:open-ss-history', handler);
  },
  onScreenshotHistoryChanged: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('pkg:ss-history', handler);
    return () => ipcRenderer.removeListener('pkg:ss-history', handler);
  },
  onPersistLogs: (cb: (enabled: boolean) => void) => {
    const handler = (_: unknown, enabled: boolean) => cb(enabled);
    ipcRenderer.on('pkg:persist-logs', handler);
    return () => ipcRenderer.removeListener('pkg:persist-logs', handler);
  },
  onProjects: (cb: (state: ProjectsState) => void) => {
    const handler = (_: unknown, state: ProjectsState) => cb(state);
    ipcRenderer.on('pkg:projects', handler);
    return () => ipcRenderer.removeListener('pkg:projects', handler);
  },
};

contextBridge.exposeInMainWorld('pkgRunner', api);

declare global {
  interface Window {
    pkgRunner: typeof api;
  }
}
