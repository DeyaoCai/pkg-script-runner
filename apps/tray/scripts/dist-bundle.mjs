/**
 * Build Windows installer (NSIS) + win-unpacked for debugging.
 *
 * Expects prior:
 *   pnpm --filter @pkg-runner/runner build
 *   pnpm --filter @pkg-runner/code-editor build
 *   pnpm --filter @pkg-runner/tray build
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const trayRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.join(trayRoot, '..', '..');
const runnerRoot = path.join(repoRoot, 'apps', 'runner');
const editorRoot = path.join(repoRoot, 'apps', 'code-editor');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function desktopDir() {
  const home = process.env.USERPROFILE || os.homedir();
  const candidates = [
    process.env.OneDrive ? path.join(process.env.OneDrive, 'Desktop') : null,
    path.join(home, 'Desktop'),
    path.join(home, '桌面'),
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.join(home, 'Desktop');
}

const stageRoot = path.join(trayRoot, 'release-stage');
fs.rmSync(stageRoot, { recursive: true, force: true });

fs.mkdirSync(path.join(stageRoot, 'apps'), { recursive: true });

const runnerStage = path.join(stageRoot, 'runner');
const distUi = path.join(runnerRoot, 'dist-ui');
if (fs.existsSync(distUi)) {
  copyDir(distUi, path.join(runnerStage, 'dist-ui'));
  console.log('[tray-dist] staged runner dist-ui');
} else {
  console.warn('[tray-dist] runner dist-ui not found — run pnpm --filter @pkg-runner/runner build');
}
const runnerUi = path.join(runnerRoot, 'ui');
if (fs.existsSync(runnerUi)) {
  copyDir(runnerUi, path.join(runnerStage, 'ui'));
  console.log('[tray-dist] staged runner ui');
}

const trayRunnerPreload = path.join(trayRoot, 'dist', 'runner', 'preload.cjs');
if (fs.existsSync(trayRunnerPreload)) {
  const distStage = path.join(runnerStage, 'dist');
  fs.mkdirSync(distStage, { recursive: true });
  fs.copyFileSync(trayRunnerPreload, path.join(distStage, 'preload.cjs'));
  console.log('[tray-dist] staged runner preload');
}

const editorStage = path.join(stageRoot, 'code-editor');
const editorRenderer = path.join(editorRoot, 'dist', 'renderer');
if (fs.existsSync(editorRenderer)) {
  copyDir(editorRenderer, path.join(editorStage, 'dist', 'renderer'));
  console.log('[tray-dist] staged editor renderer');
} else {
  console.warn(
    '[tray-dist] editor renderer not found — run pnpm --filter @pkg-runner/code-editor build',
  );
}
const trayEditorPreload = path.join(trayRoot, 'dist', 'editor', 'preload.cjs');
if (fs.existsSync(trayEditorPreload)) {
  const distStage = path.join(editorStage, 'dist');
  fs.mkdirSync(distStage, { recursive: true });
  fs.copyFileSync(trayEditorPreload, path.join(distStage, 'preload.cjs'));
  console.log('[tray-dist] staged editor preload fallback');
}

const build = spawnSync(
  'pnpm',
  ['exec', 'electron-builder', '--win', 'nsis', 'dir', '--x64'],
  {
    cwd: trayRoot,
    stdio: 'inherit',
    shell: true,
  },
);
if ((build.status ?? 1) !== 0) process.exit(build.status ?? 1);

const releaseDir = path.join(trayRoot, 'release');
const setups = fs.existsSync(releaseDir)
  ? fs
      .readdirSync(releaseDir)
      .filter((n) => /Setup.*\.exe$/i.test(n) || /^PkgRunner-Setup/i.test(n))
  : [];
console.log('');
console.log('[tray-dist] 安装包（推荐发给用户）:');
for (const n of setups) console.log(' ', path.join(releaseDir, n));
if (setups.length === 0) {
  console.log(' ', path.join(releaseDir, 'PkgRunner-Setup-*.exe'));
}

const desk = desktopDir();
if (setups.length > 0) {
  try {
    fs.mkdirSync(desk, { recursive: true });
    for (const n of setups) {
      const from = path.join(releaseDir, n);
      const to = path.join(desk, n);
      fs.copyFileSync(from, to);
      console.log('[tray-dist] 已复制到桌面:', to);
    }
  } catch (err) {
    console.warn(
      '[tray-dist] 复制到桌面失败:',
      err instanceof Error ? err.message : err,
    );
  }
}

console.log('[tray-dist] 调试用解压目录:');
console.log(' ', path.join(releaseDir, 'win-unpacked', 'PkgRunnerTray.exe'));
console.log('');
process.exit(0);
