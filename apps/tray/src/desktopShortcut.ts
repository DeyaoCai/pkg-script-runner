/**
 * Desktop / Start Menu shortcuts for packaged launches.
 * NSIS 安装包也会创建；这里作为首次启动兜底（防提权写错桌面 / 用户误删）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, shell } from 'electron';
import { diagLog } from './diagLog.js';

const SHORTCUT_NAME = 'Pkg Runner.lnk';

export type ShortcutResult = {
  ok: boolean;
  desktop?: string;
  startMenu?: string;
  paths?: string[];
  target?: string;
  error?: string;
};

/** Installed / unpacked exe（不要指 portable 解压壳）。 */
export function resolveLaunchTarget(): { target: string; cwd: string } {
  const portableFile = process.env.PORTABLE_EXECUTABLE_FILE?.trim();
  if (portableFile && fs.existsSync(portableFile)) {
    const portableDir = path.dirname(path.resolve(portableFile));
    const fastCandidates = [
      path.join(portableDir, 'win-unpacked', 'PkgRunnerTray.exe'),
      path.join(portableDir, 'PkgRunnerTray.exe'),
    ];
    for (const c of fastCandidates) {
      if (fs.existsSync(c) && path.resolve(c) !== path.resolve(portableFile)) {
        return { target: path.resolve(c), cwd: path.dirname(path.resolve(c)) };
      }
    }
    return { target: path.resolve(portableFile), cwd: portableDir };
  }

  const target = path.resolve(process.execPath);
  return { target, cwd: path.dirname(target) };
}

export function desktopShortcutPath(): string {
  return path.join(app.getPath('desktop'), SHORTCUT_NAME);
}

export function startMenuShortcutPath(): string {
  return path.join(
    app.getPath('appData'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    SHORTCUT_NAME,
  );
}

function candidateDesktopDirs(): string[] {
  const dirs = new Set<string>();
  try {
    dirs.add(app.getPath('desktop'));
  } catch {
    /* ignore */
  }
  const home = process.env.USERPROFILE || app.getPath('home');
  dirs.add(path.join(home, 'Desktop'));
  dirs.add(path.join(home, 'OneDrive', 'Desktop'));
  dirs.add(path.join(home, 'OneDrive', '桌面'));
  // 部分中文系统
  dirs.add(path.join(home, '桌面'));
  return [...dirs].filter((d) => {
    try {
      return fs.existsSync(d);
    } catch {
      return false;
    }
  });
}

function writeOne(linkPath: string, target: string, cwd: string): void {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  const op = fs.existsSync(linkPath) ? 'replace' : 'create';
  const ok = shell.writeShortcutLink(linkPath, op, {
    target,
    cwd,
    description: 'Pkg Runner — 托盘 / 截屏 / Runner / 编辑器',
    icon: target,
    iconIndex: 0,
    appUserModelId: 'local.pkg-runner.tray',
  });
  if (!ok) {
    throw new Error(`writeShortcutLink failed: ${linkPath}`);
  }
}

/** Create/update Desktop + Start Menu shortcuts（多桌面路径兜底）。 */
export function installAppShortcuts(): ShortcutResult {
  if (process.platform !== 'win32') {
    return { ok: false, error: '仅 Windows 支持 .lnk 快捷方式' };
  }
  try {
    const { target, cwd } = resolveLaunchTarget();
    if (!fs.existsSync(target)) {
      return { ok: false, error: `启动目标不存在: ${target}` };
    }

    const written: string[] = [];
    for (const dir of candidateDesktopDirs()) {
      const link = path.join(dir, SHORTCUT_NAME);
      try {
        writeOne(link, target, cwd);
        written.push(link);
      } catch (err) {
        diagLog('tray:shortcut', 'desktop.write-fail', {
          link,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const startMenu = startMenuShortcutPath();
    writeOne(startMenu, target, cwd);
    written.push(startMenu);

    if (written.length === 0) {
      return { ok: false, error: '未能写入任何快捷方式', target };
    }

    const desktop = written.find((p) => p.endsWith(SHORTCUT_NAME) && p.includes('Desktop'))
      || written[0];
    diagLog('tray:shortcut', 'install.ok', { paths: written, target });
    return { ok: true, desktop, startMenu, paths: written, target };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    diagLog('tray:shortcut', 'install.fail', { error });
    return { ok: false, error };
  }
}

/**
 * 打包版每次启动都确保快捷方式存在并指向当前 exe。
 * （修复：安装提权写到管理员桌面、用户误删、改路径后失效）
 */
export function ensureAppShortcutsOnPackagedLaunch(): ShortcutResult | null {
  if (!app.isPackaged) return null;
  if (process.platform !== 'win32') return null;
  return installAppShortcuts();
}
