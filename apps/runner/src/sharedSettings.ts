/**
 * Types + defaults for settings pushed from tray. Runner never reads config files.
 */
export type UiTheme = 'dark' | 'light';
export type ShellLayout = 'grid' | 'single';

export type SharedSettings = {
  screenshotHotkey: string;
  activateHotkey: string;
  editorHotkey: string;
  hotkeysEnabled: boolean;
  screenshotHistoryLimit: number;
  fontId: string;
  glassAlpha: number;
  theme: UiTheme;
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
  glassAlpha: 55,
  theme: 'dark',
  shellMosaicCols: 2,
  shellLayout: 'grid',
  alwaysOnTop: false,
  persistLogs: false,
});

export function coerceSharedSettings(raw: unknown): SharedSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<SharedSettings>;
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  return {
    screenshotHotkey: typeof p.screenshotHotkey === 'string' ? p.screenshotHotkey : '',
    activateHotkey: typeof p.activateHotkey === 'string' ? p.activateHotkey : '',
    editorHotkey: typeof p.editorHotkey === 'string' ? p.editorHotkey : '',
    hotkeysEnabled: typeof p.hotkeysEnabled === 'boolean' ? p.hotkeysEnabled : true,
    screenshotHistoryLimit: clamp(Number(p.screenshotHistoryLimit) || 10, 1, 100),
    fontId: typeof p.fontId === 'string' && p.fontId.trim() ? p.fontId.trim() : 'jetbrains',
    glassAlpha: clamp(Number(p.glassAlpha) || 55, 10, 100),
    theme: p.theme === 'light' ? 'light' : 'dark',
    shellMosaicCols: clamp(Number(p.shellMosaicCols) || 2, 1, 4),
    shellLayout: p.shellLayout === 'single' ? 'single' : 'grid',
    alwaysOnTop: Boolean(p.alwaysOnTop),
    persistLogs: Boolean(p.persistLogs),
  };
}
