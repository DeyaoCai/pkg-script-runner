/**
 * Build tray portable and stage sibling Runner / Editor portable exes.
 *
 * Expects prior:
 *   pnpm --filter @pkg-runner/runner dist:win
 *   pnpm --filter @pkg-runner/code-editor dist:win
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const trayRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.join(trayRoot, '..', '..');

function findPortableExe(appDir, prefix) {
  const releaseDir = path.join(appDir, 'release');
  if (!fs.existsSync(releaseDir)) return null;
  for (const name of fs.readdirSync(releaseDir)) {
    if (!name.toLowerCase().endsWith('.exe')) continue;
    if (name.startsWith(prefix) && name.includes('portable')) {
      return path.join(releaseDir, name);
    }
  }
  return null;
}

const runnerPortable = findPortableExe(path.join(repoRoot, 'apps', 'runner'), 'PkgRunner');
const editorPortable = findPortableExe(
  path.join(repoRoot, 'apps', 'code-editor'),
  'CodeEditor',
);

const stage = path.join(trayRoot, 'release-stage', 'apps');
fs.rmSync(path.join(trayRoot, 'release-stage'), { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

if (runnerPortable) {
  fs.copyFileSync(runnerPortable, path.join(stage, 'PkgRunner.exe'));
  console.log('[tray-dist] staged runner', runnerPortable);
} else {
  console.warn('[tray-dist] runner portable exe not found');
}
if (editorPortable) {
  fs.copyFileSync(editorPortable, path.join(stage, 'CodeEditor.exe'));
  console.log('[tray-dist] staged editor', editorPortable);
} else {
  console.warn('[tray-dist] editor portable exe not found');
}

const build = spawnSync('pnpm', ['exec', 'electron-builder', '--win', 'portable', '--x64'], {
  cwd: trayRoot,
  stdio: 'inherit',
  shell: true,
});
process.exit(build.status ?? 1);
