import { Controller } from '@pkg-runner/controller';
import type { AppCtrl } from '../../App/AppCtrl';

type TData = Record<string, never>;
type TProps = Record<string, never>;
type TState = Record<string, never>;

export class TitleBarCtrl extends Controller<TData, TProps, TState> {
  constructor(readonly app: AppCtrl) {
    super({
      data: {},
      props: {},
      state: {},
    });
  }

  get maxIconClass(): string {
    return this.app.data.maximized ? 'ico ico-restore' : 'ico ico-max';
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
