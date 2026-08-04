import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shell } from 'electron';
import {
  getZonesPrefs,
  isUnderRoot,
  resolveTrackedAbs,
  type ZonesPrefs,
} from './zonesPrefs.js';
import { isImageExt, zonesFilePreviewUrl } from './zonesMedia.js';

export type ZoneFile = {
  name: string;
  path: string;
  ext: string;
  isDir: boolean;
  mtimeMs: number;
  /** Local image preview URL (zones-file://…) */
  thumb?: string;
};

export type GroupCard = {
  id: string;
  title: string;
  rel: string;
  path: string;
  files: ZoneFile[];
};

export type ZonesScanResult = {
  mode: 'custom';
  root: string;
  hasRoot: boolean;
  /** Untracked items under custom desktop root */
  loose: ZoneFile[];
  /** Tracked group folders */
  groups: GroupCard[];
  /** Real Windows desktop immediate children */
  systemDesktop: ZoneFile[];
  systemDesktopRoot: string;
  prefs: ZonesPrefs;
  error?: string;
};

export type ListDirResult = {
  ok: boolean;
  path: string;
  name: string;
  files: ZoneFile[];
  error?: string;
};

let systemDesktopFn: (() => string) | null = null;

export function setSystemDesktopResolver(fn: () => string): void {
  systemDesktopFn = fn;
}

export function systemDesktopDir(): string {
  try {
    if (systemDesktopFn) {
      const p = systemDesktopFn();
      if (p) return path.resolve(p);
    }
  } catch {
    /* fall through */
  }
  return path.join(os.homedir(), 'Desktop');
}

/** Active custom-desktop root, or null if not configured. */
export function zonesRoot(prefs?: ZonesPrefs): string | null {
  const p = prefs ?? getZonesPrefs();
  if (p.customRoot && fs.existsSync(p.customRoot)) {
    return path.resolve(p.customRoot);
  }
  return null;
}

export function allowedRoots(): string[] {
  const roots: string[] = [];
  const custom = zonesRoot();
  if (custom) roots.push(custom);
  const sys = systemDesktopDir();
  if (sys && fs.existsSync(sys)) roots.push(path.resolve(sys));
  return roots;
}

export function isUnderAllowedRoots(target: string): boolean {
  return allowedRoots().some((r) => isUnderRoot(r, target));
}

function toZoneFile(full: string, name: string, st: fs.Stats, isDir: boolean): ZoneFile {
  const ext = isDir ? '' : path.extname(name);
  const file: ZoneFile = {
    name,
    path: full,
    ext,
    isDir,
    mtimeMs: st.mtimeMs,
  };
  if (!isDir && isImageExt(ext)) {
    file.thumb = zonesFilePreviewUrl(full);
  }
  return file;
}

export function listImmediate(dir: string, limit = 500): ZoneFile[] {
  const out: ZoneFile[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    if (out.length >= limit) break;
    const full = path.join(dir, ent.name);
    let st: fs.Stats;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    const isDir = ent.isDirectory() || st.isDirectory();
    out.push(toZoneFile(full, ent.name, st, isDir));
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

function scanSystemDesktop(): { root: string; files: ZoneFile[] } {
  const root = systemDesktopDir();
  if (!fs.existsSync(root)) return { root, files: [] };
  return { root, files: listImmediate(root) };
}

export function scanCustomDesktop(limitPerGroup = 200): ZonesScanResult {
  const prefs = getZonesPrefs();
  const root = prefs.customRoot ? path.resolve(prefs.customRoot) : '';
  const sys = scanSystemDesktop();

  if (!root || !fs.existsSync(root)) {
    return {
      mode: 'custom',
      root: '',
      hasRoot: false,
      loose: [],
      groups: [],
      systemDesktop: sys.files,
      systemDesktopRoot: sys.root,
      prefs,
      error: '请先选择桌面目录',
    };
  }

  const trackedAbs = new Map<string, string>();
  const groups: GroupCard[] = [];

  for (const rel of prefs.tracked) {
    let abs: string;
    try {
      abs = resolveTrackedAbs(root, rel);
    } catch {
      continue;
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) continue;
    const resolved = path.resolve(abs);
    trackedAbs.set(resolved.toLowerCase(), rel);
    groups.push({
      id: rel.replace(/[\\/]/g, '__'),
      title: path.basename(resolved),
      rel,
      path: resolved,
      files: listImmediate(resolved, limitPerGroup),
    });
  }

  const loose: ZoneFile[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (e) {
    return {
      mode: 'custom',
      root,
      hasRoot: true,
      loose: [],
      groups,
      systemDesktop: sys.files,
      systemDesktopRoot: sys.root,
      prefs,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const full = path.resolve(path.join(root, ent.name));
    if (trackedAbs.has(full.toLowerCase())) continue;
    let st: fs.Stats;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    const isDir = ent.isDirectory() || st.isDirectory();
    loose.push(toZoneFile(full, ent.name, st, isDir));
  }
  loose.sort((a, b) => b.mtimeMs - a.mtimeMs);

  return {
    mode: 'custom',
    root,
    hasRoot: true,
    loose,
    groups,
    systemDesktop: sys.files,
    systemDesktopRoot: sys.root,
    prefs,
  };
}

export function scanZones(): ZonesScanResult {
  return scanCustomDesktop();
}

/** Browse a directory (custom desktop or system desktop trees only). */
export function listDirContents(target: string): ListDirResult {
  const abs = path.resolve(String(target || ''));
  if (!abs || !isUnderAllowedRoots(abs)) {
    return { ok: false, path: abs, name: path.basename(abs), files: [], error: '路径不在允许范围内' };
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    return { ok: false, path: abs, name: path.basename(abs), files: [], error: '不是目录' };
  }
  return {
    ok: true,
    path: abs,
    name: path.basename(abs),
    files: listImmediate(abs),
  };
}

export function openPath(target: string): { ok: boolean; error?: string } {
  try {
    void shell.openPath(target);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function revealInFolder(target: string): void {
  shell.showItemInFolder(target);
}

export { isUnderRoot };
