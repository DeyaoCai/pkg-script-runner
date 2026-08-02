# Pkg Runner

Monorepo：托盘主程序 + Runner / Editor 子程序。

```
apps/tray          @pkg-runner/tray          托盘主进程（截屏 · 拉起子程序）
apps/runner        @pkg-runner/runner        脚本 Runner（pty · glass · 主窗口）
apps/web           @pkg-runner/web           Runner 的 Vue UI
apps/code-editor   @pkg-runner/code-editor   轻量代码编辑器（Git Diff / 多项目）
```

## 开发

```bash
pnpm install
pnpm rebuild:native   # Runner 的 node-pty，可选
pnpm dev              # 只起托盘（截屏 / 菜单拉起子程序）
pnpm dev:runner       # 独立跑 Runner（Vite :5200 + Electron）
pnpm dev:code-editor  # 独立跑编辑器
```

初始化（`install` + `build`；native 重建失败默认只警告）：

```bash
pnpm bootstrap
pnpm bootstrap -- --skip-native
pnpm bootstrap -- --require-native
```

仅 Web：

```bash
pnpm dev:web
```

## 打包

```bash
pnpm dist:win
```

托盘为入口产物（`apps/tray/release/`）。Runner / Editor 可先 `dist:win:dir` 打出可执行文件，再与托盘并列发布。

## 进程职责

| 进程 | 职责 |
|------|------|
| Tray | **读取/写入** shared-settings、截屏热键/历史、设置窗、启动子程序 |
| Runner | 脚本执行、控制面 HTTP；**接收**托盘推送的配置（不读盘） |
| Editor | 代码 / Markdown 工作台 |
