/**
 * Custom-desktop file ops (move into group, undo, rename, trash).
 */
import fs from 'node:fs';
import path from 'node:path';
import { shell } from 'electron';
import { isUnderAllowedRoots, isUnderRoot, zonesRoot } from './zones.js';
import { getZonesPrefs, remapTrackedAfterRename, resolveTrackedAbs } from './zonesPrefs.js';

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
    if (code === 'EXDEV') {
      fs.copyFileSync(from, to);
      fs.unlinkSync(from);
      return;
    }
    throw e;
  }
}

function pushUndo(done: Array<{ from: string; to: string }>): string | undefined {
  if (!done.length) return undefined;
  const undoId = `undo_${Date.now()}`;
  const batches = readUndoLog();
  batches.unshift({
    id: undoId,
    at: new Date().toISOString(),
    moves: done,
  });
  writeUndoLog(batches);
  return undoId;
}

export function assertUnderRoot(target: string, root = zonesRoot()): void {
  if (root) {
    if (!isUnderRoot(root, target)) {
      throw new Error('路径必须在当前桌面根目录内');
    }
    return;
  }
  if (!isUnderAllowedRoots(target)) {
    throw new Error('请先选择桌面目录');
  }
}

function assertUnderWorkspace(target: string): void {
  if (!isUnderAllowedRoots(target)) {
    throw new Error('路径必须在自定义桌面或系统桌面内');
  }
}

export function moveIntoDir(
  from: string,
  destDir: string,
): { ok: boolean; to?: string; error?: string; undoId?: string } {
  try {
    const fromAbs = path.resolve(from);
    const destAbs = path.resolve(destDir);
    assertUnderWorkspace(fromAbs);
    assertUnderWorkspace(destAbs);

    if (!fs.existsSync(fromAbs)) {
      return { ok: false, error: '源不存在' };
    }
    if (!fs.existsSync(destAbs) || !fs.statSync(destAbs).isDirectory()) {
      return { ok: false, error: '目标目录不存在' };
    }

    const fromIsDir = fs.statSync(fromAbs).isDirectory();
    if (fromIsDir && isUnderRoot(fromAbs, destAbs)) {
      return { ok: false, error: '不能将目录移入其自身或子目录' };
    }

    if (path.dirname(fromAbs).toLowerCase() === destAbs.toLowerCase()) {
      return { ok: true, to: fromAbs };
    }

    const to = uniqueDest(destAbs, path.basename(fromAbs));
    // Destination must stay under an allowed root (custom or system desktop).
    if (!isUnderAllowedRoots(to)) {
      return { ok: false, error: '目标路径不在允许范围内' };
    }
    moveFile(fromAbs, to);
    const undoId = pushUndo([{ from: fromAbs, to }]);
    return { ok: true, to, undoId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function moveIntoGroup(
  from: string,
  groupRel: string,
): { ok: boolean; to?: string; error?: string; undoId?: string } {
  try {
    const prefs = getZonesPrefs();
    if (!prefs.customRoot) {
      return { ok: false, error: '请先选择桌面目录' };
    }
    const root = path.resolve(prefs.customRoot);

    const norm = groupRel.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!prefs.tracked.some((t) => t.toLowerCase() === norm.toLowerCase())) {
      return { ok: false, error: '目标不是已追踪分组' };
    }

    const destDir = resolveTrackedAbs(root, norm);
    return moveIntoDir(from, destDir);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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
    return { ok: false, restored: 0, skipped: [], error: '没有可撤销的移动记录' };
  }

  const skipped: Array<{ to: string; reason: string }> = [];
  let restored = 0;

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
      assertUnderWorkspace(m.to);
      assertUnderWorkspace(path.dirname(m.from));
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
    assertUnderWorkspace(target);
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
    remapTrackedAfterRename(target, dest);
    return { ok: true, path: dest };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function trashItem(target: string): Promise<{ ok: boolean; error?: string }> {
  try {
    assertUnderWorkspace(target);
    if (!fs.existsSync(target)) return { ok: false, error: '文件不存在' };
    await shell.trashItem(target);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function openDesktopFolder(): void {
  const root = zonesRoot();
  if (!root) return;
  void shell.openPath(root);
}
