import { Controller } from '@pkg-runner/controller';
import type { AppCtrl } from '../../App/AppCtrl';

type TData = Record<string, never>;
type TProps = Record<string, never>;
type TState = {
  themeOpen: boolean;
};

export class TitleBarCtrl extends Controller<TData, TProps, TState> {
  private onKey: ((e: KeyboardEvent) => void) | null = null;

  constructor(readonly app: AppCtrl) {
    super({
      data: {},
      props: {},
      state: { themeOpen: false },
    });
    this.onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.state.themeOpen) this.closeTheme();
    };
    window.addEventListener('keydown', this.onKey);
  }

  get maxIconClass(): string {
    return this.app.data.maximized ? 'ico ico-restore' : 'ico ico-max';
  }

  toggleTheme(): void {
    this.setState({ themeOpen: !this.state.themeOpen });
  }

  closeTheme(): void {
    this.setState({ themeOpen: false });
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
    if (this.onKey) window.removeEventListener('keydown', this.onKey);
    this.onKey = null;
  }
}
