import { Controller } from '@pkg-runner/controller';
import type { TWindowBridge } from '@pkg-runner/shell/renderer';
import type { CodeEditorShellCtrl } from '../../CodeEditorShell/CodeEditorShellCtrl.ts';

type TData = {
  workspaceRoot: string | null;
  cwd: string | null;
  projectRoot: string | null;
  boundRoot: string | null;
  cwdRel: string;
  canGoParent: boolean;
  projectLocked: boolean;
  maximized: boolean;
};

type TProps = Record<string, never>;
type TState = { busy: boolean };

export class ProjectToolbarCtrl extends Controller<TData, TProps, TState> {
  private shell: CodeEditorShellCtrl | null = null;
  private offMaximized: (() => void) | null = null;

  constructor() {
    super({
      data: {
        workspaceRoot: null,
        cwd: null,
        projectRoot: null,
        boundRoot: null,
        cwdRel: '',
        canGoParent: false,
        projectLocked: false,
        maximized: false,
      },
      props: {},
      state: { busy: false },
    });
  }

  bindShell(shell: CodeEditorShellCtrl): void {
    this.shell = shell;
    void this.shell.bridge.windowIsMaximized().then((v) => {
      this.setData({ maximized: v });
    });
    this.offMaximized?.();
    this.offMaximized = this.shell.bridge.onMaximizedChange((maximized) => {
      this.setData({ maximized });
    });
  }

  syncFromShell(): void {
    if (!this.shell) return;
    this.setData({
      workspaceRoot: this.shell.data.workspaceRoot,
      cwd: this.shell.data.cwd,
      projectRoot: this.shell.data.projectRoot,
      boundRoot: this.shell.data.boundRoot,
      cwdRel: this.shell.data.cwdRel,
      canGoParent: this.shell.data.canGoParent,
      projectLocked: this.shell.data.projectLocked,
    });
  }

  async onPickWorkspace(): Promise<void> {
    if (!this.shell) return;
    this.setState({ busy: true });
    try {
      await this.shell.pickWorkspace();
      this.syncFromShell();
    } finally {
      this.setState({ busy: false });
    }
  }

  async onParent(): Promise<void> {
    if (!this.shell) return;
    this.setState({ busy: true });
    try {
      await this.shell.goParent();
      this.syncFromShell();
    } finally {
      this.setState({ busy: false });
    }
  }

  async onWorkspaceRoot(): Promise<void> {
    if (!this.shell) return;
    this.setState({ busy: true });
    try {
      await this.shell.goWorkspaceRoot();
      this.syncFromShell();
    } finally {
      this.setState({ busy: false });
    }
  }

  async onShowInExplorer(): Promise<void> {
    await this.shell?.showInExplorer(null);
  }

  get windowBridge(): TWindowBridge | null {
    return this.shell?.bridge ?? null;
  }

  setMaximized(value: boolean): void {
    this.setData({ maximized: value });
  }
}
