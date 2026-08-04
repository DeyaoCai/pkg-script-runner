import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import {
  BRAND_PRESET_PROD,
  BRAND_PRESET_TEST,
  brandColorForTone,
  normalizeBrandColor,
} from '@pkg-runner/tokens';
import { pkgRunnerColorEnv } from '../../runner/src/appProfile.js';
import { diagLog } from './diagLog.js';

export {
  BRAND_PRESET_PROD,
  BRAND_PRESET_TEST,
  brandColorForTone,
  normalizeBrandColor,
};

export const DEFAULT_SCREENSHOT_HOTKEY = '';
export const DEFAULT_ACTIVATE_HOTKEY = '';
export const DEFAULT_EDITOR_HOTKEY = '';
export const DEFAULT_ZONES_HOTKEY = '';
export const DEFAULT_SETTINGS_HOTKEY = '';
export const DEFAULT_HISTORY_HOTKEY = '';
export const DEFAULT_SCREENSHOT_HISTORY_LIMIT = 10;
export const MIN_SCREENSHOT_HISTORY_LIMIT = 1;
export const MAX_SCREENSHOT_HISTORY_LIMIT = 100;
export const DEFAULT_SCREENSHOT_DRAW_COLOR = BRAND_PRESET_PROD;
/** Match tokens.css `--glass-alpha: 0.55` so wallpaper frost is visible by default. */
export const DEFAULT_GLASS_ALPHA = 55;
export const DEFAULT_GLASS_BLUR = 22;
export const MIN_GLASS_BLUR = 0;
export const MAX_GLASS_BLUR = 40;
export const DEFAULT_FONT_ID = 'jetbrains';
export const DEFAULT_THEME = 'dark' as const;
export const DEFAULT_SHELL_MOSAIC_COLS = 2;
export const MIN_SHELL_MOSAIC_COLS = 1;
export const MAX_SHELL_MOSAIC_COLS = 4;
export const DEFAULT_SHELL_LAYOUT = 'grid' as const;

export type UiTheme = 'dark' | 'light';
export type ShellLayout = 'grid' | 'single';
/** 主图色板：正式绿 / 测试棕橙（UI + 托盘/窗口 icon） */
export type BrandTone = 'prod' | 'test';

/** Shared across tray / runner / editor (everyone uses). */
export type SharedPrefs = {
  screenshotHotkey: string;
  /** Toggle show/hide Runner (empty = unbound). */
  activateHotkey: string;
  /** Toggle show/hide code editor (empty = unbound). */
  editorHotkey: string;
  /** Toggle show/hide Desktop Zones (empty = unbound). */
  zonesHotkey: string;
  /** Toggle show/hide settings (empty = unbound). */
  settingsHotkey: string;
  /** Toggle show/hide screenshot history (empty = unbound). */
  historyHotkey: string;
  /** Master switch: when false, no global shortcuts are registered. */
  hotkeysEnabled: boolean;
  screenshotHistoryLimit: number;
  screenshotDrawColor: string;
  fontId: string;
  glassAlpha: number;
  /** Backdrop blur px for frosted panels / titlebar */
  glassBlur: number;
  theme: UiTheme;
  /** 运行环境色板镜像（icon / data-env）；由 profile 决定，不随拾色器改 */
  brandTone: BrandTone;
  /** 主图强调色（拾色器）；正式/测试仅为颜色预设 */
  brandColor: string;
  shellMosaicCols: number;
  shellLayout: ShellLayout;
  alwaysOnTop: boolean;
  persistLogs: boolean;
  /** Basename under shared wallpapers dir; null = no app background */
  appBackground: string | null;
  migratedFromRunner: boolean;
  /**
   * Legacy prefs defaulted glassAlpha to 100 while CSS used 0.55.
   * After wiring applyGlass, 100 hid wallpaper frost — migrate once to 55.
   */
  glassFrostDefaultMigrated: boolean;
};

