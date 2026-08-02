/**
 * Types + defaults for settings pushed from tray. Runner never reads config files.
 */
import {
  BRAND_PRESET_PROD,
  brandColorForTone,
  brandToneFromColor,
  normalizeBrandColor,
  type BrandTone,
} from '@pkg-runner/tokens';

export type UiTheme = 'dark' | 'light';
export type ShellLayout = 'grid' | 'single';
export type { BrandTone };
export {
  BRAND_PRESET_PROD,
  brandColorForTone,
  brandToneFromColor,
  normalizeBrandColor,
};

export type SharedSettings = {
  screenshotHotkey: string;
  activateHotkey: string;
  editorHotkey: string;
  hotkeysEnabled: boolean;
  screenshotHistoryLimit: number;
  fontId: string;
  glassAlpha: number;
  theme: UiTheme;
  brandTone: BrandTone;
  brandColor: string;
  shellMosaicCols: number;
  shellLayout: ShellLayout;
  alwaysOnTop: boolean;
  persistLogs: boolean;
};

export const defaultSharedSettings = (): SharedSettings => ({
  screenshotHotkey: '',
  activateHotkey: '',
  editorHotkey: '',
  hotkeysEnabled: true,
  screenshotHistoryLimit: 10,
  fontId: 'jetbrains',
  glassAlpha: 100,
  theme: 'dark',
  brandTone: 'prod',
  brandColor: BRAND_PRESET_PROD,
  shellMosaicCols: 2,
  shellLayout: 'grid',
  alwaysOnTop: false,
  persistLogs: false,
});

export function coerceSharedSettings(raw: unknown): SharedSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<SharedSettings>;
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  const glassRaw = Number(p.glassAlpha);
  // brandTone = 运行环境色板（icon / data-env）；与 brandColor（accent）正交
  const tone: BrandTone =
    process.env.PKG_RUNNER_COLOR_ENV === 'test'
      ? 'test'
      : process.env.PKG_RUNNER_COLOR_ENV === 'prod'
        ? 'prod'
        : p.brandTone === 'test' || p.brandTone === 'prod'
          ? p.brandTone
          : 'prod';
  const brandColor = normalizeBrandColor(
    p.brandColor,
    brandColorForTone(tone),
  );
  return {
    screenshotHotkey: typeof p.screenshotHotkey === 'string' ? p.screenshotHotkey : '',
    activateHotkey: typeof p.activateHotkey === 'string' ? p.activateHotkey : '',
    editorHotkey: typeof p.editorHotkey === 'string' ? p.editorHotkey : '',
    hotkeysEnabled: typeof p.hotkeysEnabled === 'boolean' ? p.hotkeysEnabled : true,
    screenshotHistoryLimit: clamp(Number(p.screenshotHistoryLimit) || 10, 1, 100),
    fontId: typeof p.fontId === 'string' && p.fontId.trim() ? p.fontId.trim() : 'jetbrains',
    glassAlpha: clamp(Number.isFinite(glassRaw) ? glassRaw : 100, 10, 100),
    theme: p.theme === 'light' ? 'light' : 'dark',
    brandTone: tone,
    brandColor,
    shellMosaicCols: clamp(Number(p.shellMosaicCols) || 2, 1, 4),
    shellLayout: p.shellLayout === 'single' ? 'single' : 'grid',
    alwaysOnTop: Boolean(p.alwaysOnTop),
    persistLogs: Boolean(p.persistLogs),
  };
}
