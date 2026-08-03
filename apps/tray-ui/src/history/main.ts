import { createApp } from 'vue';
import { bootSharedUi } from '@pkg-runner/tokens';
import '@pkg-runner/fonts/jetbrains-mono-compact.css';
import '@pkg-runner/tokens/tokens.css';
import '@pkg-runner/tokens/chrome.css';
import '@pkg-runner/ui/controls.css';
import './history-base.css';
import History from './History.vue';

bootSharedUi({
  colorEnv: window.__bootEnv === 'test' ? 'test' : 'prod',
  theme: 'dark',
  titleForEnv: () => '截屏历史',
  bridge: {
    getColorEnv: () => window.__bootEnv ?? 'prod',
    getSharedSettings: () => window.trayApi?.getSettings?.(),
    onSharedSettings: (cb) => window.trayApi?.onSettings?.(cb),
  },
});

createApp(History).mount('#app');
