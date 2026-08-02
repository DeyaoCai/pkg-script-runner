/**
 * Legacy file:// UI (index.vanilla.html). Production uses @pkg-runner/web → dist-ui.
 * Kept as fallback; prefer Vue TerminalView / AppCtrl for new shell work.
 */
/* global from preload */
const api = window.pkgRunner;

const SEARCH_PREFIX = 'pkg-runner:search:';
const PROJECT_SEARCH_KEY = 'pkg-runner:project-search';
const SCRIPTS_WIDTH_KEY = 'pkg-runner:scripts-w';
const GLASS_BLUR_KEY = 'pkg-runner:glass-blur';
const DEFAULT_GLASS_ALPHA_PCT = 100;
const DEFAULT_GLASS_BLUR_PX = 22;
const MIN_GLASS_BLUR_PX = 0;
const MAX_GLASS_BLUR_PX = 40;
const DEFAULT_SCREENSHOT_HOTKEY = '';
const DEFAULT_ACTIVATE_HOTKEY = '';
const DEFAULT_SCREENSHOT_HISTORY_LIMIT = 10;
const MIN_SCREENSHOT_HISTORY_LIMIT = 1;
const MAX_SCREENSHOT_HISTORY_LIMIT = 100;
const DEFAULT_SHELL_MOSAIC_COLS = 2;
const MIN_SHELL_MOSAIC_COLS = 1;
const MAX_SHELL_MOSAIC_COLS = 4;
const DEFAULT_SCRIPTS_WIDTH = 176;
const MIN_SCRIPTS_WIDTH = 120;
const MIN_LOG_WIDTH = 220;
const PROJECTS_WIDTH_KEY = 'pkg-runner:projects-w';
const DEFAULT_PROJECTS_WIDTH = 220;
const MIN_PROJECTS_WIDTH = 108;
const PROJECTS_NARROW_WIDTH = 168;
const MIN_MAIN_WIDTH = 420;

const pathInput = document.getElementById('pathInput');
const addProjectBtn = document.getElementById('addProjectBtn');
const projectSearchInput = document.getElementById('projectSearchInput');
const projectListEl = document.getElementById('projectList');
const bodyPad = document.getElementById('bodyPad');
const projectsPanel = document.getElementById('projectsPanel');
const projectsResizer = document.getElementById('projectsResizer');
const searchInput = document.getElementById('searchInput');
const scriptsLabel = document.getElementById('scriptsLabel');
const scriptsEl = document.getElementById('scripts');
const mainSplit = document.getElementById('mainSplit');
const scriptsResizer = document.getElementById('scriptsResizer');
const logTabsEl = document.getElementById('logTabs');
const logTabsPrevBtn = document.getElementById('logTabsPrevBtn');
const logTabsNextBtn = document.getElementById('logTabsNextBtn');
const shellAddBtn = document.getElementById('shellAddBtn');
const shellLayoutBtn = document.getElementById('shellLayoutBtn');
const shellBar = document.getElementById('shellBar');
const shellCwdEl = document.getElementById('shellCwd');
const shellInput = document.getElementById('shellInput');
const logViewsEl = document.getElementById('logViews');
const clearLogBtn = document.getElementById('clearLogBtn');
const persistLogBtn = document.getElementById('persistLogBtn');
const openLogsDirBtn = document.getElementById('openLogsDirBtn');
const clearDiskLogsBtn = document.getElementById('clearDiskLogsBtn');
const logPanelLabel = document.getElementById('logPanelLabel');
const metaEl = document.getElementById('meta');
const settingsBtn = document.getElementById('settingsBtn');
const themeBtn = document.getElementById('themeBtn');
const themePanel = document.getElementById('themePanel');
const themePanelCloseBtn = document.getElementById('themePanelCloseBtn');
const settingsModal = document.getElementById('settingsModal');
const settingsCloseBtn = document.getElementById('settingsCloseBtn');
const screenshotHotkeyBtn = document.getElementById('screenshotHotkeyBtn');
const screenshotHotkeyClearBtn = document.getElementById('screenshotHotkeyClearBtn');
const screenshotHotkeyHint = document.getElementById('screenshotHotkeyHint');
const activateHotkeyBtn = document.getElementById('activateHotkeyBtn');
const activateHotkeyClearBtn = document.getElementById('activateHotkeyClearBtn');
const activateHotkeyHint = document.getElementById('activateHotkeyHint');
const ssHistoryLimitInput = document.getElementById('ssHistoryLimitInput');
const ssHistoryLimitHint = document.getElementById('ssHistoryLimitHint');
const ssHistoryBtn = document.getElementById('ssHistoryBtn');
const ssHistoryModal = document.getElementById('ssHistoryModal');
const ssHistoryList = document.getElementById('ssHistoryList');
const ssHistoryCloseBtn = document.getElementById('ssHistoryCloseBtn');
const ssHistoryClearBtn = document.getElementById('ssHistoryClearBtn');
const ssHistoryDirBtn = document.getElementById('ssHistoryDirBtn');
const ssHistorySelectAll = document.getElementById('ssHistorySelectAll');
const ssHistoryExportBtns = document.querySelectorAll('[data-ss-export]');
const ssCaptureBtn = document.getElementById('ssCaptureBtn');
const logPanel = document.getElementById('logPanel');
const minBtn = document.getElementById('minBtn');
const maxBtn = document.getElementById('maxBtn');
const maxIcon = document.getElementById('maxIcon');
const closeBtn = document.getElementById('closeBtn');
const fontPicker = document.getElementById('fontPicker');
const fontPickerBtn = document.getElementById('fontPickerBtn');
const fontPickerLabel = document.getElementById('fontPickerLabel');
const fontPickerMenu = document.getElementById('fontPickerMenu');
const glassAlphaRange = document.getElementById('glassAlphaRange');
const glassAlphaLabel = document.getElementById('glassAlphaLabel');
const glassBlurRange = document.getElementById('glassBlurRange');
const glassBlurLabel = document.getElementById('glassBlurLabel');
const shellColsRange = document.getElementById('shellColsRange');
const shellColsLabel = document.getElementById('shellColsLabel');
const alwaysOnTopCheck = document.getElementById('alwaysOnTopCheck');
const titlebarEl = document.querySelector('.titlebar');
const scriptPopover = document.getElementById('scriptPopover');
const scriptPopoverName = document.getElementById('scriptPopoverName');
const scriptPopoverCmd = document.getElementById('scriptPopoverCmd');
const scriptPopoverHint = document.getElementById('scriptPopoverHint');
const confirmModal = document.getElementById('confirmModal');
const confirmTitle = document.getElementById('confirmTitle');
const confirmMessage = document.getElementById('confirmMessage');
const confirmOkBtn = document.getElementById('confirmOkBtn');
const confirmCancelBtn = document.getElementById('confirmCancelBtn');

const SYSTEM_LOG_ID = '__system__';
/** @type {Map<string, { term: import('@xterm/xterm').Terminal, fit: { fit: () => void }, ro: ResizeObserver | null, host: HTMLElement | null }>} */
const shellTerms = new Map();
/** @type {Map<string, string>} data arrived before xterm attached */
const shellPendingData = new Map();

function getXtermCtor() {
  return typeof Terminal !== 'undefined' ? Terminal : window.Terminal;
}
function getFitAddonCtor() {
  const mod = typeof FitAddon !== 'undefined' ? FitAddon : window.FitAddon;
  return mod?.FitAddon || mod;
}

/** @type {{ dir: string, name: string, packageManager: string, scripts: Array<{name:string,command:string}> } | null} */
let project = null;
/** @type {{ projects: Array<{dir:string,name:string,scriptCount:number}>, activeProject: string | null }} */
let projectsState = { projects: [], activeProject: null };
/** @type {Array<{ id: string, dir: string, scriptName: string }>} */
let jobs = [];
/** @type {Map<string, { id: string, title: string, dir: string | null, text: string, running: boolean, code: number | null | undefined, html: string | null, htmlLen: number, truncated: boolean }>} */
const logSessions = new Map();
let activeLogId = SYSTEM_LOG_ID;
let persistLogs = false;
let maximized = false;
/** @type {{ fontId: string, glassAlpha: number, theme: 'dark' | 'light', shellMosaicCols: number, shellLayout: 'grid' | 'single', alwaysOnTop: boolean, screenshotHotkey: string, activateHotkey: string, screenshotHistoryLimit: number }} */
let appSettings = {
  fontId: 'jetbrains',
  glassAlpha: DEFAULT_GLASS_ALPHA_PCT,
  theme: 'dark',
  shellMosaicCols: DEFAULT_SHELL_MOSAIC_COLS,
  shellLayout: 'grid',
  alwaysOnTop: false,
  screenshotHotkey: DEFAULT_SCREENSHOT_HOTKEY,
  activateHotkey: DEFAULT_ACTIVATE_HOTKEY,
  screenshotHistoryLimit: DEFAULT_SCREENSHOT_HISTORY_LIMIT,
};
/** @type {null | 'screenshot' | 'activate'} */
let recordingHotkeyKind = null;
/** @type {ReturnType<typeof setTimeout> | null} */
/** @type {ResizeObserver | null} */
/** @type {ReturnType<typeof setTimeout> | null} */
let saveSettingsTimer = null;
let saveTimer = null;
let popoverHideTimer = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let logPaintTimer = null;
let logStructureDirty = false;
const LOG_PAINT_DEBOUNCE_MS = 48;
/** 单路输出最大字符数，超出从头部丢弃（防内存涨死） */
const LOG_MAX_CHARS = 400_000;

function isShellSessionId(id) {
  return typeof id === 'string' && id.startsWith('shell::');
}

function isJobSessionId(id) {
  return typeof id === 'string' && id !== SYSTEM_LOG_ID && !isShellSessionId(id);
}

/** 脚本或 Shell（非「系统」）用面板展示 */
function isMosaicPaneKind(id) {
  return isJobSessionId(id) || isShellSessionId(id);
}

/** 当前项目下可进网格的会话（脚本 + Shell，不含系统） */
function visibleMosaicIds() {
  return visibleLogIds().filter((id) => isMosaicPaneKind(id));
}

/** 当前是否处于面板模式（单个或网格） */
function isPaneMode() {
  return isMosaicPaneKind(activeLogId);
}

/** 网格：脚本与 Shell 混搭并排 */
function isMosaicMode() {
  return isPaneMode() && appSettings.shellLayout === 'grid';
}

/** 网格/单个下要渲染的面板 id 列表 */
function mosaicPaneIds() {
  if (!isPaneMode()) return [];
  return isMosaicMode() ? visibleMosaicIds() : [activeLogId];
}

function ensureSystemSession() {
  if (!logSessions.has(SYSTEM_LOG_ID)) {
    logSessions.set(SYSTEM_LOG_ID, {
      id: SYSTEM_LOG_ID,
      title: '系统',
      dir: null,
      text: '',
      running: false,
      code: undefined,
      html: null,
      htmlLen: -1,
      truncated: false,
    });
  }
}

function ensureJobSession(id, scriptName, dir) {
  let s = logSessions.get(id);
  if (!s) {
    s = {
      id,
      title: scriptName,
      dir: dir || null,
      text: '',
      running: true,
      code: undefined,
      html: null,
      htmlLen: -1,
      truncated: false,
    };
    logSessions.set(id, s);
    logStructureDirty = true;
  } else {
    s.title = scriptName;
    if (dir) s.dir = dir;
  }
  return s;
}

function sessionVisibleForActiveProject(s) {
  if (!s) return false;
  if (s.id === SYSTEM_LOG_ID) return true;
  const active = projectsState.activeProject;
  if (!active) return true;
  if (!s.dir) {
    // 兼容旧会话：从 job id / jobs 里猜目录
    const job = jobs.find((j) => j.id === s.id);
    if (job) return sameDir(job.dir, active);
    return false;
  }
  return sameDir(s.dir, active);
}

function visibleLogIds() {
  ensureSystemSession();
  const ids = [SYSTEM_LOG_ID];
  for (const id of logSessions.keys()) {
    if (id === SYSTEM_LOG_ID) continue;
    const s = logSessions.get(id);
    if (sessionVisibleForActiveProject(s)) ids.push(id);
  }
  return ids;
}