export type SharedSettings = Omit<
  SharedPrefs,
  'screenshotDrawColor' | 'migratedFromRunner' | 'glassFrostDefaultMigrated'
>;

const DEFAULTS: SharedPrefs = {
  screenshotHotkey: DEFAULT_SCREENSHOT_HOTKEY,
  activateHotkey: DEFAULT_ACTIVATE_HOTKEY,
  editorHotkey: DEFAULT_EDITOR_HOTKEY,
  zonesHotkey: DEFAULT_ZONES_HOTKEY,
  settingsHotkey: DEFAULT_SETTINGS_HOTKEY,
  historyHotkey: DEFAULT_HISTORY_HOTKEY,
  hotkeysEnabled: true,
  screenshotHistoryLimit: DEFAULT_SCREENSHOT_HISTORY_LIMIT,
  screenshotDrawColor: DEFAULT_SCREENSHOT_DRAW_COLOR,
  fontId: DEFAULT_FONT_ID,
  glassAlpha: DEFAULT_GLASS_ALPHA,
  glassBlur: DEFAULT_GLASS_BLUR,
  theme: DEFAULT_THEME,
  brandTone: 'test',
  brandColor: BRAND_PRESET_TEST,
  shellMosaicCols: DEFAULT_SHELL_MOSAIC_COLS,
  shellLayout: DEFAULT_SHELL_LAYOUT,
  alwaysOnTop: false,
  persistLogs: false,
  appBackground: null,
  migratedFromRunner: false,
  glassFrostDefaultMigrated: true,
};

/** Profile-scoped paths under userData (prod: pkg-runner, dev: pkg-runner-dev). */
export function sharedSettingsPath(): string {
  return path.join(app.getPath('userData'), 'shared-settings.json');
}

export function trayCmdPath(): string {
  return path.join(app.getPath('userData'), 'tray-cmd.json');
}

export function trayCmdReplyPath(): string {
  return path.join(app.getPath('userData'), 'tray-cmd-reply.json');
}

function legacyRunnerPrefsPath(): string {
  return path.join(app.getPath('appData'), 'pkg-runner', 'pkg-runner-prefs.json');
}

function legacyTrayPrefsPath(): string {
  return path.join(app.getPath('appData'), 'pkg-runner-tray', 'tray-prefs.json');
}

export function normalizeScreenshotHistoryLimit(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_SCREENSHOT_HISTORY_LIMIT;
  return Math.min(
    MAX_SCREENSHOT_HISTORY_LIMIT,
    Math.max(MIN_SCREENSHOT_HISTORY_LIMIT, Math.round(n)),
  );
}

