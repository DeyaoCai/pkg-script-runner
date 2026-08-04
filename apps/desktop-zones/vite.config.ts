import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(root, '../..');
const tokensPkg = path.join(repoRoot, 'packages/tokens');
const fontsPkg = path.join(repoRoot, 'packages/fonts');
const uiPkg = path.join(repoRoot, 'packages/ui');
const controllerPkg = path.join(repoRoot, 'packages/controller');
const shellPkg = path.join(repoRoot, 'packages/shell');
const assetsPkg = path.join(repoRoot, 'packages/assets');

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
        find: '@pkg-runner/fonts',
        replacement: fontsPkg,
      },
      {
        find: '@pkg-runner/ui',
        replacement: uiPkg,
      },
      {
        find: '@pkg-runner/assets/media',
        replacement: path.join(assetsPkg, 'media'),
      },
      {
        find: '@pkg-runner/tokens/tokens.css',
        replacement: path.join(tokensPkg, 'tokens.css'),
      },
      {
        find: '@pkg-runner/tokens/chrome.css',
        replacement: path.join(shellPkg, 'src/renderer/chrome.css'),
      },
      {
        find: '@pkg-runner/tokens',
        replacement: path.join(tokensPkg, 'src/index.ts'),
      },
      {
        find: '@pkg-runner/controller',
        replacement: path.join(controllerPkg, 'src/index.ts'),
      },
      {
        find: '@pkg-runner/shell/renderer/WindowControls.vue',
        replacement: path.join(shellPkg, 'src/renderer/WindowControls.vue'),
      },
      {
        find: '@pkg-runner/shell/renderer/TitleBarShell.vue',
        replacement: path.join(shellPkg, 'src/renderer/TitleBarShell.vue'),
      },
      {
        find: '@pkg-runner/shell/renderer/TitleBarChip.vue',
        replacement: path.join(shellPkg, 'src/renderer/TitleBarChip.vue'),
      },
      {
        find: '@pkg-runner/shell/renderer/TitleBarMeta.vue',
        replacement: path.join(shellPkg, 'src/renderer/TitleBarMeta.vue'),
      },
      {
        find: '@pkg-runner/shell/renderer/TitleBarAction.vue',
        replacement: path.join(shellPkg, 'src/renderer/TitleBarAction.vue'),
      },
      {
        find: '@pkg-runner/shell/renderer/WallpaperStudio.vue',
        replacement: path.join(shellPkg, 'src/renderer/WallpaperStudio.vue'),
      },
      {
        find: /^@pkg-runner\/shell\/renderer$/,
        replacement: path.join(shellPkg, 'src/renderer/index.ts'),
      },
    ],
  },
  build: {
    outDir: path.join(root, 'dist/renderer'),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5203,
    strictPort: true,
    fs: {
      allow: [repoRoot],
    },
  },
});
