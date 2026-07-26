/**
 * Monorepo 初始化：pnpm install → build。
 * native rebuild 默认尝试，失败只警告（常用预编译 node-pty 即可）。
 *
 *   pnpm bootstrap
 *   node ./scripts/bootstrap.mjs --skip-native
 *   node ./scripts/bootstrap.mjs --require-native   # native 失败则整体失败
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const skipNative = process.argv.includes('--skip-native');
const requireNative = process.argv.includes('--require-native');

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
};

function run(title, cmd, args, { allowFail = false } = {}) {
  return new Promise((resolve, reject) => {
    console.log('');
    console.log(`${c.cyan('→')} ${c.bold(title)}`);
    console.log(c.dim(`  $ ${cmd} ${args.join(' ')}`));
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: 'inherit',
      shell: true,
      env: process.env,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        console.log(`${c.green('✓')} ${title}`);
        resolve({ ok: true });
        return;
      }
      if (allowFail) {
        console.log(`${c.yellow('⚠')} ${title} failed (exit ${code}) — continue`);
        resolve({ ok: false, code });
        return;
      }
      reject(new Error(`${title} failed (exit ${code})`));
    });
  });
}

async function main() {
  console.log(c.bold('Pkg Runner · bootstrap'));
  console.log(c.dim(`root=${root}`));

  await run('install workspace deps', 'pnpm', ['install']);

  if (skipNative) {
    console.log('');
    console.log(c.yellow('skip native rebuild (--skip-native)'));
  } else {
    const native = await run('rebuild native (node-pty)', 'pnpm', ['rebuild:native'], {
      allowFail: !requireNative,
    });
    if (!native.ok) {
      console.log(
        c.dim(
          '  hint: MSB8040 = 需在 VS Build Tools 安装 “Spectre 缓解库”；多数情况预编译 node-pty 已够用',
        ),
      );
      console.log(c.dim('  或: pnpm bootstrap -- --skip-native'));
    }
  }

  await run('build tray + runner + web', 'pnpm', ['build']);

  console.log('');
  console.log(c.green('bootstrap ok'));
  console.log(c.dim('next: pnpm dev'));
}

main().catch((err) => {
  console.error(c.red(String(err?.message || err)));
  process.exit(1);
});
