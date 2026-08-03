import { createApp } from 'vue';
import { installTip } from '@pkg-runner/shell/renderer';
import { bootSharedUi } from '@pkg-runner/tokens';
import '@pkg-runner/shell/renderer/tip.css';
import '@pkg-runner/fonts/jetbrains-mono-compact.css';
import '@pkg-runner/tokens/tokens.css';
import '@pkg-runner/tokens/chrome.css';
import '@pkg-runner/ui/controls.css';
import './styles/layout.css';
import CodeEditorShell from './CodeEditorShell/CodeEditorShell.vue';

bootSharedUi({
  colorEnv: window.codeEditor?.getColorEnv?.() === 'test' ? 'test' : 'prod',
  titleForEnv: (env) => (env === 'test' ? 'Code Editor · 测试' : 'Code Editor'),
  bridge: {
    getColorEnv: () => window.codeEditor?.getColorEnv?.() ?? 'prod',
    getSharedSettings: () => window.codeEditor?.getSharedSettings?.(),
    onSharedSettings: (cb) => window.codeEditor?.onSharedSettings?.(cb),
  },
});

const app = createApp(CodeEditorShell);
installTip(app);
app.mount('#app');