function ensureActiveLogVisible() {
  if (sessionVisibleForActiveProject(logSessions.get(activeLogId))) return;
  const ids = visibleLogIds();
  // 优先仍在跑的；否则落到该项目最近一个脚本/Shell，避免停在空白「系统」
  const running = ids.find((id) => id !== SYSTEM_LOG_ID && logSessions.get(id)?.running);
  if (running) {
    activeLogId = running;
    return;
  }
  const peers = ids.filter((id) => id !== SYSTEM_LOG_ID);
  activeLogId = peers.length ? peers[peers.length - 1] : SYSTEM_LOG_ID;
}

/** 切项目后：若停在「系统」且该项目有输出 Tab，自动跳过去 */
function preferProjectOutputTab() {
  const ids = visibleLogIds();
  const peers = ids.filter((id) => id !== SYSTEM_LOG_ID);
  if (!peers.length) {
    activeLogId = SYSTEM_LOG_ID;
    return;
  }
  if (sessionVisibleForActiveProject(logSessions.get(activeLogId)) && activeLogId !== SYSTEM_LOG_ID) {
    return;
  }
  const running = peers.find((id) => logSessions.get(id)?.running);
  activeLogId = running || peers[peers.length - 1];
}

function invalidateSessionHtml(s) {
  s.html = null;
  s.htmlLen = -1;
}

function trimSessionText(s) {
  if (s.text.length <= LOG_MAX_CHARS) return;
  const keep = Math.floor(LOG_MAX_CHARS * 0.8);
  const cut = s.text.length - keep;
  // 尽量从换行处切开，避免半截 ANSI
  const nl = s.text.indexOf('\n', cut);
  const from = nl >= 0 && nl < cut + 2000 ? nl + 1 : cut;
  s.text = s.text.slice(from);
  s.truncated = true;
  invalidateSessionHtml(s);
}

/** 按需解析：仅在真正要展示时转 ANSI → HTML，并缓存 */
function getSessionHtml(s) {
  if (s.html != null && s.htmlLen === s.text.length) return s.html;
  s.html =
    typeof window.ansiToHtml === 'function' ? window.ansiToHtml(s.text) : escapeHtml(s.text);
  s.htmlLen = s.text.length;
  return s.html;
}

function syncTrimBanner(view, s) {
  const banner = view.querySelector('.log-trim-banner');
  if (!banner) return;
  if (s.truncated) {
    banner.hidden = false;
    banner.textContent = `日志已截断，仅保留最近约 ${Math.round(LOG_MAX_CHARS * 0.8 / 1000)}k 字符`;
  } else {
    banner.hidden = true;
    banner.textContent = '';
  }
}

function bindLogPre(pre, id, title) {
  pre.className = 'log';
  pre.dataset.logId = id;
  pre.tabIndex = 0;
  pre.setAttribute('role', 'textbox');
  pre.setAttribute('aria-readonly', 'true');
  pre.setAttribute('aria-label', `${title} 输出`);
  pre.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      e.stopPropagation();
      selectAllInElement(pre);
    }
  });
  pre.addEventListener('mousedown', () => {
    if (document.activeElement !== pre) pre.focus({ preventScroll: true });
  });
}

function paintLogView(id, forceParse = false) {
  const s = logSessions.get(id);
  if (!s) return;
  const view =
    logViewsEl.querySelector(`.shell-pane[data-log-id="${CSS.escape(id)}"]`) ||
    logViewsEl.querySelector(`.log-view[data-log-id="${CSS.escape(id)}"]`);
  if (!view) return;
  if (view.classList.contains('log-view') && view.hidden) return;

  if (isShellSessionId(id)) {
    view.classList.toggle('is-running', !!s.running);
    const host = view.querySelector('.xterm-host');
    if (host) attachShellTerm(id, host);
    return;
  }

  const pre = view.querySelector('pre.log');
  if (!pre) return;
  const nearBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 48;
  if (forceParse) invalidateSessionHtml(s);
  syncTrimBanner(view, s);
  pre.innerHTML = getSessionHtml(s);
  if (nearBottom) pre.scrollTop = pre.scrollHeight;
  view.classList.toggle('is-running', !!s.running);
}

function paintActiveLog(forceParse = false) {
  if (isMosaicMode()) {
    for (const id of mosaicPaneIds()) paintLogView(id, forceParse);
    return;
  }
  paintLogView(activeLogId, forceParse);
}

function updatePaneChrome(id) {
  const s = logSessions.get(id);
  const pane = logViewsEl.querySelector(`.shell-pane[data-log-id="${CSS.escape(id)}"]`);
  if (!s || !pane) return;
  pane.classList.toggle('is-active', id === activeLogId);
  pane.classList.toggle('is-running', !!s.running);
  const title = pane.querySelector('.shell-pane-title');
  if (title) title.textContent = s.title;
  const actions = pane.querySelector('.shell-pane-actions');
  if (actions) syncPaneActions(actions, id, s);
}

function syncPaneActions(actionsEl, id, s) {
  actionsEl.replaceChildren();
  const shell = isShellSessionId(id);

  if (!shell) {
    const restart = document.createElement('button');
    restart.type = 'button';
    restart.className = 'shell-pane-btn';
    restart.title = '重新运行';
    restart.textContent = '↻';
    restart.addEventListener('click', async (e) => {
      e.stopPropagation();
      await restartLogJob(id);
    });
    actionsEl.appendChild(restart);
  }

  if (shell && s.running) {
    const claude = document.createElement('button');
    claude.type = 'button';
    claude.className = 'shell-pane-btn';
    claude.title = '运行 claude';
    claude.textContent = '✦';
    claude.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof api.shellWrite === 'function') void api.shellWrite(id, 'claude\r');
      focusShellTerm(id);
    });
    actionsEl.appendChild(claude);
  }

  if (s.running) {
    const stop = document.createElement('button');
    stop.type = 'button';
    stop.className = 'shell-pane-btn';
    stop.title = shell ? '强制结束终端' : '停止此脚本';
    stop.textContent = '■';
    stop.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await api.stop(id);
      } catch (err) {
        appendLog(`\n[错误] ${err instanceof Error ? err.message : String(err)}\n`);
      }
    });
    actionsEl.appendChild(stop);
    return;
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'shell-pane-btn';
  close.title = shell ? '关闭 Shell' : '关闭此输出';
  close.textContent = '×';
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    void closeLogSession(id);
  });
  actionsEl.appendChild(close);
}

function disposeShellTerm(id) {
  const entry = shellTerms.get(id);
  if (!entry) {
    shellPendingData.delete(id);
    return;
  }
  try {
    entry.ro?.disconnect();
  } catch {
    /* ignore */
  }
  try {
    entry.term.dispose();
  } catch {
    /* ignore */
  }
  shellTerms.delete(id);
  shellPendingData.delete(id);
}

function fitAndResizeShell(id) {
  const entry = shellTerms.get(id);
  if (!entry) return;
  try {
    entry.fit.fit();
  } catch {
    /* ignore */
  }
  const cols = entry.term.cols;
  const rows = entry.term.rows;
  if (typeof api.shellResize === 'function') void api.shellResize(id, cols, rows);
}

function focusShellTerm(id) {
  const entry = shellTerms.get(id);
  if (!entry) return;
  try {
    entry.term.focus();
  } catch {
    /* ignore */
  }
}

function attachShellTerm(id, host) {
  const Term = getXtermCtor();
  const Fit = getFitAddonCtor();
  if (!Term || !Fit) {
    host.textContent = 'xterm 未加载';
    return null;
  }

  let entry = shellTerms.get(id);
  if (entry) {
    if (entry.term.element?.parentElement !== host) {
      try {
        entry.ro?.disconnect();
      } catch {
        /* ignore */
      }
      host.replaceChildren();
      if (entry.term.element) host.appendChild(entry.term.element);
      else entry.term.open(host);
      entry.ro = new ResizeObserver(() => {
        fitAndResizeShell(id);
      });
      entry.ro.observe(host);
    }
    entry.host = host;
    requestAnimationFrame(() => {
      fitAndResizeShell(id);
      if (id === activeLogId) focusShellTerm(id);
    });
    return entry;
  }

  host.replaceChildren();
  const term = new Term({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono').trim() ||
      'JetBrains Mono, Consolas, monospace',
    theme: window.PkgTokens ? window.PkgTokens.termTheme() : {
      background: '#0d1117',
      foreground: '#e6edf3',
      cursor: '#58a6ff',
      selectionBackground: '#264f78',
    },
    allowProposedApi: true,
    scrollback: 5000,
  });
  const fit = new Fit();
  term.loadAddon(fit);
  term.open(host);
  term.onData((data) => {
    if (typeof api.shellWrite === 'function') void api.shellWrite(id, data);
  });
  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type !== 'keydown') return true;
    if (activeLogId !== id) {
      activeLogId = id;
      logTabsEl.querySelectorAll('.log-tab').forEach((t) => {
        t.classList.toggle('active', t.dataset.logId === id);
      });
      logViewsEl.querySelectorAll('.shell-pane').forEach((p) => {
        p.classList.toggle('is-active', p.dataset.logId === id);
      });
      syncLogTabNav();
    }
    const key = ev.key.toLowerCase();
    const mod = ev.ctrlKey || ev.metaKey;
    const copySel = () => {
      const text = term.getSelection() || '';
      if (!text) return false;
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(text);
      } else {
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.cssText = 'position:fixed;left:-9999px;top:0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        } catch {
          /* ignore */
        }
      }
      return true;
    };
    const pasteClip = () => {
      if (!navigator.clipboard?.readText) return;
      void navigator.clipboard.readText().then((text) => {
        if (text && typeof api.shellWrite === 'function') void api.shellWrite(id, text);
      });
    };
    // 有选区时 Ctrl/Cmd+C 复制，避免直接把 ^C 打进 PTY
    if (key === 'c' && mod && !ev.altKey && (ev.shiftKey || term.hasSelection())) {
      copySel();
      return false;
    }
    if (key === 'insert' && mod && !ev.shiftKey && !ev.altKey && term.hasSelection()) {
      copySel();
      return false;
    }
    if (key === 'v' && mod && !ev.altKey) {
      pasteClip();
      return false;
    }
    if (key === 'insert' && ev.shiftKey && !mod && !ev.altKey) {
      pasteClip();
      return false;
    }
    return true;
  });
  host.addEventListener('copy', (ev) => {
    if (!term.hasSelection()) return;
    const text = term.getSelection();
    if (!text) return;
    ev.preventDefault();
    ev.clipboardData?.setData('text/plain', text);
  });

  const ro = new ResizeObserver(() => {
    fitAndResizeShell(id);
  });
  ro.observe(host);

  entry = { term, fit, ro, host };
  shellTerms.set(id, entry);
  const pending = shellPendingData.get(id);
  if (pending) {
    shellPendingData.delete(id);
    try {
      term.write(pending);
    } catch {
      /* ignore */
    }
  }
  requestAnimationFrame(() => {
    fitAndResizeShell(id);
    if (id === activeLogId) focusShellTerm(id);
  });
  return entry;
}

function createMosaicPane(id, s, scrollTop) {
  const shell = isShellSessionId(id);
  const pane = document.createElement('div');
  pane.className = 'shell-pane';
  if (!shell) pane.classList.add('is-job-pane');
  pane.dataset.logId = id;
  if (id === activeLogId) pane.classList.add('is-active');
  if (s.running) pane.classList.add('is-running');

  const head = document.createElement('div');
  head.className = 'shell-pane-head';
  const title = document.createElement('span');
  title.className = 'shell-pane-title';
  title.textContent = s.title;
  const actions = document.createElement('div');
  actions.className = 'shell-pane-actions';
  syncPaneActions(actions, id, s);
  head.append(title, actions);
  head.addEventListener('click', () => {
    activateLogTab(id);
  });
  pane.appendChild(head);

  if (shell) {
    const host = document.createElement('div');
    host.className = 'xterm-host';
    pane.appendChild(host);
    requestAnimationFrame(() => attachShellTerm(id, host));
  } else {
    const banner = document.createElement('div');
    banner.className = 'log-trim-banner';
    banner.hidden = true;
    pane.appendChild(banner);

    const pre = document.createElement('pre');
    bindLogPre(pre, id, s.title);
    syncTrimBanner(pane, s);
    pre.innerHTML = getSessionHtml(s);
    pane.appendChild(pre);

    requestAnimationFrame(() => {
      if (typeof scrollTop === 'number') pre.scrollTop = scrollTop;
      else pre.scrollTop = pre.scrollHeight;
    });
  }

  return pane;
}

