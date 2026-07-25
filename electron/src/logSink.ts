import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/** 缓冲达到该字节数再 append 落盘 */
const FLUSH_BYTES = 64 * 1024;
/** 单文件达到该大小后拆出新文件（文件名带毫秒） */
const MAX_FILE_BYTES = 1 * 1024 * 1024;

function logsRoot(): string {
  return path.join(app.getPath('userData'), 'run-logs');
}

function sanitize(name: string): string {
  const s = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_');
  return (s.slice(0, 80) || 'log').replace(/^\.+/, '_') || 'log';
}

function dayStamp(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** HHmmssSSS，精确到毫秒 */
function msStamp(d = new Date()): string {
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}${mi}${s}${ms}`;
}

/**
 * 带缓冲的落盘 writer：满 FLUSH_BYTES 写入；单文件满 MAX_FILE_BYTES 换新文件。
 * nextPath 每次开新文件时调用（应含毫秒时间戳）。
 */
class RotatingLogWriter {
  private buf = '';
  private closed = false;
  private filePath = '';
  private bytesOnDisk = 0;
  private part = 0;

  constructor(
    private readonly nextPath: () => string,
    private readonly fileHeader?: (part: number, filePath: string) => string,
  ) {
    this.openNextFile();
  }

  private openNextFile(): void {
    this.part += 1;
    this.filePath = this.allocatePath();
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.bytesOnDisk = 0;
    if (this.fileHeader) {
      const header = this.fileHeader(this.part, this.filePath);
      if (header) {
        try {
          fs.writeFileSync(this.filePath, header, 'utf8');
          this.bytesOnDisk = Buffer.byteLength(header, 'utf8');
        } catch {
          /* ignore */
        }
      }
    }
  }

  /** 同毫秒冲突时追加 _2 / _3 … */
  private allocatePath(): string {
    let candidate = this.nextPath();
    if (!fs.existsSync(candidate)) return candidate;
    const dir = path.dirname(candidate);
    const ext = path.extname(candidate);
    const base = path.basename(candidate, ext);
    for (let n = 2; n < 1000; n++) {
      candidate = path.join(dir, `${base}_${n}${ext}`);
      if (!fs.existsSync(candidate)) return candidate;
    }
    return path.join(dir, `${base}_${Date.now()}${ext}`);
  }

  write(chunk: string): void {
    if (this.closed || !chunk) return;
    this.buf += chunk;
    if (Buffer.byteLength(this.buf, 'utf8') >= FLUSH_BYTES) {
      this.flush();
    }
  }

  flush(): void {
    if (!this.buf) return;
    const data = this.buf;
    this.buf = '';
    const nbytes = Buffer.byteLength(data, 'utf8');
    try {
      fs.appendFileSync(this.filePath, data, 'utf8');
      this.bytesOnDisk += nbytes;
    } catch {
      /* ignore disk errors */
      return;
    }
    if (this.bytesOnDisk >= MAX_FILE_BYTES) {
      this.openNextFile();
    }
  }

  /** 尚未写入磁盘的缓冲字节数 */
  pendingBytes(): number {
    return Buffer.byteLength(this.buf, 'utf8');
  }

  close(): void {
    if (this.closed) return;
    this.flush();
    this.closed = true;
  }
}

const jobWriters = new Map<string, RotatingLogWriter>();
let systemWriter: RotatingLogWriter | null = null;
/** 用户开关：默认不落盘 */
let persistEnabled = false;
/** 退出收尾后禁止再开新文件（避免 close 晚到 reopen） */
let shutdown = false;

function jobLogPath(dir: string, scriptName: string): string {
  const now = new Date();
  const base = sanitize(path.basename(dir));
  const script = sanitize(scriptName);
  const file = `${base}__${script}__${msStamp(now)}.log`;
  return path.join(logsRoot(), dayStamp(now), file);
}

function systemLogPath(): string {
  const now = new Date();
  return path.join(logsRoot(), dayStamp(now), `system__${msStamp(now)}.log`);
}

function closeOpenWriters(): void {
  for (const id of [...jobWriters.keys()]) closeJobDiskLog(id);
  systemWriter?.close();
  systemWriter = null;
}

/** 开关落盘；关闭时先 flush 再停写 */
export function setPersistLogs(enabled: boolean): void {
  persistEnabled = enabled;
  if (!enabled) closeOpenWriters();
}

export function isPersistLogsEnabled(): boolean {
  return persistEnabled && !shutdown;
}

export function appendJobDiskLog(id: string, scriptName: string, dir: string, chunk: string): void {
  if (shutdown || !persistEnabled || !chunk) return;
  let w = jobWriters.get(id);
  if (!w) {
    const resolved = path.resolve(dir);
    w = new RotatingLogWriter(
      () => jobLogPath(dir, scriptName),
      (part) =>
        `# pkg-runner\n# dir: ${resolved}\n# script: ${scriptName}\n# part: ${part}\n# started: ${new Date().toISOString()}\n\n`,
    );
    jobWriters.set(id, w);
  }
  w.write(chunk);
}

export function closeJobDiskLog(id: string): void {
  const w = jobWriters.get(id);
  if (!w) return;
  w.close();
  jobWriters.delete(id);
}

export function appendSystemDiskLog(chunk: string): void {
  if (shutdown || !persistEnabled || !chunk) return;
  if (!systemWriter) {
    systemWriter = new RotatingLogWriter(() => systemLogPath());
  }
  systemWriter.write(chunk);
}

export type FlushDiskLogsResult = {
  ok: boolean;
  persistEnabled: boolean;
  writers: number;
  /** flush 前缓冲中的字节数 */
  pendingBytes: number;
  logsDir: string;
  at: string;
};

export function flushAllDiskLogs(): FlushDiskLogsResult {
  let pendingBytes = 0;
  let writers = 0;
  for (const w of jobWriters.values()) {
    pendingBytes += w.pendingBytes();
    writers += 1;
    w.flush();
  }
  if (systemWriter) {
    pendingBytes += systemWriter.pendingBytes();
    writers += 1;
    systemWriter.flush();
  }
  return {
    ok: true,
    persistEnabled,
    writers,
    pendingBytes,
    logsDir: logsRoot(),
    at: new Date().toISOString(),
  };
}

export function closeAllDiskLogs(): void {
  shutdown = true;
  closeOpenWriters();
}

export function getLogsDir(): string {
  return logsRoot();
}

export function ensureLogsDir(): string {
  const dir = logsRoot();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function countLogFiles(dir: string): number {
  let n = 0;
  try {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) n += countLogFiles(p);
      else n += 1;
    }
  } catch {
    /* ignore */
  }
  return n;
}

/** 关闭当前写入并删除 run-logs 下全部文件；落盘开启时后续输出会写新文件 */
export function clearDiskLogs(): { ok: boolean; removed: number; dir: string } {
  const dir = logsRoot();
  closeOpenWriters();
  let removed = 0;
  try {
    if (fs.existsSync(dir)) {
      removed = countLogFiles(dir);
      fs.rmSync(dir, { recursive: true, force: true });
    }
    fs.mkdirSync(dir, { recursive: true });
    return { ok: true, removed, dir };
  } catch {
    return { ok: false, removed: 0, dir };
  }
}
