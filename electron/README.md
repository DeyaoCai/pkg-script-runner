# pkg-script-runner

读目录下的 `package.json` scripts，托盘常驻一键运行；支持真终端（node-pty）、截屏标注与历史导出（MD/HTML）。

## 开发

```bash
pnpm install
pnpm rebuild:native   # 可选：无 VS Build Tools 时可跳过，预编译 node-pty 一般够用
pnpm dev
```

若 `electron` 下载失败（网络），可设置镜像后重装，或从已有环境拷贝 `node_modules/electron/dist`：

```bash
# 可选镜像（按你的网络选用）
# set ELECTRON_MIRROR=https://cdn.npmmirror.com/binaries/electron/
pnpm install
```

## 打包（Windows portable）

```bash
pnpm dist:win
```

产物在 `release/`。

## 说明

从 `deepseek-ext` monorepo 的 `apps/pkg-runner` 迁出；字体资源在 `vendor/fonts`。
