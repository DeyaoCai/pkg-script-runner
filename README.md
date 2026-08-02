# Pkg Runner

**Windows 托盘脚本启动器**——一键启停 `npm` / `pnpm` / `yarn` 脚本，网格 Shell、伪终端日志、端口清理。给本机联调用，也适合给 Claude Code 当侧车：Agent 改代码，Runner 管进程。

附带轻量代码编辑、多仓工作区与截屏；当前阶段主打 **Runner**。托盘同进程可嵌入 Runner / Editor，也可单独调试。

**License:** [MIT](LICENSE) · **Platform:** Windows-first (Node ≥ 20, pnpm 9) · **Security:** [SECURITY.md](SECURITY.md) · **Contributing:** [CONTRIBUTING.md](CONTRIBUTING.md)

控制面仅监听本机 `127.0.0.1`（Bearer token）；截屏与脚本执行权限同当前用户。

```
apps/tray          @pkg-runner/tray          托盘主进程（截屏 · 设置 · 拉起子窗口）
apps/runner        @pkg-runner/runner        脚本 Runner（pty · glass · 控制面）
apps/web           @pkg-runner/web           Runner 的 Vue UI
apps/code-editor   @pkg-runner/code-editor   轻量代码编辑器（Git Diff / 多项目）
apps/shared        —                         workspace / nodeish 等跨进程小模块
packages/tokens    @pkg-runner/tokens        设计 token + 主题读写 API
packages/assets    @pkg-runner/assets        品牌图（icon / tray / logo）
packages/shell     @pkg-runner/shell         无边框窗 / tip / 窗控
packages/controller @pkg-runner/controller   Vue Controller 基类
```

## 文档

| 文档 | 内容 |
|------|------|
| [docs/FEATURES.md](docs/FEATURES.md) | 产品特性一览 |
| [SECURITY.md](SECURITY.md) | 本机控制面 / 报告渠道 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 环境、检查、约定 |
| [docs/CONTROL-API.md](docs/CONTROL-API.md) | Runner 本机 HTTP 控制面 |
| [docs/CONTROLLER-VUE.md](docs/CONTROLLER-VUE.md) | Vue Controller 约定 |
| [packages/tokens/README.md](packages/tokens/README.md) | 主题 token / sync / 窗口底色 |
| [packages/assets/README.md](packages/assets/README.md) | 品牌 icon / tray / logo |
| [apps/tray/README.md](apps/tray/README.md) · [runner](apps/runner/README.md) · [web](apps/web/README.md) · [code-editor](apps/code-editor/README.md) | 各 app 说明 |

## 开发

```bash
pnpm install
pnpm --filter @pkg-runner/assets build   # 品牌图 + sync runner/ui/logo.png
pnpm --filter @pkg-runner/tokens build   # 主题包 + 同步 tray/runner 的 tokens.css
pnpm rebuild:native                      # Runner 的 node-pty，可选
pnpm dev                                 # 托盘（同进程嵌入 Runner / Editor）
pnpm dev:runner                          # 独立跑 Runner（Vite :5200 + Electron）
pnpm dev:code-editor                     # 独立跑编辑器（Vite :5201）
pnpm dev:web                             # 仅 Runner Web
```

初始化（`install` + `build`；native 重建失败默认只警告）：

```bash
pnpm bootstrap
pnpm bootstrap -- --skip-native
pnpm bootstrap -- --require-native
```

正式 / 测试色板与 userData 分 profile（`pkg-runner` / `pkg-runner-dev`），由 `PKG_RUNNER_COLOR_ENV` 等环境变量控制；图标与 `data-env` 跟运行环境走，拾色器只改 `--tone`。

## 打包

```bash
pnpm dist:win
```

托盘为入口产物（`apps/tray/release/`，NSIS）。打包版会尽量保证桌面 / 开始菜单快捷方式指向当前 exe。

## 进程职责

| 进程 | 职责 |
|------|------|
| Tray | **读取/写入** shared-settings、截屏热键/历史、设置窗（保存 / **应用**）、同进程开 Runner·Editor |
| Runner | 脚本执行、控制面 HTTP、端口面板；**接收**托盘推送的配置（不读盘） |
| Editor | 代码 / Markdown 工作台；与 Runner **共用** workspace prefs |

## 主题与品牌

唯一色源：`@pkg-runner/tokens`（详见 [packages/tokens/README.md](packages/tokens/README.md)）。  
唯一品牌图：`@pkg-runner/assets`（`packages/assets/media/`，详见 [packages/assets/README.md](packages/assets/README.md)）。

- CSS：`packages/tokens/tokens.css`（`--preset-prod` / `--preset-test` → `--tone`）
- JS：`bootDocumentTheme` / `applyBrandColor` / `applyTheme` / `readCssVar` / `chromeBackground`
- 托盘 `file://` 页：build 时 sync 出 `apps/tray/ui/tokens.css` + `pkg-tokens.js`
- Logo / 图标：`packages/assets/media/{logo,icon,tray}*.png`；Electron 运行时从该包解析

改正式绿或测试橙时：只改 `tokens.css` 的 `--preset-*` 与 `src/brand.ts` 常量，再执行：

```bash
pnpm --filter @pkg-runner/tokens build
```

换 logo / 图标：替换 `packages/assets/media/` 下对应文件，再：

```bash
pnpm --filter @pkg-runner/assets build
```

黑底 PNG 转透明：

```bash
node scripts/black-to-transparent.mjs <input.png> [output.png] [--threshold=24]
```

## 设置窗

托盘「设置…」：

- **应用**：写入 shared-settings 并立即生效，不关窗
- **保存**：写入后关闭
- **窗口**：打开 Runner / 编辑器（始终显示，不 toggle）

## 控制面

Runner 本机 HTTP 控制面（鉴权 + 发现文件）：[docs/CONTROL-API.md](docs/CONTROL-API.md)。
