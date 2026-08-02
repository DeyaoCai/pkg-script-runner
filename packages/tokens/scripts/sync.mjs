/**
 * Sync tokens.css + browser IIFE into app ui folders (file:// / asar).
 */
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoApps = path.join(pkgRoot, '..', '..', 'apps');
const cssSrc = path.join(pkgRoot, 'tokens.css');

const cssTargets = [
  path.join(repoApps, 'runner', 'ui', 'tokens.css'),
  path.join(repoApps, 'tray', 'ui', 'tokens.css'),
];

const banner =
  '/* GENERATED from packages/tokens/tokens.css — do not edit; run pnpm --filter @pkg-runner/tokens sync */\n';
const cssBody = fs.readFileSync(cssSrc, 'utf8');
for (const dest of cssTargets) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, banner + cssBody, 'utf8');
  console.log('[tokens] css →', path.relative(pkgRoot, dest));
}

const browserEntry = path.join(pkgRoot, 'src', 'browser.ts');
const browserOut = path.join(repoApps, 'tray', 'ui', 'pkg-tokens.js');
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
