/**
 * 本机控制面（对外正规通道）：127.0.0.1 HTTP + userData 下的 endpoint 发现文件。
 *
 * 发现：%APPDATA%/pkg-runner/control/http.json
 *   { host, port, token, baseUrl, pid }
 *
 * API（均需 Header: Authorization: Bearer <token>，除 GET /health）：
 *   GET  /health
 *   POST /v1/flush-logs
 *   POST /v1/scripts   body: { action: 'start'|'restart'|'stop', script, dir? }
 *
 * 不用 npm bin、不靠文件 req/ack 轮询。
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { app } from 'electron';
import { flushAllDiskLogs, type FlushDiskLogsResult } from './logSink.js';

/** 优先占用的本机端口；冲突则改用系统分配 */
export const CONTROL_PREFERRED_PORT = 18765;

export type RunScriptAction = 'start' | 'restart' | 'stop';

export type RunScriptRequest = {
  action: RunScriptAction;
  script: string;
  dir?: string | null;
};

export type RunScriptResult = {
  ok: boolean;
  action: RunScriptAction;
  script: string;
  dir: string | null;
  jobId?: string;
  wasRunning?: boolean;
  error?: string;
  at: string;
};

export type ControlEndpointInfo = {
  host: string;
  port: number;
  token: string;
  baseUrl: string;
  pid: number;
  at: string;
};

export function controlDir(): string {
  return path.join(app.getPath('userData'), 'control');
}

export function controlEndpointPath(): string {
  return path.join(controlDir(), 'http.json');
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

function readBody(req: IncomingMessage, limit = 256 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const raw = `${JSON.stringify(body)}\n`;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(raw, 'utf8'),
    'Cache-Control': 'no-store',
  });
  res.end(raw);
}

function extractToken(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === 'string') {
    const m = /^Bearer\s+(\S+)/i.exec(auth.trim());
    if (m?.[1]) return m[1];
  }
  const alt = req.headers['x-pkg-runner-token'];
  if (typeof alt === 'string' && alt.trim()) return alt.trim();
  if (Array.isArray(alt) && alt[0]) return String(alt[0]).trim();
  return null;
}

function parseRunScriptBody(raw: string): RunScriptRequest | { error: string } {
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    return { error: '请求不是合法 JSON' };
  }
  if (!parsed || typeof parsed !== 'object') return { error: '请求格式无效' };
  const o = parsed as Record<string, unknown>;
  const action = o.action;
  if (action !== 'start' && action !== 'restart' && action !== 'stop') {
    return { error: 'action 须为 start | restart | stop' };
  }
  const script = typeof o.script === 'string' ? o.script.trim() : '';
  if (!script) return { error: '缺少 script' };
  const dir = typeof o.dir === 'string' && o.dir.trim() ? o.dir.trim() : null;
  return { action, script, dir };
}

export type ControlServerHandles = {
  runScript: (req: RunScriptRequest) => Omit<RunScriptResult, 'at'>;
  onFlushed?: (result: FlushDiskLogsResult) => void;
  onRunScript?: (result: RunScriptResult) => void;
  applySettings?: (settings: unknown) => void;
  onToggleWindow?: () => void;
};

export type ControlServer = {
  info: ControlEndpointInfo;
  stop: () => void;
};

function listenPreferPort(
  server: http.Server,
  host: string,
  preferred: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off('error', onError);
      if (err.code === 'EADDRINUSE' && preferred !== 0) {
        server.listen(0, host, () => {
          const addr = server.address();
          if (addr && typeof addr === 'object') resolve(addr.port);
          else reject(new Error('listen failed'));
        });
        return;
      }
      reject(err);
    };
    server.once('error', onError);
    server.listen(preferred, host, () => {
      server.off('error', onError);
      const addr = server.address();
      if (addr && typeof addr === 'object') resolve(addr.port);
      else reject(new Error('listen failed'));
    });
  });
}

