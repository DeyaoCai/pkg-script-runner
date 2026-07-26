import { Controller } from '@pkg-runner/controller';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { AppCtrl } from '../../App/AppCtrl';
import { termTheme } from '../../lib/tokens';

type TData = Record<string, never>;
type TProps = {
  sessionId: string;
  active: boolean;
};
type TState = Record<string, never>;

export class TerminalViewCtrl extends Controller<TData, TProps, TState> {
  private term: Terminal | null = null;
  private fit: FitAddon | null = null;
  private ro: ResizeObserver | null = null;
  private host: HTMLElement | null = null;

  constructor(readonly app: AppCtrl) {
    super({
      data: {},
      props: { sessionId: '', active: false },
      state: {},
    });
  }

  private onShellData = (e: Event) => {
    const detail = (e as CustomEvent<{ id: string; data: string }>).detail;
    if (!detail || detail.id !== this.props.sessionId || !this.term) return;
    this.term.write(detail.data);
  };

  fitAndResize(): void {
    if (!this.term || !this.fit || !this.props.active) return;
    try {
      this.fit.fit();
      void this.app.api?.shellResize(this.props.sessionId, this.term.cols, this.term.rows);
    } catch {
      /* ignore */
    }
  }

  mount(host: HTMLElement): void {
    this.host = host;
    const pending = this.app.takeShellPending(this.props.sessionId);
    this.term = new Terminal({
      cursorBlink: true,
      fontFamily:
        getComputedStyle(document.documentElement).getPropertyValue('--mono').trim() ||
        'Consolas, monospace',
      fontSize: 13,
      theme: termTheme(),
      convertEol: true,
    });
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    this.term.open(host);
    if (pending) this.term.write(pending);
    this.term.onData((data) => {
      void this.app.api?.shellWrite(this.props.sessionId, data);
    });
    window.addEventListener('pkg:shell-data', this.onShellData);
    this.ro = new ResizeObserver(() => this.fitAndResize());
    this.ro.observe(host);
    requestAnimationFrame(() => this.fitAndResize());
  }

  onThemeChange(): void {
    if (!this.term) return;
    this.term.options.theme = termTheme();
    this.term.refresh(0, this.term.rows - 1);
  }

  onActiveChange(active: boolean): void {
    this.setProps({ active });
    if (active) requestAnimationFrame(() => this.fitAndResize());
  }

  unmount(): void {
    window.removeEventListener('pkg:shell-data', this.onShellData);
    this.ro?.disconnect();
    this.ro = null;
    this.term?.dispose();
    this.term = null;
    this.fit = null;
    this.host = null;
  }
}
