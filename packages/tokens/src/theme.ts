import {
  applyBrandColorToRoot,
  brandColorForTone,
  normalizeBrandColor,
  type BrandTone,
  type StyleRoot,
} from './brand.js';

export type ColorEnv = BrandTone;
export type UiTheme = 'dark' | 'light';

export type DocumentRoot = StyleRoot & {
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  removeAttribute: (name: string) => void;
};

function docRoot(root?: DocumentRoot): DocumentRoot {
  if (root) return root;
  if (typeof document === 'undefined') {
    throw new Error('@pkg-runner/tokens: document is required');
  }
  return document.documentElement as unknown as DocumentRoot;
}

/** 读 CSS 变量（含计算后的值） */
export function readCssVar(
  name: string,
  fallback = '',
  el?: Element,
): string {
  if (typeof getComputedStyle === 'undefined') return fallback;
  const target = el ?? (typeof document !== 'undefined' ? document.documentElement : null);
  if (!target) return fallback;
  const v = getComputedStyle(target).getPropertyValue(name).trim();
  return v || fallback;
}

export function readTone(el?: Element): string {
  return readCssVar('--tone', brandColorForTone('prod'), el);
}

export function applyColorEnv(env: ColorEnv, root?: DocumentRoot): ColorEnv {
  const next: ColorEnv = env === 'test' ? 'test' : 'prod';
  docRoot(root).setAttribute('data-env', next);
  return next;
}

export function applyTheme(theme: UiTheme, root?: DocumentRoot): UiTheme {
  const next: UiTheme = theme === 'light' ? 'light' : 'dark';
  docRoot(root).setAttribute('data-theme', next);
  return next;
}

export function applyBrandColor(hex: string, root?: DocumentRoot): string {
  const c = normalizeBrandColor(hex);
  applyBrandColorToRoot(c, docRoot(root));
  return c;
}

export function applyGlass(
  alphaPct: number,
  blurPx: number,
  root?: DocumentRoot,
): void {
  const a = Math.min(100, Math.max(10, Math.round(Number(alphaPct) || 100)));
  const b = Math.min(40, Math.max(0, Math.round(Number(blurPx) || 0)));
  const r = docRoot(root);
  r.style.setProperty('--glass-alpha', String(a / 100));
  r.style.setProperty('--glass-blur', `${b}px`);
}

export type BootThemeOptions = {
  colorEnv?: ColorEnv;
  theme?: UiTheme;
  /** 若不传，用 colorEnv 对应预设 */
  brandColor?: string;
  glassAlpha?: number;
  glassBlur?: number;
  /** 可选：改 document.title */
  titleForEnv?: (env: ColorEnv) => string | null | undefined;
};

/** 渲染进程启动时统一落 data-env / data-theme / --tone / glass */
export function bootDocumentTheme(opts: BootThemeOptions = {}): {
  colorEnv: ColorEnv;
  theme: UiTheme;
  brandColor: string;
} {
  const colorEnv = applyColorEnv(opts.colorEnv ?? 'prod');
  const theme = applyTheme(opts.theme ?? 'dark');
  const brandColor = applyBrandColor(
    opts.brandColor?.trim()
      ? opts.brandColor
      : brandColorForTone(colorEnv),
  );
  if (opts.glassAlpha != null || opts.glassBlur != null) {
    applyGlass(opts.glassAlpha ?? 100, opts.glassBlur ?? 22);
  }
  if (opts.titleForEnv) {
    const t = opts.titleForEnv(colorEnv);
    if (typeof t === 'string' && t && typeof document !== 'undefined') {
      document.title = t;
    }
  }
  return { colorEnv, theme, brandColor };
}
