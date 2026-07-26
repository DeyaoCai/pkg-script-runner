import { Controller } from '@pkg-runner/controller';
import type { AppCtrl } from '../../App/AppCtrl';

type TData = Record<string, never>;
type TProps = Record<string, never>;
type Popover = {
  name: string;
  command: string;
  x: number;
  y: number;
  running: boolean;
} | null;

type TState = {
  popover: Popover;
};

export class ScriptsPanelCtrl extends Controller<TData, TProps, TState> {
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly app: AppCtrl) {
    super({
      data: {},
      props: {},
      state: { popover: null },
    });
  }

  get label(): string {
    const total = this.app.data.project?.scripts.length || 0;
    const shown = this.app.filteredScripts.length;
    if (!this.app.data.project) return '可执行';
    return `脚本 (${shown}/${total})`;
  }

  isRunning(name: string): boolean {
    const dir = this.app.data.project?.dir;
    if (!dir) return false;
    return !!this.app.findJob(dir, name);
  }

  actionLabel(name: string): string {
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
