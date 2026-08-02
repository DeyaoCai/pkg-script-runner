/**
 * IIFE for tray file:// pages → window.PkgTokens
 */
import * as api from './index.js';

declare global {
  interface Window {
    PkgTokens: typeof api;
  }
}

const g = globalThis as typeof globalThis & { PkgTokens?: typeof api };
g.PkgTokens = api;
