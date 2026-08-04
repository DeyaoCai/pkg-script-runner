# @pkg-runner/desktop-zones

自定义桌面整理器（Windows）。

- **顶部一行分组卡片**（含固定「壁纸」组）；每卡预览前 4 项（上 icon、下 label）；左右翻页；右侧「新建分组」
- **壁纸组**：点击进入预览工作室
- **下方两列**：自定义桌面未追踪项 | 系统真实桌面
- **递归进入**：分组 / 文件夹可点进子页面（面包屑返回）
- 拖放到分组卡片移动；撤销；重命名 / 回收站
- 壁纸库与应用背景仍走 `@pkg-runner/wallpaper` / `shared-settings`
- **即梦**：外挂窗口登录 + 同步社区收藏并下载到本地壁纸目录

## 开发

```bash
pnpm install
pnpm dev:desktop-zones
```

主进程改动需重启 Electron。

## 即梦收藏

1. 先启动 **Runner**（控制面 `127.0.0.1:18765`，见 `control/http.json`）
2. 顶栏点 **即梦** → 通道式分栏：**左即梦 | 右桌面**（同一窗口）；再点「收起即梦」或 Esc 收起左侧
3. 浏览时自动拦截 `get_favorite_list` / 首页 feed → 本地缓存 + `POST /v1/jimeng/ingest`
4. **即梦收藏** 面板开在右侧桌面区；SSE 刷新 / `WallpaperStudio` 预览 / 下载同前

下载目录：`packages/wallpaper/jimeng/`（与默认 `wallpapers/` 同级，**不进 git**）。壁纸列表优先即梦，再默认库。

说明：接口来自官网页面请求，**非官方公开 API**，改版后可能失效；仅供本人账号自用。  
UI 预览经本地协议 `jimeng-media://i/<token>` 代理加载（主进程带 Referer 拉取），渲染层不直接暴露 CDN 原链。

## 交互要点

- **Esc**：关预览 / 对话框 / 右键菜单 / 即梦收藏面板；在子目录则返回上级  
- **Backspace**：子目录返回上级  
- 拖到**分组卡片**或**当前文件夹区域**即可移动；顶栏「撤销」一键还原  
- 提示条约 2–3 秒自动消失；滚轮可横向拨分组轮播  

prefs：`userData/zones-prefs.json`  
窗口：`userData/zones-window.json` / `jimeng-window.json`  
收藏缓存：`userData/jimeng-favorites.json`  
undo：`userData/organize-undo.json`
