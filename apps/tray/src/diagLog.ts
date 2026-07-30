/**
 * Shared diagnostic log — all processes append to %APPDATA%/pkg-runner/diag.log
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

const MAX_BYTES = 512 * 1024;

export function diagLogPath(): string {
  return path.join(app.getPath('appData'), 'pkg-runner', 'diag.log');
}

function trimDiagLog(file: string): void {
  try {
    const st = fs.statSync(file);
    if (st.size <= MAX_BYTES) return;
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    fs.writeFileSync(file, lines.slice(-1500).join('\n') + '\n', 'utf8');
  } catch {
    /* ignore */
  }
}

export function diagLog(source: string, event: string, detail?: unknown): void {
  const payload: Record<string, unknown> = {
    t: new Date().toISOString(),
    src: source,
    evt: event,
  };
  if (detail !== undefined) payload.d = detail;
  const line = JSON.stringify(payload);
  console.log(`[diag:${source}] ${event}`, detail ?? '');
  try {
    const file = diagLogPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, line + '\n', 'utf8');
    trimDiagLog(file);
  } catch {
    /* ignore */
  }
}

export function readDiagTail(maxLines = 100): string {
  try {
    return fs
      .readFileSync(diagLogPath(), 'utf8')
      .split('\n')
      .filter(Boolean)
      .slice(-maxLines)
      .join('\n');
  } catch {
    return '';
  }
}
