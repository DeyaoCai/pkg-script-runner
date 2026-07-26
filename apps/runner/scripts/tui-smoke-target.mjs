/**
 * Minimal TUI smoke target for PTY verification.
 * Requires a real TTY (isatty). Draws a frame, waits for 'q'.
 */
import readline from 'node:readline';

if (!process.stdout.isTTY || !process.stdin.isTTY) {
  console.error('NOT_A_TTY');
  process.exit(2);
}

const ESC = '\x1b';
process.stdout.write(`${ESC}[?1049h${ESC}[2J${ESC}[H`);
process.stdout.write(`${ESC}[36m┌─ PTY TUI OK ─────────────────┐${ESC}[0m\r\n`);
process.stdout.write(`${ESC}[36m│${ESC}[0m  isatty=true  raw keys      ${ESC}[36m│${ESC}[0m\r\n`);
process.stdout.write(`${ESC}[36m│${ESC}[0m  press q to quit            ${ESC}[36m│${ESC}[0m\r\n`);
process.stdout.write(`${ESC}[36m└──────────────────────────────┘${ESC}[0m\r\n`);
process.stdout.write('TUI_READY\r\n');

readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
process.stdin.resume();

process.stdin.on('keypress', (_str, key) => {
  if (!key) return;
  if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
    process.stdout.write(`${ESC}[?1049l`);
    process.stdout.write('TUI_EXIT_OK\n');
    process.exit(0);
  }
  process.stdout.write(`key:${key.name || key.sequence}\r\n`);
});
