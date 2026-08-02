import { createApp } from 'vue';
import { installTip } from '@pkg-runner/shell/renderer';
import { bootDocumentTheme } from '@pkg-runner/tokens';
import '@pkg-runner/shell/renderer/tip.css';
import '@pkg-runner/shell/renderer/drag.css';
import '@pkg-runner/shell/renderer/window-controls.css';
import '../../../runner/ui/fonts/jetbrains-mono.css';
import '@pkg-runner/tokens/tokens.css';
import './styles/layout.css';
import CodeEditorShell from './CodeEditorShell/CodeEditorShell.vue';

function resolveColorEnv(): 'prod' | 'test' {
  try {
    const fromApi = window.codeEditor?.getColorEnv?.();
    if (fromApi === 'test' || fromApi === 'prod') return fromApi;
  } catch {
    /* ignore */
  }
  return 'prod';
}

bootDocumentTheme({
  colorEnv: resolveColorEnv(),
  titleForEnv: (env) => (env === 'test' ? 'Code Editor · 测试' : 'Code Editor'),
});

const app = createApp(CodeEditorShell);
installTip(app);
app.mount('#app');
