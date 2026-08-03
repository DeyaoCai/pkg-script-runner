/**
 * Bundle Electron main + preload for pkg-runner,
 * and copy shared fonts into ui/ for glass / web file paths.
 */
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fontsPkg = path.join(root, '..', '..', 'packages', 'fonts');
const fontsOut = path.join(root, 'ui', 'fonts');
const distOut = path.join(root, 'dist');
const dev = process.argv.includes('--dev');

fs.rmSync(distOut, { recursive: true, force: true });
fs.mkdirSync(distOut, { recursive: true });

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  sourcemap: dev,
  minify: !dev,
  packages: 'bundle',
  external: ['electron', 'node-pty', 'koffi'],
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

/** 只打包实际用到的字重，避免整套 JetBrains Mono（约 1.5MB → ~0.3MB） */
const FONT_FACES = [
  { file: 'JetBrainsMono-Regular.woff2', weight: 400, style: 'normal' },
  { file: 'JetBrainsMono-SemiBold.woff2', weight: 600, style: 'normal' },
  { file: 'JetBrainsMono-Bold.woff2', weight: 700, style: 'normal' },
];

fs.rmSync(fontsOut, { recursive: true, force: true });
fs.mkdirSync(path.join(fontsOut, 'files', 'jetbrains-mono'), { recursive: true });
const fontCss = [
  '/* JetBrains Mono (subset) — SIL OFL 1.1 */',
  ...FONT_FACES.flatMap(({ file, weight, style }) => [
    '@font-face {',
    `  font-family: 'JetBrains Mono';`,
    `  font-style: ${style};`,
    `  font-weight: ${weight};`,
    '  font-display: swap;',
    `  src: url('./files/jetbrains-mono/${file}') format('woff2');`,
    '}',
    '',
  ]),
].join('\n');
fs.writeFileSync(path.join(fontsOut, 'jetbrains-mono.css'), fontCss, 'utf8');
for (const { file } of FONT_FACES) {
  fs.copyFileSync(
    path.join(fontsPkg, 'files', 'jetbrains-mono', file),
    path.join(fontsOut, 'files', 'jetbrains-mono', file),
  );
}

console.log('[runner] esbuild ok; fonts trimmed');
