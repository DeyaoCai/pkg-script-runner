/**
 * Quick smoke: EnumWindows via koffi (no Electron).
 * Run: node scripts/verify-snap-guides.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let koffi;
try {
  koffi = require('koffi');
} catch (err) {
  console.error('koffi require failed:', err);
  process.exit(1);
}

const user32 = koffi.load('user32.dll');
const RECT = koffi.struct('RECT', {
  left: 'long',
  top: 'long',
  right: 'long',
  bottom: 'long',
});
const EnumWindowsProc = koffi.proto(
  'bool __stdcall EnumWindowsProc(void *hwnd, int64 lParam)',
);
const EnumWindows = user32.func(
  'bool __stdcall EnumWindows(EnumWindowsProc *lpEnumFunc, int64 lParam)',
);
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(void *hWnd)');
const IsIconic = user32.func('bool __stdcall IsIconic(void *hWnd)');
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(void *hWnd, _Out_ RECT *lpRect)');
const GetWindowTextLengthW = user32.func('int __stdcall GetWindowTextLengthW(void *hWnd)');
const GetWindowTextW = user32.func(
  'int __stdcall GetWindowTextW(void *hWnd, _Out_ uint16_t *lpString, int nMaxCount)',
);
const GetWindowLongPtrW = user32.func('int64 __stdcall GetWindowLongPtrW(void *hWnd, int nIndex)');

const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x00000080;

const windows = [];
const cb = koffi.register((hwnd) => {
  if (!IsWindowVisible(hwnd) || IsIconic(hwnd)) return true;
  const ex = Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
  if ((ex & WS_EX_TOOLWINDOW) !== 0) return true;
  const r = {};
  if (!GetWindowRect(hwnd, r)) return true;
  const w = r.right - r.left;
  const h = r.bottom - r.top;
  if (w < 8 || h < 8) return true;
  let title = '';
  const len = GetWindowTextLengthW(hwnd);
  if (len > 0) {
    const buf = Buffer.alloc((len + 2) * 2);
    const n = GetWindowTextW(hwnd, buf, len + 1);
    if (n > 0) title = buf.toString('utf16le', 0, n * 2).replace(/\0+$/, '');
  }
  windows.push({ title: title || '(no title)', w, h, left: r.left, top: r.top });
  return true;
}, koffi.pointer(EnumWindowsProc));

try {
  EnumWindows(cb, 0);
} finally {
  koffi.unregister(cb);
}

console.log(`[verify-snap] root=${root}`);
console.log(`[verify-snap] visible top-level windows: ${windows.length}`);
for (const w of windows.slice(0, 15)) {
  console.log(`  - ${w.w}x${w.h} @${w.left},${w.top}  ${w.title}`);
}
if (windows.length < 2) {
  console.error('[verify-snap] FAIL: expected multiple windows');
  process.exit(2);
}
console.log('[verify-snap] OK');
