# @pkg-runner/desktop-zones

桌面整理器 + 轻量文件管理（Windows）。

- 扫描桌面，按扩展名分区展示
- **预览 / 执行整理**：把桌面根目录文件真实移动到 `文档` / `图片` / `压缩包` / `代码` / `其它`
- **撤销**最近一次整理
- 双击打开；右键：打开位置 / 重命名 / 删除到回收站

默认普通窗口（稳定），不依赖嵌桌面层。

## 开发

在 monorepo 根目录：

```bash
pnpm install
pnpm dev:desktop-zones
```

或：

```bash
pnpm --filter @pkg-runner/desktop-zones dev
```

## 行为说明

| 操作 | 说明 |
|------|------|
| 预览整理 | 只计算将移动的文件列表，不改盘 |
| 执行整理 | 移动桌面**根下文件**（不自动移动文件夹） |
| 撤销 | 还原最近一批移动；原位置已占用则跳过 |
| 删除 | `shell.trashItem` 进回收站 |

undo 记录：`userData/organize-undo.json`。
