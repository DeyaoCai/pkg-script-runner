import fs from 'node:fs';
import { shell } from 'electron';

/**
 * Open a directory in the OS file manager, or reveal a file (select in parent).
 */
export async function revealPath(absPath: string): Promise<void> {
  let isDir = false;
  try {
    isDir = fs.statSync(absPath).isDirectory();
  } catch {
    throw new Error(`path not found: ${absPath}`);
  }
  if (isDir) {
    const err = await shell.openPath(absPath);
    if (err) throw new Error(err);
    return;
  }
  shell.showItemInFolder(absPath);
}

/** Open a file/dir with the OS default application. */
export async function openPathWithDefault(absPath: string): Promise<void> {
  if (!fs.existsSync(absPath)) {
    throw new Error(`path not found: ${absPath}`);
  }
  const err = await shell.openPath(absPath);
  if (err) throw new Error(err);
}
