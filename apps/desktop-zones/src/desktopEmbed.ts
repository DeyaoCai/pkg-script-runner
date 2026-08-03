/**
 * Attach an HWND to the Windows desktop layer (not Topmost).
 * Survives Win+D; normal apps still draw above it.
 *
 * Win10/11 桌面树常见形态（发 0x052C 之后）：
 * - 某个 WorkerW 内有 SHELLDLL_DefView（图标层）← 交互面板应挂这里
 * - 另一个 WorkerW 在其后（壁纸层）
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export type DesktopEmbedMode = 'float' | 'progman' | 'workerw';

export type DesktopEmbedResult = {
  ok: boolean;
  mode: DesktopEmbedMode;
  detail: string;
  parentOk?: boolean;
};

export type PhysicalRect = { x: number; y: number; width: number; height: number };

const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;
const WS_CHILD = 0x40000000;
const WS_POPUP = 0x80000000;
const WS_CAPTION = 0x00c00000;
const WS_THICKFRAME = 0x00040000;
const WS_EX_APPWINDOW = 0x00040000;
const WS_EX_TOOLWINDOW = 0x00000080;
const SWP_SHOWWINDOW = 0x0040;
const SWP_NOACTIVATE = 0x0010;
const SWP_FRAMECHANGED = 0x0020;
const HWND_TOP = 0;
const HWND_BOTTOM = 1;

type Apis = {
  koffi: typeof import('koffi');
  FindWindowW: (cls: string | null, name: string | null) => unknown;
  FindWindowExW: (
    parent: unknown,
    childAfter: unknown,
    cls: string | null,
    name: string | null,
  ) => unknown;
  SendMessageTimeoutW: (
    hwnd: unknown,
    msg: number,
    wParam: number,
    lParam: number,
    flags: number,
    timeout: number,
    result: Buffer,
  ) => number;
  EnumWindows: (cb: unknown, lParam: number | bigint) => boolean;
  SetParent: (child: unknown, parent: unknown) => unknown;
  GetParent: (hwnd: unknown) => unknown;
  ShowWindow: (hwnd: unknown, cmd: number) => boolean;
  SetWindowPos: (
    hwnd: unknown,
    insertAfter: unknown,
    x: number,
    y: number,
    cx: number,
    cy: number,
    flags: number,
  ) => boolean;
  GetWindowLongPtrW: (hwnd: unknown, index: number) => bigint | number;
  SetWindowLongPtrW: (hwnd: unknown, index: number, value: bigint | number) => bigint | number;
  GetClientRect: (hwnd: unknown, out: Buffer) => boolean;
  GetWindowRect: (hwnd: unknown, out: Buffer) => boolean;
  IsWindowVisible: (hwnd: unknown) => boolean;
  IsIconic: (hwnd: unknown) => boolean;
  EnumWindowsProc: object;
};

let cached: Apis | null = null;

function loadApis(): Apis | null {
  if (cached) return cached;
  if (process.platform !== 'win32') return null;

  const koffi = require('koffi') as typeof import('koffi');
  const user32 = koffi.load('user32.dll');
  const EnumWindowsProc = koffi.proto(
    'bool __stdcall EnumWindowsProc(void *hwnd, int64 lParam)',
  );

  cached = {
    koffi,
    FindWindowW: user32.func('void * __stdcall FindWindowW(str16 lpClassName, str16 lpWindowName)'),
    FindWindowExW: user32.func(
      'void * __stdcall FindWindowExW(void *hWndParent, void *hWndChildAfter, str16 lpszClass, str16 lpszWindow)',
    ),
    SendMessageTimeoutW: user32.func(
      'intptr_t __stdcall SendMessageTimeoutW(void *hWnd, uint Msg, uintptr_t wParam, intptr_t lParam, uint fuFlags, uint uTimeout, _Out_ void *lpdwResult)',
    ),
    EnumWindows: user32.func(
      'bool __stdcall EnumWindows(EnumWindowsProc *lpEnumFunc, int64 lParam)',
    ),
    SetParent: user32.func('void * __stdcall SetParent(void *hWndChild, void *hWndNewParent)'),
    GetParent: user32.func('void * __stdcall GetParent(void *hWnd)'),
    ShowWindow: user32.func('bool __stdcall ShowWindow(void *hWnd, int nCmdShow)'),
    SetWindowPos: user32.func(
      'bool __stdcall SetWindowPos(void *hWnd, void *hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags)',
    ),
    GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(void *hWnd, int nIndex)'),
    SetWindowLongPtrW: user32.func(
      'intptr_t __stdcall SetWindowLongPtrW(void *hWnd, int nIndex, intptr_t dwNewLong)',
    ),
    GetClientRect: user32.func('bool __stdcall GetClientRect(void *hWnd, _Out_ void *lpRect)'),
    GetWindowRect: user32.func('bool __stdcall GetWindowRect(void *hWnd, _Out_ void *lpRect)'),
    IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(void *hWnd)'),
    IsIconic: user32.func('bool __stdcall IsIconic(void *hWnd)'),
    EnumWindowsProc,
  };
  return cached;
}

export function hwndFromElectronBuffer(buf: Buffer): bigint | number {
  if (buf.length >= 8) return buf.readBigUInt64LE(0);
  return buf.readUInt32LE(0);
}

function toNum(v: unknown): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(v);
  return 0n;
}

function sameHwnd(a: unknown, b: unknown): boolean {
  return toNum(a) !== 0n && toNum(a) === toNum(b);
}

function spawnDesktopWorkerWs(apis: Apis): void {
  const progman = apis.FindWindowW('Progman', null);
  if (!progman) return;
  const out = Buffer.alloc(8);
  const SMTO_NORMAL = 0;
  // Classic
  apis.SendMessageTimeoutW(progman, 0x052c, 0, 0, SMTO_NORMAL, 1000, out);
  // Win11 22H2+ variants
  apis.SendMessageTimeoutW(progman, 0x052c, 0xd, 0, SMTO_NORMAL, 1000, out);
  apis.SendMessageTimeoutW(progman, 0x052c, 0xd, 1, SMTO_NORMAL, 1000, out);
}

/** WorkerW that hosts SHELLDLL_DefView（图标层宿主） */
function findIconLayerWorkerW(apis: Apis): unknown {
  const { koffi, EnumWindowsProc } = apis;
  let host: unknown = null;

  const cb = koffi.register((hwnd: unknown) => {
    const shellView = apis.FindWindowExW(hwnd, null, 'SHELLDLL_DefView', null);
    if (shellView) {
      host = hwnd;
      return false; // stop
    }
    return true;
  }, koffi.pointer(EnumWindowsProc as never));

  try {
    apis.EnumWindows(cb, 0);
  } finally {
    koffi.unregister(cb);
  }

  return host;
}

