import fs from 'node:fs';
import path from 'node:path';
import { app, nativeImage, type NativeImage } from 'electron';
import {
  DEFAULT_SCREENSHOT_HISTORY_LIMIT,
  normalizeScreenshotHistoryLimit,
} from './prefs.js';

export type ScreenshotHistoryItem = {
  id: string;
  createdAt: number;
  /** 标记点文案，按序号 1..n */
  captions: string[];
  /** 纯文本汇总 */
  text: string;
  imagePath: string;
  thumbPath: string;
};

export type ScreenshotHistoryListItem = {
  id: string;
  createdAt: number;
  text: string;
  captions: string[];
  /** data URL 小图，便于面板展示 */
  thumbDataUrl: string;
};

function rootDir(): string {
  // Keep history under legacy pkg-runner so existing captures remain visible after tray split.
  return path.join(app.getPath('appData'), 'pkg-runner', 'screenshot-history');
}

export function getScreenshotHistoryDir(): string {
  return rootDir();
}

export function ensureScreenshotHistoryDir(): string {
  ensureDirs();
  return rootDir();
}

function metaPath(): string {
  return path.join(rootDir(), 'meta.json');
}

function ensureDirs(): void {
  const root = rootDir();
  fs.mkdirSync(path.join(root, 'images'), { recursive: true });
  fs.mkdirSync(path.join(root, 'thumbs'), { recursive: true });
}

function resolveStoredPath(stored: string | undefined, fallbackRel: string): string {
  if (!stored) return path.join(rootDir(), fallbackRel);
  if (path.isAbsolute(stored)) return stored;
  return path.join(rootDir(), stored);
}

function resolveItemPaths(item: ScreenshotHistoryItem): ScreenshotHistoryItem {
  const id = item.id;
  return {
    ...item,
    imagePath: resolveStoredPath(item.imagePath, path.join('images', `${id}.png`)),
    thumbPath: resolveStoredPath(item.thumbPath, path.join('thumbs', `${id}.png`)),
  };
}

function loadMeta(): ScreenshotHistoryItem[] {
  try {
    const raw = fs.readFileSync(metaPath(), 'utf8');
    const parsed = JSON.parse(raw) as ScreenshotHistoryItem[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x) => x && typeof x.id === 'string')
      .map(resolveItemPaths);
  } catch {
    return [];
  }
}

function saveMeta(items: ScreenshotHistoryItem[]): void {
  ensureDirs();
  // 只存相对文件名，避免 userData 路径变动后失效
  const serializable = items.map((item) => ({
    id: item.id,
    createdAt: item.createdAt,
    captions: item.captions,
    text: item.text,
    imagePath: path.join('images', `${item.id}.png`),
    thumbPath: path.join('thumbs', `${item.id}.png`),
  }));
  fs.writeFileSync(metaPath(), JSON.stringify(serializable, null, 2), 'utf8');
}

