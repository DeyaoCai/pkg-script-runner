/**
 * Runner UI 状态真相源（主进程）。
 * 渲染进程只做投影：亮窗全量快照 + 可见时增量。
 */

export const SYSTEM_ID = 'system';

/** 与 web AppCtrl 对齐的 UI 缓冲上限 */
export const UI_LOG_MAX = 200_000;
export const UI_LOG_KEEP = 150_000;
/** Shell 环略小：亮窗 replay 用 */
export const UI_SHELL_MAX = 80_000;
export const UI_SHELL_KEEP = 60_000;

export type UiSessionKind = 'system' | 'job' | 'shell';

export type UiSessionSnap = {
  id: string;
  kind: UiSessionKind;
  title: string;
  dir: string | null;
  scriptName?: string;
  text: string;
  running: boolean;
  stopping: boolean;
  code: number | null;
  cwd?: string;
};

type SessionRec = UiSessionSnap;

const sessions = new Map<string, SessionRec>();

function trimText(text: string, max: number, keep: number): string {
  if (text.length <= max) return text;
  return text.slice(-keep);
}

function limitsFor(kind: UiSessionKind): { max: number; keep: number } {
  if (kind === 'shell') return { max: UI_SHELL_MAX, keep: UI_SHELL_KEEP };
  return { max: UI_LOG_MAX, keep: UI_LOG_KEEP };
}

export function ensureUiSystemSession(): void {
  if (sessions.has(SYSTEM_ID)) return;
  sessions.set(SYSTEM_ID, {
    id: SYSTEM_ID,
    kind: 'system',
    title: '系统',
    dir: null,
    text: '',
    running: false,
    stopping: false,
    code: null,
  });
}

export function ensureUiSession(
  id: string,
  meta?: Partial<Omit<SessionRec, 'id' | 'text'>> & { text?: string },
): SessionRec {
  ensureUiSystemSession();
  let s = sessions.get(id);
  if (!s) {
    const kind: UiSessionKind =
      meta?.kind ??
      (id.startsWith('shell::') ? 'shell' : id === SYSTEM_ID ? 'system' : 'job');
    s = {
      id,
      kind,
      title: meta?.title || meta?.scriptName || id,
      dir: meta?.dir ?? null,
      scriptName: meta?.scriptName,
      text: meta?.text ?? '',
      running: !!meta?.running,
      stopping: !!meta?.stopping,
      code: meta?.code ?? null,
      cwd: meta?.cwd,
    };
    sessions.set(id, s);
    return s;
  }
  if (meta?.title) s.title = meta.title;
  if (meta?.dir !== undefined) s.dir = meta.dir;
  if (meta?.scriptName) s.scriptName = meta.scriptName;
  if (meta?.running != null) s.running = meta.running;
  if (meta?.stopping != null) s.stopping = meta.stopping;
  if (meta?.code !== undefined) s.code = meta.code;
  if (meta?.cwd) s.cwd = meta.cwd;
  if (meta?.kind) s.kind = meta.kind;
  return s;
}

export function appendUiSessionText(
  id: string,
  chunk: string,
  meta?: Partial<Omit<SessionRec, 'id' | 'text'>>,
): void {
  if (!chunk && !meta) return;
  const s = ensureUiSession(id, meta);
  if (chunk) {
    const { max, keep } = limitsFor(s.kind);
    s.text += chunk;
    s.text = trimText(s.text, max, keep);
  }
}

export function clearUiSessionText(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  s.text = '';
  s.code = null;
}

export function removeUiSession(id: string): void {
  if (id === SYSTEM_ID) return;
  sessions.delete(id);
}

export function listUiSessions(): UiSessionSnap[] {
  ensureUiSystemSession();
  return [...sessions.values()].map((s) => ({ ...s }));
}

export function getUiSession(id: string): UiSessionSnap | undefined {
  const s = sessions.get(id);
  return s ? { ...s } : undefined;
}

export function resetUiStateStore(): void {
  sessions.clear();
  ensureUiSystemSession();
}
