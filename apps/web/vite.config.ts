import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const runnerUi = path.join(root, '..', 'runner', 'ui');
const sharedDir = path.join(root, '..', 'shared');
const tokensPkg = path.join(root, '..', '..', 'packages', 'tokens');
const assetsPkg = path.join(root, '..', '..', 'packages', 'assets');

export default defineConfig({
  root,
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.join(root, 'src'),
      '@pkg-runner/shared': sharedDir,
      '@pkg-runner/tokens/tokens.css': path.join(tokensPkg, 'tokens.css'),
      '@pkg-runner/tokens': path.join(tokensPkg, 'src', 'index.ts'),
      '@pkg-runner/assets/media': path.join(assetsPkg, 'media'),
      '@pkg-runner/assets': path.join(assetsPkg, 'src', 'index.ts'),
      '@pkg-runner/controller': path.join(
        root,
        '..',
        '..',
        'packages',
        'controller',
        'src',
        'index.ts',
      ),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5200,
    strictPort: true,
    fs: {
      allow: [root, runnerUi, sharedDir, tokensPkg, assetsPkg],
    },
  },
  build: {
    // Packaged by runner electron-builder as dist-ui/
    outDir: path.join(root, '..', 'runner', 'dist-ui'),
    emptyOutDir: true,
    sourcemap: true,
  },
});
