import { createRequire } from 'node:module';
import { screen } from 'electron';

const require = createRequire(import.meta.url);

export type SnapGuides = {
  /** 相对当前显示器左上角的 X 吸附线（DIP / CSS px） */
  xs: number[];
  /** 相对当前显示器左上角的 Y 吸附线（DIP / CSS px） */
  ys: number[];
};

type DipRect = { x: number; y: number; width: number; height: number };

function uniqSorted(nums: number[], eps = 0.5): number[] {
  const sorted = [...nums].sort((a, b) => a - b);
  const out: number[] = [];
  for (const n of sorted) {
    if (!Number.isFinite(n)) continue;
    if (out.length && Math.abs(out[out.length - 1]! - n) <= eps) continue;
    out.push(n);
  }
  return out;
}

function intersects(a: DipRect, b: DipRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

type Rect = { left: number; top: number; right: number; bottom: number };

type WinApis = {
  enumTopLevel: (visit: (hwnd: unknown) => void) => void;
  IsWindowVisible: (hwnd: unknown) => boolean;
  IsIconic: (hwnd: unknown) => boolean;
  getBounds: (hwnd: unknown) => Rect | null;
  GetWindowLongPtrW: (hwnd: unknown, index: number) => number | bigint;
  GetWindowTextLengthW: (hwnd: unknown) => number;
  readTitle: (hwnd: unknown) => string;
  isCloaked: (hwnd: unknown) => boolean;
};

let apis: WinApis | null | undefined;

function loadWinApis(): WinApis | null {
  if (apis !== undefined) return apis;
  if (process.platform !== 'win32') {
    apis = null;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi') as typeof import('koffi');
    const user32 = koffi.load('user32.dll');

    const RECT = koffi.struct('RECT', {
      left: 'long',
      top: 'long',
      right: 'long',
      bottom: 'long',
    });

    // Win64: LPARAM / LONG_PTR 用 int64；勿用 ssize_t（部分 koffi 版本不认）
    const EnumWindowsProc = koffi.proto(
      'bool __stdcall EnumWindowsProc(void *hwnd, int64 lParam)',
    );
    const EnumWindows = user32.func(
      'bool __stdcall EnumWindows(EnumWindowsProc *lpEnumFunc, int64 lParam)',
    );
    const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(void *hWnd)');
    const IsIconic = user32.func('bool __stdcall IsIconic(void *hWnd)');
    const GetWindowRect = user32.func('bool __stdcall GetWindowRect(void *hWnd, _Out_ RECT *lpRect)');
    const GetWindowLongPtrW = user32.func(
      'int64 __stdcall GetWindowLongPtrW(void *hWnd, int nIndex)',
    );
    const GetWindowTextLengthW = user32.func('int __stdcall GetWindowTextLengthW(void *hWnd)');
    const GetWindowTextW = user32.func(
      'int __stdcall GetWindowTextW(void *hWnd, _Out_ uint16_t *lpString, int nMaxCount)',
    );

    let DwmGetWindowAttribute:
      | ((hwnd: unknown, attr: number, out: Buffer, size: number) => number)
      | undefined;
    try {
      const dwmapi = koffi.load('dwmapi.dll');
      DwmGetWindowAttribute = dwmapi.func(
        'long __stdcall DwmGetWindowAttribute(void *hwnd, uint32_t dwAttribute, _Out_ void *pvAttribute, uint32_t cbAttribute)',
      );
    } catch {
      DwmGetWindowAttribute = undefined;
    }

    const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
    const DWMWA_CLOAKED = 14;

    apis = {
      enumTopLevel: (visit) => {
        const cb = koffi.register((hwnd: unknown, _lParam: number) => {
          visit(hwnd);
          return true;
        }, koffi.pointer(EnumWindowsProc));
        try {
          EnumWindows(cb, 0);
        } finally {
          koffi.unregister(cb);
        }
      },
      IsWindowVisible,
      IsIconic,
      getBounds: (hwnd) => {
        // Prefer visible frame (excludes DWM drop shadow)
        if (DwmGetWindowAttribute) {
          const buf = Buffer.alloc(16);
          const hr = DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, buf, 16);
          if (hr === 0) {
            const r = {
              left: buf.readInt32LE(0),
              top: buf.readInt32LE(4),
              right: buf.readInt32LE(8),
              bottom: buf.readInt32LE(12),
            };
            if (r.right > r.left && r.bottom > r.top) return r;
          }
        }
        const r = { left: 0, top: 0, right: 0, bottom: 0 };
        if (!GetWindowRect(hwnd, r)) return null;
        if (r.right <= r.left || r.bottom <= r.top) return null;
        return r;
      },
      GetWindowLongPtrW,
      GetWindowTextLengthW,
      readTitle: (hwnd) => {
        try {
          const len = GetWindowTextLengthW(hwnd);
          if (len <= 0) return '';
          const buf = Buffer.alloc((len + 2) * 2);
          const n = GetWindowTextW(hwnd, buf, len + 1);
          if (n <= 0) return '';
          return buf.toString('utf16le', 0, n * 2).replace(/\0+$/, '');
        } catch {
          return '';
        }
      },
      isCloaked: (hwnd) => {
        if (!DwmGetWindowAttribute) return false;
        try {
          const out = Buffer.alloc(4);
          const hr = DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, out, 4);
          if (hr !== 0) return false;
          return out.readUInt32LE(0) !== 0;
        } catch {
          return false;
        }
      },
    };
    return apis;
  } catch (err) {
    console.warn('[pkg-runner] window snap guides unavailable:', err);
    apis = null;
    return null;
  }
}

