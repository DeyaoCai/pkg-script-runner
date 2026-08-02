export type TRepoDto = {
  abs: string;
  rel: string;
  name: string;
  active: boolean;
};

export type TNavSnapshot = {
  workspaceRoot: string | null;
  cwd: string | null;
  projectRoot: string | null;
  boundRoot: string | null;
  cwdRel: string;
  canGoParent: boolean;
  projectLocked: boolean;
  recentFiles: string[];
  recentWorkspaces: string[];
  repos: TRepoDto[];
};

export type TFsEntryDto = {
  name: string;
  relPath: string;
  kind: 'file' | 'dir';
  isRepo?: boolean;
};

export type TGitChangeDto = {
  path: string;
  index: string;
  worktree: string;
  staged: boolean;
  unstaged: boolean;
};

export type TCodeEditorBridge = {
  /** Sync — set data-env / brand before paint. */
  getColorEnv: () => 'prod' | 'test';
  getNav: () => Promise<TNavSnapshot>;
  pickWorkspace: () => Promise<TNavSnapshot>;
  openWorkspace: (dir: string) => Promise<TNavSnapshot>;
  enterDir: (relOrAbs: string) => Promise<TNavSnapshot>;
  goParent: () => Promise<TNavSnapshot>;
  goWorkspaceRoot: () => Promise<TNavSnapshot>;
  goBoundRoot: () => Promise<TNavSnapshot>;
  selectRepo: (repoAbs: string) => Promise<TNavSnapshot>;
  isProject: (relPath: string) => Promise<boolean>;
  updateRecentFiles: (files: string[]) => Promise<TNavSnapshot>;
  getShellPrefs: () => Promise<{ open: boolean; columnsPerPage: number }>;
  setShellPrefs: (patch: {
    open?: boolean;
    columnsPerPage?: number;
  }) => Promise<{ open: boolean; columnsPerPage: number }>;
  getDesignRoot: () => Promise<string | null>;
  setDesignRoot: (abs: string | null) => Promise<string | null>;
  revealDesignRoot: () => Promise<void>;
  listDesignDir: (relDir?: string) => Promise<TFsEntryDto[]>;
  readDesignFile: (
    relPath: string,
  ) => Promise<
    | { ok: true; kind: 'text'; content: string; mtimeMs: number; size: number }
    | { ok: true; kind: 'binary'; mtimeMs: number; size: number }
    | { ok: false; error: string }
  >;
  writeDesignFile: (
    relPath: string,
    content: string,
  ) => Promise<{ mtimeMs: number }>;
  revealDesignPath: (relPath?: string | null) => Promise<void>;
  openDesignPath: (relPath: string) => Promise<void>;
  listDir: (relDir?: string) => Promise<TFsEntryDto[]>;
  isFile: (relPath: string) => Promise<boolean>;
  statFile: (
    relPath: string,
  ) => Promise<{ ok: true; mtimeMs: number; size: number } | { ok: false; error: string }>;
  readFile: (
    relPath: string,
  ) => Promise<
    | { ok: true; kind: 'text'; content: string; mtimeMs: number; size: number }
    | { ok: true; kind: 'binary'; mtimeMs: number; size: number }
    | { ok: false; error: string }
  >;
  writeFile: (
    relPath: string,
    content: string,
  ) => Promise<{ mtimeMs: number }>;
  saveAs: (defaultName?: string) => Promise<{ relPath: string } | null>;
  gitStatus: () => Promise<TGitChangeDto[]>;
  gitDiff: (
    relPath: string,
    opts?: { staged?: boolean; index?: string; worktree?: string },
  ) => Promise<string>;
  showItem: (relPath?: string | null) => Promise<void>;
  openPath: (relPath: string) => Promise<void>;
  getInitialOpenDir: () => Promise<string | null>;
  termStart: (
    cwd: string,
    size?: { cols?: number; rows?: number },
  ) => Promise<{ id: string; cwd: string; title: string }>;
  termWrite: (id: string, data: string) => Promise<boolean>;
  termResize: (id: string, cols: number, rows: number) => Promise<boolean>;
  termKill: (id: string) => Promise<boolean>;
  termKillAll: () => Promise<void>;
  termList: () => Promise<
    Array<{ id: string; cwd: string; title: string }>
  >;
  onTermData: (
    cb: (payload: { id: string; data: string }) => void,
  ) => () => void;
  onTermExit: (
    cb: (payload: { id: string; code: number | null }) => void,
  ) => () => void;
  onExternalNav?: (cb: (nav: TNavSnapshot) => void) => () => void;
} & import('@pkg-runner/shell/renderer').TWindowBridge;
