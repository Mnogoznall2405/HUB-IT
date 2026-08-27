export const NATIVE_SHELL_NAVIGATE_EVENT = 'hubit:mobile-navigate';
export const NATIVE_SHELL_MESSAGE_TYPE = 'hubit.portal.native-shell';

export function getNativeShellConfig() {
  if (typeof window === 'undefined') return null;
  const value = window.__HUBIT_MOBILE_NATIVE_SHELL__;
  if (!value || typeof value !== 'object') return null;
  return value;
}

export function isNativeShellBottomNav() {
  return getNativeShellConfig()?.bottomNav === 'native';
}

export function nativeShellBottomNavHeight() {
  const height = Number(getNativeShellConfig()?.bottomNavHeight);
  return Number.isFinite(height) && height > 0 ? height : 64;
}

export function postNativeShellBottomNavState(hideBottomNav) {
  if (typeof window === 'undefined' || !isNativeShellBottomNav()) return;
  try {
    window.ReactNativeWebView?.postMessage(JSON.stringify({
      type: NATIVE_SHELL_MESSAGE_TYPE,
      hideBottomNav: Boolean(hideBottomNav),
    }));
  } catch {
    // Native bridge is optional in browser.
  }
}

export function isSafeNativeShellPath(path) {
  const normalized = String(path || '').trim();
  return Boolean(
    normalized.startsWith('/')
    && !normalized.startsWith('//')
    && !normalized.includes('\\'),
  );
}