export function normalizeScreenshotDrawColor(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_SCREENSHOT_DRAW_COLOR;
  const h = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(h)) return h.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(h)) {
    return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`.toUpperCase();
  }
  return DEFAULT_SCREENSHOT_DRAW_COLOR;
}

export function normalizeHotkey(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim();
}

export function normalizeGlassAlpha(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_GLASS_ALPHA;
  return Math.min(100, Math.max(10, Math.round(n)));
}

export function normalizeGlassBlur(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_GLASS_BLUR;
  return Math.min(MAX_GLASS_BLUR, Math.max(MIN_GLASS_BLUR, Math.round(n)));
}

export function normalizeShellMosaicCols(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_SHELL_MOSAIC_COLS;
  return Math.min(MAX_SHELL_MOSAIC_COLS, Math.max(MIN_SHELL_MOSAIC_COLS, Math.round(n)));
}

export function normalizeShellLayout(raw: unknown): ShellLayout {
  return raw === 'single' ? 'single' : 'grid';
}

export function normalizeTheme(raw: unknown): UiTheme {
  return raw === 'light' ? 'light' : 'dark';
}

export function normalizeBrandTone(raw: unknown): BrandTone {
  if (raw === 'prod' || raw === 'test') return raw;
  return pkgRunnerColorEnv();
}

export function normalizeFontId(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return DEFAULT_FONT_ID;
  return raw.trim();
}

export function normalizeAppBackground(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') return null;
  const name = path.basename(raw.trim());
  if (!name || name.includes('..')) return null;
  if (!/\.(jpg|jpeg|jpe|png|webp|bmp)$/i.test(name)) return null;
  return name;
}

export function settingsFromPrefs(prefs: SharedPrefs): SharedSettings {
  const tone = pkgRunnerColorEnv();
  prefs.brandTone = tone;
  return {
    screenshotHotkey: prefs.screenshotHotkey,
    activateHotkey: prefs.activateHotkey,
    editorHotkey: prefs.editorHotkey,
    zonesHotkey: prefs.zonesHotkey,
    settingsHotkey: prefs.settingsHotkey,
    historyHotkey: prefs.historyHotkey,
    hotkeysEnabled: prefs.hotkeysEnabled,
    screenshotHistoryLimit: prefs.screenshotHistoryLimit,
    fontId: prefs.fontId,
    glassAlpha: prefs.glassAlpha,
    glassBlur: prefs.glassBlur,
    theme: prefs.theme,
    brandTone: tone,
    brandColor: prefs.brandColor,
    shellMosaicCols: prefs.shellMosaicCols,
    shellLayout: prefs.shellLayout,
    alwaysOnTop: prefs.alwaysOnTop,
    persistLogs: prefs.persistLogs,
    appBackground: prefs.appBackground,
  };
}

function coerce(parsed: Record<string, unknown>, migrated: boolean): SharedPrefs {
  return {
    screenshotHotkey:
      'screenshotHotkey' in parsed ? normalizeHotkey(parsed.screenshotHotkey) : '',
    activateHotkey:
      'activateHotkey' in parsed ? normalizeHotkey(parsed.activateHotkey) : '',
    editorHotkey: 'editorHotkey' in parsed ? normalizeHotkey(parsed.editorHotkey) : '',
    zonesHotkey: 'zonesHotkey' in parsed ? normalizeHotkey(parsed.zonesHotkey) : '',
    settingsHotkey:
      'settingsHotkey' in parsed ? normalizeHotkey(parsed.settingsHotkey) : '',
    historyHotkey:
      'historyHotkey' in parsed ? normalizeHotkey(parsed.historyHotkey) : '',
    hotkeysEnabled:
      typeof parsed.hotkeysEnabled === 'boolean' ? parsed.hotkeysEnabled : true,
    screenshotHistoryLimit:
      'screenshotHistoryLimit' in parsed
        ? normalizeScreenshotHistoryLimit(parsed.screenshotHistoryLimit)
        : DEFAULT_SCREENSHOT_HISTORY_LIMIT,
    screenshotDrawColor:
      'screenshotDrawColor' in parsed
        ? normalizeScreenshotDrawColor(parsed.screenshotDrawColor)
        : DEFAULT_SCREENSHOT_DRAW_COLOR,
    fontId: normalizeFontId(parsed.fontId),
    glassAlpha: (() => {
      const frostMigrated = Boolean(parsed.glassFrostDefaultMigrated);
      const raw =
        'glassAlpha' in parsed
          ? normalizeGlassAlpha(parsed.glassAlpha)
          : DEFAULT_GLASS_ALPHA;
      // One-shot: opaque legacy default → frosted default (see glassFrostDefaultMigrated).
      if (!frostMigrated && raw === 100) return DEFAULT_GLASS_ALPHA;
      return raw;
    })(),
    glassBlur:
      'glassBlur' in parsed ? normalizeGlassBlur(parsed.glassBlur) : DEFAULT_GLASS_BLUR,
    theme: 'theme' in parsed ? normalizeTheme(parsed.theme) : DEFAULT_THEME,
    brandTone: pkgRunnerColorEnv(),
    brandColor: (() => {
      const tone = pkgRunnerColorEnv();
      if ('brandColor' in parsed) {
        return normalizeBrandColor(parsed.brandColor, brandColorForTone(tone));
      }
      return brandColorForTone(tone);
    })(),
    shellMosaicCols:
      'shellMosaicCols' in parsed
        ? normalizeShellMosaicCols(parsed.shellMosaicCols)
        : DEFAULT_SHELL_MOSAIC_COLS,
    shellLayout:
      'shellLayout' in parsed
        ? normalizeShellLayout(parsed.shellLayout)
        : DEFAULT_SHELL_LAYOUT,
    alwaysOnTop:
      typeof parsed.alwaysOnTop === 'boolean' ? parsed.alwaysOnTop : false,
    persistLogs:
      typeof parsed.persistLogs === 'boolean' ? parsed.persistLogs : false,
    appBackground:
      'appBackground' in parsed ? normalizeAppBackground(parsed.appBackground) : null,
    migratedFromRunner: migrated || Boolean(parsed.migratedFromRunner),
    glassFrostDefaultMigrated: true,
  };
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function migrateFromLegacy(): SharedPrefs | null {
  const runner = readJson(legacyRunnerPrefsPath());
  const trayOld = readJson(legacyTrayPrefsPath());
  if (!runner && !trayOld) return null;
  const merged = { ...(runner || {}), ...(trayOld || {}) };
  return coerce(merged, true);
}

export function loadPrefs(): SharedPrefs {
  const file = sharedSettingsPath();
  const shared = readJson(file);
  if (shared) {
    const prefs = coerce(shared, Boolean(shared.migratedFromRunner));
    // Persist one-shot frost default migration (100 → 55) and new flag.
    if (!shared.glassFrostDefaultMigrated) {
      savePrefs(prefs);
    }
    diagLog('tray:prefs', 'load.ok', {
      file,
      screenshotHotkey: prefs.screenshotHotkey,
      activateHotkey: prefs.activateHotkey,
      editorHotkey: prefs.editorHotkey,
      glassAlpha: prefs.glassAlpha,
    });
    return prefs;
  }
  const migrated = migrateFromLegacy();
  if (migrated) {
    diagLog('tray:prefs', 'load.migrate', { file });
    savePrefs(migrated);
    return migrated;
  }
  diagLog('tray:prefs', 'load.defaults', { file });
  const tone = pkgRunnerColorEnv();
  return {
    ...DEFAULTS,
    brandTone: tone,
    brandColor: brandColorForTone(tone),
  };
}

export function savePrefs(prefs: SharedPrefs): void {
  try {
    const file = sharedSettingsPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(prefs, null, 2), 'utf8');
  } catch {
    /* ignore */
  }
}

/** Tray-owned watcher: reload prefs when shared-settings.json changes. */
export function watchSharedSettings(onChange: () => void): () => void {
  const file = sharedSettingsPath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch {
    /* ignore */
  }
  let timer: NodeJS.Timeout | null = null;
  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, 80);
  };
  let watcher: fs.FSWatcher | null = null;
  try {
    watcher = fs.watch(path.dirname(file), (event, name) => {
      if (!name || name === 'shared-settings.json') fire();
    });
  } catch {
    /* ignore */
  }
  return () => {
    if (timer) clearTimeout(timer);
    watcher?.close();
  };
}

export function formatHotkeyLabel(accel: string): string {
  const raw = String(accel || '').trim();
  if (!raw) return '未设置';
  return raw
    .replace(/CommandOrControl/gi, process.platform === 'darwin' ? '⌘' : 'Ctrl')
    .replace(/Command/gi, '⌘')
    .replace(/Control/gi, 'Ctrl')
    .replace(/Option/gi, '⌥')
    .replace(/Alt/gi, 'Alt')
    .replace(/Shift/gi, 'Shift')
    .replace(/\+/g, '+');
}
