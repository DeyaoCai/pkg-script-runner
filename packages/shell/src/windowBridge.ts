/** Preload / renderer contract for frameless window chrome. */
export type TWindowBridge = {
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<boolean>;
  windowClose: () => Promise<void>;
  windowIsMaximized: () => Promise<boolean>;
  onMaximizedChange: (cb: (maximized: boolean) => void) => () => void;
};
