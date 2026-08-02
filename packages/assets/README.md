# @pkg-runner/assets

品牌图唯一源：`media/`（窗口 icon、托盘、logo）。

```ts
import { resolveEnvAssetPath, brandAssetsDir } from '@pkg-runner/assets';

resolveEnvAssetPath('icon', 'prod'); // …/media/icon.png
resolveEnvAssetPath('tray', 'test'); // …/media/tray-test.png
```

- Electron：依赖本包，运行时从 `media` 读图；`electron-builder` 的 `win.icon` / `buildResources` 指到本目录。
- Vite：`import logo from '@pkg-runner/assets/media/logo.png'`。

改图只改 `media/`，再 `pnpm --filter @pkg-runner/assets build`。
