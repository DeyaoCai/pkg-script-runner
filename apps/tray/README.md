# @pkg-runner/tray

托盘主程序：系统托盘、截屏（热键 / 历史）、设置窗、同进程嵌入 Runner 与 Editor。

开发：`pnpm --filter @pkg-runner/tray dev`（或根目录 `pnpm dev`）。构建前会跑 `@pkg-runner/tokens` sync。

## 设置窗

- **应用**：写入 `shared-settings.json` 并推给已开窗口，不关设置
- **保存**：同上并关闭设置窗
- **窗口**：打开 Runner / 编辑器（`show*`，不是 toggle）

主题 CSS / 预设来自 `@pkg-runner/tokens`（`ui/tokens.css` + `ui/pkg-tokens.js`，由 tokens 包生成）。

## 菜单

托盘菜单可切换显示 Runner / 编辑器、截屏、创建桌面快捷方式、打开诊断日志等。开发与安装包默认分 userData profile，可并存。
