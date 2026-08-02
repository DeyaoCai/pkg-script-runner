#!/usr/bin/env node
/**
 * 开发期便利：读 control/http.json，调本机 HTTP 控制面（不是对外 bin）。
 *
 *   pnpm --filter pkg-runner ctl -- health
 *   pnpm --filter pkg-runner ctl -- flush-logs
 *   pnpm --filter pkg-runner ctl -- start dev [dir]
 *   pnpm --filter pkg-runner ctl -- restart dev
 *   pnpm --filter pkg-runner ctl -- stop lint
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

async function api(method, pathname, body) {
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
  console.log(JSON.stringify(json, null, 2));
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

usage(1);
