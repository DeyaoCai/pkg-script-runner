import { Controller } from '@pkg-runner/controller';
import type { TWindowBridge } from '../windowBridge.js';

export type TitleBarColorEnv = 'prod' | 'test';

/** Brand + window chrome — subclasses add app-specific data/state. */
export type TitleBarShellData = {
  productName: string;
  subtitle: string;
  colorEnv: TitleBarColorEnv;
  maximized: boolean;
  /**
   * Brand mark URL.
   * - `null` / omitted → use shared `@pkg-runner/assets/media/logo.png`
   * - `''` → hide mark
   * - other string → custom URL
   */
  logoUrl: string | null;
};

export function defaultTitleBarShellData(
  patch: Partial<TitleBarShellData> = {},
): TitleBarShellData {
  return {
    productName: '',
    subtitle: '',
    colorEnv: 'prod',
    maximized: false,
    logoUrl: null,
    ...patch,
  };
}

/**
 * Base Ctrl for frameless title bars: brand fields + window controls.
 * Slot chrome on {@link TitleBarShell.vue}:
 * - `#leading` — chips / nav (TitleBarChip)
 * - default — meta / path (TitleBarMeta)
 * - `#actions` — tools (TitleBarAction), then WindowControls
 * Floating menus: ShellPanel + `@pkg-runner/ui/panel.css`.
 */

export abstract class TitleBarShellCtrl<
  TData extends TitleBarShellData = TitleBarShellData,
  TProps extends object = Record<string, never>,
  TState extends object = Record<string, never>,
> extends Controller<TData, TProps, TState> {
  /** Preload window API; null when bridge not ready. */
  abstract getWindowApi(): TWindowBridge | null | undefined;

  get windowBridge(): TWindowBridge | null {
    return this.getWindowApi() ?? null;
  }

  get showEnvBadge(): boolean {
    return this.data.colorEnv === 'test';
  }

  setMaximized(value: boolean): void {
    this.setData({ maximized: value } as Partial<TData>);
  }

  setBrand(patch: Partial<Pick<TitleBarShellData, 'productName' | 'subtitle' | 'colorEnv' | 'logoUrl'>>): void {
    this.setData(patch as Partial<TData>);
  }

  async minimize(): Promise<void> {
    await this.getWindowApi()?.windowMinimize();
  }

  async maximize(): Promise<void> {
    const api = this.getWindowApi();
    if (!api) return;
    const v = await api.windowMaximize();
    if (typeof v === 'boolean') this.setMaximized(v);
  }

  async closeWin(): Promise<void> {
    await this.getWindowApi()?.windowClose();
  }

  /** Sync maximized from host (call on mount). */
  async refreshMaximized(): Promise<void> {
    const api = this.getWindowApi();
    if (!api?.windowIsMaximized) return;
    const v = await api.windowIsMaximized();
    this.setMaximized(!!v);
  }

  /** Subscribe to maximize changes; returns unsubscribe. */
  bindMaximizedEvents(): () => void {
    const api = this.getWindowApi();
    if (!api?.onMaximizedChange) return () => undefined;
    return api.onMaximizedChange((maximized) => {
      this.setMaximized(maximized);
    });
  }
}
