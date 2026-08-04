/**
 * Jimeng image hub: Zones POSTs captures → memory snapshot → SSE subscribers.
 */
import type { ServerResponse } from 'node:http';

export type JimengItemSource = 'favorite' | 'home';

export type JimengFavoriteItem = {
  id: string;
  title: string;
  coverUrl: string;
  downloadUrl: string;
  author?: string;
  source?: JimengItemSource;
};

export type JimengHubSnapshot = {
  updatedAt: string;
  items: JimengFavoriteItem[];
};

export type JimengIngestBody = {
  kind?: 'items_patch' | 'snapshot' | 'status';
  items?: JimengFavoriteItem[];
  updatedAt?: string;
  capturedUrl?: string;
  source?: string;
  message?: string;
  needLogin?: boolean;
  error?: string;
  /** replace=full list; merge=upsert by id (default merge) */
  mode?: 'replace' | 'merge';
};

export type JimengHubEvent =
  | {
      kind: 'snapshot';
      updatedAt: string;
      items: JimengFavoriteItem[];
      seq: number;
      serverTs: string;
    }
  | {
      kind: 'items_patch';
      updatedAt: string;
      items: JimengFavoriteItem[];
      source?: string;
      capturedUrl?: string;
      seq: number;
      serverTs: string;
    }
  | {
      kind: 'status';
      message: string;
      needLogin?: boolean;
      error?: string;
      seq: number;
      serverTs: string;
    };

const MAX_BUFFER = 40;

function normalizeItem(raw: unknown): JimengFavoriteItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id.trim() : '';
  const coverUrl = typeof o.coverUrl === 'string' ? o.coverUrl.trim() : '';
  const downloadUrl =
    typeof o.downloadUrl === 'string' ? o.downloadUrl.trim() : coverUrl;
  if (!id || !downloadUrl) return null;
  const source =
    o.source === 'home' || o.source === 'favorite' ? o.source : undefined;
  return {
    id,
    title: typeof o.title === 'string' && o.title.trim() ? o.title.trim() : id,
    coverUrl: coverUrl || downloadUrl,
    downloadUrl,
    author: typeof o.author === 'string' && o.author.trim() ? o.author.trim() : undefined,
    source,
  };
}

function mergeItems(
  prev: JimengFavoriteItem[],
  next: JimengFavoriteItem[],
): JimengFavoriteItem[] {
  const map = new Map<string, JimengFavoriteItem>();
  for (const it of prev) map.set(it.id, it);
  for (const it of next) {
    // Latest capture wins (do not freeze a wrong 「收藏」 tag over 「推荐」).
    map.set(it.id, it);
  }
  const fav: JimengFavoriteItem[] = [];
  const rest: JimengFavoriteItem[] = [];
  for (const it of map.values()) {
    if (it.source === 'favorite') fav.push(it);
    else rest.push(it);
  }
  return [...fav, ...rest];
}

export class JimengHub {
  private static seq = 0;
  private static buffer: JimengHubEvent[] = [];
  private static clients = new Set<ServerResponse>();
  private static last: JimengHubSnapshot = { updatedAt: '', items: [] };

  static getLast(): JimengHubSnapshot {
    return JimengHub.last;
  }

  static ingest(body: JimengIngestBody): JimengHubEvent {
    JimengHub.seq += 1;
    const serverTs = new Date().toISOString();
    const kind = body.kind || (body.items ? 'items_patch' : 'status');

    if (kind === 'status' || (!body.items && (body.message || body.error || body.needLogin))) {
      const ev: JimengHubEvent = {
        kind: 'status',
        message: String(body.message || body.error || 'status'),
        needLogin: !!body.needLogin,
        error: body.error ? String(body.error) : undefined,
        seq: JimengHub.seq,
        serverTs,
      };
      JimengHub.push(ev);
      return ev;
    }

    const parsed = (Array.isArray(body.items) ? body.items : [])
      .map(normalizeItem)
      .filter((x): x is JimengFavoriteItem => !!x);
    const updatedAt =
      typeof body.updatedAt === 'string' && body.updatedAt.trim()
        ? body.updatedAt.trim()
        : serverTs;
    const mode = body.mode === 'replace' || kind === 'snapshot' ? 'replace' : 'merge';
    const items =
      mode === 'replace' ? parsed : mergeItems(JimengHub.last.items, parsed);
    JimengHub.last = { updatedAt, items };

    if (kind === 'snapshot' || mode === 'replace') {
      const ev: JimengHubEvent = {
        kind: 'snapshot',
        updatedAt,
        items,
        seq: JimengHub.seq,
        serverTs,
      };
      JimengHub.push(ev);
      return ev;
    }

    const ev: JimengHubEvent = {
      kind: 'items_patch',
      updatedAt,
      items,
      source: body.source ? String(body.source) : undefined,
      capturedUrl: body.capturedUrl ? String(body.capturedUrl) : undefined,
      seq: JimengHub.seq,
      serverTs,
    };
    JimengHub.push(ev);
    return ev;
  }

  private static push(ev: JimengHubEvent): void {
    JimengHub.buffer.push(ev);
    if (JimengHub.buffer.length > MAX_BUFFER) {
      JimengHub.buffer.splice(0, JimengHub.buffer.length - MAX_BUFFER);
    }
    const line = `data: ${JSON.stringify(ev)}\n\n`;
    for (const res of JimengHub.clients) {
      try {
        res.write(line);
      } catch {
        JimengHub.clients.delete(res);
      }
    }
  }

  static subscribe(res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`: jimeng hub connected\n\n`);

    // Only push initial snapshot when hub has data — empty [] would wipe clients
    // that already hydrated from local cache / last.
    if (JimengHub.last.items.length > 0 || JimengHub.last.updatedAt) {
      JimengHub.seq += 1;
      const snap: JimengHubEvent = {
        kind: 'snapshot',
        updatedAt: JimengHub.last.updatedAt || new Date().toISOString(),
        items: JimengHub.last.items,
        seq: JimengHub.seq,
        serverTs: new Date().toISOString(),
      };
      res.write(`data: ${JSON.stringify(snap)}\n\n`);
    }

    JimengHub.clients.add(res);
    const cleanup = () => {
      JimengHub.clients.delete(res);
    };
    res.on('close', cleanup);
    res.on('error', cleanup);
  }
}
