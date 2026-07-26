# Vue Controller（轻量 · 可继承）

> **立场**：Ctrl 继承 `Controller` 基类；实例不代理；响应式只在 `data` / `props` / `state`。

## 30 秒心智

```
④ .vue                         ← 读 ctrl.data / props / state / getter
③ XxxCtrl extends Controller   ← new XxxCtrl()，无 Proxy
     setData / setProps / setState  ← 基类赋值（同代理 Object.assign）
```

## 基类

[`packages/controller`](../packages/controller) → `@pkg-runner/controller`

| API | 作用 |
|-----|------|
| `Controller<TData, TProps, TState>` | **三泛型必填**，声明槽位形状 |
| `constructor({ data, props, state })` | **三初值必填**，各自 `reactive(...)` |
| `setData` / `setProps` / `setState` | 同代理合并赋值 |
| `controllers` | 子 Ctrl 字典，不 reactive |

无 props / state 时仍要写形状，例如 `Record<string, never>` + `props: {}` / `state: {}`。

## 示例

```ts
import { Controller } from '@pkg-runner/controller';

type TData = { localRoot: string };
type TProps = Record<string, never>;
type TState = { scanning: boolean };

export class FooCtrl extends Controller<TData, TProps, TState> {
  constructor() {
    super({
      data: { localRoot: '' },
      props: {},
      state: { scanning: false },
    });
  }
}
```

## 槽位

| 槽位 | 含义 |
|------|------|
| `data` | 业务 |
| `props` | 外部输入 |
| `state` | UI 瞬时 |
| `controllers` | 子 Ctrl |

## Vue SFC 块顺序

```
<template>…</template>
<script lang="ts" setup>…</script>
<style lang="less" scoped>…</style>
```

## 目录下沉

一对 Ctrl ↔ Vue **沉到同名目录**，禁止长期扁平堆在 `components/` 根下：

```
apps/web/src/
  App/
    App.vue
    AppCtrl.ts
  components/
    ProjectsPanel/
      ProjectsPanel.vue
      ProjectsPanelCtrl.ts
    LogPanel/
      LogPanel.vue
      LogPanelCtrl.ts
  lib/ · composables/ · appContext.ts   ← 共享，不下沉到功能目录
```

| 允许 | 禁止 |
|------|------|
| `{Stem}/{Stem}.vue` + `{Stem}/{Stem}Ctrl.ts` | `components/Foo.vue` + `components/FooCtrl.ts` 长期并存 |
| 共享工具留在 `lib/` / `composables/` | 把无关文件塞进功能目录 |

`check-vue-controller` V3 按同 stem / 同目录解析配对。

## Enforce

`pnpm check:vue-controller`（V1–V4）

- V1 `.vue` 内禁止定义 Ctrl / Controller 类
- V2 `.vue` 禁止 `fetch` / `chrome.runtime.sendMessage`（须经 Ctrl）
- V3 `*Ctrl.ts` / `*-controller.ts` / `*.ctrl.ts` 须有配对 `.vue`
- V4 配对 Ctrl 文件至多 export 1 个 `*Ctrl` / `*Controller`

扫描根：`apps/web/src`（见 `scripts/vue-controller-config.mjs`）。
