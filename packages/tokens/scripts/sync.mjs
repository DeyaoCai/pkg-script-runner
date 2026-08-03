/**
 * Sync tokens.css + frameless chrome.css + browser IIFE into tray ui (file:// / asar).
 * chrome.css is flattened from @pkg-runner/shell renderer sources so tray pages
 * can load it next to tokens without CSS @import resolution.
 */
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.join(pkgRoot, '..', '..');
const repoApps = path.join(repoRoot, 'apps');
const shellCssDir = path.join(repoRoot, 'packages', 'shell', 'src', 'renderer');

const cssSrc = path.join(pkgRoot, 'tokens.css');
const chromeParts = ['drag.css', 'titlebar.css', 'titlebar-controls.css', 'window-controls.css'];

const bannerTokens =
  '/* GENERATED from packages/tokens/tokens.css — do not edit; run pnpm --filter @pkg-runner/tokens sync */\n';
const bannerChrome =
  '/* GENERATED from packages/shell/src/renderer/{drag,titlebar,titlebar-controls,window-controls}.css — do not edit; run pnpm --filter @pkg-runner/tokens sync */\n';

const cssBody = fs.readFileSync(cssSrc, 'utf8');
const chromeBody = chromeParts
  .map((name) => {
    const p = path.join(shellCssDir, name);
    const raw = fs.readFileSync(p, 'utf8');
    return `/* --- ${name} --- */\n${raw.trim()}\n`;
  })
  .join('\n');

/** Package export for Vite: `@pkg-runner/tokens/chrome.css` */
const chromePkgOut = path.join(pkgRoot, 'chrome.css');
fs.writeFileSync(chromePkgOut, bannerChrome + chromeBody, 'utf8');
console.log('[tokens] chrome →', path.relative(pkgRoot, chromePkgOut));

const trayUi = path.join(repoApps, 'tray', 'ui');
const cssTargets = [
  { dest: path.join(trayUi, 'tokens.css'), body: bannerTokens + cssBody },
  { dest: path.join(trayUi, 'chrome.css'), body: bannerChrome + chromeBody },
];

for (const { dest, body } of cssTargets) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, body, 'utf8');
  console.log('[tokens] css →', path.relative(pkgRoot, dest));
}

const browserEntry = path.join(pkgRoot, 'src', 'browser.ts');
const browserOut = path.join(trayUi, 'pkg-tokens.js');
await esbuild.build({
  entryPoints: [browserEntry],
  outfile: browserOut,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  minify: true,
});
console.log('[tokens] browser →', path.relative(pkgRoot, browserOut));
