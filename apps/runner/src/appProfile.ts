/**
 * Prod vs unpackaged (dev) use different %APPDATA% profiles so both can run.
 * Override with PKG_RUNNER_PROFILE (e.g. pkg-runner-dev-2).
 */
import path from 'node:path';
import { app } from 'electron';

export function pkgRunnerProfileName(): string {
  const env = process.env.PKG_RUNNER_PROFILE?.trim();
  if (env) {
    const safe = env.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
    return safe || 'pkg-runner';
  }
  return app.isPackaged ? 'pkg-runner' : 'pkg-runner-dev';
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
  return root;
}
