/**
 * Desktop organize + light file ops (real moves, undo, rename, trash).
 */
import fs from 'node:fs';
import path from 'node:path';
import { shell } from 'electron';
import {
  desktopDir,
  isZoneFolderName,
  matchZone,
  zoneFolderName,
  type ZoneId,
} from './zones.js';

export type MoveOp = {
  from: string;
  to: string;
  zoneId: ZoneId;
  name: string;
};

export type UndoBatch = {
  id: string;
  at: string;
  moves: Array<{ from: string; to: string }>;
};

const MAX_UNDO_BATCHES = 20;

let undoLogPath = '';

export function setUndoLogPath(p: string) {
  undoLogPath = p;
}

function readUndoLog(): UndoBatch[] {
  if (!undoLogPath || !fs.existsSync(undoLogPath)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(undoLogPath, 'utf8')) as UndoBatch[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeUndoLog(batches: UndoBatch[]) {
  if (!undoLogPath) return;
  fs.mkdirSync(path.dirname(undoLogPath), { recursive: true });
  fs.writeFileSync(undoLogPath, JSON.stringify(batches.slice(0, MAX_UNDO_BATCHES), null, 2), 'utf8');
}

function uniqueDest(destDir: string, baseName: string): string {
  let candidate = path.join(destDir, baseName);
  if (!fs.existsSync(candidate)) return candidate;
  const ext = path.extname(baseName);
  const stem = path.basename(baseName, ext);
  for (let i = 1; i < 10_000; i++) {
    candidate = path.join(destDir, `${stem} (${i})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(destDir, `${stem} (${Date.now()})${ext}`);
}

function moveFile(from: string, to: string) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (e) {
    const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: string }).code) : '';
    // Cross-device: copy then unlink
    if (code === 'EXDEV') {
      fs.copyFileSync(from, to);
      fs.unlinkSync(from);
      return;
    }
    throw e;
  }
}

function assertUnderDesktop(target: string) {
  const root = path.resolve(desktopDir());
  const resolved = path.resolve(target);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('路径必须在桌面目录内');
  }
}

/** Preview moves for files currently sitting on Desktop root (not dirs). */
export function previewOrganize(): {
  root: string;
  ops: MoveOp[];
  error?: string;
} {
  const root = desktopDir();
  if (!fs.existsSync(root)) {
    return { root, ops: [], error: '桌面目录不存在' };
  }

  const ops: MoveOp[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (e) {
    return { root, ops: [], error: e instanceof Error ? e.message : String(e) };
  }

  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    if (isZoneFolderName(ent.name)) continue;
    const full = path.join(root, ent.name);
    let st: fs.Stats;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) continue; // 目录不自动移动

    const zoneId = matchZone(path.extname(ent.name), false);
    const folder = zoneFolderName(zoneId);
    const destDir = path.join(root, folder);
    const to = uniqueDest(destDir, ent.name);
    ops.push({ from: full, to, zoneId, name: ent.name });
  }

  return { root, ops };
}

export function applyOrganize(ops: MoveOp[]): {
  ok: boolean;
  moved: number;
  failed: Array<{ from: string; error: string }>;
  undoId?: string;
} {
  const failed: Array<{ from: string; error: string }> = [];
  const done: Array<{ from: string; to: string }> = [];

  for (const op of ops) {
    try {
      assertUnderDesktop(op.from);
      assertUnderDesktop(path.dirname(op.to));
      if (!fs.existsSync(op.from)) {
        failed.push({ from: op.from, error: '源文件不存在' });
        continue;
      }
      const to = fs.existsSync(op.to)
        ? uniqueDest(path.dirname(op.to), path.basename(op.to))
        : op.to;
      moveFile(op.from, to);
      done.push({ from: op.from, to });
    } catch (e) {
      failed.push({
        from: op.from,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  let undoId: string | undefined;
  if (done.length) {
    undoId = `undo_${Date.now()}`;
    const batches = readUndoLog();
    batches.unshift({
      id: undoId,
      at: new Date().toISOString(),
      moves: done,
    });
    writeUndoLog(batches);
  }

  return { ok: failed.length === 0, moved: done.length, failed, undoId };
}

export function undoLast(): {
  ok: boolean;
  restored: number;
  skipped: Array<{ to: string; reason: string }>;
  error?: string;
} {
  const batches = readUndoLog();
  const batch = batches[0];
  if (!batch) {
    return { ok: false, restored: 0, skipped: [], error: '没有可撤销的整理记录' };
  }

  const skipped: Array<{ to: string; reason: string }> = [];
  let restored = 0;

  // Reverse order: last moved first
  for (const m of [...batch.moves].reverse()) {
    try {
      if (!fs.existsSync(m.to)) {
        skipped.push({ to: m.to, reason: '目标已不存在' });
        continue;
      }
      if (fs.existsSync(m.from)) {
        skipped.push({ to: m.to, reason: '原位置已有同名文件' });
        continue;
      }
      assertUnderDesktop(m.to);
      assertUnderDesktop(path.dirname(m.from));
      moveFile(m.to, m.from);
      restored += 1;
    } catch (e) {
      skipped.push({
        to: m.to,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  batches.shift();
  writeUndoLog(batches);
  return { ok: true, restored, skipped };
}

export function undoAvailable(): boolean {
  return readUndoLog().length > 0;
}

export function renameItem(
  target: string,
  newName: string,
): { ok: boolean; path?: string; error?: string } {
  try {
    assertUnderDesktop(target);
    const trimmed = newName.trim();
    if (!trimmed || /[\\/:*?"<>|]/.test(trimmed) || trimmed === '.' || trimmed === '..') {
      return { ok: false, error: '非法文件名' };
    }
    if (!fs.existsSync(target)) return { ok: false, error: '文件不存在' };
    const dest = path.join(path.dirname(target), trimmed);
    if (path.resolve(dest) === path.resolve(target)) {
      return { ok: true, path: target };
    }
    if (fs.existsSync(dest)) return { ok: false, error: '同名已存在' };
    fs.renameSync(target, dest);
    return { ok: true, path: dest };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function trashItem(target: string): Promise<{ ok: boolean; error?: string }> {
  try {
    assertUnderDesktop(target);
    if (!fs.existsSync(target)) return { ok: false, error: '文件不存在' };
    await shell.trashItem(target);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function openDesktopFolder(): void {
  void shell.openPath(desktopDir());
}
