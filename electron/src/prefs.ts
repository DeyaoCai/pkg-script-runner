import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/** 默认不绑定全局热键，需在设置中自行录制 */
export const DEFAULT_SCREENSHOT_HOTKEY = '';
export const DEFAULT_ACTIVATE_HOTKEY = '';
export const DEFAULT_GLASS_ALPHA = 70;
export const DEFAULT_FONT_ID = 'jetbrains';
/** 截屏历史条数默认 / 允许范围 */
export const DEFAULT_SCREENSHOT_HISTORY_LIMIT = 10;
export const MIN_SCREENSHOT_HISTORY_LIMIT = 1;
export const MAX_SCREENSHOT_HISTORY_LIMIT = 100;
export const DEFAULT_SCREENSHOT_DRAW_COLOR = '#3D8BFD';
export const DEFAULT_THEME = 'dark' as const;
/** Shell 并排列数默认 / 范围 */
export const DEFAULT_SHELL_MOSAIC_COLS = 2;
export const MIN_SHELL_MOSAIC_COLS = 1;
export const MAX_SHELL_MOSAIC_COLS = 4;
export const DEFAULT_SHELL_LAYOUT = 'grid' as const;

export type UiTheme = 'dark' | 'light';
export type ShellLayout = 'grid' | 'single';

export type Prefs = {
  /** 脚本输出是否落盘（默认关闭） */
  persistLogs: boolean;
  /** 界面字体 id（与 fonts-catalog 对齐） */
  fontId: string;
  /** 叠色不透明度 10–100 */
  glassAlpha: number;
  /** 界面主题 */
  theme: UiTheme;
  /** Shell 并排同时展示的列数 */
  shellMosaicCols: number;
  /** Shell：网格同时看多个 / 单个只看当前 Tab */
  shellLayout: ShellLayout;
  /** 应用永久置顶 */
  alwaysOnTop: boolean;
  /** 截屏热键（空=未设置） */
  screenshotHotkey: string;
  /** 显示/隐藏窗口热键（空=未设置；显示时关到托盘，隐藏时唤起） */
  activateHotkey: string;
  /** 截屏历史最多保留条数 */
  screenshotHistoryLimit: number;
  /** 截屏标注当前颜色 */
  screenshotDrawColor: string;
  /** 已添加的项目根目录 */
  projects: string[];
  /** 当前激活项目目录 */
  activeProject: string | null;
};

export type AppSettings = {
  fontId: string;
  glassAlpha: number;
  theme: UiTheme;
  shellMosaicCols: number;
  shellLayout: ShellLayout;
  alwaysOnTop: boolean;
  screenshotHotkey: string;
  activateHotkey: string;
  screenshotHistoryLimit: number;
};

const DEFAULTS: Prefs = {
  persistLogs: false,
  fontId: DEFAULT_FONT_ID,
  glassAlpha: DEFAULT_GLASS_ALPHA,
  theme: DEFAULT_THEME,
  shellMosaicCols: DEFAULT_SHELL_MOSAIC_COLS,
  shellLayout: DEFAULT_SHELL_LAYOUT,
  alwaysOnTop: false,
  screenshotHotkey: DEFAULT_SCREENSHOT_HOTKEY,
  activateHotkey: DEFAULT_ACTIVATE_HOTKEY,
  screenshotHistoryLimit: DEFAULT_SCREENSHOT_HISTORY_LIMIT,
  screenshotDrawColor: DEFAULT_SCREENSHOT_DRAW_COLOR,
  projects: [],
  activeProject: null,
};

function prefsPath(): string {
  return path.join(app.getPath('userData'), 'pkg-runner-prefs.json');
}

function normalizeDirList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string' || !item.trim()) continue;
    const dir = path.resolve(item.trim());
    const key = process.platform === 'win32' ? dir.toLowerCase() : dir;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(dir);
  }
  return out;
}

function normalizeGlassAlpha(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_GLASS_ALPHA;
  return Math.min(100, Math.max(10, Math.round(n)));
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

/** 空字符串表示未绑定；非法类型也视为未绑定 */
export function normalizeHotkey(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim();
}

function normalizeFontId(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return DEFAULT_FONT_ID;
  return raw.trim();
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

export function settingsFromPrefs(prefs: Prefs): AppSettings {
  return {
    fontId: prefs.fontId,
    glassAlpha: prefs.glassAlpha,
    theme: prefs.theme,
    shellMosaicCols: prefs.shellMosaicCols,
    shellLayout: prefs.shellLayout,
    alwaysOnTop: prefs.alwaysOnTop,
    screenshotHotkey: prefs.screenshotHotkey,
    activateHotkey: prefs.activateHotkey,
    screenshotHistoryLimit: prefs.screenshotHistoryLimit,
  };
}

export function loadPrefs(): Prefs {
  try {
    const raw = fs.readFileSync(prefsPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    const projects = normalizeDirList(parsed.projects);
    let activeProject =
      typeof parsed.activeProject === 'string' && parsed.activeProject.trim()
        ? path.resolve(parsed.activeProject.trim())
        : null;
    if (activeProject) {
      const key = process.platform === 'win32' ? activeProject.toLowerCase() : activeProject;
      const hit = projects.find((p) =>
        (process.platform === 'win32' ? p.toLowerCase() : p) === key,
      );
      activeProject = hit ?? projects[0] ?? null;
    } else {
      activeProject = projects[0] ?? null;
    }
    return {
      persistLogs:
        typeof parsed.persistLogs === 'boolean' ? parsed.persistLogs : DEFAULTS.persistLogs,
      fontId: normalizeFontId(parsed.fontId),
      glassAlpha: normalizeGlassAlpha(parsed.glassAlpha),
      theme: 'theme' in parsed ? normalizeTheme(parsed.theme) : DEFAULT_THEME,
      shellMosaicCols:
        'shellMosaicCols' in parsed
          ? normalizeShellMosaicCols(parsed.shellMosaicCols)
          : DEFAULT_SHELL_MOSAIC_COLS,
      shellLayout:
        'shellLayout' in parsed
          ? normalizeShellLayout(parsed.shellLayout)
          : DEFAULT_SHELL_LAYOUT,
      alwaysOnTop:
        typeof parsed.alwaysOnTop === 'boolean' ? parsed.alwaysOnTop : DEFAULTS.alwaysOnTop,
      // 字段缺失 → 留空（不再默认 Ctrl+Shift+G）
      screenshotHotkey:
        'screenshotHotkey' in parsed ? normalizeHotkey(parsed.screenshotHotkey) : '',
      activateHotkey:
        'activateHotkey' in parsed ? normalizeHotkey(parsed.activateHotkey) : '',
      screenshotHistoryLimit:
        'screenshotHistoryLimit' in parsed
          ? normalizeScreenshotHistoryLimit(parsed.screenshotHistoryLimit)
          : DEFAULT_SCREENSHOT_HISTORY_LIMIT,
      screenshotDrawColor:
        'screenshotDrawColor' in parsed
          ? normalizeScreenshotDrawColor(parsed.screenshotDrawColor)
          : DEFAULT_SCREENSHOT_DRAW_COLOR,
      projects,
      activeProject,
    };
  } catch {
    return { ...DEFAULTS, projects: [], activeProject: null };
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    fs.mkdirSync(path.dirname(prefsPath()), { recursive: true });
    fs.writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2), 'utf8');
  } catch {
    /* ignore */
  }
}

export function sameDir(a: string, b: string): boolean {
  const x = path.resolve(a);
  const y = path.resolve(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
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
