/**
 * Shared wallpaper library for tray / zones / settings.
 * Media:
 *   packages/wallpaper/wallpapers  — bundled defaults
 *   packages/wallpaper/jimeng      — Jimeng downloads (gitignored, sibling of wallpapers)
 * Override defaults via PKG_WALLPAPERS / PKG_ZONES_WALLPAPERS.
 * Protocol: pkg-wp://file/<urlencoded-name>
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { protocol, shell } from 'electron';

const require = createRequire(import.meta.url);

export const WALLPAPER_SCHEME = 'pkg-wp';

export type WallpaperItem = {
  name: string;
  path: string;
  thumb: string;
  /** jimeng = downloaded from Jimeng; default = bundled library */
  source?: 'jimeng' | 'default';
};

const IMAGE_RE = /\.(jpg|jpeg|jpe|png|webp|bmp)$/i;

let protocolRegistered = false;
let systemParametersInfoW:
  | ((uiAction: number, uiParam: number, pvParam: string, fWinIni: number) => boolean)
  | null = null;

function packageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

/** Bundled / default wallpapers directory. */
export function wallpapersDir(): string {
  const override = process.env.PKG_WALLPAPERS?.trim() || process.env.PKG_ZONES_WALLPAPERS?.trim();
  if (override) return path.resolve(override);
  return path.join(packageRoot(), 'wallpapers');
}

/**
 * Jimeng downloads — sibling of `wallpapers/` (not inside it).
 * Always derived from wallpapersDir() so PKG_WALLPAPERS / packaged paths stay consistent.
 * Override via PKG_JIMENG_WALLPAPERS.
 */
export function jimengWallpapersDir(): string {
  const override = process.env.PKG_JIMENG_WALLPAPERS?.trim();
  if (override) return path.resolve(override);
  return path.join(path.dirname(wallpapersDir()), 'jimeng');
}

export function normalizeAppBackgroundName(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== 'string') return null;
  const name = path.basename(raw.trim());
  if (!name || name.includes('..') || !IMAGE_RE.test(name)) return null;
  return name;
}

function listImagesInDir(dir: string): string[] {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => IMAGE_RE.test(name) && fs.statSync(path.join(dir, name)).isFile())
    .sort((a, b) => a.localeCompare(b, 'zh'));
}

/** Resolve under a single directory (basename only; no path escape). */
function resolveInDir(dir: string, nameOrPath: string): string | null {
  const raw = String(nameOrPath || '').trim();
  if (!raw || raw.includes('\0') || raw.includes('..')) return null;
  const root = path.resolve(dir);
  const abs = path.isAbsolute(raw)
    ? path.resolve(raw)
    : path.resolve(root, path.basename(raw));
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  if (!IMAGE_RE.test(abs)) return null;
  return abs;
}

/**
 * Resolve wallpaper file. Prefer Jimeng dir, then default wallpapers.
 * Absolute paths under either directory are accepted.
 */
export function resolveWallpaperFile(nameOrPath: string): string | null {
  const raw = String(nameOrPath || '').trim();
  if (!raw) return null;

  const jimeng = resolveInDir(jimengWallpapersDir(), raw);
  if (jimeng) return jimeng;

  const def = resolveInDir(wallpapersDir(), raw);
  if (def) return def;

  // Absolute path outside helpers (e.g. already downloaded abs) — allow if image file.
  if (path.isAbsolute(raw) && !raw.includes('\0') && !raw.includes('..')) {
    const abs = path.resolve(raw);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile() && IMAGE_RE.test(abs)) {
      return abs;
    }
  }
  return null;
}

/** CSS / <img> URL — Chromium loads asynchronously via protocol. */
export function wallpaperMediaUrl(name: string): string {
  return `${WALLPAPER_SCHEME}://file/${encodeURIComponent(path.basename(name))}`;
}

export function appBackgroundUrl(name: string | null | undefined): string | null {
  const n = normalizeAppBackgroundName(name);
  return n ? wallpaperMediaUrl(n) : null;
}

export function registerWallpaperProtocol(): void {
  if (protocolRegistered) return;
  protocolRegistered = true;

  protocol.registerFileProtocol(WALLPAPER_SCHEME, (request, callback) => {
    try {
      const withoutScheme = request.url.slice(`${WALLPAPER_SCHEME}://`.length);
      const encoded = withoutScheme.replace(/^file\/?/i, '').replace(/^\/+/, '');
      const name = decodeURIComponent(encoded.split(/[?#]/)[0] || '');
      const abs = resolveWallpaperFile(name);
      if (!abs) {
        callback({ error: -6 });
        return;
      }
      callback({ path: abs });
    } catch {
      callback({ error: -2 });
    }
  });
}

/** Jimeng first, then default library. */
export function listWallpapers(): WallpaperItem[] {
  const jimengDir = jimengWallpapersDir();
  const defaultDir = wallpapersDir();
  const seen = new Set<string>();
  const out: WallpaperItem[] = [];

  for (const name of listImagesInDir(jimengDir)) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const abs = path.join(jimengDir, name);
    out.push({ name, path: abs, thumb: wallpaperMediaUrl(name), source: 'jimeng' });
  }
  for (const name of listImagesInDir(defaultDir)) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const abs = path.join(defaultDir, name);
    out.push({ name, path: abs, thumb: wallpaperMediaUrl(name), source: 'default' });
  }
  return out;
}

function loadSystemParametersInfo(): typeof systemParametersInfoW {
  if (systemParametersInfoW) return systemParametersInfoW;
  const koffi = require('koffi') as typeof import('koffi');
  const user32 = koffi.load('user32.dll');
  systemParametersInfoW = user32.func(
    'bool __stdcall SystemParametersInfoW(uint uiAction, uint uiParam, str16 pvParam, uint fWinIni)',
  );
  return systemParametersInfoW;
}

export function setDesktopWallpaper(filePath: string): { ok: boolean; error?: string } {
  const resolved = resolveWallpaperFile(filePath);
  const abs = resolved || path.resolve(String(filePath || ''));
  if (!abs || abs.includes('\0')) return { ok: false, error: 'bad path' };
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return { ok: false, error: 'file not found' };
  }
  if (!IMAGE_RE.test(abs)) return { ok: false, error: 'not an image' };
  if (process.platform !== 'win32') return { ok: false, error: '仅支持 Windows' };

  try {
    const spi = loadSystemParametersInfo();
    if (!spi) return { ok: false, error: 'user32 unavailable' };
    const ok = spi(0x0014, 0, abs, 0x01 | 0x02);
    if (!ok) return { ok: false, error: 'SystemParametersInfoW failed' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function openWallpapersFolder(): void {
  const dir = wallpapersDir();
  fs.mkdirSync(dir, { recursive: true });
  void shell.openPath(dir);
}

export function openJimengWallpapersFolder(): void {
  const dir = jimengWallpapersDir();
  fs.mkdirSync(dir, { recursive: true });
  void shell.openPath(dir);
}
