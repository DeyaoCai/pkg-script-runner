import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import pty, { type IPty } from 'node-pty';

export type TTermSessionInfo = {
  id: string;
  cwd: string;
  title: string;
};

type TSession = {
  id: string;
  cwd: string;
  title: string;
  pty: IPty | null;
};

function defaultShell(): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    return { file: 'powershell.exe', args: ['-NoLogo'] };
  }
  return { file: process.env.SHELL || '/bin/bash', args: [] };
}

function killPty(term: IPty): void {
  const pid = term.pid;
  try {
    term.kill();
  } catch {
    /* ignore */
  }
  if (pid && process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 8000,
      });
    } catch {
      /* ignore */
    }
  }
}

/** Multi-session interactive shells for the code-editor bottom panel. */
export class TermBridge {
  private sessions = new Map<string, TSession>();
  private getWindow: () => BrowserWindow | null;

  constructor(getWindow: () => BrowserWindow | null) {
    this.getWindow = getWindow;
  }

  private send(channel: string, payload: unknown): void {
    const win = this.getWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send(channel, payload);
  }

  list(): TTermSessionInfo[] {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      cwd: s.cwd,
      title: s.title,
    }));
  }

  start(
    cwd: string,
    size?: { cols?: number; rows?: number },
  ): TTermSessionInfo {
    const abs = path.resolve(cwd);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
      throw new Error(`目录无效: ${cwd}`);
    }

    const cols = Math.max(20, Math.min(500, Math.round(size?.cols ?? 80)));
    const rows = Math.max(5, Math.min(200, Math.round(size?.rows ?? 24)));
    const { file, args } = defaultShell();
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === 'string') env[k] = v;
    }
    env.TERM = 'xterm-256color';
    env.COLORTERM = 'truecolor';
    if (process.platform === 'win32') {
      env.PYTHONIOENCODING = env.PYTHONIOENCODING || 'utf-8';
    }

    let term: IPty;
    try {
      term = pty.spawn(file, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: abs,
        env,
      });
    } catch (err) {
      throw new Error(
        `无法启动终端: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const n = this.sessions.size + 1;
    const base = path.basename(abs) || 'Shell';
    const title = n === 1 ? base : `${base} ${n}`;
    const id = `term::${randomUUID()}`;
    const session: TSession = { id, cwd: abs, title, pty: term };
    this.sessions.set(id, session);

    term.onData((data) => {
      this.send('term:data', { id, data });
    });
    term.onExit(({ exitCode }) => {
      const s = this.sessions.get(id);
      if (s?.pty === term) s.pty = null;
      this.send('term:data', {
        id,
        data: `\r\n[终端已退出 ${exitCode ?? '?'}]\r\n`,
      });
      this.send('term:exit', { id, code: exitCode ?? null });
    });

    return { id, cwd: abs, title };
  }

  write(id: string, data: string): boolean {
    const s = this.sessions.get(id);
    if (!s?.pty) return false;
    s.pty.write(String(data ?? ''));
    return true;
  }

  resize(id: string, cols: number, rows: number): boolean {
    const s = this.sessions.get(id);
    if (!s?.pty) return false;
    const c = Math.max(20, Math.min(500, Math.round(cols)));
    const r = Math.max(5, Math.min(200, Math.round(rows)));
    try {
      s.pty.resize(c, r);
      return true;
    } catch {
      return false;
    }
  }

  kill(id: string): boolean {
    const s = this.sessions.get(id);
    if (!s) return false;
    if (s.pty) killPty(s.pty);
    this.sessions.delete(id);
    return true;
  }

  disposeAll(): void {
    for (const s of this.sessions.values()) {
      if (s.pty) killPty(s.pty);
    }
    this.sessions.clear();
  }
}
