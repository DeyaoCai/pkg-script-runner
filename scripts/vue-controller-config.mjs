/** @see scripts/check-vue-controller.mjs */

/** 扫描根：相对仓库根 */
export const SCAN_ROOTS = [
  'apps/web/src',
  'apps/code-editor/src/renderer',
];

/** 各根下相对路径前缀：跳过扫描 */
export const SCAN_IGNORE_PREFIXES = [];

/**
 * 例外配对（相对 SCAN_ROOT）。新面板优先目录下沉，一般不需要写这里。
 * 同 stem：`{Stem}/{Stem}Ctrl.ts` ↔ `{Stem}/{Stem}.vue`
 */
export const CROSS_PAIRS = {};
