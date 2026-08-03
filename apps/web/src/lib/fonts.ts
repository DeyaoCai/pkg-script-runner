import { applyFontId } from '@pkg-runner/tokens';

export type FontPreset = {
  id: string;
  label: string;
  stack: string;
};

export const FONT_PRESETS: FontPreset[] = [
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

/** @deprecated use applyFontId from @pkg-runner/tokens */
export function applyDocumentFonts(fontId: string) {
  applyFontId(fontId);
}

export function fontLabel(fontId: string): string {
  return FONT_PRESETS.find((p) => p.id === fontId)?.label || fontId;
}
