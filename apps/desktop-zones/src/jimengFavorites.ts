/**
 * Jimeng favorites: passive inject capture → local disk → wallpaper download.
 * No Runner / SSE required.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, net } from 'electron';
import { jimengWallpapersDir } from '@pkg-runner/wallpaper';
import {
  getJimengSession,
  JIMENG_HOME_URL,
  openJimengWindow,
} from './jimengWindow.js';

export type JimengItemSource = 'favorite' | 'home';

export type JimengFavoriteItem = {
  id: string;
  title: string;
  coverUrl: string;
  downloadUrl: string;
  author?: string;
  /** favorite = 收藏；home = 首页推荐 */
  source?: JimengItemSource;
};

export type JimengFavoritesCache = {
  updatedAt: string;
  items: JimengFavoriteItem[];
};

export type JimengSyncResult = {
  ok: boolean;
  needLogin?: boolean;
  error?: string;
  items: JimengFavoriteItem[];
  capturedUrls?: string[];
};

export type JimengDownloadResult = {
  ok: boolean;
  error?: string;
  path?: string;
  skipped?: boolean;
  name?: string;
};

/**
 * Favorites / personal assets only.
 * Keep away from broad "collect/collection" — those appear in recommend feeds too.
 */
const FAV_URL_ALLOW =
  /get_favorite_list|favorit|bookmark|star_list|like_list|get_collect|my_collect|user_collect|pack_list|get_asset_list|personal_asset|my_work|my_creation|work_list|用户资产|我的资产|收藏/i;

/** Never treat as image list for either source. */
const URL_HARD_DENY =
  /workbench|generate|draft_list|history_list|workspace\/list|upload|login|passport|captcha/i;

/**
 * Community / homepage recommend.
 * Checked before FAV so …collection_recommend… does not become 「收藏」.
 */
const HOME_URL_ALLOW =
  /recommend|explore|discover|inspiration|hot[_-]?list|for[_-]?you|trending|home[_-]?feed|gallery_feed|community_feed|get_image_feed|get_video_feed|story_feed|channel_feed|local_item_list/i;

function cachePath(): string {
  return path.join(app.getPath('userData'), 'jimeng-favorites.json');
}

type CacheListener = (cache: JimengFavoritesCache) => void;
let cacheListener: CacheListener | null = null;

/** Main process: push UI when local cache changes (replaces Runner SSE). */
export function setJimengCacheListener(cb: CacheListener | null): void {
  cacheListener = cb;
}

function emitCache(cache: JimengFavoritesCache): void {
  try {
    cacheListener?.(cache);
  } catch {
    /* ignore */
  }
}

export function readFavoritesCache(): JimengFavoritesCache {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath(), 'utf8')) as JimengFavoritesCache;
    if (!raw || !Array.isArray(raw.items)) return { updatedAt: '', items: [] };
    return {
      updatedAt: raw.updatedAt || '',
      items: raw.items.map((it) => ({
        ...it,
        source: it?.source === 'home' ? 'home' : 'favorite',
      })),
    };
  } catch {
    return { updatedAt: '', items: [] };
  }
}

export function writeFavoritesCache(items: JimengFavoriteItem[]): JimengFavoritesCache {
  const data: JimengFavoritesCache = {
    updatedAt: new Date().toISOString(),
    items,
  };
  fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
  fs.writeFileSync(cachePath(), JSON.stringify(data, null, 2), 'utf8');
  emitCache(data);
  return data;
}

export function classifyJimengApiUrl(url: string): JimengItemSource | null {
  // Recommend first — otherwise broad favorite tokens steal 推荐 feeds.
  if (isHomeFeedApiUrl(url)) return 'home';
  if (isFavoritesApiUrl(url)) return 'favorite';
  return null;
}

export function parseJimengItemsFromJson(
  json: unknown,
  source: JimengItemSource,
): JimengFavoriteItem[] {
  const batch: JimengFavoriteItem[] = [];
  walkCollect(json, batch);
  return tagSource(normalizeItems(batch), source);
}

/**
 * Merge a network JSON capture into local persistent cache (disk only).
 */
export async function applyJimengNetworkCapture(
  url: string,
  json: unknown,
  hint?: JimengItemSource | null,
): Promise<JimengFavoritesCache | null> {
  // URL wins; inject hint only when URL is ambiguous.
  const source = classifyJimengApiUrl(url) || hint || null;
  if (!source) return null;
  const incoming = parseJimengItemsFromJson(json, source);
  if (!incoming.length) return null;

  const cached = readFavoritesCache().items;
  // Incoming batch source always wins for those ids (so re-browsing 推荐 can undo a bad tag).
  const map = new Map<string, JimengFavoriteItem>();
  for (const it of cached) {
    if (!it?.id) continue;
    map.set(it.id, {
      ...it,
      source: it.source === 'home' ? 'home' : 'favorite',
    });
  }
  for (const it of incoming) {
    if (!it.id || !it.downloadUrl) continue;
    map.set(it.id, { ...it, source });
  }
  const fav: JimengFavoriteItem[] = [];
  const home: JimengFavoriteItem[] = [];
  for (const it of map.values()) {
    if (it.source === 'home') home.push(it);
    else fav.push(it);
  }
  return writeFavoritesCache([...fav, ...home]);
}

