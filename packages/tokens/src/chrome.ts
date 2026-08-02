/**
 * Electron BrowserWindow.backgroundColor 等无法用 CSS color-mix，
 * 用与 tokens.css 铺底（--color-bg-base ≈ dark --neutral-850 / light --neutral-50）对齐的固定 hex。
 */
import type { BrandTone } from './brand.js';
import type { UiTheme } from './theme.js';

export type ChromeBgTable = Record<BrandTone, Record<UiTheme, string>>;

export const CHROME_BG: ChromeBgTable = {
  prod: { dark: '#1b1d21', light: '#f4f5f7' },
  test: { dark: '#3d1c0a', light: '#f7f0ea' },
};

export function chromeBackground(
  colorEnv: BrandTone,
  theme: UiTheme,
): string {
  const env = colorEnv === 'test' ? 'test' : 'prod';
  const t = theme === 'light' ? 'light' : 'dark';
  return CHROME_BG[env][t];
}
