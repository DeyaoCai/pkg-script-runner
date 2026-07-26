import { spawn } from 'node:child_process';
import path from 'node:path';
import { assertInsideRoot, toRelPath } from './fsBridge.js';

export type TGitChange = {
  path: string;
  index: string;
  worktree: string;
  staged: boolean;
  unstaged: boolean;
};

function samePath(a: string, b: string): boolean {
  const na = path.resolve(a);
  const nb = path.resolve(b);
  if (process.platform === 'win32') {
    return na.toLowerCase() === nb.toLowerCase();
  }
  return na === nb;
}

function runGit(
  cwd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('git', ['--no-pager', ...args], {
      cwd,
      windowsHide: true,
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: '1',
        GIT_PAGER: 'cat',
        PAGER: 'cat',
      },
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.stderr.on('data', (c: Buffer) => err.push(c));
    child.on('error', (e) => {
      resolve({ code: 1, stdout: '', stderr: e.message });
    });
    child.on('close', (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      });
    });
  });
}

/** True git work-tree root, or null if not inside a repo. */
export async function gitToplevel(cwd: string): Promise<string | null> {
  const r = await runGit(cwd, ['rev-parse', '--show-toplevel']);
  if (r.code !== 0) return null;
  const top = r.stdout.trim();
  return top ? path.resolve(top) : null;
}

export async function isGitRepo(rootDir: string): Promise<boolean> {
  return (await gitToplevel(rootDir)) != null;
}

/**
 * Map a path relative to `boundRoot` into a path relative to the git toplevel
 * (needed when the bound folder is a subdirectory of a larger work tree).
 */
function toGitRel(toplevel: string, boundRoot: string, boundRel: string): string {
  if (samePath(toplevel, boundRoot)) return boundRel.replace(/\\/g, '/');
  const abs = path.resolve(boundRoot, boundRel);
  return toRelPath(toplevel, abs);
}

/**
 * Map a porcelain path (relative to toplevel) into a path relative to boundRoot.
 * Returns null when the change is outside the bound folder.
 */
function toBoundRel(
  toplevel: string,
  boundRoot: string,
  gitRel: string,
): string | null {
  const abs = path.isAbsolute(gitRel)
    ? path.resolve(gitRel)
    : path.resolve(toplevel, gitRel);
  try {
    assertInsideRoot(boundRoot, abs);
    return toRelPath(boundRoot, abs);
  } catch {
    return null;
  }
}

function parsePorcelainPath(line: string): {
  index: string;
  worktree: string;
  filePath: string;
} | null {
  if (!line || line.length < 4) return null;
  const index = line[0] ?? ' ';
  const worktree = line[1] ?? ' ';
  let filePath = line.slice(3);
  if (filePath.includes(' -> ')) {
    filePath = filePath.split(' -> ').pop() ?? filePath;
  }
  filePath = filePath.replace(/^"|"$/g, '').replace(/\\([\\"ntr])/g, '$1');
  return { index, worktree, filePath };
}

/** Parse `git status --porcelain=v1 -uall`, scoped to boundRoot. */
export async function gitStatus(boundRoot: string): Promise<TGitChange[]> {
  const toplevel = await gitToplevel(boundRoot);
  if (!toplevel) return [];

  const scope = samePath(toplevel, boundRoot)
    ? null
    : toRelPath(toplevel, boundRoot);

  const args = [
    '-c',
    'core.quotepath=false',
    'status',
    '--porcelain=v1',
    '-uall',
  ];
  if (scope) args.push('--', scope);

  // Always run from toplevel so porcelain paths are consistent
  const r = await runGit(toplevel, args);
  if (r.code !== 0) {
    throw new Error(r.stderr.trim() || 'git status failed');
  }

  const changes: TGitChange[] = [];
  for (const line of r.stdout.split(/\r?\n/)) {
    const parsed = parsePorcelainPath(line);
    if (!parsed) continue;
    const boundRel = toBoundRel(toplevel, boundRoot, parsed.filePath);
    if (boundRel == null) continue;
    const staged = parsed.index !== ' ' && parsed.index !== '?';
    const unstaged = parsed.worktree !== ' ' || parsed.index === '?';
    changes.push({
      path: boundRel,
      index: parsed.index,
      worktree: parsed.worktree,
      staged,
      unstaged,
    });
  }
  return changes;
}

async function diffUntracked(
  toplevel: string,
  gitRel: string,
): Promise<string> {
  // Git for Windows accepts /dev/null even on Win32; NUL is unreliable with --no-index.
  const r = await runGit(toplevel, [
    '-c',
    'core.quotepath=false',
    'diff',
    '--no-index',
    '--',
    '/dev/null',
    gitRel,
  ]);
  // --no-index exits 1 when files differ
  return r.stdout.trim() ? r.stdout : r.stderr;
}

export type TGitDiffOpts = {
  staged?: boolean;
  /** porcelain XY chars — helps pick the right diff */
  index?: string;
  worktree?: string;
};

/**
 * Return unified diff text for a path (relative to boundRoot).
 * Prefer: untracked → --no-index; staged-only → --cached; else worktree vs HEAD.
 */
export async function gitDiff(
  boundRoot: string,
  relPath: string,
  opts: TGitDiffOpts = {},
): Promise<string> {
  assertInsideRoot(boundRoot, relPath);
  const toplevel = await gitToplevel(boundRoot);
  if (!toplevel) return '';

  const gitRel = toGitRel(toplevel, boundRoot, relPath);
  const index = opts.index ?? '';
  const worktree = opts.worktree ?? '';
  const untracked = index === '?' || worktree === '?';
  if (untracked) {
    return diffUntracked(toplevel, gitRel);
  }

  // Confirm via status in case caller omitted XY
  const status = await runGit(toplevel, [
    '-c',
    'core.quotepath=false',
    'status',
    '--porcelain=v1',
    '--',
    gitRel,
  ]);
  const line = (status.stdout.split(/\r?\n/).find(Boolean) || '').trimEnd();
  if (line.startsWith('??') || (line[0] === '?' && line[1] === '?')) {
    return diffUntracked(toplevel, gitRel);
  }

  const stagedOnly = !!opts.staged && worktree === ' ';
  const attempts: string[][] = [];
  if (stagedOnly || (opts.staged && worktree === ' ')) {
    attempts.push(['diff', '--cached', '--', gitRel]);
  }
  // Full picture vs HEAD (covers staged+unstaged and unstaged-only)
  attempts.push(['diff', 'HEAD', '--', gitRel]);
  // Worktree vs index
  attempts.push(['diff', '--', gitRel]);
  // Staged vs HEAD
  attempts.push(['diff', '--cached', '--', gitRel]);

  const seen = new Set<string>();
  for (const args of attempts) {
    const key = args.join('\0');
    if (seen.has(key)) continue;
    seen.add(key);
    const r = await runGit(toplevel, ['-c', 'core.quotepath=false', ...args]);
    if (r.stdout.trim()) return r.stdout;
  }
  return '';
}
