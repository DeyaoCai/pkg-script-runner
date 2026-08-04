/**
 * Bundle Electron main (ESM) + preloads (CJS for renderer preload context).
 * Embeds runnerHost + editorHost (single-process app).
 */
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const runnerRoot = path.join(root, '..', 'runner');
const editorRoot = path.join(root, '..', 'code-editor');
const zonesRoot = path.join(root, '..', 'desktop-zones');
const distOut = path.join(root, 'dist');
const runnerDistOut = path.join(distOut, 'runner');
const editorDistOut = path.join(distOut, 'editor');
const zonesDistOut = path.join(distOut, 'zones');
const dev = process.argv.includes('--dev');

fs.rmSync(distOut, { recursive: true, force: true });
fs.mkdirSync(distOut, { recursive: true });
fs.mkdirSync(runnerDistOut, { recursive: true });
fs.mkdirSync(editorDistOut, { recursive: true });
fs.mkdirSync(zonesDistOut, { recursive: true });

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  sourcemap: dev,
  minify: !dev,
  packages: 'bundle',
  external: ['electron', 'koffi', 'node-pty'],
};

await esbuild.build({
  ...shared,
  entryPoints: [path.join(root, 'src/main.ts')],
  outfile: path.join(distOut, 'main.js'),
  format: 'esm',
});

/** Tray panel preloads */
await esbuild.build({
  ...shared,
  entryPoints: [
    path.join(root, 'src/preload.ts'),
    path.join(root, 'src/screenshot-preload.ts'),
  ],
  outdir: distOut,
  outbase: path.join(root, 'src'),
  format: 'cjs',
  outExtension: { '.js': '.cjs' },
});

/** Runner UI preload (same process, separate BrowserWindow) */
await esbuild.build({
  bundle: true,
  platform: 'node',
  target: 'node20',
  sourcemap: false,
  minify: false,
  entryPoints: [path.join(runnerRoot, 'src/preload.ts')],
  outfile: path.join(runnerDistOut, 'preload.cjs'),
  format: 'cjs',
  external: ['electron'],
});

/** Editor UI preload (same process) */
await esbuild.build({
  bundle: true,
  platform: 'node',
  target: 'node20',
  sourcemap: false,
  minify: false,
  entryPoints: [path.join(editorRoot, 'src/main/preload.ts')],
  outfile: path.join(editorDistOut, 'preload.cjs'),
  format: 'cjs',
  external: ['electron'],
});

/** Desktop Zones UI preload (same process) */
await esbuild.build({
  bundle: true,
  platform: 'node',
  target: 'node20',
  sourcemap: false,
  minify: false,
  entryPoints: [path.join(zonesRoot, 'src/preload.ts')],
  outfile: path.join(zonesDistOut, 'preload.cjs'),
  format: 'cjs',
  external: ['electron'],
});

/** Jimeng page preload + MAIN-world inject (fetch/XHR tap) */
await esbuild.build({
  bundle: true,
  platform: 'node',
  target: 'node20',
  sourcemap: false,
  minify: false,
  entryPoints: [path.join(zonesRoot, 'src/jimengPagePreload.ts')],
  outfile: path.join(zonesDistOut, 'jimengPagePreload.cjs'),
  format: 'cjs',
  external: ['electron'],
});

const injectSrc = path.join(zonesRoot, 'assets', 'inject-jimeng.js');
const injectDst = path.join(zonesDistOut, 'inject-jimeng.js');
if (fs.existsSync(injectSrc)) {
  fs.copyFileSync(injectSrc, injectDst);
} else {
  console.warn('[tray] missing desktop-zones/assets/inject-jimeng.js');
}

console.log('[tray] esbuild ok (embedded runnerHost + editorHost + zonesHost)');
