/** Single font preset — applies to both UI chrome and content. */

export const FONT_PRESETS = [
  {
    id: 'jetbrains',
    label: 'JetBrains Mono',
    stack: "'JetBrains Mono', ui-monospace, monospace",
  },
  {
    id: 'system',
    label: '系统默认',
    stack: "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  },
  {
    id: 'segoe',
    label: 'Segoe UI',
    stack: "'Segoe UI', 'PingFang SC', sans-serif",
  },
  {
    id: 'cascadia',
    label: 'Cascadia Code',
    stack: '"Cascadia Code", Consolas, ui-monospace, monospace',
  },
  {
    id: 'consolas',
    label: 'Consolas',
    stack: 'Consolas, "Courier New", monospace',
  },
];

export const DEFAULT_FONT_ID = 'jetbrains';

/** @deprecated use FONT_PRESETS */
export const MONO_FONT_PRESETS = FONT_PRESETS;
/** @deprecated use DEFAULT_FONT_ID */
export const DEFAULT_MONO_FONT_ID = DEFAULT_FONT_ID;
/** @deprecated */
export const UI_FONT_PRESETS = FONT_PRESETS;
/** @deprecated */
export const DEFAULT_UI_FONT_ID = DEFAULT_FONT_ID;

export function resolveFontStack(presets, id, fallbackId) {
  const hit = presets.find((p) => p.id === id);
  if (hit) return hit.stack;
  return presets.find((p) => p.id === fallbackId)?.stack ?? presets[0].stack;
}

export function applyDocumentFonts(opts) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const id = opts?.fontId ?? opts?.monoFontId ?? opts?.uiFontId;
  const stack = resolveFontStack(FONT_PRESETS, id, DEFAULT_FONT_ID);
  root.style.setProperty('--font', stack);
  root.style.setProperty('--sans', stack);
  root.style.setProperty('--mono', stack);
}