function updateLogTabChrome(id) {
  const s = logSessions.get(id);
  const tab = logTabsEl.querySelector(`.log-tab[data-log-id="${CSS.escape(id)}"]`);
  if (!s || !tab) return;
  tab.classList.toggle('running', s.running);
  const label = tab.querySelector('.log-tab-label');
  if (label) label.textContent = s.title;
  syncLogTabAction(tab, id, s);
  if (isMosaicPaneKind(id)) updatePaneChrome(id);
}

function syncLogTabAction(tab, id, s) {
  tab.querySelector('.log-tab-restart')?.remove();
  tab.querySelector('.log-tab-stop')?.remove();
  tab.querySelector('.log-tab-close')?.remove();
  if (id === SYSTEM_LOG_ID) return;

  const shell = isShellSessionId(id);

  if (!shell) {
    const restart = document.createElement('span');
    restart.className = 'log-tab-restart';
    restart.title = '重新运行';
    restart.setAttribute('aria-label', '重启');
    restart.textContent = '↻';
    restart.addEventListener('click', async (e) => {
      e.stopPropagation();
      await restartLogJob(id);
    });
    tab.appendChild(restart);
  }

  if (s.running) {
    const stop = document.createElement('span');
    stop.className = 'log-tab-stop';
    stop.title = shell ? '强制结束终端' : '停止此脚本';
    stop.setAttribute('aria-label', '停止');
    stop.textContent = '■';
    stop.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await api.stop(id);
      } catch (err) {
        appendLog(`\n[错误] ${err instanceof Error ? err.message : String(err)}\n`);
      }
    });
    tab.appendChild(stop);
    return;
  }

  const close = document.createElement('span');
  close.className = 'log-tab-close';
  close.title = shell ? '关闭 Shell' : '关闭此输出';
  close.textContent = '×';
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    void closeLogSession(id);
  });
  tab.appendChild(close);
}

async function closeLogSession(id) {
  if (id === SYSTEM_LOG_ID) return;
  const s = logSessions.get(id);
  if (s?.running) {
    try {
      await api.stop(id);
    } catch {
      /* ignore */
    }
  }
  if (isShellSessionId(id) && typeof api.shellClose === 'function') {
    try {
      await api.shellClose(id);
    } catch {
      /* ignore */
    }
    disposeShellTerm(id);
  }
  logSessions.delete(id);
  disposeShellTerm(id);
  if (activeLogId === id) {
    const left = visibleMosaicIds();
    activeLogId = left[0] || SYSTEM_LOG_ID;
  }
  scheduleLogPaint({ structural: true, immediate: true });
  syncShellBar();
}

async function restartLogJob(id) {
  const s = logSessions.get(id);
  if (!s || id === SYSTEM_LOG_ID || isShellSessionId(id)) return;
  const dir = s.dir;
  const scriptName = s.title;
  if (!dir || !scriptName) {
    appendLog('\n[错误] 无法重启：缺少目录或脚本名\n');
    return;
  }
  try {
    if (s.running) await api.stop(id);
    s.text = '';
    s.truncated = false;
    s.code = null;
    invalidateSessionHtml(s);
    const newId = await api.runScript(dir, scriptName);
    activeLogId = newId;
    scheduleLogPaint({ structural: true, immediate: true, focus: newId });
  } catch (err) {
    appendLog(`\n[错误] ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

function renderLogUi() {
  ensureSystemSession();
  ensureActiveLogVisible();
  logStructureDirty = false;
  let order = visibleLogIds();
  // 防御：active 不在可见列表时全部 log-view 会被 hidden，看起来像空白
  if (!order.includes(activeLogId)) {
    const peers = order.filter((id) => id !== SYSTEM_LOG_ID);
    activeLogId = peers.length ? peers[peers.length - 1] : SYSTEM_LOG_ID;
    order = visibleLogIds();
  }

  const paneMode = isPaneMode();
  const mosaic = isMosaicMode();
  let paneIds = mosaicPaneIds().filter((id) => logSessions.has(id));
  // 面板模式下若无任何面板可画，回退系统经典视图
  const usePanes = paneMode && paneIds.length > 0;
  if (paneMode && !usePanes) {
    activeLogId = SYSTEM_LOG_ID;
    order = visibleLogIds();
  }

  if (logPanelLabel) {
    const jobTabs = order.length - 1;
    const name = project?.name;
    logPanelLabel.textContent = name
      ? `输出 · ${name}${jobTabs > 0 ? `（${jobTabs}）` : ''}`
      : '输出';
  }

  /** @type {Map<string, number>} */
  const prevScrolls = new Map();
  logViewsEl.querySelectorAll('pre.log[data-log-id]').forEach((pre) => {
    const id = pre.getAttribute('data-log-id');
    if (id) prevScrolls.set(id, pre.scrollTop);
  });

  logTabsEl.innerHTML = '';
  logViewsEl.innerHTML = '';
  logViewsEl.classList.toggle('is-shell-mosaic', usePanes && mosaic);
  logViewsEl.classList.toggle('is-shell-single', usePanes && !mosaic);

  for (const id of order) {
    const s = logSessions.get(id);
    if (!s) continue;

    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'log-tab';
    tab.setAttribute('role', 'tab');
    tab.dataset.logId = id;
    if (id === activeLogId) tab.classList.add('active');
    if (s.running) tab.classList.add('running');

    const label = document.createElement('span');
    label.className = 'log-tab-label';
    label.textContent = s.title;
    tab.appendChild(label);
    syncLogTabAction(tab, id, s);

    tab.addEventListener('click', () => {
      activateLogTab(id);
    });
    logTabsEl.appendChild(tab);
  }

  if (usePanes) {
    for (const id of paneIds) {
      const s = logSessions.get(id);
      if (!s) continue;
      logViewsEl.appendChild(createMosaicPane(id, s, prevScrolls.get(id)));
    }
  } else {
    for (const id of order) {
      const s = logSessions.get(id);
      if (!s) continue;

      const view = document.createElement('div');
      view.className = 'log-view';
      view.dataset.logId = id;
      view.hidden = id !== activeLogId;

      const banner = document.createElement('div');
      banner.className = 'log-trim-banner';
      banner.hidden = true;
      view.appendChild(banner);

      const pre = document.createElement('pre');
      bindLogPre(pre, id, s.title);
      if (id === activeLogId) {
        syncTrimBanner(view, s);
        pre.innerHTML = getSessionHtml(s);
        requestAnimationFrame(() => {
          const prev = prevScrolls.get(id);
          if (typeof prev === 'number') pre.scrollTop = prev;
          else pre.scrollTop = pre.scrollHeight;
        });
      } else {
        pre.textContent = '';
      }
      view.appendChild(pre);
      logViewsEl.appendChild(view);
    }
  }

  requestAnimationFrame(() => {
    const activeTab = logTabsEl.querySelector('.log-tab.active');
    activeTab?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    syncLogTabNav();
    syncShellBar();
    syncShellLayoutSettingsUi();
    if (usePanes && isShellSessionId(activeLogId)) {
      focusShellTerm(activeLogId);
    } else if (usePanes) {
      const pre = logViewsEl.querySelector(
        `.shell-pane[data-log-id="${CSS.escape(activeLogId)}"] pre.log`,
      );
      pre?.focus({ preventScroll: true });
    }
  });
}

function activateLogTab(id) {
  if (!logSessions.has(id)) return;
  const wasPane = isPaneMode();
  const willPane = isMosaicPaneKind(id);
  const wasMosaic = isMosaicMode();
  const prevId = activeLogId;

  if (activeLogId === id && wasPane === willPane) {
    paintActiveLog();
    if (willPane && isShellSessionId(id)) {
      focusShellTerm(id);
    } else if (willPane) {
      const pre = logViewsEl.querySelector(
        `.shell-pane[data-log-id="${CSS.escape(id)}"] pre.log`,
      );
      pre?.focus({ preventScroll: true });
    } else {
      const activePre = logViewsEl.querySelector(
        `.log-view[data-log-id="${CSS.escape(id)}"] pre.log`,
      );
      activePre?.focus({ preventScroll: true });
    }
    syncLogTabNav();
    return;
  }

  activeLogId = id;
  const willMosaic = isMosaicMode();
  const willShell = isShellSessionId(id);

  // 系统↔面板、网格↔单个、单个下换会话：重建
  const needRebuild =
    wasPane !== willPane ||
    wasMosaic !== willMosaic ||
    (willPane && !willMosaic && prevId !== id);

  if (needRebuild) {
    scheduleLogPaint({ structural: true, immediate: true, focus: id });
    return;
  }

  if (willMosaic) {
    logTabsEl.querySelectorAll('.log-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.logId === id);
    });
    logViewsEl.querySelectorAll('.shell-pane').forEach((p) => {
      p.classList.toggle('is-active', p.dataset.logId === id);
    });
    paintActiveLog();
    const tab = logTabsEl.querySelector(`.log-tab[data-log-id="${CSS.escape(id)}"]`);
    tab?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    if (willShell) {
      focusShellTerm(id);
    } else {
      const pre = logViewsEl.querySelector(
        `.shell-pane[data-log-id="${CSS.escape(id)}"] pre.log`,
      );
      pre?.focus({ preventScroll: true });
    }
    syncLogTabNav();
    syncShellBar();
    return;
  }

  logTabsEl.querySelectorAll('.log-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.logId === id);
  });
  logViewsEl.querySelectorAll('.log-view').forEach((v) => {
    v.hidden = v.dataset.logId !== id;
  });
  paintActiveLog();
  const tab = logTabsEl.querySelector(`.log-tab[data-log-id="${CSS.escape(id)}"]`);
  tab?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  const activePre = logViewsEl.querySelector(
    `.log-view[data-log-id="${CSS.escape(id)}"] pre.log`,
  );
  activePre?.focus({ preventScroll: true });
  syncLogTabNav();
  syncShellBar();
}

function syncShellBar() {
  // 输入统一在各 Shell 面板内；全局底栏始终隐藏
  if (shellBar) shellBar.hidden = true;
}

async function openShellTab() {
  const dir = projectsState.activeProject || project?.dir;
  if (!dir) {
    appendLog('\n[错误] 请先选择项目，再打开 Shell\n');
    return;
  }
  if (typeof api.shellOpen !== 'function') {
    appendLog('\n[错误] 当前版本不支持 Shell\n');
    return;
  }
  try {
    const res = await api.shellOpen(dir);
    ensureJobSession(res.id, res.title, res.dir);
    const sess = logSessions.get(res.id);
    if (sess) {
      sess.running = true;
      sess.title = res.title;
      sess.dir = res.dir;
    }
    activeLogId = res.id;
    scheduleLogPaint({ structural: true, immediate: true, focus: res.id });
  } catch (err) {
    appendLog(`\n[错误] ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

function syncLogTabNav() {
  if (!logTabsPrevBtn || !logTabsNextBtn) return;
  const order = visibleLogIds();
  const i = order.indexOf(activeLogId);
  const multi = order.length > 1;
  logTabsPrevBtn.hidden = !multi;
  logTabsNextBtn.hidden = !multi;
  if (!multi) return;
  logTabsPrevBtn.disabled = i <= 0;
  logTabsNextBtn.disabled = i < 0 || i >= order.length - 1;
}

function shiftActiveLog(dir) {
  const order = visibleLogIds();
  const i = order.indexOf(activeLogId);
  const next = order[i + dir];
  if (!next) return;
  activateLogTab(next);
}

function flushLogPaint() {
  logPaintTimer = null;
  if (logStructureDirty) {
    renderLogUi();
    return;
  }
  paintActiveLog();
}

/** 输出渲染防抖：高频日志合并刷新；结构变化（新 Tab）立即重建 */
function scheduleLogPaint(opts = {}) {
  if (typeof opts.focus === 'string') activeLogId = opts.focus;
  if (opts.structural) logStructureDirty = true;
  if (opts.immediate || logStructureDirty) {
    if (logPaintTimer) {
      clearTimeout(logPaintTimer);
      logPaintTimer = null;
    }
    flushLogPaint();
    return;
  }
  if (logPaintTimer) return;
  logPaintTimer = setTimeout(flushLogPaint, LOG_PAINT_DEBOUNCE_MS);
}

function setLogHtml(pre, text) {
  pre.innerHTML = typeof window.ansiToHtml === 'function' ? window.ansiToHtml(text) : escapeHtml(text);
}

function selectAllInElement(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function appendToSession(id, chunk, meta = {}) {
  ensureSystemSession();
  let s = logSessions.get(id);
  if (!s) {
    s = {
      id,
      title: meta.title || '输出',
      dir: meta.dir || null,
      text: '',
      running: !!meta.running,
      code: undefined,
      html: null,
      htmlLen: -1,
      truncated: false,
    };
    logSessions.set(id, s);
    logStructureDirty = true;
  }
  if (meta.title) s.title = meta.title;
  if (meta.dir) s.dir = meta.dir;
  if (typeof meta.running === 'boolean') s.running = meta.running;
  if ('code' in meta) s.code = meta.code;
  if (chunk) {
    s.text += chunk;
    trimSessionText(s);
    invalidateSessionHtml(s);
  }

  // 非当前项目的输出只累计文本，切换项目后再渲染 Tab
  if (!sessionVisibleForActiveProject(s)) return;

  updateLogTabChrome(id);

  const needStructure =
    logStructureDirty ||
    !(
      logViewsEl.querySelector(`.log-view[data-log-id="${CSS.escape(id)}"]`) ||
      logViewsEl.querySelector(`.shell-pane[data-log-id="${CSS.escape(id)}"]`)
    );
  scheduleLogPaint({
    focus: meta.focus ? id : undefined,
    structural: needStructure,
    immediate: !!(meta.focus && needStructure),
  });
}

function handleLogPayload(payload) {
  if (payload.kind === 'system') {
    appendToSession(SYSTEM_LOG_ID, payload.chunk, { title: '系统' });
    return;
  }
  const isShell = isShellSessionId(payload.id);
  const prev = logSessions.get(payload.id);
  const isNew = !prev;
  ensureJobSession(payload.id, payload.scriptName, payload.dir);
  const focus =
    isNew &&
    (!projectsState.activeProject || sameDir(payload.dir, projectsState.activeProject));
  appendToSession(payload.id, payload.chunk, {
    title: payload.scriptName,
    dir: payload.dir,
    // Shell：运行态由 PTY 生命周期 / onExit 管理
    running: isShell ? Boolean(prev?.running) : true,
    focus,
  });
}

function syncHScrollNav(scroller, prevBtn, nextBtn) {
  if (!scroller || !prevBtn || !nextBtn) return;
  const max = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
  const overflow = max > 2;
  prevBtn.hidden = !overflow;
  nextBtn.hidden = !overflow;
  if (!overflow) return;
  prevBtn.disabled = scroller.scrollLeft <= 2;
  nextBtn.disabled = scroller.scrollLeft >= max - 2;
}

function scrollHBy(scroller, dir) {
  if (!scroller) return;
  const step = Math.max(120, Math.floor(scroller.clientWidth * 0.75));
  scroller.scrollBy({ left: dir * step, behavior: 'smooth' });
}

function wireHScrollNav(scroller, prevBtn, nextBtn) {
  if (!scroller || !prevBtn || !nextBtn) return;
  const sync = () => syncHScrollNav(scroller, prevBtn, nextBtn);
  prevBtn.addEventListener('click', () => scrollHBy(scroller, -1));
  nextBtn.addEventListener('click', () => scrollHBy(scroller, 1));
  scroller.addEventListener('scroll', sync, { passive: true });
  window.addEventListener('resize', sync);
  sync();
}

logTabsPrevBtn?.addEventListener('click', () => shiftActiveLog(-1));
logTabsNextBtn?.addEventListener('click', () => shiftActiveLog(1));
shellAddBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  void openShellTab();
});
shellLayoutBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  void toggleShellLayout();
});
syncLogTabNav();
syncShellLayoutSettingsUi();

