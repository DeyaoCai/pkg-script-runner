/**
 * Dev: build tray main then launch Electron (no Vite UI).
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const trayRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(cwd, cmd, args, env = process.env) {
  return spawn(cmd, args, {
    cwd,
    env,
    stdio: 'inherit',
    shell: true,
  });
}

const build = run(trayRoot, 'pnpm', ['run', 'build:dev']);
await new Promise((resolve, reject) => {
  build.on('exit', (code) =>
    code === 0 ? resolve(undefined) : reject(new Error(`build:dev exit ${code}`)),
  );
});

const electron = run(trayRoot, 'pnpm', ['exec', 'electron', '.']);

const shutdown = () => {
  electron.kill();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

electron.on('exit', (code) => {
  process.exit(code ?? 0);
});
