import type { InjectionKey } from 'vue';
import type { AppCtrl } from './App/AppCtrl';

export const APP_CTRL_KEY: InjectionKey<AppCtrl> = Symbol('pkg-runner-app-ctrl');
