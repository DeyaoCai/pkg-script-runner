import { Controller } from '@pkg-runner/controller';
import type { AppCtrl } from '../../App/AppCtrl';
import { sameDir } from '../../lib/fuzzy';

type TData = Record<string, never>;
type TProps = Record<string, never>;
type TState = {
  busy: boolean;
  repoMenuOpen: boolean;
};

export class TitleBarCtrl extends Controller<TData, TProps, TState> {
  constructor(readonly app: AppCtrl) {
    super({
      data: {},
      props: {},
      state: { busy: false, repoMenuOpen: false },
    });
  }

  get maxIconClass(): string {
    return this.app.data.maximized ? 'ico ico-restore' : 'ico ico-max';
  }

  isActive(dir: string): boolean {
    return sameDir(dir, this.app.data.activeProject);
  }

  toggleRepoMenu(): void {
    if (!this.app.data.workspaceRoot) return;
    this.setState({ repoMenuOpen: !this.state.repoMenuOpen });
  }

  closeRepoMenu(): void {
    if (this.state.repoMenuOpen) this.setState({ repoMenuOpen: false });
  }

  async onPickWorkspace(): Promise<void> {
    if (this.state.busy) return;
    this.setState({ busy: true, repoMenuOpen: false });
    try {
      await this.app.pickAndAddProject();
    } finally {
      this.setState({ busy: false });
    }
  }

  async onSelectRepo(dir: string): Promise<void> {
    this.setState({ repoMenuOpen: false, busy: true });
    try {
      await this.app.selectProject(dir);
    } finally {
      this.setState({ busy: false });
    }
  }

  openPorts(): void {
    this.closeRepoMenu();
    this.app.controllers.ports.open();
  }

  async minimize(): Promise<void> {
    await this.app.api?.windowMinimize();
  }

  async maximize(): Promise<void> {
    const v = await this.app.api?.windowMaximize();
    if (typeof v === 'boolean') this.app.setData({ maximized: v });
  }

  async closeWin(): Promise<void> {
    await this.app.api?.windowClose();
  }

  dispose(): void {
    /* no-op */
  }
}
