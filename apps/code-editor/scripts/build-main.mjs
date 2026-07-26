/**
 * Bundle Electron main + preload for code-editor.
 */
import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

await esbuild.build({
  entryPoints: [
    path.join(root, 'src/main/main.ts'),
    path.join(root, 'src/main/preload.ts'),
  ],
  outdir: path.join(root, 'dist/main'),
  outbase: path.join(root, 'src/main'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  packages: 'bundle',
  external: ['electron', 'node-pty'],
});

console.log('[code-editor] esbuild ok');
