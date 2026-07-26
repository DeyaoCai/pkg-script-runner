/**
 * Bundle Electron main + preloads for tray host.
 */
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const distOut = path.join(root, 'dist');
const dev = process.argv.includes('--dev');

fs.rmSync(distOut, { recursive: true, force: true });

await esbuild.build({
  entryPoints: [
    path.join(root, 'src/main.ts'),
    path.join(root, 'src/preload.ts'),
    path.join(root, 'src/screenshot-preload.ts'),
  ],
  outdir: distOut,
  outbase: path.join(root, 'src'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: dev,
  minify: !dev,
  packages: 'bundle',
  external: ['electron', 'koffi'],
});

console.log('[tray] esbuild ok');
