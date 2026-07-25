/**
 * Drive the minimal TUI through node-pty and assert TTY + interaction.
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pty = require('node-pty');
const target = path.join(root, 'scripts', 'tui-smoke-target.mjs');

const term = pty.spawn(process.execPath, [target], {
  name: 'xterm-256color',
  cols: 80,
  rows: 24,
  cwd: root,
  env: {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  },
});

let buf = '';
term.onData((d) => {
  buf += d;
});

const deadline = Date.now() + 8000;
while (!buf.includes('TUI_READY') && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 50));
}

if (!buf.includes('TUI_READY')) {
  console.error('FAIL: TUI never became ready');
  console.error(buf.slice(0, 500));
  try {
    term.kill();
  } catch {
    /* ignore */
  }
  process.exit(1);
}

if (!buf.includes('1049') && !buf.includes('PTY TUI OK')) {
  // alternate screen CSI may be binary-ish; frame text is enough
  console.error('FAIL: missing TUI frame');
  console.error(JSON.stringify(buf.slice(0, 300)));
  try {
    term.kill();
  } catch {
    /* ignore */
  }
  process.exit(1);
}

term.write('x');
await new Promise((r) => setTimeout(r, 200));
term.write('q');

const exitDeadline = Date.now() + 5000;
while (!buf.includes('TUI_EXIT_OK') && Date.now() < exitDeadline) {
  await new Promise((r) => setTimeout(r, 50));
}

try {
  term.kill();
} catch {
  /* ignore */
}

if (!buf.includes('TUI_EXIT_OK')) {
  console.error('FAIL: quit key not handled');
  console.error(buf.slice(-400));
  process.exit(1);
}

if (!buf.includes('key:x')) {
  console.error('FAIL: key input not received by TUI');
  console.error(buf.slice(-400));
  process.exit(1);
}

console.log('ok  PTY hosts interactive TUI (isatty + raw mode + keys)');
console.log('ok  alternate-screen / frame rendered');
console.log('all tui checks passed');
process.exit(0);