/** Wallpaper WorkerW：图标宿主之后的下一个 WorkerW */
function findWallpaperWorkerW(apis: Apis): unknown {
  const iconHost = findIconLayerWorkerW(apis);
  if (!iconHost) return null;
  return apis.FindWindowExW(null, iconHost, 'WorkerW', null);
}

function readRect(
  apis: Apis,
  hwnd: unknown,
  kind: 'client' | 'window',
): { left: number; top: number; right: number; bottom: number } | null {
  const buf = Buffer.alloc(16);
  const ok = kind === 'client' ? apis.GetClientRect(hwnd, buf) : apis.GetWindowRect(hwnd, buf);
  if (!ok) return null;
  return {
    left: buf.readInt32LE(0),
    top: buf.readInt32LE(4),
    right: buf.readInt32LE(8),
    bottom: buf.readInt32LE(12),
  };
}

function readClientSize(apis: Apis, hwnd: unknown): { w: number; h: number } | null {
  const r = readRect(apis, hwnd, 'client');
  if (!r) return null;
  return { w: r.right - r.left, h: r.bottom - r.top };
}

function applyChildStyles(apis: Apis, hwnd: unknown): void {
  let style = Number(apis.GetWindowLongPtrW(hwnd, GWL_STYLE));
  style |= WS_CHILD;
  style &= ~WS_POPUP;
  style &= ~WS_CAPTION;
  style &= ~WS_THICKFRAME;
  apis.SetWindowLongPtrW(hwnd, GWL_STYLE, style);

  let ex = Number(apis.GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
  ex &= ~WS_EX_APPWINDOW;
  ex |= WS_EX_TOOLWINDOW;
  apis.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex);
}

function applyTopLevelStyles(apis: Apis, hwnd: unknown): void {
  let style = Number(apis.GetWindowLongPtrW(hwnd, GWL_STYLE));
  style &= ~WS_CHILD;
  style |= WS_POPUP;
  apis.SetWindowLongPtrW(hwnd, GWL_STYLE, style);

  let ex = Number(apis.GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
  ex |= WS_EX_APPWINDOW;
  ex &= ~WS_EX_TOOLWINDOW;
  apis.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex);
}

