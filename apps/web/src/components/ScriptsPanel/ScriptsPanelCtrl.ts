import { Controller } from '@pkg-runner/controller';
import type { AppCtrl } from '../../App/AppCtrl';
import { filterBestScore } from '../../lib/fuzzy';
import {
  isScriptFavorite,
  loadScriptFavorites,
  saveScriptFavorites,
  toggleScriptFavorite,
  type ScriptFavorite,
} from '../../lib/scriptFavorites';

type TData = {
  favorites: ScriptFavorite[];
  /** Normalized dir keys that are expanded (default: all collapsed) */
  expandedDirs: string[];
};
type TProps = Record<string, never>;
type Popover = {
  dir: string;
  name: string;
  command: string;
  x: number;
  y: number;
  running: boolean;
} | null;

type ScriptsMode = 'scripts' | 'running' | 'favorites';

type TState = {
  popover: Popover;
  mode: ScriptsMode;
  refreshing: boolean;
};

type ScriptRow = {
  dir: string;
  scriptName: string;
  command: string;
};

const EXPAND_KEY = 'pkg-runner:script-groups-expanded';
const LEGACY_COLLAPSE_KEY = 'pkg-runner:script-groups-collapsed';

function dirKey(dir: string): string {
  return dir.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
}

function loadExpandedDirs(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(EXPAND_KEY) || 'null') as unknown;
    if (Array.isArray(raw)) {
      return raw.filter((x): x is string => typeof x === 'string' && !!x);
    }
    // One-shot: old key stored collapsed dirs — invert is not possible without full list,
    // so drop legacy and start from default (all collapsed).
    localStorage.removeItem(LEGACY_COLLAPSE_KEY);
  } catch {
    /* ignore */
  }
  return [];
}

function saveExpandedDirs(list: string[]): void {
  try {
    localStorage.setItem(EXPAND_KEY, JSON.stringify(list));
    localStorage.removeItem(LEGACY_COLLAPSE_KEY);
  } catch {
    /* ignore */
  }
}

