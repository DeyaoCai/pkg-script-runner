import { Controller } from '@pkg-runner/controller';
import { nextTick } from 'vue';
import type { AppCtrl } from '../../App/AppCtrl';
import { sameDir } from '../../lib/fuzzy';

type TData = Record<string, never>;
type TProps = Record<string, never>;
type TState = {
  pathInput: string;
  confirmDir: string | null;
};

export class ProjectsPanelCtrl extends Controller<TData, TProps, TState> {
  constructor(readonly app: AppCtrl) {
    super({
      data: {},
      props: {},
      state: { pathInput: '', confirmDir: null },
    });
  }

  get confirmName(): string {
    const dir = this.state.confirmDir;
    if (!dir) return '';
    return this.app.data.projects.find((p) => sameDir(p.dir, dir))?.name || '未命名项目';
  }

  isActive(dir: string): boolean {
    return sameDir(dir, this.app.data.activeProject);
  }

  async onAdd(): Promise<void> {
    await this.app.pickAndAddProject();
  }

  async onPathEnter(): Promise<void> {
    const dir = this.state.pathInput.trim();
    if (!dir) return;
    await this.app.addProjectFromDir(dir);
    this.setState({ pathInput: '' });
  }

  askRemove(dir: string): void {
    this.setState({ confirmDir: dir });
  }

  cancelRemove(): void {
    this.setState({ confirmDir: null });
  }

  async confirmRemove(): Promise<void> {
    if (!this.state.confirmDir) return;
    await this.app.removeProject(this.state.confirmDir);
    this.setState({ confirmDir: null });
  }

  onConfirmKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.cancelRemove();
    }
  }

  async focusConfirmDanger(card: HTMLElement | null): Promise<void> {
    if (!this.state.confirmDir) return;
    await nextTick();
    card?.querySelector<HTMLElement>('.btn.danger')?.focus();
  }
}
