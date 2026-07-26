import { clamp } from './pointerDrag.ts';

export type TMdViewMode = 'source' | 'split' | 'preview';
export type TLeftTool = 'files' | 'differ';

export type TLayoutSizes = {
  /** Dev (left) zone width as % of body when both zones open. */
  reviewPct: number;
  treeWidth: number;
  docsTreeWidth: number;
  agentHeight: number;
  /** MD split: source pane % */
  mdSourcePct: number;
  outlineWidth: number;
  /** Dev Files/Differ sidebar visible */
  reviewSidebarOpen: boolean;
  /** Design Docs tree visible */
  docsOpen: boolean;
  /** Left 开发 zone visible */
  devOpen: boolean;
  /** Right 设计 zone visible */
  designOpen: boolean;
  /** Shell panel height (px) */
  shellHeight: number;
  /** Design Agent panel open */
  agentsOpen: boolean;
  /** Design MD view mode */
  mdViewMode: TMdViewMode;
  /** Dev active tool */
  leftTool: TLeftTool;
};

export const DEFAULT_LAYOUT: TLayoutSizes = {
  reviewPct: 50,
  treeWidth: 260,
  docsTreeWidth: 240,
  agentHeight: 160,
  mdSourcePct: 50,
  outlineWidth: 200,
  reviewSidebarOpen: true,
  docsOpen: true,
  devOpen: true,
  designOpen: true,
  shellHeight: 220,
  agentsOpen: true,
  mdViewMode: 'split',
  leftTool: 'files',
};

const KEY = 'code-editor.layout.v1';

function normalizeMdMode(v: unknown): TMdViewMode {
  if (v === 'source' || v === 'split' || v === 'preview') return v;
  return 'split';
}

function normalizeLeftTool(v: unknown): TLeftTool {
  if (v === 'files' || v === 'differ') return v;
  return 'files';
}

export function loadLayout(): TLayoutSizes {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_LAYOUT };
    const o = JSON.parse(raw) as Partial<TLayoutSizes>;
    return normalizeLayout({ ...DEFAULT_LAYOUT, ...o });
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export function saveLayout(layout: TLayoutSizes): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(normalizeLayout(layout)));
  } catch {
    /* ignore quota */
  }
}

export function normalizeLayout(l: TLayoutSizes): TLayoutSizes {
  let devOpen = l.devOpen !== false;
  let designOpen = l.designOpen !== false;
  if (!devOpen && !designOpen) {
    devOpen = true;
    designOpen = true;
  }
  return {
    reviewPct: clamp(l.reviewPct, 22, 78),
    treeWidth: clamp(l.treeWidth, 160, 560),
    docsTreeWidth: clamp(l.docsTreeWidth, 140, 480),
    agentHeight: clamp(l.agentHeight, 100, 480),
    mdSourcePct: clamp(l.mdSourcePct, 20, 80),
    outlineWidth: clamp(l.outlineWidth, 120, 360),
    reviewSidebarOpen: l.reviewSidebarOpen !== false,
    docsOpen: l.docsOpen !== false,
    devOpen,
    designOpen,
    shellHeight: clamp(l.shellHeight, 120, 560),
    agentsOpen: l.agentsOpen !== false,
    mdViewMode: normalizeMdMode(l.mdViewMode),
    leftTool: normalizeLeftTool(l.leftTool),
  };
}
