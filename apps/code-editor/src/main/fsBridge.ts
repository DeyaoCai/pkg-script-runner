import fs from 'node:fs';
import path from 'node:path';

function isNestedGitRepo(dir: string): boolean {
  try {
    return fs.existsSync(path.join(path.resolve(dir), '.git'));
  } catch {
    return false;
  }
}

export type TFsEntry = {
  name: string;
  relPath: string;
  kind: 'file' | 'dir';
  /** nested git root only — click switches repo; package roots switch via top-bar 仓库 */
  isRepo?: boolean;
};

const SKIP_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'release',
  '.turbo',
  '.next',
  'coverage',
]);

function real(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

/** Ensure target is inside root (after resolve/realpath). */
export function assertInsideRoot(rootDir: string, targetPath: string): string {
  const root = real(rootDir);
  const target = real(path.isAbsolute(targetPath) ? targetPath : path.join(root, targetPath));
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`path escapes project root: ${targetPath}`);
  }
  return target;
}

export function toRelPath(rootDir: string, absPath: string): string {
  const root = real(rootDir);
  const abs = real(absPath);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`path escapes project root: ${absPath}`);
  }
  return rel.split(path.sep).join('/');
}

const DOC_EXTS = new Set(['.md', '.markdown', '.mdx', '.txt']);

export function isDocFileName(name: string): boolean {
  const i = name.lastIndexOf('.');
  if (i < 0) return false;
  return DOC_EXTS.has(name.slice(i).toLowerCase());
}

export function listDir(
  rootDir: string,
  relDir = '',
  opts: { docsOnly?: boolean } = {},
): TFsEntry[] {
  const abs = assertInsideRoot(rootDir, relDir || '.');
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    throw new Error(`not a directory: ${relDir || '.'}`);
  }
  const names = fs.readdirSync(abs);
  const entries: TFsEntry[] = [];
  for (const name of names) {
    if (SKIP_NAMES.has(name)) continue;
    if (name === '.' || name === '..') continue;
    const childAbs = path.join(abs, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(childAbs);
    } catch {
      continue;
    }
    const relPath = toRelPath(rootDir, childAbs);
    const isDir = st.isDirectory();
    if (opts.docsOnly) {
      if (!isDir && !isDocFileName(name)) continue;
      entries.push({ name, relPath, kind: isDir ? 'dir' : 'file' });
      continue;
    }
    entries.push({
      name,
      relPath,
      kind: isDir ? 'dir' : 'file',
      ...(isDir && isNestedGitRepo(childAbs) ? { isRepo: true } : {}),
    });
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
  return entries;
}

export function isFile(rootDir: string, relPath: string): boolean {
  try {
    const abs = assertInsideRoot(rootDir, relPath);
    return fs.existsSync(abs) && fs.statSync(abs).isFile();
  } catch {
    return false;
  }
}

/** Soft cap — larger files open via OS app instead of the text editor. */
const MAX_EDITOR_BYTES = 8 * 1024 * 1024;

export type TReadFileResult =
  | { ok: true; kind: 'text'; content: string; mtimeMs: number; size: number }
  | { ok: true; kind: 'binary'; mtimeMs: number; size: number }
  | { ok: false; error: string };

function looksLikeText(buf: Buffer): boolean {
  if (buf.length === 0) return true;
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  if (sample.includes(0)) return false;
  let weird = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample[i]!;
    if (c < 7 || (c > 13 && c < 32) || c === 127) weird++;
  }
  return weird / sample.length < 0.3;
}

export type TStatFileResult =
  | { ok: true; mtimeMs: number; size: number }
  | { ok: false; error: string };

export function statFile(rootDir: string, relPath: string): TStatFileResult {
  try {
    const abs = assertInsideRoot(rootDir, relPath);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return { ok: false, error: `文件不存在: ${relPath}` };
    }
    const st = fs.statSync(abs);
    return { ok: true, mtimeMs: st.mtimeMs, size: st.size };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function readFileText(rootDir: string, relPath: string): TReadFileResult {
  try {
    const abs = assertInsideRoot(rootDir, relPath);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return { ok: false, error: `文件不存在: ${relPath}` };
    }
    const st = fs.statSync(abs);
    const size = st.size;
    if (size > MAX_EDITOR_BYTES) {
      return { ok: true, kind: 'binary', mtimeMs: st.mtimeMs, size };
    }
    const buf = fs.readFileSync(abs);
    if (!looksLikeText(buf)) {
      return { ok: true, kind: 'binary', mtimeMs: st.mtimeMs, size };
    }
    return {
      ok: true,
      kind: 'text',
      content: buf.toString('utf8'),
      mtimeMs: st.mtimeMs,
      size,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function writeFileText(
  rootDir: string,
  relPath: string,
  content: string,
): { mtimeMs: number } {
  const abs = assertInsideRoot(rootDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  const st = fs.statSync(abs);
  return { mtimeMs: st.mtimeMs };
}

