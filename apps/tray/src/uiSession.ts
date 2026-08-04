import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/** Which tray-hosted UIs were open last time (restore on next launch). */
export type UiSession = {
  runner: boolean;
  editor: boolean;
  zones: boolean;
};

const DEFAULTS: UiSession = {
  runner: false,
  editor: false,
  zones: false,
};

function sessionPath(): string {
  return path.join(app.getPath('userData'), 'ui-session.json');
}

function coerce(raw: unknown): UiSession {
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
  const o = raw as Record<string, unknown>;
  return {
    runner: o.runner === true,
    editor: o.editor === true,
    zones: o.zones === true,
  };
}

export function loadUiSession(): UiSession {
  try {
    const p = sessionPath();
    if (!fs.existsSync(p)) return { ...DEFAULTS };
    return coerce(JSON.parse(fs.readFileSync(p, 'utf8')));
  } catch {
    return { ...DEFAULTS };
  }
}

export function patchUiSession(partial: Partial<UiSession>): void {
  const next = { ...loadUiSession(), ...partial };
  try {
    fs.writeFileSync(sessionPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  } catch {
    /* ignore */
  }
}
