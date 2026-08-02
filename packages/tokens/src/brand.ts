/**
 * 主色调种子：正式/测试两个预设 + 任意拾色。
 * 只写 --tone；铺底 / 点缀均由 tokens.css 派生。
 */

export const BRAND_PRESET_PROD = '#669851';
export const BRAND_PRESET_TEST = '#C15E22';

export type BrandTone = 'prod' | 'test';

/** 历史内联 accent 变量名；apply 时清掉，统一走 --tone */
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
  if (/^#[0-9a-fA-F]{6}$/.test(h)) return h.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(h)) {
    return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`.toUpperCase();
  }
  return fallback.toUpperCase();
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
