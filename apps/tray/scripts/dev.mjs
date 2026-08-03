/**
 * Dev: 默认轻量启动（dist-ui，不起 Vite），避免双 Vite + 多窗预热卡主机。
 *
 * HMR（显式）：
 *   pnpm dev -- --hmr
 *   或 PKG_RUNNER_UI_DEV=1
 *
 * 可选：PKG_RUNNER_DEV_KILL=1 启动前清旧 electron（会跑 CIM，可能顿一下）
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const trayRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.join(trayRoot, '..', '..');
const runnerRoot = path.join(repoRoot, 'apps', 'runner');
const editorRoot = path.join(repoRoot, 'apps', 'code-editor');
const zonesRoot = path.join(repoRoot, 'apps', 'desktop-zones');
const UI_URL = process.env.PKG_RUNNER_UI_URL?.trim() || 'http://127.0.0.1:5200';
const EDITOR_URL =
  process.env.CODE_EDITOR_DEV_URL?.trim() || 'http://127.0.0.1:5201';
const TRAY_UI_URL =
  process.env.PKG_TRAY_UI_URL?.trim() || 'http://127.0.0.1:5202';
const ZONES_UI_URL =
  process.env.PKG_ZONES_UI_URL?.trim() || 'http://127.0.0.1:5203';

const argv = process.argv.slice(2);
const wantHmr =
  argv.includes('--hmr') ||
  process.env.PKG_RUNNER_UI_DEV === '1' ||
  process.env.PKG_RUNNER_UI_DEV === 'true';

function killStalePkgRunnerElectron() {
  // 默认跳过：Get-CimInstance 扫全机 electron 会明显卡主机
  if (process.env.PKG_RUNNER_DEV_KILL !== '1') return 0;
  if (process.env.PKG_RUNNER_DEV_NO_KILL === '1') return 0;
  const repoMarker = path.normalize(repoRoot).toLowerCase();
  const editorMarker = path.normalize(editorRoot).toLowerCase();
  let killed = 0;

  if (process.platform === 'win32') {
    const ps = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    const raw = (ps.stdout || '').trim();
    if (!raw) return 0;
    let rows = [];
    try {
      rows = JSON.parse(raw);
      if (!Array.isArray(rows)) rows = [rows];
    } catch {
      return 0;
    }
    for (const row of rows) {
      const cmd = String(row.CommandLine || '').toLowerCase();
      const pid = Number(row.ProcessId);
      if (!Number.isFinite(pid) || pid <= 0) continue;
      const isPkgRunner =
        (cmd.includes('user-data-dir=') && cmd.includes('pkg-runner-dev')) ||
        (cmd.includes(repoMarker) &&
          (cmd.includes('apps\\tray') ||
            cmd.includes('apps/tray') ||
            cmd.includes('@pkg-runner/tray')));
      const isEditor =
        cmd.includes(editorMarker) ||
        (cmd.includes('user-data-dir=') && cmd.includes('code-editor'));
      if (!isPkgRunner && !isEditor) continue;
      try {
        process.kill(pid);
        killed += 1;
        console.log(`[dev] killed stale electron pid=${pid}`);
      } catch {
        /* ignore */
      }
    }
    return killed;
  }

  const pgrep = spawnSync('pgrep', ['-f', 'electron'], { encoding: 'utf8' });
  for (const line of (pgrep.stdout || '').split('\n')) {
    const pid = Number(line.trim());
    if (!Number.isFinite(pid) || pid <= 0) continue;
    try {
      const ps = spawnSync('ps', ['-p', String(pid), '-o', 'command='], {
        encoding: 'utf8',
      });
      const cmd = (ps.stdout || '').toLowerCase();
      if (!cmd.includes('pkg-runner') && !cmd.includes('pkg-script-runner'))
        continue;
      process.kill(pid);
      killed += 1;
      console.log(`[dev] killed stale electron pid=${pid}`);
    } catch {
      /* ignore */
    }
  }
  return killed;
}

