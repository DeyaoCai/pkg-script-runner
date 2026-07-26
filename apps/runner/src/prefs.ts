import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import {
  loadSharedSettings,
  type SharedSettings,
  type UiTheme,
  type ShellLayout,
} from './sharedSettings.js';

export type { UiTheme, ShellLayout };

/** Runner-local only (projects). UI settings live in shared-settings.json. */
export type Prefs = {
  projects: string[];
  activeProject: string | null;
};

export type AppSettings = SharedSettings;

const DEFAULTS: Prefs = {
  projects: [],
  activeProject: null,
};

function prefsPath(): string {
  return path.join(app.getPath('userData'), 'pkg-runner-prefs.json');
}

function normalizeDirList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string' || !item.trim()) continue;
    const dir = path.resolve(item.trim());
    const key = process.platform === 'win32' ? dir.toLowerCase() : dir;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(dir);
  }
  return out;
}

export function settingsFromPrefs(_prefs: Prefs): AppSettings {
  return loadSharedSettings();
}

export function loadPrefs(): Prefs {
  try {
    const raw = fs.readFileSync(prefsPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    const projects = normalizeDirList(parsed.projects);
    let activeProject =
      typeof parsed.activeProject === 'string' && parsed.activeProject.trim()
        ? path.resolve(parsed.activeProject.trim())
        : null;
    if (activeProject) {
      const key = process.platform === 'win32' ? activeProject.toLowerCase() : activeProject;
      const hit = projects.find((p) =>
        (process.platform === 'win32' ? p.toLowerCase() : p) === key,
      );
      activeProject = hit ?? projects[0] ?? null;
    } else {
      activeProject = projects[0] ?? null;
    }
    return { projects, activeProject };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    fs.mkdirSync(path.dirname(prefsPath()), { recursive: true });
    // Keep writing only project fields; strip legacy UI keys by rewrite
    fs.writeFileSync(
      prefsPath(),
      JSON.stringify(
        {
          projects: prefs.projects,
          activeProject: prefs.activeProject,
        },
        null,
        2,
      ),
      'utf8',
    );
  } catch {
    /* ignore */
  }
}

export function sameDir(a: string, b: string): boolean {
  const x = path.resolve(a);
  const y = path.resolve(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}
