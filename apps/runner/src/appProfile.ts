/**
 * Prod vs unpackaged (dev) use different %APPDATA% profiles so both can run.
 * Override with PKG_RUNNER_PROFILE (e.g. pkg-runner-dev-2).
 *
 * Color token set: prod (正式) / test (测试).
 * 开发/unpackaged 默认 test；要本地看正式色需同时设：
 *   PKG_RUNNER_COLOR_ENV=prod  PKG_RUNNER_COLOR_FORCE=1
 */
import path from 'node:path';
import { app } from 'electron';

export type PkgRunnerColorEnv = 'prod' | 'test';

export function pkgRunnerProfileName(): string {
  const env = process.env.PKG_RUNNER_PROFILE?.trim();
  if (env) {
    const safe = env.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
    return safe || 'pkg-runner';
  }
  return app.isPackaged ? 'pkg-runner' : 'pkg-runner-dev';
}

function isDevLike(): boolean {
  if (!app.isPackaged) return true;
  const profile = pkgRunnerProfileName().toLowerCase();
  return profile.includes('dev') || profile.includes('test');
}

/**
 * 安装包 → prod；开发/unpackaged → test（忽略环境里残留的 COLOR_ENV=prod）。
 */
export function pkgRunnerColorEnv(): PkgRunnerColorEnv {
  const forced = process.env.PKG_RUNNER_COLOR_ENV?.trim().toLowerCase();
  const forceOk = process.env.PKG_RUNNER_COLOR_FORCE === '1';

  if (isDevLike()) {
    if (forceOk && forced === 'prod') return 'prod';
    return 'test';
  }
  if (forced === 'test' || forced === 'prod') return forced;
  return 'prod';
}

export function pkgRunnerProfileRoot(): string {
  return path.join(app.getPath('appData'), pkgRunnerProfileName());
}

/** Call before requestSingleInstanceLock(). Returns the userData path. */
export function applyPkgRunnerUserData(): string {
  const root = pkgRunnerProfileRoot();
  try {
    app.setPath('userData', root);
  } catch {
    /* ignore */
  }
  const color = pkgRunnerColorEnv();
  process.env.PKG_RUNNER_COLOR_ENV = color;
  process.env.PKG_RUNNER_USER_DATA = root;
  return root;
}
