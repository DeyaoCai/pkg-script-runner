/* global window, document */
(function (global) {
  'use strict';

  function readToken(name, fallback) {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    return value || fallback || '';
  }

  function termTheme() {
    return {
      background: readToken('--color-term-bg', '#0d1117'),
      foreground: readToken('--color-term-fg', '#e6edf3'),
      cursor: readToken('--color-term-cursor', '#58a6ff'),
      selectionBackground: readToken('--color-term-selection', '#264f78'),
    };
  }

  function windowBackground() {
    return readToken('--color-bg-base', '#1b1d21');
  }

  /** @param {Map<string, { term?: { options: { theme: object }, refresh?: number } }>} shellTerms */
  function syncTerminalThemes(shellTerms) {
    if (!shellTerms || typeof shellTerms.forEach !== 'function') return;
    const theme = termTheme();
    shellTerms.forEach((entry) => {
      if (!entry?.term) return;
      try {
        entry.term.options.theme = theme;
        // Force a repaint on theme switch.
        entry.term.refresh(0, entry.term.rows - 1);
      } catch {
        /* ignore */
      }
    });
  }

  global.PkgTokens = {
    read: readToken,
    termTheme,
    windowBackground,
    syncTerminalThemes,
  };
})(window);
