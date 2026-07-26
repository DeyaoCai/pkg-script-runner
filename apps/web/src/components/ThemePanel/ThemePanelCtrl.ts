import { Controller } from '@pkg-runner/controller';
import { nextTick } from 'vue';
import type { AppCtrl } from '../../App/AppCtrl';

type TData = Record<string, never>;
type TProps = {
  anchorEl: HTMLElement | null;
};
type TState = Record<string, never>;

export class ThemePanelCtrl extends Controller<TData, TProps, TState> {
  private onDown: ((e: MouseEvent) => void) | null = null;
  private onResize: (() => void) | null = null;
  private panelEl: HTMLElement | null = null;
  private closeCb: (() => void) | null = null;

  constructor(readonly app: AppCtrl) {
    super({
      data: {},
      props: { anchorEl: null },
      state: {},
    });
  }

  setAnchor(el: HTMLElement | null): void {
    this.setProps({ anchorEl: el });
  }

  position(panel: HTMLElement | null): void {
    const btn = this.props.anchorEl;
    if (!panel || !btn) return;
    const rect = btn.getBoundingClientRect();
    const panelWidth = Math.min(280, window.innerWidth - 24);
    let left = rect.right - panelWidth;
    left = Math.max(12, Math.min(left, window.innerWidth - panelWidth - 12));
    let top = rect.bottom + 8;
    const panelHeight = panel.offsetHeight || 220;
    if (top + panelHeight > window.innerHeight - 12) {
      top = Math.max(12, rect.top - panelHeight - 8);
    }
    panel.style.position = 'fixed';
    panel.style.top = `${Math.round(top)}px`;
    panel.style.left = `${Math.round(left)}px`;
    panel.style.right = 'auto';
  }

  async setTheme(t: 'dark' | 'light'): Promise<void> {
    this.app.applyTheme(t);
    await this.app.persistSettings({ theme: t });
  }

  onAlpha(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    this.app.applyGlassVars(v, this.app.data.glassBlur);
    void this.app.persistSettings({ glassAlpha: v });
  }

  onBlur(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    this.app.applyGlassVars(this.app.data.glassAlpha, v);
    try {
      localStorage.setItem('pkg-runner:glass-blur', String(this.app.data.glassBlur));
    } catch {
      /* ignore */
    }
  }

  async mountPanel(panel: HTMLElement, onClose: () => void): Promise<void> {
    this.panelEl = panel;
    this.closeCb = onClose;
    if (panel.parentElement !== document.body) document.body.appendChild(panel);
    await nextTick();
    this.position(panel);
    requestAnimationFrame(() => this.position(panel));

    this.onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.contains(t) || this.props.anchorEl?.contains(t)) return;
      onClose();
    };
    this.onResize = () => this.position(panel);
    document.addEventListener('mousedown', this.onDown);
    window.addEventListener('resize', this.onResize);
  }

  async reposition(): Promise<void> {
    await nextTick();
    this.position(this.panelEl);
  }

  dispose(): void {
    if (this.onDown) document.removeEventListener('mousedown', this.onDown);
    if (this.onResize) window.removeEventListener('resize', this.onResize);
    this.panelEl?.remove();
    this.panelEl = null;
    this.onDown = null;
    this.onResize = null;
    this.closeCb = null;
  }
}
