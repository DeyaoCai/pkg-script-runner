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

  private onShellReset = (e: Event) => {
    const detail = (e as CustomEvent<{ id: string; data: string }>).detail;
    if (!detail || detail.id !== this.props.sessionId || !this.term) return;
    this.term.reset();
    if (detail.data) this.term.write(detail.data);
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

  private async copySelection(): Promise<boolean> {
    const text = this.term?.getSelection() ?? '';
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    }
  }

  private async pasteFromClipboard(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      if (text) void this.app.api?.shellWrite(this.props.sessionId, text);
    } catch {
      /* clipboard permission / empty */
    }
  }

  /**
   * Ctrl/Cmd+C：有选区则复制，否则放行给 PTY（^C）。
   * Ctrl/Cmd+V、Shift+Insert：粘贴；Ctrl+Insert：复制选区。
   */
  private onTermKey = (ev: KeyboardEvent): boolean => {
    if (ev.type !== 'keydown' || !this.term) return true;
    const key = ev.key.toLowerCase();
    const mod = ev.ctrlKey || ev.metaKey;

    if (key === 'c' && mod && !ev.altKey) {
      if (ev.shiftKey || this.term.hasSelection()) {
        void this.copySelection();
        return false;
      }
      return true;
    }

    if (key === 'insert' && mod && !ev.shiftKey && !ev.altKey) {
      if (this.term.hasSelection()) {
        void this.copySelection();
        return false;
      }
      return true;
    }

    if (key === 'v' && mod && !ev.altKey) {
      void this.pasteFromClipboard();
      return false;
    }

    if (key === 'insert' && ev.shiftKey && !mod && !ev.altKey) {
      void this.pasteFromClipboard();
      return false;
    }

    return true;
  };

  private onCopyEvent = (ev: ClipboardEvent): void => {
    if (!this.term?.hasSelection()) return;
    const text = this.term.getSelection();
    if (!text) return;
    ev.preventDefault();
    ev.clipboardData?.setData('text/plain', text);
  };

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
      rightClickSelectsWord: true,
      scrollback: 5000,
    });
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    this.term.open(host);
    if (pending) this.term.write(pending);
    this.term.attachCustomKeyEventHandler(this.onTermKey);
    this.term.onData((data) => {
      void this.app.api?.shellWrite(this.props.sessionId, data);
    });
    host.addEventListener('copy', this.onCopyEvent);
    window.addEventListener('pkg:shell-data', this.onShellData);
    window.addEventListener('pkg:shell-reset', this.onShellReset);
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
    window.removeEventListener('pkg:shell-reset', this.onShellReset);
    this.host?.removeEventListener('copy', this.onCopyEvent);
    this.ro?.disconnect();
    this.ro = null;
    this.term?.dispose();
    this.term = null;
    this.fit = null;
    this.host = null;
  }
}
