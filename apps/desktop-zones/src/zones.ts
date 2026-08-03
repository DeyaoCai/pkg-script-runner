import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shell } from 'electron';

export type ZoneId = 'docs' | 'images' | 'archives' | 'code' | 'other';

export type ZoneFile = {
  name: string;
  path: string;
  ext: string;
  isDir: boolean;
  mtimeMs: number;
};

export type Zone = {
  id: ZoneId;
  title: string;
  exts: string[];
  files: ZoneFile[];
};

export const ZONE_DEFS: Omit<Zone, 'files'>[] = [
  {
    id: 'docs',
    title: '文档',
    exts: ['.txt', '.md', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.csv'],
  },
  {
    id: 'images',
    title: '图片',
    exts: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico'],
  },
  {
    id: 'archives',
    title: '压缩包',
    exts: ['.zip', '.rar', '.7z', '.tar', '.gz', '.iso'],
  },
  {
    id: 'code',
    title: '代码',
    exts: ['.js', '.ts', '.tsx', '.vue', '.json', '.py', '.go', '.rs', '.java', '.cs'],
  },
  { id: 'other', title: '其它', exts: [] },
];

/** 分区对应的桌面子文件夹名（与 title 一致） */
export function zoneFolderName(id: ZoneId): string {
  return ZONE_DEFS.find((z) => z.id === id)?.title ?? id;
}

export function isZoneFolderName(name: string): boolean {
  return ZONE_DEFS.some((z) => z.title === name);
}

export function matchZone(ext: string, isDir: boolean): ZoneId {
  if (isDir) return 'other';
  const lower = ext.toLowerCase();
  for (const z of ZONE_DEFS) {
    if (z.id === 'other') continue;
    if (z.exts.includes(lower)) return z.id;
  }
  return 'other';
}

export function desktopDir(): string {
  return path.join(os.homedir(), 'Desktop');
}

export function scanDesktopZones(limitPerZone = 200): {
  root: string;
  zones: Zone[];
  error?: string;
} {
  const root = desktopDir();
  const buckets = new Map<ZoneId, ZoneFile[]>();
  for (const z of ZONE_DEFS) buckets.set(z.id, []);

  if (!fs.existsSync(root)) {
    return { root, zones: ZONE_DEFS.map((z) => ({ ...z, files: [] })), error: '桌面目录不存在' };
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (e) {
    return {
      root,
      zones: ZONE_DEFS.map((z) => ({ ...z, files: [] })),
      error: e instanceof Error ? e.message : String(e),
    };
  }

  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(root, ent.name);
    let st: fs.Stats;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    const isDir = ent.isDirectory() || st.isDirectory();

    // 分类文件夹：展开其内文件到对应分区，不把文件夹本身算作「其它」
    if (isDir && isZoneFolderName(ent.name)) {
      const zoneId =
        ZONE_DEFS.find((z) => z.title === ent.name)?.id ?? ('other' as ZoneId);
      const list = buckets.get(zoneId)!;
      let children: string[];
      try {
        children = fs.readdirSync(full);
      } catch {
        continue;
      }
      for (const child of children) {
        if (child.startsWith('.')) continue;
        if (list.length >= limitPerZone) break;
        const childPath = path.join(full, child);
        let cst: fs.Stats;
        try {
          cst = fs.statSync(childPath);
        } catch {
          continue;
        }
        if (cst.isDirectory()) continue;
        list.push({
          name: child,
          path: childPath,
          ext: path.extname(child),
          isDir: false,
          mtimeMs: cst.mtimeMs,
        });
      }
      continue;
    }

    const ext = isDir ? '' : path.extname(ent.name);
    const zoneId = matchZone(ext, isDir);
    const list = buckets.get(zoneId)!;
    if (list.length >= limitPerZone) continue;
    list.push({
      name: ent.name,
      path: full,
      ext,
      isDir,
      mtimeMs: st.mtimeMs,
    });
  }

  for (const list of buckets.values()) {
    list.sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  return {
    root,
    zones: ZONE_DEFS.map((z) => ({ ...z, files: buckets.get(z.id) ?? [] })),
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
