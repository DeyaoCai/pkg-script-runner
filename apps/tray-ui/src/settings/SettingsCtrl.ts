import {
  TitleBarShellCtrl,
  defaultTitleBarShellData,
  type TitleBarShellData,
} from '@pkg-runner/shell/renderer';
import type { TWindowBridge } from '@pkg-runner/shell/renderer';
import {
  BRAND_PRESET_PROD,
  BRAND_PRESET_TEST,
  applyBrandColor,
  applyGlass,
  applySharedUiSettings,
  applyTheme,
  normalizeBrandColor,
} from '@pkg-runner/tokens';
import type { SharedSettings, TrayProfileInfo } from '../env';
import { ensureTrayApi, getTrayApi } from '../trayApi';

const FONTS = [
  { id: 'jetbrains', label: 'JetBrains Mono' },
  { id: 'system', label: '系统默认' },
  { id: 'segoe', label: 'Segoe UI' },
  { id: 'cascadia', label: 'Cascadia Code' },
  { id: 'consolas', label: 'Consolas' },
] as const;

type HotkeyKind =
  | 'screenshot'
  | 'activate'
  | 'editor'
  | 'zones'
  | 'settings'
  | 'history';

type SettingsData = TitleBarShellData & {
  settingsSubPath: string;
  settingsSubMeta: string;
  appHint: string;
  theme: 'dark' | 'light';
  fontId: string;
  brandColor: string;
  glassAlpha: number;
  glassBlur: number;
  alwaysOnTop: boolean;
  shellMosaicCols: number;
  shellLayout: 'grid' | 'single';
  persistLogs: boolean;
  hotkeysEnabled: boolean;
  historyLimit: number;
  pendingShot: string;
  pendingAct: string;
  pendingEditor: string;
  pendingZones: string;
  pendingSettings: string;
  pendingHistory: string;
  recording: HotkeyKind | null;
  statusText: string;
  statusOk: boolean;
  busy: boolean;
  applyLabel: string;
  saveLabel: string;
  wallpapers: Array<{ name: string; path: string; thumb: string }>;
  appBackground: string | null;
};

function formatHotkey(accel: string): string {
  const raw = String(accel || '').trim();
  if (!raw) return '未设置 · 点击录制';
  return raw
    .replace(/CommandOrControl/gi, 'Ctrl')
    .replace(/Control/gi, 'Ctrl')
    .replace(/Shift/gi, 'Shift')
    .replace(/Alt/gi, 'Alt');
}

function keyToAccel(e: KeyboardEvent): string {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return '';
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let key = e.key;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toUpperCase();
  else if (key.startsWith('Arrow')) key = key.slice(5);
  parts.push(key);
  return parts.join('+');
}

function bootEnv(): 'prod' | 'test' {
  return window.__bootEnv === 'test' ? 'test' : 'prod';
}

export class SettingsCtrl extends TitleBarShellCtrl<
  SettingsData,
  Record<string, never>,
  Record<string, never>
