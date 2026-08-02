/**
 * 端口漂移检测（list / kill-by-port / reap unmanaged）。
 * 托管 script 的启停杀树见 winProcessJob + runnerHost，不走这里的侦察路径。
 */
import { spawn, spawnSync } from 'node:child_process';
import { isNodeishProcess } from '../../shared/nodeishProcess.js';

export { isNodeishProcess };

export type PortOwner = 'self' | 'job' | 'shell' | 'unmanaged';

export type ListeningPort = {
  port: number;
  pid: number;
  processName: string;
  localAddress: string;
};

export type ClassifiedPort = ListeningPort & {
  owner: PortOwner;
  jobId?: string;
  shellId?: string;
};

export type ManagedRoot = {
  id: string;
  pid: number;
};

export type ClassifyContext = {
  jobs: ManagedRoot[];
  shells: ManagedRoot[];
  controlPort: number | null;
  selfPids?: number[];
};

export type KillResult = {
  ok: boolean;
  port?: number;
  pid?: number;
  processName?: string;
  error?: string;
};

function runCmd(
  command: string,
  args: string[],
  opts?: { timeoutMs?: number },
): Promise<{ stdout: string; code: number | null }> {
  const timeoutMs = opts?.timeoutMs ?? 15000;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      reject(new Error(`${command} timeout ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (c: string) => {
      stdout += c;
    });
    child.stderr?.on('data', (c: string) => {
      stderr += c;
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code && code !== 0 && !stdout.trim()) {
        reject(new Error(stderr.trim() || `${command} exit ${code}`));
        return;
      }
      resolve({ stdout: stdout.trim(), code });
    });
  });
}

async function tasklistNameByPid(): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  try {
    const { stdout } = await runCmd('tasklist', ['/FO', 'CSV', '/NH'], {
      timeoutMs: 8000,
    });
    for (const line of stdout.split(/\r?\n/)) {
      const m = /^"([^"]+)","(\d+)"/.exec(line.trim());
      if (!m) continue;
      const pid = Number(m[2]);
      if (Number.isFinite(pid) && pid > 0) map.set(pid, m[1]!);
    }
  } catch {
    /* ignore */
  }
  return map;
}

async function listListeningWin(): Promise<ListeningPort[]> {
  const { stdout } = await runCmd('netstat', ['-ano', '-p', 'tcp'], {
    timeoutMs: 8000,
  });
  const names = await tasklistNameByPid();
  const out: ListeningPort[] = [];
  const seen = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i.exec(line);
    if (!m) continue;
    const localAddress = m[1]!;
    const port = Number(m[2]);
    const pid = Number(m[3]);
    if (!Number.isFinite(port) || port <= 0 || !Number.isFinite(pid) || pid <= 0) {
      continue;
    }
    const key = `${localAddress}|${port}|${pid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      port,
      pid,
      processName: names.get(pid) || '?',
      localAddress,
    });
  }
  return out;
}

