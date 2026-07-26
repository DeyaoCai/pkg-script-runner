import { createApp } from 'vue';
import { installTip } from '@pkg-runner/shell/renderer';
import '@pkg-runner/shell/renderer/tip.css';
import '@pkg-runner/shell/renderer/drag.css';
import '@pkg-runner/shell/renderer/window-controls.css';
import '../../../runner/ui/fonts/jetbrains-mono.css';
import '../../../runner/ui/tokens.css';
import './styles/tokens.css';
import CodeEditorShell from './CodeEditorShell/CodeEditorShell.vue';

const app = createApp(CodeEditorShell);
installTip(app);
app.mount('#app');
