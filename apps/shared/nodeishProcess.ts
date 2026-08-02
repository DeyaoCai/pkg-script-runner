/**
 * Node / 前端开发服务进程名判定（端口列表过滤、清漂移共用）。
 * 无 node:path 依赖，可在 Electron renderer / Vite 中直接用。
 */

const NODEISH_RE =
  /^(node|nodejs|deno|bun|vite|webpack|esbuild|next|nuxt|tsx|ts-node|nodemon)(\.exe)?$/i;

function basename(name: string): string {
  const s = String(name || '').trim();
  if (!s) return '';
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i >= 0 ? s.slice(i + 1) : s;
}

export function isNodeishProcess(name: string): boolean {
  const base = basename(name);
  if (!base) return false;
  if (NODEISH_RE.test(base)) return true;
  return /(?:^|[\\/])(node|nodejs|deno|bun|vite)(\.exe)?$/i.test(base);
}
