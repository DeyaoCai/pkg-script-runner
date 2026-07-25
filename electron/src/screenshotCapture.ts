import { desktopCapturer, screen, type NativeImage } from 'electron';

export type CapturedScreen = {
  image: NativeImage;
  /** DIP 逻辑像素 bounds（与 BrowserWindow.setBounds 一致） */
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  displayId: number;
};

/** 截取鼠标所在显示器整屏 */
export async function captureMouseDisplay(): Promise<CapturedScreen> {
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const { bounds, scaleFactor, id } = display;
  const thumbW = Math.max(1, Math.round(bounds.width * scaleFactor));
  const thumbH = Math.max(1, Math.round(bounds.height * scaleFactor));

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: thumbW, height: thumbH },
    fetchWindowIcons: false,
  });

  const idStr = String(id);
  let source =
    sources.find((s) => s.display_id && String(s.display_id) === idStr) ||
    sources.find((s) => s.display_id === idStr);

  // 单屏或匹配失败时取主源
  if (!source) {
    source = sources[0];
  }
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('无法截取屏幕');
  }

  return {
    image: source.thumbnail,
    bounds: { ...bounds },
    scaleFactor,
    displayId: id,
  };
}
