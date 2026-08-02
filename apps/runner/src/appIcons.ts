/**
 * Env-aware window / tray icons.
 * prod → icon.png · tray.png；test → icon-test.png · tray-test.png
 */
import fs from 'node:fs';
import path from 'node:path';
import { pkgRunnerColorEnv } from './appProfile.js';

export function resolveEnvAssetPath(
  appRoot: string,
  kind: 'icon' | 'tray',
): string {
  const env = pkgRunnerColorEnv();
  const test = path.join(appRoot, 'assets', `${kind}-test.png`);
  const prod = path.join(appRoot, 'assets', `${kind}.png`);
  if (env === 'test' && fs.existsSync(test)) return test;
  return prod;
}