async function listListeningUnix(): Promise<ListeningPort[]> {
  try {
    const { stdout: text } = await runCmd('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], {
      timeoutMs: 12000,
    });
    const out: ListeningPort[] = [];
    const seen = new Set<string>();
    for (const line of text.split('\n').slice(1)) {
      const m = /^(\S+)\s+(\d+)\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(.+)$/.exec(
        line.trim(),
      );
      if (!m) continue;
      const processName = m[1]!;
      const pid = Number(m[2]);
      const name = m[3]!;
      const pm = /(?:^|\s)(?:TCP\s+)?([^:\s]+):(\d+)(?:\s|$)/i.exec(name);
      if (!pm) continue;
      const localAddress = pm[1]!;
      const port = Number(pm[2]);
      if (!Number.isFinite(port) || port <= 0 || !Number.isFinite(pid) || pid <= 0) {
        continue;
      }
      const key = `${localAddress}|${port}|${pid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ port, pid, processName, localAddress });
    }
    return out;
  } catch {
    return [];
  }
}

export async function listListeningPorts(): Promise<ListeningPort[]> {
  try {
    if (process.platform === 'win32') return await listListeningWin();
    return await listListeningUnix();
  } catch {
    return [];
  }
}

/** 一次快照：parentPid → children[]（Win: CIM；其它: 逐 root pgrep） */
async function loadParentChildMap(
  roots: number[],
): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>();
  if (process.platform === 'win32') {
    try {
      const { stdout } = await runCmd(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Csv -NoTypeInformation",
        ],
        { timeoutMs: 12000 },
      );
      for (const line of stdout.split(/\r?\n/).slice(1)) {
        const m = /^"(\d+)","(\d+)"/.exec(line.trim());
        if (!m) continue;
        const pid = Number(m[1]);
        const ppid = Number(m[2]);
        if (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(ppid)) continue;
        let list = map.get(ppid);
        if (!list) {
          list = [];
          map.set(ppid, list);
        }
        list.push(pid);
      }
    } catch {
      /* empty map → no descendants */
    }
    return map;
  }
  // Unix：只对给定 root 拉一层层 pgrep（根数量通常很少）
  const queue = [...new Set(roots.filter((p) => p > 0))];
  const seen = new Set<number>(queue);
  while (queue.length) {
    const cur = queue.shift()!;
    try {
      const { stdout } = await runCmd('pgrep', ['-P', String(cur)], {
        timeoutMs: 5000,
      });
      const kids = stdout
        .split(/\s+/)
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (kids.length) map.set(cur, kids);
      for (const k of kids) {
        if (seen.has(k) || k === process.pid) continue;
        seen.add(k);
        queue.push(k);
      }
    } catch {
      /* ignore */
    }
  }
  return map;
}

function descendantsFromMap(
  rootPid: number,
  childrenOf: Map<number, number[]>,
): Set<number> {
  const out = new Set<number>();
  if (!Number.isFinite(rootPid) || rootPid <= 0) return out;
  out.add(rootPid);
  const queue = [rootPid];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const child of childrenOf.get(cur) || []) {
      if (out.has(child) || child === process.pid) continue;
      out.add(child);
      queue.push(child);
    }
  }
  return out;
}

/** 仅用于 classify（对照托管 job）；Win 上一次 CIM 快照 */
export async function collectDescendantPids(rootPid: number): Promise<Set<number>> {
  const map = await loadParentChildMap([rootPid]);
  return descendantsFromMap(rootPid, map);
}

export async function classifyPorts(
  listeners: ListeningPort[],
  ctx: ClassifyContext,
): Promise<ClassifiedPort[]> {
  const selfPids = new Set<number>(ctx.selfPids || [process.pid]);
  const roots = [
    ...ctx.jobs.map((j) => j.pid),
    ...ctx.shells.map((s) => s.pid),
  ].filter((p) => p > 0);
  const childMap = await loadParentChildMap(roots);
  const jobTrees: Array<{ id: string; pids: Set<number> }> = [];
  for (const j of ctx.jobs) {
    if (j.pid > 0) {
      jobTrees.push({ id: j.id, pids: descendantsFromMap(j.pid, childMap) });
    }
  }
  const shellTrees: Array<{ id: string; pids: Set<number> }> = [];
  for (const s of ctx.shells) {
    if (s.pid > 0) {
      shellTrees.push({ id: s.id, pids: descendantsFromMap(s.pid, childMap) });
    }
  }

  return listeners.map((L) => {
    if (
      (ctx.controlPort != null && L.port === ctx.controlPort) ||
      selfPids.has(L.pid)
    ) {
      return { ...L, owner: 'self' as const };
    }
    for (const j of jobTrees) {
      if (j.pids.has(L.pid)) {
        return { ...L, owner: 'job' as const, jobId: j.id };
      }
    }
    for (const s of shellTrees) {
      if (s.pids.has(L.pid)) {
        return { ...L, owner: 'shell' as const, shellId: s.id };
      }
    }
    return { ...L, owner: 'unmanaged' as const };
  });
}

export type KillTreeResult = {
  rootPid: number;
  via: 'taskkill-T';
  ok: boolean;
  code: number | null;
  detail?: string;
  ms: number;
};

/**
 * Fallback：单次 taskkill /T /F（无 Job Object 时用）。
 * 不做 wmic BFS / 全机 node 扫。
 */
export async function killPidTree(rootPid: number): Promise<KillTreeResult> {
  const started = Date.now();
  if (!Number.isFinite(rootPid) || rootPid <= 0 || rootPid === process.pid) {
    return {
      rootPid,
      via: 'taskkill-T',
      ok: false,
      code: null,
      detail: 'invalid pid',
      ms: 0,
    };
  }
  if (process.platform !== 'win32') {
    try {
      process.kill(rootPid, 'SIGKILL');
      return {
        rootPid,
        via: 'taskkill-T',
        ok: true,
        code: 0,
        ms: Date.now() - started,
      };
    } catch (err) {
      return {
        rootPid,
        via: 'taskkill-T',
        ok: false,
        code: null,
        detail: err instanceof Error ? err.message : String(err),
        ms: Date.now() - started,
      };
    }
  }
  try {
    const { stdout, code } = await runCmd(
      'taskkill',
      ['/pid', String(rootPid), '/T', '/F'],
      { timeoutMs: 8000 },
    );
    const ok = code === 0 || code === 128 || code === 1;
    return {
      rootPid,
      via: 'taskkill-T',
      ok,
      code,
      detail: stdout.slice(0, 160),
      ms: Date.now() - started,
    };
  } catch (err) {
    return {
      rootPid,
      via: 'taskkill-T',
      ok: false,
      code: null,
      detail: err instanceof Error ? err.message : String(err),
      ms: Date.now() - started,
    };
  }
}

export function killPidTreeSync(rootPid: number): KillTreeResult {
  const started = Date.now();
  if (!Number.isFinite(rootPid) || rootPid <= 0 || rootPid === process.pid) {
    return {
      rootPid,
      via: 'taskkill-T',
      ok: false,
      code: null,
      detail: 'invalid pid',
      ms: 0,
    };
  }
  if (process.platform === 'win32') {
    const r = spawnSync('taskkill', ['/pid', String(rootPid), '/T', '/F'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8000,
    });
    return {
      rootPid,
      via: 'taskkill-T',
      ok: !r.error && (r.status === 0 || r.status === 128 || r.status === 1),
      code: r.status,
      detail: (r.stdout || r.stderr || '').trim().slice(0, 160),
      ms: Date.now() - started,
    };
  }
  try {
    process.kill(rootPid, 'SIGKILL');
    return {
      rootPid,
      via: 'taskkill-T',
      ok: true,
      code: 0,
      ms: Date.now() - started,
    };
  } catch (err) {
    return {
      rootPid,
      via: 'taskkill-T',
      ok: false,
      code: null,
      detail: err instanceof Error ? err.message : String(err),
      ms: Date.now() - started,
    };
  }
}

export function killPidTreeByPortListener(pid: number): void {
  if (!pid || pid === process.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 8000,
    });
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* ignore */
  }
}

export type PortsListResult = {
  ok: boolean;
  action: 'list';
  ports: ClassifiedPort[];
  orphans: number;
  error?: string;
  at: string;
};

export type PortsKillResult = {
  ok: boolean;
  action: 'kill';
  killed: KillResult[];
  error?: string;
  at: string;
};

export type PortsReapResult = {
  ok: boolean;
  action: 'reap';
  nodeOnly: boolean;
  killed: KillResult[];
  skipped: ClassifiedPort[];
  error?: string;
  at: string;
};

export type PortsActionResult = PortsListResult | PortsKillResult | PortsReapResult;

export async function listClassifiedPorts(
  ctx: ClassifyContext,
): Promise<PortsListResult> {
  const at = new Date().toISOString();
  try {
    const ports = await classifyPorts(await listListeningPorts(), ctx);
    const orphans = ports.filter((p) => p.owner === 'unmanaged').length;
    return { ok: true, action: 'list', ports, orphans, at };
  } catch (err) {
    return {
      ok: false,
      action: 'list',
      ports: [],
      orphans: 0,
      error: err instanceof Error ? err.message : String(err),
      at,
    };
  }
}

export async function killByPid(
  pid: number,
  hint?: { processName?: string },
): Promise<KillResult> {
  if (!Number.isFinite(pid) || pid <= 0) {
    return { ok: false, pid, error: '无效 pid' };
  }
  if (pid === process.pid) {
    return { ok: false, pid, error: '拒绝杀死 Runner 自身' };
  }
  const processName = hint?.processName;
  const r = await killPidTree(pid);
  return { ok: r.ok, pid, processName, error: r.ok ? undefined : r.detail };
}

export async function killByPort(
  port: number,
  listenersHint?: ListeningPort[],
): Promise<KillResult> {
  if (!Number.isFinite(port) || port <= 0) {
    return { ok: false, port, error: '无效 port' };
  }
  const listeners = (listenersHint ?? (await listListeningPorts())).filter(
    (L) => L.port === port,
  );
  if (!listeners.length) {
    return { ok: false, port, error: `端口 ${port} 无 Listen 进程` };
  }
  const pids = [...new Set(listeners.map((L) => L.pid))];
  if (pids.includes(process.pid)) {
    return { ok: false, port, error: '拒绝杀死 Runner 自身端口' };
  }
  const processName = listeners[0]?.processName;
  for (const pid of pids) await killPidTree(pid);
  return { ok: true, port, pid: pids[0], processName };
}

export async function reapUnmanagedPorts(
  ctx: ClassifyContext,
  opts?: { nodeOnly?: boolean },
): Promise<PortsReapResult> {
  const at = new Date().toISOString();
  const nodeOnly = opts?.nodeOnly !== false;
  try {
    const listeners = await listListeningPorts();
    const ports = await classifyPorts(listeners, ctx);
    const targets = ports.filter((p) => {
      if (p.owner !== 'unmanaged') return false;
      if (!nodeOnly) return true;
      return isNodeishProcess(p.processName);
    });
    const skipped = ports.filter(
      (p) =>
        p.owner === 'unmanaged' &&
        nodeOnly &&
        !isNodeishProcess(p.processName),
    );
    const killed: KillResult[] = [];
    const seen = new Set<number>();
    for (const t of targets) {
      if (seen.has(t.pid)) continue;
      seen.add(t.pid);
      killed.push(await killByPid(t.pid, { processName: t.processName }));
    }
    return { ok: true, action: 'reap', nodeOnly, killed, skipped, at };
  } catch (err) {
    return {
      ok: false,
      action: 'reap',
      nodeOnly,
      killed: [],
      skipped: [],
      error: err instanceof Error ? err.message : String(err),
      at,
    };
  }
}
