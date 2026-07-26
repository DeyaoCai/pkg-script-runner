# @pkg-runner/tray

托盘主程序：系统托盘、截屏（热键 / 历史 / 设置）、拉起 Runner 与 Editor。

开发：`pnpm --filter @pkg-runner/tray dev`（或根目录 `pnpm dev`）。

菜单「打开 Runner / 打开编辑器」会 spawn 对应 Electron 子程序（开发态需先能 `build:dev`，或已有 `dist`）。