const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x00000080;

function shouldSkipTitle(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  // 排除本应用窗口，避免吸附到自己
  if (/^Pkg Runner$/i.test(t)) return true;
  if (t === '截屏') return true;
  return false;
}

/**
 * 枚举当前显示器上可见顶层窗口的边，作为吸附线（相对 display 左上角 DIP）。
 * 非 Windows 或枚举失败时仅返回屏幕四边。
 */
export function getWindowSnapGuides(displayBounds: DipRect): SnapGuides {
  const wins = listCaptureWindows(displayBounds);
  const xs: number[] = [0, displayBounds.width];
  const ys: number[] = [0, displayBounds.height];
  for (const w of wins) {
    xs.push(w.x, w.x + w.w);
    ys.push(w.y, w.y + w.h);
  }
  return {
    xs: uniqSorted(xs.map((v) => Math.max(0, Math.min(displayBounds.width, v)))),
    ys: uniqSorted(ys.map((v) => Math.max(0, Math.min(displayBounds.height, v)))),
  };
}

export type CaptureWindow = {
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

/** 当前显示器上可点选截取的顶层窗口（相对 display 左上角 DIP） */
export function listCaptureWindows(displayBounds: DipRect): CaptureWindow[] {
  const api = loadWinApis();
  if (!api) return [];

  const out: CaptureWindow[] = [];
  const display = displayBounds;

  try {
    api.enumTopLevel((hwnd) => {
      try {
        if (!api.IsWindowVisible(hwnd) || api.IsIconic(hwnd)) return;
        if (api.isCloaked(hwnd)) return;

        const ex = Number(api.GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
        if ((ex & WS_EX_TOOLWINDOW) !== 0) return;

        const title = api.readTitle(hwnd);
        if (shouldSkipTitle(title)) return;
        if (!title.trim()) return;

        const raw = api.getBounds(hwnd);
        if (!raw) return;
        const physW = raw.right - raw.left;
        const physH = raw.bottom - raw.top;
        if (physW < 32 || physH < 32) return;

        const tl = screen.screenToDipPoint({ x: raw.left, y: raw.top });
        const br = screen.screenToDipPoint({ x: raw.right, y: raw.bottom });
        const winDip: DipRect = {
          x: tl.x,
          y: tl.y,
          width: Math.max(0, br.x - tl.x),
          height: Math.max(0, br.y - tl.y),
        };
        if (winDip.width < 24 || winDip.height < 24) return;
        if (!intersects(winDip, display)) return;

        const x = winDip.x - display.x;
        const y = winDip.y - display.y;
        out.push({
          title: title.trim().slice(0, 80),
          x: Math.max(0, x),
          y: Math.max(0, y),
          w: Math.min(display.width - Math.max(0, x), winDip.width),
          h: Math.min(display.height - Math.max(0, y), winDip.height),
        });
      } catch {
        /* skip */
      }
    });
  } catch (err) {
    console.warn('[pkg-runner] listCaptureWindows failed:', err);
    return [];
  }

  // 小窗口优先，便于点选被大窗盖住的边缘应用
  out.sort((a, b) => a.w * a.h - b.w * b.h);
  return out;
}
