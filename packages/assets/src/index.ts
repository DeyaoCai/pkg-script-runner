/**
 * Canonical brand media under packages/assets/media.
 * Resolve via package.json so paths stay valid when this module is esbuild-bundled
 * into tray/runner main (import.meta.url would otherwise point at dist/main.js).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export type BrandAssetKind = 'icon' | 'tray';
export type BrandColorEnv = 'prod' | 'test';

const require = createRequire(import.meta.url);

/** Absolute path to packages/assets/media */
export function brandAssetsDir(): string {
  try {
    const pkgJson = require.resolve('@pkg-runner/assets/package.json');
    return path.join(path.dirname(pkgJson), 'media');
  } catch {
    // Dev / direct load of package source or dist
    return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'media');
  }
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
