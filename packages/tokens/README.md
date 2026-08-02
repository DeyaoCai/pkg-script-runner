# @pkg-runner/tokens

共享设计 token 与主题读写。Tray / Runner Web / Code Editor 都只依赖这一份。

## 用法

**Vite / bundler（推荐）**

```ts
import '@pkg-runner/tokens/tokens.css';
import {
  bootDocumentTheme,
  applyBrandColor,
  applyTheme,
  readCssVar,
  chromeBackground,
  BRAND_PRESET_PROD,
  BRAND_PRESET_TEST,
} from '@pkg-runner/tokens';

bootDocumentTheme({
  colorEnv: 'prod', // 或 'test' → 写 data-env，默认 --tone
  theme: 'dark',
  brandColor: BRAND_PRESET_PROD, // 可选；不传则用 colorEnv 预设
});

// Electron BrowserWindow.backgroundColor（无法用 CSS color-mix）
chromeBackground('prod', 'dark'); // → 固定 hex，与 --color-bg-base 对齐
```

**托盘 HTML（file://）**

`pnpm --filter @pkg-runner/tokens build`（或 `sync`）会生成：

- `apps/tray/ui/tokens.css`
- `apps/tray/ui/pkg-tokens.js` → `window.PkgTokens`

```html
<link rel="stylesheet" href="./tokens.css" />
<script src="./pkg-tokens.js"></script>
<script>
  PkgTokens.applyBrandColor(PkgTokens.BRAND_PRESET_PROD);
  PkgTokens.applyTheme('dark');
</script>
```

## 改色规则

| 要改什么 | 改哪里 |
|----------|--------|
| 正式 / 测试默认色 | `tokens.css` 的 `--preset-prod` / `--preset-test` **且** `src/brand.ts` 的 `BRAND_PRESET_*` |
| 运行时主色 | 只写 `--tone`（`applyBrandColor`）；不要再抄一套 hex 到各 HTML |
| 主进程窗口底色 | `src/chrome.ts` 的 `CHROME_BG` / `chromeBackground`（与 `--color-bg-base` 对齐的固定 hex） |
| 布局尺寸 | 各 app 自己的 layout CSS（如 editor `layout.css`），不要塞进 tokens |

旧正式蓝 `#3D8BFD` 在 `normalizeBrandColor` 里会映射到当前 `BRAND_PRESET_PROD`。

## 脚本

```bash
pnpm --filter @pkg-runner/tokens build   # tsc + sync 到 tray/runner ui
pnpm --filter @pkg-runner/tokens sync    # 只复制 CSS / 打 IIFE
```

`apps/runner/ui/tokens.css`、`apps/tray/ui/tokens.css`、`apps/tray/ui/pkg-tokens.js` 为 sync 生成物（已 gitignore），勿手改；改源后跑 `pnpm --filter @pkg-runner/tokens build`。
