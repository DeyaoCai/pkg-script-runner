/**
 * Talk to Runner control plane for Jimeng ingest / endpoint discovery.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { app } from 'electron';

export type ControlEndpoint = {
  host: string;
  port: number;
  token: string;
  baseUrl: string;
  pid?: number;
};

export type JimengIngestPayload = {
  kind?: 'items_patch' | 'snapshot' | 'status';
  mode?: 'replace' | 'merge';
  items?: Array<{
    id: string;
    title: string;
    coverUrl: string;
    downloadUrl: string;
    author?: string;
    source?: 'favorite' | 'home';
  }>;
  updatedAt?: string;
  capturedUrl?: string;
  source?: string;
  message?: string;
  needLogin?: boolean;
  error?: string;
};

function candidateEndpointFiles(): string[] {
  const out: string[] = [];
  const envRoot = process.env.PKG_RUNNER_USER_DATA?.trim();
  if (envRoot) out.push(path.join(envRoot, 'control', 'http.json'));
  try {
    out.push(path.join(app.getPath('userData'), 'control', 'http.json'));
  } catch {
    /* ignore */
  }
  try {
    const appData = app.getPath('appData');
    out.push(path.join(appData, 'pkg-runner-dev', 'control', 'http.json'));
    out.push(path.join(appData, 'pkg-runner', 'control', 'http.json'));
  } catch {
    /* ignore */
  }
  return [...new Set(out)];
}

export function readRunnerControlEndpoint(): ControlEndpoint | null {
  for (const file of candidateEndpointFiles()) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as ControlEndpoint;
      if (
        raw &&
        typeof raw.baseUrl === 'string' &&
        raw.baseUrl.trim() &&
        typeof raw.token === 'string' &&
        raw.token.trim()
      ) {
        return {
          host: String(raw.host || '127.0.0.1'),
          port: Number(raw.port) || 18765,
          token: raw.token.trim(),
          baseUrl: raw.baseUrl.trim().replace(/\/+$/, ''),
          pid: typeof raw.pid === 'number' ? raw.pid : undefined,
        };
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

function requestJson(
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; json: unknown; error?: string }> {
  const ep = readRunnerControlEndpoint();
  if (!ep) {
    return Promise.resolve({
      ok: false,
      status: 0,
      json: null,
      error: 'Runner 控制面未就绪（找不到 control/http.json）',
    });
  }
  const u = new URL(urlPath, ep.baseUrl);
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve) => {
    const req = http.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port,
        path: `${u.pathname}${u.search}`,
        method,
        headers: {
          Authorization: `Bearer ${ep.token}`,
          Accept: 'application/json',
          ...(payload
            ? {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': Buffer.byteLength(payload, 'utf8'),
              }
            : {}),
        },
        timeout: 15000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.from(c)));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: unknown = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = { raw: text.slice(0, 200) };
          }
          const status = res.statusCode || 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            json,
            error: status >= 200 && status < 300 ? undefined : `HTTP ${status}`,
          });
        });
      },
    );
    req.on('error', (err) => {
      resolve({
        ok: false,
        status: 0,
        json: null,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: 0, json: null, error: 'timeout' });
    });
    if (payload) req.write(payload);
    req.end();
  });
}

export async function ingestJimengToRunner(
  payload: JimengIngestPayload,
): Promise<{ ok: boolean; error?: string }> {
  const res = await requestJson('POST', '/v1/jimeng/ingest', payload);
  if (!res.ok) {
    console.warn('[jimeng] ingest failed:', res.error || res.status);
  }
  return { ok: res.ok, error: res.error };
}

export async function fetchJimengLastFromRunner(): Promise<{
  ok: boolean;
  updatedAt: string;
  items: JimengIngestPayload['items'];
  error?: string;
}> {
  const res = await requestJson('GET', '/v1/jimeng/last');
  if (!res.ok) {
    return { ok: false, updatedAt: '', items: [], error: res.error };
  }
  const o = (res.json || {}) as {
    updatedAt?: string;
    items?: JimengIngestPayload['items'];
  };
  return {
    ok: true,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : '',
    items: Array.isArray(o.items) ? o.items : [],
  };
}
