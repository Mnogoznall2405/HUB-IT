export const APP_PLATFORM = String(import.meta.env.VITE_PLATFORM || 'web').trim().toLowerCase() || 'web';
export const IS_CAPACITOR_BUILD = APP_PLATFORM === 'capacitor';

export function isCapacitorBuild() {
  return IS_CAPACITOR_BUILD;
}

export function isCapacitorRuntime() {
  if (typeof window === 'undefined') {
    return false;
  }
  const capacitor = window.Capacitor;
  if (!capacitor) {
    return false;
  }
  if (typeof capacitor.isNativePlatform === 'function') {
    return Boolean(capacitor.isNativePlatform());
  }
  const platform = String(capacitor.getPlatform?.() || capacitor.platform || '').trim().toLowerCase();
  return platform === 'android' || platform === 'ios';
}

export function isNativeShellRuntime() {
  return IS_CAPACITOR_BUILD || isCapacitorRuntime();
}
