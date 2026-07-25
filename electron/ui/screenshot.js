/* global ssApi */
const api = window.ssApi;

const baseCanvas = document.getElementById('base');
const drawCanvas = document.getElementById('draw');
const baseCtx = baseCanvas.getContext('2d');
const drawCtx = drawCanvas.getContext('2d');
const selectMask = document.getElementById('selectMask');
const selectBox = document.getElementById('selectBox');
const hint = document.getElementById('hint');
const toolbar = document.getElementById('toolbar');
const side = document.getElementById('side');
const pinList = document.getElementById('pinList');
const undoBtn = document.getElementById('undoBtn');
const doneBtn = document.getElementById('doneBtn');
const cancelBtn = document.getElementById('cancelBtn');
const pickTip = document.getElementById('pickTip');
const pickSwatch = document.getElementById('pickSwatch');
const pickHexLabel = document.getElementById('pickHexLabel');
const pickDot = document.getElementById('pickDot');
const colorInput = document.getElementById('colorInput');
const colorHex = document.getElementById('colorHex');

/**
 * select  — 尚未确认选区，拖拽新建
 * ready   — 已有选区，可标注 / 抓手移选区 / 点选区外重框选
 */
/** @type {'select' | 'ready'} */
let phase = 'select';
/** @type {'rect' | 'pen' | 'pin' | 'move' | 'pick'} */
let tool = 'move';

let fullImg = null;
let fullW = 0;
let fullH = 0;
/** CSS 像素下的显示尺寸（与窗口一致） */
let viewW = 0;
let viewH = 0;

/** 选区（CSS / 画布显示坐标） */
let region = null; // { x, y, w, h }

let selecting = false;
let selStart = null;

/**
 * 标注坐标均为选区内相对坐标；color 为绘制色
 * @type {Array<{type:'rect', x:number,y:number,w:number,h:number,color:string} | {type:'pen', points:Array<{x:number,y:number}>,color:string} | {type:'pin', x:number,y:number, n:number,color:string}>}
 */
let shapes = [];
/** @type {string[]} */
let captions = [];

let drawing = false;
let draft = null;

/** 抓手：移动整个选区 */
let movingRegion = false;
let moveOrigin = null;

/** 拖拽手柄：调整选区大小 */
let resizingRegion = false;
/** @type {null | { dir: string, x: number, y: number, ox: number, oy: number, ow: number, oh: number }} */
let resizeOrigin = null;
const MIN_REGION = 4;
/** 句柄 / 边吸附阈值（CSS px） */
const SNAP_PX = 10;
/** 吸附工具开关（默认关；工具栏按钮 / S 切换） */
let snapEnabled = false;
/** @type {number[]} */
let snapXs = [0];
/** @type {number[]} */
let snapYs = [0];
/** @type {{ xs: number[], ys: number[] } | null} */
let lastSnapGuides = null;
const snapBtn = document.getElementById('snapBtn');

function setSnapGuides(guides) {
  lastSnapGuides = guides && typeof guides === 'object' ? guides : null;
  const xs = Array.isArray(guides?.xs) ? guides.xs.map(Number).filter(Number.isFinite) : [];
  const ys = Array.isArray(guides?.ys) ? guides.ys.map(Number).filter(Number.isFinite) : [];
  const uniq = (arr) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const out = [];
    for (const n of sorted) {
      if (out.length && Math.abs(out[out.length - 1] - n) <= 0.5) continue;
      out.push(n);
    }
    return out;
  };
  snapXs = uniq([0, viewW, ...xs].filter((n) => n >= -0.5 && n <= viewW + 0.5));
  snapYs = uniq([0, viewH, ...ys].filter((n) => n >= -0.5 && n <= viewH + 0.5));
  if (snapXs.length < 2) snapXs = [0, Math.max(0, viewW)];
  if (snapYs.length < 2) snapYs = [0, Math.max(0, viewH)];
}


/** 当前绘制 / 拾色结果 */
let drawColor = '#3d8bfd';
/** 离屏图，用于精确取色 */
let sampleCanvas = null;
let sampleCtx = null;

