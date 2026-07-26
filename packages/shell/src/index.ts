export {
  WINDOW_CHANNELS,
  type TWindowChannels,
  framelessWindowOptions,
  attachMaximizedEvents,
  registerWindowIpc,
  type TRegisterWindowIpcOpts,
  revealPath,
  openPathWithDefault,
} from './main/index.js';

export { createWindowPreloadApi, type TWindowBridge } from './preload/index.js';

export { installTip, vTip } from './renderer/index.js';
