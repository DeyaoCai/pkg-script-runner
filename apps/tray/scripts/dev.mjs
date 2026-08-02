/**
 * Dev: Runner Vite (:5200) + Editor Vite (:5201) + unified tray Electron.
 * Both UIs load via loadURL (HMR); packaged still uses loadFile(dist).
 */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const trayRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.join(trayRoot, '..', '..');
const runnerRoot = path.join(repoRoot, 'apps', 'runner');
const UI_URL = process.env.PKG_RUNNER_UI_URL?.trim() || 'http://127.0.0.1:5200';
const EDITOR_URL =
  process.env.CODE_EDITOR_DEV_URL?.trim() || 'http://127.0.0.1:5201';

function killStalePkgRunnerElectron() {
  if (process.env.PKG_RUNNER_DEV_NO_KILL === '1') return 0;
  const repoMarker = path.normalize(repoRoot).toLowerCase();
  const editorMarker = path
    .normalize(path.join(repoRoot, 'apps', 'code-editor'))
    .toLowerCase();
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
      // 不杀安装版（userData=pkg-runner 且无仓库路径）
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

const runnerVite = await ensureVite(UI_URL, '@pkg-runner/web', 'runner');
const editorVite = await ensureVite(
  EDITOR_URL,
  '@pkg-runner/code-editor',
  'editor',
);

const build = run(trayRoot, 'pnpm', ['run', 'build:dev']);
await new Promise((resolve, reject) => {
  build.on('exit', (code) =>
    code === 0
      ? resolve(undefined)
      : reject(new Error(`build:dev exit ${code}`)),
  );
});

const electronEnv = {
  ...process.env,
  PKG_RUNNER_APP_DIR: runnerRoot,
  PKG_RUNNER_UI_URL: UI_URL,
  PKG_EDITOR_APP_DIR: path.join(repoRoot, 'apps', 'code-editor'),
  CODE_EDITOR_DEV_URL: EDITOR_URL,
};

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
      '[dev] 也可设置 PKG_RUNNER_DEV_NO_KILL=1 跳过自动清理后手动排查\n',
    );
  }
  process.exit(code ?? 0);
});
