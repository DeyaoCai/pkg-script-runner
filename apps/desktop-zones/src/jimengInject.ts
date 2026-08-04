/**
 * Inject fetch/XHR tap into Jimeng MAIN world (executeJavaScript bypasses CSP).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WebContents } from 'electron';

let tapCache: string | null = null;
let tapMtime = 0;

function injectPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // standalone: dist/inject-jimeng.js; tray embed: dist/zones/inject-jimeng.js
  const candidates = [
    path.join(here, 'zones', 'inject-jimeng.js'),
    path.join(here, 'inject-jimeng.js'),
    path.join(here, '..', 'assets', 'inject-jimeng.js'),
    path.join(here, 'assets', 'inject-jimeng.js'),
    path.join(here, '..', 'desktop-zones', 'assets', 'inject-jimeng.js'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0]!;
}

function readTapScript(): string {
  const file = injectPath();
  try {
    const mt = fs.statSync(file).mtimeMs;
    if (tapCache && mt === tapMtime) return tapCache;
    tapCache = fs.readFileSync(file, 'utf8');
    tapMtime = mt;
    return tapCache;
  } catch (e) {
    console.error('[jimeng] missing inject-jimeng.js at', file, e);
    return '';
  }
}

export async function reinjectJimengTap(wc: WebContents): Promise<void> {
  if (!wc || wc.isDestroyed()) return;
  const tap = readTapScript();
  if (!tap) return;
  try {
    await wc.executeJavaScript(tap, true);
  } catch (e) {
    console.warn(
      '[jimeng] reinject fail:',
      e instanceof Error ? e.message : e,
    );
  }
}
