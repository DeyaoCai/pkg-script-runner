/**
 * 主色调种子：正式/测试两个预设 + 任意拾色。
 * 只写 --tone；铺底 / 点缀均由 tokens.css 派生。
 */

export const BRAND_PRESET_PROD = '#669851';
export const BRAND_PRESET_TEST = '#C15E22';
/** 旧正式色；normalize 时映射到 BRAND_PRESET_PROD */
export const LEGACY_BRAND_PRESET_PROD = '#3D8BFD';

export type BrandTone = 'prod' | 'test';

const LEGACY_INLINE_VARS = [
  '--brand',
  '--brand-700',
  '--brand-680',
  '--brand-650',
  '--brand-620',
  '--brand-600',
  '--brand-550',
  '--brand-500',
  '--brand-450',
  '--brand-420',
  '--brand-400',
  '--brand-300',
  '--brand-200',
  '--brand-150',
  '--brand-100',
  '--color-accent',
  '--color-accent-hover',
  '--color-accent-soft',
  '--color-accent-soft-strong',
  '--color-accent-fill',
  '--color-accent-inset',
  '--color-focus-ring',
  '--accent',
  '--accent-hover',
] as const;

export type StyleRoot = {
  style: {
    setProperty: (k: string, v: string) => void;
    removeProperty: (k: string) => void;
  };
};

export function normalizeBrandColor(
  raw: unknown,
  fallback: string = BRAND_PRESET_PROD,
): string {
  if (typeof raw !== 'string') return fallback.toUpperCase();
  const h = raw.trim();
  let out = '';
  if (/^#[0-9a-fA-F]{6}$/.test(h)) out = h.toUpperCase();
  else if (/^#[0-9a-fA-F]{3}$/.test(h)) {
    out = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`.toUpperCase();
  } else {
    return fallback.toUpperCase();
  }
  if (out === LEGACY_BRAND_PRESET_PROD) return BRAND_PRESET_PROD;
  return out;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/i.exec(hex);
  if (!m) return null;
  return {
    r: parseInt(m[1]!, 16),
    g: parseInt(m[2]!, 16),
    b: parseInt(m[3]!, 16),
  };
}

function dist(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

export function brandToneFromColor(hex: string): BrandTone {
  const u = normalizeBrandColor(hex);
  if (u === BRAND_PRESET_TEST) return 'test';
  if (u === BRAND_PRESET_PROD) return 'prod';
  const rgb = hexToRgb(u);
  const prod = hexToRgb(BRAND_PRESET_PROD);
  const test = hexToRgb(BRAND_PRESET_TEST);
  if (!rgb || !prod || !test) return 'prod';
  return dist(rgb, test) < dist(rgb, prod) ? 'test' : 'prod';
}

export function brandColorForTone(tone: BrandTone): string {
  return tone === 'test' ? BRAND_PRESET_TEST : BRAND_PRESET_PROD;
}

export function applyBrandColorToRoot(hex: string, root: StyleRoot): void {
  const c = normalizeBrandColor(hex);
  for (const key of LEGACY_INLINE_VARS) {
    root.style.removeProperty(key);
  }
  root.style.setProperty('--tone', c);
}
