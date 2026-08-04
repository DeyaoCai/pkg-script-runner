/**
 * Zones-local prefs: custom desktop root + tracked group subdirs.
 * Stored in userData/zones-prefs.json (not SharedSettings).
 */
import fs from 'node:fs';
import path from 'node:path';

export type ZonesPrefs = {
  customRoot: string | null;
  /** Paths relative to customRoot, e.g. "工作" or "工作/进行中" */
  tracked: string[];
};

const DEFAULT_PREFS: ZonesPrefs = {
  customRoot: null,
  tracked: [],
};

let prefsPath = '';

export function setZonesPrefsPath(p: string): void {
  prefsPath = p;
}

function normalizeRel(rel: string): string {
  return rel
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/');
}

export function isUnderRoot(root: string, target: string): boolean {
  const r = path.resolve(root);
  const t = path.resolve(target);
  const rel = path.relative(r, t);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Convert absolute path under root to relative posix-ish key. */
export function toTrackedRel(root: string, absPath: string): string | null {
  if (!isUnderRoot(root, absPath)) return null;
  const rel = path.relative(path.resolve(root), path.resolve(absPath));
  if (!rel || rel === '.') return null;
  return normalizeRel(rel);
}

export function resolveTrackedAbs(root: string, rel: string): string {
  const clean = normalizeRel(rel);
  const abs = path.resolve(root, ...clean.split('/'));
  if (!isUnderRoot(root, abs)) {
    throw new Error('追踪路径必须在自定义桌面根目录内');
  }
  return abs;
}

function sanitizePrefs(raw: unknown): ZonesPrefs {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFS };
  const o = raw as Record<string, unknown>;
  let customRoot: string | null = null;
  if (typeof o.customRoot === 'string' && o.customRoot.trim()) {
    const resolved = path.resolve(o.customRoot.trim());
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      customRoot = resolved;
    }
  }
  const tracked: string[] = [];
  if (Array.isArray(o.tracked) && customRoot) {
    const seen = new Set<string>();
    for (const item of o.tracked) {
      if (typeof item !== 'string' || !item.trim()) continue;
      try {
        const rel = normalizeRel(item);
        if (!rel || seen.has(rel.toLowerCase())) continue;
        const abs = resolveTrackedAbs(customRoot, rel);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) continue;
        seen.add(rel.toLowerCase());
        tracked.push(rel);
      } catch {
        /* skip invalid */
      }
    }
  }
  return { customRoot, tracked };
}

export function readZonesPrefs(): ZonesPrefs {
  if (!prefsPath || !fs.existsSync(prefsPath)) {
    return { ...DEFAULT_PREFS, tracked: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(prefsPath, 'utf8')) as unknown;
    return sanitizePrefs(raw);
  } catch {
    return { ...DEFAULT_PREFS, tracked: [] };
  }
}

export function writeZonesPrefs(prefs: ZonesPrefs): ZonesPrefs {
  if (!prefsPath) throw new Error('zones prefs path not set');
  const next = sanitizePrefs(prefs);
  fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
  fs.writeFileSync(prefsPath, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export function getZonesPrefs(): ZonesPrefs {
  return readZonesPrefs();
}

export function setCustomRoot(root: string | null): ZonesPrefs {
  if (root == null || root === '') {
    return writeZonesPrefs({ customRoot: null, tracked: [] });
  }
  const resolved = path.resolve(root);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error('自定义桌面目录不存在');
  }
  const prev = readZonesPrefs();
  // Keep tracked that still live under the new root
  const tracked: string[] = [];
  if (prev.customRoot && path.resolve(prev.customRoot) === resolved) {
    tracked.push(...prev.tracked);
  }
  return writeZonesPrefs({ customRoot: resolved, tracked });
}

export function addTrackedRel(relOrAbs: string): ZonesPrefs {
  const prefs = readZonesPrefs();
  if (!prefs.customRoot) throw new Error('请先选择桌面目录');
  const root = prefs.customRoot;
  let rel: string;
  if (path.isAbsolute(relOrAbs)) {
    const mapped = toTrackedRel(root, relOrAbs);
    if (!mapped) throw new Error('只能追踪桌面根目录下的子目录');
    rel = mapped;
  } else {
    rel = normalizeRel(relOrAbs);
  }
  if (!rel) throw new Error('无效的分组路径');
  if (rel.includes('/')) {
    throw new Error('只能追踪桌面根下的一级文件夹');
  }
  const abs = resolveTrackedAbs(root, rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    throw new Error('追踪目标不是目录');
  }
  const key = rel.toLowerCase();
  if (prefs.tracked.some((t) => t.toLowerCase() === key)) {
    return prefs;
  }
  return writeZonesPrefs({
    customRoot: root,
    tracked: [...prefs.tracked, rel],
  });
}

export function removeTrackedRel(rel: string): ZonesPrefs {
  const prefs = readZonesPrefs();
  const key = normalizeRel(rel).toLowerCase();
  return writeZonesPrefs({
    customRoot: prefs.customRoot,
    tracked: prefs.tracked.filter((t) => t.toLowerCase() !== key),
  });
}

/** After renaming a path under custom root, keep tracked entries in sync. */
export function remapTrackedAfterRename(fromAbs: string, toAbs: string): void {
  const prefs = readZonesPrefs();
  if (!prefs.customRoot || !prefs.tracked.length) return;
  const root = path.resolve(prefs.customRoot);
  const fromRel = toTrackedRel(root, fromAbs);
  const toRel = toTrackedRel(root, toAbs);
  if (!fromRel || !toRel) return;
  const fromKey = fromRel.toLowerCase();
  let changed = false;
  const tracked = prefs.tracked.map((t) => {
    const key = t.toLowerCase();
    if (key === fromKey) {
      changed = true;
      return toRel;
    }
    if (key.startsWith(`${fromKey}/`)) {
      changed = true;
      return normalizeRel(toRel + t.slice(fromRel.length));
    }
    return t;
  });
  if (changed) {
    writeZonesPrefs({ customRoot: prefs.customRoot, tracked });
  }
}

/** Create a new folder under root and track it. */
export function createTrackedGroup(name: string): ZonesPrefs {
  const prefs = readZonesPrefs();
  if (!prefs.customRoot) throw new Error('请先选择桌面目录');
  const trimmed = name.trim();
  if (!trimmed || /[\\/:*?"<>|]/.test(trimmed) || trimmed === '.' || trimmed === '..') {
    throw new Error('非法分组名');
  }
  const abs = path.join(prefs.customRoot, trimmed);
  if (!isUnderRoot(prefs.customRoot, abs)) {
    throw new Error('分组必须在桌面根目录内');
  }
  if (fs.existsSync(abs)) {
    if (!fs.statSync(abs).isDirectory()) {
      throw new Error('同名文件已存在，无法创建分组');
    }
  } else {
    fs.mkdirSync(abs, { recursive: true });
  }
  return addTrackedRel(trimmed);
}
