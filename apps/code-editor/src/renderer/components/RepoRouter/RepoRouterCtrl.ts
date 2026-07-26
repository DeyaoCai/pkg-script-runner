import { Controller } from '@pkg-runner/controller';
import type { TRepoDto } from '../../bridge.ts';
import type { CodeEditorShellCtrl } from '../../CodeEditorShell/CodeEditorShellCtrl.ts';

export type TRepoDirNode = {
  kind: 'dir';
  name: string;
  /** folder path relative to workspace, with trailing slash; '' for virtual root kids */
  path: string;
  children: TRepoTreeNode[];
  repoCount: number;
};

export type TRepoLeafNode = {
  kind: 'repo';
  name: string;
  abs: string;
  rel: string;
  active: boolean;
};

export type TRepoTreeNode = TRepoDirNode | TRepoLeafNode;

type TMutableDir = {
  kind: 'dir';
  name: string;
  path: string;
  dirs: Map<string, TMutableDir>;
  repos: TRepoLeafNode[];
};

function emptyDir(name: string, path: string): TMutableDir {
  return { kind: 'dir', name, path, dirs: new Map(), repos: [] };
}

function finalize(dir: TMutableDir): TRepoDirNode {
  const children: TRepoTreeNode[] = [
    ...[...dir.dirs.values()]
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      .map(finalize),
    ...dir.repos.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    ),
  ];
  let repoCount = dir.repos.length;
  for (const c of children) {
    if (c.kind === 'dir') repoCount += c.repoCount;
  }
  return {
    kind: 'dir',
    name: dir.name,
    path: dir.path,
    children,
    repoCount,
  };
}

/** Organize flat repos into a path drop-tree under the workspace. */
export function buildRepoDropTree(repos: TRepoDto[]): TRepoTreeNode[] {
  const root = emptyDir('', '');
  for (const r of repos) {
    const parts = (r.rel || '').replace(/\\/g, '/').split('/').filter(Boolean);
    if (!parts.length) {
      // workspace itself as repo
      root.repos.push({
        kind: 'repo',
        name: r.name || '工作区',
        abs: r.abs,
        rel: r.rel,
        active: r.active,
      });
      continue;
    }
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
    const leafName = parts[parts.length - 1]!;
                cur.repos.push({
                  kind: 'repo',
                  name: leafName,
                  abs: r.abs,
                  rel: r.rel,
                  active: r.active,
                });
  }
  return finalize(root).children;
}

function collectDirPaths(nodes: TRepoTreeNode[], acc: string[] = []): string[] {
  for (const n of nodes) {
    if (n.kind !== 'dir') continue;
    acc.push(n.path);
    collectDirPaths(n.children, acc);
  }
  return acc;
}

/** Paths of dirs on the route to the active repo (for auto-expand). */
function pathsToActive(nodes: TRepoTreeNode[]): string[] {
  const walk = (list: TRepoTreeNode[], trail: string[]): string[] | null => {
    for (const n of list) {
      if (n.kind === 'repo' && n.active) return trail;
      if (n.kind === 'dir') {
        const hit = walk(n.children, [...trail, n.path]);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(nodes, []) ?? [];
}

type TData = {
  repos: TRepoDto[];
  tree: TRepoTreeNode[];
  activeAbs: string | null;
  workspaceRoot: string | null;
};

type TProps = Record<string, never>;
type TState = {
  loading: boolean;
  menuOpen: boolean;
  /** dir path → expanded; missing = true by default until user collapses */
  expanded: Record<string, boolean>;
};

function sameAbs(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.replace(/[\\/]+$/, '').toLowerCase() ===
    b.replace(/[\\/]+$/, '').toLowerCase()
  );
}

export class RepoRouterCtrl extends Controller<TData, TProps, TState> {
  private shell: CodeEditorShellCtrl | null = null;
  /** review → projectRoot；design → designRoot（同源工作区仓库列表） */
  readonly zone: 'review' | 'design';

  constructor(zone: 'review' | 'design' = 'review') {
    super({
      data: { repos: [], tree: [], activeAbs: null, workspaceRoot: null },
      props: {},
      state: { loading: false, menuOpen: false, expanded: {} },
    });
    this.zone = zone;
  }

  bindShell(shell: CodeEditorShellCtrl): void {
    this.shell = shell;
  }

  toggleMenu(): void {
    this.setState({ menuOpen: !this.state.menuOpen });
  }

  closeMenu(): void {
    if (this.state.menuOpen) this.setState({ menuOpen: false });
  }

  isExpanded(dirPath: string): boolean {
    return this.state.expanded[dirPath] !== false;
  }

  toggleDir(dirPath: string): void {
    this.setState({
      expanded: {
        ...this.state.expanded,
        [dirPath]: !this.isExpanded(dirPath),
      },
    });
  }

  expandAll(): void {
    const expanded: Record<string, boolean> = {};
    for (const p of collectDirPaths(this.data.tree)) expanded[p] = true;
    this.setState({ expanded });
  }

  collapseAll(): void {
    const expanded: Record<string, boolean> = {};
    for (const p of collectDirPaths(this.data.tree)) expanded[p] = false;
    this.setState({ expanded });
  }

  syncFromShell(): void {
    if (!this.shell) return;
    const activeAbs =
      this.zone === 'design'
        ? this.shell.data.designRoot
        : this.shell.data.projectRoot;
    const repos = this.shell.data.repos.map((r) => ({
      ...r,
      active: sameAbs(r.abs, activeAbs),
    }));
    const tree = buildRepoDropTree(repos);
    this.setData({
      repos,
      tree,
      activeAbs,
      workspaceRoot: this.shell.data.workspaceRoot,
    });
    // ensure path to active repo is expanded
    const ensure: Record<string, boolean> = { ...this.state.expanded };
    for (const p of pathsToActive(tree)) {
      if (ensure[p] === undefined) ensure[p] = true;
    }
    this.setState({ expanded: ensure });
  }

  async select(repoAbs: string): Promise<void> {
    if (this.zone === 'design') {
      await this.shell?.selectDesignRepo(repoAbs);
    } else {
      await this.shell?.selectRepo(repoAbs);
    }
    this.syncFromShell();
    this.closeMenu();
  }
}