function clampScriptsWidth(px) {
  const splitW = mainSplit?.clientWidth || 800;
  const max = Math.max(MIN_SCRIPTS_WIDTH, splitW - MIN_LOG_WIDTH - 16);
  return Math.round(Math.min(max, Math.max(MIN_SCRIPTS_WIDTH, px)));
}

function applyScriptsWidth(px) {
  if (!mainSplit) return;
  const w = clampScriptsWidth(px);
  mainSplit.style.setProperty('--scripts-w', `${w}px`);
  return w;
}

function loadScriptsWidth() {
  try {
    const raw = localStorage.getItem(SCRIPTS_WIDTH_KEY);
    const n = raw != null ? Number(raw) : DEFAULT_SCRIPTS_WIDTH;
    return Number.isFinite(n) ? n : DEFAULT_SCRIPTS_WIDTH;
  } catch {
    return DEFAULT_SCRIPTS_WIDTH;
  }
}

function saveScriptsWidth(px) {
  try {
    localStorage.setItem(SCRIPTS_WIDTH_KEY, String(px));
  } catch {
    /* ignore */
  }
}

applyScriptsWidth(loadScriptsWidth());

if (scriptsResizer && mainSplit) {
  let dragging = false;
  let startX = 0;
  let startW = 0;

  scriptsResizer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    startX = e.clientX;
    startW =
      parseFloat(getComputedStyle(mainSplit).getPropertyValue('--scripts-w')) ||
      DEFAULT_SCRIPTS_WIDTH;
    scriptsResizer.classList.add('is-dragging');
    document.body.classList.add('is-resizing-scripts');
    try {
      scriptsResizer.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    e.preventDefault();
  });

  scriptsResizer.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    applyScriptsWidth(startW + (e.clientX - startX));
  });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    scriptsResizer.classList.remove('is-dragging');
    document.body.classList.remove('is-resizing-scripts');
    const w =
      parseFloat(getComputedStyle(mainSplit).getPropertyValue('--scripts-w')) ||
      DEFAULT_SCRIPTS_WIDTH;
    saveScriptsWidth(clampScriptsWidth(w));
    try {
      if (e?.pointerId != null) scriptsResizer.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  scriptsResizer.addEventListener('pointerup', endDrag);
  scriptsResizer.addEventListener('pointercancel', endDrag);
  scriptsResizer.addEventListener('dblclick', () => {
    const w = applyScriptsWidth(DEFAULT_SCRIPTS_WIDTH);
    saveScriptsWidth(w);
  });

  window.addEventListener('resize', () => {
    const cur =
      parseFloat(getComputedStyle(mainSplit).getPropertyValue('--scripts-w')) ||
      DEFAULT_SCRIPTS_WIDTH;
    applyScriptsWidth(cur);
    const pw =
      parseFloat(getComputedStyle(bodyPad).getPropertyValue('--projects-w')) ||
      DEFAULT_PROJECTS_WIDTH;
    applyProjectsWidth(pw);
  });
}

function clampProjectsWidth(px) {
  const padW = bodyPad?.clientWidth || 1000;
  const max = Math.max(MIN_PROJECTS_WIDTH, padW - MIN_MAIN_WIDTH - 16);
  return Math.round(Math.min(max, Math.max(MIN_PROJECTS_WIDTH, px)));
}

function applyProjectsWidth(px) {
  if (!bodyPad || !projectsPanel) return;
  const w = clampProjectsWidth(px);
  bodyPad.style.setProperty('--projects-w', `${w}px`);
  projectsPanel.classList.toggle('is-narrow', w < PROJECTS_NARROW_WIDTH);
  return w;
}

function loadProjectsWidth() {
  try {
    const raw = localStorage.getItem(PROJECTS_WIDTH_KEY);
    const n = raw != null ? Number(raw) : DEFAULT_PROJECTS_WIDTH;
    return Number.isFinite(n) ? n : DEFAULT_PROJECTS_WIDTH;
  } catch {
    return DEFAULT_PROJECTS_WIDTH;
  }
}

function saveProjectsWidth(px) {
  try {
    localStorage.setItem(PROJECTS_WIDTH_KEY, String(px));
  } catch {
    /* ignore */
  }
}

applyProjectsWidth(loadProjectsWidth());

if (projectsResizer && bodyPad) {
  let dragging = false;
  let startX = 0;
  let startW = 0;

  projectsResizer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    startX = e.clientX;
    startW =
      parseFloat(getComputedStyle(bodyPad).getPropertyValue('--projects-w')) ||
      DEFAULT_PROJECTS_WIDTH;
    projectsResizer.classList.add('is-dragging');
    document.body.classList.add('is-resizing-projects');
    try {
      projectsResizer.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    e.preventDefault();
  });

  projectsResizer.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    applyProjectsWidth(startW + (e.clientX - startX));
  });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    projectsResizer.classList.remove('is-dragging');
    document.body.classList.remove('is-resizing-projects');
    const w =
      parseFloat(getComputedStyle(bodyPad).getPropertyValue('--projects-w')) ||
      DEFAULT_PROJECTS_WIDTH;
    saveProjectsWidth(clampProjectsWidth(w));
    try {
      if (e?.pointerId != null) projectsResizer.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  projectsResizer.addEventListener('pointerup', endDrag);
  projectsResizer.addEventListener('pointercancel', endDrag);
  projectsResizer.addEventListener('dblclick', () => {
    const w = applyProjectsWidth(DEFAULT_PROJECTS_WIDTH);
    saveProjectsWidth(w);
  });
}

function findJob(dir, scriptName) {
  return jobs.find((j) => sameDir(j.dir, dir) && j.scriptName === scriptName);
}

/** @type {((ok: boolean) => void) | null} */
let confirmResolver = null;
let confirmAlertMode = false;

function closeConfirm(ok) {
  if (!confirmResolver) return;
  const resolve = confirmResolver;
  confirmResolver = null;
  confirmAlertMode = false;
  confirmModal.hidden = true;
  if (confirmCancelBtn) confirmCancelBtn.hidden = false;
  if (confirmOkBtn) confirmOkBtn.className = 'btn danger solid';
  resolve(ok);
}

/**
 * 自定义二次确认弹窗
 * @param {{ title?: string, message: string, okText?: string, cancelText?: string, alert?: boolean, danger?: boolean }} opts
 * @returns {Promise<boolean>}
 */
function showConfirm(opts) {
  if (confirmResolver) closeConfirm(false);
  confirmAlertMode = !!opts.alert;
  confirmTitle.textContent = opts.title || (confirmAlertMode ? '提示' : '确认');
  confirmMessage.innerHTML = opts.message;
  confirmOkBtn.textContent = opts.okText || (confirmAlertMode ? '知道了' : '确定');
  confirmCancelBtn.textContent = opts.cancelText || '取消';
  confirmCancelBtn.hidden = confirmAlertMode;
  const useDanger = !confirmAlertMode && opts.danger !== false;
  confirmOkBtn.className = useDanger ? 'btn danger solid' : 'btn primary';
  confirmModal.hidden = false;
  confirmOkBtn.focus();
  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}

/** 自定义提示框（单按钮） */
function showAlert(messageOrOpts, maybeTitle) {
  const opts =
    typeof messageOrOpts === 'string'
      ? {
          message: messageOrOpts,
          title: typeof maybeTitle === 'string' ? maybeTitle : '提示',
        }
      : messageOrOpts || {};
  const raw = opts.message == null ? '' : String(opts.message);
  return showConfirm({
    title: opts.title || '提示',
    message: escapeHtml(raw).replace(/\n/g, '<br>'),
    okText: opts.okText || '知道了',
    alert: true,
  });
}

confirmOkBtn.addEventListener('click', () => closeConfirm(true));
confirmCancelBtn.addEventListener('click', () => closeConfirm(false));
confirmModal.querySelectorAll('[data-confirm-cancel]').forEach((el) => {
  el.addEventListener('click', () => closeConfirm(confirmAlertMode));
});
document.addEventListener('keydown', (e) => {
  if (confirmModal.hidden || !confirmResolver) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    closeConfirm(confirmAlertMode);
  } else if (e.key === 'Enter' && document.activeElement === confirmOkBtn) {
    e.preventDefault();
    closeConfirm(true);
  }
});

function hideScriptPopover() {
  clearTimeout(popoverHideTimer);
  scriptPopover.hidden = true;
}

