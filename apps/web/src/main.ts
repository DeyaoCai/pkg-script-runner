import { createApp } from 'vue';
import App from './App/App.vue';
import { bootSharedUi } from '@pkg-runner/tokens';

import '@pkg-runner/fonts/jetbrains-mono-compact.css';
import '@xterm/xterm/css/xterm.css';
import '@pkg-runner/tokens/tokens.css';
import '@pkg-runner/tokens/chrome.css';
import '@pkg-runner/ui/controls.css';
import '../../runner/ui/styles.css';

bootSharedUi({
  colorEnv: window.pkgRunner?.getColorEnv?.() === 'test' ? 'test' : 'prod',
  titleForEnv: (env) =>
    env === 'test' ? 'Pkg Runner · 测试' : 'Pkg Runner',
  bridge: {
    getColorEnv: () => window.pkgRunner?.getColorEnv?.() ?? 'prod',
    getSharedSettings: () => window.pkgRunner?.getSettings?.(),
    onSharedSettings: (cb) => window.pkgRunner?.onSettings?.(cb),
  },
});

createApp(App).mount('#app');
