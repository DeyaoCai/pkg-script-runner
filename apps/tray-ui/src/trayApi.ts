import type { TrayApi } from './env';

export function getTrayApi(): TrayApi | undefined {
  return window.trayApi;
}

export async function ensureTrayApi(maxMs = 1500): Promise<TrayApi | undefined> {
  const limit = maxMs;
  const start = Date.now();
  while (Date.now() - start < limit) {
    const api = getTrayApi();
    if (
      api &&
      typeof api.getSettings === 'function' &&
      typeof api.setSettings === 'function' &&
      typeof api.closeWindow === 'function'
    ) {
      return api;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  return getTrayApi();
}