function showHoverPopover(anchor, { name, detail, hint }) {
  clearTimeout(popoverHideTimer);
  scriptPopoverName.textContent = name;
  scriptPopoverCmd.textContent = detail || '';
  scriptPopoverCmd.hidden = !detail;
  if (hint) {
    scriptPopoverHint.hidden = false;
    scriptPopoverHint.textContent = hint;
  } else {
    scriptPopoverHint.hidden = true;
    scriptPopoverHint.textContent = '';
  }
  scriptPopover.hidden = false;

  const rect = anchor.getBoundingClientRect();
  const pad = 8;
  const popW = scriptPopover.offsetWidth;
  const popH = scriptPopover.offsetHeight;
  let left = rect.right + 10;
  let top = rect.top;

  if (left + popW > window.innerWidth - pad) {
    left = Math.max(pad, rect.left - popW - 10);
  }
  if (top + popH > window.innerHeight - pad) {
    top = Math.max(pad, window.innerHeight - popH - pad);
  }
  if (top < pad) top = pad;

  scriptPopover.style.left = `${left}px`;
  scriptPopover.style.top = `${top}px`;
}

function showScriptPopover(row, name, command, isRunning) {
  showHoverPopover(row, {
    name,
    detail: command,
    hint: isRunning ? '双击停止该脚本' : '双击运行（可同时跑多个）',
  });
}

function scheduleHideScriptPopover() {
  clearTimeout(popoverHideTimer);
  popoverHideTimer = setTimeout(hideScriptPopover, 80);
}

function sameDir(a, b) {
  if (!a || !b) return false;
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();
}

function searchKey(dir) {
  return `${SEARCH_PREFIX}${dir}`;
}

function loadSavedKeyword(dir) {
  if (!dir) return '';
  try {
    return localStorage.getItem(searchKey(dir)) ?? '';
  } catch {
    return '';
  }
}

function persistKeyword(dir, value) {
  if (!dir) return;
  try {
    localStorage.setItem(searchKey(dir), value);
  } catch {
    /* ignore */
  }
}

function schedulePersist(value) {
  clearTimeout(saveTimer);
  const dir = project?.dir;
  saveTimer = setTimeout(() => persistKeyword(dir, value), 200);
}

function formatHotkeyLabel(accel) {
  const raw = String(accel || '').trim();
  if (!raw) return '未设置';
  return raw
    .replace(/CommandOrControl/gi, 'Ctrl')
    .replace(/Command/gi, 'Ctrl')
    .replace(/Control/gi, 'Ctrl')
    .replace(/Option/gi, 'Alt')
    .replace(/Alt/gi, 'Alt')
    .replace(/Shift/gi, 'Shift')
    .replace(/\+/g, '+');
}

function syncOneHotkeyUi(kind, accel, opts = {}) {
  const btn = kind === 'screenshot' ? screenshotHotkeyBtn : activateHotkeyBtn;
  const hint = kind === 'screenshot' ? screenshotHotkeyHint : activateHotkeyHint;
  const recording = recordingHotkeyKind === kind;
  const label = formatHotkeyLabel(accel);
  if (btn) {
    btn.textContent = recording ? '按下组合键…' : label;
    btn.classList.toggle('is-recording', recording);
  }
  if (hint) {
    hint.classList.remove('is-error', 'is-recording');
    if (opts.error) {
      hint.textContent = opts.error;
      hint.classList.add('is-error');
    } else if (recording) {
      hint.textContent = '正在录制… Esc 取消 · Backspace 清空';
      hint.classList.add('is-recording');
    } else if (kind === 'screenshot') {
      hint.textContent = '默认留空 · 托盘也可触发截屏';
    } else if (kind === 'activate') {
      hint.textContent = '默认留空 · 显示时关到托盘，隐藏时唤起';
    } else {
      hint.textContent = '默认留空 · 点击录制组合键';
    }
  }
}

function syncHotkeysUi(opts = {}) {
  syncOneHotkeyUi('screenshot', appSettings.screenshotHotkey, {
    error: opts.kind === 'screenshot' ? opts.error : undefined,
  });
  syncOneHotkeyUi('activate', appSettings.activateHotkey, {
    error: opts.kind === 'activate' ? opts.error : undefined,
  });
}

function keyEventToAccelerator(e) {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  let key = null;
  if (e.key === ' ') key = 'Space';
  else if (e.key === '+') key = 'Plus';
  else if (/^F\d{1,2}$/i.test(e.key)) key = e.key.toUpperCase();
  else if (e.key.length === 1 && /[a-z0-9]/i.test(e.key)) key = e.key.toUpperCase();
  else {
    const map = {
      ArrowUp: 'Up',
      ArrowDown: 'Down',
      ArrowLeft: 'Left',
      ArrowRight: 'Right',
      Escape: 'Esc',
      Enter: 'Return',
      Delete: 'Delete',
      Tab: 'Tab',
      Home: 'Home',
      End: 'End',
      PageUp: 'PageUp',
      PageDown: 'PageDown',
    };
    key = map[e.key] || null;
  }
  if (!key) return null;
  if (parts.length === 0) return null;
  parts.push(key);
  return parts.join('+');
}

function stopHotkeyRecording() {
  const wasRecording = !!recordingHotkeyKind;
  recordingHotkeyKind = null;
  if (wasRecording && typeof api.resumeHotkeys === 'function') {
    void api.resumeHotkeys();
  }
  syncHotkeysUi();
}

function startHotkeyRecording(kind) {
  recordingHotkeyKind = kind;
  if (typeof api.suspendHotkeys === 'function') {
    void api.suspendHotkeys();
  }
  syncHotkeysUi();
}

async function applyHotkey(_kind, _accel) {
  void api.openTraySettings?.();
}

function ensureThemePanelOnBody() {
  if (!themePanel || themePanel.parentElement === document.body) return;
  document.body.appendChild(themePanel);
}

function positionThemePanel() {
  if (!themePanel || !themeBtn) return;
  ensureThemePanelOnBody();
  const rect = themeBtn.getBoundingClientRect();
  const panelWidth = Math.min(280, window.innerWidth - 24);
  let left = rect.right - panelWidth;
  left = Math.max(12, Math.min(left, window.innerWidth - panelWidth - 12));
  let top = rect.bottom + 8;
  const panelHeight = themePanel.offsetHeight || 220;
  if (top + panelHeight > window.innerHeight - 12) {
    top = Math.max(12, rect.top - panelHeight - 8);
  }
  themePanel.style.position = 'fixed';
  themePanel.style.top = `${Math.round(top)}px`;
  themePanel.style.right = 'auto';
  themePanel.style.left = `${Math.round(left)}px`;
}

function openThemePanel() {
  if (!themePanel) return;
  ensureThemePanelOnBody();
  themePanel.hidden = false;
  themeBtn?.setAttribute('aria-expanded', 'true');
  syncThemePanelUi();
  positionThemePanel();
  requestAnimationFrame(() => positionThemePanel());
}

function closeThemePanel() {
  if (!themePanel || themePanel.hidden) return;
  themePanel.hidden = true;
  themeBtn?.setAttribute('aria-expanded', 'false');
}

function toggleThemePanel() {
  if (!themePanel) return;
  if (themePanel.hidden) openThemePanel();
  else closeThemePanel();
}

function syncThemePanelUi() {
  const t = appSettings.theme === 'light' ? 'light' : 'dark';
  document.querySelectorAll('[data-theme-choice]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-theme-choice') === t);
  });
}

function setThemeChoice(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  void requestTraySettingsPatch({ theme: next });
}

function openSettingsModal() {
  void api.openTraySettings?.();
}

function closeSettingsModal() {
  if (!settingsModal) return;
  stopHotkeyRecording();
  closeFontPicker();
  settingsModal.hidden = true;
}

function formatHistoryTime(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

/** @type {Set<string>} */
const ssHistorySelectedIds = new Set();
/** @type {string[]} */
let ssHistoryItemIds = [];

function syncSsHistorySelectAllUi() {
  if (!(ssHistorySelectAll instanceof HTMLInputElement)) return;
  const total = ssHistoryItemIds.length;
  const selected = ssHistoryItemIds.filter((id) => ssHistorySelectedIds.has(id)).length;
  ssHistorySelectAll.checked = total > 0 && selected === total;
  ssHistorySelectAll.indeterminate = selected > 0 && selected < total;
  ssHistoryExportBtns.forEach((btn) => {
    if (btn instanceof HTMLButtonElement) btn.disabled = selected === 0;
  });
}

async function refreshScreenshotHistoryList() {
  if (!ssHistoryList || typeof api.listScreenshotHistory !== 'function') return;
  const items = await api.listScreenshotHistory();
  ssHistoryList.replaceChildren();
  ssHistoryItemIds = items.map((x) => x.id);
  const alive = new Set(ssHistoryItemIds);
  for (const id of [...ssHistorySelectedIds]) {
    if (!alive.has(id)) ssHistorySelectedIds.delete(id);
  }
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'ss-history-empty';
    empty.textContent = '暂无截屏 · 点「新截屏」或托盘「截屏」';
    ssHistoryList.appendChild(empty);
    syncSsHistorySelectAllUi();
    return;
  }
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'ss-history-item';
    if (ssHistorySelectedIds.has(item.id)) row.classList.add('is-selected');

    const pickWrap = document.createElement('label');
    pickWrap.className = 'ss-history-pick';
    pickWrap.title = '勾选后可导出 MD / HTML';
    const pick = document.createElement('input');
    pick.type = 'checkbox';
    pick.checked = ssHistorySelectedIds.has(item.id);
    pick.addEventListener('click', (e) => e.stopPropagation());
    pick.addEventListener('change', () => {
      if (pick.checked) ssHistorySelectedIds.add(item.id);
      else ssHistorySelectedIds.delete(item.id);
      row.classList.toggle('is-selected', pick.checked);
      syncSsHistorySelectAllUi();
    });
    pickWrap.appendChild(pick);

    const img = document.createElement('img');
    img.className = 'ss-history-thumb';
    img.alt = '';
    img.src = item.thumbDataUrl || '';
    const meta = document.createElement('div');
    meta.className = 'ss-history-meta';
    const time = document.createElement('div');
    time.className = 'ss-history-time';
    time.textContent = formatHistoryTime(item.createdAt);
    const text = document.createElement('div');
    text.className = 'ss-history-text';
    text.textContent = item.text || '（无标记文案）';
    const actions = document.createElement('div');
    actions.className = 'ss-history-actions';

    const mkBtn = (label, title, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        void fn();
      });
      return b;
    };

    actions.append(
      mkBtn('图文', '复制图片+文案到剪贴板', async () => {
        await api.copyScreenshotHistory(item.id, 'both');
      }),
      mkBtn('图片', '仅复制图片', async () => {
        await api.copyScreenshotHistory(item.id, 'image');
      }),
      mkBtn('文案', '仅复制文案', async () => {
        await api.copyScreenshotHistory(item.id, 'text');
      }),
      mkBtn('删除', '删除此条', async () => {
        await api.removeScreenshotHistory(item.id);
        ssHistorySelectedIds.delete(item.id);
        await refreshScreenshotHistoryList();
      }),
    );
    meta.append(time, text, actions);
    row.append(pickWrap, img, meta);
    row.addEventListener('click', (e) => {
      if (e.target instanceof HTMLButtonElement) return;
      if (e.target instanceof HTMLInputElement) return;
      pick.checked = !pick.checked;
      pick.dispatchEvent(new Event('change'));
    });
    ssHistoryList.appendChild(row);
  }
  syncSsHistorySelectAllUi();
}

async function openScreenshotHistoryModal() {
  if (!ssHistoryModal) return;
  closeSettingsModal();
  ssHistoryModal.hidden = false;
  await refreshScreenshotHistoryList();
}

function closeScreenshotHistoryModal() {
  if (!ssHistoryModal) return;
  ssHistoryModal.hidden = true;
}

function syncPersistLogsUi(enabled) {
  persistLogs = enabled;
  if (!persistLogBtn) return;
  persistLogBtn.classList.toggle('active', enabled);
  persistLogBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
}

function closeFontPicker() {
  if (!fontPickerMenu || !fontPickerBtn) return;
  fontPickerMenu.hidden = true;
  fontPickerBtn.setAttribute('aria-expanded', 'false');
}

