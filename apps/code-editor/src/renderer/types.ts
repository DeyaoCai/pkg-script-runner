export type TEditorTab = {
  id: string;
  relPath: string;
  name: string;
  /** text = CodeMirror; binary = unsupported preview + open with OS */
  kind: 'text' | 'binary';
  content: string;
  savedContent: string;
  dirty: boolean;
  /** last known on-disk mtime when we loaded/saved */
  diskMtimeMs: number;
  /** on-disk size (bytes), mainly for binary tabs */
  size: number;
  /** disk changed while local edits exist */
  externalConflict: boolean;
  /** bumps when content replaced from disk — editor syncs */
  rev: number;
};

export type TOpenFileOpts = {
  line?: number;
};
