/**
 * Tail pkg-runner diagnostic log (JSONL).
 * Usage: node scripts/diag-tail.mjs [lines]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const n = Math.max(1, Number(process.argv[2]) || 40);
const file = path.join(os.homedir(), 'AppData', 'Roaming', 'pkg-runner', 'diag.log');

if (!fs.existsSync(file)) {
  console.log(`(empty) ${file}`);
  process.exit(0);
}

const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-n);
for (const line of lines) {
  try {
    const j = JSON.parse(line);
    const detail = j.d !== undefined ? ` ${JSON.stringify(j.d)}` : '';
    console.log(`${j.t} [${j.src}] ${j.evt}${detail}`);
  } catch {
    console.log(line);
  }
}
