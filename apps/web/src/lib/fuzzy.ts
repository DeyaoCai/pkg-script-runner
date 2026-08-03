export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const t = text.toLowerCase();
  if (t.includes(q)) return 100 - Math.min(50, t.indexOf(q));
  let ti = 0;
  let score = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    const found = t.indexOf(ch, ti);
    if (found < 0) return 0;
    score += 10 - Math.min(9, found - ti);
    ti = found + 1;
  }
  return score;
}

export function fuzzyBestScore(query: string, fields: string[]): number {
  let best = 0;
  for (const f of fields) {
    best = Math.max(best, fuzzyScore(query, f || ''));
  }
  return best;
}

/** `/pattern/flags` → RegExp；否则走模糊。去掉 `g`，避免 `.test` 的 lastIndex 副作用。 */
export function parseSearchQuery(
  query: string,
):
  | { kind: 'empty' }
  | { kind: 'fuzzy'; q: string }
  | { kind: 'regex'; re: RegExp }
  | { kind: 'bad-regex' } {
  const raw = query.trim();
  if (!raw) return { kind: 'empty' };
  const m = /^\/([\s\S]*)\/([gimsuy]*)$/.exec(raw);
  if (!m) return { kind: 'fuzzy', q: raw };
  const flags = (m[2] || '').replace(/g/g, '');
  try {
    return { kind: 'regex', re: new RegExp(m[1], flags) };
  } catch {
    return { kind: 'bad-regex' };
  }
}

/** 脚本/仓库筛选：普通文本模糊；`/dev|build/i` 等为正则。 */
export function filterBestScore(query: string, fields: string[]): number {
  const parsed = parseSearchQuery(query);
  if (parsed.kind === 'empty') return 1;
  if (parsed.kind === 'bad-regex') return 0;
  if (parsed.kind === 'fuzzy') return fuzzyBestScore(parsed.q, fields);
  let best = 0;
  for (const f of fields) {
    const text = f || '';
    parsed.re.lastIndex = 0;
    if (!parsed.re.test(text)) continue;
    parsed.re.lastIndex = 0;
    const idx = text.search(parsed.re);
    best = Math.max(best, 100 - Math.min(50, idx < 0 ? 50 : idx));
  }
  return best;
}

export function sameDir(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const norm = (p: string) => p.replace(/[\\/]+$/, '').toLowerCase();
  return norm(a) === norm(b);
}
