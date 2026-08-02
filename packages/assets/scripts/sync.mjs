/**
 * Sync logo into runner vanilla UI (file://). Vite apps import from the package.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const logoSrc = path.join(pkgRoot, 'media', 'logo.png');
const targets = [
  path.join(pkgRoot, '..', '..', 'apps', 'runner', 'ui', 'logo.png'),
];

if (!fs.existsSync(logoSrc)) {
  console.error('[assets] missing media/logo.png');
  process.exit(1);
}

for (const dest of targets) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(logoSrc, dest);
  console.log('[assets] logo →', path.relative(pkgRoot, dest));
}
