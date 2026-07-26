import { createApp } from 'vue';
import App from './App/App.vue';

import '../../runner/ui/fonts/jetbrains-mono.css';
import '@xterm/xterm/css/xterm.css';
import '../../runner/ui/tokens.css';
import '../../runner/ui/styles.css';

createApp(App).mount('#app');
