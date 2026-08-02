/**
 * Tray command channel — children write requests; only tray reads config files.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export function trayCmdPath(): string {
  return path.join(app.getPath('userData'), 'tray-cmd.json');
}

export function trayCmdReplyPath(): string {
  return path.join(app.getPath('userData'), 'tray-cmd-reply.json');
}

export type TrayCmd =
  | { cmd: 'open-settings' }
  | { cmd: 'patch-settings'; patch: Record<string, unknown> }
  | { cmd: 'publish-settings' }
  | { cmd: 'pull-settings'; id: string };

export function writeTrayCmd(payload: TrayCmd): void {
  try {
    const file = trayCmdPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
  } catch {
    /* ignore */
  }
}

export function requestTrayOpenSettings(): void {
  writeTrayCmd({ cmd: 'open-settings' });
}

export function requestTrayPatchSettings(patch: Record<string, unknown>): void {
  writeTrayCmd({ cmd: 'patch-settings', patch });
}

/** Ask tray to push current shared-settings to this runner. */
export function requestTrayPublishSettings(): void {
  writeTrayCmd({ cmd: 'publish-settings' });
}

/** Pull shared-settings from tray via file reply (works before Runner HTTP is up). */
export async function pullSettingsFromTray(timeoutMs = 2000): Promise<unknown | null> {
  const id = crypto.randomUUID();
  writeTrayCmd({ cmd: 'pull-settings', id });
  const replyPath = trayCmdReplyPath();
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (fs.existsSync(replyPath)) {
        const raw = fs.readFileSync(replyPath, 'utf8');
        const reply = JSON.parse(raw) as { id?: string; settings?: unknown };
        if (reply.id === id && reply.settings) {
          try {
            fs.unlinkSync(replyPath);
          } catch {
            /* ignore */
          }
          return reply.settings;
        }
      }
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}
