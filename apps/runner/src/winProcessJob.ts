/**
 * Windows Job Object — IDE 同款进程所有权。
 *
 * Electron 子进程默认已在 Chromium Job 里，直接 Assign 常失败 (err=5)。
 * 因此用 CreateProcess(CREATE_BREAKAWAY_FROM_JOB | CREATE_SUSPENDED)
 * 把脚本根进程拉出 Electron Job，再入我们的 Job；停 = TerminateJobObject。
 */
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import type { ChildProcess } from 'node:child_process';

export type ProcessJob = {
  terminate: () => boolean;
  close: () => void;
  assigned: boolean;
};

export type OwnResult = {
  job: ProcessJob | null;
  err?: number;
  stage?: string;
};

const JobObjectExtendedLimitInformation = 9;
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
const PROCESS_OWN_ACCESS = 0x0100 | 0x0001 | 0x0800 | 0x1000;

const CREATE_SUSPENDED = 0x00000004;
const CREATE_UNICODE_ENVIRONMENT = 0x00000400;
const CREATE_BREAKAWAY_FROM_JOB = 0x01000000;
const CREATE_NO_WINDOW = 0x08000000;
const STARTF_USESTDHANDLES = 0x00000100;
const HANDLE_FLAG_INHERIT = 0x00000001;
const STD_INPUT_HANDLE = -10;
const WAIT_OBJECT_0 = 0;
const WAIT_TIMEOUT = 0x00000102;
const STILL_ACTIVE = 259;
const _O_RDONLY = 0;

type Apis = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  koffi: any;
  ptrSize: number;
  CreateJobObjectW: (sa: null, name: null) => unknown;
  SetInformationJobObject: (
    job: unknown,
    infoClass: number,
    info: Buffer,
    len: number,
  ) => number;
  OpenProcess: (access: number, inherit: number, pid: number) => unknown;
  AssignProcessToJobObject: (job: unknown, process: unknown) => number;
  TerminateJobObject: (job: unknown, exitCode: number) => number;
  CloseHandle: (h: unknown) => number;
  GetLastError: () => number;
  CreatePipe: (
    readOut: Buffer,
    writeOut: Buffer,
    sa: Buffer,
    size: number,
  ) => number;
  SetHandleInformation: (h: unknown, mask: number, flags: number) => number;
  CreateProcessW: (
    app: null,
    cmd: Buffer,
    procSa: null,
    threadSa: null,
    inherit: number,
    flags: number,
    env: Buffer,
    cwd: string,
    si: Buffer,
    pi: Buffer,
  ) => number;
  ResumeThread: (thread: unknown) => number;
  GetExitCodeProcess: (proc: unknown, codeOut: Buffer) => number;
  WaitForSingleObject: (h: unknown, ms: number) => number;
  GetStdHandle: (n: number) => unknown;
  NtSuspendProcess: (process: unknown) => number;
  NtResumeProcess: (process: unknown) => number;
  _open_osfhandle: (handle: unknown, flags: number) => number;
};

let apis: Apis | null | undefined;

