/**
 * Smoke-check PTY + Vue shell wiring for pkg-runner interactive shell.
 * Does not launch the full Electron window.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const webSrc = path.join(root, '..', 'web', 'src');
const require = createRequire(import.meta.url);
let failed = 0;

function ok(msg) {
  console.log('ok ', msg);
}
function bad(msg) {
  console.error('FAIL', msg);
  failed += 1;
}

const termCtrl = path.join(webSrc, 'components', 'TerminalView', 'TerminalViewCtrl.ts');
const termVue = path.join(webSrc, 'components', 'TerminalView', 'TerminalView.vue');
const preload = path.join(root, 'src', 'preload.ts');

if (fs.existsSync(termCtrl)) {
  const src = fs.readFileSync(termCtrl, 'utf8');
  for (const needle of ['shellWrite', 'pkg:shell-data', '@xterm/xterm', 'FitAddon']) {
    if (src.includes(needle)) ok(`TerminalViewCtrl has ${needle}`);
    else bad(`TerminalViewCtrl missing ${needle}`);
  }
} else {
  bad(`missing ${termCtrl}`);
}

if (fs.existsSync(termVue)) {
  const src = fs.readFileSync(termVue, 'utf8');
  if (src.includes('xterm-host')) ok('TerminalView.vue has xterm-host');
  else bad('TerminalView.vue missing xterm-host');
} else {
  bad(`missing ${termVue}`);
}

if (fs.existsSync(preload)) {
  const src = fs.readFileSync(preload, 'utf8');
  for (const needle of [
    'shellWrite',
    'onShellData',
    'pkg:shell-write',
    'pkg:shell-data',
    'pkg:shell-resize',
  ]) {
    if (src.includes(needle)) ok(`preload has ${needle}`);
    else bad(`preload missing ${needle}`);
  }
} else {
  bad(`missing ${preload}`);
}

const mainJs = path.join(root, 'dist', 'main.js');
if (fs.existsSync(mainJs)) {
  const src = fs.readFileSync(mainJs, 'utf8');
  for (const needle of ['node-pty', 'pkg:shell-write', 'pkg:shell-data', 'pkg:shell-resize']) {
    if (src.includes(needle)) ok(`dist/main has ${needle}`);
    else bad(`dist/main missing ${needle}`);
  }
} else {
  bad('missing dist/main.js (run pnpm --filter @pkg-runner/runner build:main)');
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
