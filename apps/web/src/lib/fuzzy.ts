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

export function sameDir(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const norm = (p: string) => p.replace(/[\\/]+$/, '').toLowerCase();
  return norm(a) === norm(b);
}
