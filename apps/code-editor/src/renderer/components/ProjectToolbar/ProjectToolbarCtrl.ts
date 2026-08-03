import {
  TitleBarShellCtrl,
  defaultTitleBarShellData,
  type TitleBarShellData,
} from '@pkg-runner/shell/renderer';
import type { TWindowBridge } from '@pkg-runner/shell/renderer';
import type { CodeEditorShellCtrl } from '../../CodeEditorShell/CodeEditorShellCtrl.ts';

type TData = TitleBarShellData & {
  workspaceRoot: string | null;
  cwd: string | null;
  projectRoot: string | null;
  boundRoot: string | null;
  cwdRel: string;
  canGoParent: boolean;
  projectLocked: boolean;
};

type TProps = Record<string, never>;
type TState = { busy: boolean };

export class ProjectToolbarCtrl extends TitleBarShellCtrl<TData, TProps, TState> {
  private shell: CodeEditorShellCtrl | null = null;
  private offMaximized: (() => void) | null = null;

  constructor() {
    super({
      data: {
        ...defaultTitleBarShellData({
          productName: 'Code Editor',
          subtitle: '',
          colorEnv: 'prod',
        }),
        workspaceRoot: null,
        cwd: null,
        projectRoot: null,
        boundRoot: null,
        cwdRel: '',
        canGoParent: false,
        projectLocked: false,
      },
      props: {},
      state: { busy: false },
    });
  }

  getWindowApi(): TWindowBridge | null {
    return this.shell?.bridge ?? null;
  }

  bindShell(shell: CodeEditorShellCtrl): void {
    this.shell = shell;
    void this.refreshMaximized();
    this.offMaximized?.();
    this.offMaximized = this.bindMaximizedEvents();
    const env =
      typeof window !== 'undefined' && window.codeEditor?.getColorEnv?.() === 'test'
        ? 'test'
        : 'prod';
    this.setBrand({
      productName: 'Code Editor',
      subtitle: '',
      colorEnv: env,
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
}
