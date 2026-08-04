/**
 * Persist BrowserWindow bounds and restore with display workArea avoidance.
 */
import fs from 'node:fs';
import path from 'node:path';
import { screen, type BrowserWindow, type Rectangle } from 'electron';

export type PersistedWindowState = {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized?: boolean;
};

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export function coerceWindowState(raw: unknown): PersistedWindowState | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (
    !isFiniteNumber(o.x) ||
    !isFiniteNumber(o.y) ||
    !isFiniteNumber(o.width) ||
    !isFiniteNumber(o.height)
  ) {
    return null;
  }
  if (o.width < 100 || o.height < 80) return null;
  return {
    x: Math.round(o.x),
    y: Math.round(o.y),
    width: Math.round(o.width),
    height: Math.round(o.height),
    isMaximized: o.isMaximized === true,
  };
}

function overlapArea(a: Rectangle, b: Rectangle): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

/**
 * Keep the window usable on current displays (workArea),
 * recentering when the saved rect is mostly off-screen.
 */
export function clampWindowStateToDisplays(
  state: PersistedWindowState,
  opts: { minWidth: number; minHeight: number },
): PersistedWindowState {
  const displays = screen.getAllDisplays();
  if (!displays.length) {
    return {
      ...state,
      width: Math.max(opts.minWidth, state.width),
      height: Math.max(opts.minHeight, state.height),
    };
  }

  let width = Math.max(opts.minWidth, Math.round(state.width));
  let height = Math.max(opts.minHeight, Math.round(state.height));
  let x = Math.round(state.x);
  let y = Math.round(state.y);
  const rect = { x, y, width, height };

  let best = screen.getDisplayNearestPoint({
    x: x + width / 2,
    y: y + height / 2,
  });
  let bestArea = 0;
  for (const d of displays) {
    const area = overlapArea(rect, d.workArea);
    if (area > bestArea) {
      bestArea = area;
      best = d;
    }
  }

  const wa = best.workArea;
  width = Math.min(width, Math.max(opts.minWidth, wa.width));
  height = Math.min(height, Math.max(opts.minHeight, wa.height));

  // Require a usable visible strip; otherwise snap to workArea center.
  const minVisible = Math.min(120, width, height);
  if (bestArea < minVisible * minVisible * 0.25) {
    x = Math.round(wa.x + (wa.width - width) / 2);
    y = Math.round(wa.y + (wa.height - height) / 2);
  } else {
    x = Math.min(Math.max(x, wa.x), wa.x + wa.width - width);
    y = Math.min(Math.max(y, wa.y), wa.y + wa.height - height);
  }

  return {
    x,
    y,
    width,
    height,
    isMaximized: !!state.isMaximized,
  };
}

export function readWindowStateFile(filePath: string): PersistedWindowState | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return coerceWindowState(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return null;
  }
}

export function writeWindowStateFile(
  filePath: string,
  state: PersistedWindowState,
): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  } catch {
    /* ignore */
  }
}

export function captureWindowState(win: BrowserWindow): PersistedWindowState | null {
  if (win.isDestroyed()) return null;
  try {
    if (win.isMinimized()) return null;
    const isMaximized = win.isMaximized();
    const b = isMaximized ? win.getNormalBounds() : win.getBounds();
    return coerceWindowState({ ...b, isMaximized });
  } catch {
    return null;
  }
}

export type AttachWindowStateOpts = {
  filePath: string;
  minWidth: number;
  minHeight: number;
  debounceMs?: number;
  /** Return true to skip persisting (e.g. soft-hidden). */
  shouldSkipSave?: () => boolean;
};

/** Debounced save on move/resize/maximize. Returns disposer. */
export function attachWindowStateTracker(
  win: BrowserWindow,
  opts: AttachWindowStateOpts,
): () => void {
  const debounceMs = opts.debounceMs ?? 250;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const saveNow = () => {
    if (opts.shouldSkipSave?.()) return;
    const state = captureWindowState(win);
    if (!state) return;
    writeWindowStateFile(opts.filePath, state);
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      saveNow();
    }, debounceMs);
  };

  const onClose = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    saveNow();
  };

  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('maximize', schedule);
  win.on('unmaximize', schedule);
  win.on('close', onClose);

  return () => {
    if (timer) clearTimeout(timer);
    try {
      win.removeListener('resize', schedule);
      win.removeListener('move', schedule);
      win.removeListener('maximize', schedule);
      win.removeListener('unmaximize', schedule);
      win.removeListener('close', onClose);
    } catch {
      /* ignore */
    }
  };
}

/** Load + clamp saved state for BrowserWindow constructor options. */
export function resolveWindowCreateBounds(
  filePath: string,
  defaults: { width: number; height: number; minWidth: number; minHeight: number },
): {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized: boolean;
} {
  const saved = readWindowStateFile(filePath);
  if (!saved) {
    return {
      width: defaults.width,
      height: defaults.height,
      isMaximized: false,
    };
  }
  const clamped = clampWindowStateToDisplays(saved, {
    minWidth: defaults.minWidth,
    minHeight: defaults.minHeight,
  });
  return {
    x: clamped.x,
    y: clamped.y,
    width: clamped.width,
    height: clamped.height,
    isMaximized: !!clamped.isMaximized,
  };
}
