import { Controller } from '@pkg-runner/controller';
import type { ScreenshotHistoryItem } from '../env';
import { getTrayApi } from '../trayApi';

type HistoryData = {
  items: ScreenshotHistoryItem[];
  selected: string[];
};

function fmt(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

export class HistoryCtrl extends Controller<HistoryData, object, object> {
  private unsub: (() => void) | null = null;

  constructor() {
    super({
      data: {
        items: [],
        selected: [],
      },
      props: {},
      state: {},
    });
  }

  get canExport(): boolean {
    return this.data.selected.length > 0;
  }

  isSelected(id: string): boolean {
    return this.data.selected.includes(id);
  }

  formatTime(ts: number): string {
    return fmt(ts);
  }

  displayText(item: ScreenshotHistoryItem): string {
    return item.text || '（无标记文案）';
  }

  toggle(id: string): void {
    const set = new Set(this.data.selected);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    this.setData({ selected: [...set] });
  }

  async refresh(): Promise<void> {
    const api = getTrayApi();
    if (!api?.listScreenshotHistory) return;
    const items = (await api.listScreenshotHistory()) || [];
    const ids = new Set(items.map((x) => x.id));
    this.setData({
      items,
      selected: this.data.selected.filter((id) => ids.has(id)),
    });
  }

  async copy(id: string, which: 'image' | 'text' | 'both'): Promise<void> {
    await getTrayApi()?.copyScreenshotHistory(id, which);
  }

  async remove(id: string): Promise<void> {
    await getTrayApi()?.removeScreenshotHistory(id);
    await this.refresh();
  }

  startScreenshot(): void {
    void getTrayApi()?.startScreenshot();
  }

  openDir(): void {
    void getTrayApi()?.openScreenshotHistoryDir();
  }

  exportMd(): void {
    void getTrayApi()?.exportScreenshotHistory([...this.data.selected], 'md');
  }

  exportHtml(): void {
    void getTrayApi()?.exportScreenshotHistory([...this.data.selected], 'html');
  }

  async clear(): Promise<void> {
    await getTrayApi()?.clearScreenshotHistory();
    await this.refresh();
  }

  close(): void {
    void getTrayApi()?.closeWindow();
  }

  mount(): void {
    const api = getTrayApi();
    this.unsub = api?.onHistoryChanged?.(() => {
      void this.refresh();
    }) ?? null;
    void this.refresh();
  }

  unmount(): void {
    this.unsub?.();
    this.unsub = null;
  }
}
