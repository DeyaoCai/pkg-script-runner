import fs from 'node:fs';
import path from 'node:path';

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

export type ProjectScripts = {
  dir: string;
  name: string;
  packageManager: PackageManager;
  scripts: Array<{ name: string; command: string }>;
};

function exists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

export function detectPackageManager(dir: string, pkg: Record<string, unknown>): PackageManager {
  const field = pkg.packageManager;
  if (typeof field === 'string') {
    const id = field.split('@')[0]?.toLowerCase();
    if (id === 'pnpm' || id === 'npm' || id === 'yarn' || id === 'bun') return id;
  }
  if (exists(path.join(dir, 'pnpm-lock.yaml')) || exists(path.join(dir, 'pnpm-workspace.yaml'))) {
    return 'pnpm';
  }
  if (exists(path.join(dir, 'yarn.lock'))) return 'yarn';
  if (exists(path.join(dir, 'bun.lockb')) || exists(path.join(dir, 'bun.lock'))) return 'bun';
  if (exists(path.join(dir, 'package-lock.json'))) return 'npm';
  return 'npm';
}

export function pmRunArgs(pm: PackageManager, scriptName: string): {
  cmd: string;
  args: string[];
  /** Windows 下 .cmd/.bat 必须经 shell，否则 Node 会 spawn EINVAL */
  shell: boolean;
} {
  const shell = process.platform === 'win32';
  // shell:true 时用裸命令名，交给 cmd 解析 PATH（避免直接 spawn *.cmd）
  switch (pm) {
    case 'pnpm':
      return { cmd: 'pnpm', args: ['run', scriptName], shell };
    case 'yarn':
      return { cmd: 'yarn', args: ['run', scriptName], shell };
    case 'bun':
      return { cmd: 'bun', args: ['run', scriptName], shell };
    default:
      return { cmd: 'npm', args: ['run', scriptName], shell };
  }
}

export function loadProjectScripts(dir: string): ProjectScripts {
  const root = path.resolve(dir);
  const pkgPath = path.join(root, 'package.json');
  if (!exists(pkgPath)) {
    throw new Error(`未找到 package.json：${pkgPath}`);
  }
  const raw = fs.readFileSync(pkgPath, 'utf8');
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`package.json 不是合法 JSON：${pkgPath}`);
  }

  const scriptsObj =
    pkg.scripts && typeof pkg.scripts === 'object' && !Array.isArray(pkg.scripts)
      ? (pkg.scripts as Record<string, unknown>)
      : {};

  const scripts = Object.entries(scriptsObj)
    .filter(([, v]) => typeof v === 'string' && v.trim().length > 0)
    .map(([name, command]) => ({ name, command: String(command) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    dir: root,
    name: typeof pkg.name === 'string' && pkg.name ? pkg.name : path.basename(root),
    packageManager: detectPackageManager(root, pkg),
    scripts,
  };
}
