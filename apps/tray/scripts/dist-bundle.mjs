/**
 * Stage companion UIs + wallpapers, then run electron-builder.
 *
 * Usage:
 *   node ./scripts/dist-bundle.mjs           # nsis + dir
 *   node ./scripts/dist-bundle.mjs --dir     # dir only
 *
 * Expects prior builds:
 *   pnpm --filter @pkg-runner/runner build
 *   pnpm --filter @pkg-runner/code-editor build
 *   pnpm --filter @pkg-runner/desktop-zones build
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
const zonesRoot = path.join(repoRoot, 'apps', 'desktop-zones');
const wallpaperRoot = path.join(repoRoot, 'packages', 'wallpaper');
const dirOnly = process.argv.includes('--dir');

function die(msg) {
  console.error(`[tray-dist] ${msg}`);
  process.exit(1);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function requireDir(label, dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    die(`missing ${label}: ${dir}`);
  }
  const entries = fs.readdirSync(dir);
  if (entries.length === 0) die(`empty ${label}: ${dir}`);
  return dir;
}

function newestMtime(dir) {
  let newest = 0;
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else {
        const t = fs.statSync(p).mtimeMs;
        if (t > newest) newest = t;
      }
    }
  };
  walk(dir);
  return newest ? new Date(newest).toISOString() : '(none)';
}

function gitShort() {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: true,
  });
  if ((r.status ?? 1) !== 0) return 'nogit';
  return String(r.stdout || '').trim() || 'nogit';
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

const buildStamp = `${new Date().toISOString().slice(0, 10)}.${gitShort()}`;
process.env.PKG_BUILD_STAMP = buildStamp;

const stageRoot = path.join(trayRoot, 'release-stage');
fs.rmSync(stageRoot, { recursive: true, force: true });
fs.mkdirSync(stageRoot, { recursive: true });

const runnerUi = requireDir(
  'runner dist-ui (pnpm --filter @pkg-runner/runner build)',
  path.join(runnerRoot, 'dist-ui'),
);
const editorRenderer = requireDir(
  'editor renderer (pnpm --filter @pkg-runner/code-editor build)',
  path.join(editorRoot, 'dist', 'renderer'),
);
const zonesRenderer = requireDir(
  'desktop-zones renderer (pnpm --filter @pkg-runner/desktop-zones build)',
  path.join(zonesRoot, 'dist', 'renderer'),
);
const wallpapersSrc = requireDir(
  'bundled wallpapers (packages/wallpaper/wallpapers)',
  path.join(wallpaperRoot, 'wallpapers'),
);

const runnerStage = path.join(stageRoot, 'runner');
copyDir(runnerUi, path.join(runnerStage, 'dist-ui'));
const runnerUiSrc = path.join(runnerRoot, 'ui');
if (fs.existsSync(runnerUiSrc)) {
  copyDir(runnerUiSrc, path.join(runnerStage, 'ui'));
}
const trayRunnerPreload = path.join(trayRoot, 'dist', 'runner', 'preload.cjs');
if (!fs.existsSync(trayRunnerPreload)) {
  die(`missing tray runner preload: ${trayRunnerPreload} (pnpm --filter @pkg-runner/tray build)`);
}
fs.mkdirSync(path.join(runnerStage, 'dist'), { recursive: true });
fs.copyFileSync(trayRunnerPreload, path.join(runnerStage, 'dist', 'preload.cjs'));

const editorStage = path.join(stageRoot, 'code-editor');
copyDir(editorRenderer, path.join(editorStage, 'dist', 'renderer'));
const trayEditorPreload = path.join(trayRoot, 'dist', 'editor', 'preload.cjs');
if (!fs.existsSync(trayEditorPreload)) {
  die(`missing tray editor preload: ${trayEditorPreload}`);
}
fs.mkdirSync(path.join(editorStage, 'dist'), { recursive: true });
fs.copyFileSync(trayEditorPreload, path.join(editorStage, 'dist', 'preload.cjs'));

const zonesStage = path.join(stageRoot, 'desktop-zones');
copyDir(zonesRenderer, path.join(zonesStage, 'dist', 'renderer'));
const trayZonesPreload = path.join(trayRoot, 'dist', 'zones', 'preload.cjs');
if (!fs.existsSync(trayZonesPreload)) {
  die(`missing tray zones preload: ${trayZonesPreload}`);
}
fs.mkdirSync(path.join(zonesStage, 'dist'), { recursive: true });
fs.copyFileSync(trayZonesPreload, path.join(zonesStage, 'dist', 'preload.cjs'));

const wallpapersStage = path.join(stageRoot, 'wallpapers');
copyDir(wallpapersSrc, wallpapersStage);
// Packaged jimeng dir starts empty (downloads go here at runtime).
const jimengStage = path.join(stageRoot, 'jimeng');
fs.mkdirSync(jimengStage, { recursive: true });
fs.writeFileSync(
  path.join(jimengStage, 'README.txt'),
  'Jimeng wallpaper downloads are stored in this folder.\n',
  'utf8',
);

fs.writeFileSync(
  path.join(stageRoot, 'build-stamp.json'),
  JSON.stringify(
    {
      stamp: buildStamp,
      builtAt: new Date().toISOString(),
      git: gitShort(),
      mtimes: {
        runnerUi: newestMtime(runnerUi),
        editorRenderer: newestMtime(editorRenderer),
        zonesRenderer: newestMtime(zonesRenderer),
        trayMain: fs.existsSync(path.join(trayRoot, 'dist', 'main.js'))
          ? new Date(fs.statSync(path.join(trayRoot, 'dist', 'main.js')).mtimeMs).toISOString()
          : null,
      },
    },
    null,
    2,
  ),
  'utf8',
);

console.log('[tray-dist] staged:');
console.log('  runner ui     ', newestMtime(runnerUi));
console.log('  editor ui     ', newestMtime(editorRenderer));
console.log('  zones ui      ', newestMtime(zonesRenderer));
console.log('  wallpapers    ', newestMtime(wallpapersSrc));
console.log('  build stamp   ', buildStamp);

// Wipe previous electron-builder output so we never ship a half-updated tree.
const releaseDir = path.join(trayRoot, 'release');
fs.rmSync(releaseDir, { recursive: true, force: true });

const ebArgs = dirOnly
  ? ['exec', 'electron-builder', '--win', 'dir', '--x64']
  : ['exec', 'electron-builder', '--win', 'nsis', 'dir', '--x64'];

const build = spawnSync('pnpm', ebArgs, {
  cwd: trayRoot,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, PKG_BUILD_STAMP: buildStamp },
});
if ((build.status ?? 1) !== 0) process.exit(build.status ?? 1);

const setups = fs.existsSync(releaseDir)
  ? fs
      .readdirSync(releaseDir)
      .filter((n) => /Setup.*\.exe$/i.test(n) || /^PkgRunner-Setup/i.test(n))
  : [];
console.log('');
console.log('[tray-dist] 安装包（推荐发给用户）:');
for (const n of setups) console.log(' ', path.join(releaseDir, n));
if (!dirOnly && setups.length === 0) {
  console.warn('[tray-dist] 未找到 Setup exe');
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
console.log('[tray-dist] build stamp:', buildStamp);
console.log('');
process.exit(0);
