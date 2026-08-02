/**
 * Env-aware window / tray icons — media lives in `@pkg-runner/assets`.
 * prod → icon.png · tray.png；test → icon-test.png · tray-test.png
 */
import {
  resolveEnvAssetPath as resolveBrandAsset,
  type BrandAssetKind,
} from '@pkg-runner/assets';
import { pkgRunnerColorEnv } from './appProfile.js';

/** @param _appRoot unused; kept so call sites stay stable during migration */
export function resolveEnvAssetPath(
  _appRoot: string,
  kind: BrandAssetKind,
): string {
  return resolveBrandAsset(kind, pkgRunnerColorEnv());
}
