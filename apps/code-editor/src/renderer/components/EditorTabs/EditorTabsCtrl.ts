import { Controller } from '@pkg-runner/controller';
import type { CodeEditorShellCtrl } from '../../CodeEditorShell/CodeEditorShellCtrl.ts';
import type { TEditorTab } from '../../types.ts';

type TData = {
  tabs: TEditorTab[];
  activeTabId: string | null;
};

type TProps = Record<string, never>;
type TState = {
  pendingLine: number | null;
};

export class EditorTabsCtrl extends Controller<TData, TProps, TState> {
  private shell: CodeEditorShellCtrl | null = null;

  constructor() {
    super({
      data: { tabs: [], activeTabId: null },
      props: {},
      state: { pendingLine: null },
    });
  }

  bindShell(shell: CodeEditorShellCtrl): void {
    this.shell = shell;
  }

  syncFromShell(): void {
    if (!this.shell) return;
    this.setData({
      tabs: this.shell.data.tabs,
      activeTabId: this.shell.data.activeTabId,
    });
  }

  requestGotoLine(line: number): void {
    this.setState({ pendingLine: line });
  }

  consumePendingLine(): number | null {
    const line = this.state.pendingLine;
    this.setState({ pendingLine: null });
    return line;
  }

  selectTab(id: string): void {
    this.shell?.setActiveTab(id);
    this.syncFromShell();
  }

  closeTab(id: string): void {
    this.shell?.closeTab(id);
    this.syncFromShell();
  }

  async closeOthers(keepId?: string): Promise<void> {
    const id = keepId ?? this.data.activeTabId;
    if (!id || !this.shell) return;
    const toClose = this.data.tabs.filter((t) => t.id !== id).map((t) => t.id);
    await this.shell.saveDirtyTabs(toClose);
    this.shell.closeOtherTabs(id);
    this.syncFromShell();
  }

  async closeAll(): Promise<void> {
    if (!this.shell) return;
    await this.shell.saveDirtyTabs();
    this.shell.closeAllTabs();
    this.syncFromShell();
  }

  onChange(id: string, content: string): void {
    this.shell?.onEditorChange(id, content);
    this.syncFromShell();
  }

  async save(): Promise<void> {
    await this.shell?.saveActive();
    this.syncFromShell();
  }

  async saveTab(id: string): Promise<void> {
    await this.shell?.saveTab(id);
    this.syncFromShell();
  }

  async reloadFromDisk(): Promise<void> {
    await this.shell?.reloadFromDisk();
    this.syncFromShell();
  }

  keepLocal(): void {
    this.shell?.keepLocalOverwrite();
    this.syncFromShell();
  }

  async showInExplorer(relPath?: string): Promise<void> {
    const path = relPath ?? this.activeTab?.relPath;
    if (!path) return;
    await this.shell?.showInExplorer(path);
  }

  async openWithSystem(relPath?: string): Promise<void> {
    const path = relPath ?? this.activeTab?.relPath;
    if (!path) return;
    await this.shell?.openWithSystem(path);
  }

  async locateInTree(relPath?: string): Promise<void> {
    const path = relPath ?? this.activeTab?.relPath;
    if (!path) return;
    await this.shell?.locateInTree(path);
  }

  get activeTab(): TEditorTab | null {
    return this.data.tabs.find((t) => t.id === this.data.activeTabId) ?? null;
  }

  get hasConflict(): boolean {
    return !!this.activeTab?.externalConflict;
  }

  get isBinaryTab(): boolean {
    return this.activeTab?.kind === 'binary';
  }
}
