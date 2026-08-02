/**
 * Canonical brand media under packages/assets/media.
 * Electron apps resolve paths at runtime from this package (packed via node_modules).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type BrandAssetKind = 'icon' | 'tray';
export type BrandColorEnv = 'prod' | 'test';

/** Absolute path to packages/assets/media */
export function brandAssetsDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'media');
}

export function brandAssetPath(fileName: string): string {
  return path.join(brandAssetsDir(), fileName);
}

/** prod → kind.png；test → kind-test.png（缺失则回退 prod） */
export function resolveEnvAssetPath(
  kind: BrandAssetKind,
  colorEnv: BrandColorEnv = 'prod',
): string {
  const env = colorEnv === 'test' ? 'test' : 'prod';
  const testPath = brandAssetPath(`${kind}-test.png`);
  const prodPath = brandAssetPath(`${kind}.png`);
  if (env === 'test' && fs.existsSync(testPath)) return testPath;
  return prodPath;
}

export function logoPath(): string {
  return brandAssetPath('logo.png');
}