function load(): Apis | null {
  if (apis !== undefined) return apis;
  if (process.platform !== 'win32') {
    apis = null;
    return null;
  }
  try {
    const require = createRequire(import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const koffi = require('koffi') as any;
    const kernel32 = koffi.load('kernel32.dll');
    const ntdll = koffi.load('ntdll.dll');
    const crt = koffi.load('msvcrt.dll');
    // koffi 类型未导出 pointerSize；运行时有，缺省按架构估
    const ptrSize =
      typeof koffi.pointerSize === 'number'
        ? koffi.pointerSize
        : process.arch.includes('64')
          ? 8
          : 4;
    apis = {
      koffi,
      ptrSize,
      // 第二参用 void*，避免 str16+null 踩坑
      CreateJobObjectW: kernel32.func('CreateJobObjectW', 'void *', [
        'void *',
        'void *',
      ]),
      SetInformationJobObject: kernel32.func(
        'SetInformationJobObject',
        'bool',
        ['void *', 'uint', 'void *', 'uint'],
      ),
      OpenProcess: kernel32.func('OpenProcess', 'void *', [
        'uint',
        'bool',
        'uint',
      ]),
      AssignProcessToJobObject: kernel32.func(
        'AssignProcessToJobObject',
        'bool',
        ['void *', 'void *'],
      ),
      TerminateJobObject: kernel32.func('TerminateJobObject', 'bool', [
        'void *',
        'uint',
      ]),
      CloseHandle: kernel32.func('CloseHandle', 'bool', ['void *']),
      GetLastError: kernel32.func('GetLastError', 'uint', []),
      CreatePipe: kernel32.func('CreatePipe', 'bool', [
        'void *',
        'void *',
        'void *',
        'uint',
      ]),
      SetHandleInformation: kernel32.func('SetHandleInformation', 'bool', [
        'void *',
        'uint',
        'uint',
      ]),
      // lpCommandLine 必须可写；用 void* 传 Buffer
      CreateProcessW: kernel32.func('CreateProcessW', 'bool', [
        'void *',
        'void *',
        'void *',
        'void *',
        'bool',
        'uint',
        'void *',
        'str16',
        'void *',
        'void *',
      ]),
      ResumeThread: kernel32.func('ResumeThread', 'uint', ['void *']),
      GetExitCodeProcess: kernel32.func('GetExitCodeProcess', 'bool', [
        'void *',
        'void *',
      ]),
      WaitForSingleObject: kernel32.func('WaitForSingleObject', 'uint', [
        'void *',
        'uint',
      ]),
      GetStdHandle: kernel32.func('GetStdHandle', 'void *', ['int32']),
      NtSuspendProcess: ntdll.func('NtSuspendProcess', 'long', ['void *']),
      NtResumeProcess: ntdll.func('NtResumeProcess', 'long', ['void *']),
      _open_osfhandle: crt.func('_open_osfhandle', 'int', ['void *', 'int']),
    };
    return apis;
  } catch {
    apis = null;
    return null;
  }
}

function readPtr(buf: Buffer, offset: number, ptrSize: number): unknown {
  if (ptrSize === 8) return buf.readBigUInt64LE(offset);
  return buf.readUInt32LE(offset);
}

function writePtr(
  buf: Buffer,
  offset: number,
  value: unknown,
  ptrSize: number,
): void {
  if (ptrSize === 8) {
    const n =
      typeof value === 'bigint'
        ? value
        : BigInt(typeof value === 'number' ? value : Number(value));
    buf.writeBigUInt64LE(n, offset);
  } else {
    buf.writeUInt32LE(Number(value), offset);
  }
}

function wrapJob(api: Apis, hJob: unknown): ProcessJob {
  let closed = false;
  return {
    assigned: true,
    terminate: () => {
      if (closed) return false;
      return !!api.TerminateJobObject(hJob, 1);
    },
    close: () => {
      if (closed) return;
      closed = true;
      api.CloseHandle(hJob);
    },
  };
}

function createJobWithKillOnClose(api: Apis): unknown | null {
  const hJob = api.CreateJobObjectW(null, null);
  if (!hJob) return null;
  const info = Buffer.alloc(128);
  info.writeUInt32LE(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, 16);
  if (
    !api.SetInformationJobObject(
      hJob,
      JobObjectExtendedLimitInformation,
      info,
      info.length,
    )
  ) {
    api.CloseHandle(hJob);
    return null;
  }
  return hJob;
}

/** 对齐 Node shell:true 的命令行 */
export function winShellCommandLine(cmd: string, args: string[]): string {
  const comspec = process.env.ComSpec || 'cmd.exe';
  const inner = [cmd, ...args]
    .map((a) => {
      if (a.length === 0) return '""';
      if (!/[\s"&|<>^%]/.test(a)) return a;
      return `"${a.replace(/"/g, '\\"')}"`;
    })
    .join(' ');
  // /s /c 后整段用引号包一层（与 Node 一致）
  return `${comspec} /d /s /c "${inner}"`;
}

function buildEnvBlock(env: NodeJS.ProcessEnv): Buffer {
  const pairs: string[] = [];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || v === null) continue;
    if (!k || k.includes('=')) continue;
    pairs.push(`${k}=${String(v)}`);
  }
  pairs.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  return Buffer.from(`${pairs.join('\0')}\0\0`, 'utf16le');
}

function createPipe(api: Apis): { read: unknown; write: unknown } | null {
  const sa = Buffer.alloc(api.ptrSize === 8 ? 24 : 12);
  sa.writeUInt32LE(sa.length, 0);
  if (api.ptrSize === 8) sa.writeUInt32LE(1, 16);
  else sa.writeUInt32LE(1, 8);
  const rBuf = Buffer.alloc(api.ptrSize);
  const wBuf = Buffer.alloc(api.ptrSize);
  if (!api.CreatePipe(rBuf, wBuf, sa, 0)) return null;
  const read = readPtr(rBuf, 0, api.ptrSize);
  const write = readPtr(wBuf, 0, api.ptrSize);
  api.SetHandleInformation(read, HANDLE_FLAG_INHERIT, 0);
  return { read, write };
}

/**
 * 已存在 PID：Suspend → Assign → Resume（Electron 内常失败，优先用 spawnInWinJob）。
 */
export function tryCreateWinProcessJob(rootPid: number): ProcessJob | null {
  return tryOwnProcess(rootPid).job;
}

export function tryOwnProcess(rootPid: number): OwnResult {
  const api = load();
  if (!api) return { job: null, stage: 'load', err: 0 };
  if (!rootPid || rootPid <= 0) return { job: null, stage: 'pid', err: 0 };

  const hJob = createJobWithKillOnClose(api);
  if (!hJob) {
    return { job: null, stage: 'create-job', err: api.GetLastError() };
  }

  const hProcess = api.OpenProcess(PROCESS_OWN_ACCESS, 0, rootPid);
  if (!hProcess) {
    const err = api.GetLastError();
    api.CloseHandle(hJob);
    return { job: null, stage: 'open-process', err };
  }

  api.NtSuspendProcess(hProcess);
  const assigned = !!api.AssignProcessToJobObject(hJob, hProcess);
  if (!assigned) {
    const err = api.GetLastError();
    api.NtResumeProcess(hProcess);
    api.CloseHandle(hProcess);
    api.CloseHandle(hJob);
    return { job: null, stage: 'assign', err };
  }
  api.NtResumeProcess(hProcess);
  api.CloseHandle(hProcess);
  return { job: wrapJob(api, hJob) };
}

export type WinJobSpawn = {
  proc: ChildProcess;
  processJob: ProcessJob;
};

/**
 * BREAKAWAY + SUSPENDED 创建根进程，入 Job 后再 Resume。
 * 用于绕过 Electron/Chromium 已占用的 Job。
 */
let lastSpawnErr: { stage: string; err: number } | null = null;

export function lastSpawnInWinJobError(): { stage: string; err: number } | null {
  return lastSpawnErr;
}

export function spawnInWinJob(opts: {
  cmd: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  shell?: boolean;
}): WinJobSpawn | null {
  lastSpawnErr = null;
  const api = load();
  if (!api) {
    lastSpawnErr = { stage: 'load', err: 0 };
    return null;
  }

  const hJob = createJobWithKillOnClose(api);
  if (!hJob) {
    lastSpawnErr = { stage: 'create-job', err: api.GetLastError() };
    return null;
  }

  const outPipe = createPipe(api);
  const errPipe = createPipe(api);
  if (!outPipe || !errPipe) {
    lastSpawnErr = { stage: 'pipe', err: api.GetLastError() };
    api.CloseHandle(hJob);
    return null;
  }

  const siSize = api.ptrSize === 8 ? 104 : 68;
  const si = Buffer.alloc(siSize);
  si.writeUInt32LE(siSize, 0);
  const flagsOff = api.ptrSize === 8 ? 60 : 44;
  si.writeUInt32LE(STARTF_USESTDHANDLES, flagsOff);
  const stdOff = api.ptrSize === 8 ? 80 : 56;
  writePtr(si, stdOff, api.GetStdHandle(STD_INPUT_HANDLE), api.ptrSize);
  writePtr(si, stdOff + api.ptrSize, outPipe.write, api.ptrSize);
  writePtr(si, stdOff + api.ptrSize * 2, errPipe.write, api.ptrSize);

  const pi = Buffer.alloc(api.ptrSize === 8 ? 24 : 16);
  const cmdline = opts.shell
    ? winShellCommandLine(opts.cmd, opts.args)
    : [opts.cmd, ...opts.args]
        .map((a) => (/\s/.test(a) ? `"${a}"` : a))
        .join(' ');
  // CreateProcessW 可改写命令行缓冲区
  const cmdBuf = Buffer.from(cmdline + '\0', 'utf16le');
  const envBlock = buildEnvBlock(opts.env);
  const flags =
    CREATE_SUSPENDED |
    CREATE_UNICODE_ENVIRONMENT |
    CREATE_BREAKAWAY_FROM_JOB |
    CREATE_NO_WINDOW;

  const ok = api.CreateProcessW(
    null,
    cmdBuf,
    null,
    null,
    1,
    flags,
    envBlock,
    opts.cwd,
    si,
    pi,
  );

  api.CloseHandle(outPipe.write);
  api.CloseHandle(errPipe.write);

  if (!ok) {
    lastSpawnErr = { stage: 'create-process', err: api.GetLastError() };
    api.CloseHandle(outPipe.read);
    api.CloseHandle(errPipe.read);
    api.CloseHandle(hJob);
    return null;
  }

  const hProcess = readPtr(pi, 0, api.ptrSize);
  const hThread = readPtr(pi, api.ptrSize, api.ptrSize);
  const pid = pi.readUInt32LE(api.ptrSize * 2);

  if (!api.AssignProcessToJobObject(hJob, hProcess)) {
    lastSpawnErr = { stage: 'assign', err: api.GetLastError() };
    api.TerminateJobObject(hJob, 1);
    api.CloseHandle(hThread);
    api.CloseHandle(hProcess);
    api.CloseHandle(outPipe.read);
    api.CloseHandle(errPipe.read);
    api.CloseHandle(hJob);
    return null;
  }

  api.ResumeThread(hThread);
  api.CloseHandle(hThread);

  const processJob = wrapJob(api, hJob);

  const outFd = api._open_osfhandle(outPipe.read, _O_RDONLY);
  const errFd = api._open_osfhandle(errPipe.read, _O_RDONLY);
  if (outFd < 0 || errFd < 0) {
    processJob.terminate();
    processJob.close();
    api.CloseHandle(hProcess);
    return null;
  }

  const stdout = fs.createReadStream('', { fd: outFd, autoClose: true });
  const stderr = fs.createReadStream('', { fd: errFd, autoClose: true });

  /** ChildProcess 若干字段在 @types/node 里是 readonly，自建伪进程需可写 */
  type FakeChild = EventEmitter & {
    pid: number;
    stdout: ChildProcess['stdout'];
    stderr: ChildProcess['stderr'];
    stdin: null;
    killed: boolean;
    connected: boolean;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    spawnargs: string[];
    spawnfile: string;
    kill: ChildProcess['kill'];
  };

  const emitter = new EventEmitter() as FakeChild;
  emitter.pid = pid;
  emitter.stdout = stdout as ChildProcess['stdout'];
  emitter.stderr = stderr as ChildProcess['stderr'];
  emitter.stdin = null;
  emitter.killed = false;
  emitter.connected = false;
  emitter.exitCode = null;
  emitter.signalCode = null;
  emitter.spawnargs = opts.args;
  emitter.spawnfile = opts.cmd;

  let finished = false;
  const finish = (code: number | null) => {
    if (finished) return;
    finished = true;
    emitter.exitCode = code;
    try {
      stdout.destroy();
    } catch {
      /* ignore */
    }
    try {
      stderr.destroy();
    } catch {
      /* ignore */
    }
    emitter.emit('close', code);
    emitter.emit('exit', code, null);
    try {
      api.CloseHandle(hProcess);
    } catch {
      /* ignore */
    }
  };

  const timer = setInterval(() => {
    const w = api.WaitForSingleObject(hProcess, 0);
    if (w === WAIT_TIMEOUT) return;
    if (w === WAIT_OBJECT_0) {
      clearInterval(timer);
      const codeBuf = Buffer.alloc(4);
      if (api.GetExitCodeProcess(hProcess, codeBuf)) {
        const code = codeBuf.readUInt32LE(0);
        finish(code === STILL_ACTIVE ? null : code);
      } else {
        finish(null);
      }
    }
  }, 100);
  timer.unref?.();

  emitter.kill = ((_signal?: NodeJS.Signals | number) => {
    emitter.killed = true;
    processJob.terminate();
    return true;
  }) as ChildProcess['kill'];

  return { proc: emitter as unknown as ChildProcess, processJob };
}

export function winProcessJobAvailable(): boolean {
  return load() != null;
}
