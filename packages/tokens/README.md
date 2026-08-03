# @pkg-runner/tokens

共享设计 token、主题读写，以及 frameless 窗壳样式（chrome）。

## 用法

**Vite / bundler（推荐）— 统一注入 token + 共享设置**

```ts
import '@pkg-runner/tokens/tokens.css';
import '@pkg-runner/tokens/chrome.css';
import { bootSharedUi } from '@pkg-runner/tokens';

bootSharedUi({
  colorEnv: 'prod', // 或 bridge.getColorEnv()
  titleForEnv: (env) => (env === 'test' ? 'App · 测试' : 'App'),
  bridge: {
    getColorEnv: () => api.getColorEnv(),
    getSharedSettings: () => api.getSharedSettings?.() ?? api.getSettings?.(),
    onSharedSettings: (cb) => api.onSharedSettings?.(cb) ?? api.onSettings?.(cb),
  },
});
```

直播更新也可手动：`applySharedUiSettings(settings, { colorEnv })`。

**仅落 data-env / theme / --tone（无设置桥）**

```ts
import { bootDocumentTheme } from '@pkg-runner/tokens';
bootDocumentTheme({ colorEnv: 'prod', theme: 'dark' });
```

**TitleBarShell 外观覆盖（勿 :deep 改壳）**

在 app 自己的 layout CSS 里改 token 旋钮即可，例如 Code Editor：

```css
:root {
  --titlebar-height: 40px;
  --titlebar: var(--side);
  --titlebar-brand-fg: var(--cyan);
  --titlebar-brand-weight: 700;
  --titlebar-brand-pad-start: 10px;
}
```

可用旋钮：`--titlebar` / `--titlebar-height` / `--titlebar-border` /
`--titlebar-brand-fg` / `--titlebar-brand-weight` / `--titlebar-brand-tracking` /
`--titlebar-brand-pad-start` / `--titlebar-brand-pad-end` / `--titlebar-sub-fg` /
`--titlebar-mark-size`。

Brand mark 默认用 `@pkg-runner/assets/media/logo.png`（`TitleBarShell` 内置）；
`logoUrl: null` 用默认，`''` 隐藏，其它字符串为自定义 URL。

**TitleBarShell slot（统一结构，勿各 app 自造布局）**

```
#leading   → TitleBarChip（工作区 / 项目等）
default    → TitleBarMeta（状态 / 路径）
#actions   → TitleBarAction（工具按钮）+ WindowControls
```

组件：`@pkg-runner/shell/renderer/TitleBar{Chip,Meta,Action}.vue`。

**托盘 HTML（file://）**

`pnpm --filter @pkg-runner/tokens build`（或 `sync`）会生成：

- `apps/tray/ui/tokens.css`
- `apps/tray/ui/chrome.css`（frameless 壳样式，按需 `<link>`）
- `apps/tray/ui/pkg-tokens.js` → `window.PkgTokens`
- 以及包内 `packages/tokens/chrome.css`（Vite 出口）

```html
<link rel="stylesheet" href="./tokens.css" />
<link rel="stylesheet" href="./chrome.css" />
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
| 标题栏外观 | `--titlebar-*` 旋钮（上表）；源样式在 `packages/shell/src/renderer/`，由 sync 打成 `chrome.css` |
| 布局尺寸（非标题栏） | 各 app 自己的 layout CSS（如 editor `layout.css`） |

## 脚本

```bash
pnpm --filter @pkg-runner/tokens build   # tsc + sync 到 tray ui + chrome.css
pnpm --filter @pkg-runner/tokens sync    # 只复制 CSS / 打 IIFE
```

`apps/tray/ui/tokens.css`、`chrome.css`、`pkg-tokens.js` 与 `packages/tokens/chrome.css` 为 sync 生成物，勿手改；改 shell 样式源后跑 sync。
