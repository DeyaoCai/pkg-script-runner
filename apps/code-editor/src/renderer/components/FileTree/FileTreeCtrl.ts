import { Controller } from '@pkg-runner/controller';
import type { TFsEntryDto } from '../../bridge.ts';
import type { CodeEditorShellCtrl } from '../../CodeEditorShell/CodeEditorShellCtrl.ts';

type TNode = TFsEntryDto & { children?: TNode[]; loaded?: boolean };

type TData = {
  roots: TNode[];
  repoName: string;
  /** true when current repo is nested under another selectable repo / workspace */
  canGoParentRepo: boolean;
};

function samePathKey(a: string, b: string): boolean {
  return (
    a.replace(/[\\/]+$/, '').toLowerCase() ===
    b.replace(/[\\/]+$/, '').toLowerCase()
  );
}

/** True when `target` is strictly inside `root`. */
function isStrictInside(root: string, target: string): boolean {
  const r = root.replace(/[\\/]+$/, '').toLowerCase();
  const t = target.replace(/[\\/]+$/, '').toLowerCase();
  if (t === r) return false;
  return t.startsWith(`${r}/`) || t.startsWith(`${r}\\`);
}

type TProps = Record<string, never>;
type TState = {
  expanded: Record<string, boolean>;
  /** highlighted / scrolled-to path in the tree */
  selectedPath: string | null;
  /** bumps when locate runs so the view can scroll */
  locateSeq: number;
  loading: boolean;
  error: string;
};

function normalizeRel(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\/+/, '');
}

/** Parent directory paths for `a/b/c.ts` → `['a', 'a/b']`. */
function parentDirs(relPath: string): string[] {
  const parts = normalizeRel(relPath).split('/').filter(Boolean);
  const dirs: string[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    dirs.push(parts.slice(0, i + 1).join('/'));
  }
  return dirs;
}

