/**
 * Preload for embedded Jimeng WebContentsView.
 * MAIN inject reports via pkgJimengReport → IPC → main → Runner.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('pkgJimengReport', (payload: unknown) => {
  if (!payload || typeof payload !== 'object') return;
  ipcRenderer.send('zones:jimeng-capture', payload);
});

// Backup: MAIN-world postMessage (same as channel pattern).
const g = globalThis as typeof globalThis & {
  addEventListener: (type: string, listener: (event: { data?: unknown }) => void) => void;
};
g.addEventListener('message', (event) => {
  try {
    const data = event.data as {
      source?: string;
      payload?: unknown;
    } | null;
    if (!data || data.source !== 'pkg-jimeng-tap') return;
    if (!data.payload || typeof data.payload !== 'object') return;
    ipcRenderer.send('zones:jimeng-capture', data.payload);
  } catch {
    /* ignore */
  }
});
