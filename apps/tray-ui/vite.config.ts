import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const packagesDir = path.join(root, '..', '..', 'packages');
const tokensPkg = path.join(packagesDir, 'tokens');
const controllerPkg = path.join(packagesDir, 'controller');
const fontsPkg = path.join(packagesDir, 'fonts');
const uiPkg = path.join(packagesDir, 'ui');
const shellPkg = path.join(packagesDir, 'shell');
const assetsPkg = path.join(packagesDir, 'assets');

export default defineConfig({
  root,
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.join(root, 'src'),
      '@pkg-runner/tokens/tokens.css': path.join(tokensPkg, 'tokens.css'),
      '@pkg-runner/tokens/chrome.css': path.join(
        shellPkg,
        'src/renderer/chrome.css',
      ),
      '@pkg-runner/tokens': path.join(tokensPkg, 'src', 'index.ts'),
      '@pkg-runner/fonts': fontsPkg,
      '@pkg-runner/ui': uiPkg,
      '@pkg-runner/controller': path.join(controllerPkg, 'src', 'index.ts'),
      '@pkg-runner/shell/renderer/TitleBarShell.vue': path.join(
        shellPkg,
        'src/renderer/TitleBarShell.vue',
      ),
      '@pkg-runner/shell/renderer/TitleBarChip.vue': path.join(
        shellPkg,
        'src/renderer/TitleBarChip.vue',
      ),
      '@pkg-runner/shell/renderer/TitleBarMeta.vue': path.join(
        shellPkg,
        'src/renderer/TitleBarMeta.vue',
      ),
      '@pkg-runner/shell/renderer/TitleBarAction.vue': path.join(
        shellPkg,
        'src/renderer/TitleBarAction.vue',
      ),
      '@pkg-runner/shell/renderer/WindowControls.vue': path.join(
        shellPkg,
        'src/renderer/WindowControls.vue',
      ),
      '@pkg-runner/shell/renderer/WallpaperStudio.vue': path.join(
        shellPkg,
        'src/renderer/WallpaperStudio.vue',
      ),
      '@pkg-runner/shell/renderer': path.join(
        shellPkg,
        'src/renderer/index.ts',
      ),
      '@pkg-runner/assets/media': path.join(assetsPkg, 'media'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5202,
    strictPort: true,
    fs: {
      allow: [
        root,
        tokensPkg,
        controllerPkg,
        fontsPkg,
        uiPkg,
        shellPkg,
        assetsPkg,
      ],
    },
  },
  build: {
    outDir: path.join(root, '..', 'tray', 'dist-ui'),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        settings: path.join(root, 'settings.html'),
        history: path.join(root, 'history.html'),
      },
    },
  },
});