function positionFontPickerMenu() {
  if (!fontPickerMenu || !fontPickerBtn) return;
  const gap = 4;
  const pad = 8;
  const preferH = 200;
  const r = fontPickerBtn.getBoundingClientRect();
  const spaceBelow = window.innerHeight - r.bottom - pad;
  const spaceAbove = r.top - pad;
  const contentH = fontPickerMenu.scrollHeight || preferH;
  const need = Math.min(preferH, contentH);
  const openUp = spaceBelow < need + gap && spaceAbove > spaceBelow;
  const avail = openUp ? spaceAbove : spaceBelow;
  const maxH = Math.max(80, Math.min(preferH, avail - gap));

  let left = r.left;
  const width = r.width;
  if (left + width > window.innerWidth - pad) {
    left = Math.max(pad, window.innerWidth - pad - width);
  }
  if (left < pad) left = pad;

  fontPickerMenu.style.position = 'fixed';
  fontPickerMenu.style.left = `${Math.round(left)}px`;
  fontPickerMenu.style.width = `${Math.round(width)}px`;
  fontPickerMenu.style.right = 'auto';
  fontPickerMenu.style.maxHeight = `${Math.round(maxH)}px`;
  fontPickerMenu.dataset.placement = openUp ? 'top' : 'bottom';

  if (openUp) {
    fontPickerMenu.style.top = 'auto';
    fontPickerMenu.style.bottom = `${Math.round(window.innerHeight - r.top + gap)}px`;
  } else {
    fontPickerMenu.style.bottom = 'auto';
    fontPickerMenu.style.top = `${Math.round(r.bottom + gap)}px`;
  }
}

function openFontPicker() {
  if (!fontPickerMenu || !fontPickerBtn) return;
  // 先显示再量高，避免 hidden 时高度为 0
  fontPickerMenu.hidden = false;
  positionFontPickerMenu();
  // 再按实际内容高度微调一次（仍做上下避让）
  requestAnimationFrame(() => positionFontPickerMenu());
  fontPickerBtn.setAttribute('aria-expanded', 'true');
}

function toggleFontPicker() {
  if (!fontPickerMenu) return;
  if (fontPickerMenu.hidden) openFontPicker();
  else closeFontPicker();
}

function syncFontPickerUi(presets, selectedId) {
  if (!fontPickerMenu || !fontPickerLabel) return;
  const cur = presets.find((p) => p.id === selectedId) || presets[0];
  fontPickerLabel.textContent = cur?.label || selectedId;
  fontPickerLabel.style.fontFamily = cur?.stack || 'inherit';
  fontPickerMenu.replaceChildren();
  for (const f of presets) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'font-picker-option' + (f.id === selectedId ? ' is-active' : '');
    btn.role = 'option';
    btn.dataset.id = f.id;
    btn.textContent = f.label;
    btn.style.fontFamily = f.stack;
    btn.setAttribute('aria-selected', f.id === selectedId ? 'true' : 'false');
    btn.addEventListener('click', () => {
      void onFontChange(f.id);
      closeFontPicker();
    });
    fontPickerMenu.appendChild(btn);
  }
}

function readLocalGlassBlur() {
  try {
    const n = Number(localStorage.getItem(GLASS_BLUR_KEY));
    if (Number.isFinite(n)) {
      return Math.min(MAX_GLASS_BLUR_PX, Math.max(MIN_GLASS_BLUR_PX, Math.round(n)));
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_GLASS_BLUR_PX;
}

function applyGlassVars(alphaPct, blurPx = readLocalGlassBlur()) {
  const pct = Math.round(alphaPct);
  const blur = Math.min(
    MAX_GLASS_BLUR_PX,
    Math.max(MIN_GLASS_BLUR_PX, Math.round(blurPx)),
  );
  document.documentElement.style.setProperty('--glass-alpha', String(pct / 100));
  document.documentElement.style.setProperty('--glass-blur', `${blur}px`);
  if (glassAlphaLabel) glassAlphaLabel.textContent = `${pct}%`;
  if (glassAlphaRange) glassAlphaRange.value = String(pct);
  if (glassBlurLabel) glassBlurLabel.textContent = `${blur}px`;
  if (glassBlurRange) glassBlurRange.value = String(blur);
}

function clampShellMosaicCols(raw) {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_SHELL_MOSAIC_COLS;
  return Math.min(MAX_SHELL_MOSAIC_COLS, Math.max(MIN_SHELL_MOSAIC_COLS, Math.round(n)));
}

function applyShellMosaicCols(cols) {
  const n = clampShellMosaicCols(cols);
  document.documentElement.style.setProperty('--shell-mosaic-cols', String(n));
  if (shellColsLabel) shellColsLabel.textContent = String(n);
  if (shellColsRange) shellColsRange.value = String(n);
}

function syncShellLayoutSettingsUi() {
  const layout = appSettings.shellLayout === 'single' ? 'single' : 'grid';
  document.querySelectorAll('[data-shell-layout]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-shell-layout') === layout);
  });
  if (shellLayoutBtn) {
    shellLayoutBtn.dataset.layout = layout;
    shellLayoutBtn.textContent = layout === 'grid' ? '网格' : '单个';
    shellLayoutBtn.title =
      layout === 'grid' ? '当前：网格 · 点击改为单个' : '当前：单个 · 点击改为网格';
  }
}

/** 切换布局时优先留在当前脚本/Shell；在「系统」则切到任一输出 Tab */
function focusSessionForLayoutPreview() {
  if (isMosaicPaneKind(activeLogId)) return activeLogId;
  return visibleMosaicIds()[0] || null;
}

function applyShellLayoutLocally(next) {
  const layout = next === 'single' ? 'single' : 'grid';
  appSettings.shellLayout = layout;
  syncShellLayoutSettingsUi();
  const focus = focusSessionForLayoutPreview();
  if (focus) {
    scheduleLogPaint({ structural: true, immediate: true, focus });
  }
  return layout;
}

async function toggleShellLayout() {
  const next = appSettings.shellLayout === 'grid' ? 'single' : 'grid';
  applyShellLayoutLocally(next);
  void requestTraySettingsPatch({ shellLayout: next });
}

async function setShellLayout(layout) {
  const next = layout === 'single' ? 'single' : 'grid';
  if (appSettings.shellLayout === next) {
    const focus = focusSessionForLayoutPreview();
    if (focus && focus !== activeLogId) {
      scheduleLogPaint({ structural: true, immediate: true, focus });
    } else if (focus && isMosaicPaneKind(activeLogId)) {
      scheduleLogPaint({ structural: true, immediate: true, focus });
    }
    return;
  }
  applyShellLayoutLocally(next);
  void requestTraySettingsPatch({ shellLayout: next });
}

function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  if (themeBtn) {
    themeBtn.title = t === 'dark' ? '主题设置 · 当前暗色' : '主题设置 · 当前浅色';
  }
  syncThemePanelUi();
  if (window.PkgTokens) {
    window.PkgTokens.syncTerminalThemes(shellTerms);
  }
}

function clampScreenshotHistoryLimit(raw) {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_SCREENSHOT_HISTORY_LIMIT;
  return Math.min(
    MAX_SCREENSHOT_HISTORY_LIMIT,
    Math.max(MIN_SCREENSHOT_HISTORY_LIMIT, Math.round(n)),
  );
}

function syncScreenshotHistoryLimitUi(limit) {
  const n = clampScreenshotHistoryLimit(limit);
  if (ssHistoryLimitInput) ssHistoryLimitInput.value = String(n);
  if (ssHistoryLimitHint) {
    ssHistoryLimitHint.textContent = `勾选 → 导出 MD / HTML · 已落盘 · 最多 ${n} 条`;
  }
  if (ssHistoryBtn) ssHistoryBtn.title = `截屏历史（最多 ${n} 条）`;
}

function pickSetting(_key, fromHost, fallback) {
  return fromHost !== undefined ? fromHost : fallback;
}

function applySettingsState(settings) {
  if (!settings || typeof settings !== 'object') return;
  const prevLayout = appSettings.shellLayout;
  const prevCols = appSettings.shellMosaicCols;

  const hostLayout = settings.shellLayout === 'single' ? 'single' : 'grid';
  const hostCols =
    typeof settings.shellMosaicCols === 'number'
      ? clampShellMosaicCols(settings.shellMosaicCols)
      : undefined;

  appSettings = {
    fontId: pickSetting('fontId', settings.fontId || undefined, appSettings.fontId),
    glassAlpha: pickSetting(
      'glassAlpha',
      typeof settings.glassAlpha === 'number' ? settings.glassAlpha : undefined,
      appSettings.glassAlpha,
    ),
    theme: pickSetting(
      'theme',
      settings.theme === 'light' || settings.theme === 'dark' ? settings.theme : undefined,
      appSettings.theme,
    ),
    shellMosaicCols: clampShellMosaicCols(
      pickSetting('shellMosaicCols', hostCols, appSettings.shellMosaicCols),
    ),
    shellLayout: pickSetting('shellLayout', hostLayout, appSettings.shellLayout) === 'single'
      ? 'single'
      : 'grid',
    alwaysOnTop: !!pickSetting(
      'alwaysOnTop',
      typeof settings.alwaysOnTop === 'boolean' ? settings.alwaysOnTop : undefined,
      appSettings.alwaysOnTop,
    ),
    screenshotHotkey: pickSetting(
      'screenshotHotkey',
      typeof settings.screenshotHotkey === 'string' ? settings.screenshotHotkey : undefined,
      appSettings.screenshotHotkey,
    ),
    activateHotkey: pickSetting(
      'activateHotkey',
      typeof settings.activateHotkey === 'string' ? settings.activateHotkey : undefined,
      appSettings.activateHotkey,
    ),
    screenshotHistoryLimit: clampScreenshotHistoryLimit(
      pickSetting(
        'screenshotHistoryLimit',
        typeof settings.screenshotHistoryLimit === 'number'
          ? settings.screenshotHistoryLimit
          : undefined,
        appSettings.screenshotHistoryLimit,
      ),
    ),
  };
  const fonts = window.PkgFonts;
  if (fonts) {
    fonts.applyDocumentFonts({ fontId: appSettings.fontId });
    syncFontPickerUi(fonts.FONT_PRESETS, appSettings.fontId);
  }
  applyGlassVars(appSettings.glassAlpha, readLocalGlassBlur());
  applyShellMosaicCols(appSettings.shellMosaicCols);
  syncShellLayoutSettingsUi();
  applyTheme(appSettings.theme);
  // data-env 仅默认种子；设置里的主色调写 --tone（铺底 + 点缀皆由其派生）
  if (typeof settings.brandColor === 'string' && settings.brandColor.trim()) {
    const c = settings.brandColor.trim().toUpperCase();
    const style = document.documentElement.style;
    [
      '--brand', '--brand-700', '--brand-680', '--brand-650', '--brand-620', '--brand-600',
      '--brand-550', '--brand-500', '--brand-450', '--brand-420', '--brand-400',
      '--brand-300', '--brand-200', '--brand-150', '--brand-100',
      '--color-accent', '--color-accent-hover', '--color-accent-soft',
      '--color-accent-soft-strong', '--color-accent-fill', '--color-accent-inset',
      '--color-focus-ring', '--accent', '--accent-hover',
    ].forEach((k) => style.removeProperty(k));
    style.setProperty('--tone', c);
  }
  if (alwaysOnTopCheck) alwaysOnTopCheck.checked = !!appSettings.alwaysOnTop;
  syncScreenshotHistoryLimitUi(appSettings.screenshotHistoryLimit);
  if (!recordingHotkeyKind) syncHotkeysUi();

  // 宿主回包改了布局/列数（且无未确认乐观值）时补一次结构刷新
  if (
    (prevLayout !== appSettings.shellLayout || prevCols !== appSettings.shellMosaicCols) &&
    isMosaicPaneKind(activeLogId)
  ) {
    scheduleLogPaint({ structural: true, immediate: true });
  }
}

async function requestTraySettingsPatch(patch) {
  if (!patch || typeof patch !== 'object') return;
  if (typeof api.requestTraySettingsPatch === 'function') {
    await api.requestTraySettingsPatch(patch);
    return;
  }
  void api.openTraySettings?.();
}

async function onFontChange(nextId) {
  const fonts = window.PkgFonts;
  if (!fonts || !nextId) return;
  fonts.applyDocumentFonts({ fontId: nextId });
  syncFontPickerUi(fonts.FONT_PRESETS, nextId);
  await requestTraySettingsPatch({ fontId: nextId });
}

function scheduleGlassPersist(pct) {
  clearTimeout(saveSettingsTimer);
  saveSettingsTimer = setTimeout(() => {
    void requestTraySettingsPatch({ glassAlpha: pct });
  }, 120);
}

