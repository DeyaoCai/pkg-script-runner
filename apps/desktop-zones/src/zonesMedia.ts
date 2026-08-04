/**
 * Serve local image previews for custom / system desktop files.
 * URL: zones-file://p/<base64url(absPath)>
 */
import { protocol } from 'electron';

export const ZONES_FILE_SCHEME = 'zones-file';

const IMAGE_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.jpe',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
  '.ico',
]);

let registered = false;
let allowPath: ((abs: string) => boolean) | null = null;

function toBase64Url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}

function fromBase64Url(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8');
}

export function isImageExt(ext: string): boolean {
  return IMAGE_EXT.has(ext.toLowerCase());
}

export function zonesFilePreviewUrl(absPath: string): string {
  return `${ZONES_FILE_SCHEME}://p/${toBase64Url(absPath)}`;
}

export function registerZonesFileProtocol(
  isAllowed: (absPath: string) => boolean,
): void {
  allowPath = isAllowed;
  if (registered) return;
  registered = true;
  protocol.registerFileProtocol(ZONES_FILE_SCHEME, (request, callback) => {
    try {
      const prefix = `${ZONES_FILE_SCHEME}://p/`;
      if (!request.url.startsWith(prefix)) {
        callback({ error: -6 });
        return;
      }
      const encoded = request.url.slice(prefix.length).split(/[?#]/)[0] || '';
      const abs = fromBase64Url(decodeURIComponent(encoded));
      if (!abs || !allowPath?.(abs)) {
        callback({ error: -10 });
        return;
      }
      callback({ path: abs });
    } catch {
      callback({ error: -2 });
    }
  });
}
