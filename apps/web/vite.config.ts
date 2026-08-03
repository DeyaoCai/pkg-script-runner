import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const runnerUi = path.join(root, '..', 'runner', 'ui');
const sharedDir = path.join(root, '..', 'shared');
const tokensPkg = path.join(root, '..', '..', 'packages', 'tokens');
const assetsPkg = path.join(root, '..', '..', 'packages', 'assets');
const fontsPkg = path.join(root, '..', '..', 'packages', 'fonts');
const uiPkg = path.join(root, '..', '..', 'packages', 'ui');
const shellPkg = path.join(root, '..', '..', 'packages', 'shell');

export default defineConfig({
  root,
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.join(root, 'src'),
      '@pkg-runner/shared': sharedDir,
      '@pkg-runner/tokens/tokens.css': path.join(tokensPkg, 'tokens.css'),
      '@pkg-runner/tokens/chrome.css': path.join(
        shellPkg,
        'src/renderer/chrome.css',
      ),
      '@pkg-runner/tokens': path.join(tokensPkg, 'src', 'index.ts'),
      '@pkg-runner/assets/media': path.join(assetsPkg, 'media'),
      '@pkg-runner/assets': path.join(assetsPkg, 'src', 'index.ts'),
      '@pkg-runner/fonts': fontsPkg,
      '@pkg-runner/ui': uiPkg,
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
      '@pkg-runner/shell/renderer/ShellPanel.vue': path.join(
        shellPkg,
        'src/renderer/ShellPanel.vue',
      ),
      '@pkg-runner/shell/renderer/WindowControls.vue': path.join(
        shellPkg,
        'src/renderer/WindowControls.vue',
      ),
      '@pkg-runner/shell/renderer': path.join(
        shellPkg,
        'src/renderer/index.ts',
      ),
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
      allow: [
        root,
        runnerUi,
        sharedDir,
        tokensPkg,
        assetsPkg,
        fontsPkg,
        uiPkg,
        shellPkg,
      ],
    },
  },
  build: {
    outDir: path.join(root, '..', 'runner', 'dist-ui'),
    emptyOutDir: true,
    sourcemap: true,
  },
});