function scheduleGlassBlurPersist(blurPx) {
  clearTimeout(saveSettingsTimer);
  saveSettingsTimer = setTimeout(() => {
    try {
      localStorage.setItem(GLASS_BLUR_KEY, String(blurPx));
    } catch {
      /* ignore */
    }
  }, 120);
}

async function syncSettingsFromTray() {
  if (typeof api.getSettings !== 'function') return;
  try {
    applySettingsState(await api.getSettings());
  } catch {
    /* tray not ready */
  }
}

glassAlphaRange?.addEventListener('input', () => {
  const pct = Number(glassAlphaRange.value);
  applyGlassVars(pct, readLocalGlassBlur());
  appSettings.glassAlpha = pct;
  scheduleGlassPersist(pct);
});

glassBlurRange?.addEventListener('input', () => {
  const blur = Math.min(
    MAX_GLASS_BLUR_PX,
    Math.max(MIN_GLASS_BLUR_PX, Math.round(Number(glassBlurRange.value))),
  );
  applyGlassVars(appSettings.glassAlpha, blur);
  try {
    localStorage.setItem(GLASS_BLUR_KEY, String(blur));
  } catch {
    /* ignore */
  }
  scheduleGlassBlurPersist(blur);
});

let saveShellColsTimer = null;
shellColsRange?.addEventListener('input', () => {
  const n = clampShellMosaicCols(Number(shellColsRange.value));
  applyShellMosaicCols(n);
  appSettings.shellMosaicCols = n;
  clearTimeout(saveShellColsTimer);
  saveShellColsTimer = setTimeout(() => {
    void requestTraySettingsPatch({ shellMosaicCols: n });
  }, 120);
});

document.querySelectorAll('[data-shell-layout]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const layout = btn.getAttribute('data-shell-layout');
    void setShellLayout(layout === 'single' ? 'single' : 'grid');
  });
});

alwaysOnTopCheck?.addEventListener('change', () => {
  const on = !!alwaysOnTopCheck.checked;
  appSettings.alwaysOnTop = on;
  void requestTraySettingsPatch({ alwaysOnTop: on });
});

function scheduleHistoryLimitPersist(raw) {
  clearTimeout(saveHistoryLimitTimer);
  saveHistoryLimitTimer = setTimeout(() => {
    const n = clampScreenshotHistoryLimit(raw);
    if (ssHistoryLimitInput) ssHistoryLimitInput.value = String(n);
    appSettings.screenshotHistoryLimit = n;
    void requestTraySettingsPatch({ screenshotHistoryLimit: n });
  }, 200);
}

ssHistoryLimitInput?.addEventListener('change', () => {
  scheduleHistoryLimitPersist(ssHistoryLimitInput.value);
});
ssHistoryLimitInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    scheduleHistoryLimitPersist(ssHistoryLimitInput.value);
    ssHistoryLimitInput.blur();
  }
});

fontPickerBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleFontPicker();
});
document.addEventListener('click', (e) => {
  if (!(e.target instanceof Node)) return;
  if (fontPicker?.contains(e.target) || fontPickerMenu?.contains(e.target)) return;
  closeFontPicker();
});
document.addEventListener('keydown', (e) => {
  if (recordingHotkeyKind) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      stopHotkeyRecording();
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      void applyHotkey(recordingHotkeyKind, '');
      return;
    }
    const accel = keyEventToAccelerator(e);
    if (accel) void applyHotkey(recordingHotkeyKind, accel);
    return;
  }
  if (e.key === 'Escape') {
    if (fontPickerMenu && !fontPickerMenu.hidden) closeFontPicker();
    else if (themePanel && !themePanel.hidden) closeThemePanel();
    else if (settingsModal && !settingsModal.hidden) closeSettingsModal();
    else if (ssHistoryModal && !ssHistoryModal.hidden) closeScreenshotHistoryModal();
  }
});
window.addEventListener('resize', () => {
  if (fontPickerMenu && !fontPickerMenu.hidden) positionFontPickerMenu();
  if (themePanel && !themePanel.hidden) positionThemePanel();
});
document.addEventListener(
  'scroll',
  () => {
    if (fontPickerMenu && !fontPickerMenu.hidden) positionFontPickerMenu();
  },
  true,
);


function syncMaximizedUi(v) {
  maximized = v;
  document.body.classList.toggle('is-maximized', !!v);
  document.documentElement.classList.toggle('is-maximized', !!v);
  maxIcon.className = v ? 'ico ico-restore' : 'ico ico-max';
  maxBtn.title = v ? '还原' : '最大化';
  maxBtn.setAttribute('aria-label', maxBtn.title);
}

function setJobs(next) {
  jobs = next || [];

  const runningIds = new Set(jobs.map((j) => j.id));
  for (const [id, s] of logSessions) {
    if (id === SYSTEM_LOG_ID) continue;
    // Shell 的 running 由 submit / onExit 管，不能被 jobs 列表冲掉
    if (isShellSessionId(id)) continue;
    s.running = runningIds.has(id);
  }
  for (const j of jobs) {
    const s = ensureJobSession(j.id, j.scriptName, j.dir);
    s.running = true;
    s.dir = j.dir;
  }

  document.querySelectorAll('.script-row[data-script]').forEach((row) => {
    const name = row.getAttribute('data-script');
    const running = !!(project && name && findJob(project.dir, name));
    row.classList.toggle('is-running', running);
  });

  renderProjects();
  // 只更新 Tab 状态，避免整表重绘 + 全量 ANSI 解析
  for (const id of logSessions.keys()) updateLogTabChrome(id);
  if (logStructureDirty) scheduleLogPaint({ structural: true });
}

function appendLog(text) {
  appendToSession(SYSTEM_LOG_ID, text, { title: '系统' });
}

function getQuery() {
  return (searchInput.value || '').trim().toLowerCase();
}

/**
 * 子序列模糊匹配：查询字符按序出现即可（如 `dsk` → `desktop`）。
 * 连续命中、词首、开头加权。返回分数，未命中为 0。
 * @param {string} query
 * @param {string} text
 */
function fuzzyScore(query, text) {
  if (!query) return 1;
  if (!text) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) {
    // 整段包含：越靠前越好
    const idx = t.indexOf(q);
    return 1000 - idx + Math.min(q.length, 80);
  }

  let ti = 0;
  let score = 0;
  let consecutive = 0;
  let first = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    for (let j = ti; j < t.length; j++) {
      if (t[j] === ch) {
        found = j;
        break;
      }
    }
    if (found < 0) return 0;
    if (first < 0) first = found;
    if (found === ti && consecutive > 0) {
      consecutive += 1;
      score += 12 + consecutive * 4;
    } else {
      consecutive = 1;
      score += 4;
    }
    // 词首 / 路径分隔后 / camelCase
    const orig = text[found];
    const prevOrig = found > 0 ? text[found - 1] : '';
    if (
      found === 0 ||
      /[-_./\\:\s]/.test(t[found - 1] || '') ||
      (found > 0 &&
        prevOrig >= 'a' &&
        prevOrig <= 'z' &&
        orig >= 'A' &&
        orig <= 'Z')
    ) {
      score += 8;
    }
    ti = found + 1;
  }
  // 越短越贴、越靠前越好
  score += Math.max(0, 40 - (t.length - q.length));
  score += Math.max(0, 20 - first);
  return score;
}

/** @param {string} query @param {string[]} fields */
function fuzzyBestScore(query, fields) {
  let best = 0;
  for (const f of fields) {
    const s = fuzzyScore(query, f || '');
    if (s > best) best = s;
  }
  return best;
}

function filteredScripts() {
  if (!project) return [];
  const q = getQuery();
  if (!q) return project.scripts;
  return project.scripts
    .map((s) => ({
      s,
      score: fuzzyBestScore(q, [s.name, s.command]),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name))
    .map((x) => x.s);
}

function updateScriptsLabel(shown, total) {
  if (!project) {
    scriptsLabel.textContent = '脚本';
    return;
  }
  if (!getQuery()) {
    scriptsLabel.textContent = `脚本（${total}）`;
    return;
  }
  scriptsLabel.textContent = `脚本（${shown}/${total}）`;
}

function runningCountFor(dir) {
  return jobs.filter((j) => sameDir(j.dir, dir)).length;
}

function escapeHtml(s) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replaceAll("'", '&#39;');
}

function projectSearchKeyword() {
  return (projectSearchInput?.value || '').trim().toLowerCase();
}

function filteredProjects() {
  const q = projectSearchKeyword();
  const list = projectsState.projects || [];
  if (!q) return list;
  return list
    .map((p) => ({
      p,
      score: fuzzyBestScore(q, [p.name, p.dir]),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (a.p.name || '').localeCompare(b.p.name || ''))
    .map((x) => x.p);
}

function renderProjects() {
  hideScriptPopover();
  projectListEl.innerHTML = '';
  if (!projectsState.projects.length) {
    projectListEl.innerHTML = '<div class="empty">还没有项目，点「添加」或粘贴路径</div>';
    return;
  }
  const list = filteredProjects();
  if (!list.length) {
    projectListEl.innerHTML = '<div class="empty">没有匹配的项目</div>';
    return;
  }
  for (const p of list) {
    const running = runningCountFor(p.dir);
    const scripts = typeof p.scriptCount === 'number' ? p.scriptCount : 0;
    const item = document.createElement('div');
    item.className = 'project-item';
    if (projectsState.activeProject && sameDir(projectsState.activeProject, p.dir)) {
      item.classList.add('active');
    }
    item.innerHTML = `
      <div class="project-item-text">
        <div class="project-item-name">
          <span
            class="project-item-ratio ${running ? 'hot' : ''}"
            title="执行中 / 总脚本数"
          >${running}/${scripts}</span>
          <span class="project-item-title">${escapeHtml(p.name)}</span>
        </div>
        <div class="project-item-dir">${escapeHtml(p.dir)}</div>
      </div>
      <button type="button" class="btn btn-remove" data-remove="${escapeAttr(p.dir)}" title="从列表移除">×</button>
    `;
    item.addEventListener('mouseenter', () => {
      showHoverPopover(item, {
        name: p.name || p.dir,
        detail: p.dir,
        hint: '点击切换项目',
      });
    });
    item.addEventListener('mouseleave', () => {
      scheduleHideScriptPopover();
    });
    item.addEventListener('click', (e) => {
      const t = e.target;
      if (t instanceof HTMLElement && t.closest('[data-remove]')) return;
      hideScriptPopover();
      void selectProject(p.dir);
    });
    projectListEl.appendChild(item);
  }
  projectListEl.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const dir = btn.getAttribute('data-remove');
      if (!dir) return;
      const item = projectsState.projects.find((p) => sameDir(p.dir, dir));
      const name = item?.name ? escapeHtml(item.name) : '未命名项目';
      const pathHtml = escapeHtml(item?.dir || dir);
      const ok = await showConfirm({
        title: '移除项目',
        message: `确定从列表移除该项目？<br><br><strong>${name}</strong><br>${pathHtml}<br><br>不会删除磁盘上的文件。`,
        okText: '移除',
        cancelText: '取消',
      });
      if (!ok) return;
      await applyProjectsState(await api.removeProject(dir));
    });
  });
}

function renderScripts() {
  hideScriptPopover();
  scriptsEl.innerHTML = '';
  if (!project) {
    updateScriptsLabel(0, 0);
    scriptsEl.innerHTML = '<div class="empty">选择左侧项目以查看 scripts</div>';
    return;
  }
  if (!project.scripts.length) {
    updateScriptsLabel(0, 0);
    scriptsEl.innerHTML = '<div class="empty">package.json 里没有 scripts</div>';
    return;
  }

  const list = filteredScripts();
  updateScriptsLabel(list.length, project.scripts.length);

  if (!list.length) {
    scriptsEl.innerHTML = '<div class="empty">没有匹配的脚本</div>';
    return;
  }

  for (const s of list) {
    const row = document.createElement('div');
    const isRunning = !!findJob(project.dir, s.name);
    row.className = 'script-row';
    row.dataset.script = s.name;
    if (isRunning) row.classList.add('is-running');
    row.innerHTML = `<span class="script-run-status" title="运行中" aria-label="运行中"></span><div class="script-name">${escapeHtml(s.name)}</div>`;
    row.addEventListener('mouseenter', () => {
      showScriptPopover(row, s.name, s.command, !!findJob(project.dir, s.name));
    });
    row.addEventListener('mouseleave', () => {
      scheduleHideScriptPopover();
    });
    row.addEventListener('dblclick', async () => {
      if (!project) return;
      hideScriptPopover();
      const job = findJob(project.dir, s.name);
      try {
        if (job) {
          await api.stop(job.id);
        } else {
          const id = await api.runScript(project.dir, s.name);
          activeLogId = id;
          renderLogUi();
        }
      } catch (e) {
        appendLog(`\n[错误] ${e instanceof Error ? e.message : String(e)}\n`);
      }
    });
    scriptsEl.appendChild(row);
  }
}