/** @deprecated no-op — Jimeng path is local-only now */
export async function publishFavoritesCacheToRunner(_opts?: {
  kind?: 'snapshot' | 'items_patch';
  message?: string;
  needLogin?: boolean;
  error?: string;
}): Promise<void> {
  /* intentionally empty */
}

export async function hasJimengSession(): Promise<boolean> {
  const ses = getJimengSession();
  const cookies = await ses.cookies.get({ domain: '.jianying.com' });
  const hit = cookies.some(
    (c) =>
      (c.name === 'sessionid' || c.name === 'sessionid_ss' || c.name === 'sid_tt') &&
      !!c.value,
  );
  if (hit) return true;
  const all = await ses.cookies.get({});
  return all.some(
    (c) =>
      /jianying|jimeng/i.test(c.domain || '') &&
      (c.name === 'sessionid' || c.name === 'sessionid_ss') &&
      !!c.value,
  );
}

function isFavoritesApiUrl(url: string): boolean {
  if (!url || URL_HARD_DENY.test(url)) return false;
  if (/get_favorite_list/i.test(url)) return true;
  if (HOME_URL_ALLOW.test(url)) return false;
  return FAV_URL_ALLOW.test(url);
}

function isHomeFeedApiUrl(url: string): boolean {
  if (!url || URL_HARD_DENY.test(url)) return false;
  if (/get_favorite_list/i.test(url)) return false;
  if (!/jimeng\.jianying\.com|jianying\.com/i.test(url)) return false;
  return HOME_URL_ALLOW.test(url);
}

function tagSource(items: JimengFavoriteItem[], source: JimengItemSource): JimengFavoriteItem[] {
  return items.map((it) => ({ ...it, source }));
}

