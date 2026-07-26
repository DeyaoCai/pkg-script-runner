/**
 * Shared settings file owned by tray host; runner reads / watches / patches it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export type UiTheme = 'dark' | 'light';
export type ShellLayout = 'grid' | 'single';

export type SharedSettings = {
  screenshotHotkey: string;
  activateHotkey: string;
  screenshotHistoryLimit: number;
  fontId: string;
  glassAlpha: number;
  theme: UiTheme;
  shellMosaicCols: number;
  shellLayout: ShellLayout;
  alwaysOnTop: boolean;
  persistLogs: boolean;
};

const DEFAULTS: SharedSettings = {
  screenshotHotkey: '',
  activateHotkey: '',
  screenshotHistoryLimit: 10,
  fontId: 'jetbrains',
  glassAlpha: 55,
  theme: 'dark',
  shellMosaicCols: 2,
  shellLayout: 'grid',
  alwaysOnTop: false,
  persistLogs: false,
};

export function sharedSettingsPath(): string {
  return path.join(app.getPath('appData'), 'pkg-runner', 'shared-settings.json');
}

export function trayCmdPath(): string {
  return path.join(app.getPath('appData'), 'pkg-runner', 'tray-cmd.json');
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function loadSharedSettings(): SharedSettings {
  try {
    const raw = fs.readFileSync(sharedSettingsPath(), 'utf8');
    const p = JSON.parse(raw) as Partial<SharedSettings>;
    return {
      screenshotHotkey: typeof p.screenshotHotkey === 'string' ? p.screenshotHotkey : '',
      activateHotkey: typeof p.activateHotkey === 'string' ? p.activateHotkey : '',
      screenshotHistoryLimit: clamp(Number(p.screenshotHistoryLimit) || 10, 1, 100),
      fontId: typeof p.fontId === 'string' && p.fontId.trim() ? p.fontId.trim() : 'jetbrains',
      glassAlpha: clamp(Number(p.glassAlpha) || 55, 10, 100),
      theme: p.theme === 'light' ? 'light' : 'dark',
      shellMosaicCols: clamp(Number(p.shellMosaicCols) || 2, 1, 4),
      shellLayout: p.shellLayout === 'single' ? 'single' : 'grid',
      alwaysOnTop: Boolean(p.alwaysOnTop),
      persistLogs: Boolean(p.persistLogs),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function patchSharedSettings(patch: Partial<SharedSettings>): SharedSettings {
  const next = { ...loadSharedSettings(), ...patch };
  try {
    const file = sharedSettingsPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // preserve draw color / other tray-only fields if present
    let full: Record<string, unknown> = {};
    try {
      full = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    } catch {
      /* ignore */
    }
    fs.writeFileSync(file, JSON.stringify({ ...full, ...next }, null, 2), 'utf8');
  } catch {
    /* ignore */
  }
  return next;
}

export function requestTrayOpenSettings(): void {
  try {
    const file = trayCmdPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ cmd: 'open-settings', t: Date.now() }, null, 2),
      'utf8',
    );
  } catch {
    /* ignore */
  }
}

export function watchSharedSettings(onChange: (s: SharedSettings) => void): () => void {
  const file = sharedSettingsPath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch {
    /* ignore */
  }
  let timer: NodeJS.Timeout | null = null;
  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => onChange(loadSharedSettings()), 80);
  };
  let watcher: fs.FSWatcher | null = null;
  try {
    watcher = fs.watch(path.dirname(file), (event, name) => {
      if (!name || name === 'shared-settings.json') fire();
    });
  } catch {
    /* ignore */
  }
  return () => {
    if (timer) clearTimeout(timer);
    watcher?.close();
  };
}
