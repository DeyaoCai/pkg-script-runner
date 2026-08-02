# 特性说明

Pkg Runner 今日能力一览（Windows 优先）。实现细节见各 app README 与 [CONTROL-API.md](CONTROL-API.md)。

## 托盘宿主

- 系统托盘常驻；单击托盘图标显示 / 隐藏 Runner
- 菜单：设置、Runner、编辑器、截屏、截屏历史、截屏目录、诊断日志、创建桌面快捷方式、退出
- 同进程嵌入 Runner 与 Code Editor；也可单独 `pnpm dev:runner` / `dev:code-editor`
- 设置窗：**应用**（写盘并推送、不关窗）/ **保存**（同上并关窗）/ **窗口**（始终打开 Runner·编辑器，非 toggle）
- 正式 / 测试分 userData profile（`pkg-runner` / `pkg-runner-dev`），可并存；图标与 `data-env` 跟运行环境走

## 脚本 Runner

- 选择工作区后发现含 `package.json` 的仓库；与编辑器共用 workspace prefs
- 识别包管理器（`packageManager` / lockfile）并执行 npm scripts
- 脚本 start / restart / stop；伪终端日志（ANSI）；可选落盘与打开日志目录
- 交互 Shell（node-pty）：多会话；网格（1–4 列）或单页
- 项目 / 脚本模糊搜索；侧栏宽度本地记忆
- **端口面板**：LISTENING 列表；归属 `self` / `job` / `shell` / `unmanaged`；按端口或 PID 杀树；一键清理漂移监听（默认仅 node 系）
- 停脚本优先 Windows Job Object；无边框窗控、可始终置顶

## 代码编辑器

- 多项目根导航、文件树、多标签编辑（CodeMirror）
- Git Diff：变更列表、查看与跳转
- 设计区：独立仓库选择；Markdown 源码 / 分栏 / 预览
- 底部终端；布局尺寸可持久化
- 与 Runner 同步工作区 / 活跃仓库

## 截屏

- 全局热键或托盘触发；当前显示器捕获
- 框选 / 窗口点选；选区缩放与边缘吸附
- 标注：矩形、画笔、编号 pin、拾色
- 完成后图文进剪贴板，并写入截屏历史
- 历史：复制图文 / 图 / 文、删除、导出 MD·HTML、开目录；条数上限可配

## 本机控制面

- 仅 `127.0.0.1`；发现文件 `%APPDATA%/<profile>/control/http.json`
- Bearer（或 `x-pkg-runner-token`）；`GET /health` 除外
- 推送设置、切换窗口、刷日志、启停脚本、Shell、端口 list/kill/reap
- CLI：`pnpm --filter @pkg-runner/runner ctl -- …`（详见 [CONTROL-API.md](CONTROL-API.md)）

## 外观与热键

- 唯一色源 `@pkg-runner/tokens`：深 / 浅色；正式绿 / 测试橙预设 + 拾色器（只改 `--tone`）
- 主进程窗口底色 `chromeBackground`（与铺底语义对齐）
- 等宽字体可选（JetBrains Mono / 系统 / Segoe / Cascadia / Consolas）
- 面板不透明度（glass alpha）可调
- 热键总开关；可录制：截屏、显示 Runner、显示编辑器

## 打包

- `pnpm dist:win`：托盘为入口；NSIS 安装包（及 dir 解包）→ `apps/tray/release/`
- 当前用户安装取向；桌面 / 开始菜单快捷方式；托盘菜单可再创建快捷方式

## 约束与边界

- Windows-first（Job Object、端口清理、NSIS）；Node ≥ 20、pnpm 9
- 控制面勿暴露到非本机；token 与 prefs 在 userData，勿提交
- Runner **不读盘**配置，只接收托盘 `POST /v1/settings`
- 截屏与脚本执行权限等同当前登录用户
- 主窗口 UI：`@pkg-runner/web` → `apps/runner/dist-ui`
