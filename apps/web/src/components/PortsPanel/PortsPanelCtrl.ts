import { Controller } from '@pkg-runner/controller';
import { isNodeishProcess } from '@pkg-runner/shared/nodeishProcess';
import type { AppCtrl } from '../../App/AppCtrl';
import type { ClassifiedPort, PortOwner } from '../../env';

type TData = Record<string, never>;
type TProps = Record<string, never>;

export type PortsOwnerFilter = 'all' | PortOwner;

/** 应用内确认（可叠多张；不用 window.confirm） */
export type PortsConfirm =
  | { id: string; kind: 'kill'; message: string; port: ClassifiedPort }
  | { id: string; kind: 'reap'; message: string; nodeOnly: boolean };

type TState = {
  open: boolean;
  loading: boolean;
  /** 正在结束的端口（可并行多个） */
  killingPorts: number[];
  /** 正在批量清理漂移 */
  reaping: boolean;
  /** 仅显示 Node 系进程（默认开） */
  nodeOnly: boolean;
  filter: PortsOwnerFilter;
  /** 端口 / PID / 进程名连续子串 */
  query: string;
  ports: ClassifiedPort[];
  orphans: number;
  error: string | null;
  status: string | null;
  /** 确认栈：后入在上 */
  confirms: PortsConfirm[];
};

const OWNER_LABEL: Record<PortOwner, string> = {
  self: '自身',
  job: '脚本',
  shell: 'Shell',
  unmanaged: '漂移',
};

let confirmSeq = 0;
function nextConfirmId(): string {
  confirmSeq += 1;
  return `pc-${Date.now().toString(36)}-${confirmSeq}`;
}

export class PortsPanelCtrl extends Controller<TData, TProps, TState> {
  constructor(readonly app: AppCtrl) {
    super({
      data: {},
      props: {},
      state: {
        open: false,
        loading: false,
        killingPorts: [],
        reaping: false,
        nodeOnly: true,
        filter: 'all',
        query: '',
        ports: [],
        orphans: 0,
        error: null,
        status: null,
        confirms: [],
      },
    });
  }

  ownerLabel(owner: PortOwner): string {
    return OWNER_LABEL[owner] || owner;
  }

  /** 归属/角标/列表共用的进程范围（受 nodeOnly 影响） */
  private scopedPorts(): ClassifiedPort[] {
    const list = this.state.ports;
    if (!this.state.nodeOnly) return list;
    return list.filter((p) => isNodeishProcess(p.processName));
  }

  countByOwner(owner: PortOwner | 'all'): number {
    const list = this.scopedPorts();
    if (owner === 'all') return list.length;
    return list.filter((p) => p.owner === owner).length;
  }

  get visiblePorts(): ClassifiedPort[] {
    const raw = this.state.query.trim().toLowerCase();
    let list = this.scopedPorts();
    if (this.state.filter !== 'all') {
      list = list.filter((p) => p.owner === this.state.filter);
    }
    if (raw) {
      const tokens = raw.split(/\s+/).filter(Boolean);
      list = list.filter((p) => {
        const fields = [
          String(p.port),
          String(p.pid),
          p.processName || '',
          p.localAddress || '',
          p.owner || '',
          this.ownerLabel(p.owner),
          p.jobId || '',
          p.shellId || '',
        ].map((f) => f.toLowerCase());
        return tokens.every((tok) => fields.some((f) => f.includes(tok)));
      });
    }
    return [...list].sort(
      (a, b) =>
        (a.owner === 'unmanaged' ? 0 : 1) - (b.owner === 'unmanaged' ? 0 : 1) ||
        a.port - b.port,
    );
  }

  open(): void {
    this.setState({
      open: true,
      error: null,
      status: null,
      confirms: [],
      nodeOnly: true,
    });
    void this.refresh();
  }

  close(): void {
    this.setState({
      open: false,
      killingPorts: [],
      reaping: false,
      loading: false,
      confirms: [],
    });
  }

  get hasConfirms(): boolean {
    return this.state.confirms.length > 0;
  }

  cancelConfirm(id?: string): void {
    if (id) {
      this.setState({
        confirms: this.state.confirms.filter((c) => c.id !== id),
      });
      return;
    }
    // 无 id：取消最上面一张
    const stack = this.state.confirms;
    if (!stack.length) return;
    this.setState({ confirms: stack.slice(0, -1) });
  }

  isKilling(p: ClassifiedPort): boolean {
    return this.state.killingPorts.includes(p.port);
  }

  hasKillConfirm(p: ClassifiedPort): boolean {
    return this.state.confirms.some(
      (c) => c.kind === 'kill' && c.port.port === p.port && c.port.pid === p.pid,
    );
  }

  setFilter(filter: PortsOwnerFilter): void {
    this.setState({ filter });
  }

  setNodeOnly(on: boolean): void {
    this.setState({ nodeOnly: !!on });
    this.refreshStatusLine();
  }

  setQuery(query: string): void {
    this.setState({ query });
  }

