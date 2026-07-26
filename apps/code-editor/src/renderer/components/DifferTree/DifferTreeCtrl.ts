import { Controller } from '@pkg-runner/controller';
import type { TGitChangeDto } from '../../bridge.ts';
import type { CodeEditorShellCtrl } from '../../CodeEditorShell/CodeEditorShellCtrl.ts';

export type TDiffRow = {
  kind: 'meta' | 'hunk' | 'add' | 'del' | 'ctx' | 'empty';
  text: string;
  newLine: number | null;
  oldLine: number | null;
};

export type TChangeDirNode = {
  kind: 'dir';
  name: string;
  /** directory path with trailing slash, '' for root */
  path: string;
  children: TChangeTreeNode[];
  fileCount: number;
};

export type TChangeFileNode = {
  kind: 'file';
  name: string;
  change: TGitChangeDto;
};

export type TChangeTreeNode = TChangeDirNode | TChangeFileNode;

type TData = {
  changes: TGitChangeDto[];
  tree: TChangeTreeNode[];
  selectedPath: string | null;
  diffText: string;
  diffStaged: boolean;
  rows: TDiffRow[];
};

type TProps = Record<string, never>;
type TState = {
  loading: boolean;
  /** dir path → expanded; missing = true (default expand) */
  expanded: Record<string, boolean>;
};

/** Parse unified diff into clickable rows with line numbers. */
export function parseUnifiedDiff(diff: string): TDiffRow[] {
  const rows: TDiffRow[] = [];
  let newLine = 0;
  let oldLine = 0;
  for (const raw of diff.split(/\r?\n/)) {
    if (!raw && rows.length === 0) continue;
    if (
      raw.startsWith('diff ') ||
      raw.startsWith('index ') ||
      raw.startsWith('---') ||
      raw.startsWith('+++')
    ) {
      rows.push({ kind: 'meta', text: raw, newLine: null, oldLine: null });
      continue;
    }
    const hunk = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(raw);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      rows.push({ kind: 'hunk', text: raw, newLine, oldLine });
      continue;
    }
    if (raw.startsWith('+')) {
      rows.push({ kind: 'add', text: raw, newLine, oldLine: null });
      newLine += 1;
      continue;
    }
    if (raw.startsWith('-')) {
      rows.push({ kind: 'del', text: raw, newLine: null, oldLine });
      oldLine += 1;
      continue;
    }
    if (raw.startsWith('\\')) {
      rows.push({ kind: 'meta', text: raw, newLine: null, oldLine: null });
      continue;
    }
    rows.push({
      kind: raw ? 'ctx' : 'empty',
      text: raw || ' ',
      newLine: raw ? newLine : null,
      oldLine: raw ? oldLine : null,
    });
    if (raw) {
      newLine += 1;
      oldLine += 1;
    }
  }
  return rows;
}

type TMutableDir = {
  kind: 'dir';
  name: string;
  path: string;
  dirs: Map<string, TMutableDir>;
  files: TChangeFileNode[];
};

function emptyDir(name: string, path: string): TMutableDir {
  return { kind: 'dir', name, path, dirs: new Map(), files: [] };
}

function finalizeDir(dir: TMutableDir): TChangeDirNode {
  const children: TChangeTreeNode[] = [
    ...[...dir.dirs.values()]
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      .map(finalizeDir),
    ...dir.files.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    ),
  ];
  let fileCount = dir.files.length;
  for (const c of children) {
    if (c.kind === 'dir') fileCount += c.fileCount;
  }
  return {
    kind: 'dir',
    name: dir.name,
    path: dir.path,
    children,
    fileCount,
  };
}

/** Build a directory tree from flat git change paths. */
export function buildChangeTree(changes: TGitChangeDto[]): TChangeTreeNode[] {
  const root = emptyDir('', '');
  for (const change of changes) {
    const parts = change.path.replace(/\\/g, '/').split('/').filter(Boolean);
    if (!parts.length) continue;
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i]!;
      const dirPath = parts.slice(0, i + 1).join('/') + '/';
      let next = cur.dirs.get(name);
      if (!next) {
        next = emptyDir(name, dirPath);
        cur.dirs.set(name, next);
      }
      cur = next;
    }
    const fileName = parts[parts.length - 1]!;
    cur.files.push({ kind: 'file', name: fileName, change });
  }
  return finalizeDir(root).children;
}

export function statusLabel(c: TGitChangeDto): string {
  if (c.index === '?' || c.worktree === '?') return 'U';
  if (c.staged && c.unstaged) return `${c.index}${c.worktree}`;
  if (c.staged) return c.index.trim() || 'S';
  return c.worktree.trim() || 'M';
}

export class DifferTreeCtrl extends Controller<TData, TProps, TState> {
  private shell: CodeEditorShellCtrl | null = null;

  constructor() {
    super({
      data: {
        changes: [],
        tree: [],
        selectedPath: null,
        diffText: '',
        diffStaged: false,
        rows: [],
      },
      props: {},
      state: { loading: false, expanded: {} },
    });
  }

  bindShell(shell: CodeEditorShellCtrl): void {
    this.shell = shell;
  }

  isExpanded(dirPath: string): boolean {
    return this.state.expanded[dirPath] !== false;
  }

  toggleDir(dirPath: string): void {
    const next = !this.isExpanded(dirPath);
    this.setState({
      expanded: { ...this.state.expanded, [dirPath]: next },
    });
  }

  private collectDirPaths(
    nodes: TChangeTreeNode[],
    acc: string[] = [],
  ): string[] {
    for (const n of nodes) {
      if (n.kind !== 'dir') continue;
      acc.push(n.path);
      this.collectDirPaths(n.children, acc);
    }
    return acc;
  }

  expandAll(): void {
    const expanded: Record<string, boolean> = {};
    for (const p of this.collectDirPaths(this.data.tree)) {
      expanded[p] = true;
    }
    this.setState({ expanded });
  }

  collapseAll(): void {
    const expanded: Record<string, boolean> = {};
    for (const p of this.collectDirPaths(this.data.tree)) {
      expanded[p] = false;
    }
    this.setState({ expanded });
  }

  syncFromShell(): void {
    if (!this.shell) return;
    const changes = this.shell.data.gitChanges;
    const diffText = this.shell.data.diffText;
    this.setData({
      changes,
      tree: buildChangeTree(changes),
      selectedPath: this.shell.data.selectedChangePath,
      diffText,
      diffStaged: this.shell.data.diffStaged,
      rows: parseUnifiedDiff(diffText),
    });
    this.setState({ loading: this.shell.state.loadingGit });
  }

  async select(path: string, staged: boolean): Promise<void> {
    await this.shell?.selectChange(path, staged);
    this.syncFromShell();
  }

  async selectChange(change: TGitChangeDto): Promise<void> {
    await this.shell?.selectGitChange(change);
    this.syncFromShell();
  }

  async jump(row: TDiffRow): Promise<void> {
    const path = this.data.selectedPath;
    if (!path || !this.shell) return;
    const line = row.newLine ?? row.oldLine;
    if (line == null) {
      await this.shell.revealInFiles(path);
      return;
    }
    await this.shell.jumpFromDiff(path, line);
  }

  async openFile(path: string): Promise<void> {
    await this.shell?.revealInFiles(path);
  }

  async refresh(): Promise<void> {
    await this.shell?.refreshGit();
    this.syncFromShell();
  }
}
