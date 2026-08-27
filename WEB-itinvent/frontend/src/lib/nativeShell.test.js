import {
  isNativeShellBottomNav,
  isSafeNativeShellPath,
  nativeShellBottomNavHeight,
} from './nativeShell';

describe('nativeShell', () => {
  afterEach(() => {
    delete window.__HUBIT_MOBILE_NATIVE_SHELL__;
  });

  it('detects the native bottom-nav flag injected by the APK', () => {
    expect(isNativeShellBottomNav()).toBe(false);
    window.__HUBIT_MOBILE_NATIVE_SHELL__ = { bottomNav: 'native', bottomNavHeight: 64 };
    expect(isNativeShellBottomNav()).toBe(true);
    expect(nativeShellBottomNavHeight()).toBe(64);
  });

  it('rejects unsafe SPA paths from the native shell', () => {
    expect(isSafeNativeShellPath('/mail?compose=new')).toBe(true);
    expect(isSafeNativeShellPath('//evil.example')).toBe(false);
    expect(isSafeNativeShellPath('javascript:alert(1)')).toBe(false);
  });
});