  private refreshStatusLine(): void {
    const scoped = this.scopedPorts();
    const orphans = scoped.filter((p) => p.owner === 'unmanaged').length;
    const total = this.state.ports.length;
    if (this.state.nodeOnly) {
      this.setState({
        status: `Node 系 ${scoped.length}/${total} · 漂移 ${orphans}`,
      });
    } else {
      this.setState({
        status: `${total} 个监听 · 漂移 ${this.state.orphans}`,
      });
    }
  }

  canKill(p: ClassifiedPort): boolean {
    return p.owner !== 'self';
  }

  async refresh(): Promise<void> {
    const api = this.app.api;
    if (!api?.portsList) {
      this.setState({ error: '端口 API 不可用', ports: [], orphans: 0 });
      return;
    }
    this.setState({ loading: true, error: null });
    try {
      const r = await api.portsList();
      if (!r.ok) {
        this.setState({
          error: r.error || '扫描失败',
          ports: [],
          orphans: 0,
        });
        return;
      }
      this.setState({
        ports: r.ports || [],
        orphans: r.orphans ?? 0,
      });
      this.refreshStatusLine();
    } catch (e) {
      this.setState({
        error: e instanceof Error ? e.message : String(e),
        ports: [],
        orphans: 0,
      });
    } finally {
      this.setState({ loading: false });
    }
  }

  askKillPort(p: ClassifiedPort): void {
    if (!this.canKill(p) || this.isKilling(p) || this.hasKillConfirm(p)) return;
    if (!this.app.api?.portsKill) return;
    const message =
      p.owner === 'unmanaged'
        ? `结束 PID ${p.pid}（端口 ${p.port} · ${p.processName}）？`
        : `端口 ${p.port} 归属 Runner ${this.ownerLabel(p.owner)}，仍要强杀进程树？`;
    this.setState({
      confirms: [
        ...this.state.confirms,
        { id: nextConfirmId(), kind: 'kill', message, port: p },
      ],
    });
  }

  askReap(nodeOnly = true): void {
    if (this.state.reaping) return;
    if (!this.app.api?.portsReap) return;
    if (this.state.confirms.some((c) => c.kind === 'reap' && c.nodeOnly === nodeOnly)) {
      return;
    }
    const message = nodeOnly
      ? '清理所有「漂移」的 Node/Vite 等开发服务进程？'
      : '清理全部漂移监听（不限进程名，更危险）？';
    this.setState({
      confirms: [
        ...this.state.confirms,
        { id: nextConfirmId(), kind: 'reap', message, nodeOnly },
      ],
    });
  }

  acceptConfirm(id: string): void {
    const c = this.state.confirms.find((x) => x.id === id);
    if (!c) return;
    // 先从栈里摘掉，再执行（可继续叠/批其它确认）
    this.setState({
      confirms: this.state.confirms.filter((x) => x.id !== id),
    });
    if (c.kind === 'kill') {
      void this.runKillPort(c.port);
      return;
    }
    void this.runReap(c.nodeOnly);
  }

  private async runKillPort(p: ClassifiedPort): Promise<void> {
    const api = this.app.api;
    if (!api?.portsKill) return;
    if (this.state.killingPorts.includes(p.port)) return;
    this.setState({
      killingPorts: [...this.state.killingPorts, p.port],
      error: null,
    });
    try {
      const r = await api.portsKill({ port: p.port });
      if (!r.ok) {
        this.setState({ error: r.error || r.killed?.[0]?.error || '结束失败' });
        return;
      }
      this.app.flashMeta(`已结束端口 ${p.port}`, false);
      this.setState({
        status: `已结束 ${p.port} · ${p.processName}`,
        ports: this.state.ports.filter((x) => x.port !== p.port || x.pid !== p.pid),
        // 同端口未确认的确认也清掉
        confirms: this.state.confirms.filter(
          (c) => !(c.kind === 'kill' && c.port.port === p.port),
        ),
      });
      await this.refresh();
    } catch (e) {
      this.setState({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      this.setState({
        killingPorts: this.state.killingPorts.filter((x) => x !== p.port),
      });
    }
  }

  private async runReap(nodeOnly: boolean): Promise<void> {
    const api = this.app.api;
    if (!api?.portsReap) return;
    if (this.state.reaping) return;
    this.setState({ reaping: true, error: null });
    try {
      const r = await api.portsReap({ nodeOnly });
      if (!r.ok) {
        this.setState({ error: r.error || '清理失败' });
      } else {
        const n = r.killed?.filter((k) => k.ok).length ?? 0;
        this.setState({
          status: `已清理 ${n} 个${nodeOnly ? '（Node 系）' : ''}`,
          confirms: this.state.confirms.filter((c) => c.kind !== 'reap'),
        });
        this.app.flashMeta(`端口清理 ${n} 个`, false);
      }
      await this.refresh();
    } catch (e) {
      this.setState({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      this.setState({ reaping: false });
    }
  }
}