async function loadActiveProject(dir) {
  if (!dir) {
    project = null;
    metaEl.textContent = '未选择项目';
    metaEl.classList.remove('error');
    searchInput.value = '';
    renderScripts();
    return;
  }
  try {
    project = await api.loadProject(dir);
    searchInput.value = loadSavedKeyword(project.dir);
    metaEl.classList.remove('error');
    metaEl.textContent = `${project.name} · ${project.packageManager} · ${project.scripts.length} scripts · ${project.dir}`;
    renderScripts();
  } catch (e) {
    project = null;
    renderScripts();
    metaEl.classList.add('error');
    metaEl.textContent = e instanceof Error ? e.message : String(e);
  }
}

async function applyProjectsState(state) {
  const prevActive = projectsState.activeProject;
  projectsState = state;
  renderProjects();
  const active = state.activeProject;
  if (!active) {
    await loadActiveProject(null);
  } else if (!(project && sameDir(project.dir, active))) {
    await loadActiveProject(active);
  }
  const changed =
    (!prevActive && !!active) ||
    (!!prevActive && !active) ||
    (!!prevActive && !!active && !sameDir(prevActive, active));
  if (changed) {
    preferProjectOutputTab();
    scheduleLogPaint({ structural: true, immediate: true });
  }
}

async function selectProject(dir) {
  if (projectsState.activeProject && sameDir(projectsState.activeProject, dir)) {
    await loadActiveProject(dir);
    preferProjectOutputTab();
    scheduleLogPaint({ structural: true, immediate: true });
    return;
  }
  await applyProjectsState(await api.setActiveProject(dir));
}

async function addProjectFromDir(dir) {
  const trimmed = (dir || '').trim();
  if (!trimmed) {
    metaEl.textContent = '请输入或选择目录';
    metaEl.classList.add('error');
    return;
  }
  try {
    await api.addProject(trimmed);
    pathInput.value = '';
    // state 会通过 onProjects / 再拉一次保证同步
    await applyProjectsState(await api.getProjects());
  } catch (e) {
    metaEl.classList.add('error');
    metaEl.textContent = e instanceof Error ? e.message : String(e);
  }
}

addProjectBtn.addEventListener('click', async () => {
  const dir = await api.pickDir();
  if (dir) await addProjectFromDir(dir);
});

pathInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void addProjectFromDir(pathInput.value);
});

searchInput.addEventListener('input', () => {
  schedulePersist(searchInput.value);
  renderScripts();
});

projectSearchInput?.addEventListener('input', () => {
  try {
    localStorage.setItem(PROJECT_SEARCH_KEY, projectSearchInput.value || '');
  } catch {
    /* ignore */
  }
  renderProjects();
});

try {
  const savedProjectQ = localStorage.getItem(PROJECT_SEARCH_KEY);
  if (projectSearchInput && typeof savedProjectQ === 'string') {
    projectSearchInput.value = savedProjectQ;
  }
} catch {
  /* ignore */
}

scriptsEl.addEventListener('scroll', () => {
  hideScriptPopover();
});

projectListEl.addEventListener('scroll', () => {
  hideScriptPopover();
});

clearLogBtn.addEventListener('click', () => {
  const s = logSessions.get(activeLogId);
  if (!s) return;
  s.text = '';
  s.truncated = false;
  invalidateSessionHtml(s);
  paintLogView(activeLogId, true);
});

openLogsDirBtn?.addEventListener('click', () => {
  void api.openLogsDir();
});

clearDiskLogsBtn?.addEventListener('click', async () => {
  const ok = await showConfirm({
    title: '清除落盘日志',
    message: '确定删除 run-logs 目录下的全部日志文件？<br>当前输出框内容不受影响。',
    okText: '清除',
    cancelText: '取消',
  });
  if (!ok) return;
  await api.clearDiskLogs();
});

persistLogBtn?.addEventListener('click', async () => {
  await requestTraySettingsPatch({ persistLogs: !persistLogs });
});



settingsBtn?.addEventListener('click', () => {
  if (typeof api.openTraySettings === 'function') {
    void api.openTraySettings();
    return;
  }
  openSettingsModal();
});

themeBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleThemePanel();
});

themePanelCloseBtn?.addEventListener('click', () => {
  closeThemePanel();
});

themePanel?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!(e.target instanceof Element)) return;
  const choice = e.target.closest('[data-theme-choice]');
  if (choice) {
    setThemeChoice(choice.getAttribute('data-theme-choice') || 'dark');
  }
});

document.addEventListener('mousedown', (e) => {
  if (!themePanel || themePanel.hidden) return;
  if (!(e.target instanceof Node)) return;
  if (themePanel.contains(e.target) || themeBtn?.contains(e.target)) return;
  closeThemePanel();
});

settingsCloseBtn?.addEventListener('click', () => {
  closeSettingsModal();
});

settingsModal?.addEventListener('click', (e) => {
  if (!(e.target instanceof Element)) return;
  if (e.target.closest('[data-settings-close]')) closeSettingsModal();
});



screenshotHotkeyBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (recordingHotkeyKind === 'screenshot') stopHotkeyRecording();
  else startHotkeyRecording('screenshot');
});

activateHotkeyBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (recordingHotkeyKind === 'activate') stopHotkeyRecording();
  else startHotkeyRecording('activate');
});



screenshotHotkeyClearBtn?.addEventListener('click', () => {
  void applyHotkey('screenshot', '');
});

activateHotkeyClearBtn?.addEventListener('click', () => {
  void applyHotkey('activate', '');
});

ssHistoryBtn?.addEventListener('click', () => {
  void openScreenshotHistoryModal();
});

ssHistoryCloseBtn?.addEventListener('click', () => {
  closeScreenshotHistoryModal();
});

ssHistoryModal?.addEventListener('click', (e) => {
  if (!(e.target instanceof Element)) return;
  if (e.target.closest('[data-ss-history-close]')) closeScreenshotHistoryModal();
});

ssCaptureBtn?.addEventListener('click', async () => {
  closeScreenshotHistoryModal();
  if (typeof api.startScreenshot === 'function') await api.startScreenshot();
});

ssHistoryClearBtn?.addEventListener('click', async () => {
  const ok = await showConfirm({
    title: '清空截屏历史',
    message: '确定删除全部截屏记录？',
    okText: '清空',
    cancelText: '取消',
  });
  if (!ok) return;
  await api.clearScreenshotHistory();
  await refreshScreenshotHistoryList();
});

ssHistoryDirBtn?.addEventListener('click', async () => {
  if (typeof api.openScreenshotHistoryDir !== 'function') return;
  await api.openScreenshotHistoryDir();
});

ssHistorySelectAll?.addEventListener('change', () => {
  if (!(ssHistorySelectAll instanceof HTMLInputElement)) return;
  const on = ssHistorySelectAll.checked;
  ssHistorySelectedIds.clear();
  if (on) {
    for (const id of ssHistoryItemIds) ssHistorySelectedIds.add(id);
  }
  void refreshScreenshotHistoryList();
});

ssHistoryExportBtns.forEach((btn) => {
  btn.addEventListener('click', async () => {
    const format = btn.getAttribute('data-ss-export');
    if (format !== 'md' && format !== 'html') {
      return;
    }
    if (typeof api.exportScreenshotHistory !== 'function') return;
    const ids = ssHistoryItemIds.filter((id) => ssHistorySelectedIds.has(id));
    if (!ids.length) {
      await showAlert('请先勾选要导出的截屏');
      return;
    }
    const res = await api.exportScreenshotHistory(ids, format);
    if (!res?.ok) {
      if (res?.error && res.error !== '已取消') {
        await showAlert(res.error, '导出失败');
      }
      return;
    }
    const label = format === 'html' ? 'HTML' : 'Markdown';
    const where = res.path ? `\n${res.path}` : '';
    await showAlert(`已导出 ${label}（${res.count ?? ids.length} 条）${where}`, '导出完成');
  });
});


minBtn.addEventListener('click', () => {
  void api.windowMinimize();
});

maxBtn.addEventListener('click', async () => {
  syncMaximizedUi(await api.windowMaximize());
});

closeBtn.addEventListener('click', () => {
  void api.windowClose();
});

// 标题栏：不透明窗只用 CSS -webkit-app-region:drag。
// JS setPosition 与原生 drag 叠用会闪烁，故仅保留双击最大化。
(function installTitlebarChrome() {
  const el = titlebarEl;
  if (!el) return;
  let lastTapAt = 0;
  let lastTapX = 0;
  let lastTapY = 0;

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (!(e.target instanceof Element)) return;
    if (e.target.closest('.titlebar-actions, button, a, input, select, textarea')) return;
    if (!e.target.closest('.titlebar-drag')) return;

    const now = Date.now();
    const dt = now - lastTapAt;
    const dist = Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY);
    if (dt > 0 && dt < 400 && dist < 10) {
      lastTapAt = 0;
      e.preventDefault();
      void api.windowMaximize().then(syncMaximizedUi);
      return;
    }
    lastTapAt = now;
    lastTapX = e.clientX;
    lastTapY = e.clientY;
  });
})();

api.onLog((payload) => handleLogPayload(payload));
api.onJobs((list) => setJobs(list));
api.onShellData?.((payload) => {
  const entry = shellTerms.get(payload.id);
  if (entry) {
    try {
      entry.term.write(payload.data);
    } catch {
      /* ignore */
    }
    return;
  }
  const prev = shellPendingData.get(payload.id) || '';
  shellPendingData.set(payload.id, prev + payload.data);
});
api.onExit((payload) => {
  const s = logSessions.get(payload.id);
  if (s) {
    s.running = false;
    s.code = payload.code;
    updateLogTabChrome(payload.id);
    updatePaneChrome(payload.id);
  }
});
api.onOpenDir((dir) => {
  void addProjectFromDir(dir);
});
api.onSettings?.((settings) => applySettingsState(settings));
void syncSettingsFromTray();
api.onOpenSettings?.(() => {
  if (typeof api.openTraySettings === 'function') {
    void api.openTraySettings();
    return;
  }
  openSettingsModal();
});
api.onOpenScreenshotHistory?.(() => {
  void openScreenshotHistoryModal();
});
api.onScreenshotHistoryChanged?.(() => {
  if (ssHistoryModal && !ssHistoryModal.hidden) void refreshScreenshotHistoryList();
});
api.onPersistLogs((enabled) => syncPersistLogsUi(enabled));
api.onMaximized((v) => syncMaximizedUi(v));
api.onProjects((state) => {
  void applyProjectsState(state);
});

ensureSystemSession();
renderLogUi();
renderProjects();
renderScripts();

/** 仅日志（及输入框）可选中；禁止把选中文案拖到外面 */
function isTextSelectAllowed(target) {
  return (
    target instanceof Element &&
    !!(target.closest('pre.log') || target.closest('input, textarea'))
  );
}

document.addEventListener(
  'selectstart',
  (e) => {
    if (!isTextSelectAllowed(e.target)) e.preventDefault();
  },
  true,
);

document.addEventListener(
  'dragstart',
  (e) => {
    e.preventDefault();
  },
  true,
);

document.addEventListener(
  'pointerdown',
  (e) => {
    if (e.button !== 0) return;
    const log = e.target instanceof Element ? e.target.closest('pre.log') : null;
    if (!log) return;
    try {
      log.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  },
  true,
);

(async () => {
  if (!api) return;
  try {
    syncPersistLogsUi(await api.getPersistLogs());
  } catch {
    /* ignore */
  }
  try {
    syncMaximizedUi(await api.windowIsMaximized());
  } catch {
    /* ignore */
  }
  try {
    setJobs(await api.getJobs());
  } catch {
    /* ignore */
  }
  try {
    await applyProjectsState(await api.getProjects());
  } catch {
    /* ignore */
  }
})();
