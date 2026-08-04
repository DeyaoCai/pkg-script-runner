/**
 * Dev: Vite (:5203) + Electron，渲染层 HMR。
 * Windows: shell:true（避免 spawn *.cmd → EINVAL）。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV_URL = process.env.PKG_ZONES_UI_URL?.trim() || 'http://127.0.0.1:5203';

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

function run(cwd, cmd, args, env = process.env) {
  return spawn(cmd, args, {
    cwd,
    env,
    stdio: 'inherit',
    shell: true,
  });
}

const vite = run(root, 'pnpm', ['run', 'dev:ui']);

let electronProc = null;
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    electronProc?.kill();
  } catch {
    /* ignore */
  }
  try {
    vite.kill();
  } catch {
    /* ignore */
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

vite.on('exit', (code) => {
  if (!shuttingDown) shutdown(code ?? 1);
});

try {
  await waitUrl(DEV_URL, 90_000);
} catch (e) {
  console.error(e);
  shutdown(1);
}

electronProc = run(root, 'pnpm', ['exec', 'electron', '.'], {
  ...process.env,
  PKG_ZONES_UI_URL: DEV_URL,
});

electronProc.on('exit', (code) => shutdown(code ?? 0));