function normalizeHex(hex) {
  const h = String(hex || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(h)) return h.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(h)) {
    return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`.toUpperCase();
  }
  return '#3D8BFD';
}

function setDrawColor(hex, opts = {}) {
  drawColor = normalizeHex(hex);
  document.documentElement.style.setProperty('--draw-color', drawColor);
  if (pickDot) pickDot.style.background = drawColor;
  if (toolbar) toolbar.style.setProperty('--draw-color', drawColor);
  if (colorInput) colorInput.value = drawColor;
  if (colorHex) colorHex.textContent = drawColor;
  if (opts.copy) {
    try {
      void navigator.clipboard.writeText(drawColor);
    } catch {
      /* ignore */
    }
  }
  if (opts.persist !== false && api && typeof api.setDrawColor === 'function') {
    clearTimeout(persistColorTimer);
    persistColorTimer = setTimeout(() => {
      void api.setDrawColor(drawColor);
    }, 120);
  }
}

/** @type {ReturnType<typeof setTimeout> | null} */
let persistColorTimer = null;

function contrastText(hex) {
  const h = normalizeHex(hex).slice(1);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const y = (r * 299 + g * 587 + b * 114) / 1000;
  return y >= 140 ? '#111' : '#fff';
}

function ensureSampleCanvas() {
  if (!fullImg || sampleCanvas) return;
  sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = fullW;
  sampleCanvas.height = fullH;
  sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  sampleCtx.drawImage(fullImg, 0, 0);
}

function sampleColorAtCss(cssX, cssY) {
  ensureSampleCanvas();
  if (!sampleCtx) return drawColor;
  const ix = Math.min(fullW - 1, Math.max(0, Math.floor((cssX / viewW) * fullW)));
  const iy = Math.min(fullH - 1, Math.max(0, Math.floor((cssY / viewH) * fullH)));
  const d = sampleCtx.getImageData(ix, iy, 1, 1).data;
  const hex =
    '#' +
    [d[0], d[1], d[2]]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  return hex;
}

function showPickTip(cssX, cssY, hex) {
  if (!pickTip) return;
  pickTip.hidden = false;
  if (pickSwatch) pickSwatch.style.background = hex;
  if (pickHexLabel) pickHexLabel.textContent = hex;
  const pad = 12;
  let left = cssX + 16;
  let top = cssY + 16;
  const tw = pickTip.offsetWidth || 120;
  const th = pickTip.offsetHeight || 32;
  if (left + tw > window.innerWidth - pad) left = cssX - tw - 12;
  if (top + th > window.innerHeight - pad) top = cssY - th - 12;
  pickTip.style.left = `${Math.round(left)}px`;
  pickTip.style.top = `${Math.round(top)}px`;
}

function hidePickTip() {
  if (pickTip) pickTip.hidden = true;
}

function setSnapEnabled(on, opts = {}) {
  snapEnabled = !!on;
  if (snapBtn) {
    snapBtn.setAttribute('aria-pressed', snapEnabled ? 'true' : 'false');
    snapBtn.classList.toggle('is-active', snapEnabled);
    snapBtn.title = snapEnabled
      ? '吸附：已开启（S 关闭）'
      : '吸附：对齐屏幕/窗口边缘（S）';
  }
  document.body.classList.toggle('is-snap', snapEnabled);
  if (opts.hint !== false) updateHint();
}

function setTool(next) {
  if (
    next !== 'rect' &&
    next !== 'pen' &&
    next !== 'pin' &&
    next !== 'move' &&
    next !== 'pick'
  ) {
    return;
  }
  tool = next;
  for (const btn of document.querySelectorAll('.ss-tool[data-tool]')) {
    btn.classList.toggle('is-active', btn.dataset.tool === tool);
  }
  drawing = false;
  draft = null;
  movingRegion = false;
  moveOrigin = null;
  resizingRegion = false;
  resizeOrigin = null;
  document.body.classList.toggle('is-move', tool === 'move');
  document.body.classList.toggle('is-pick', tool === 'pick');
  document.body.classList.remove('is-moving', 'is-resizing');
  if (tool !== 'pick') hidePickTip();
  redrawAll();
  updateHint();
}

function updateHint() {
  const snapHint = snapEnabled ? '吸附开' : 'S 吸附';
  if (phase === 'select') {
    hint.textContent = `拖选截取区域 · ${snapHint} · Esc 取消`;
    return;
  }
  if (tool === 'move') {
    hint.textContent = snapEnabled
      ? '抓手：拖动移动选区（近边吸附）· 拖角/边调整大小 · 选区外单击可重新框选'
      : '抓手：拖动移动选区 · 拖角/边调整大小 · 点吸附工具或按 S 开启边缘对齐';
  } else if (tool === 'pick') {
    hint.textContent = '拾色器：点击取色并复制色值 · 将作为后续绘制颜色';
  } else if (tool === 'pen') {
    hint.textContent = '画笔（选区内）· 角/边可调选区 · 选区外单击重新框选';
  } else if (tool === 'pin') {
    hint.textContent = '标记点（选区内）· 角/边可调选区 · 选区外单击重新框选';
  } else {
    hint.textContent = '画框（选区内）· 角/边可调选区 · 选区外单击重新框选';
  }
}

function isUiTarget(target) {
  return (
    target instanceof Element &&
    !!target.closest(
      '.ss-toolbar, .ss-side, .ss-tool, .ss-btn, .ss-color, .ss-handle, textarea, input, button',
    )
  );
}

function handleDirFromTarget(target) {
  if (!(target instanceof Element)) return null;
  const el = target.closest('.ss-handle');
  const dir = el?.getAttribute('data-dir');
  return dir || null;
}

/** 吸附到最近目标；未开启吸附工具或无命中则原值 */
function snapTo(v, targets, threshold = SNAP_PX) {
  if (!snapEnabled) return v;
  let best = v;
  let bestDist = threshold + 1;
  for (const t of targets) {
    const d = Math.abs(v - t);
    if (d <= threshold && d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return best;
}

function snapTargetsX() {
  return snapXs.length ? snapXs : [0, viewW];
}

function snapTargetsY() {
  return snapYs.length ? snapYs : [0, viewH];
}

/** 移动选区时：优先吸附正在靠近的边到屏幕/窗口边缘 */
function snapRegionEdges() {
  if (!region || viewW <= 0 || viewH <= 0) return;
  let { x, y, w, h } = region;
  const xs = snapTargetsX();
  const ys = snapTargetsY();

  const left = x;
  const right = x + w;
  const snapL = snapTo(left, xs);
  const snapR = snapTo(right, xs);
  const dL = Math.abs(snapL - left);
  const dR = Math.abs(snapR - right);
  if (dL <= SNAP_PX || dR <= SNAP_PX) {
    if (dL <= dR) x = snapL;
    else x = snapR - w;
  }

  const top = y;
  const bottom = y + h;
  const snapT = snapTo(top, ys);
  const snapB = snapTo(bottom, ys);
  const dT = Math.abs(snapT - top);
  const dB = Math.abs(snapB - bottom);
  if (dT <= SNAP_PX || dB <= SNAP_PX) {
    if (dT <= dB) y = snapT;
    else y = snapB - h;
  }

  region.x = x;
  region.y = y;
}

/** 框选终点吸附 */
function snapDraftSelectPoint(x, y) {
  return {
    x: snapTo(x, snapTargetsX()),
    y: snapTo(y, snapTargetsY()),
  };
}

/** 左上角移动时，标注相对坐标跟着平移，避免内容相对屏幕跳动 */
function shiftAnnotations(dx, dy) {
  if (!dx && !dy) return;
  for (const s of shapes) {
    if (s.type === 'rect') {
      s.x -= dx;
      s.y -= dy;
    } else if (s.type === 'pen') {
      for (const p of s.points) {
        p.x -= dx;
        p.y -= dy;
      }
    } else if (s.type === 'pin') {
      s.x -= dx;
      s.y -= dy;
    }
  }
  if (draft) {
    if (draft.type === 'rect') {
      draft.x -= dx;
      draft.y -= dy;
      if (draft.x0 != null) draft.x0 -= dx;
      if (draft.y0 != null) draft.y0 -= dy;
    } else if (draft.type === 'pen' && Array.isArray(draft.points)) {
      for (const p of draft.points) {
        p.x -= dx;
        p.y -= dy;
      }
    }
  }
}

function applyResizeFromPointer(cssX, cssY) {
  if (!resizeOrigin || !region) return;
  const { dir, x: sx, y: sy, ox, oy, ow, oh } = resizeOrigin;
  const dx = cssX - sx;
  const dy = cssY - sy;
  let left = ox;
  let top = oy;
  let right = ox + ow;
  let bottom = oy + oh;

  if (dir.includes('w')) left = ox + dx;
  if (dir.includes('e')) right = ox + ow + dx;
  if (dir.includes('n')) top = oy + dy;
  if (dir.includes('s')) bottom = oy + oh + dy;

  // 句柄吸附：屏幕边 + 其它窗口边
  if (dir.includes('w')) left = snapTo(left, snapTargetsX());
  if (dir.includes('e')) right = snapTo(right, snapTargetsX());
  if (dir.includes('n')) top = snapTo(top, snapTargetsY());
  if (dir.includes('s')) bottom = snapTo(bottom, snapTargetsY());

  // 对拖穿：交换边，保持正宽高
  if (left > right) {
    const t = left;
    left = right;
    right = t;
  }
  if (top > bottom) {
    const t = top;
    top = bottom;
    bottom = t;
  }

  left = Math.max(0, Math.min(left, viewW - MIN_REGION));
  top = Math.max(0, Math.min(top, viewH - MIN_REGION));
  right = Math.max(left + MIN_REGION, Math.min(right, viewW));
  bottom = Math.max(top + MIN_REGION, Math.min(bottom, viewH));

  const next = {
    x: left,
    y: top,
    w: right - left,
    h: bottom - top,
  };
  const shiftX = next.x - region.x;
  const shiftY = next.y - region.y;
  region = next;
  if (shiftX || shiftY) shiftAnnotations(shiftX, shiftY);
}

function cssToImage(x, y) {
  return {
    x: (x / viewW) * fullW,
    y: (y / viewH) * fullH,
  };
}

function pointInRegion(cssX, cssY) {
  if (!region) return false;
  return (
    cssX >= region.x &&
    cssX <= region.x + region.w &&
    cssY >= region.y &&
    cssY <= region.y + region.h
  );
}

function toLocal(cssX, cssY) {
  return { x: cssX - region.x, y: cssY - region.y };
}

function syncSelectChrome() {
  if (!region) {
    selectBox.hidden = true;
    selectMask.hidden = true;
    selectBox.classList.remove('is-adjustable');
    return;
  }
  const { x, y, w, h } = region;
  selectBox.hidden = false;
  selectMask.hidden = false;
  selectBox.classList.toggle('is-adjustable', phase === 'ready');
  selectBox.style.left = `${x}px`;
  selectBox.style.top = `${y}px`;
  selectBox.style.width = `${w}px`;
  selectBox.style.height = `${h}px`;
  selectMask.style.clipPath = `polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${x}px ${y}px, ${x}px ${y + h}px, ${x + w}px ${y + h}px, ${x + w}px ${y}px, ${x}px ${y}px)`;
}

function redrawBase() {
  baseCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
  if (fullImg) baseCtx.drawImage(fullImg, 0, 0, fullW, fullH, 0, 0, viewW, viewH);
}

function redrawOverlay() {
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  if (!region) return;

  const ox = region.x;
  const oy = region.y;
  drawCtx.save();
  drawCtx.beginPath();
  drawCtx.rect(ox, oy, region.w, region.h);
  drawCtx.clip();

  drawCtx.lineJoin = 'round';
  drawCtx.lineCap = 'round';

  const paint = (s) => {
    const color = s.color || drawColor;
    if (s.type === 'rect') {
      drawCtx.strokeStyle = color;
      drawCtx.lineWidth = 3;
      drawCtx.strokeRect(ox + s.x + 0.5, oy + s.y + 0.5, s.w, s.h);
    } else if (s.type === 'pen') {
      if (s.points.length < 2) return;
      drawCtx.strokeStyle = color;
      drawCtx.lineWidth = 3;
      drawCtx.beginPath();
      drawCtx.moveTo(ox + s.points[0].x, oy + s.points[0].y);
      for (let i = 1; i < s.points.length; i++) {
        drawCtx.lineTo(ox + s.points[i].x, oy + s.points[i].y);
      }
      drawCtx.stroke();
    } else if (s.type === 'pin') {
      const r = 12;
      drawCtx.fillStyle = color;
      drawCtx.beginPath();
      drawCtx.arc(ox + s.x, oy + s.y, r, 0, Math.PI * 2);
      drawCtx.fill();
      drawCtx.fillStyle = contrastText(color);
      drawCtx.font = 'bold 12px sans-serif';
      drawCtx.textAlign = 'center';
      drawCtx.textBaseline = 'middle';
      drawCtx.fillText(String(s.n), ox + s.x, oy + s.y + 0.5);
    }
  };

  for (const s of shapes) paint(s);

  if (draft) {
    const color = draft.color || drawColor;
    if (draft.type === 'rect') {
      drawCtx.strokeStyle = color;
      drawCtx.lineWidth = 3;
      drawCtx.setLineDash([6, 4]);
      drawCtx.strokeRect(ox + draft.x + 0.5, oy + draft.y + 0.5, draft.w, draft.h);
      drawCtx.setLineDash([]);
    } else if (draft.type === 'pen' && draft.points.length > 1) {
      drawCtx.strokeStyle = color;
      drawCtx.lineWidth = 3;
      drawCtx.beginPath();
      drawCtx.moveTo(ox + draft.points[0].x, oy + draft.points[0].y);
      for (let i = 1; i < draft.points.length; i++) {
        drawCtx.lineTo(ox + draft.points[i].x, oy + draft.points[i].y);
      }
      drawCtx.stroke();
    }
  }

  drawCtx.restore();
}

function redrawAll() {
  redrawBase();
  redrawOverlay();
  syncSelectChrome();
}

function renumberPins() {
  let n = 0;
  for (const s of shapes) {
    if (s.type === 'pin') {
      n += 1;
      s.n = n;
    }
  }
  const nextCaptions = [];
  for (let i = 0; i < n; i++) nextCaptions[i] = captions[i] || '';
  captions = nextCaptions;
  renderPinList();
}

function removePinAt(index) {
  const pins = shapes.filter((s) => s.type === 'pin');
  const target = pins[index];
  if (!target) return;
  const idx = shapes.indexOf(target);
  if (idx >= 0) shapes.splice(idx, 1);
  captions.splice(index, 1);
  renumberPins();
  redrawOverlay();
}

function renderPinList() {
  const pins = shapes.filter((s) => s.type === 'pin');
  side.hidden = pins.length === 0;
  if (!side.hidden) side.style.display = 'flex';
  pinList.replaceChildren();
  pins.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'ss-pin-item';
    const no = document.createElement('div');
    no.className = 'ss-pin-no';
    no.textContent = String(p.n);
    const ta = document.createElement('textarea');
    ta.placeholder = `标记 ${p.n} 说明…`;
    ta.value = captions[i] || '';
    ta.addEventListener('input', () => {
      captions[i] = ta.value;
    });
    ta.addEventListener('pointerdown', (e) => e.stopPropagation());
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'ss-pin-del';
    del.title = '删除此标记';
    del.textContent = '删';
    del.addEventListener('pointerdown', (e) => e.stopPropagation());
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      removePinAt(i);
    });
    row.append(no, ta, del);
    pinList.appendChild(row);
  });
  positionToolbarNearRegion();
}

function positionToolbarNearRegion() {
  if (phase !== 'ready' || toolbar.hidden || !region) return;
  toolbar.style.display = 'flex';
  const gap = 10;
  const pad = 8;
  const tw = toolbar.offsetWidth || 380;
  const th = toolbar.offsetHeight || 44;
  const crop = {
    left: region.x,
    top: region.y,
    width: region.w,
    height: region.h,
    right: region.x + region.w,
    bottom: region.y + region.h,
  };

  const clamp = (left, top) => ({
    left: Math.max(pad, Math.min(left, window.innerWidth - tw - pad)),
    top: Math.max(pad, Math.min(top, window.innerHeight - th - pad)),
  });

  const overlaps = (left, top, rect) =>
    !(
      left + tw <= rect.left ||
      left >= rect.right ||
      top + th <= rect.top ||
      top >= rect.bottom
    );

  const candidates = [
    { left: crop.left + (crop.width - tw) / 2, top: crop.bottom + gap },
    { left: crop.left + (crop.width - tw) / 2, top: crop.top - th - gap },
    { left: crop.right + gap, top: crop.top + (crop.height - th) / 2 },
    { left: crop.left - tw - gap, top: crop.top + (crop.height - th) / 2 },
    { left: crop.left, top: crop.bottom + gap },
    { left: crop.right - tw, top: crop.bottom + gap },
  ];

  const sideRect =
    !side.hidden && side.offsetParent ? side.getBoundingClientRect() : null;

  let chosen = null;
  for (const c of candidates) {
    const p = clamp(c.left, c.top);
    const fits =
      p.top >= pad &&
      p.top + th <= window.innerHeight - pad &&
      p.left >= pad &&
      p.left + tw <= window.innerWidth - pad;
    if (!fits) continue;
    if (sideRect && overlaps(p.left, p.top, sideRect)) continue;
    chosen = p;
    break;
  }
  if (!chosen) {
    chosen = clamp(crop.left + (crop.width - tw) / 2, crop.bottom + gap);
    if (sideRect && overlaps(chosen.left, chosen.top, sideRect)) {
      chosen.left = Math.max(pad, sideRect.left - tw - gap);
    }
  }

  toolbar.style.left = `${Math.round(chosen.left)}px`;
  toolbar.style.top = `${Math.round(chosen.top)}px`;
  toolbar.style.right = 'auto';
  toolbar.style.bottom = 'auto';
  toolbar.style.transform = 'none';
}

function syncToolbarPhase() {
  document.body.classList.toggle('is-phase-select', phase === 'select');
  document.body.classList.toggle('is-phase-ready', phase === 'ready');
  if (!toolbar) return;
  if (phase === 'select') {
    toolbar.hidden = false;
    toolbar.style.display = 'flex';
    toolbar.style.left = '8px';
    toolbar.style.top = '8px';
    toolbar.style.right = 'auto';
    toolbar.style.bottom = 'auto';
    toolbar.style.transform = 'none';
    if (side) side.hidden = true;
  }
}

function showToolbar() {
  syncToolbarPhase();
  toolbar.hidden = false;
  toolbar.style.display = 'flex';
  toolbar.style.left = '8px';
  toolbar.style.top = '8px';
  requestAnimationFrame(() => positionToolbarNearRegion());
}

function hideToolbar() {
  toolbar.hidden = true;
  side.hidden = true;
  document.body.classList.remove('is-phase-select', 'is-phase-ready');
}

function clearAnnotations() {
  shapes = [];
  captions = [];
  draft = null;
  drawing = false;
  renderPinList();
}

function enterReady(nextRegion) {
  region = {
    x: nextRegion.x,
    y: nextRegion.y,
    w: nextRegion.w,
    h: nextRegion.h,
  };
  clampRegion();
  phase = 'ready';
  clearAnnotations();
  setTool('move');
  showToolbar();
  redrawAll();
  updateHint();
}

function resetToSelect() {
  phase = 'select';
  region = null;
  clearAnnotations();
  syncToolbarPhase();
  movingRegion = false;
  moveOrigin = null;
  resizingRegion = false;
  resizeOrigin = null;
  hidePickTip();
  document.body.classList.remove('is-move', 'is-moving', 'is-pick', 'is-resizing');
  redrawAll();
  updateHint();
}

function clampRegion() {
  if (!region) return;
  region.w = Math.max(MIN_REGION, Math.min(region.w, viewW));
  region.h = Math.max(MIN_REGION, Math.min(region.h, viewH));
  region.x = Math.min(Math.max(0, region.x), viewW - region.w);
  region.y = Math.min(Math.max(0, region.y), viewH - region.h);
}

function layoutCanvases() {
  viewW = window.innerWidth;
  viewH = window.innerHeight;
  for (const c of [baseCanvas, drawCanvas]) {
    c.width = viewW;
    c.height = viewH;
    c.style.left = '0';
    c.style.top = '0';
    c.style.width = '100%';
    c.style.height = '100%';
    c.style.display = 'block';
  }
  // view 尺寸变化后重建吸附线（含屏边）
  setSnapGuides(lastSnapGuides);
  if (region) clampRegion();
  redrawAll();
  if (phase === 'ready') positionToolbarNearRegion();
}

function exportPngCanvas() {
  if (!region || !fullImg) return null;
  const tl = cssToImage(region.x, region.y);
  const br = cssToImage(region.x + region.w, region.y + region.h);
  const sx = Math.round(tl.x);
  const sy = Math.round(tl.y);
  const sw = Math.max(1, Math.round(br.x - tl.x));
  const sh = Math.max(1, Math.round(br.y - tl.y));

  const scaleX = sw / region.w;
  const scaleY = sh / region.h;

  const out = document.createElement('canvas');
  out.width = sw;
  out.height = sh;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(fullImg, sx, sy, sw, sh, 0, 0, sw, sh);

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const s of shapes) {
    const color = s.color || drawColor;
    if (s.type === 'rect') {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, 3 * scaleX);
      ctx.strokeRect(s.x * scaleX, s.y * scaleY, s.w * scaleX, s.h * scaleY);
    } else if (s.type === 'pen' && s.points.length > 1) {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, 3 * scaleX);
      ctx.beginPath();
      ctx.moveTo(s.points[0].x * scaleX, s.points[0].y * scaleY);
      for (let i = 1; i < s.points.length; i++) {
        ctx.lineTo(s.points[i].x * scaleX, s.points[i].y * scaleY);
      }
      ctx.stroke();
    } else if (s.type === 'pin') {
      const r = Math.max(10, 12 * scaleX);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(s.x * scaleX, s.y * scaleY, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = contrastText(color);
      ctx.font = `bold ${Math.max(10, Math.round(12 * scaleX))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(s.n), s.x * scaleX, s.y * scaleY + 0.5);
    }
  }
  return out;
}

