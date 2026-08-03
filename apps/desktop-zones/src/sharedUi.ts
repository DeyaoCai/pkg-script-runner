/**
 * Shared UI settings for Desktop Zones (same tray push as Runner / Editor).
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import {
  coerceSharedSettings,
  defaultSharedSettings,
  type SharedSettings,
} from '../../runner/src/sharedSettings.js';

export type { SharedSettings };
export { coerceSharedSettings, defaultSharedSettings };

export function sharedSettingsPath(): string {
  return path.join(app.getPath('userData'), 'shared-settings.json');
}

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
