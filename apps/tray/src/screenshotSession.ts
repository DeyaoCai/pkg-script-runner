import {
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  protocol,
  shell,
  type NativeImage,
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { captureMouseDisplay } from './screenshotCapture.js';
import { getWindowSnapGuides, listCaptureWindows, type SnapGuides } from './windowSnapGuides.js';
import {
  addScreenshotHistory,
  clearScreenshotHistory,
  exportScreenshotDocument,
  type ScreenshotExportFormat,
  getScreenshotImage,
  getScreenshotItem,
  listScreenshotHistory,
  removeScreenshotHistory,
} from './screenshotHistory.js';
import { BRAND_PRESET_PROD } from '@pkg-runner/tokens';

type SessionPayload = {
  fileUrl: string;
  width: number;
  height: number;
  snapGuides?: SnapGuides;
};

let shotWindow: BrowserWindow | null = null;
let sessionPayload: SessionPayload | null = null;
/** 当前捕获 PNG（内存，供 pkgss 协议） */
let sessionPng: Buffer | null = null;
/** 正在展示截屏（预热窗存在不算） */
let sessionActive = false;
let warmLoadPromise: Promise<void> | null = null;
let protocolRegistered = false;
let ipcReady = false;
let getHistoryLimit: () => number = () => 10;
let getDrawColor: () => string = () => BRAND_PRESET_PROD;
let setDrawColorPref: (hex: string) => string = (hex) => hex;
/** 截屏结束时回调（如恢复主窗） */
let onSessionEnd: (() => void) | null = null;
/** 等渲染进程画好首帧再 show，避免黑屏闪一下 */
let contentReadyWaiter: {
  resolve: () => void;
  promise: Promise<void>;
} | null = null;

function armContentReadyWaiter(): Promise<void> {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  contentReadyWaiter = { resolve, promise };
  return promise;
}

function signalContentReady(): void {
  const w = contentReadyWaiter;
  contentReadyWaiter = null;
  w?.resolve();
}

function clearContentReadyWaiter(): void {
  const w = contentReadyWaiter;
  contentReadyWaiter = null;
  w?.resolve();
}

/** 须在 app ready 前调用 */
export function registerScreenshotScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'pkgss',
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

function ensureScreenshotProtocol(): void {
  if (protocolRegistered) return;
  protocolRegistered = true;
  protocol.handle('pkgss', () => {
    if (!sessionPng?.length) {
      return new Response('Gone', { status: 404 });
    }
    const isJpeg = sessionPng[0] === 0xff && sessionPng[1] === 0xd8;
    return new Response(sessionPng, {
      headers: {
        'content-type': isJpeg ? 'image/jpeg' : 'image/png',
        'cache-control': 'no-store',
      },
    });
  });
}

function buildCaptionText(captions: string[]): string {
  return captions
    .map((c, i) => `${i + 1}. ${(c || '').trim()}`)
    .filter((line) => !/^\d+\.\s*$/.test(line))
    .join('\n');
}

function unlinkQuiet(p: string | null | undefined): void {
  if (!p) return;
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
}

export function writeScreenshotClipboard(image: NativeImage, text: string): void {
  try {
    if (text.trim()) {
      clipboard.write({ image, text });
    } else {
      clipboard.writeImage(image);
    }
  } catch {
    try {
      clipboard.writeImage(image);
    } catch {
      /* ignore — 部分环境剪贴板会卡住/失败，不能阻断保存 */
    }
  }
}

function clearSessionData(): void {
  sessionActive = false;
  sessionPayload = null;
  sessionPng = null;
  clearContentReadyWaiter();
}

function takeSessionEnd(): (() => void) | null {
  const end = onSessionEnd;
  onSessionEnd = null;
  return end;
}

/** 结束会话：隐藏预热窗，不销毁 */
export async function closeScreenshotSession(opts?: {
  /** 取消时渐隐（默认关，避免 Esc「关不掉」） */
  fade?: boolean;
}): Promise<void> {
  const win = shotWindow;
  // 取消/完成优先立刻收起；渐隐可选，且短超时
  if (opts?.fade && win && !win.isDestroyed() && win.isVisible()) {
    try {
      win.webContents.send('ss:dismissing');
    } catch {
      /* ignore */
    }
    const steps = 4;
    for (let i = 1; i <= steps; i++) {
      if (win.isDestroyed()) break;
      try {
        win.setOpacity(Math.max(0, 1 - i / steps));
      } catch {
        break;
      }
      await new Promise<void>((r) => setTimeout(r, 12));
    }
  }

  clearSessionData();
  if (win && !win.isDestroyed()) {
    try {
      win.webContents.send('ss:session-clear');
    } catch {
      /* ignore */
    }
    try {
      win.setAlwaysOnTop(false);
    } catch {
      /* ignore */
    }
    win.hide();
    try {
      win.setOpacity(1);
    } catch {
      /* ignore */
    }
  }
  const end = takeSessionEnd();
  try {
    end?.();
  } catch {
    /* ignore */
  }
}

/** 应用退出时销毁预热窗 */
export function destroyScreenshotSession(): void {
  onSessionEnd = null;
  clearSessionData();
  warmLoadPromise = null;
  if (shotWindow && !shotWindow.isDestroyed()) {
    shotWindow.destroy();
  }
  shotWindow = null;
}

async function ensureWarmWindow(opts: {
  appRoot: string;
  preloadPath: string;
}): Promise<BrowserWindow> {
  ensureScreenshotProtocol();

  if (shotWindow && !shotWindow.isDestroyed()) {
    if (warmLoadPromise) await warmLoadPromise;
    return shotWindow;
  }

  shotWindow = new BrowserWindow({
    x: -20000,
    y: -20000,
    width: 160,
    height: 120,
    frame: false,
    transparent: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#000000',
    show: false,
    webPreferences: {
      preload: opts.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
    },
  });

  shotWindow.setAlwaysOnTop(true, 'screen-saver');
  shotWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  shotWindow.on('closed', () => {
    shotWindow = null;
    warmLoadPromise = null;
    clearSessionData();
    const end = takeSessionEnd();
    try {
      end?.();
    } catch {
      /* ignore */
    }
  });

  warmLoadPromise = shotWindow
    .loadFile(path.join(opts.appRoot, 'ui', 'screenshot.html'))
    .then(() => undefined);

  await warmLoadPromise;
  return shotWindow;
}

/** 空闲预热，不阻塞启动 */
export function warmScreenshotWindow(opts: {
  appRoot: string;
  preloadPath: string;
}): void {
  void ensureWarmWindow(opts).catch(() => {
    /* ignore */
  });
}

/** 热键唤起：立刻显示，不做渐显（单手体感） */
function showWindowNow(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  try {
    win.setOpacity(1);
  } catch {
    /* ignore */
  }
  win.show();
  win.focus();
  try {
    win.webContents.send('ss:appearing');
  } catch {
    /* ignore */
  }
}

export async function startScreenshotSession(opts: {
  appRoot: string;
  preloadPath: string;
  /** 截屏结束后调用一次（取消 / 完成 / 失败清理） */
  onSessionEnd?: () => void;
}): Promise<{ ok: boolean; error?: string }> {
  if (sessionActive && shotWindow && !shotWindow.isDestroyed()) {
    shotWindow.focus();
    return { ok: true };
  }

  onSessionEnd = opts.onSessionEnd ?? null;

  try {
    const warmP = ensureWarmWindow(opts);
    const captureP = captureMouseDisplay();
    const [win, captured] = await Promise.all([warmP, captureP]);

    const size = captured.image.getSize();
    // JPEG 编码比 PNG 快，仅作遮罩预览；最终裁剪仍由渲染进程出 PNG
    sessionPng = captured.image.toJPEG(82);
    const fileUrl = `pkgss://local/capture.jpg?t=${Date.now()}`;
    sessionPayload = {
      fileUrl,
      width: size.width,
      height: size.height,
    };
    sessionActive = true;

    if (win.isVisible()) win.hide();
    try {
      win.setOpacity(0);
    } catch {
      /* ignore */
    }
    win.setBounds({
      x: captured.bounds.x,
      y: captured.bounds.y,
      width: captured.bounds.width,
      height: captured.bounds.height,
    });

    const readyP = armContentReadyWaiter();
    win.webContents.send('ss:session-start', {
      fileUrl,
      width: size.width,
      height: size.height,
      drawColor: getDrawColor(),
    });

    // 窗口列表 / 吸附线放到显示之后算，不挡首帧
    void Promise.resolve().then(() => {
      if (!sessionActive || win.isDestroyed()) return;
      try {
        const windows = listCaptureWindows(captured.bounds);
        const snapGuides = getWindowSnapGuides(captured.bounds);
        if (sessionPayload) sessionPayload.snapGuides = snapGuides;
        win.webContents.send('ss:window-targets', windows);
        win.webContents.send('ss:snap-guides', snapGuides);
      } catch {
        /* ignore */
      }
    });

    await Promise.race([
      readyP,
      new Promise<void>((r) => setTimeout(r, 90)),
    ]);
    clearContentReadyWaiter();

    if (!sessionActive || win.isDestroyed()) {
      return { ok: false, error: '截屏已取消' };
    }
    showWindowNow(win);
    return { ok: true };
  } catch (err) {
    closeScreenshotSession();
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function registerScreenshotIpc(hooks: {
  onHistoryChanged: () => void;
  onCompleteLog: (msg: string) => void;
  getHistoryLimit: () => number;
  getDrawColor: () => string;
  setDrawColor: (hex: string) => string;
}): void {
  if (ipcReady) return;
  ipcReady = true;
  getHistoryLimit = hooks.getHistoryLimit;
  getDrawColor = hooks.getDrawColor;
  setDrawColorPref = hooks.setDrawColor;

  ipcMain.handle('ss:get-payload', () => {
    if (!sessionActive || !sessionPayload) return null;
    return {
      fileUrl: sessionPayload.fileUrl,
      width: sessionPayload.width,
      height: sessionPayload.height,
      drawColor: getDrawColor(),
      snapGuides: sessionPayload.snapGuides,
    };
  });

  ipcMain.handle('ss:get-draw-color', () => getDrawColor());

  ipcMain.handle('ss:set-draw-color', (_e, hex: unknown) => {
    return setDrawColorPref(typeof hex === 'string' ? hex : '');
  });

  ipcMain.handle('ss:cancel', async () => {
    await closeScreenshotSession({ fade: false });
  });

  ipcMain.on('ss:content-ready', () => {
    signalContentReady();
  });

  const finishWithPng = (pngRaw: Buffer | Uint8Array, captionsRaw: unknown) => {
    const png = Buffer.isBuffer(pngRaw) ? pngRaw : Buffer.from(pngRaw);
    const captions = Array.isArray(captionsRaw)
      ? captionsRaw.map((c) => String(c ?? ''))
      : [];
    const text = buildCaptionText(captions);
    // 先关遮罩给反馈，落盘 / 剪贴板放到下一拍
    closeScreenshotSession();
    setImmediate(() => {
      try {
        addScreenshotHistory({
          png,
          captions,
          limit: getHistoryLimit(),
        });
        hooks.onHistoryChanged();
        const image = nativeImage.createFromBuffer(png);
        writeScreenshotClipboard(image, text);
        hooks.onCompleteLog(
          `\n[截屏] 已保存到历史并复制图文（标记 ${captions.length}）\n`,
        );
      } catch (err) {
        hooks.onCompleteLog(
          `\n[截屏] 保存失败：${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    });
    return { ok: true as const };
  };

  ipcMain.handle(
    'ss:complete-png',
    (_e, png: unknown, captionsRaw: unknown) => {
      try {
        let buf: Buffer | null = null;
        if (Buffer.isBuffer(png)) buf = png;
        else if (png instanceof Uint8Array) buf = Buffer.from(png);
        else if (png && typeof png === 'object' && ArrayBuffer.isView(png)) {
          const v = png as ArrayBufferView;
          buf = Buffer.from(v.buffer, v.byteOffset, v.byteLength);
        }
        if (!buf?.length) return { ok: false, error: '无图片数据' };
        return finishWithPng(buf, captionsRaw);
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    'ss:complete-file',
    (_e, payload: { path?: string; captions?: string[] }) => {
      const filePath = typeof payload?.path === 'string' ? payload.path : '';
      try {
        if (!filePath || !fs.existsSync(filePath)) {
          return { ok: false, error: '临时图片不存在' };
        }
        const png = fs.readFileSync(filePath);
        if (!png.length) return { ok: false, error: '无图片数据' };
        return finishWithPng(png, payload?.captions);
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        unlinkQuiet(filePath);
      }
    },
  );

  ipcMain.handle('pkg:ss-history-list', () => listScreenshotHistory());

  ipcMain.handle('pkg:ss-history-remove', (_e, id: string) => {
    const ok = removeScreenshotHistory(String(id || ''));
    if (ok) hooks.onHistoryChanged();
    return ok;
  });

  ipcMain.handle('pkg:ss-history-clear', () => {
    const n = clearScreenshotHistory();
    hooks.onHistoryChanged();
    return n;
  });

  ipcMain.handle('pkg:ss-history-copy', (_e, id: string, which: 'image' | 'text' | 'both') => {
    const item = getScreenshotItem(String(id || ''));
    if (!item) return { ok: false, error: '记录不存在' };
    const image = getScreenshotImage(item.id);
    if (which === 'text') {
      clipboard.writeText(item.text || '');
      return { ok: true };
    }
    if (!image || image.isEmpty()) return { ok: false, error: '图片丢失' };
    if (which === 'image') {
      clipboard.writeImage(image);
      return { ok: true };
    }
    writeScreenshotClipboard(image, item.text || '');
    return { ok: true };
  });

  ipcMain.handle(
    'pkg:ss-history-export',
    async (e, payload: { ids?: unknown; format?: unknown }) => {
      const list = Array.isArray(payload?.ids)
        ? payload.ids.map((x) => String(x ?? '').trim()).filter(Boolean)
        : [];
      if (!list.length) return { ok: false, error: '请先勾选要导出的截屏' };

      const rawFmt = String(payload?.format || 'md').toLowerCase();
      const format: ScreenshotExportFormat = rawFmt === 'html' ? 'html' : 'md';

      const win = BrowserWindow.fromWebContents(e.sender);
      const stamp = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const stampStr = `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}`;
      const ext = format === 'html' ? 'html' : 'md';
      const label = format === 'html' ? '交互 HTML' : 'Markdown';
      const defaultName = `截屏记录-${stampStr}.${ext}`;

      const saveOpts: Electron.SaveDialogOptions = {
        title: `导出 ${label}`,
        defaultPath: defaultName,
        filters:
          format === 'html'
            ? [
                { name: 'HTML (.html)', extensions: ['html', 'htm'] },
                { name: '全部文件', extensions: ['*'] },
              ]
            : [
                { name: 'Markdown (.md)', extensions: ['md'] },
                { name: '全部文件', extensions: ['*'] },
              ],
      };
      const res = win
        ? await dialog.showSaveDialog(win, saveOpts)
        : await dialog.showSaveDialog(saveOpts);
      if (res.canceled || !res.filePath) return { ok: false, error: '已取消' };

      try {
        const out = await exportScreenshotDocument({
          ids: list,
          filePath: res.filePath,
          format,
        });
        if (out.ok && out.path) {
          hooks.onCompleteLog(
            `\n[截屏] 已导出 ${label}（${out.count} 条）\n[截屏] ${out.path}\n`,
          );
          try {
            shell.showItemInFolder(out.path);
          } catch {
            /* ignore */
          }
        }
        return out;
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
}

let boundStart: (() => Promise<{ ok: boolean; error?: string }>) | null = null;

export function bindScreenshotStarter(
  starter: () => Promise<{ ok: boolean; error?: string }>,
): void {
  boundStart = starter;
  ipcMain.removeHandler('pkg:ss-start');
  ipcMain.handle('pkg:ss-start', async () => {
    if (!boundStart) return { ok: false, error: '截屏未初始化' };
    return boundStart();
  });
}

export function isScreenshotOpen(): boolean {
  return sessionActive && !!(shotWindow && !shotWindow.isDestroyed());
}