function canvasToPngBytes(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('导出 PNG 失败'));
          return;
        }
        void blob.arrayBuffer().then(
          (ab) => resolve(new Uint8Array(ab)),
          reject,
        );
      },
      'image/png',
    );
  });
}

/** 防止完成按钮连点 */
let finishing = false;
/** 取消渐隐中 */
let dismissing = false;

async function requestCancel() {
  if (finishing || dismissing) return;
  dismissing = true;
  document.body.classList.add('is-dismissing');
  try {
    await api.cancel();
  } catch (err) {
    document.body.classList.remove('is-dismissing');
    dismissing = false;
    hint.textContent = err instanceof Error ? err.message : String(err);
  }
}

async function finish() {
  if (finishing || dismissing) return;
  if (!region) {
    hint.textContent = '请先拖选截取区域';
    return;
  }
  if (!api || typeof api.completePng !== 'function') {
    hint.textContent = '截屏桥接未就绪，请重启应用后再试';
    return;
  }

  finishing = true;
  try {
    doneBtn.disabled = true;
    hint.textContent = '正在导出图片…';
    const canvas = exportPngCanvas();
    if (!canvas) {
      hint.textContent = '导出图片失败';
      doneBtn.disabled = false;
      finishing = false;
      return;
    }
    const bytes = await canvasToPngBytes(canvas);
    const pins = shapes.filter((s) => s.type === 'pin');
    const caps = pins.map((_, i) => captions[i] || '');

    hint.textContent = `正在保存… ${Math.max(1, Math.round(bytes.length / 1024))}KB`;
    const res = await api.completePng(bytes, caps);
    if (!res?.ok) {
      hint.textContent = res?.error || '保存失败';
      doneBtn.disabled = false;
      finishing = false;
    }
  } catch (err) {
    hint.textContent = err instanceof Error ? err.message : String(err);
    doneBtn.disabled = false;
    finishing = false;
  }
}