function findNode(nodes: TNode[], relPath: string): TNode | null {
  const want = normalizeRel(relPath);
  for (const n of nodes) {
    if (normalizeRel(n.relPath) === want) return n;
    if (n.children?.length) {
      const hit = findNode(n.children, want);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Shared directory tree:
 * - code：Review 全量文件 + 嵌套仓库
 * - docs：Design 只读文档过滤（.md / .txt …）
 */
export class FileTreeCtrl extends Controller<TData, TProps, TState> {
  private shell: CodeEditorShellCtrl | null = null;
  readonly zone: 'code' | 'docs';

  constructor(zone: 'code' | 'docs' = 'code') {
    super({
      data: { roots: [], repoName: '', canGoParentRepo: false },
      props: {},
      state: {
        expanded: {},
        selectedPath: null,
        locateSeq: 0,
        loading: false,
        error: '',
      },
    });
    this.zone = zone;
  }

  bindShell(shell: CodeEditorShellCtrl): void {
    this.shell = shell;
  }

  clear(): void {
    this.setData({ roots: [], repoName: '', canGoParentRepo: false });
    this.setState({
      expanded: {},
      selectedPath: null,
      error: '',
    });
  }

  private boundRoot(): string | null {
    if (!this.shell) return null;
    return this.zone === 'docs'
      ? this.shell.data.designRoot
      : this.shell.data.projectRoot;
  }

  private async listDir(relPath: string): Promise<TFsEntryDto[]> {
    if (!this.shell) return [];
    if (this.zone === 'docs') {
      return this.shell.bridge.listDesignDir(relPath);
    }
    return this.shell.bridge.listDir(relPath);
  }

  /** Closest selectable ancestor repo (or workspace); null if already at top. */
  private parentRepoAbs(): string | null {
    if (this.zone !== 'code') return null;
    const shell = this.shell;
    const cur = shell?.data.projectRoot;
    const ws = shell?.data.workspaceRoot;
    if (!shell || !cur || !ws) return null;
    if (samePathKey(cur, ws)) return null;

    let best: string | null = null;
    let bestLen = -1;
    for (const r of shell.data.repos) {
      if (!isStrictInside(r.abs, cur)) continue;
      const len = r.abs.replace(/[\\/]+$/, '').length;
      if (len > bestLen) {
        best = r.abs;
        bestLen = len;
      }
    }
    return best || ws;
  }

  async goParentRepo(): Promise<void> {
    if (this.zone !== 'code') return;
    const abs = this.parentRepoAbs();
    if (!abs) return;
    await this.shell?.selectRepo(abs);
  }

  async reload(): Promise<void> {
    const root = this.boundRoot();
    if (!root) {
      this.clear();
      return;
    }
    this.setState({ loading: true, error: '' });
    try {
      const roots = await this.listDir('');
      let name: string;
      if (this.zone === 'docs') {
        name = root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'docs';
      } else {
        const ws = this.shell!.data.workspaceRoot;
        name = samePathKey(root, ws || '')
          ? '工作区'
          : root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'repo';
      }
      this.setData({
        roots,
        repoName: name,
        canGoParentRepo: this.zone === 'code' && !!this.parentRepoAbs(),
      });
      this.setState({ expanded: {}, selectedPath: null });
    } catch (e) {
      this.setState({ error: e instanceof Error ? e.message : String(e) });
      this.setData({ roots: [], canGoParentRepo: false });
    } finally {
      this.setState({ loading: false });
    }
  }

  async toggleDir(node: TNode): Promise<void> {
    if (this.zone === 'code' && node.isRepo) {
      await this.shell?.selectNestedRepo(node.relPath);
      return;
    }
    const key = node.relPath;
    const open = !!this.state.expanded[key];
    if (open) {
      this.setState({ expanded: { ...this.state.expanded, [key]: false } });
      return;
    }
    this.setState({ expanded: { ...this.state.expanded, [key]: true } });
    await this.ensureDirLoaded(key);
  }

  private async ensureDirLoaded(relPath: string): Promise<void> {
    if (!this.shell) return;
    const node = findNode(this.data.roots, relPath);
    if (!node || node.kind !== 'dir') return;
    if (this.zone === 'code' && node.isRepo) return;
    if (node.loaded) return;
    try {
      const children = await this.listDir(relPath);
      this.patchChildren(relPath, children);
    } catch (e) {
      this.setState({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  private patchChildren(relPath: string, children: TFsEntryDto[]): void {
    const walk = (nodes: TNode[]): TNode[] =>
      nodes.map((n) => {
        if (n.relPath === relPath) {
          return { ...n, children, loaded: true };
        }
        if (n.children) return { ...n, children: walk(n.children) };
        return n;
      });
    this.setData({ roots: walk(this.data.roots) });
  }

  /** Expand ancestors, highlight, and request scroll to `relPath`. */
  async locate(relPath: string): Promise<void> {
    if (!this.boundRoot()) return;
    const path = normalizeRel(relPath);
    if (!path) return;

    if (this.zone === 'code') {
      this.shell?.showLeftTool('files');
    }

    if (!this.data.roots.length) {
      await this.reload();
    }

    const expanded = { ...this.state.expanded };
    for (const dir of parentDirs(path)) {
      expanded[dir] = true;
      this.setState({ expanded });
      await this.ensureDirLoaded(dir);
    }

    const found = !!findNode(this.data.roots, path);
    this.setState({
      expanded,
      selectedPath: path,
      locateSeq: this.state.locateSeq + 1,
    });
    this.shell?.setData({
      statusMessage: found
        ? this.zone === 'docs'
          ? `已定位文档 · ${path}`
          : `已定位 · ${path}`
        : this.zone === 'docs'
          ? `未找到文档: ${path}`
          : `目录中未找到: ${path}`,
    });
  }

  async locateActive(): Promise<void> {
    if (this.zone === 'docs') {
      const rel = this.shell?.data.designDocPath;
      if (!rel) {
        this.shell?.setData({ statusMessage: '没有打开的文档' });
        return;
      }
      await this.locate(rel);
      return;
    }
    const rel = this.shell?.activeTab?.relPath;
    if (!rel) {
      this.shell?.setData({ statusMessage: '没有打开的文件' });
      return;
    }
    await this.locate(rel);
  }

  async openFile(relPath: string): Promise<void> {
    this.setState({ selectedPath: normalizeRel(relPath) });
    if (this.zone === 'docs') {
      await this.shell?.openDesignDoc(relPath);
      return;
    }
    await this.shell?.openFile(relPath);
  }

  async showInExplorer(relPath?: string | null): Promise<void> {
    if (this.zone === 'docs') {
      if (!relPath) {
        await this.shell?.showDesignInExplorer();
        return;
      }
      await this.shell?.revealDesignPath(relPath);
      return;
    }
    await this.shell?.showInExplorer(relPath ?? null);
  }
}
