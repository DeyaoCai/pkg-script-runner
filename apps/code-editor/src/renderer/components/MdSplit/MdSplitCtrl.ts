import { Controller } from '@pkg-runner/controller';
import type { CodeEditorShellCtrl } from '../../CodeEditorShell/CodeEditorShellCtrl.ts';
import { createEditor, type TCmHandle } from '../../cmFactory.ts';
import { renderMarkdown, type TMdOutlineItem } from '../../renderMd.ts';

type TData = {
  relPath: string | null;
  dirty: boolean;
  previewHtml: string;
  outline: TMdOutlineItem[];
  activeOutlineId: string | null;
};

type TProps = Record<string, never>;
type TState = { ready: boolean };

export class MdSplitCtrl extends Controller<TData, TProps, TState> {
  private shell: CodeEditorShellCtrl | null = null;
  private cm: TCmHandle | null = null;
  private savedDoc = '';
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private hostEl: HTMLElement | null = null;

  constructor() {
    super({
      data: {
        relPath: null,
        dirty: false,
        previewHtml: '',
        outline: [],
        activeOutlineId: null,
      },
      props: {},
      state: { ready: false },
    });
  }

  bindShell(shell: CodeEditorShellCtrl): void {
    this.shell = shell;
  }

  mountEditor(el: HTMLElement): void {
    this.hostEl = el;
    this.cm?.destroy();
    this.cm = createEditor(el, {
      doc: this.savedDoc,
      relPath: this.data.relPath ?? 'untitled.md',
      onChange: (text) => this.onDocChange(text),
      onSave: () => {
        void this.shell?.saveDesignDoc();
      },
      onBlur: () => {
        if (this.data.dirty) void this.shell?.saveDesignDoc();
      },
    });
    this.setState({ ready: true });
    this.renderPreview(this.cm.getDoc());
  }

  unmountEditor(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.cm?.destroy();
    this.cm = null;
    this.hostEl = null;
    this.setState({ ready: false });
  }

  load(relPath: string, content: string): void {
    this.savedDoc = content;
    this.setData({ relPath, dirty: false });
    if (!this.cm && this.hostEl) {
      this.mountEditor(this.hostEl);
    }
    this.cm?.setDoc(content, relPath);
    this.renderPreview(content);
  }

  clear(): void {
    this.savedDoc = '';
    this.setData({
      relPath: null,
      dirty: false,
      previewHtml: '',
      outline: [],
      activeOutlineId: null,
    });
    this.cm?.setDoc('', 'untitled.md');
  }

  setActiveOutline(id: string | null): void {
    this.setData({ activeOutlineId: id });
  }

  getDoc(): string {
    return this.cm?.getDoc() ?? this.savedDoc;
  }

  markClean(): void {
    this.savedDoc = this.getDoc();
    this.setData({ dirty: false });
  }

  requestMeasure(): void {
    this.cm?.view.requestMeasure();
  }

  private onDocChange(text: string): void {
    const dirty = text !== this.savedDoc;
    if (dirty !== this.data.dirty) {
      this.setData({ dirty });
    }
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.renderPreview(text), 120);
  }

  private renderPreview(md: string): void {
    const { html, outline } = renderMarkdown(md);
    const active =
      this.data.activeOutlineId &&
      outline.some((o) => o.id === this.data.activeOutlineId)
        ? this.data.activeOutlineId
        : (outline[0]?.id ?? null);
    this.setData({ previewHtml: html, outline, activeOutlineId: active });
  }
}
