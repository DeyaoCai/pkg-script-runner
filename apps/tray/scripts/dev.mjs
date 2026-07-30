/**
 * Dev: Vite UI (:5175) + unified tray+runner Electron (single main process).
 */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const trayRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.join(trayRoot, '..', '..');
const runnerRoot = path.join(repoRoot, 'apps', 'runner');
const UI_URL = process.env.PKG_RUNNER_UI_URL?.trim() || 'http://127.0.0.1:5175';

function killStalePkgRunnerElectron() {
  if (process.env.PKG_RUNNER_DEV_NO_KILL === '1') return 0;
  const repoMarker = path.normalize(repoRoot).toLowerCase();
  const editorMarker = path.normalize(path.join(repoRoot, 'apps', 'code-editor')).toLowerCase();
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
        cmd.includes(repoMarker) ||
        (cmd.includes('user-data-dir=') && cmd.includes('pkg-runner')) ||
        (cmd.includes('app-path=') && cmd.includes('pkg-script-runner'));
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
      const ps = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
      const cmd = (ps.stdout || '').toLowerCase();
      if (!cmd.includes('pkg-runner') && !cmd.includes('pkg-script-runner')) continue;
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
  return waitUrl(url, 1500).then(() => true, () => false);
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

/** Reuse orphaned Vite from a prior dev:tray instead of failing on :5175. */
let vite = null;
let startedVite = false;
const alreadyUp = await urlReady(UI_URL);
if (alreadyUp) {
  console.log(`[dev] reusing existing Vite at ${UI_URL}`);
} else {
  vite = run(repoRoot, 'pnpm', ['--filter', '@pkg-runner/web', 'dev']);
  startedVite = true;
  try {
    await waitUrl(UI_URL, 90_000);
  } catch (e) {
    killProcessTree(vite, 'vite');
    console.error(e);
    process.exit(1);
  }
}

const build = run(trayRoot, 'pnpm', ['run', 'build:dev']);
await new Promise((resolve, reject) => {
  build.on('exit', (code) =>
    code === 0 ? resolve(undefined) : reject(new Error(`build:dev exit ${code}`)),
  );
});

const editorBuild = run(repoRoot, 'pnpm', [
  '--filter',
  '@pkg-runner/code-editor',
  'run',
  'build',
]);
await new Promise((resolve, reject) => {
  editorBuild.on('exit', (code) =>
    code === 0 ? resolve(undefined) : reject(new Error(`code-editor build exit ${code}`)),
  );
});

const electronEnv = {
  ...process.env,
  PKG_RUNNER_APP_DIR: runnerRoot,
  PKG_RUNNER_UI_URL: UI_URL,
  PKG_EDITOR_APP_DIR: path.join(repoRoot, 'apps', 'code-editor'),
};

const staleKilled = killStalePkgRunnerElectron();
if (staleKilled > 0) {
  console.log(`[dev] cleared ${staleKilled} stale pkg-runner electron process(es)`);
  await new Promise((r) => setTimeout(r, 600));
}

const electronStartedAt = Date.now();
const electron = run(trayRoot, 'pnpm', ['exec', 'electron', '.'], electronEnv);

const shutdown = () => {
  electron.kill();
  if (startedVite && vite) killProcessTree(vite, 'vite');
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

electron.on('exit', (code) => {
  if (startedVite && vite) killProcessTree(vite, 'vite');
  const elapsed = Date.now() - electronStartedAt;
  if ((code === 0 || code === null) && elapsed < 4000) {
    console.error(
      '\n[dev] Electron 启动后立刻退出 — 通常是因为已有 pkg-runner 实例占着单实例锁。',
    );
    console.error('[dev] 请关闭系统托盘里的旧图标，或在任务管理器结束 electron.exe');
    console.error('[dev] 也可设置 PKG_RUNNER_DEV_NO_KILL=1 跳过自动清理后手动排查\n');
  }
  process.exit(code ?? 0);
});