function removeFiles(item: ScreenshotHistoryItem): void {
  for (const p of [item.imagePath, item.thumbPath]) {
    try {
      if (p && fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}

function buildText(captions: string[]): string {
  return captions
    .map((c, i) => `${i + 1}. ${(c || '').trim()}`)
    .filter((line) => !/^\d+\.\s*$/.test(line))
    .join('\n');
}

export function listScreenshotHistory(): ScreenshotHistoryListItem[] {
  ensureDirs();
  const items = loadMeta();
  const out: ScreenshotHistoryListItem[] = [];
  for (const item of items) {
    let thumbDataUrl = '';
    try {
      if (fs.existsSync(item.thumbPath)) {
        thumbDataUrl = nativeImage.createFromPath(item.thumbPath).toDataURL();
      } else if (fs.existsSync(item.imagePath)) {
        thumbDataUrl = nativeImage
          .createFromPath(item.imagePath)
          .resize({ width: 160, quality: 'better' })
          .toDataURL();
      }
    } catch {
      /* ignore */
    }
    out.push({
      id: item.id,
      createdAt: item.createdAt,
      text: item.text,
      captions: item.captions,
      thumbDataUrl,
    });
  }
  return out;
}

export function getScreenshotImage(id: string): NativeImage | null {
  const item = loadMeta().find((x) => x.id === id);
  if (!item || !fs.existsSync(item.imagePath)) return null;
  try {
    return nativeImage.createFromPath(item.imagePath);
  } catch {
    return null;
  }
}

export function getScreenshotItem(id: string): ScreenshotHistoryItem | null {
  return loadMeta().find((x) => x.id === id) ?? null;
}

export function addScreenshotHistory(opts: {
  png: Buffer;
  captions: string[];
  /** 最多保留条数；缺省用默认 10 */
  limit?: number;
}): ScreenshotHistoryItem {
  ensureDirs();
  const limit = normalizeScreenshotHistoryLimit(
    opts.limit ?? DEFAULT_SCREENSHOT_HISTORY_LIMIT,
  );
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const imagePath = path.join(rootDir(), 'images', `${id}.png`);
  const thumbPath = path.join(rootDir(), 'thumbs', `${id}.png`);
  fs.writeFileSync(imagePath, opts.png);

  const img = nativeImage.createFromBuffer(opts.png);
  const size = img.getSize();
  const tw = Math.min(240, size.width || 240);
  const thumb = img.resize({ width: tw, quality: 'good' });
  fs.writeFileSync(thumbPath, thumb.toPNG());

  const captions = opts.captions.map((c) => String(c ?? ''));
  const item: ScreenshotHistoryItem = {
    id,
    createdAt: Date.now(),
    captions,
    text: buildText(captions),
    imagePath,
    thumbPath,
  };

  const next = [item, ...loadMeta()];
  while (next.length > limit) {
    const old = next.pop();
    if (old) removeFiles(old);
  }
  saveMeta(next);
  return item;
}

/** 按上限裁掉多余旧记录，返回删除条数 */
export function trimScreenshotHistory(limit: number): number {
  const max = normalizeScreenshotHistoryLimit(limit);
  const items = loadMeta();
  if (items.length <= max) return 0;
  const keep = items.slice(0, max);
  const drop = items.slice(max);
  for (const old of drop) removeFiles(old);
  saveMeta(keep);
  return drop.length;
}

export function removeScreenshotHistory(id: string): boolean {
  const items = loadMeta();
  const idx = items.findIndex((x) => x.id === id);
  if (idx < 0) return false;
  const [hit] = items.splice(idx, 1);
  if (hit) removeFiles(hit);
  saveMeta(items);
  return true;
}

export function clearScreenshotHistory(): number {
  const items = loadMeta();
  for (const item of items) removeFiles(item);
  saveMeta([]);
  return items.length;
}

function formatStamp(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function captionLines(item: ScreenshotHistoryItem): string[] {
  const fromCaptions = (item.captions || [])
    .map((c) => String(c ?? '').trim())
    .filter(Boolean);
  if (fromCaptions.length) return fromCaptions;
  const fromText = String(item.text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);
  return fromText;
}

export type ScreenshotExportFormat = 'md' | 'html';

type ExportEntry = {
  id: string;
  createdAt: number;
  timeLabel: string;
  captions: string[];
  dataUrl: string;
  png: Buffer | null;
};

function collectExportEntries(idsRaw: string[]): {
  ok: true;
  entries: ExportEntry[];
} | { ok: false; error: string } {
  const ids = idsRaw.map((id) => String(id || '').trim()).filter(Boolean);
  if (!ids.length) return { ok: false, error: '未选择截屏' };
  const all = loadMeta();
  const byId = new Map(all.map((x) => [x.id, x]));
  const entries: ExportEntry[] = [];
  for (const id of ids) {
    const hit = byId.get(id);
    if (!hit) continue;
    let dataUrl = '';
    let png: Buffer | null = null;
    try {
      const candidates = [hit.imagePath, hit.thumbPath].filter(
        (p): p is string => typeof p === 'string' && !!p,
      );
      for (const p of candidates) {
        if (!fs.existsSync(p)) continue;
        png = fs.readFileSync(p);
        if (!png.length) continue;
        dataUrl = `data:image/png;base64,${png.toString('base64')}`;
        break;
      }
    } catch {
      /* ignore */
    }
    entries.push({
      id: hit.id,
      createdAt: hit.createdAt,
      timeLabel: formatStamp(hit.createdAt),
      captions: captionLines(hit),
      dataUrl,
      png,
    });
  }
  if (!entries.length) return { ok: false, error: '所选记录不存在' };
  return { ok: true, entries };
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildMarkdown(entries: ExportEntry[]): string {
  const lines: string[] = [
    '# 截屏记录',
    '',
    `> 由 Pkg Runner 导出 · ${formatStamp(Date.now())}`,
    '',
  ];
  entries.forEach((item, index) => {
    const n = index + 1;
    lines.push(`## ${n}. ${item.timeLabel}`);
    lines.push('');
    if (item.dataUrl) {
      lines.push(`![截屏 ${n}](${item.dataUrl})`);
      lines.push('');
    }
    if (item.captions.length) {
      for (const c of item.captions) lines.push(`- [ ] ${c}`);
    } else {
      lines.push(`- [ ] （无标记文案${item.dataUrl ? ' · 见附图' : ''}）`);
    }
    lines.push('');
  });
  return `${lines.join('\n').trimEnd()}\n`;
}

/** 可交互 HTML：勾选状态 sessionStorage；可导出/加载处理结果 JSON */
function buildInteractiveHtml(entries: ExportEntry[]): string {
  const itemIds = entries.map((e) => e.id);
  const storeKey = `pkg-ss-checklist:${itemIds.join('|')}`;
  const fingerprint = itemIds.join('|');

  const sections = entries
    .map((item, index) => {
      const n = index + 1;
      const caps =
        item.captions.length > 0
          ? item.captions
          : [`（无标记文案${item.dataUrl ? ' · 见附图' : ''}）`];
      const checks = caps
        .map((c, ci) => {
          const cid = `${item.id}:${ci}`;
          return `<label class="check"><input type="checkbox" data-id="${escapeHtml(cid)}" data-text="${escapeHtml(c)}" /><span>${escapeHtml(c)}</span></label>`;
        })
        .join('\n');
      const img = item.dataUrl
        ? `<img class="shot" src="${item.dataUrl}" alt="截屏 ${n}" />`
        : '';
      return `<section class="card" data-item="${escapeHtml(item.id)}">
  <h2>${n}. ${escapeHtml(item.timeLabel)}</h2>
  ${img}
  <div class="checks">${checks}</div>
</section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>截屏记录</title>
  <style>
    :root { color-scheme: light dark; --bg:#f4f5f7; --card:#fff; --text:#1f2328; --muted:#656d76; --line:#d0d7de; --accent:#0969da; --ok:#1a7f37; --err:#cf222e; }
    @media (prefers-color-scheme: dark) {
      :root { --bg:#0d1117; --card:#161b22; --text:#e6edf3; --muted:#8b949e; --line:#30363d; --accent:#2f81f7; --ok:#3fb950; --err:#f85149; }
    }
    * { box-sizing: border-box; }
    body { margin: 0; font: 14px/1.5 system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; background: var(--bg); color: var(--text); }
    main { max-width: 820px; margin: 0 auto; padding: 24px 16px 48px; }
    header { margin-bottom: 20px; }
    h1 { margin: 0 0 6px; font-size: 22px; }
    .meta { color: var(--muted); font-size: 12px; }
    .progress { margin-top: 10px; font-size: 13px; color: var(--muted); }
    .status { margin-top: 8px; font-size: 12px; color: var(--ok); min-height: 1.2em; }
    .status.is-error { color: var(--err); }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin: 14px 0; }
    h2 { margin: 0 0 12px; font-size: 16px; }
    .shot { display: block; max-width: 100%; height: auto; border-radius: 8px; border: 1px solid var(--line); margin-bottom: 12px; }
    .checks { display: grid; gap: 8px; }
    .check { display: flex; gap: 8px; align-items: flex-start; cursor: pointer; }
    .check input { margin-top: 3px; accent-color: var(--accent); }
    .check span { flex: 1; word-break: break-word; }
    .check:has(input:checked) span { color: var(--muted); text-decoration: line-through; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; align-items: center; }
    button, .file-btn { border: 1px solid var(--line); background: var(--card); color: var(--text); border-radius: 8px; padding: 6px 10px; cursor: pointer; font: inherit; display: inline-block; }
    button:hover, .file-btn:hover { border-color: var(--accent); }
    .file-btn input { display: none; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>截屏记录</h1>
      <div class="meta">由 Pkg Runner 导出 · ${escapeHtml(formatStamp(Date.now()))} · 勾选：本页 sessionStorage；「处理结果」JSON 仅状态、不含截图</div>
      <div class="progress" id="progress">进度 0 / 0</div>
      <div class="actions">
        <button type="button" id="checkAll">全部勾选</button>
        <button type="button" id="clearAll">清除勾选</button>
        <button type="button" id="exportJson" title="仅勾选状态，通常几 KB">导出处理结果</button>
        <label class="file-btn" title="加载勾选状态 JSON">加载处理结果<input type="file" id="importJson" accept="application/json,.json" /></label>
      </div>
      <div class="status" id="status"></div>
    </header>
    ${sections}
  </main>
  <script>
    (function () {
      var KEY = ${JSON.stringify(storeKey)};
      var FINGERPRINT = ${JSON.stringify(fingerprint)};
      var statusEl = document.getElementById("status");

      function setStatus(msg, isError) {
        if (!statusEl) return;
        statusEl.textContent = msg || "";
        statusEl.classList.toggle("is-error", !!isError);
      }

      function load() {
        try { return JSON.parse(sessionStorage.getItem(KEY) || "{}") || {}; }
        catch (e) { return {}; }
      }
      function save(state) {
        try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
      }

      var state = load();
      var boxes = Array.prototype.slice.call(document.querySelectorAll('input[type="checkbox"][data-id]'));

      function applyState(next) {
        state = next && typeof next === "object" ? next : {};
        boxes.forEach(function (box) {
          var id = box.getAttribute("data-id");
          box.checked = !!state[id];
        });
        save(state);
        syncProgress();
      }

      function syncProgress() {
        var total = boxes.length;
        var done = boxes.filter(function (b) { return b.checked; }).length;
        var el = document.getElementById("progress");
        if (el) el.textContent = "进度 " + done + " / " + total;
      }

      function buildResultPayload() {
        var checked = {};
        var done = 0;
        boxes.forEach(function (box) {
          var id = box.getAttribute("data-id");
          if (!id) return;
          var on = !!box.checked;
          checked[id] = on;
          if (on) done += 1;
        });
        return {
          v: 2,
          kind: "pkg-runner-screenshot-result",
          fingerprint: FINGERPRINT,
          exportedAt: new Date().toISOString(),
          progress: { done: done, total: boxes.length },
          checked: checked
        };
      }

      function parseResultPayload(raw) {
        var data = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (!data || typeof data !== "object") throw new Error("JSON 格式无效");
        if (data.kind && data.kind !== "pkg-runner-screenshot-result") {
          throw new Error("不是截屏处理结果文件");
        }
        if (data.fingerprint && data.fingerprint !== FINGERPRINT) {
          throw new Error("与当前页面条目不匹配（可能不是同一批截屏）");
        }
        var next = {};
        if (data.checked && typeof data.checked === "object") {
          Object.keys(data.checked).forEach(function (k) {
            next[k] = !!data.checked[k];
          });
        } else if (Array.isArray(data.items)) {
          data.items.forEach(function (it) {
            if (it && it.id) next[it.id] = !!it.checked;
          });
        } else {
          throw new Error("缺少 checked / items 字段");
        }
        return next;
      }

      boxes.forEach(function (box) {
        var id = box.getAttribute("data-id");
        if (state[id]) box.checked = true;
        box.addEventListener("change", function () {
          state[id] = !!box.checked;
          save(state);
          syncProgress();
          setStatus("");
        });
      });

      document.getElementById("checkAll").addEventListener("click", function () {
        boxes.forEach(function (b) { b.checked = true; state[b.getAttribute("data-id")] = true; });
        save(state); syncProgress(); setStatus("已全部勾选");
      });
      document.getElementById("clearAll").addEventListener("click", function () {
        boxes.forEach(function (b) { b.checked = false; state[b.getAttribute("data-id")] = false; });
        save(state); syncProgress(); setStatus("已清除勾选");
      });

      document.getElementById("exportJson").addEventListener("click", function () {
        try {
          var payload = buildResultPayload();
          var text = JSON.stringify(payload);
          var blob = new Blob([text], { type: "application/json" });
          var a = document.createElement("a");
          var stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
          a.href = URL.createObjectURL(blob);
          a.download = "截屏处理结果-" + stamp + ".json";
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
          var kb = (text.length / 1024).toFixed(1);
          setStatus("已导出处理结果（" + payload.progress.done + "/" + payload.progress.total + " · " + kb + " KB，无截图）");
        } catch (err) {
          setStatus(err && err.message ? err.message : String(err), true);
        }
      });

      document.getElementById("importJson").addEventListener("change", function (ev) {
        var file = ev.target.files && ev.target.files[0];
        ev.target.value = "";
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var next = parseResultPayload(String(reader.result || ""));
            applyState(next);
            var done = boxes.filter(function (b) { return b.checked; }).length;
            setStatus("已加载处理结果（" + done + "/" + boxes.length + "）· 来自 " + file.name);
          } catch (err) {
            setStatus(err && err.message ? err.message : String(err), true);
          }
        };
        reader.onerror = function () { setStatus("读取文件失败", true); };
        reader.readAsText(file, "utf-8");
      });

      syncProgress();
    })();
  </script>
</body>
</html>
`;
}

export type ScreenshotExportResult = {
  ok: boolean;
  error?: string;
  path?: string;
  count?: number;
  format?: ScreenshotExportFormat;
};

export async function exportScreenshotDocument(opts: {
  ids: string[];
  filePath: string;
  format: ScreenshotExportFormat;
}): Promise<ScreenshotExportResult> {
  const collected = collectExportEntries(opts.ids);
  if (!collected.ok) return { ok: false, error: collected.error };

  const format = opts.format;
  let filePath = path.resolve(opts.filePath);
  const ext = format === 'html' ? '.html' : '.md';
  if (!filePath.toLowerCase().endsWith(ext)) filePath = `${filePath}${ext}`;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  if (format === 'html') {
    fs.writeFileSync(filePath, buildInteractiveHtml(collected.entries), 'utf8');
  } else {
    fs.writeFileSync(filePath, buildMarkdown(collected.entries), 'utf8');
  }

  return { ok: true, path: filePath, count: collected.entries.length, format };
}

/** @deprecated 使用 exportScreenshotDocument({ format: 'md' }) */
export async function exportScreenshotMarkdown(opts: {
  ids: string[];
  mdPath: string;
}): Promise<{ ok: boolean; error?: string; mdPath?: string; count?: number }> {
  const res = await exportScreenshotDocument({
    ids: opts.ids,
    filePath: opts.mdPath,
    format: 'md',
  });
  return {
    ok: res.ok,
    error: res.error,
    mdPath: res.path,
    count: res.count,
  };
}

/** @deprecated */
export const exportScreenshotBugList = exportScreenshotMarkdown;

