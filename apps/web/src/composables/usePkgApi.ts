import type { PkgRunnerApi } from '../env';

export function usePkgApi(): PkgRunnerApi {
  const api = window.pkgRunner;
  if (!api) {
    throw new Error('window.pkgRunner is missing — open inside Electron');
  }
  return api;
}

export function tryPkgApi(): PkgRunnerApi | null {
  return window.pkgRunner ?? null;
}
