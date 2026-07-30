import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { contextBridge, ipcRenderer } from 'electron';

type PendingExport = { filePath: string };

const pending = new Map<string, PendingExport>();

const api = {
  getPayload: (): Promise<{
    fileUrl: string;
    width: number;
    height: number;
    drawColor?: string;
    snapGuides?: { xs: number[]; ys: number[] };
  } | null> => ipcRenderer.invoke('ss:get-payload'),

  onSessionStart: (
    cb: (payload: {
      fileUrl: string;
      width: number;
      height: number;
      drawColor?: string;
      snapGuides?: { xs: number[]; ys: number[] };
    }) => void,
  ) => {
    const handler = (
      _: unknown,
      payload: {
        fileUrl: string;
        width: number;
        height: number;
        drawColor?: string;
        snapGuides?: { xs: number[]; ys: number[] };
      },
    ) => cb(payload);
    ipcRenderer.on('ss:session-start', handler);
    return () => ipcRenderer.removeListener('ss:session-start', handler);
  },

  onSessionClear: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('ss:session-clear', handler);
    return () => ipcRenderer.removeListener('ss:session-clear', handler);
  },

  onDismissing: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('ss:dismissing', handler);
    return () => ipcRenderer.removeListener('ss:dismissing', handler);
  },

  onAppearing: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('ss:appearing', handler);
    return () => ipcRenderer.removeListener('ss:appearing', handler);
  },

  onSnapGuides: (cb: (guides: { xs: number[]; ys: number[] }) => void) => {
    const handler = (_: unknown, guides: { xs: number[]; ys: number[] }) =>
      cb(guides);
    ipcRenderer.on('ss:snap-guides', handler);
    return () => ipcRenderer.removeListener('ss:snap-guides', handler);
  },

  onWindowTargets: (
    cb: (
      windows: { title: string; x: number; y: number; w: number; h: number }[],
    ) => void,
  ) => {
    const handler = (
      _: unknown,
      windows: { title: string; x: number; y: number; w: number; h: number }[],
    ) => cb(windows);
    ipcRenderer.on('ss:window-targets', handler);
    return () => ipcRenderer.removeListener('ss:window-targets', handler);
  },

  cancel: (): Promise<void> => ipcRenderer.invoke('ss:cancel'),

  /** 首帧已画好，主进程可 show 遮罩 */
  contentReady: (): void => {
    ipcRenderer.send('ss:content-ready');
  },

  getDrawColor: (): Promise<string> => ipcRenderer.invoke('ss:get-draw-color'),

  setDrawColor: (hex: string): Promise<string> =>
    ipcRenderer.invoke('ss:set-draw-color', hex),

  /** 一次传回裁剪 PNG（选区通常远小于整屏） */
  completePng: (
    png: Uint8Array,
    captions: string[],
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('ss:complete-png', png, captions),

  /** 分片写入临时 PNG，避免超大图一次过 contextBridge（兜底） */
  beginComplete: (): string => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const filePath = path.join(os.tmpdir(), `pkg-ss-out-${id}.png`);
    fs.writeFileSync(filePath, Buffer.alloc(0));
    pending.set(id, { filePath });
    return id;
  },

  appendComplete: (id: string, chunk: Uint8Array): void => {
    const rec = pending.get(String(id || ''));
    if (!rec) throw new Error('导出会话不存在');
    fs.appendFileSync(rec.filePath, Buffer.from(chunk));
  },

  finishComplete: (
    id: string,
    captions: string[],
  ): Promise<{ ok: boolean; error?: string }> => {
    const key = String(id || '');
    const rec = pending.get(key);
    pending.delete(key);
    if (!rec) return Promise.resolve({ ok: false, error: '导出会话不存在' });
    return ipcRenderer.invoke('ss:complete-file', {
      path: rec.filePath,
      captions,
    });
  },

  abortComplete: (id: string): void => {
    const key = String(id || '');
    const rec = pending.get(key);
    pending.delete(key);
    if (!rec) return;
    try {
      if (fs.existsSync(rec.filePath)) fs.unlinkSync(rec.filePath);
    } catch {
      /* ignore */
    }
  },
};

contextBridge.exposeInMainWorld('ssApi', api);

declare global {
  interface Window {
    ssApi: typeof api;
  }
}
