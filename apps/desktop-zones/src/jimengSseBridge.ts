/**
 * Main-process SSE client for Runner /v1/jimeng/stream → Zones renderer.
 */
import http from 'node:http';
import type { BrowserWindow } from 'electron';
import { readRunnerControlEndpoint } from './jimengControlClient.js';
import { maskJimengItems, registerJimengMediaUrls } from './jimengMedia.js';
import type { JimengFavoriteItem } from './jimengFavorites.js';

export type JimengHubWireEvent = {
  kind: 'snapshot' | 'items_patch' | 'status';
  updatedAt?: string;
  items?: Array<{
    id: string;
    title: string;
    coverUrl: string;
    downloadUrl: string;
    author?: string;
    source?: 'favorite' | 'home';
  }>;
  message?: string;
  needLogin?: boolean;
  error?: string;
  source?: string;
  capturedUrl?: string;
  seq?: number;
  serverTs?: string;
};

type GetWindow = () => BrowserWindow | null;

let abort: AbortController | null = null;
let refCount = 0;
let getMainWindow: GetWindow | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function clearReconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function broadcast(ev: JimengHubWireEvent): void {
  const win = getMainWindow?.();
  if (!win || win.isDestroyed()) return;
  let payload: JimengHubWireEvent = ev;
  if (
    (ev.kind === 'snapshot' || ev.kind === 'items_patch') &&
    Array.isArray(ev.items)
  ) {
    const items = ev.items as JimengFavoriteItem[];
    registerJimengMediaUrls(items);
    payload = { ...ev, items: maskJimengItems(items) };
  }
  try {
    win.webContents.send('zones:jimeng-hub', payload);
  } catch {
    /* ignore */
  }
}

function connectOnce(): void {
  const ep = readRunnerControlEndpoint();
  if (!ep) {
    scheduleReconnect(2000);
    return;
  }
  const u = new URL('/v1/jimeng/stream', ep.baseUrl);
  const ac = new AbortController();
  abort = ac;

  const req = http.request(
    {
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port,
      path: `${u.pathname}${u.search}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${ep.token}`,
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    },
    (res) => {
      if ((res.statusCode || 0) >= 400) {
        res.resume();
        scheduleReconnect(2500);
        return;
      }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buf += chunk;
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of block.split(/\r?\n/)) {
            if (!line.startsWith('data:')) continue;
            const raw = line.slice(5).trim();
            if (!raw) continue;
            try {
              const ev = JSON.parse(raw) as JimengHubWireEvent;
              if (ev && typeof ev.kind === 'string') broadcast(ev);
            } catch {
              /* ignore bad event */
            }
          }
        }
      });
      res.on('end', () => {
        if (abort === ac) abort = null;
        if (refCount > 0) scheduleReconnect(1500);
      });
      res.on('error', () => {
        if (abort === ac) abort = null;
        if (refCount > 0) scheduleReconnect(2000);
      });
    },
  );

  req.on('error', () => {
    if (abort === ac) abort = null;
    if (refCount > 0) scheduleReconnect(2000);
  });

  ac.signal.addEventListener('abort', () => {
    try {
      req.destroy();
    } catch {
      /* ignore */
    }
  });

  req.end();
}

function scheduleReconnect(ms: number): void {
  if (refCount <= 0) return;
  clearReconnect();
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (refCount > 0 && !abort) connectOnce();
  }, ms);
}

export function configureJimengSseBridge(getWindow: GetWindow): void {
  getMainWindow = getWindow;
}

export function startJimengSseBridge(): { ok: boolean; error?: string } {
  refCount += 1;
  if (refCount === 1) {
    clearReconnect();
    if (abort) {
      abort.abort();
      abort = null;
    }
    const ep = readRunnerControlEndpoint();
    if (!ep) {
      // Still keep ref; reconnect loop will retry when Runner starts.
      scheduleReconnect(1500);
      return { ok: false, error: 'Runner 控制面未就绪' };
    }
    // Seed hub from local cache before subscribe — empty SSE snapshot must not wipe UI.
    void import('./jimengFavorites.js')
      .then((m) => m.publishFavoritesCacheToRunner({ kind: 'snapshot' }))
      .finally(() => {
        if (refCount > 0 && !abort) connectOnce();
      });
    return { ok: true };
  }
  return { ok: true };
}

export function stopJimengSseBridge(): void {
  refCount = Math.max(0, refCount - 1);
  if (refCount > 0) return;
  clearReconnect();
  if (abort) {
    abort.abort();
    abort = null;
  }
}

export function shutdownJimengSseBridge(): void {
  refCount = 0;
  clearReconnect();
  if (abort) {
    abort.abort();
    abort = null;
  }
}
