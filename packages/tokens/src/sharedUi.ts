/**
 * Shared UI settings → document tokens (theme / --tone / glass / font).
 * All frameless apps should boot via {@link bootSharedUi} and apply live
 * updates via {@link applySharedUiSettings} (tray push / getSettings).
 */
import {
  applyBrandColorToRoot,
  brandColorForTone,
  normalizeBrandColor,
  type BrandTone,
} from './brand.js';
import {
  applyColorEnv,
  applyGlass,
  applyTheme,
  bootDocumentTheme,
  type BootThemeOptions,
  type ColorEnv,
  type DocumentRoot,
  type UiTheme,
} from './theme.js';

export type SharedUiSettings = {
  theme?: UiTheme | string;
  brandColor?: string;
  glassAlpha?: number;
  glassBlur?: number;
  fontId?: string;
  shellMosaicCols?: number;
};

/** Minimal preload / host bridge for live shared-settings. */
export type SharedUiBridge = {
  getColorEnv?: () => ColorEnv | string | null | undefined;
  getSharedSettings?: () => Promise<unknown> | unknown;
  onSharedSettings?: (cb: (settings: unknown) => void) => (() => void) | void;
};

const FONT_STACKS: Record<string, string> = {
  jetbrains: "'JetBrains Mono', ui-monospace, monospace",
  system: "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  segoe: "'Segoe UI', 'PingFang SC', sans-serif",
  cascadia: '"Cascadia Code", Consolas, ui-monospace, monospace',
  consolas: 'Consolas, "Courier New", monospace',
};

function docRoot(root?: DocumentRoot): DocumentRoot {
  if (root) return root;
  if (typeof document === 'undefined') {
    throw new Error('@pkg-runner/tokens: document is required');
  }
  return document.documentElement as unknown as DocumentRoot;
}

function resolveColorEnv(
  explicit?: ColorEnv | string | null,
  bridge?: SharedUiBridge,
): ColorEnv {
  const fromBridge = bridge?.getColorEnv?.();
  const raw = explicit ?? fromBridge ?? 'prod';
  return raw === 'test' ? 'test' : 'prod';
}

/** Write --font / --sans / --mono from shared fontId. */
export function applyFontId(
  fontId: string | null | undefined,
  root?: DocumentRoot,
): string {
  const id = (typeof fontId === 'string' && fontId.trim()) || 'jetbrains';
  const stack = FONT_STACKS[id] || FONT_STACKS.jetbrains;
  const r = docRoot(root);
  r.style.setProperty('--font', stack);
  r.style.setProperty('--sans', stack);
  r.style.setProperty('--mono', stack);
  return id;
}

/**
 * Apply tray shared-settings UI slice onto the document.
 * `data-env` follows runtime profile (icon); `brandColor` is the picker accent.
 */
export function applySharedUiSettings(
  settings: SharedUiSettings | null | undefined,
  opts: {
    colorEnv?: ColorEnv | string | null;
    bridge?: SharedUiBridge;
    root?: DocumentRoot;
    /** default glass blur when only glassAlpha is set */
    defaultGlassBlur?: number;
  } = {},
): void {
  if (!settings || typeof settings !== 'object') return;
  const root = opts.root;
  const env = resolveColorEnv(opts.colorEnv, opts.bridge);

  applyTheme(settings.theme === 'light' ? 'light' : 'dark', root);
  applyColorEnv(env, root);

  if (typeof settings.brandColor === 'string' && settings.brandColor.trim()) {
    const hex = normalizeBrandColor(
      settings.brandColor,
      brandColorForTone(env as BrandTone),
    );
    applyBrandColorToRoot(hex, docRoot(root));
  }

  if (settings.glassAlpha != null || settings.glassBlur != null) {
    applyGlass(
      Number(settings.glassAlpha) || 100,
      settings.glassBlur != null
        ? Number(settings.glassBlur)
        : (opts.defaultGlassBlur ?? 22),
      root,
    );
  }

  if (settings.fontId != null) {
    applyFontId(settings.fontId, root);
  }

  if (settings.shellMosaicCols != null) {
    const cols = Math.min(4, Math.max(1, Number(settings.shellMosaicCols) || 2));
    docRoot(root).style.setProperty('--shell-mosaic-cols', String(cols));
  }
}

export type BootSharedUiOptions = BootThemeOptions & {
  /** Live settings bridge (get + subscribe). */
  bridge?: SharedUiBridge;
  /** Fetch/subscribe when bridge is set. Default true. */
  syncSettings?: boolean;
};

/**
 * One-shot boot: tokens (data-env / theme / --tone) + optional live settings sync.
 * Prefer this over calling bootDocumentTheme + per-app apply helpers.
 */
export function bootSharedUi(opts: BootSharedUiOptions = {}): {
  colorEnv: ColorEnv;
  theme: UiTheme;
  brandColor: string;
  unsubscribe: () => void;
} {
  const colorEnv = resolveColorEnv(opts.colorEnv, opts.bridge);
  const boot = bootDocumentTheme({
    ...opts,
    colorEnv,
  });

  let unsubscribe: () => void = () => undefined;
  const bridge = opts.bridge;
  const sync = opts.syncSettings !== false && !!bridge;

  if (sync && bridge) {
    const apply = (raw: unknown) => {
      applySharedUiSettings(raw as SharedUiSettings, {
        colorEnv,
        bridge,
      });
    };

    try {
      const got = bridge.getSharedSettings?.();
      if (got != null && typeof (got as Promise<unknown>).then === 'function') {
        void (got as Promise<unknown>).then(apply).catch(() => undefined);
      } else if (got != null) {
        apply(got);
      }
    } catch {
      /* bridge not ready */
    }

    const off = bridge.onSharedSettings?.(apply);
    if (typeof off === 'function') {
      unsubscribe = off;
    }
  }

  return { ...boot, unsubscribe };
}
