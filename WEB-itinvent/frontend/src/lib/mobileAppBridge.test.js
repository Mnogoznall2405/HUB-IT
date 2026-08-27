import { describe, expect, it, vi } from 'vitest';
import {
  MOBILE_APP_COMMAND_MESSAGE_TYPE,
  MOBILE_APP_COMMAND_RESPONSE_EVENT,
  MOBILE_APP_PRINT_MESSAGE_TYPE,
  isMobileAppWebViewRuntime,
  requestMobileAppCommand,
  requestMobileAppPrint,
} from './mobileAppBridge';

describe('mobile app bridge', () => {
  it('stays disabled in a regular browser', () => {
    expect(isMobileAppWebViewRuntime({})).toBe(false);
    expect(requestMobileAppPrint({ html: '<p>Mail</p>' }, {})).toBe(false);
  });

  it('posts a bounded print job to the Android WebView host', () => {
    const postMessage = vi.fn();
    const runtimeWindow = {
      __HUBIT_MOBILE_APP__: true,
      ReactNativeWebView: { postMessage },
    };

    expect(requestMobileAppPrint({
      title: '  Письмо  ',
      html: '<html><body>Mail</body></html>',
    }, runtimeWindow)).toBe(true);
    expect(JSON.parse(postMessage.mock.calls[0][0])).toEqual({
      type: MOBILE_APP_PRINT_MESSAGE_TYPE,
      title: 'Письмо',
      html: '<html><body>Mail</body></html>',
    });
  });

  it('round-trips an allowlisted native command by request id', async () => {
    const runtimeWindow = new EventTarget();
    runtimeWindow.__HUBIT_MOBILE_APP__ = true;
    runtimeWindow.crypto = { randomUUID: () => 'request-1' };
    runtimeWindow.setTimeout = setTimeout;
    runtimeWindow.clearTimeout = clearTimeout;
    runtimeWindow.ReactNativeWebView = {
      postMessage: vi.fn((raw) => {
        const request = JSON.parse(raw);
        runtimeWindow.dispatchEvent(new CustomEvent(MOBILE_APP_COMMAND_RESPONSE_EVENT, {
          detail: {
            type: 'hubit.portal.native-command-response',
            schemaVersion: 1,
            requestId: request.requestId,
            ok: true,
            result: { status: 'registered' },
          },
        }));
      }),
    };

    await expect(requestMobileAppCommand('notifications.getState', {}, { runtimeWindow }))
      .resolves.toEqual({ status: 'registered' });
    expect(JSON.parse(runtimeWindow.ReactNativeWebView.postMessage.mock.calls[0][0]))
      .toMatchObject({
        type: MOBILE_APP_COMMAND_MESSAGE_TYPE,
        schemaVersion: 1,
        requestId: 'web-request-1',
        command: 'notifications.getState',
        payload: {},
      });
  });

  it('passes the typed haptic command through the same bounded bridge', async () => {
    const runtimeWindow = new EventTarget();
    runtimeWindow.__HUBIT_MOBILE_APP__ = true;
    runtimeWindow.setTimeout = setTimeout;
    runtimeWindow.clearTimeout = clearTimeout;
    runtimeWindow.ReactNativeWebView = {
      postMessage: vi.fn((raw) => {
        const request = JSON.parse(raw);
        runtimeWindow.dispatchEvent(new CustomEvent(MOBILE_APP_COMMAND_RESPONSE_EVENT, {
          detail: {
            type: 'hubit.portal.native-command-response',
            schemaVersion: 1,
            requestId: request.requestId,
            ok: true,
            result: { kind: 'success' },
          },
        }));
      }),
    };

    await expect(requestMobileAppCommand('haptics.perform', { kind: 'success' }, { runtimeWindow }))
      .resolves.toEqual({ kind: 'success' });
    expect(JSON.parse(runtimeWindow.ReactNativeWebView.postMessage.mock.calls[0][0]))
      .toMatchObject({ command: 'haptics.perform', payload: { kind: 'success' } });
  });

  it('allows privacy-safe Android connectivity and settings commands', async () => {
    const runtimeWindow = new EventTarget();
    runtimeWindow.__HUBIT_MOBILE_APP__ = true;
    runtimeWindow.setTimeout = setTimeout;
    runtimeWindow.clearTimeout = clearTimeout;
    runtimeWindow.ReactNativeWebView = {
      postMessage: vi.fn((raw) => {
        const request = JSON.parse(raw);
        runtimeWindow.dispatchEvent(new CustomEvent(MOBILE_APP_COMMAND_RESPONSE_EVENT, {
          detail: {
            type: 'hubit.portal.native-command-response',
            schemaVersion: 1,
            requestId: request.requestId,
            ok: true,
            result: { available: true, online: true, connected: true, transport: 'wifi', metered: false },
          },
        }));
      }),
    };

    await expect(requestMobileAppCommand('network.getState', {}, { runtimeWindow }))
      .resolves.toMatchObject({ available: true, online: true, transport: 'wifi' });
    expect(JSON.parse(runtimeWindow.ReactNativeWebView.postMessage.mock.calls[0][0]))
      .toMatchObject({ command: 'network.getState', payload: {} });

    await expect(requestMobileAppCommand('system.openBackgroundSettings', {}, { runtimeWindow }))
      .resolves.toBeTruthy();
    expect(JSON.parse(runtimeWindow.ReactNativeWebView.postMessage.mock.calls[1][0]))
      .toMatchObject({ command: 'system.openBackgroundSettings', payload: {} });
  });

  it('rejects unsupported commands before posting to native code', async () => {
    const postMessage = vi.fn();
    const runtimeWindow = {
      __HUBIT_MOBILE_APP__: true,
      ReactNativeWebView: { postMessage },
    };

    await expect(requestMobileAppCommand('intent.openAnything', {}, { runtimeWindow }))
      .rejects.toThrow('не поддерживается');
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('surfaces a bounded native error response', async () => {
    const runtimeWindow = new EventTarget();
    runtimeWindow.__HUBIT_MOBILE_APP__ = true;
    runtimeWindow.setTimeout = setTimeout;
    runtimeWindow.clearTimeout = clearTimeout;
    runtimeWindow.ReactNativeWebView = {
      postMessage: vi.fn((raw) => {
        const request = JSON.parse(raw);
        runtimeWindow.dispatchEvent(new CustomEvent(MOBILE_APP_COMMAND_RESPONSE_EVENT, {
          detail: {
            type: 'hubit.portal.native-command-response',
            schemaVersion: 1,
            requestId: request.requestId,
            ok: false,
            error: { code: 'permission_denied', message: 'Разрешение не выдано' },
          },
        }));
      }),
    };

    await expect(requestMobileAppCommand('notifications.requestPermission', {}, { runtimeWindow }))
      .rejects.toMatchObject({ code: 'permission_denied', message: 'Разрешение не выдано' });
  });
});