function waitUrl(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`timeout waiting for ${url}`));
          return;
        }
        setTimeout(tick, 250);
      });
    };
    tick();
  });
}

function urlReady(url) {
  return waitUrl(url, 1500).then(
    () => true,
    () => false,
  );
}

function killProcessTree(proc, label) {
  if (!proc || proc.killed) return;
  const pid = proc.pid;
  if (!pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
      stdio: 'ignore',
      windowsHide: true,
    });
    console.log(`[dev] stopped ${label} pid=${pid}`);
    return;
  }
  try {
    proc.kill('SIGTERM');
  } catch {
    /* ignore */
  }
}

function run(cwd, cmd, args, env = process.env) {
  return spawn(cmd, args, {
    cwd,
    env,
    stdio: 'inherit',
    shell: true,
  });
}

function runSync(cwd, cmd, args) {
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exit ${r.status}`);
  }
}

/**
 * @param {string} url
 * @param {string} filterPkg
 * @param {string} label
 * @returns {Promise<{ proc: import('node:child_process').ChildProcess | null, started: boolean }>}
 */
async function ensureVite(url, filterPkg, label) {
  if (await urlReady(url)) {
    console.log(`[dev] reusing existing ${label} Vite at ${url}`);
    return { proc: null, started: false };
  }
  const proc = run(repoRoot, 'pnpm', ['--filter', filterPkg, 'dev:ui']);
  try {
    await waitUrl(url, 90_000);
  } catch (e) {
    killProcessTree(proc, label);
    throw e;
  }
  return { proc, started: true };
}

function ensureStaticUi() {
  const runnerUi = path.join(runnerRoot, 'dist-ui', 'index.html');
  if (!fs.existsSync(runnerUi)) {
    console.log('[dev] building runner dist-ui (once, no Vite)…');
    runSync(repoRoot, 'pnpm', ['--filter', '@pkg-runner/runner', 'build:ui']);
  }
  const editorUi = path.join(editorRoot, 'dist', 'renderer', 'index.html');
  if (!fs.existsSync(editorUi)) {
    console.log('[dev] building editor renderer (once, no Vite)…');
    runSync(repoRoot, 'pnpm', [
      '--filter',
      '@pkg-runner/code-editor',
      'build:renderer',
    ]);
  }
  const trayPanel = path.join(trayRoot, 'dist-ui', 'settings.html');
  if (!fs.existsSync(trayPanel)) {
    console.log('[dev] building tray-ui dist-ui (once, no Vite)…');
    runSync(repoRoot, 'pnpm', ['--filter', '@pkg-runner/tray-ui', 'build']);
  }
  const zonesUi = path.join(zonesRoot, 'dist', 'renderer', 'index.html');
  if (!fs.existsSync(zonesUi)) {
    console.log('[dev] building desktop-zones renderer (once, no Vite)…');
    runSync(repoRoot, 'pnpm', [
      '--filter',
      '@pkg-runner/desktop-zones',
      'build:renderer',
    ]);
  }
}

/** @type {{ proc: import('node:child_process').ChildProcess | null, started: boolean }} */
let runnerVite = { proc: null, started: false };
/** @type {{ proc: import('node:child_process').ChildProcess | null, started: boolean }} */
let editorVite = { proc: null, started: false };
/** @type {{ proc: import('node:child_process').ChildProcess | null, started: boolean }} */
let trayUiVite = { proc: null, started: false };
/** @type {{ proc: import('node:child_process').ChildProcess | null, started: boolean }} */
let zonesVite = { proc: null, started: false };

if (wantHmr) {
  console.log('[dev] HMR mode — starting Vite (may spike CPU)');
  runnerVite = await ensureVite(UI_URL, '@pkg-runner/web', 'runner');
  editorVite = await ensureVite(
    EDITOR_URL,
    '@pkg-runner/code-editor',
    'editor',
  );
  trayUiVite = await ensureVite(TRAY_UI_URL, '@pkg-runner/tray-ui', 'tray-ui');
  zonesVite = await ensureVite(
    ZONES_UI_URL,
    '@pkg-runner/desktop-zones',
    'zones',
  );
} else {
  console.log(
    '[dev] light mode — dist-ui, no Vite (use --hmr or PKG_RUNNER_UI_DEV=1 for HMR)',
  );
  ensureStaticUi();
}

const build = run(trayRoot, 'pnpm', ['run', 'build:dev']);
await new Promise((resolve, reject) => {
  build.on('exit', (code) =>
    code === 0
      ? resolve(undefined)
      : reject(new Error(`build:dev exit ${code}`)),
  );
});

// 开发默认 test；要正式色：PKG_RUNNER_COLOR_FORCE=1 PKG_RUNNER_COLOR_ENV=prod
const wantProdColor =
  process.env.PKG_RUNNER_COLOR_FORCE === '1' &&
  process.env.PKG_RUNNER_COLOR_ENV?.trim().toLowerCase() === 'prod';
const colorEnv = wantProdColor ? 'prod' : 'test';

const electronEnv = {
  ...process.env,
  PKG_RUNNER_APP_DIR: runnerRoot,
  PKG_EDITOR_APP_DIR: editorRoot,
  PKG_ZONES_APP_DIR: zonesRoot,
  PKG_RUNNER_COLOR_ENV: colorEnv,
  PKG_RUNNER_COLOR_FORCE: wantProdColor ? '1' : '0',
  // 默认不注入 Vite URL → loadMainWindow 走 dist-ui
  ...(wantHmr
    ? {
        PKG_RUNNER_UI_URL: UI_URL,
        CODE_EDITOR_DEV_URL: EDITOR_URL,
        PKG_TRAY_UI_URL: TRAY_UI_URL,
        PKG_ZONES_UI_URL: ZONES_UI_URL,
        PKG_RUNNER_UI_DEV: '1',
      }
    : {
        // 清掉外部环境里残留的 Vite 指向，避免误走 5200
        PKG_RUNNER_UI_URL: '',
        CODE_EDITOR_DEV_URL: '',
        PKG_TRAY_UI_URL: '',
        PKG_ZONES_UI_URL: '',
        VITE_DEV_SERVER_URL: '',
        PKG_RUNNER_UI_DEV: '0',
      }),
};
console.log(`[dev] color env: ${colorEnv}`);

const staleKilled = killStalePkgRunnerElectron();
if (staleKilled > 0) {
  console.log(
    `[dev] cleared ${staleKilled} stale pkg-runner electron process(es)`,
  );
  await new Promise((r) => setTimeout(r, 600));
}

const electronStartedAt = Date.now();
const electron = run(trayRoot, 'pnpm', ['exec', 'electron', '.'], electronEnv);

function stopVites() {
  if (runnerVite.started && runnerVite.proc) {
    killProcessTree(runnerVite.proc, 'runner-vite');
  }
  if (editorVite.started && editorVite.proc) {
    killProcessTree(editorVite.proc, 'editor-vite');
  }
  if (trayUiVite.started && trayUiVite.proc) {
    killProcessTree(trayUiVite.proc, 'tray-ui-vite');
  }
  if (zonesVite.started && zonesVite.proc) {
    killProcessTree(zonesVite.proc, 'zones-vite');
  }
}

const shutdown = () => {
  electron.kill();
  stopVites();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

electron.on('exit', (code) => {
  stopVites();
  const elapsed = Date.now() - electronStartedAt;
  if ((code === 0 || code === null) && elapsed < 4000) {
    console.error(
      '\n[dev] Electron 启动后立刻退出 — 通常是因为已有 pkg-runner 实例占着单实例锁。',
    );
    console.error(
      '[dev] 请关闭系统托盘里的旧图标，或在任务管理器结束 electron.exe',
    );
    console.error(
      '[dev] 清旧进程（可能顿一下）：PKG_RUNNER_DEV_KILL=1 pnpm --filter @pkg-runner/tray dev\n',
    );
  }
  process.exit(code ?? 0);
});
