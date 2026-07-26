import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { fileURLToPath } from 'node:url';

export type ChildKind = 'runner' | 'editor';

type ChildSlot = {
  proc: ChildProcess | null;
};

const slots: Record<ChildKind, ChildSlot> = {
  runner: { proc: null },
  editor: { proc: null },
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function repoRootFromTray(): string {
  // apps/tray/dist → apps/tray → apps → repo
  return path.resolve(__dirname, '..', '..', '..');
}

function packagedSiblingExe(kind: ChildKind): string | null {
  if (!app.isPackaged) return null;
  const name = kind === 'runner' ? 'PkgRunner.exe' : 'CodeEditor.exe';
  const resources = process.resourcesPath;
  const nested = path.join(resources, 'apps', name);
  if (fs.existsSync(nested)) return nested;
  const beside = path.join(path.dirname(process.execPath), name);
  if (fs.existsSync(beside)) return beside;
  return null;
}

function resolveAppDir(kind: ChildKind): string {
  const envKey = kind === 'runner' ? 'PKG_RUNNER_APP_DIR' : 'PKG_EDITOR_APP_DIR';
  const fromEnv = process.env[envKey]?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const folder = kind === 'runner' ? 'runner' : 'code-editor';
  return path.join(repoRootFromTray(), 'apps', folder);
}

function electronBin(): string {
  const fromEnv = process.env.ELECTRON_BINARY?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  // Prefer the Electron binary that launched this process
  return process.execPath;
}

function isAlive(proc: ChildProcess | null): boolean {
  return !!proc && proc.exitCode === null && !proc.killed;
}

/**
 * Launch or nudge a sub-app. Second spawn hits the child's single-instance lock
 * and focuses its window.
 */
export function launchChild(kind: ChildKind, extraArgs: string[] = []): void {
  const packaged = packagedSiblingExe(kind);
  if (packaged) {
    spawn(packaged, extraArgs, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    }).unref();
    return;
  }

  const appDir = resolveAppDir(kind);
  const mainJs =
    kind === 'runner'
      ? path.join(appDir, 'dist', 'main.js')
      : path.join(appDir, 'dist', 'main', 'main.js');
  if (!fs.existsSync(mainJs) && !fs.existsSync(path.join(appDir, 'package.json'))) {
    console.warn(`[tray] ${kind} app not found at ${appDir}`);
    return;
  }

  const electron = electronBin();
  const args = ['.', ...extraArgs];
  const env = { ...process.env };
  if (kind === 'runner' && process.env.PKG_RUNNER_UI_URL) {
    env.PKG_RUNNER_UI_URL = process.env.PKG_RUNNER_UI_URL;
  }
  if (kind === 'editor' && process.env.CODE_EDITOR_DEV_URL) {
    env.CODE_EDITOR_DEV_URL = process.env.CODE_EDITOR_DEV_URL;
  }

  const child = spawn(electron, args, {
    cwd: appDir,
    env,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
  slots[kind].proc = child;
  child.on('exit', () => {
    if (slots[kind].proc === child) slots[kind].proc = null;
  });
}

export function killChildren(): void {
  for (const kind of ['runner', 'editor'] as const) {
    const proc = slots[kind].proc;
    if (isAlive(proc)) {
      try {
        proc!.kill();
      } catch {
        /* ignore */
      }
    }
    slots[kind].proc = null;
  }
}