function undo() {
  if (!shapes.length) return;
  const last = shapes.pop();
  if (last?.type === 'pin') renumberPins();
  else {
    redrawOverlay();
    renderPinList();
  }
}

function onPointerDown(e) {
  if (e.button !== 0) return;

  const handleDir = handleDirFromTarget(e.target);
  // 手柄：任意标注工具下均可拖拽调选区（优先于 isUiTarget）
  if (phase === 'ready' && region && handleDir) {
    e.preventDefault();
    e.stopPropagation();
    resizingRegion = true;
    resizeOrigin = {
      dir: handleDir,
      x: e.clientX,
      y: e.clientY,
      ox: region.x,
      oy: region.y,
      ow: region.w,
      oh: region.h,
    };
    document.body.classList.add('is-resizing');
    document.body.style.cursor =
      getComputedStyle(/** @type {Element} */ (e.target.closest('.ss-handle'))).cursor ||
      'nwse-resize';
    try {
      drawCanvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    return;
  }

  if (isUiTarget(e.target)) return;

  const x = e.clientX;
  const y = e.clientY;

  // 拾色器：整屏可点（含选区外）
  if (phase === 'ready' && tool === 'pick') {
    const hex = sampleColorAtCss(x, y);
    setDrawColor(hex, { copy: true });
    showPickTip(x, y, hex);
    hint.textContent = `已取色 ${hex}（已复制）`;
    return;
  }

  // 已有选区：点选区外 → 重新框选
  if (phase === 'ready' && region && !pointInRegion(x, y)) {
    resetToSelect();
    selecting = true;
    const p = snapDraftSelectPoint(x, y);
    selStart = { x: p.x, y: p.y };
    draftSelect = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    syncDraftSelect();
    return;
  }

  if (phase === 'select') {
    selecting = true;
    const p = snapDraftSelectPoint(x, y);
    selStart = { x: p.x, y: p.y };
    draftSelect = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    syncDraftSelect();
    return;
  }

  // ready + 选区内
  if (!region || !pointInRegion(x, y)) return;

  const local = toLocal(x, y);

  if (tool === 'move') {
    movingRegion = true;
    moveOrigin = { x, y, ox: region.x, oy: region.y };
    document.body.classList.add('is-moving');
    try {
      drawCanvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    return;
  }

  if (tool === 'pin') {
    const n = shapes.filter((s) => s.type === 'pin').length + 1;
    shapes.push({ type: 'pin', x: local.x, y: local.y, n, color: drawColor });
    captions.push('');
    redrawOverlay();
    renderPinList();
    return;
  }

  drawing = true;
  if (tool === 'rect') {
    draft = {
      type: 'rect',
      x: local.x,
      y: local.y,
      w: 0,
      h: 0,
      x0: local.x,
      y0: local.y,
      color: drawColor,
    };
  } else {
    draft = { type: 'pen', points: [local], color: drawColor };
  }
  redrawOverlay();
}

/** 框选拖拽临时态 */
let draftSelect = null;

function syncDraftSelect() {
  if (!draftSelect) {
    if (phase === 'select') {
      selectBox.hidden = true;
      selectMask.hidden = false;
      selectMask.style.clipPath = 'none';
      selectMask.style.boxShadow = 'inset 0 0 0 9999px rgba(0, 0, 0, 0.45)';
    }
    return;
  }
  const x = Math.min(draftSelect.x1, draftSelect.x2);
  const y = Math.min(draftSelect.y1, draftSelect.y2);
  const w = Math.abs(draftSelect.x2 - draftSelect.x1);
  const h = Math.abs(draftSelect.y2 - draftSelect.y1);
  selectBox.hidden = false;
  selectMask.hidden = false;
  selectBox.style.left = `${x}px`;
  selectBox.style.top = `${y}px`;
  selectBox.style.width = `${w}px`;
  selectBox.style.height = `${h}px`;
  selectMask.style.clipPath = `polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${x}px ${y}px, ${x}px ${y + h}px, ${x + w}px ${y + h}px, ${x + w}px ${y}px, ${x}px ${y}px)`;
}

function onPointerMove(e) {
  const x = e.clientX;
  const y = e.clientY;

  if (phase === 'ready' && tool === 'pick') {
    const hex = sampleColorAtCss(x, y);
    showPickTip(x, y, hex);
    return;
  }

  if (phase === 'select' && selecting && draftSelect) {
    const p = snapDraftSelectPoint(x, y);
    draftSelect = { ...draftSelect, x2: p.x, y2: p.y };
    syncDraftSelect();
    return;
  }

  if (movingRegion && moveOrigin && region) {
    region.x = moveOrigin.ox + (x - moveOrigin.x);
    region.y = moveOrigin.oy + (y - moveOrigin.y);
    snapRegionEdges();
    clampRegion();
    redrawAll();
    positionToolbarNearRegion();
    return;
  }

  if (resizingRegion && resizeOrigin && region) {
    applyResizeFromPointer(x, y);
    redrawAll();
    positionToolbarNearRegion();
    return;
  }

  if (!drawing || !draft || !region) return;
  const local = toLocal(x, y);
  const lx = Math.min(Math.max(0, local.x), region.w);
  const ly = Math.min(Math.max(0, local.y), region.h);
  if (draft.type === 'rect') {
    draft.x = Math.min(draft.x0, lx);
    draft.y = Math.min(draft.y0, ly);
    draft.w = Math.abs(lx - draft.x0);
    draft.h = Math.abs(ly - draft.y0);
  } else if (draft.type === 'pen') {
    draft.points.push({ x: lx, y: ly });
  }
  redrawOverlay();
}

function onPointerUp(e) {
  if (phase === 'select' && selecting) {
    selecting = false;
    if (draftSelect) {
      let x1 = snapTo(draftSelect.x1, snapTargetsX());
      let y1 = snapTo(draftSelect.y1, snapTargetsY());
      let x2 = snapTo(draftSelect.x2, snapTargetsX());
      let y2 = snapTo(draftSelect.y2, snapTargetsY());
      const x = Math.min(x1, x2);
      const y = Math.min(y1, y2);
      const w = Math.abs(x2 - x1);
      const h = Math.abs(y2 - y1);
      draftSelect = null;
      if (w >= 4 && h >= 4) {
        enterReady({ x, y, w, h });
      } else {
        resetToSelect();
        syncDraftSelect();
      }
    }
    return;
  }

  if (movingRegion) {
    movingRegion = false;
    moveOrigin = null;
    document.body.classList.remove('is-moving');
    clampRegion();
    redrawAll();
    positionToolbarNearRegion();
    try {
      if (e && e.pointerId != null) drawCanvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    return;
  }

  if (resizingRegion) {
    resizingRegion = false;
    resizeOrigin = null;
    document.body.classList.remove('is-resizing');
    document.body.style.cursor = '';
    clampRegion();
    redrawAll();
    positionToolbarNearRegion();
    try {
      if (e && e.pointerId != null) drawCanvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    return;
  }

  if (!drawing || !draft) return;
  drawing = false;
  if (draft.type === 'rect') {
    if (draft.w >= 3 && draft.h >= 3) {
      shapes.push({
        type: 'rect',
        x: draft.x,
        y: draft.y,
        w: draft.w,
        h: draft.h,
        color: draft.color || drawColor,
      });
    }
  } else if (draft.type === 'pen') {
    if (draft.points.length >= 2) {
      shapes.push({
        type: 'pen',
        points: draft.points,
        color: draft.color || drawColor,
      });
    }
  }
  draft = null;
  redrawOverlay();
}

window.addEventListener('pointerdown', onPointerDown);
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('pointercancel', onPointerUp);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    void requestCancel();
    return;
  }
  const tag = e.target instanceof HTMLElement ? e.target.tagName : '';
  const typing = tag === 'TEXTAREA' || tag === 'INPUT';
  if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    setSnapEnabled(!snapEnabled);
    return;
  }
  if (phase === 'ready' && e.key === 'Enter' && !e.isComposing) {
    if (typing) return;
    e.preventDefault();
    void finish();
    return;
  }
  if (phase === 'ready' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
  }
});

