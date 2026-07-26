import fs from 'node:fs';
import path from 'node:path';

/** Per-workspace persisted navigation / recent files. */
export type TWorkspaceSlot = {
  projectRoot: string | null;
  cwd: string | null;
  recentFiles: string[];
  /** Design zone repo for this workspace */
  designRoot: string | null;
};

export type TPrefs = {
  workspaceRoot: string | null;
  /** absolute cwd; must stay under bound root */
  cwd: string | null;
  /** when set, FS/git are locked to this repository root */
  projectRoot: string | null;
  recentFiles: string[];
  recentWorkspaces: string[];
  /** keyed by resolved workspace absolute path */
  workspaces: Record<string, TWorkspaceSlot>;
  /** bottom shell panel open */
  shellOpen: boolean;
  /** shells shown side-by-side per page (1–4) */
  shellColumnsPerPage: number;
  /** Design zone repo root (independent of Review repo) */
  designRoot: string | null;
};

export type TShellPrefs = {
  open: boolean;
  columnsPerPage: number;
};

const DEFAULT_PREFS: TPrefs = {
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

export function clampShellColumns(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 1;
  return Math.max(1, Math.min(4, v));
}

export function shellPrefsOf(prefs: TPrefs): TShellPrefs {
  return {
    open: !!prefs.shellOpen,
    columnsPerPage: clampShellColumns(prefs.shellColumnsPerPage),
  };
}

export function patchShellPrefs(
  prefs: TPrefs,
  patch: Partial<TShellPrefs>,
): TPrefs {
  return {
    ...prefs,
    shellOpen:
      typeof patch.open === 'boolean' ? patch.open : !!prefs.shellOpen,
    shellColumnsPerPage:
      patch.columnsPerPage !== undefined
        ? clampShellColumns(patch.columnsPerPage)
        : clampShellColumns(prefs.shellColumnsPerPage),
  };
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

function real(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

/** True if dir is a Git repository root (has its own .git). */
export function isRepoDir(dir: string): boolean {
  try {
    const abs = path.resolve(dir);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return false;
    return fs.existsSync(path.join(abs, '.git'));
  } catch {
    return false;
  }
}

/**
 * Selectable "仓库" under a workspace: nested git root, or a package root
 * (package.json). Workspace itself is always selectable separately.
 */
export function isSelectableRepo(dir: string): boolean {
  try {
    const abs = path.resolve(dir);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return false;
    if (isRepoDir(abs)) return true;
    return fs.existsSync(path.join(abs, 'package.json'));
  } catch {
    return false;
  }
}

/** @deprecated alias — lock target is selectable repo root */
export const isProjectDir = isSelectableRepo;

/** Bound root: repo lock if any, else workspace. */
export function boundRoot(prefs: TPrefs): string | null {
  return prefs.projectRoot || prefs.workspaceRoot;
}

function isInside(root: string, target: string): boolean {
  const r = real(root);
  const t = real(target);
  const rel = path.relative(r, t);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function findSlotKey(
  workspaces: Record<string, TWorkspaceSlot>,
  root: string,
): string | null {
  for (const k of Object.keys(workspaces)) {
    if (samePath(k, root)) return k;
  }
  return null;
}

function getSlot(
  workspaces: Record<string, TWorkspaceSlot>,
  root: string,
): TWorkspaceSlot | null {
  const key = findSlotKey(workspaces, root);
  return key ? workspaces[key]! : null;
}

function putSlot(
  workspaces: Record<string, TWorkspaceSlot>,
  root: string,
  slot: TWorkspaceSlot,
): Record<string, TWorkspaceSlot> {
  const next = { ...workspaces };
  for (const k of Object.keys(next)) {
    if (samePath(k, root)) delete next[k];
  }
  next[path.resolve(root)] = slot;
  return next;
}

/** Write active flat fields back into workspaces[workspaceRoot]. */
export function persistActiveSlot(prefs: TPrefs): TPrefs {
  if (!prefs.workspaceRoot) return prefs;
  return {
    ...prefs,
    workspaces: putSlot(prefs.workspaces, prefs.workspaceRoot, {
      projectRoot: prefs.projectRoot,
      cwd: prefs.cwd,
      recentFiles: prefs.recentFiles,
      designRoot: prefs.designRoot,
    }),
  };
}

function clampCwd(prefs: TPrefs): TPrefs {
  if (!prefs.workspaceRoot) {
    return { ...prefs, cwd: null, projectRoot: null };
  }
  const workspaceRoot = path.resolve(prefs.workspaceRoot);
  let projectRoot =
    prefs.projectRoot && fs.existsSync(prefs.projectRoot)
      ? path.resolve(prefs.projectRoot)
      : null;
  // projectRoot is the active repo — never coerce a missing one to workspaceRoot
  if (projectRoot && !isInside(workspaceRoot, projectRoot)) {
    projectRoot = null;
  }
  const bound = projectRoot || workspaceRoot;
  let cwd =
    prefs.cwd && fs.existsSync(prefs.cwd) ? path.resolve(prefs.cwd) : bound;
  if (!isInside(bound, cwd)) cwd = bound;
  return { ...prefs, workspaceRoot, cwd, projectRoot };
}

function parseSlot(raw: unknown): TWorkspaceSlot | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const projectRoot =
    typeof o.projectRoot === 'string' && o.projectRoot
      ? path.resolve(o.projectRoot)
      : null;
  const cwd =
    typeof o.cwd === 'string' && o.cwd ? path.resolve(o.cwd) : projectRoot;
  const recentFiles = Array.isArray(o.recentFiles)
    ? o.recentFiles.filter((x): x is string => typeof x === 'string').slice(0, 30)
    : [];
  const designRoot =
    typeof o.designRoot === 'string' && o.designRoot
      ? path.resolve(o.designRoot)
      : null;
  return { projectRoot, cwd, recentFiles, designRoot };
}

export function loadPrefs(filePath: string): TPrefs {
  try {
    if (!fs.existsSync(filePath)) return { ...DEFAULT_PREFS };
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;

    // migrate legacy multi-project prefs
    if (Array.isArray(raw.projects) && !raw.workspaceRoot) {
      type TLegacy = { id?: string; rootDir?: string; recentFiles?: string[] };
      const projects = raw.projects as TLegacy[];
      const activeId = typeof raw.activeProjectId === 'string' ? raw.activeProjectId : null;
      const active =
        (activeId && projects.find((p) => p.id === activeId)) || projects[0];
      const root =
        active && typeof active.rootDir === 'string' ? path.resolve(active.rootDir) : null;
      const legacyRecent = Array.isArray(active?.recentFiles)
        ? active.recentFiles.filter((x): x is string => typeof x === 'string').slice(0, 30)
        : [];
      const workspaces: Record<string, TWorkspaceSlot> = {};
      for (const p of projects) {
        if (typeof p.rootDir !== 'string' || !p.rootDir) continue;
        const abs = path.resolve(p.rootDir);
        const files = Array.isArray(p.recentFiles)
          ? p.recentFiles.filter((x): x is string => typeof x === 'string').slice(0, 30)
          : [];
        workspaces[abs] = {
          projectRoot: abs,
          cwd: abs,
          recentFiles: files,
          designRoot: null,
        };
      }
      const legacyDesign =
        typeof raw.designRoot === 'string' && raw.designRoot
          ? path.resolve(raw.designRoot)
          : null;
      return clampCwd(
        persistActiveSlot({
          workspaceRoot: root,
          cwd: root,
          projectRoot: root,
          recentFiles: legacyRecent,
          recentWorkspaces: root ? [root] : [],
          workspaces,
          shellOpen: raw.shellOpen === true,
          shellColumnsPerPage: clampShellColumns(raw.shellColumnsPerPage),
          designRoot: legacyDesign,
        }),
      );
    }

    const workspaceRoot =
      typeof raw.workspaceRoot === 'string' && raw.workspaceRoot
        ? path.resolve(raw.workspaceRoot)
        : null;

    let workspaces: Record<string, TWorkspaceSlot> = {};
    if (raw.workspaces && typeof raw.workspaces === 'object') {
      for (const [k, v] of Object.entries(raw.workspaces as Record<string, unknown>)) {
        const slot = parseSlot(v);
        if (!slot) continue;
        workspaces = putSlot(workspaces, k, slot);
      }
    }

    // migrate flat fields into the active workspace slot when map missing entry
    const flatRecent = Array.isArray(raw.recentFiles)
      ? raw.recentFiles.filter((x): x is string => typeof x === 'string').slice(0, 30)
      : [];
    const flatProject =
      typeof raw.projectRoot === 'string' && raw.projectRoot
        ? path.resolve(raw.projectRoot)
        : null;
    const flatCwd =
      typeof raw.cwd === 'string' && raw.cwd ? path.resolve(raw.cwd) : flatProject;

    const flatDesign =
      typeof raw.designRoot === 'string' && raw.designRoot
        ? path.resolve(raw.designRoot)
        : null;

    if (workspaceRoot && !getSlot(workspaces, workspaceRoot)) {
      workspaces = putSlot(workspaces, workspaceRoot, {
        projectRoot: flatProject,
        cwd: flatCwd || flatProject || workspaceRoot,
        recentFiles: flatRecent,
        designRoot: flatDesign,
      });
    } else if (workspaceRoot && flatDesign) {
      // migrate legacy top-level designRoot into slot when slot lacks it
      const existing = getSlot(workspaces, workspaceRoot);
      if (existing && !existing.designRoot) {
        workspaces = putSlot(workspaces, workspaceRoot, {
          ...existing,
          designRoot: flatDesign,
        });
      }
    }

    const recentWorkspaces = Array.isArray(raw.recentWorkspaces)
      ? raw.recentWorkspaces
          .filter((x): x is string => typeof x === 'string')
          .map((x) => path.resolve(x))
          .slice(0, 12)
      : workspaceRoot
        ? [workspaceRoot]
        : [];

    const slot = workspaceRoot ? getSlot(workspaces, workspaceRoot) : null;
    const prefs = clampCwd({
      workspaceRoot,
      cwd: slot?.cwd ?? flatCwd ?? workspaceRoot,
      // keep null when unset — do not fall back to workspaceRoot
      projectRoot: slot?.projectRoot ?? flatProject ?? null,
      recentFiles: slot?.recentFiles ?? flatRecent,
      recentWorkspaces,
      workspaces,
      shellOpen: raw.shellOpen === true,
      shellColumnsPerPage: clampShellColumns(raw.shellColumnsPerPage),
      designRoot: slot?.designRoot ?? flatDesign,
    });
    return persistActiveSlot(prefs);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(filePath: string, prefs: TPrefs): void {
  const synced = persistActiveSlot(clampCwd(prefs));
  // Keep top-level designRoot as mirror of active slot (compat + easy reads)
  const designRoot =
    synced.designRoot && fs.existsSync(synced.designRoot)
      ? path.resolve(synced.designRoot)
      : null;
  const payload = {
    workspaceRoot: synced.workspaceRoot,
    recentWorkspaces: synced.recentWorkspaces,
    workspaces: synced.workspaces,
    shellOpen: synced.shellOpen === true,
    shellColumnsPerPage: clampShellColumns(synced.shellColumnsPerPage),
    designRoot,
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

export function setWorkspace(prefs: TPrefs, rootDir: string): TPrefs {
  const resolved = path.resolve(rootDir);
  let next = prefs.workspaceRoot ? persistActiveSlot(prefs) : prefs;

  const recentWorkspaces = [
    resolved,
    ...next.recentWorkspaces.filter((w) => !samePath(w, resolved)),
  ].slice(0, 12);

  const slot = getSlot(next.workspaces, resolved);
  if (slot) {
    let projectRoot = slot.projectRoot;
    if (
      projectRoot &&
      (!fs.existsSync(projectRoot) || !isInside(resolved, projectRoot))
    ) {
      projectRoot = null;
    }
    const bound = projectRoot || resolved;
    let cwd = slot.cwd;
    if (!cwd || !fs.existsSync(cwd) || !isInside(bound, cwd)) {
      cwd = bound;
    }
    let designRoot = slot.designRoot;
    if (
      designRoot &&
      (!fs.existsSync(designRoot) || !isInside(resolved, designRoot))
    ) {
      designRoot = null;
    }
    return clampCwd({
      ...next,
      workspaceRoot: resolved,
      recentWorkspaces,
      projectRoot,
      cwd,
      recentFiles: slot.recentFiles ?? [],
      designRoot,
    });
  }

  // New workspace: only set workspaceRoot. projectRoot stays null until
  // user picks a repo (or openIncomingDir auto-selects a single-repo folder).
  return clampCwd({
    ...next,
    workspaceRoot: resolved,
    recentWorkspaces,
    projectRoot: null,
    cwd: resolved,
    recentFiles: [],
    designRoot: null,
    workspaces: putSlot(next.workspaces, resolved, {
      projectRoot: null,
      cwd: resolved,
      recentFiles: [],
      designRoot: null,
    }),
  });
}

export function enterDir(prefs: TPrefs, absOrRel: string): TPrefs {
  const bound = boundRoot(prefs);
  if (!bound || !prefs.workspaceRoot) return prefs;
  const next = path.isAbsolute(absOrRel)
    ? path.resolve(absOrRel)
    : path.resolve(bound, absOrRel);
  if (!isInside(prefs.workspaceRoot, next)) {
    throw new Error('path escapes workspace');
  }
  if (prefs.projectRoot && !isInside(prefs.projectRoot, next)) {
    throw new Error('path escapes project lock');
  }
  if (!fs.existsSync(next) || !fs.statSync(next).isDirectory()) {
    throw new Error('not a directory');
  }

  return clampCwd({
    ...prefs,
    cwd: next,
  });
}

export function goParent(prefs: TPrefs): TPrefs {
  const bound = boundRoot(prefs);
  if (!bound || !prefs.cwd) return prefs;
  if (samePath(prefs.cwd, bound)) return prefs;
  const parent = path.dirname(prefs.cwd);
  if (!isInside(bound, parent)) return prefs;
  return clampCwd({ ...prefs, cwd: parent });
}

/** Clear repo lock and return to workspace (does not change workspaceRoot). */
export function goWorkspaceRoot(prefs: TPrefs): TPrefs {
  if (!prefs.workspaceRoot) return prefs;
  return clampCwd({
    ...prefs,
    projectRoot: null,
    cwd: prefs.workspaceRoot,
    recentFiles: [],
  });
}

export function goProjectRoot(prefs: TPrefs): TPrefs {
  const bound = boundRoot(prefs);
  if (!bound) return prefs;
  return clampCwd({ ...prefs, cwd: bound });
}

export function updateRecentFiles(prefs: TPrefs, recentFiles: string[]): TPrefs {
  return {
    ...prefs,
    recentFiles: recentFiles.filter(Boolean).slice(0, 30),
  };
}

export function cwdRelToBound(prefs: TPrefs): string {
  const bound = boundRoot(prefs);
  if (!bound || !prefs.cwd) return '';
  if (samePath(bound, prefs.cwd)) return '';
  return path.relative(bound, prefs.cwd).split(path.sep).join('/');
}

export function canGoParent(prefs: TPrefs): boolean {
  const bound = boundRoot(prefs);
  if (!bound || !prefs.cwd) return false;
  return !samePath(prefs.cwd, bound);
}

export type TRepoInfo = {
  abs: string;
  /** relative to workspace */
  rel: string;
  name: string;
};

const DISCOVER_SKIP = new Set([
  'node_modules',
  '.git',
  'dist',
  'release',
  '.turbo',
  '.next',
  'coverage',
  '.pnpm-store',
]);

/**
 * Workspace root is always listed; nested selectable repos (git / package.json)
 * are also listed. Does not descend into a nested selectable repo.
 * Scanning continues even when the workspace itself is a git root.
 */
export function discoverRepos(
  workspaceRoot: string,
  maxDepth = 5,
): TRepoInfo[] {
  const root = path.resolve(workspaceRoot);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];

  const out: TRepoInfo[] = [
    {
      abs: root,
      rel: '',
      name: '工作区',
    },
  ];

  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    if (depth > 0 && isSelectableRepo(dir)) {
      const rel = path.relative(root, dir).split(path.sep).join('/');
      out.push({ abs: path.resolve(dir), rel, name: path.basename(dir) });
      return;
    }

    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (DISCOVER_SKIP.has(name) || name.startsWith('.')) continue;
      const child = path.join(dir, name);
      let st: fs.Stats;
      try {
        st = fs.statSync(child);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(child, depth + 1);
    }
  };

  walk(root, 0);
  out.sort((a, b) => {
    if (!a.rel && b.rel) return -1;
    if (a.rel && !b.rel) return 1;
    return a.rel.localeCompare(b.rel, undefined, { sensitivity: 'base' });
  });
  return out;
}

/**
 * Lock FS/git to a selectable repo under the current workspace.
 * Never changes workspaceRoot — only setWorkspace / openIncomingDir(new) do.
 */
export function selectRepo(prefs: TPrefs, repoAbs: string): TPrefs {
  if (!prefs.workspaceRoot) throw new Error('no workspace');
  const abs = path.resolve(repoAbs);
  if (!isInside(prefs.workspaceRoot, abs)) {
    throw new Error('repo outside workspace');
  }
  const isWorkspace = samePath(abs, prefs.workspaceRoot);
  if (!isWorkspace && !isSelectableRepo(abs)) {
    throw new Error('not a selectable repository');
  }
  const switching = !prefs.projectRoot || !samePath(prefs.projectRoot, abs);
  return clampCwd({
    ...prefs,
    projectRoot: abs,
    cwd: abs,
    // recent paths are relative to bound root
    recentFiles: switching ? [] : prefs.recentFiles,
  });
}

/**
 * Open a directory from OS (argv / second-instance / context menu).
 * - Inside current workspace → select as repo (or enter dir); never swap workspace.
 * - Outside → set as new workspace; auto-select repo when the folder itself is one.
 */
export function openIncomingDir(prefs: TPrefs, dir: string): TPrefs {
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    throw new Error(`not a directory: ${dir}`);
  }

  if (prefs.workspaceRoot && isInside(prefs.workspaceRoot, abs)) {
    if (samePath(abs, prefs.workspaceRoot) || isSelectableRepo(abs)) {
      return selectRepo(prefs, abs);
    }
    // Non-repo folder under workspace: keep workspace, try to enter under bound root
    try {
      return enterDir(prefs, abs);
    } catch {
      return prefs;
    }
  }

  let next = setWorkspace(prefs, abs);
  // Single-folder open: if the workspace root itself is a repo/package, select it
  if (isSelectableRepo(abs)) {
    next = selectRepo(next, abs);
  }
  return next;
}
