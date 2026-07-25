# pkg-script-runner

读目录下的 `package.json` scripts，托盘常驻一键运行；支持真终端（node-pty）、截屏标注与历史导出（MD/HTML）。

## 开发

```bash
pnpm install
pnpm rebuild:native
pnpm dev
```

## 打包（Windows portable）

```bash
pnpm dist:win
```

产物在 `release/`。

## 说明

从 `deepseek-ext` monorepo 的 `apps/pkg-runner` 迁出；字体资源在 `vendor/fonts`。
