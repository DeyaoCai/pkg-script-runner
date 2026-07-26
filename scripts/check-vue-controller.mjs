/**
 * Vue Controller 配对与薄视图约束（对齐 docs/CONTROLLER-VUE.md）
 *
 * V1  .vue 内禁止定义 Ctrl / Controller 类
 * V2  .vue 禁止 chrome.runtime.sendMessage / fetch（须经 Ctrl）
 * V3  *Ctrl.ts / *-controller.ts / *.ctrl.ts 须有配对 .vue
 * V4  配对 Ctrl 文件至多 export 1 个 *Ctrl / *Controller
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCAN_ROOTS,
  CROSS_PAIRS,
  SCAN_IGNORE_PREFIXES,
} from './vue-controller-config.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

function isIgnored(relPath) {
  return SCAN_IGNORE_PREFIXES.some((p) => relPath.startsWith(p));
}

async function walk(dir, acc = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      await walk(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

function isCtrlFile(filename) {
  return (
    /Ctrl\.ts$/.test(filename) ||
    /-controller\.ts$/.test(filename) ||
    /\.ctrl\.ts$/.test(filename)
  );
}

/** FooCtrl.ts → Foo；deepseek-docs-panel-controller.ts → deepseek-docs-panel */
function expectedViewStems(ctrlFilename) {
  const stems = [];
  if (ctrlFilename.endsWith('Ctrl.ts')) {
    stems.push(ctrlFilename.slice(0, -'Ctrl.ts'.length));
  }
  if (ctrlFilename.endsWith('-controller.ts')) {
    stems.push(ctrlFilename.slice(0, -'-controller.ts'.length));
  }
  if (ctrlFilename.endsWith('.ctrl.ts')) {
    stems.push(ctrlFilename.slice(0, -'.ctrl.ts'.length));
  }
  return stems;
}

function exportedCtrlSymbols(content) {
  const exported = new Set();
  for (const m of content.matchAll(
    /export\s+class\s+(\w+(?:Ctrl|Controller))\b/g,
  )) {
    exported.add(m[1]);
  }
  for (const block of content.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const spec of block[1].split(',')) {
      const trimmed = spec.trim();
      if (!trimmed) continue;
      const asMatch = trimmed.match(
        /(?:\w+\s+as\s+)?(\w+(?:Ctrl|Controller))\s*$/,
      );
      if (asMatch) exported.add(asMatch[1]);
    }
  }
  return exported;
}

function stripVueScript(content) {
  const scripts = [];
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(content))) scripts.push(m[1] || '');
  return scripts.join('\n');
}

async function checkRoot(scanRel) {
  const scanAbs = join(root, scanRel);
  const files = await walk(scanAbs);
  const relOf = (p) => relative(scanAbs, p).replace(/\\/g, '/');
  const byRel = new Map(files.map((f) => [relOf(f), f]));
  const vueRels = [...byRel.keys()].filter(
    (r) => r.endsWith('.vue') && !isIgnored(r),
  );
  const ctrlRels = [...byRel.keys()].filter(
    (r) =>
      r.endsWith('.ts') && isCtrlFile(basename(r)) && !isIgnored(r),
  );

  const label = (r) => `${scanRel}/${r}`;

  // V1 + V2
  for (const r of vueRels) {
    const content = await readFile(byRel.get(r), 'utf8');
    const script = stripVueScript(content);

    if (/export\s+class\s+\w+(?:Ctrl|Controller)\b/.test(script)) {
      errors.push(`[V1] ${label(r)}：禁止在 .vue 内定义 Ctrl/Controller 类`);
    }
    if (/\bclass\s+\w+(?:Ctrl|Controller)\b/.test(script)) {
      errors.push(`[V1] ${label(r)}：禁止在 .vue 内定义 Ctrl/Controller 类`);
    }

    if (/chrome\.runtime\.sendMessage\b/.test(script)) {
      errors.push(
        `[V2] ${label(r)}：薄视图禁止 chrome.runtime.sendMessage（经 Ctrl）`,
      );
    }
    if (/\bfetch\s*\(/.test(script)) {
      errors.push(`[V2] ${label(r)}：薄视图禁止 fetch（经 Ctrl）`);
    }
  }

  // V3 + V4
  for (const r of ctrlRels) {
    const full = byRel.get(r);
    const content = await readFile(full, 'utf8');
    const exported = exportedCtrlSymbols(content);
    if (exported.size > 1) {
      errors.push(
        `[V4] ${label(r)} 导出 ${exported.size} 个 Ctrl（${[...exported].join(', ')}）；单文件仅 1 个`,
      );
    }

    const dir = dirname(r);
    const file = basename(r);
    const stems = expectedViewStems(file);
    const candidates = [];
    for (const stem of stems) {
      candidates.push(dir === '.' ? `${stem}.vue` : `${dir}/${stem}.vue`);
      candidates.push(
        dir === '.' ? `${stem}Panel.vue` : `${dir}/${stem}Panel.vue`,
      );
      candidates.push(
        `${dir === '.' ? stem : `${dir}`}/${stem}.vue`.replace(/\/+/g, '/'),
      );
      if (dir !== '.' && basename(dir) === stem) {
        candidates.push(`${dir}/${stem}.vue`);
      }
    }
    const cross = CROSS_PAIRS[r] || CROSS_PAIRS[file];
    if (cross) candidates.push(cross);

    const unique = [...new Set(candidates)];
    const hit = unique.find((c) => byRel.has(c));
    if (!hit) {
      errors.push(
        `[V3] ${label(r)} 缺少配对 .vue（尝试: ${unique.slice(0, 4).join(', ')}${cross ? '' : '；或配置 CROSS_PAIRS'}）`,
      );
    }
  }

  return { ctrlRels: ctrlRels.length, vueRels: vueRels.length };
}

async function main() {
  let ctrlTotal = 0;
  let vueTotal = 0;
  for (const scanRel of SCAN_ROOTS) {
    const { ctrlRels, vueRels } = await checkRoot(scanRel);
    ctrlTotal += ctrlRels;
    vueTotal += vueRels;
  }

  if (errors.length) {
    console.error('vue-controller check failed:\n');
    for (const e of errors) console.error(`  ${e}`);
    console.error(`\n${errors.length} error(s). See docs/CONTROLLER-VUE.md`);
    process.exit(1);
  }
  console.log(
    `vue-controller check ok (${ctrlTotal} ctrl, ${vueTotal} vue; roots: ${SCAN_ROOTS.join(', ')})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
