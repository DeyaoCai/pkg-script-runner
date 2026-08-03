import { createApp } from 'vue';
import { bootSharedUi, type ColorEnv } from '@pkg-runner/tokens';
import '@pkg-runner/fonts/jetbrains-mono-compact.css';
import '@pkg-runner/tokens/tokens.css';
import '@pkg-runner/tokens/chrome.css';
import '@pkg-runner/ui/controls.css';
import './settings-base.css';
import Settings from './Settings.vue';

const env: ColorEnv = window.__bootEnv === 'test' ? 'test' : 'prod';
bootSharedUi({
  colorEnv: env,
  theme: 'dark',
  titleForEnv: (e) => '设置 · ' + (e === 'test' ? '测试' : '正式'),
  bridge: {
    getColorEnv: () => window.__bootEnv ?? env,
    getSharedSettings: () => window.trayApi?.getSettings?.(),
    onSharedSettings: (cb) => window.trayApi?.onSettings?.(cb),
  },
});

createApp(Settings).mount('#app');
