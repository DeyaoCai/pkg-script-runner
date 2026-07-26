export function readToken(name: string, fallback = ''): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function termTheme() {
  return {
    background: readToken('--color-term-bg', '#0d1117'),
    foreground: readToken('--color-term-fg', '#e6edf3'),
    cursor: readToken('--color-term-cursor', '#58a6ff'),
    selectionBackground: readToken('--color-term-selection', '#264f78'),
  };
}
