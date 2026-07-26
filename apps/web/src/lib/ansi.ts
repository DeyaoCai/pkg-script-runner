/** ANSI → safe HTML (ported from ui/ansi.js). */

const BASIC_FG: Record<number, string> = {
  30: '#1e1e1e',
  31: '#f44747',
  32: '#6a9955',
  33: '#d7ba7d',
  34: '#569cd6',
  35: '#c586c0',
  36: '#4ec9b0',
  37: '#d4d4d4',
  90: '#808080',
  91: '#f48771',
  92: '#b5cea8',
  93: '#dcdcaa',
  94: '#9cdcfe',
  95: '#d7a3d7',
  96: '#9cdcfe',
  97: '#ffffff',
};

const BASIC_BG: Record<number, string> = {
  40: '#1e1e1e',
  41: '#f44747',
  42: '#6a9955',
  43: '#d7ba7d',
  44: '#569cd6',
  45: '#c586c0',
  46: '#4ec9b0',
  47: '#d4d4d4',
  100: '#808080',
  101: '#f48771',
  102: '#b5cea8',
  103: '#dcdcaa',
  104: '#9cdcfe',
  105: '#d7a3d7',
  106: '#9cdcfe',
  107: '#ffffff',
};

function buildXterm256(): Record<number, string> {
  const map: Record<number, string> = {};
  const basic = [
    '#000000',
    '#800000',
    '#008000',
    '#808000',
    '#000080',
    '#800080',
    '#008080',
    '#c0c0c0',
    '#808080',
    '#ff0000',
    '#00ff00',
    '#ffff00',
    '#0000ff',
    '#ff00ff',
    '#00ffff',
    '#ffffff',
  ];
  for (let i = 0; i < 16; i++) map[i] = basic[i];
  let n = 16;
  const levels = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        map[n++] = `rgb(${levels[r]},${levels[g]},${levels[b]})`;
      }
    }
  }
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10;
    map[n++] = `rgb(${v},${v},${v})`;
  }
  return map;
}

const XTERM_256 = buildXterm256();

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

type AnsiState = {
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  fg: string | null;
  bg: string | null;
};

function styleAttr(state: AnsiState): string {
  const parts: string[] = [];
  if (state.bold) parts.push('font-weight:700');
  if (state.dim) parts.push('opacity:0.72');
  if (state.italic) parts.push('font-style:italic');
  if (state.underline) parts.push('text-decoration:underline');
  if (state.fg) parts.push(`color:${state.fg}`);
  if (state.bg) parts.push(`background-color:${state.bg}`);
  return parts.length ? ` style="${parts.join(';')}"` : '';
}

function applySgr(state: AnsiState, codes: number[]) {
  if (!codes.length) codes = [0];
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    if (c === 0) {
      state.bold = false;
      state.dim = false;
      state.italic = false;
      state.underline = false;
      state.fg = null;
      state.bg = null;
    } else if (c === 1) state.bold = true;
    else if (c === 2) state.dim = true;
    else if (c === 3) state.italic = true;
    else if (c === 4) state.underline = true;
    else if (c === 22) {
      state.bold = false;
      state.dim = false;
    } else if (c === 23) state.italic = false;
    else if (c === 24) state.underline = false;
    else if (c === 39) state.fg = null;
    else if (c === 49) state.bg = null;
    else if (BASIC_FG[c]) state.fg = BASIC_FG[c];
    else if (BASIC_BG[c]) state.bg = BASIC_BG[c];
    else if (c === 38 || c === 48) {
      const isFg = c === 38;
      const mode = codes[i + 1];
      if (mode === 5 && codes[i + 2] != null) {
        const color = XTERM_256[codes[i + 2]] || null;
        if (isFg) state.fg = color;
        else state.bg = color;
        i += 2;
      } else if (mode === 2 && codes[i + 4] != null) {
        const color = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`;
        if (isFg) state.fg = color;
        else state.bg = color;
        i += 4;
      }
    }
  }
}

export function ansiToHtml(input: string): string {
  if (!input) return '';
  const state: AnsiState = {
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    fg: null,
    bg: null,
  };

  let html = '';
  let i = 0;
  const s = String(input).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const flushText = (text: string) => {
    if (!text) return;
    const esc = escapeHtml(text).replaceAll('\n', '<br>');
    const attr = styleAttr(state);
    html += attr ? `<span${attr}>${esc}</span>` : esc;
  };

  while (i < s.length) {
    const ch = s[i];
    if (ch === '\x1b') {
      const next = s[i + 1];
      if (next === '[') {
        let j = i + 2;
        while (j < s.length && s[j] >= ' ' && s[j] <= '?') j++;
        const final = s[j];
        const body = s.slice(i + 2, j);
        if (final === 'm') {
          const codes = body
            ? body
                .split(';')
                .map((x) => Number(x || '0'))
                .filter((n) => !Number.isNaN(n))
            : [0];
          applySgr(state, codes);
        }
        i = j + 1;
        continue;
      }
      if (next === ']') {
        let j = i + 2;
        while (j < s.length && s[j] !== '\x07' && !(s[j] === '\x1b' && s[j + 1] === '\\')) {
          j++;
        }
        if (s[j] === '\x07') i = j + 1;
        else if (s[j] === '\x1b') i = j + 2;
        else i = s.length;
        continue;
      }
      i += next ? 2 : 1;
      continue;
    }

    let j = i + 1;
    while (j < s.length && s[j] !== '\x1b') j++;
    flushText(s.slice(i, j));
    i = j;
  }

  return html;
}