toolbar.addEventListener(
  'pointerdown',
  (e) => {
    // 捕获阶段拦截，避免落到 window 的框选逻辑；动作必须在这里处理，
    // 因为 stopPropagation 会导致子按钮收不到事件。
    e.stopPropagation();
    const el = e.target instanceof Element ? e.target : null;
    if (!el) return;

    if (el.closest('#doneBtn')) {
      e.preventDefault();
      void finish();
      return;
    }
    if (el.closest('#cancelBtn')) {
      e.preventDefault();
      void requestCancel();
      return;
    }
    if (el.closest('#undoBtn')) {
      e.preventDefault();
      undo();
      return;
    }
    if (el.closest('[data-action="snap"]')) {
      e.preventDefault();
      setSnapEnabled(!snapEnabled);
      return;
    }
    if (el.closest('.ss-color, input, label')) {
      return;
    }
    const t = el.closest('[data-tool]');
    if (t && t.dataset.tool) setTool(t.dataset.tool);
  },
  true,
);
toolbar.addEventListener(
  'click',
  (e) => {
    e.stopPropagation();
  },
  true,
);
side.addEventListener(
  'pointerdown',
  (e) => {
    e.stopPropagation();
  },
  true,
);

colorInput?.addEventListener('pointerdown', (e) => e.stopPropagation());
colorInput?.addEventListener('input', () => {
  setDrawColor(colorInput.value);
});
colorInput?.addEventListener('change', () => {
  setDrawColor(colorInput.value);
});

