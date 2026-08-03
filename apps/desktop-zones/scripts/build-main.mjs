/**
 * Bundle Electron main + preload for desktop-zones.
 */
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const distOut = path.join(root, 'dist');
const dev = process.argv.includes('--dev');

fs.mkdirSync(distOut, { recursive: true });
for (const name of fs.readdirSync(distOut)) {
  if (name === 'renderer') continue;
  fs.rmSync(path.join(distOut, name), { recursive: true, force: true });
}

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  sourcemap: dev,
  minify: !dev,
  packages: 'bundle',
  external: ['electron', 'koffi'],
};

await esbuild.build({
  ...shared,
  entryPoints: [path.join(root, 'src/main.ts')],
  outfile: path.join(distOut, 'main.js'),
  format: 'esm',
});

/** Preload must be .cjs — package.json "type":"module" makes .js load as ESM and breaks preload. */
await esbuild.build({
  ...shared,
  entryPoints: [path.join(root, 'src/preload.ts')],
  outdir: distOut,
  outbase: path.join(root, 'src'),
  format: 'cjs',
  outExtension: { '.js': '.cjs' },
});

console.log('[desktop-zones] esbuild ok');
