/** Shared font presets — types for @pkg-runner/fonts/catalog.js */

export type TFontPreset = {
  id: string;
  label: string;
  stack: string;
};

export declare const FONT_PRESETS: readonly TFontPreset[];
export declare const DEFAULT_FONT_ID: string;

/** @deprecated use FONT_PRESETS */
export declare const MONO_FONT_PRESETS: readonly TFontPreset[];
/** @deprecated use DEFAULT_FONT_ID */
export declare const DEFAULT_MONO_FONT_ID: string;
/** @deprecated */
export declare const UI_FONT_PRESETS: readonly TFontPreset[];
/** @deprecated */
export declare const DEFAULT_UI_FONT_ID: string;

export declare function resolveFontStack(
  presets: readonly TFontPreset[],
  id: string | undefined,
  fallbackId: string,
): string;

export declare function applyDocumentFonts(opts: {
  fontId?: string;
  /** @deprecated use fontId */
  monoFontId?: string;
  /** @deprecated use fontId */
  uiFontId?: string;
}): void;
