# @pkg-runner/web

Pkg Runner 主窗口（Vue 3 + Vite）。

- 主题：`@pkg-runner/tokens`（`tokens.css` + `bootDocumentTheme`）
- 字体等 runner 专属资源仍来自 `@pkg-runner/runner` 的 `ui/`
- 标题栏品牌图：`@pkg-runner/assets/media/logo.png`

```bash
pnpm --filter @pkg-runner/tokens build
pnpm --filter @pkg-runner/web dev      # :5200
pnpm --filter @pkg-runner/web build    # → apps/runner/dist-ui
```

能力概要：脚本列表 / 日志 / Shell、端口面板、工作区与仓库选择（与 Editor 共享 workspace prefs）。
