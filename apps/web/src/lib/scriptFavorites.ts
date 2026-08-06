import { sameDir } from './fuzzy';

export type ScriptFavorite = {
  dir: string;
  scriptName: string;
};

const FAV_KEY = 'pkg-runner:script-favorites';

export function loadScriptFavorites(): ScriptFavorite[] {
  try {
    const raw = JSON.parse(localStorage.getItem(FAV_KEY) || '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    const out: ScriptFavorite[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const dir = typeof (item as ScriptFavorite).dir === 'string'
        ? (item as ScriptFavorite).dir.trim()
        : '';
      const scriptName =
        typeof (item as ScriptFavorite).scriptName === 'string'
          ? (item as ScriptFavorite).scriptName.trim()
          : '';
      if (!dir || !scriptName) continue;
      out.push({ dir, scriptName });
    }
    return out;
  } catch {
    return [];
  }
}

export function saveScriptFavorites(list: ScriptFavorite[]): void {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function isScriptFavorite(
  list: ScriptFavorite[],
  dir: string,
  scriptName: string,
): boolean {
  return list.some(
    (f) => sameDir(f.dir, dir) && f.scriptName === scriptName,
  );
}

export function toggleScriptFavorite(
  list: ScriptFavorite[],
  dir: string,
  scriptName: string,
): ScriptFavorite[] {
  if (isScriptFavorite(list, dir, scriptName)) {
    return list.filter(
      (f) => !(sameDir(f.dir, dir) && f.scriptName === scriptName),
    );
  }
  return [...list, { dir, scriptName }];
}
