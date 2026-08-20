import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DESKTOP_HANDOFF_PREFERENCE_KEY,
  DESKTOP_HANDOFF_SESSION_SKIP_KEY,
  buildHubitProtocolHref,
  canOfferDesktopHandoff,
  isWindowsDesktopBrowser,
  launchHubitProtocol,
  normalizeHandoffRoute,
  resolveHandoffRoute,
  setDesktopHandoffPreference,
  skipDesktopHandoffThisSession,
} from './desktopProtocolHandoff';

describe('desktopProtocolHandoff', () => {
  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('builds hubit://open links only for allowlisted internal routes', () => {
    expect(buildHubitProtocolHref('/tasks?task=123')).toBe('hubit://open/tasks?task=123');
    expect(buildHubitProtocolHref('/chat?conversation=conv-1')).toBe('hubit://open/chat?conversation=conv-1');
    expect(buildHubitProtocolHref('/networks/branch-1')).toBe('hubit://open/networks/branch-1');
    expect(buildHubitProtocolHref('/login')).toBe('');
    expect(buildHubitProtocolHref('/shared-files/secret')).toBe('');
    expect(buildHubitProtocolHref('/unknown')).toBe('');
    expect(buildHubitProtocolHref('/chat?token=secret')).toBe('');
    expect(buildHubitProtocolHref('/tasks#fragment')).toBe('');
    expect(buildHubitProtocolHref('https://hubit.zsgp.ru/tasks')).toBe('');
  });

  it('resolves the remembered return path on login', () => {
    expect(resolveHandoffRoute('/chat', '?conversation=7')).toBe('/chat?conversation=7');
    expect(resolveHandoffRoute('/login', '', {
      peekReturnPath: () => '/tasks?task=9',
    })).toBe('/tasks?task=9');
    expect(resolveHandoffRoute('/login', '', {
      peekReturnPath: () => '/login',
    })).toBe('');
  });

  it('does not treat WebView2 as a browser that should hand off', () => {
    expect(isWindowsDesktopBrowser({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      runtimeWindow: {},
    })).toBe(true);
    expect(isWindowsDesktopBrowser({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      runtimeWindow: { chrome: { webview: { postMessage() {} } } },
    })).toBe(false);
    expect(isWindowsDesktopBrowser({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    })).toBe(false);
  });

  it('honours never/skip preferences', () => {
    expect(canOfferDesktopHandoff({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      runtimeWindow: {},
      localStorage: window.localStorage,
      sessionStorage: window.sessionStorage,
    })).toBe(true);

    setDesktopHandoffPreference('never');
    expect(canOfferDesktopHandoff({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      runtimeWindow: {},
      localStorage: window.localStorage,
      sessionStorage: window.sessionStorage,
    })).toBe(false);
    expect(window.localStorage.getItem(DESKTOP_HANDOFF_PREFERENCE_KEY)).toBe('never');

    setDesktopHandoffPreference('ask');
    skipDesktopHandoffThisSession();
    expect(window.sessionStorage.getItem(DESKTOP_HANDOFF_SESSION_SKIP_KEY)).toBe('1');
    expect(canOfferDesktopHandoff({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      runtimeWindow: {},
      localStorage: window.localStorage,
      sessionStorage: window.sessionStorage,
    })).toBe(false);
  });

  it('launches only hubit://open hrefs', () => {
    const click = vi.fn();
    expect(launchHubitProtocol('hubit://open/tasks', { click })).toBe(true);
    expect(click).toHaveBeenCalledWith('hubit://open/tasks');
    expect(launchHubitProtocol('https://hubit.zsgp.ru/tasks', { click })).toBe(false);
    expect(launchHubitProtocol('hubit://evil/tasks', { click })).toBe(false);
  });

  it('rejects encoded path escapes', () => {
    expect(normalizeHandoffRoute('/chat%2Fescape')).toBe('');
    expect(normalizeHandoffRoute('/networks/a/b')).toBe('');
  });
});
