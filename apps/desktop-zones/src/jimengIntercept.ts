/**
 * Jimeng intercept host: page inject (fetch/XHR) → IPC → parse → Runner ingest.
 * No CDP. Zones renderer talks only to Runner (SSE / last).
 */
import type { WebContents } from 'electron';
import { ipcMain } from 'electron';
import { reinjectJimengTap } from './jimengInject.js';

let ipcReady = false;
let wiredWc: WeakSet<WebContents> = new WeakSet();

export type JimengCapturePayload = {
  kind?: string;
  url?: string;
  source?: string;
  text?: string;
  at?: string;
};

async function handleCapture(payload: JimengCapturePayload): Promise<void> {
  const url = typeof payload.url === 'string' ? payload.url : '';
  const text = typeof payload.text === 'string' ? payload.text : '';
  if (!url || text.length < 8) return;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return;
  }
  // Dynamic import avoids jimengWindow → intercept → favorites → jimengWindow cycle.
  const { applyJimengNetworkCapture } = await import('./jimengFavorites.js');
  const hint =
    payload.source === 'home' || payload.source === 'favorite'
      ? payload.source
      : null;
  await applyJimengNetworkCapture(url, json, hint);
}

export function registerJimengCaptureIpc(): void {
  if (ipcReady) return;
  ipcReady = true;
  ipcMain.on('zones:jimeng-capture', (_e, payload: JimengCapturePayload) => {
    void handleCapture(payload || {});
  });
}

/** Wire navigation reinject + install tap (replaces CDP Network tap). */
export async function startJimengNetworkTap(wc: WebContents): Promise<void> {
  if (!wc || wc.isDestroyed()) return;
  registerJimengCaptureIpc();
  await reinjectJimengTap(wc);

  if (wiredWc.has(wc)) return;
  wiredWc.add(wc);

  const reinject = () => {
    void reinjectJimengTap(wc);
  };
  wc.on('dom-ready', reinject);
  wc.on('did-finish-load', reinject);
  wc.on('did-navigate', reinject);
  wc.on('did-navigate-in-page', reinject);
  wc.on('destroyed', () => {
    wiredWc.delete(wc);
  });
}

/** @deprecated no-op — inject has no detach; kept for call-site compatibility */
export function stopJimengNetworkTap(_wc?: WebContents | null): void {
  /* inject stays until webContents dies */
}

export function isJimengTapAttached(wc: Electron.WebContents): boolean {
  return !!wc && !wc.isDestroyed() && wiredWc.has(wc);
}