function resetCaptureUi() {
  phase = 'select';
  selecting = false;
  selStart = null;
  region = null;
  shapes = [];
  captions = [];
  drawing = false;
  draft = null;
  movingRegion = false;
  moveOrigin = null;
  resizingRegion = false;
  resizeOrigin = null;
  draftSelect = null;
  finishing = false;
  dismissing = false;
  document.body.classList.remove('is-dismissing', 'is-entering');
  setSnapEnabled(false, { hint: false });
  lastSnapGuides = null;
  snapXs = [0];
  snapYs = [0];
  sampleCanvas = null;
  sampleCtx = null;
  if (fullImg) {
    try {
      fullImg.onload = null;
      fullImg.onerror = null;
      fullImg.src = '';
    } catch {
      /* ignore */
    }
  }
  fullImg = null;
  fullW = 0;
  fullH = 0;
  if (selectBox) {
    selectBox.hidden = true;
    selectBox.style.width = '0';
    selectBox.style.height = '0';
  }
  if (selectMask) {
    selectMask.hidden = true;
    selectMask.style.clipPath = 'none';
  }
  if (toolbar) toolbar.hidden = true;
  if (side) side.hidden = true;
  document.body.classList.remove('is-phase-select', 'is-phase-ready');
  if (pinList) pinList.replaceChildren();
  if (baseCtx && baseCanvas) {
    baseCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
  }
  if (drawCtx && drawCanvas) {
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  }
  setTool('move');
  updateHint();
}

