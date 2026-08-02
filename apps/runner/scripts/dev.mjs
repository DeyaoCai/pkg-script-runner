/**
 * Dev: start @pkg-runner/web Vite (:5200) then Electron with PKG_RUNNER_UI_URL.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const runnerRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.join(runnerRoot, '..', '..');
const UI_URL = process.env.PKG_RUNNER_UI_URL?.trim() || 'http://127.0.0.1:5200';

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

const vite = run(repoRoot, 'pnpm', ['--filter', '@pkg-runner/web', 'dev']);

try {
  await waitUrl(UI_URL, 90_000);
} catch (e) {
  vite.kill();
  console.error(e);
  process.exit(1);
}

const build = run(runnerRoot, 'pnpm', ['run', 'build:dev']);
await new Promise((resolve, reject) => {
  build.on('exit', (code) =>
    code === 0 ? resolve(undefined) : reject(new Error(`build:dev exit ${code}`)),
  );
});

const electronEnv = {
  ...process.env,
  PKG_RUNNER_UI_URL: UI_URL,
};
const electron = run(runnerRoot, 'pnpm', ['exec', 'electron', '.'], electronEnv);

const shutdown = () => {
  electron.kill();
  vite.kill();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

electron.on('exit', (code) => {
  vite.kill();
  process.exit(code ?? 0);
});
