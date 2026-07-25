/**
 * Smoke-check PTY + UI assets for pkg-runner interactive shell.
 * Does not launch the full Electron window.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let failed = 0;

function ok(msg) {
  console.log('ok ', msg);
}
function bad(msg) {
  console.error('FAIL', msg);
  failed += 1;
}

for (const f of ['xterm.js', 'xterm.css', 'addon-fit.js']) {
  const p = path.join(root, 'ui', 'vendor', f);
  if (fs.existsSync(p) && fs.statSync(p).size > 100) ok(`vendor/${f}`);
  else bad(`missing vendor/${f}`);
}

const appJs = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');
for (const needle of ['attachShellTerm', 'onShellData', 'xterm-host', 'shellWrite', 'focusShellTerm']) {
  if (appJs.includes(needle)) ok(`app.js has ${needle}`);
  else bad(`app.js missing ${needle}`);
}

const mainJs = fs.readFileSync(path.join(root, 'dist', 'main.js'), 'utf8');
for (const needle of ['node-pty', 'pkg:shell-write', 'pkg:shell-data', 'pkg:shell-resize']) {
  if (mainJs.includes(needle)) ok(`dist/main has ${needle}`);
  else bad(`dist/main missing ${needle}`);
}

try {
  const pty = require('node-pty');
  const file = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
  const args = process.platform === 'win32' ? ['-NoLogo'] : [];
  const term = pty.spawn(file, args, {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: root,
  });
  let got = '';
  term.onData((d) => {
    got += d;
  });
  await new Promise((r) => setTimeout(r, 500));
  term.write('echo PTY_SMOKE_OK\r');
  await new Promise((r) => setTimeout(r, 800));
  try {
    term.kill();
  } catch {
    /* ignore */
  }
  if (got.includes('PTY_SMOKE_OK') || /PS |\$ /.test(got)) ok('node-pty spawn/write');
  else bad(`node-pty no output: ${JSON.stringify(got.slice(0, 120))}`);
} catch (err) {
  bad(`node-pty: ${err instanceof Error ? err.message : String(err)}`);
}

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
process.exit(0);