> {
  readonly fonts = FONTS;
  readonly presetProd = BRAND_PRESET_PROD;
  readonly presetTest = BRAND_PRESET_TEST;

  private hydrated = false;
  private unsubSettings: (() => void) | null = null;
  private offMax: (() => void) | null = null;
  private onKeyDown = (e: KeyboardEvent) => {
    void this.handleKeyDown(e);
  };

  constructor() {
    const env = bootEnv();
    super({
      data: {
        ...defaultTitleBarShellData({
          productName: '设置',
          subtitle: env === 'test' ? '' : '正式',
          colorEnv: env,
        }),
        settingsSubPath: '',
        settingsSubMeta: '正在识别配置目录…',
        appHint: '显示当前配置环境；可从这里唤起窗口。',
        theme: 'dark',
        fontId: 'jetbrains',
        brandColor: BRAND_PRESET_PROD,
        glassAlpha: 55,
        glassBlur: 22,
        alwaysOnTop: false,
        shellMosaicCols: 2,
        shellLayout: 'grid',
        persistLogs: false,
        hotkeysEnabled: true,
        historyLimit: 10,
        pendingShot: '',
        pendingAct: '',
        pendingEditor: '',
        pendingZones: '',
        pendingSettings: '',
        pendingHistory: '',
        recording: null,
        statusText: '',
        statusOk: false,
        busy: false,
        applyLabel: '应用',
        saveLabel: '保存',
        wallpapers: [],
        appBackground: null,
      },
      props: {},
      state: {},
    });
  }

  getWindowApi(): TWindowBridge | null {
    const api = getTrayApi();
    if (!api?.windowMinimize) return null;
    return {
      windowMinimize: () => api.windowMinimize(),
      windowMaximize: () => api.windowMaximize(),
      windowClose: () => api.windowClose(),
      windowIsMaximized: () => api.windowIsMaximized(),
      onMaximizedChange: (cb) => api.onMaximizedChange(cb),
    };
  }

  hotkeyLabel(kind: HotkeyKind): string {
    if (this.data.recording === kind) return '按下热键…';
    return formatHotkey(this.pendingFor(kind));
  }

  private pendingFor(kind: HotkeyKind): string {
    switch (kind) {
      case 'screenshot':
        return this.data.pendingShot;
      case 'activate':
        return this.data.pendingAct;
      case 'editor':
        return this.data.pendingEditor;
      case 'zones':
        return this.data.pendingZones;
      case 'settings':
        return this.data.pendingSettings;
      case 'history':
        return this.data.pendingHistory;
    }
  }

  private setPending(kind: HotkeyKind, accel: string): void {
    if (kind === 'screenshot') this.setData({ pendingShot: accel });
    else if (kind === 'activate') this.setData({ pendingAct: accel });
    else if (kind === 'editor') this.setData({ pendingEditor: accel });
    else if (kind === 'zones') this.setData({ pendingZones: accel });
    else if (kind === 'settings') this.setData({ pendingSettings: accel });
    else this.setData({ pendingHistory: accel });
  }

  get brandIsProd(): boolean {
    return this.data.brandColor === BRAND_PRESET_PROD;
  }

  get brandIsTest(): boolean {
    return this.data.brandColor === BRAND_PRESET_TEST;
  }

  private dlog(event: string, detail?: unknown): void {
    void getTrayApi()?.diagLog?.(event, detail);
  }

  private setStatus(text: string, ok: boolean): void {
    this.setData({ statusText: text || '', statusOk: !!ok });
  }

  applyThemeUi(theme: string): void {
    const t = applyTheme(theme === 'light' ? 'light' : 'dark');
    this.setData({ theme: t });
  }

  applyLayoutUi(layout: string): void {
    this.setData({ shellLayout: layout === 'single' ? 'single' : 'grid' });
  }

  setBrandColorUi(hex: string): void {
    const c = normalizeBrandColor(hex, BRAND_PRESET_PROD);
    applyBrandColor(c);
    this.setData({ brandColor: c });
  }

  /** Live preview panel opacity + backdrop blur (persisted on Apply/Save). */
  setGlassUi(alphaPct: number, blurPx: number): void {
    const a = Math.min(100, Math.max(10, Math.round(Number(alphaPct) || 100)));
    const b = Math.min(40, Math.max(0, Math.round(Number(blurPx) || 0)));
    applyGlass(a, b);
    this.setData({ glassAlpha: a, glassBlur: b });
  }

  applyProfile(p: TrayProfileInfo | null | undefined): void {
    if (!p || typeof p !== 'object') return;
    const isTest = p.colorEnv === 'test';
    document.documentElement.setAttribute('data-env', isTest ? 'test' : 'prod');
    const label = isTest ? '测试' : '正式';
    document.title = `设置 · ${label}`;
    this.setBrand({
      productName: '设置',
      subtitle: isTest ? '' : '正式',
      colorEnv: isTest ? 'test' : 'prod',
    });
    this.setData({
      settingsSubPath: p.settingsPath || '',
      settingsSubMeta: `（${p.packaged ? '安装包' : '开发'} · ${p.profile || '?'}）`,
      appHint: `${label} · ${p.packaged ? '安装包' : '开发'} · ${p.profile || '?'} — 可从这里唤起窗口。`,
    });
    this.dlog('profile', {
      profile: p.profile,
      colorEnv: p.colorEnv,
      settingsPath: p.settingsPath,
    });
  }

  applySettings(s: SharedSettings): void {
    this.hydrated = true;
    this.dlog('apply', {
      screenshotHotkey: s?.screenshotHotkey,
      activateHotkey: s?.activateHotkey,
      editorHotkey: s?.editorHotkey,
      theme: s?.theme,
      fontId: s?.fontId,
    });
    const brand =
      s.brandColor ||
      (s.brandTone === 'test' ? BRAND_PRESET_TEST : BRAND_PRESET_PROD);
    this.setData({
      pendingShot: s.screenshotHotkey || '',
      pendingAct: s.activateHotkey || '',
      pendingEditor: s.editorHotkey || '',
      pendingZones: s.zonesHotkey || '',
      pendingSettings: s.settingsHotkey || '',
      pendingHistory: s.historyHotkey || '',
      historyLimit: s.screenshotHistoryLimit ?? 10,
      fontId: s.fontId || 'jetbrains',
      glassAlpha: s.glassAlpha ?? 100,
      glassBlur: s.glassBlur ?? 22,
      alwaysOnTop: !!s.alwaysOnTop,
      shellMosaicCols: s.shellMosaicCols ?? 2,
      persistLogs: !!s.persistLogs,
      hotkeysEnabled: s.hotkeysEnabled !== false,
      appBackground: s.appBackground ?? null,
    });
    applySharedUiSettings(
      { ...s, brandColor: brand },
      { colorEnv: bootEnv() },
    );
    this.applyThemeUi(s.theme || 'dark');
    this.setBrandColorUi(brand);
    this.applyLayoutUi(s.shellLayout || 'grid');
    this.setStatus('', false);
  }

  private readFormPatch(): Partial<SharedSettings> {
    return {
      screenshotHotkey: this.data.pendingShot,
      activateHotkey: this.data.pendingAct,
      editorHotkey: this.data.pendingEditor,
      zonesHotkey: this.data.pendingZones,
      settingsHotkey: this.data.pendingSettings,
      historyHotkey: this.data.pendingHistory,
      screenshotHistoryLimit: Number(this.data.historyLimit),
      fontId: this.data.fontId,
      theme: this.data.theme,
      brandColor: normalizeBrandColor(this.data.brandColor),
      glassAlpha: Number(this.data.glassAlpha),
      glassBlur: Number(this.data.glassBlur),
      alwaysOnTop: this.data.alwaysOnTop,
      shellMosaicCols: Number(this.data.shellMosaicCols),
      shellLayout: this.data.shellLayout,
      persistLogs: this.data.persistLogs,
      hotkeysEnabled: this.data.hotkeysEnabled,
      appBackground: this.data.appBackground,
    };
  }

  async refreshWallpapers(): Promise<void> {
    const api = getTrayApi();
    if (!api?.listWallpapers) {
      this.setData({ wallpapers: [] });
      return;
    }
    try {
      const wallpapers = await api.listWallpapers();
      this.setData({ wallpapers: wallpapers || [] });
    } catch {
      this.setData({ wallpapers: [] });
    }
  }

  async setAppBackground(name: string | null): Promise<void> {
    this.setData({ appBackground: name, busy: true });
    try {
      const ok = await this.persistSettings(name ? '应用背景' : '清除背景');
      if (ok) this.setStatus(name ? `已设为应用背景：${name}` : '已清除应用背景', true);
    } finally {
      this.setData({ busy: false });
    }
  }

  async setSystemWallpaper(item: { name: string; path: string }): Promise<void> {
    const api = getTrayApi();
    if (!api?.setDesktopWallpaper) return;
    this.setData({ busy: true });
    try {
      const res = await api.setDesktopWallpaper(item.path);
      if (!res.ok) this.setStatus(`系统壁纸失败: ${res.error || 'unknown'}`, false);
      else this.setStatus(`已设为系统桌面壁纸：${item.name}`, true);
    } finally {
      this.setData({ busy: false });
    }
  }

  openWallpapersFolder(): void {
    void getTrayApi()?.openWallpapersFolder?.();
  }

  async load(): Promise<void> {
    const api = getTrayApi();
    this.dlog('load.start', {
      hasApi: !!api,
      hasGetSettings: typeof api?.getSettings === 'function',
      hydrated: this.hydrated,
    });
    if (!api?.getSettings) {
      if (this.hydrated) {
        this.dlog('load.skip', { reason: 'already hydrated via tray inject' });
        return;
      }
      this.setStatus('无法连接托盘 API，请关闭后从托盘重新打开设置', false);
      this.dlog('load.fail', {
        reason: 'no trayApi.getSettings',
        hydrated: this.hydrated,
      });
      return;
    }
    try {
      if (typeof api.getProfile === 'function') {
        this.applyProfile(await api.getProfile());
      }
      const s = await api.getSettings();
      this.dlog('load.ok', {
        screenshotHotkey: s?.screenshotHotkey,
        activateHotkey: s?.activateHotkey,
        editorHotkey: s?.editorHotkey,
        theme: s?.theme,
      });
      this.applySettings(s);
      void this.refreshWallpapers();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.setStatus('加载设置失败：' + msg, false);
      this.dlog('load.error', { message: msg });
    }
  }

  async showRunner(): Promise<void> {
    try {
      await getTrayApi()?.showRunner?.();
      this.setStatus('已打开 Runner', true);
    } catch (e) {
      this.setStatus(e instanceof Error ? e.message : String(e), false);
    }
  }

  async showEditor(): Promise<void> {
    try {
      await getTrayApi()?.showEditor?.();
      this.setStatus('已打开编辑器', true);
    } catch (e) {
      this.setStatus(e instanceof Error ? e.message : String(e), false);
    }
  }

  async showZones(): Promise<void> {
    try {
      await getTrayApi()?.showZones?.();
      this.setStatus('已打开桌面整理', true);
    } catch (e) {
      this.setStatus(e instanceof Error ? e.message : String(e), false);
    }
  }

  async startRecord(kind: HotkeyKind): Promise<void> {
    this.setData({ recording: kind, statusText: '', statusOk: false });
    await getTrayApi()?.suspendHotkeys?.();
  }

  clearHotkey(kind: HotkeyKind): void {
    this.setPending(kind, '');
  }

  private async handleKeyDown(e: KeyboardEvent): Promise<void> {
    if (!this.data.recording) return;
    e.preventDefault();
    if (e.key === 'Escape') {
      this.setData({ recording: null });
      await getTrayApi()?.resumeHotkeys?.();
      return;
    }
    const accel = keyToAccel(e);
    if (!accel) return;
    this.setPending(this.data.recording, accel);
    this.setData({ recording: null });
    await getTrayApi()?.resumeHotkeys?.();
  }

  private async persistSettings(kind: string): Promise<boolean> {
    const api = await ensureTrayApi();
    if (!api?.setSettings) {
      this.setStatus('无法' + kind + '：托盘 API 不可用', false);
      return false;
    }
    const res = await api.setSettings(this.readFormPatch());
    if (res.hotkeyError) {
      this.setStatus(res.hotkeyError, false);
      this.setData({
        pendingShot: res.settings.screenshotHotkey,
        pendingAct: res.settings.activateHotkey,
        pendingEditor: res.settings.editorHotkey,
        pendingZones: res.settings.zonesHotkey || '',
        pendingSettings: res.settings.settingsHotkey || '',
        pendingHistory: res.settings.historyHotkey || '',
      });
      return false;
    }
    this.applySettings(res.settings);
    return true;
  }

  async apply(): Promise<void> {
    this.setData({ busy: true, applyLabel: '应用中…' });
    this.dlog('apply.click');
    try {
      const ok = await this.persistSettings('应用');
      if (ok) {
        this.setStatus('已应用', true);
        this.dlog('apply.ok');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.setStatus('应用失败：' + msg, false);
      this.dlog('apply.error', { message: msg });
    } finally {
      this.setData({ busy: false, applyLabel: '应用' });
    }
  }

  async save(): Promise<void> {
    this.setData({ busy: true, saveLabel: '保存中…' });
    this.dlog('save.click');
    try {
      const api = await ensureTrayApi();
      const ok = await this.persistSettings('保存');
      if (!ok) return;
      this.dlog('save.ok');
      await api?.closeWindow();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.setStatus('保存失败：' + msg, false);
      this.dlog('save.error', { message: msg });
    } finally {
      this.setData({ busy: false, saveLabel: '保存' });
    }
  }

  async close(): Promise<void> {
    this.dlog('close.click');
    const api = await ensureTrayApi(800);
    if (api?.closeWindow) {
      await api.closeWindow();
      return;
    }
    this.setStatus('无法关闭：托盘 API 不可用', false);
  }

  async openDiag(): Promise<void> {
    this.dlog('diag.click');
    const api = await ensureTrayApi(800);
    if (!api?.openDiagLog) {
      this.setStatus('无法打开日志：托盘 API 不可用', false);
      return;
    }
    try {
      const result = await api.openDiagLog();
      this.setStatus(result ? '已打开诊断日志' : '诊断日志文件尚未生成', !!result);
    } catch (e) {
      this.setStatus(
        '打开日志失败：' + (e instanceof Error ? e.message : String(e)),
        false,
      );
    }
  }

  mount(): void {
    void this.refreshMaximized();
    this.offMax?.();
    this.offMax = this.bindMaximizedEvents();

    window.__applyTraySettings = (s) => {
      if (!this.data.recording) this.applySettings(s);
    };
    window.__applyTrayProfile = (p) => this.applyProfile(p);
    window.addEventListener('keydown', this.onKeyDown);

    this.applyThemeUi('dark');
    this.applyLayoutUi('grid');

    const tryBoot = (): boolean => {
      const api = getTrayApi();
      this.dlog('boot', {
        hasApi: !!api,
        hasGetSettings: typeof api?.getSettings === 'function',
        hydrated: this.hydrated,
      });
      if (!api?.getSettings) {
        if (this.hydrated) {
          this.dlog('boot.inject-only');
          return true;
        }
        return false;
      }
      if (!this.unsubSettings) {
        this.unsubSettings = api.onSettings?.((s) => {
          if (!this.data.recording) this.applySettings(s);
        }) ?? null;
      }
      void this.load();
      return true;
    };

    if (!tryBoot()) {
      let tries = 0;
      const timer = setInterval(() => {
        tries += 1;
        if (tryBoot()) {
          clearInterval(timer);
        } else if (tries >= 40) {
          clearInterval(timer);
          if (!this.hydrated) {
            this.setStatus('无法连接托盘 API，请关闭后从托盘重新打开设置', false);
          }
          this.dlog('boot.timeout', { tries, hydrated: this.hydrated });
        }
      }, 50);
    }
  }

  unmount(): void {
    this.offMax?.();
    this.offMax = null;
    window.removeEventListener('keydown', this.onKeyDown);
    this.unsubSettings?.();
    this.unsubSettings = null;
    delete window.__applyTraySettings;
    delete window.__applyTrayProfile;
  }
}
