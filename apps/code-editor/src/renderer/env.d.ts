/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

import type { TCodeEditorBridge } from './bridge.ts';

declare global {
  interface Window {
    codeEditor: TCodeEditorBridge;
  }
}

export {};
