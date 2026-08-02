/**
 * Shared workspace prefs (same file as Code Editor).
 * Runner and Editor both read/write here so project management stays in sync.
 */
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { app } from 'electron';
import {
  loadPrefs,
  savePrefs,
  setWorkspace,
  selectRepo,
  openIncomingDir,
  discoverRepos,
  type TPrefs,
  type TRepoInfo,
} from '../code-editor/src/main/prefs.js';
import { loadProjectScripts } from '../runner/src/pkg.js';

const bus = new EventEmitter();
bus.setMaxListeners(20);

let cached: TPrefs | null = null;

export type WorkspaceProjectsState = {
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

export function editorPrefsPath(): string {
  return path.join(app.getPath('appData'), 'code-editor', 'prefs.json');
}

export function readWorkspacePrefs(): TPrefs {
  cached = loadPrefs(editorPrefsPath());
  return cached;
}

export function writeWorkspacePrefs(next: TPrefs): TPrefs {
  savePrefs(editorPrefsPath(), next);
  cached = next;
  bus.emit('change', next);
  return next;
}

export function onWorkspacePrefsChange(cb: (prefs: TPrefs) => void): () => void {
  const handler = (p: TPrefs) => cb(p);
  bus.on('change', handler);
  return () => {
    bus.off('change', handler);
  };
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

function projectEntry(repo: TRepoInfo): {
  dir: string;
  name: string;
  scriptCount: number;
  rel: string;
} {
  try {
    const p = loadProjectScripts(repo.abs);
    return {
      dir: p.dir,
      name: repo.rel ? p.name : '工作区',
      scriptCount: p.scripts.length,
      rel: repo.rel,
    };
  } catch {
    return {
      dir: path.resolve(repo.abs),
      name: repo.name,
      scriptCount: 0,
      rel: repo.rel,
    };
  }
}

/** Active script target: locked repo, else workspace if it has package.json. */
export function activeScriptDir(prefs: TPrefs): string | null {
  if (prefs.projectRoot) return path.resolve(prefs.projectRoot);
  if (!prefs.workspaceRoot) return null;
  try {
    return loadProjectScripts(prefs.workspaceRoot).dir;
  } catch {
    return path.resolve(prefs.workspaceRoot);
  }
}

export function workspaceProjectsState(prefs?: TPrefs): WorkspaceProjectsState {
  const p = prefs ?? readWorkspacePrefs();
  const repos = p.workspaceRoot ? discoverRepos(p.workspaceRoot) : [];
  const projects = repos.map(projectEntry);
  let active = activeScriptDir(p);
  if (active) {
    const hit = projects.find((x) => samePath(x.dir, active!));
    if (hit) active = hit.dir;
  }
  return {
    workspaceRoot: p.workspaceRoot,
    recentWorkspaces: p.recentWorkspaces ?? [],
    projects,
    activeProject: active,
  };
}

export function pickWorkspaceDir(rootDir: string): WorkspaceProjectsState {
  const next = setWorkspace(readWorkspacePrefs(), rootDir);
  writeWorkspacePrefs(next);
  return workspaceProjectsState(next);
}

export function openWorkspaceDir(dir: string): WorkspaceProjectsState {
  const next = openIncomingDir(readWorkspacePrefs(), dir);
  writeWorkspacePrefs(next);
  return workspaceProjectsState(next);
}

export function selectWorkspaceRepo(repoAbs: string): WorkspaceProjectsState {
  const next = selectRepo(readWorkspacePrefs(), repoAbs);
  writeWorkspacePrefs(next);
  return workspaceProjectsState(next);
}

/** Migrate legacy runner flat project list into editor workspace prefs once. */
export function migrateLegacyRunnerProjects(legacy: {
  projects: string[];
  activeProject: string | null;
}): void {
  const current = readWorkspacePrefs();
  if (current.workspaceRoot || !legacy.projects.length) return;
  const active =
    legacy.activeProject &&
    legacy.projects.some((p) => samePath(p, legacy.activeProject!))
      ? legacy.activeProject
      : legacy.projects[0]!;
  let next = setWorkspace(current, active);
  try {
    next = selectRepo(next, active);
  } catch {
    /* workspace-only */
  }
  writeWorkspacePrefs(next);
}
