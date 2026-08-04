/**
 * Opaque proxy for Jimeng remote images.
 * Renderer only sees jimeng-media://i/<token> — real CDN URLs stay in main.
 */
import { createHash, randomBytes } from 'node:crypto';
import { protocol } from 'electron';
import { getJimengSession } from './jimengWindow.js';
import type { JimengFavoriteItem } from './jimengFavorites.js';

export const JIMENG_MEDIA_SCHEME = 'jimeng-media';

const tokenToUrl = new Map<string, string>();
const urlToToken = new Map<string, string>();

let schemeRegistered = false;
let protocolRegistered = false;

/** Call before app ready (standalone + tray). */
export function registerJimengMediaScheme(): void {
  if (schemeRegistered) return;
  schemeRegistered = true;
  protocol.registerSchemesAsPrivileged([
    {
      scheme: JIMENG_MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        bypassCSP: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

function tokenForUrl(url: string): string {
  const existing = urlToToken.get(url);
  if (existing) return existing;
  // Stable opaque id (not reversible without the map).
  const token = createHash('sha256').update(url).digest('hex').slice(0, 32);
  urlToToken.set(url, token);
  tokenToUrl.set(token, url);
  return token;
}

export function jimengMediaProxyUrl(realUrl: string): string {
  const u = String(realUrl || '').trim();
  if (!u || !/^https?:\/\//i.test(u)) return u;
  if (u.startsWith(`${JIMENG_MEDIA_SCHEME}://`)) return u;
  const token = tokenForUrl(u);
  return `${JIMENG_MEDIA_SCHEME}://i/${token}`;
}

export function resolveJimengMediaUrl(maybeProxy: string): string {
  const raw = String(maybeProxy || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) {
    // Ensure registered if a real URL slips through.
    tokenForUrl(raw);
    return raw;
  }
  const prefix = `${JIMENG_MEDIA_SCHEME}://i/`;
  if (!raw.startsWith(prefix)) return raw;
  const token = raw.slice(prefix.length).split(/[?#]/)[0] || '';
  return tokenToUrl.get(token) || '';
}

export function maskJimengItem(item: JimengFavoriteItem): JimengFavoriteItem {
  return {
    ...item,
    coverUrl: jimengMediaProxyUrl(item.coverUrl),
    downloadUrl: jimengMediaProxyUrl(item.downloadUrl),
  };
}

export function maskJimengItems(items: JimengFavoriteItem[]): JimengFavoriteItem[] {
  return items.map(maskJimengItem);
}

/** Resolve proxy URLs back to real ones (download / ingest). Prefer cache by id. */
export function unmaskJimengItem(
  item: JimengFavoriteItem,
  lookupById?: (id: string) => JimengFavoriteItem | undefined,
): JimengFavoriteItem {
  const fromCache = lookupById?.(item.id);
  if (fromCache?.downloadUrl) {
    return {
      ...item,
      coverUrl: fromCache.coverUrl || item.coverUrl,
      downloadUrl: fromCache.downloadUrl,
    };
  }
  return {
    ...item,
    coverUrl: resolveJimengMediaUrl(item.coverUrl) || item.coverUrl,
    downloadUrl: resolveJimengMediaUrl(item.downloadUrl) || item.downloadUrl,
  };
}

/** Warm token map from a cache list (real URLs). */
export function registerJimengMediaUrls(items: JimengFavoriteItem[]): void {
  for (const it of items) {
    if (it.coverUrl) tokenForUrl(it.coverUrl);
    if (it.downloadUrl) tokenForUrl(it.downloadUrl);
  }
}

export function registerJimengMediaProtocol(): void {
  if (protocolRegistered) return;
  protocolRegistered = true;

  protocol.handle(JIMENG_MEDIA_SCHEME, async (request) => {
    try {
      const real = resolveJimengMediaUrl(request.url);
      if (!real || !/^https?:\/\//i.test(real)) {
        return new Response('Not Found', { status: 404 });
      }
      const ses = getJimengSession();
      const fetchFn = (ses as Electron.Session & { fetch?: typeof fetch }).fetch;
      if (typeof fetchFn !== 'function') {
        return new Response('Unavailable', { status: 503 });
      }
      const res = await fetchFn.call(ses, real, {
        headers: {
          Referer: 'https://jimeng.jianying.com/',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        },
      });
      if (!res.ok) {
        return new Response(`Upstream ${res.status}`, { status: res.status });
      }
      const ctype = res.headers.get('content-type') || 'image/jpeg';
      const buf = Buffer.from(await res.arrayBuffer());
      // Avoid caching forever under a stable token if CDN rotates.
      return new Response(buf, {
        status: 200,
        headers: {
          'Content-Type': ctype,
          'Cache-Control': 'private, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return new Response(msg, { status: 502 });
    }
  });
}

/** Test helper / rare force remap with random token (not used by default). */
export function mintEphemeralJimengMediaUrl(realUrl: string): string {
  const u = String(realUrl || '').trim();
  if (!u) return u;
  const token = randomBytes(16).toString('hex');
  tokenToUrl.set(token, u);
  urlToToken.set(u, token);
  return `${JIMENG_MEDIA_SCHEME}://i/${token}`;
}
