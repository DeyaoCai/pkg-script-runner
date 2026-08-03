/**
 * Shared UI theme slice for Code Editor (same file / tray push as Runner).
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import {
  coerceSharedSettings,
  defaultSharedSettings,
  type SharedSettings,
} from '../../../runner/src/sharedSettings.js';

export type { SharedSettings };
export { coerceSharedSettings, defaultSharedSettings };

export function sharedSettingsPath(): string {
  return path.join(app.getPath('userData'), 'shared-settings.json');
}

/** Read tray-owned shared-settings.json when running without getSharedSettings inject. */
export function readSharedSettingsFromDisk(): SharedSettings {
  try {
    const raw = fs.readFileSync(sharedSettingsPath(), 'utf8');
    const next = coerceSharedSettings(JSON.parse(raw));
    if (next) return next;
  } catch {
    /* missing / invalid */
  }
  return defaultSharedSettings();
}
