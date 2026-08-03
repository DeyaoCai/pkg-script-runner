import { createApp, h } from 'vue';
import { bootSharedUi } from '@pkg-runner/tokens';
import '@pkg-runner/fonts/jetbrains-mono-compact.css';
import '@pkg-runner/tokens/tokens.css';
import '@pkg-runner/tokens/chrome.css';
import '@pkg-runner/ui/controls.css';
import './styles.css';
import ZonesShell from './ZonesShell/ZonesShell.vue';
import { ZonesShellCtrl } from './ZonesShell/ZonesShellCtrl';

bootSharedUi({
  colorEnv: window.desktopZones?.getColorEnv?.() === 'test' ? 'test' : 'prod',
  titleForEnv: (env) =>
    env === 'test' ? 'Desktop Zones · 测试' : 'Desktop Zones',
  bridge: {
    getColorEnv: () => window.desktopZones?.getColorEnv?.() ?? 'prod',
    getSharedSettings: () => window.desktopZones?.getSharedSettings?.(),
    onSharedSettings: (cb) => window.desktopZones?.onSharedSettings?.(cb),
  },
});

const ctrl = new ZonesShellCtrl();
createApp({
  render: () => h(ZonesShell, { ctrl }),
}).mount('#app');