function layoutChild(
  apis: Apis,
  child: unknown,
  parent: unknown,
  screenPx: PhysicalRect | undefined,
  zInsertAfter: unknown,
): { x: number; y: number; w: number; h: number } {
  let w = screenPx?.width ?? 0;
  let h = screenPx?.height ?? 0;
  if (!w || !h) {
    const parentSize = readClientSize(apis, parent);
    w = parentSize?.w ?? 800;
    h = parentSize?.h ?? 600;
  }

  // 嵌到桌面后坐标相对父窗；双屏用该显示器在虚拟桌面上的物理偏移
  let x = 0;
  let y = 0;
  if (screenPx) {
    const parentWin = readRect(apis, parent, 'window');
    if (parentWin) {
      x = screenPx.x - parentWin.left;
      y = screenPx.y - parentWin.top;
    } else {
      x = screenPx.x;
      y = screenPx.y;
    }
  }

  apis.SetWindowPos(
    child,
    zInsertAfter,
    x,
    y,
    w,
    h,
    SWP_SHOWWINDOW | SWP_NOACTIVATE | SWP_FRAMECHANGED,
  );
  apis.ShowWindow(child, 5);
  return { x, y, w, h };
}

/**
 * - float: 顶层普通窗（Win+D 会收起，这是正常的）
 * - progman: 挂到图标层 WorkerW，并置于 DefView 之上 → Win+D 后仍在
 * - workerw: 挂壁纸层（在图标下，多半像“没了”）
 */
export function attachToDesktop(
  hwndBuf: Buffer,
  mode: DesktopEmbedMode = 'float',
  screenPx?: PhysicalRect,
): DesktopEmbedResult {
  const apis = loadApis();
  if (!apis) {
    return { ok: false, mode, detail: '仅支持 Windows' };
  }

  const child = hwndFromElectronBuffer(hwndBuf);

  if (mode === 'float') {
    apis.SetParent(child, null);
    applyTopLevelStyles(apis, child);
    const x = screenPx?.x ?? 0;
    const y = screenPx?.y ?? 0;
    const w = screenPx?.width ?? 800;
    const h = screenPx?.height ?? 600;
    apis.SetWindowPos(
      child,
      HWND_BOTTOM,
      x,
      y,
      w,
      h,
      SWP_SHOWWINDOW | SWP_NOACTIVATE | SWP_FRAMECHANGED,
    );
    apis.ShowWindow(child, 5);
    return {
      ok: true,
      mode,
      detail: `float（Win+D 会收起） ${w}x${h}`,
      parentOk: true,
    };
  }

  spawnDesktopWorkerWs(apis);

  let parent: unknown = null;
  let zAfter: unknown = HWND_TOP;

  if (mode === 'progman') {
    // 挂图标层宿主，Z 序置顶（盖住图标，保证 Win+D 后看得见）
    parent = findIconLayerWorkerW(apis);
    if (!parent) {
      parent = apis.FindWindowW('Progman', null);
    }
    if (!parent) {
      return { ok: false, mode, detail: '找不到桌面图标层 WorkerW/Progman' };
    }
    zAfter = HWND_TOP;
  } else {
    parent = findWallpaperWorkerW(apis);
    if (!parent) {
      return { ok: false, mode, detail: '找不到壁纸 WorkerW' };
    }
    zAfter = HWND_TOP;
  }

  applyChildStyles(apis, child);
  apis.SetParent(child, parent);
  // SetParent 后再刷一次 child 样式
  applyChildStyles(apis, child);

  const laid = layoutChild(apis, child, parent, screenPx, zAfter);

  const actualParent = apis.GetParent(child);
  const parentOk = sameHwnd(actualParent, parent);
  const after = readClientSize(apis, child);

  return {
    ok: parentOk && (after?.w ?? 0) > 0,
    mode,
    parentOk,
    detail: parentOk
      ? `已挂桌面层(${mode}) @${laid.x},${laid.y} size=${after?.w ?? '?'}x${after?.h ?? '?'} set=${laid.w}x${laid.h}`
      : `SetParent 未生效 parent=${String(actualParent)} expected=${String(parent)}`,
  };
}

/**
 * 仅在窗口真被最小化/隐藏时拉回。
 * 正常可见时绝不 ShowWindow / SetWindowPos，否则会周期性闪烁。
 */
export function forceShowDesktopChild(hwndBuf: Buffer): boolean {
  const apis = loadApis();
  if (!apis) return false;
  const child = hwndFromElectronBuffer(hwndBuf);
  const hidden = !apis.IsWindowVisible(child) || apis.IsIconic(child);
  if (!hidden) return false;
  apis.ShowWindow(child, 8); // SW_SHOWNA
  // 只恢复显示，不改 Z 序 / 尺寸，避免闪
  apis.SetWindowPos(
    child,
    HWND_TOP,
    0,
    0,
    0,
    0,
    0x0001 | 0x0002 | 0x0004 | SWP_SHOWWINDOW | SWP_NOACTIVATE, // NOSIZE|NOMOVE|NOZORDER
  );
  return true;
}
