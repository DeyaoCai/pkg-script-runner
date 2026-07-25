# Pkg Script Runner (Flutter)

Flutter 桌面版：打开 `package.json` 项目、托盘常驻、**真 PTY 终端**（ConPTY）里跑 scripts。

## 已有能力

- 选择项目目录，解析 scripts
- 自动识别 pnpm / npm / yarn / bun
- 系统托盘（显示 / 隐藏 / 退出）；关窗口进托盘
- `flutter_pty` + `xterm` 交互终端（PowerShell / cmd）
- 点击 script → 在当前 PTY 执行 `pm run <script>`

尚未移植：截屏标注、全局热键、多会话马赛克。

## 环境

```powershell
$env:Path = "e:\workspace\flutter-extract\flutter\bin;" + $env:Path
$env:PUB_HOSTED_URL='https://pub.flutter-io.cn'
$env:FLUTTER_STORAGE_BASE_URL='https://storage.flutter-io.cn'
```

需要 VS 2022 Build Tools（C++ 桌面）+ Windows 开发人员模式（插件 symlink）。

## 运行

```powershell
cd e:\workspace\pkg-script-runner-flutter
flutter pub get
flutter run -d windows
# 或
flutter build windows --release
```
