import { desktopCapturer, screen, nativeImage, type NativeImage } from 'electron';
import { createRequire } from 'node:module';

export type CapturedScreen = {
  image: NativeImage;
  /** DIP 逻辑像素 bounds（与 BrowserWindow.setBounds 一致） */
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  displayId: number;
};

const require = createRequire(import.meta.url);

/** Windows GDI 直截：比 desktopCapturer 快一截（单手热键体感关键） */
function captureViaGdi(bounds: {
  x: number;
  y: number;
  width: number;
  height: number;
}, scaleFactor: number): NativeImage | null {
  if (process.platform !== 'win32') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi') as typeof import('koffi');
    const user32 = koffi.load('user32.dll');
    const gdi32 = koffi.load('gdi32.dll');

    const GetDC = user32.func('void * __stdcall GetDC(void *hWnd)');
    const ReleaseDC = user32.func('int __stdcall ReleaseDC(void *hWnd, void *hDC)');
    const CreateCompatibleDC = gdi32.func('void * __stdcall CreateCompatibleDC(void *hdc)');
    const CreateCompatibleBitmap = gdi32.func(
      'void * __stdcall CreateCompatibleBitmap(void *hdc, int cx, int cy)',
    );
    const SelectObject = gdi32.func('void * __stdcall SelectObject(void *hdc, void *h)');
    const BitBlt = gdi32.func(
      'bool __stdcall BitBlt(void *hdc, int x, int y, int cx, int cy, void *hdcSrc, int x1, int y1, uint32_t rop)',
    );
    const DeleteObject = gdi32.func('bool __stdcall DeleteObject(void *ho)');
    const DeleteDC = gdi32.func('bool __stdcall DeleteDC(void *hdc)');
    const GetDIBits = gdi32.func(
      'int __stdcall GetDIBits(void *hdc, void *hbm, uint32_t start, uint32_t cLines, _Out_ void *lpvBits, _Inout_ void *lpbmi, uint32_t usage)',
    );

    const SRCCOPY = 0x00cc0020;
    const DIB_RGB_COLORS = 0;

    const physX = Math.round(bounds.x * scaleFactor);
    const physY = Math.round(bounds.y * scaleFactor);
    const physW = Math.max(1, Math.round(bounds.width * scaleFactor));
    const physH = Math.max(1, Math.round(bounds.height * scaleFactor));

    const screenDc = GetDC(null);
    if (!screenDc) return null;
    const memDc = CreateCompatibleDC(screenDc);
    const bmp = CreateCompatibleBitmap(screenDc, physW, physH);
    if (!memDc || !bmp) {
      if (bmp) DeleteObject(bmp);
      if (memDc) DeleteDC(memDc);
      ReleaseDC(null, screenDc);
      return null;
    }
    const old = SelectObject(memDc, bmp);
    const ok = BitBlt(memDc, 0, 0, physW, physH, screenDc, physX, physY, SRCCOPY);
    if (!ok) {
      SelectObject(memDc, old);
      DeleteObject(bmp);
      DeleteDC(memDc);
      ReleaseDC(null, screenDc);
      return null;
    }

    // BITMAPINFOHEADER (40) + optional color table; 用 BI_RGB 32bpp
    const bmi = Buffer.alloc(40 + 4);
    bmi.writeUInt32LE(40, 0); // biSize
    bmi.writeInt32LE(physW, 4);
    bmi.writeInt32LE(-physH, 8); // top-down
    bmi.writeUInt16LE(1, 12); // planes
    bmi.writeUInt16LE(32, 14); // bitCount
    bmi.writeUInt32LE(0, 16); // BI_RGB

    const stride = physW * 4;
    const pixels = Buffer.alloc(stride * physH);
    const got = GetDIBits(memDc, bmp, 0, physH, pixels, bmi, DIB_RGB_COLORS);

    SelectObject(memDc, old);
    DeleteObject(bmp);
    DeleteDC(memDc);
    ReleaseDC(null, screenDc);

    if (!got) return null;

    // Electron bitmap: BGRA, top-down — 与 GetDIBits 32bpp 一致
    return nativeImage.createFromBitmap(pixels, { width: physW, height: physH });
  } catch {
    return null;
  }
}

async function captureViaDesktopCapturer(bounds: {
  x: number;
  y: number;
  width: number;
  height: number;
}, scaleFactor: number, displayId: number): Promise<NativeImage> {
  const thumbW = Math.max(1, Math.round(bounds.width * scaleFactor));
  const thumbH = Math.max(1, Math.round(bounds.height * scaleFactor));

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: thumbW, height: thumbH },
    fetchWindowIcons: false,
  });

  const idStr = String(displayId);
  let source =
    sources.find((s) => s.display_id && String(s.display_id) === idStr) ||
    sources.find((s) => s.display_id === idStr);

  if (!source) source = sources[0];
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('无法截取屏幕');
  }
  return source.thumbnail;
}

function looksBlank(img: NativeImage): boolean {
  if (img.isEmpty()) return true;
  const { width, height } = img.getSize();
  if (width < 2 || height < 2) return true;
  try {
    const tiny = img.resize({ width: 8, height: 8 });
    const buf = tiny.toBitmap();
    let sum = 0;
    for (let i = 0; i + 2 < buf.length; i += 4) {
      sum += buf[i]! + buf[i + 1]! + buf[i + 2]!;
    }
    // 全黑/几乎全黑 → 视为失败（部分环境 GDI 会出黑图）
    return sum < 64;
  } catch {
    return true;
  }
}

/** 截取鼠标所在显示器整屏 */
export async function captureMouseDisplay(): Promise<CapturedScreen> {
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const { bounds, scaleFactor, id } = display;

  const gdi = captureViaGdi(bounds, scaleFactor);
  if (gdi && !looksBlank(gdi)) {
    return {
      image: gdi,
      bounds: { ...bounds },
      scaleFactor,
      displayId: id,
    };
  }

  const image = await captureViaDesktopCapturer(bounds, scaleFactor, id);
  return {
    image,
    bounds: { ...bounds },
    scaleFactor,
    displayId: id,
  };
}
