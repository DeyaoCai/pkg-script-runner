#!/usr/bin/env node
/**
 * 开发期便利：读 control/http.json，调本机 HTTP 控制面（不是对外 bin）。
 *
 *   pnpm --filter pkg-runner ctl -- health
 *   pnpm --filter pkg-runner ctl -- flush-logs
 *   pnpm --filter pkg-runner ctl -- start|restart|stop <script> [dir]
 *   pnpm --filter pkg-runner ctl -- shell-open [dir]
 *   pnpm --filter pkg-runner ctl -- shell-exec <command> [dir]
 *   pnpm --filter pkg-runner ctl -- shell-close [id|dir]
 *   pnpm --filter pkg-runner ctl -- shell-list [dir]
 *   pnpm --filter pkg-runner ctl -- ports
 *   pnpm --filter pkg-runner ctl -- port-kill <port>
 *   pnpm --filter pkg-runner ctl -- ports-reap [--all]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function userDataDir() {
  const profile = (process.env.PKG_RUNNER_PROFILE || '').trim();
  const home =
    process.platform === 'win32'
      ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
      : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support')
        : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  if (profile) return path.join(home, profile);
  for (const name of ['pkg-runner', 'pkg-runner-dev']) {
    const dir = path.join(home, name);
    if (fs.existsSync(path.join(dir, 'control', 'http.json'))) return dir;
  }
  return path.join(home, 'pkg-runner');
}

function usage(code = 1) {
  console.error(`用法（需 pkg-runner 已运行）:
  ctl health
  ctl flush-logs
  ctl start|restart|stop <script> [projectDir]
  ctl shell-open [projectDir]
  ctl shell-exec <command> [projectDir]
  ctl shell-close [shellId|projectDir]
  ctl shell-list [projectDir]
  ctl ports                 # 监听端口 + owner（unmanaged=漂移）
  ctl port-kill <port>      # 按端口杀进程树
  ctl ports-reap [--all]    # 默认只清 unmanaged 的 Node/dev server；--all 不限进程名

发现文件: %APPDATA%/pkg-runner[/ -dev]/control/http.json（可用 PKG_RUNNER_PROFILE）
正规通道: HTTP 127.0.0.1 + Bearer token（见该文件）
`);
  process.exit(code);
}

function loadEndpoint() {
  const file = path.join(userDataDir(), 'control', 'http.json');
  if (!fs.existsSync(file)) {
    console.error(`[ctl] 未找到 ${file}（应用未启动或控制面未起来）`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error('[ctl] 无法解析 http.json:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

async function api(method, pathname, body, { print = true } = {}) {
  const ep = loadEndpoint();
  const url = `${ep.baseUrl}${pathname}`;
  const headers = {
    Authorization: `Bearer ${ep.token}`,
  };
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(url, { method, headers, body: payload });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    console.error(`[ctl] HTTP ${res.status} 非 JSON:`, text);
    process.exit(2);
  }
  if (!res.ok || json.ok === false) {
    console.error(`[ctl] 失败 HTTP ${res.status}:`, json.error || json);
    process.exit(1);
  }
  if (print) console.log(JSON.stringify(json, null, 2));
  return json;
}

function pad(s, n) {
  const t = String(s ?? '');
  return t.length >= n ? t.slice(0, n) : t + ' '.repeat(n - t.length);
}

function printPortsTable(json) {
  const ports = Array.isArray(json.ports) ? json.ports : [];
  console.log(
    `${pad('PORT', 7)} ${pad('PID', 8)} ${pad('OWNER', 12)} ${pad('PROCESS', 16)} REF`,
  );
  console.log('-'.repeat(72));
  const sorted = [...ports].sort(
    (a, b) =>
      (a.owner === 'unmanaged' ? 0 : 1) - (b.owner === 'unmanaged' ? 0 : 1) ||
      a.port - b.port,
  );
  for (const p of sorted) {
    const mark = p.owner === 'unmanaged' ? ' <-- orphan' : '';
    const ref = p.jobId || p.shellId || '';
    const line = `${pad(p.port, 7)} ${pad(p.pid, 8)} ${pad(p.owner, 12)} ${pad(p.processName, 16)} ${ref}${mark}`;
    if (p.owner === 'unmanaged') {
      console.log(`* ${line}`);
    } else {
      console.log(`  ${line}`);
    }
  }
  console.log('-'.repeat(72));
  console.log(`total ${ports.length} · orphans ${json.orphans ?? 0}`);
}

const argv = process.argv.slice(2).filter((a) => a !== '--');
const cmd = argv[0];
if (!cmd || cmd === '-h' || cmd === '--help') usage(cmd ? 0 : 1);

if (cmd === 'health') {
  const ep = loadEndpoint();
  const res = await fetch(`${ep.baseUrl}/health`);
  console.log(JSON.stringify(await res.json(), null, 2));
  process.exit(res.ok ? 0 : 1);
}

if (cmd === 'flush-logs') {
  await api('POST', '/v1/flush-logs');
  process.exit(0);
}

if (cmd === 'start' || cmd === 'restart' || cmd === 'stop') {
  const script = argv[1];
  if (!script) usage(1);
  const dir = argv[2] ? path.resolve(argv[2]) : null;
  await api('POST', '/v1/scripts', {
    action: cmd,
    script,
    dir,
  });
  process.exit(0);
}

if (cmd === 'shell-open') {
  const dir = argv[1] ? path.resolve(argv[1]) : null;
  await api('POST', '/v1/shell', { action: 'open', dir });
  process.exit(0);
}

if (cmd === 'shell-exec') {
  const rest = argv.slice(1);
  if (!rest.length) usage(1);
  let dir = null;
  let commandParts = rest;
  const last = rest[rest.length - 1];
  if (
    rest.length >= 2 &&
    last &&
    (last.includes('/') || last.includes('\\') || /^[A-Za-z]:/.test(last)) &&
    fs.existsSync(path.resolve(last)) &&
    fs.statSync(path.resolve(last)).isDirectory()
  ) {
    dir = path.resolve(last);
    commandParts = rest.slice(0, -1);
  }
  const command = commandParts.join(' ').trim();
  if (!command) usage(1);
  await api('POST', '/v1/shell', { action: 'exec', command, dir });
  process.exit(0);
}

if (cmd === 'shell-close') {
  const target = argv[1] ? String(argv[1]) : '';
  if (!target) usage(1);
  const body = target.startsWith('shell::')
    ? { action: 'close', id: target }
    : { action: 'close', dir: path.resolve(target) };
  await api('POST', '/v1/shell', body);
  process.exit(0);
}

if (cmd === 'shell-list') {
  const dir = argv[1] ? path.resolve(argv[1]) : null;
  await api('POST', '/v1/shell', { action: 'list', dir });
  process.exit(0);
}

if (cmd === 'ports') {
  const json = await api('POST', '/v1/ports', { action: 'list' }, { print: false });
  printPortsTable(json);
  process.exit(0);
}

if (cmd === 'port-kill') {
  const port = Number(argv[1]);
  if (!Number.isFinite(port) || port <= 0) usage(1);
  await api('POST', '/v1/ports', { action: 'kill', port });
  process.exit(0);
}

if (cmd === 'ports-reap') {
  const all = argv.includes('--all');
  await api('POST', '/v1/ports', { action: 'reap', nodeOnly: !all });
  process.exit(0);
}

usage(1);