function looksLikeImageUrl(u: string): boolean {
  if (!/^https?:\/\//i.test(u)) return false;
  if (/\.(jpg|jpeg|png|webp|bmp)(\?|$)/i.test(u)) return true;
  if (/tos-|byteimg|pstatp|douyinpic|jimeng|jianying|image/i.test(u)) return true;
  return false;
}

function pickString(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function walkCollect(node: unknown, out: JimengFavoriteItem[], depth = 0): void {
  if (depth > 12 || node == null) return;
  if (Array.isArray(node)) {
    for (const x of node) walkCollect(x, out, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;
  const o = node as Record<string, unknown>;

  const cover = pickString(
    o.cover_url,
    o.coverUrl,
    o.cover,
    o.image_url,
    o.imageUrl,
    o.thumb_url,
    o.thumbnail,
    (o.cover as { url?: string } | undefined)?.url,
    (o.image as { url?: string } | undefined)?.url,
  );
  const large = pickString(
    o.origin_url,
    o.originUrl,
    o.download_url,
    o.downloadUrl,
    o.large_url,
    o.largeUrl,
    o.raw_url,
    o.no_watermark_url,
    (o.image as { large_url?: string; origin_url?: string } | undefined)?.large_url,
    (o.image as { origin_url?: string } | undefined)?.origin_url,
    cover,
  );

  const id = pickString(
    o.item_id,
    o.itemId,
    o.work_id,
    o.workId,
    o.asset_id,
    o.assetId,
    o.id,
  );
  const title = pickString(o.title, o.name, o.prompt, o.desc, o.description, id || '未命名');

  if (id && looksLikeImageUrl(cover || large)) {
    const downloadUrl = looksLikeImageUrl(large) ? large : cover;
    const coverUrl = looksLikeImageUrl(cover) ? cover : downloadUrl;
    if (downloadUrl) {
      out.push({
        id: String(id),
        title: title.slice(0, 120),
        coverUrl,
        downloadUrl,
        author:
          pickString(
            (o.author as { name?: string } | undefined)?.name,
            o.author_name,
            o.authorName,
            o.nickname,
          ) || undefined,
      });
    }
  }

  for (const v of Object.values(o)) {
    if (v && typeof v === 'object') walkCollect(v, out, depth + 1);
  }
}

function normalizeItems(raw: JimengFavoriteItem[]): JimengFavoriteItem[] {
  const map = new Map<string, JimengFavoriteItem>();
  for (const it of raw) {
    if (!it.id || !it.downloadUrl) continue;
    if (!map.has(it.id)) map.set(it.id, it);
  }
  return [...map.values()];
}

/**
 * Refresh from local disk only. Opening Jimeng admin is a separate action —
 * user browses there; inject writes JSON; this just reloads.
 */
export async function syncJimengFavorites(): Promise<JimengSyncResult> {
  const items = readFavoritesCache().items;
  if (!items.length) {
    const loggedIn = await hasJimengSession();
    return {
      ok: false,
      needLogin: !loggedIn,
      error: loggedIn
        ? '本地还没有截获记录。请打开「即梦后台」进入收藏正常浏览。'
        : '请先打开「即梦后台」登录，再在收藏页浏览以截获。',
      items: [],
    };
  }
  return { ok: true, items };
}

function extFromUrlOrType(url: string, contentType: string): string {
  const m = url.match(/\.(jpg|jpeg|png|webp|bmp)(\?|$)/i);
  if (m) return `.${m[1]!.toLowerCase().replace('jpeg', 'jpg')}`;
  if (/png/i.test(contentType)) return '.png';
  if (/webp/i.test(contentType)) return '.webp';
  if (/bmp/i.test(contentType)) return '.bmp';
  return '.jpg';
}

function safeFileBase(id: string): string {
  return String(id)
    .replace(/[^\w.-]+/g, '_')
    .slice(0, 80);
}

export async function downloadJimengFavorite(
  item: JimengFavoriteItem,
): Promise<JimengDownloadResult> {
  const id = safeFileBase(item.id);
  if (!id) return { ok: false, error: '无效收藏项' };

  // Always prefer disk cache (real CDN URLs). UI may only have jimeng-media:// masks.
  const cached = readFavoritesCache().items.find((x) => x.id === item.id);
  const candidates = [
    cached?.downloadUrl,
    cached?.coverUrl,
    item.downloadUrl,
    item.coverUrl,
  ]
    .map((u) => String(u || '').trim())
    .filter((u) => /^https?:\/\//i.test(u));

  if (!candidates.length) {
    return { ok: false, error: '无有效下载地址（需本机缓存里的真实链接）' };
  }

  const dir = jimengWallpapersDir();
  fs.mkdirSync(dir, { recursive: true });

  const existing = fs
    .readdirSync(dir)
    .find((n) => n.startsWith(`jimeng-${id}.`) && /\.(jpg|jpeg|png|webp|bmp)$/i.test(n));
  if (existing) {
    return {
      ok: true,
      skipped: true,
      name: existing,
      path: path.join(dir, existing),
    };
  }

  const ses = getJimengSession();
  const fetchFn = (ses as Electron.Session & { fetch?: typeof fetch }).fetch;
  let lastErr = '下载失败';

  for (const url of [...new Set(candidates)]) {
    try {
      if (typeof fetchFn === 'function') {
        const res = await fetchFn.call(ses, url, {
          headers: {
            Referer: 'https://jimeng.jianying.com/',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
            Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          },
        });
        if (!res.ok) {
          lastErr = `HTTP ${res.status}`;
          continue;
        }
        const ctype = res.headers.get('content-type') || '';
        if (ctype && !/^image\//i.test(ctype) && !/octet-stream/i.test(ctype)) {
          lastErr = `非图片类型: ${ctype}`;
          continue;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 64) {
          lastErr = '文件过小';
          continue;
        }
        const ext = extFromUrlOrType(url, ctype);
        const name = `jimeng-${id}${ext}`;
        const abs = path.join(dir, name);
        fs.writeFileSync(abs, buf);
        return { ok: true, path: abs, name };
      }
      const abs = await downloadViaNet(url, path.join(dir, `jimeng-${id}`));
      return { ok: true, path: abs, name: path.basename(abs) };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }

  return { ok: false, error: lastErr };
}

function downloadViaNet(url: string, destNoExt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, method: 'GET', session: getJimengSession() });
    const chunks: Buffer[] = [];
    let ctype = '';
    let status = 0;
    req.on('response', (res) => {
      status = res.statusCode || 0;
      ctype = String(res.headers['content-type'] || '');
      res.on('data', (c) => chunks.push(Buffer.from(c)));
      res.on('end', () => {
        if (status < 200 || status >= 300) {
          reject(new Error(`HTTP ${status}`));
          return;
        }
        if (ctype && !/^image\//i.test(ctype) && !/octet-stream/i.test(ctype)) {
          reject(new Error(`非图片类型: ${ctype}`));
          return;
        }
        const buf = Buffer.concat(chunks);
        if (buf.length < 64) {
          reject(new Error('文件过小'));
          return;
        }
        const ext = extFromUrlOrType(url, ctype);
        const abs = `${destNoExt}${ext}`;
        fs.writeFileSync(abs, buf);
        resolve(abs);
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setHeader('Referer', 'https://jimeng.jianying.com/');
    req.setHeader(
      'User-Agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
    );
    req.setHeader('Accept', 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8');
    req.end();
  });
}

export async function downloadJimengFavorites(
  ids?: string[],
): Promise<{ ok: boolean; downloaded: number; skipped: number; failed: number; error?: string }> {
  const all = readFavoritesCache().items;
  const list = ids?.length ? all.filter((x) => ids.includes(x.id)) : all;
  if (!list.length) {
    return { ok: false, downloaded: 0, skipped: 0, failed: 0, error: '没有可下载项，请先在即梦收藏页浏览以截获列表' };
  }
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  for (const item of list) {
    const r = await downloadJimengFavorite(item);
    if (!r.ok) failed += 1;
    else if (r.skipped) skipped += 1;
    else downloaded += 1;
  }
  return { ok: failed === 0, downloaded, skipped, failed };
}

export function focusJimengForLogin(): void {
  openJimengWindow(JIMENG_HOME_URL);
}
