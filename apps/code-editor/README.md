# @pkg-runner/code-editor

轻量代码 / Markdown 工作台：多项目根、Git Diff 跳转、底部终端。由托盘同进程拉起，也可独立开发。

- 工作区 prefs 与 Runner **共用**（`apps/shared/workspaceSync` → code-editor prefs）
- 主题：`@pkg-runner/tokens`（`bootDocumentTheme` / `data-env`）
- 窗壳：`@pkg-runner/shell`（无边框、窗控）

```bash
pnpm --filter @pkg-runner/code-editor dev          # 独立：Vite :5201 + Electron
pnpm --filter @pkg-runner/code-editor build
# 日常：根目录 pnpm dev（托盘内嵌 Editor）
```