export class ScriptsPanelCtrl extends Controller<TData, TProps, TState> {
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly app: AppCtrl) {
    super({
      data: {
        favorites: loadScriptFavorites(),
        expandedDirs: loadExpandedDirs(),
      },
      props: {},
      state: { popover: null, mode: 'scripts', refreshing: false },
    });
  }

  get mode(): ScriptsMode {
    return this.state.mode;
  }

  get refreshing(): boolean {
    return this.state.refreshing;
  }

  setMode(mode: ScriptsMode): void {
    if (this.state.mode === mode) return;
    this.setState({ mode, popover: null });
  }

  get label(): string {
    const q = this.app.data.scriptSearch.trim();
    if (this.state.mode === 'running') {
      const total = this.app.activeJobsList.length;
      const n = this.runningGroups.reduce((sum, g) => sum + g.jobs.length, 0);
      if (!total) return '运行中';
      return q ? `运行中 (${n}/${total})` : `运行中 (${n})`;
    }
    if (this.state.mode === 'favorites') {
      const total = this.data.favorites.length;
      const n = this.favoriteGroups.reduce((sum, g) => sum + g.jobs.length, 0);
      if (!total) return '收藏';
      return q ? `收藏 (${n}/${total})` : `收藏 (${n})`;
    }
    const all = this.app.allScriptsFlat;
    const shown = this.scriptGroups.reduce((n, g) => n + g.jobs.length, 0);
    if (!this.app.data.workspaceRoot) return '可执行';
    if (!this.app.data.projects.length) return '可执行';
    return `脚本 (${shown}/${all.length})`;
  }

  get runningCount(): number {
    return this.app.activeJobsList.length;
  }

  get favoriteCount(): number {
    return this.data.favorites.length;
  }

  isGroupCollapsed(dir: string): boolean {
    return !this.data.expandedDirs.includes(dirKey(dir));
  }

  toggleGroupCollapsed(dir: string): void {
    const key = dirKey(dir);
    const set = new Set(this.data.expandedDirs);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    const next = [...set];
    saveExpandedDirs(next);
    this.setData({ expandedDirs: next });
  }

  onToggleGroup(e: MouseEvent, dir: string): void {
    e.preventDefault();
    this.toggleGroupCollapsed(dir);
  }

  isFavorite(dir: string, scriptName: string): boolean {
    return isScriptFavorite(this.data.favorites, dir, scriptName);
  }

  toggleFavorite(dir: string, scriptName: string): void {
    const next = toggleScriptFavorite(this.data.favorites, dir, scriptName);
    saveScriptFavorites(next);
    this.setData({ favorites: next });
  }

  onToggleFavorite(e: MouseEvent, dir: string, scriptName: string): void {
    e.stopPropagation();
    e.preventDefault();
    this.toggleFavorite(dir, scriptName);
  }

  isRunning(dir: string, name: string): boolean {
    return this.app.isScriptBusy(dir, name);
  }

  isStopping(dir: string, name: string): boolean {
    return this.app.isScriptStopping(dir, name);
  }

  actionLabel(dir: string, name: string): string {
    if (this.isStopping(dir, name)) return `正在停止 ${name}…`;
    return this.isRunning(dir, name)
      ? `停止 ${name}（双击或 Enter）`
      : `运行 ${name}（双击或 Enter）`;
  }

  async onActivate(dir: string, name: string): Promise<void> {
    this.setState({ popover: null });
    await this.app.runScriptAt(dir, name);
  }

  onClick(e: MouseEvent, dir: string, name: string): void {
    if (e.detail !== 0) return;
    void this.onActivate(dir, name);
  }

  async onActivateFav(dir: string, scriptName: string): Promise<void> {
    this.setState({ popover: null });
    await this.app.runScriptAt(dir, scriptName);
  }

  onClickFav(e: MouseEvent, dir: string, scriptName: string): void {
    if (e.detail !== 0) return;
    void this.onActivateFav(dir, scriptName);
  }

  projectLabel(dir: string): string {
    return this.app.projectLabelForDir(dir);
  }

  get scriptGroups(): Array<{
    dir: string;
    label: string;
    jobs: ScriptRow[];
  }> {
    const q = this.app.data.scriptSearch.trim();
    const groups: Array<{ dir: string; label: string; jobs: ScriptRow[] }> = [];
    for (const p of this.app.data.projects) {
      const payload = this.app.projectPayloadForDir(p.dir);
      if (!payload) {
        if (q) continue;
        groups.push({ dir: p.dir, label: p.name, jobs: [] });
        continue;
      }
      let scripts = payload.scripts.map((s) => ({
        dir: payload.dir,
        scriptName: s.name,
        command: s.command,
      }));
      if (q) {
        scripts = scripts
          .map((s) => ({
            s,
            score: filterBestScore(q, [s.scriptName, s.command, p.name, payload.dir]),
          }))
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .map((x) => x.s);
      } else {
        scripts.sort((a, b) => a.scriptName.localeCompare(b.scriptName, 'zh'));
      }
      if (q && !scripts.length) continue;
      groups.push({
        dir: payload.dir,
        label: payload.name || p.name,
        jobs: scripts,
      });
    }
    groups.sort((a, b) => a.label.localeCompare(b.label, 'zh'));
    return groups;
  }

  /** Running jobs grouped by project dir. */
  get runningGroups(): Array<{
    dir: string;
    label: string;
    jobs: Array<{
      id: string;
      dir: string;
      scriptName: string;
      stopping: boolean;
    }>;
  }> {
    const q = this.app.data.scriptSearch.trim();
    const list = q
      ? this.app.activeJobsList.filter(
          (j) =>
            filterBestScore(q, [
              j.scriptName,
              this.app.projectLabelForDir(j.dir),
              j.dir,
            ]) > 0,
        )
      : this.app.activeJobsList;
    return this.groupByProjectDir(list, (j) => j.dir);
  }

  /** Favorites grouped by project dir. */
  get favoriteGroups(): Array<{
    dir: string;
    label: string;
    jobs: ScriptFavorite[];
  }> {
    const q = this.app.data.scriptSearch.trim();
    const list = q
      ? this.data.favorites.filter((f) => {
          const payload = this.app.projectPayloadForDir(f.dir);
          const cmd =
            payload?.scripts.find((s) => s.name === f.scriptName)?.command || '';
          return (
            filterBestScore(q, [
              f.scriptName,
              cmd,
              this.app.projectLabelForDir(f.dir),
              f.dir,
            ]) > 0
          );
        })
      : this.data.favorites;
    return this.groupByProjectDir(list, (f) => f.dir);
  }

  private groupByProjectDir<T extends { dir: string; scriptName: string }>(
    items: T[],
    dirOf: (item: T) => string,
  ): Array<{ dir: string; label: string; jobs: T[] }> {
    const groups: Array<{ dir: string; label: string; jobs: T[] }> = [];
    const index = new Map<string, number>();
    for (const item of items) {
      const dir = dirOf(item);
      const key = dirKey(dir);
      let i = index.get(key);
      if (i == null) {
        i = groups.length;
        index.set(key, i);
        groups.push({
          dir,
          label: this.app.projectLabelForDir(dir),
          jobs: [],
        });
      }
      groups[i]!.jobs.push(item);
    }
    groups.sort((a, b) => a.label.localeCompare(b.label, 'zh'));
    for (const g of groups) {
      g.jobs.sort((a, b) => a.scriptName.localeCompare(b.scriptName, 'zh'));
    }
    return groups;
  }

  async onFocusJob(jobId: string): Promise<void> {
    this.setState({ popover: null });
    await this.app.focusJobLog(jobId);
  }

  async onStopJob(e: MouseEvent, jobId: string): Promise<void> {
    e.stopPropagation();
    e.preventDefault();
    await this.app.stopJob(jobId);
  }

  async onStopGroup(e: MouseEvent, dir: string): Promise<void> {
    e.stopPropagation();
    e.preventDefault();
    await this.app.stopJobsInDir(dir);
  }

  async onRefresh(): Promise<void> {
    if (this.state.refreshing) return;
    this.setState({ refreshing: true });
    try {
      await this.app.refreshProjects();
    } finally {
      this.setState({ refreshing: false });
    }
  }

  async onStopAll(): Promise<void> {
    await this.app.stopAllJobs();
  }

  showPop(e: MouseEvent, dir: string, name: string, command: string): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    this.setState({
      popover: {
        dir,
        name,
        command,
        x: Math.min(r.right + 8, window.innerWidth - 280),
        y: r.top,
        running: this.isRunning(dir, name),
      },
    });
  }

  scheduleHide(): void {
    this.hideTimer = setTimeout(() => {
      this.setState({ popover: null });
    }, 120);
  }
}
