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

type SettingsPayload = {
  fontId: string;
  glassAlpha: number;
  theme: 'dark' | 'light';
  shellMosaicCols: number;
  shellLayout: 'grid' | 'single';
  alwaysOnTop: boolean;
  activateHotkey: string;
  screenshotHotkey: string;
  screenshotHistoryLimit: number;
  persistLogs: boolean;
};

function onChannel<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_event: unknown, payload: T) => {
    try {
      // 渲染回调若 return Vue Proxy，contextBridge 会尝试克隆返回值 → "could not be cloned"
      // 用独立包装函数确保 preload 侧永不把回调返回值向外抛
      const run = cb as (p: T) => unknown;
      void run(payload);
    } catch (err) {
      console.error(`[pkgRunner] ${channel} handler`, err);
    }
  };
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api = {
  getInitialDir: (): Promise<string | null> =>
    ipcRenderer.invoke('pkg:get-initial-dir'),
  getProjects: (): Promise<ProjectsState> =>
    ipcRenderer.invoke('pkg:get-projects'),
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
  shellClose: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('pkg:shell-close', id),
  shellCwd: (
    id: string,
  ): Promise<{ cwd: string; title: string; dir: string } | null> =>
    ipcRenderer.invoke('pkg:shell-cwd', id),
  getJobs: (): Promise<JobInfo[]> => ipcRenderer.invoke('pkg:get-jobs'),
  getSettings: (): Promise<SettingsPayload> =>
    ipcRenderer.invoke('pkg:get-settings'),
  openTraySettings: (): Promise<void> =>
    ipcRenderer.invoke('pkg:open-tray-settings'),
  requestTraySettingsPatch: (patch: Record<string, unknown>): Promise<void> =>
    ipcRenderer.invoke('pkg:request-tray-settings-patch', patch),
  suspendHotkeys: (): Promise<void> =>
    ipcRenderer.invoke('pkg:hotkeys-suspend'),
  resumeHotkeys: (): Promise<void> => ipcRenderer.invoke('pkg:hotkeys-resume'),
  getPersistLogs: (): Promise<boolean> =>
    ipcRenderer.invoke('pkg:get-persist-logs'),
  openLogsDir: (): Promise<{ ok: boolean; dir: string; error: string | null }> =>
    ipcRenderer.invoke('pkg:open-logs-dir'),
  clearDiskLogs: (): Promise<{ ok: boolean; removed: number; dir: string }> =>
    ipcRenderer.invoke('pkg:clear-disk-logs'),
  openGlassLabs: (): Promise<void> =>
    ipcRenderer.invoke('pkg:open-glass-labs'),
  openGlassLab: (kind: string): Promise<void> =>
    ipcRenderer.invoke('pkg:open-glass-lab', kind),
  windowMinimize: (): Promise<void> =>
    ipcRenderer.invoke('pkg:window-minimize'),
  windowMaximize: (): Promise<boolean> =>
    ipcRenderer.invoke('pkg:window-maximize'),
  windowClose: (): Promise<void> => ipcRenderer.invoke('pkg:window-close'),
  windowIsMaximized: (): Promise<boolean> =>
    ipcRenderer.invoke('pkg:window-is-maximized'),
  windowDragStart: (payload: { screenX: number; screenY: number }): void => {
    ipcRenderer.send('pkg:window-drag-start', {
      screenX: payload.screenX,
      screenY: payload.screenY,
    });
  },
  windowDragMove: (payload: { screenX: number; screenY: number }): void => {
    ipcRenderer.send('pkg:window-drag-move', {
      screenX: payload.screenX,
      screenY: payload.screenY,
    });
  },
  windowDragEnd: (): void => {
    ipcRenderer.send('pkg:window-drag-end');
  },
  onMaximized: (cb: (maximized: boolean) => void) =>
    onChannel<boolean>('pkg:maximized', cb),
  onLog: (cb: (payload: LogPayload) => void) =>
    onChannel<LogPayload>('pkg:log', cb),
  onRunning: (cb: (running: boolean) => void) =>
    onChannel<boolean>('pkg:running', cb),
  onJobs: (cb: (jobs: JobInfo[]) => void) => onChannel<JobInfo[]>('pkg:jobs', cb),
  onExit: (
    cb: (payload: { id: string; scriptName: string; code: number | null }) => void,
  ) =>
    onChannel<{ id: string; scriptName: string; code: number | null }>(
      'pkg:exit',
      cb,
    ),
  onShellData: (cb: (payload: { id: string; data: string }) => void) =>
    onChannel<{ id: string; data: string }>('pkg:shell-data', cb),
  onOpenDir: (cb: (dir: string) => void) => onChannel<string>('pkg:open-dir', cb),
  onSettings: (cb: (settings: SettingsPayload) => void) =>
    onChannel<SettingsPayload>('pkg:settings', cb),
  onPersistLogs: (cb: (enabled: boolean) => void) =>
    onChannel<boolean>('pkg:persist-logs', cb),
  onProjects: (cb: (state: ProjectsState) => void) =>
    onChannel<ProjectsState>('pkg:projects', cb),
};

try {
  contextBridge.exposeInMainWorld('pkgRunner', api);
} catch (err) {
  console.error('[pkgRunner] exposeInMainWorld failed', err);
}
