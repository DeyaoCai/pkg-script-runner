import { contextBridge, ipcRenderer } from 'electron';
import { createWindowPreloadApi } from '@pkg-runner/shell/preload';

const api = {
  getNav: () => ipcRenderer.invoke('nav:get'),
  pickWorkspace: () => ipcRenderer.invoke('workspace:pick'),
  openWorkspace: (dir: string) => ipcRenderer.invoke('workspace:open', dir),
  enterDir: (relOrAbs: string) => ipcRenderer.invoke('nav:enter', relOrAbs),
  goParent: () => ipcRenderer.invoke('nav:parent'),
  goWorkspaceRoot: () => ipcRenderer.invoke('nav:workspace-root'),
  goBoundRoot: () => ipcRenderer.invoke('nav:bound-root'),
  selectRepo: (repoAbs: string) => ipcRenderer.invoke('repo:select', repoAbs),
  isProject: (relPath: string) => ipcRenderer.invoke('nav:is-project', relPath),
  updateRecentFiles: (files: string[]) =>
    ipcRenderer.invoke('prefs:recent-files', files),
  getShellPrefs: () => ipcRenderer.invoke('prefs:shell-get'),
  setShellPrefs: (patch: { open?: boolean; columnsPerPage?: number }) =>
    ipcRenderer.invoke('prefs:shell-set', patch),
  getDesignRoot: () => ipcRenderer.invoke('design:get-root'),
  setDesignRoot: (abs: string | null) =>
    ipcRenderer.invoke('design:set-root', abs),
  revealDesignRoot: () => ipcRenderer.invoke('design:reveal-root'),
  listDesignDir: (relDir?: string) =>
    ipcRenderer.invoke('design:list', relDir),
  readDesignFile: (relPath: string) =>
    ipcRenderer.invoke('design:read', relPath),
  writeDesignFile: (relPath: string, content: string) =>
    ipcRenderer.invoke('design:write', relPath, content),
  revealDesignPath: (relPath?: string | null) =>
    ipcRenderer.invoke('design:reveal', relPath ?? null),
  openDesignPath: (relPath: string) =>
    ipcRenderer.invoke('design:openPath', relPath),
  listDir: (relDir?: string) => ipcRenderer.invoke('fs:list', relDir),
  isFile: (relPath: string) => ipcRenderer.invoke('fs:is-file', relPath),
  statFile: (relPath: string) => ipcRenderer.invoke('fs:stat', relPath),
  readFile: (relPath: string) => ipcRenderer.invoke('fs:read', relPath),
  writeFile: (relPath: string, content: string) =>
    ipcRenderer.invoke('fs:write', relPath, content),
  saveAs: (defaultName?: string) => ipcRenderer.invoke('fs:save-as', defaultName),
  gitStatus: () => ipcRenderer.invoke('git:status'),
  gitDiff: (
    relPath: string,
    opts?: { staged?: boolean; index?: string; worktree?: string },
  ) => ipcRenderer.invoke('git:diff', relPath, opts ?? {}),
  showItem: (relPath?: string | null) =>
    ipcRenderer.invoke('shell:showItem', relPath ?? null),
  openPath: (relPath: string) => ipcRenderer.invoke('shell:openPath', relPath),
  getInitialOpenDir: () => ipcRenderer.invoke('app:initial-open-dir'),
  termStart: (cwd: string, size?: { cols?: number; rows?: number }) =>
    ipcRenderer.invoke('term:start', cwd, size),
  termWrite: (id: string, data: string) =>
    ipcRenderer.invoke('term:write', id, data),
  termResize: (id: string, cols: number, rows: number) =>
    ipcRenderer.invoke('term:resize', id, cols, rows),
  termKill: (id: string) => ipcRenderer.invoke('term:kill', id),
  termKillAll: () => ipcRenderer.invoke('term:kill-all'),
  termList: () => ipcRenderer.invoke('term:list'),
  onTermData: (cb: (payload: { id: string; data: string }) => void) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      payload: { id: string; data: string },
    ) => {
      cb(payload);
    };
    ipcRenderer.on('term:data', handler);
    return () => {
      ipcRenderer.removeListener('term:data', handler);
    };
  },
  onTermExit: (cb: (payload: { id: string; code: number | null }) => void) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      payload: { id: string; code: number | null },
    ) => {
      cb(payload);
    };
    ipcRenderer.on('term:exit', handler);
    return () => {
      ipcRenderer.removeListener('term:exit', handler);
    };
  },
  ...createWindowPreloadApi(ipcRenderer),
};

contextBridge.exposeInMainWorld('codeEditor', api);
