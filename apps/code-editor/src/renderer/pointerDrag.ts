/** Track pointer drag after pointerdown; returns cleanup. */
export function startPointerDrag(
  ev: PointerEvent,
  onMove: (dx: number, dy: number, e: PointerEvent) => void,
  onEnd?: () => void,
): () => void {
  const startX = ev.clientX;
  const startY = ev.clientY;
  const target = ev.currentTarget as HTMLElement | null;
  target?.setPointerCapture?.(ev.pointerId);

  const move = (e: PointerEvent) => {
    onMove(e.clientX - startX, e.clientY - startY, e);
  };
  const end = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    onEnd?.();
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  return end;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Cumulative-delta drag: snapshot base on first move of each gesture. */
export function makeDrag(
  getBase: () => number,
  apply: (base: number, dx: number, dy: number) => void,
): { onDrag: (dx: number, dy: number) => void; onEnd: () => void } {
  let base = 0;
  let started = false;
  return {
    onDrag(dx, dy) {
      if (!started) {
        base = getBase();
        started = true;
      }
      apply(base, dx, dy);
    },
    onEnd() {
      started = false;
    },
  };
}
