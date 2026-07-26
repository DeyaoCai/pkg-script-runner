/** Canonical IPC / event channel names for frameless editor shells. */
export const WINDOW_CHANNELS = {
  minimize: 'window:minimize',
  maximize: 'window:maximize',
  close: 'window:close',
  isMaximized: 'window:isMaximized',
  maximizedChanged: 'window:maximized-changed',
} as const;

export type TWindowChannels = {
  [K in keyof typeof WINDOW_CHANNELS]: string;
};
