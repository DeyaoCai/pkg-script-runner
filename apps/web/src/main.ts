import { createApp } from 'vue';
import App from './App/App.vue';
import { bootDocumentTheme } from '@pkg-runner/tokens';

import '../../runner/ui/fonts/jetbrains-mono.css';
import '@xterm/xterm/css/xterm.css';
import '@pkg-runner/tokens/tokens.css';
import '../../runner/ui/styles.css';

bootDocumentTheme({
  colorEnv:
    window.pkgRunner?.getColorEnv?.() === 'test' ? 'test' : 'prod',
  titleForEnv: (env) =>
    env === 'test' ? 'Pkg Runner · 测试' : 'Pkg Runner',
});

createApp(App).mount('#app');
