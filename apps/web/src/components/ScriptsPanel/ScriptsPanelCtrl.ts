import { Controller } from '@pkg-runner/controller';
import type { AppCtrl } from '../../App/AppCtrl';
import {
  isScriptFavorite,
  loadScriptFavorites,
  saveScriptFavorites,
  toggleScriptFavorite,
  type ScriptFavorite,
} from '../../lib/scriptFavorites';

type TData = {
  favorites: ScriptFavorite[];
};
type TProps = Record<string, never>;
type Popover = {
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
};

export class ScriptsPanelCtrl extends Controller<TData, TProps, TState> {
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly app: AppCtrl) {
    super({
      data: { favorites: loadScriptFavorites() },
      props: {},
      state: { popover: null, mode: 'scripts' },
    });
  }

  get mode(): ScriptsMode {
    return this.state.mode;
  }

  setMode(mode: ScriptsMode): void {
    if (this.state.mode === mode) return;
    this.setState({ mode, popover: null });
  }

  get label(): string {
    if (this.state.mode === 'running') {
      const n = this.app.activeJobsList.length;
      return n ? `运行中 (${n})` : '运行中';
    }
    if (this.state.mode === 'favorites') {
      const n = this.data.favorites.length;
      return n ? `收藏 (${n})` : '收藏';
    }
    const total = this.app.data.project?.scripts.length || 0;
    const shown = this.app.filteredScripts.length;
    if (!this.app.data.project) return '可执行';
    return `脚本 (${shown}/${total})`;
  }

  get runningCount(): number {
    return this.app.activeJobsList.length;
  }

  get favoriteCount(): number {
    return this.data.favorites.length;
  }

  isFavorite(dir: string, scriptName: string): boolean {
    return isScriptFavorite(this.data.favorites, dir, scriptName);
  }

  isFavoriteCurrent(scriptName: string): boolean {
    const dir = this.app.data.project?.dir;
    if (!dir) return false;
    return this.isFavorite(dir, scriptName);
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

  onToggleFavoriteCurrent(e: MouseEvent, scriptName: string): void {
    const dir = this.app.data.project?.dir;
    if (!dir) return;
    this.onToggleFavorite(e, dir, scriptName);
  }

  isRunning(name: string): boolean {
    const dir = this.app.data.project?.dir;
    if (!dir) return false;
    return this.app.isScriptBusy(dir, name);
  }

  isStopping(name: string): boolean {
    const dir = this.app.data.project?.dir;
    if (!dir) return false;
    return this.app.isScriptStopping(dir, name);
  }

  isFavRunning(dir: string, scriptName: string): boolean {
    return this.app.isScriptBusy(dir, scriptName);
  }

  isFavStopping(dir: string, scriptName: string): boolean {
    return this.app.isScriptStopping(dir, scriptName);
  }

  actionLabel(name: string): string {
    if (this.isStopping(name)) return `正在停止 ${name}…`;
    return this.isRunning(name)
      ? `停止 ${name}（双击或 Enter）`
      : `运行 ${name}（双击或 Enter）`;
  }

  async onActivate(name: string): Promise<void> {
    this.setState({ popover: null });
    await this.app.runScript(name);
  }

  onClick(e: MouseEvent, name: string): void {
    if (e.detail !== 0) return;
    void this.onActivate(name);
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
    return this.groupByProjectDir(
      this.app.activeJobsList,
      (j) => j.dir,
    );
  }

  /** Favorites grouped by project dir. */
  get favoriteGroups(): Array<{
    dir: string;
    label: string;
    jobs: ScriptFavorite[];
  }> {
    return this.groupByProjectDir(this.data.favorites, (f) => f.dir);
  }

  private groupByProjectDir<T extends { dir: string; scriptName: string }>(
    items: T[],
    dirOf: (item: T) => string,
  ): Array<{ dir: string; label: string; jobs: T[] }> {
    const groups: Array<{ dir: string; label: string; jobs: T[] }> = [];
    const index = new Map<string, number>();
    for (const item of items) {
      const dir = dirOf(item);
      const key = dir.replace(/\\/g, '/').toLowerCase();
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

  async onStopAll(): Promise<void> {
    await this.app.stopAllJobs();
  }

  showPop(e: MouseEvent, name: string, command: string): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    this.setState({
      popover: {
        name,
        command,
        x: Math.min(r.right + 8, window.innerWidth - 280),
        y: r.top,
        running: this.isRunning(name),
      },
    });
  }

  scheduleHide(): void {
    this.hideTimer = setTimeout(() => {
      this.setState({ popover: null });
    }, 120);
  }
}
