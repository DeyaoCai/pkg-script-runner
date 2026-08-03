import {
  TitleBarShellCtrl,
  defaultTitleBarShellData,
  type TitleBarShellData,
} from '@pkg-runner/shell/renderer';
import type { TWindowBridge } from '@pkg-runner/shell/renderer';
import type { AppCtrl } from '../../App/AppCtrl';
import { sameDir } from '../../lib/fuzzy';

type TData = TitleBarShellData;
type TProps = Record<string, never>;
type TState = {
  busy: boolean;
  repoMenuOpen: boolean;
};

export class TitleBarCtrl extends TitleBarShellCtrl<TData, TProps, TState> {
  constructor(readonly app: AppCtrl) {
    super({
      data: defaultTitleBarShellData({
        productName: 'Pkg Runner',
        subtitle: 'scripts · tray',
        colorEnv: 'prod',
      }),
      props: {},
      state: { busy: false, repoMenuOpen: false },
    });
  }

  getWindowApi(): TWindowBridge | null {
    const api = this.app.api;
    if (!api?.windowMinimize) return null;
    return {
      windowMinimize: () => api.windowMinimize(),
      windowMaximize: () => api.windowMaximize(),
      windowClose: () => api.windowClose(),
      windowIsMaximized: () => api.windowIsMaximized(),
      onMaximizedChange: (cb) => api.onMaximized(cb),
    };
  }

  /** Keep brand + maximized in sync with AppCtrl. */
  syncFromApp(): void {
    const env = this.app.data.colorEnv === 'test' ? 'test' : 'prod';
    this.setData({
      colorEnv: env,
      subtitle: 'scripts · tray',
      maximized: this.app.data.maximized,
    });
  }

  override setMaximized(value: boolean): void {
    super.setMaximized(value);
    this.app.setData({ maximized: value });
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

  dispose(): void {
    /* no-op */
  }
}
