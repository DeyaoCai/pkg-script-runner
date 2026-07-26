import type { App, Directive, DirectiveBinding } from 'vue';

type TTipState = {
  text: string;
  onEnter: () => void;
  onLeave: () => void;
};

const states = new WeakMap<HTMLElement, TTipState>();

let tipEl: HTMLDivElement | null = null;
let showTimer: ReturnType<typeof setTimeout> | null = null;
let activeAnchor: HTMLElement | null = null;

const SHOW_DELAY_MS = 380;
const GAP = 8;

function ensureTip(): HTMLDivElement {
  if (tipEl) return tipEl;
  tipEl = document.createElement('div');
  tipEl.className = 'pkg-tooltip';
  tipEl.setAttribute('role', 'tooltip');
  document.body.appendChild(tipEl);
  return tipEl;
}

function clearShowTimer(): void {
  if (showTimer) {
    clearTimeout(showTimer);
    showTimer = null;
  }
}

function hideTip(): void {
  clearShowTimer();
  activeAnchor = null;
  if (!tipEl) return;
  tipEl.classList.remove('is-visible');
  tipEl.textContent = '';
}

function placeTip(anchor: HTMLElement): void {
  const el = ensureTip();
  const rect = anchor.getBoundingClientRect();
  const tipRect = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const need = tipRect.height + GAP;

  // horizontal: center on anchor, clamp into viewport
  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  left = Math.max(GAP, Math.min(left, vw - tipRect.width - GAP));

  // vertical: prefer above; flip below when not enough room
  const spaceAbove = rect.top - GAP;
  const spaceBelow = vh - rect.bottom - GAP;
  let place: 'above' | 'below' = 'above';
  let top = rect.top - tipRect.height - GAP;

  if (spaceAbove < need) {
    if (spaceBelow >= need || spaceBelow > spaceAbove) {
      place = 'below';
      top = rect.bottom + GAP;
    }
  }

  top = Math.max(GAP, Math.min(top, vh - tipRect.height - GAP));

  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
  el.dataset.place = place;
}

function showTip(anchor: HTMLElement, text: string): void {
  const el = ensureTip();
  el.textContent = text;
  el.classList.add('is-visible');
  activeAnchor = anchor;
  requestAnimationFrame(() => placeTip(anchor));
}

function scheduleShow(anchor: HTMLElement, text: string): void {
  clearShowTimer();
  if (!text.trim()) return;
  showTimer = setTimeout(() => showTip(anchor, text), SHOW_DELAY_MS);
}

function readText(binding: DirectiveBinding<string | null | undefined>): string {
  const v = binding.value;
  if (v == null) return '';
  return String(v).trim();
}

function bind(el: HTMLElement, binding: DirectiveBinding<string | null | undefined>): void {
  unbind(el);
  const state: TTipState = {
    text: readText(binding),
    onEnter: () => {
      const s = states.get(el);
      if (!s?.text) return;
      scheduleShow(el, s.text);
    },
    onLeave: () => {
      hideTip();
    },
  };
  states.set(el, state);
  el.addEventListener('pointerenter', state.onEnter);
  el.addEventListener('pointerleave', state.onLeave);
  el.addEventListener('pointerdown', state.onLeave);
}

function unbind(el: HTMLElement): void {
  const state = states.get(el);
  if (!state) return;
  el.removeEventListener('pointerenter', state.onEnter);
  el.removeEventListener('pointerleave', state.onLeave);
  el.removeEventListener('pointerdown', state.onLeave);
  states.delete(el);
  if (activeAnchor === el) hideTip();
}

export const vTip: Directive<HTMLElement, string | null | undefined> = {
  mounted(el, binding) {
    bind(el, binding);
  },
  updated(el, binding) {
    const state = states.get(el);
    const text = readText(binding);
    if (!state) {
      bind(el, binding);
      return;
    }
    state.text = text;
    if (activeAnchor === el) {
      if (!text) hideTip();
      else {
        ensureTip().textContent = text;
        placeTip(el);
      }
    }
  },
  unmounted(el) {
    unbind(el);
  },
};

export function installTip(app: App): void {
  app.directive('tip', vTip);
}
