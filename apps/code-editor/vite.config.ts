import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(root, '../..');

export default defineConfig({
  root,
  base: './',
  plugins: [vue()],
  resolve: {
    alias: [
      {
        find: '@',
        replacement: path.join(root, 'src/renderer'),
      },
      {
        find: '@pkg-runner/controller',
        replacement: path.join(repoRoot, 'packages/controller/src/index.ts'),
      },
      {
        find: '@pkg-runner/shell/renderer/WindowControls.vue',
        replacement: path.join(
          repoRoot,
          'packages/shell/src/renderer/WindowControls.vue',
        ),
      },
      {
        find: '@pkg-runner/shell/renderer/tip.css',
        replacement: path.join(repoRoot, 'packages/shell/src/renderer/tip.css'),
      },
      {
        find: '@pkg-runner/shell/renderer/drag.css',
        replacement: path.join(repoRoot, 'packages/shell/src/renderer/drag.css'),
      },
      {
        find: '@pkg-runner/shell/renderer/window-controls.css',
        replacement: path.join(
          repoRoot,
          'packages/shell/src/renderer/window-controls.css',
        ),
      },
      {
        find: /^@pkg-runner\/shell\/renderer$/,
        replacement: path.join(
          repoRoot,
          'packages/shell/src/renderer/index.ts',
        ),
      },
    ],
  },
  build: {
    outDir: path.join(root, 'dist/renderer'),
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5201,
    strictPort: true,
    fs: {
      allow: [repoRoot],
    },
  },
});
