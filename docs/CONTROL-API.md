# Runner 控制面 HTTP API

本机控制面由 `@pkg-runner/runner` 启动，只监听 `127.0.0.1`。

## 发现

`%APPDATA%/<profile>/control/http.json`（正式 `pkg-runner`，开发 `pkg-runner-dev`）：

```json
{ "host": "127.0.0.1", "port": 18765, "token": "...", "baseUrl": "http://127.0.0.1:18765", "pid": 1234 }
```

CLI：`pnpm --filter @pkg-runner/runner ctl -- <cmd>`（内部读上述文件）。

## 鉴权

除 `GET /health` 外，请求头需：

```
Authorization: Bearer <token>
```

也可使用 `x-pkg-runner-token: <token>`。

## 路由

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | `{ ok, name: "pkg-runner", pid }` |
| GET | `/v1/endpoint` | 当前发现文件内容（需鉴权） |
| POST | `/v1/settings` | 托盘推送 SharedSettings；Runner **不读盘** |
| POST | `/v1/window/toggle` | 显示/隐藏主窗口 |
| POST | `/v1/flush-logs` | 立刻刷脚本落盘缓冲 |
| POST | `/v1/scripts` | `{ action: "start"\|"restart"\|"stop", script, dir? }` |
| POST | `/v1/shell` | `{ action: "open"\|"exec"\|"close"\|"list", dir?, command?, id? }` |
| POST | `/v1/ports` | `{ action: "list"\|"kill"\|"reap", port?, pid?, nodeOnly? }` |

已移除：`POST /v1/reload-settings`（曾为 no-op）。刷新配置请由托盘 `POST /v1/settings` 推送。

## `/v1/ports` 行为摘要

- `list`：LISTEN 端口 + 归属（`self` / `job` / `shell` / `unmanaged`）
- `kill`：按 `port` 或 `pid` 杀树（`taskkill /T` 或 Job Object 外的兜底）
- `reap`：清理 `unmanaged`；默认只杀 node 系进程名（`nodeOnly: true`）
