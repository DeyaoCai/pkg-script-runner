import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

export type TMdOutlineItem = {
  id: string;
  level: number;
  text: string;
};

export function isMarkdownPath(relPath: string | null | undefined): boolean {
  if (!relPath) return false;
  const lower = relPath.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}

function slugify(text: string): string {
  const base = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base || 'section';
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  let n = 2;
  while (used.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  used.add(id);
  return id;
}

/** Markdown → sanitized HTML, plus heading ids for outline jump. */
export function renderMarkdown(md: string): {
  html: string;
  outline: TMdOutlineItem[];
} {
  const raw = marked.parse(md, { async: false }) as string;
  const clean = DOMPurify.sanitize(raw, { ADD_ATTR: ['id'] });
  const doc = new DOMParser().parseFromString(
    `<div id="md-root">${clean}</div>`,
    'text/html',
  );
  const root = doc.getElementById('md-root');
  if (!root) return { html: clean, outline: [] };

  const used = new Set<string>();
  const outline: TMdOutlineItem[] = [];
  root.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((el) => {
    const level = Number(el.tagName.slice(1));
    const text = (el.textContent || '').trim();
    if (!text) return;
    const id = uniqueId(slugify(text), used);
    el.id = id;
    outline.push({ id, level, text });
  });

  return { html: root.innerHTML, outline };
}