/** 直接 flush（second-instance / 退出收尾也可调） */
export function flushLogsNow(opts?: {
  onFlushed?: (result: FlushDiskLogsResult) => void;
}): FlushDiskLogsResult {
  const result = flushAllDiskLogs();
  opts?.onFlushed?.(result);
  return result;
}

export async function startControlServer(
  handles: ControlServerHandles,
): Promise<ControlServer> {
  const host = '127.0.0.1';
  const token = randomBytes(24).toString('hex');
  const endpointFile = controlEndpointPath();

  const server = http.createServer(async (req, res) => {
    const method = (req.method || 'GET').toUpperCase();
    const url = new URL(req.url || '/', `http://${host}`);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (method === 'GET' && pathname === '/health') {
        sendJson(res, 200, {
          ok: true,
          name: 'pkg-runner',
          pid: process.pid,
        });
        return;
      }

      const got = extractToken(req);
      if (!got || got !== token) {
        sendJson(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }

      if (method === 'GET' && pathname === '/v1/endpoint') {
        sendJson(res, 200, readEndpointFile() ?? { ok: false });
        return;
      }

      if (method === 'POST' && pathname === '/v1/flush-logs') {
        const result = flushLogsNow({ onFlushed: handles.onFlushed });
        sendJson(res, 200, result);
        return;
      }

      if (method === 'POST' && pathname === '/v1/settings') {
        const raw = await readBody(req);
        let parsed: unknown;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid json' });
          return;
        }
        handles.applySettings?.(parsed);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (method === 'POST' && pathname === '/v1/window/toggle') {
        handles.onToggleWindow?.();
        sendJson(res, 200, { ok: true });
        return;
      }

      if (method === 'POST' && pathname === '/v1/reload-settings') {
        sendJson(res, 200, { ok: true, note: 'settings pushed by tray via POST /v1/settings' });
        return;
      }

      if (method === 'POST' && pathname === '/v1/scripts') {
        const raw = await readBody(req);
        const parsed = parseRunScriptBody(raw);
        const at = new Date().toISOString();
        if ('error' in parsed) {
          const result: RunScriptResult = {
            ok: false,
            action: 'start',
            script: '',
            dir: null,
            error: parsed.error,
            at,
          };
          handles.onRunScript?.(result);
          sendJson(res, 400, result);
          return;
        }
        let body: Omit<RunScriptResult, 'at'>;
        try {
          body = handles.runScript(parsed);
        } catch (err) {
          body = {
            ok: false,
            action: parsed.action,
            script: parsed.script,
            dir: parsed.dir ?? null,
            error: err instanceof Error ? err.message : String(err),
          };
        }
        const result: RunScriptResult = { ...body, at };
        handles.onRunScript?.(result);
        sendJson(res, result.ok ? 200 : 400, result);
        return;
      }

      sendJson(res, 404, { ok: false, error: 'not found' });
    } catch (err) {
      sendJson(res, 500, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  const port = await listenPreferPort(server, host, CONTROL_PREFERRED_PORT);
  const info: ControlEndpointInfo = {
    host,
    port,
    token,
    baseUrl: `http://${host}:${port}`,
    pid: process.pid,
    at: new Date().toISOString(),
  };
  writeJsonAtomic(endpointFile, info);

  const stop = () => {
    try {
      server.close();
    } catch {
      /* ignore */
    }
    try {
      if (fs.existsSync(endpointFile)) fs.unlinkSync(endpointFile);
    } catch {
      /* ignore */
    }
  };

  return { info, stop };
}

function readEndpointFile(): ControlEndpointInfo | null {
  try {
    const raw = fs.readFileSync(controlEndpointPath(), 'utf8');
    return JSON.parse(raw) as ControlEndpointInfo;
  } catch {
    return null;
  }
}

/** @deprecated 旧名：现为 HTTP 控制面 */
export async function startControlBridge(
  opts: ControlServerHandles & { intervalMs?: number },
): Promise<() => void> {
  const srv = await startControlServer(opts);
  return () => srv.stop();
}