function applyCapturePayload(payload) {
  if (!payload?.fileUrl) {
    hint.textContent = '无截屏数据';
    return;
  }
  resetCaptureUi();
  document.body.classList.add('is-entering');
  document.body.classList.remove('is-dismissing');
  fullW = payload.width;
  fullH = payload.height;
  // 先记下 guides；等 layoutCanvases 有 viewW/H 后再建吸附线
  lastSnapGuides = payload.snapGuides || null;
  if (payload.drawColor) {
    setDrawColor(payload.drawColor, { persist: false });
  }
  hint.textContent = '加载截屏…';
  fullImg = new Image();
  fullImg.decoding = 'async';
  fullImg.onload = () => {
    sampleCanvas = null;
    sampleCtx = null;
    layoutCanvases();
    syncToolbarPhase();
    selectMask.hidden = false;
    selectMask.style.clipPath = 'none';
    updateHint();
    // 等一帧再通知，确保 canvas 已提交
    requestAnimationFrame(() => {
      if (typeof api.contentReady === 'function') api.contentReady();
    });
  };
  fullImg.onerror = () => {
    hint.textContent = '截屏图片加载失败';
  };
  fullImg.src = payload.fileUrl;
}

setDrawColor(drawColor, { persist: false });
setSnapEnabled(false, { hint: false });

window.addEventListener('resize', () => {
  layoutCanvases();
});

if (typeof api.onSessionStart === 'function') {
  api.onSessionStart((payload) => {
    applyCapturePayload(payload);
  });
}
if (typeof api.onAppearing === 'function') {
  api.onAppearing(() => {
    document.body.classList.remove('is-dismissing');
    // 先保证处于透明，再下一帧去掉 is-entering 触发 CSS 渐显
    document.body.classList.add('is-entering');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.body.classList.remove('is-entering');
      });
    });
  });
}
if (typeof api.onDismissing === 'function') {
  api.onDismissing(() => {
    dismissing = true;
    document.body.classList.remove('is-entering');
    document.body.classList.add('is-dismissing');
  });
}
if (typeof api.onSessionClear === 'function') {
  api.onSessionClear(() => {
    resetCaptureUi();
  });
}

(async () => {
  try {
    const payload = await api.getPayload();
    if (payload) applyCapturePayload(payload);
  } catch (err) {
    hint.textContent = err instanceof Error ? err.message : String(err);
  }
})();
