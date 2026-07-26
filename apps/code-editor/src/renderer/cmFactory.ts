import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap } from '@codemirror/search';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { python } from '@codemirror/lang-python';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

const langConf = new Compartment();

const theme = EditorView.theme(
  {
    '&': {
      height: '100%',
      fontSize: '13px',
      backgroundColor: 'var(--bg)',
      color: 'var(--text)',
    },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: 'var(--mono)',
    },
    '.cm-content': {
      fontFamily: 'var(--mono)',
      caretColor: 'var(--cyan)',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--side)',
      color: 'var(--muted)',
      border: 'none',
      borderRight: '1px solid var(--line)',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(0, 245, 255, 0.06)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'rgba(0, 245, 255, 0.08)',
    },
    '&.cm-focused .cm-cursor': {
      borderLeftColor: 'var(--cyan)',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'rgba(0, 245, 255, 0.22)',
    },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--cyan)' },
  { tag: tags.string, color: 'var(--ok)' },
  { tag: tags.comment, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: tags.number, color: 'var(--warn)' },
  { tag: tags.function(tags.variableName), color: '#9ef' },
  { tag: tags.definition(tags.variableName), color: 'var(--text)' },
  { tag: tags.typeName, color: '#c4b5fd' },
]);

function languageForPath(relPath: string) {
  const lower = relPath.toLowerCase();
  if (lower.endsWith('.json')) return json();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return markdown();
  if (lower.endsWith('.css') || lower.endsWith('.scss')) return css();
  if (lower.endsWith('.html') || lower.endsWith('.htm') || lower.endsWith('.vue')) return html();
  if (lower.endsWith('.py')) return python();
  if (
    lower.endsWith('.js') ||
    lower.endsWith('.jsx') ||
    lower.endsWith('.mjs') ||
    lower.endsWith('.cjs') ||
    lower.endsWith('.ts') ||
    lower.endsWith('.tsx')
  ) {
    return javascript({ typescript: lower.endsWith('.ts') || lower.endsWith('.tsx') });
  }
  return [];
}

export type TCmHandle = {
  view: EditorView;
  setDoc: (text: string, relPath: string) => void;
  getDoc: () => string;
  gotoLine: (line: number) => void;
  destroy: () => void;
};

export function createEditor(
  parent: HTMLElement,
  opts: {
    doc: string;
    relPath: string;
    readOnly?: boolean;
    onChange?: (text: string) => void;
    onSave?: () => void;
    onBlur?: () => void;
  },
): TCmHandle {
  const readOnly = !!opts.readOnly;
  const extensions = [
    lineNumbers(),
    highlightActiveLine(),
    theme,
    syntaxHighlighting(highlight),
    langConf.of(languageForPath(opts.relPath)),
    EditorView.lineWrapping,
    ...(readOnly
      ? [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          keymap.of([...defaultKeymap, ...searchKeymap]),
        ]
      : [
          history(),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            indentWithTab,
            {
              key: 'Mod-s',
              run: () => {
                opts.onSave?.();
                return true;
              },
            },
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) opts.onChange?.(u.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            blur: () => {
              opts.onBlur?.();
              return false;
            },
          }),
        ]),
  ];

  const state = EditorState.create({
    doc: opts.doc,
    extensions,
  });

  const view = new EditorView({ state, parent });

  return {
    view,
    setDoc(text, relPath) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        effects: langConf.reconfigure(languageForPath(relPath)),
      });
    },
    getDoc() {
      return view.state.doc.toString();
    },
    gotoLine(line) {
      const doc = view.state.doc;
      const ln = Math.max(1, Math.min(line, doc.lines));
      const lineObj = doc.line(ln);
      view.dispatch({
        selection: { anchor: lineObj.from },
        effects: EditorView.scrollIntoView(lineObj.from, { y: 'center' }),
      });
      view.focus();
    },
    destroy() {
      view.destroy();
    },
  };
}
