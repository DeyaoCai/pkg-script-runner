# @pkg-runner/runner

脚本 Runner 子程序：主窗口 UI（`@pkg-runner/web`）、pty 任务、控制面 HTTP、glass 卫星窗、端口清理。

开发：`pnpm --filter @pkg-runner/runner dev`（或根目录 `pnpm dev:runner`）。

- 配置：只接收托盘推送的 shared-settings，不读盘
- 主题：`ui/tokens.css` 由 `@pkg-runner/tokens` sync 生成
- 停脚本：优先 Windows Job Object；端口面板可清漂移监听
- 控制面：见 [docs/CONTROL-API.md](../../docs/CONTROL-API.md)；CLI `pnpm --filter @pkg-runner/runner ctl -- …`

`ui/app.js` + `index.vanilla.html` 为旧版 file:// 回退，生产 UI 以 `@pkg-runner/web` → `dist-ui` 为准。

截屏与托盘由 `@pkg-runner/tray` 负责。
