import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/client', () => ({
  settingsAPI: {
    upsertNativePushToken: vi.fn(),
    deleteNativePushToken: vi.fn(),
  },
}));

vi.mock('./capacitorRuntime', () => ({
  getCapacitorPlugin: vi.fn(() => null),
  removeCapacitorListener: vi.fn(),
}));

vi.mock('./platform', () => ({
  isNativeShellRuntime: vi.fn(() => false),
}));

import { settingsAPI } from '../api/client';
import { getCapacitorPlugin } from './capacitorRuntime';
import {
  NATIVE_PUSH_DEVICE_ID_KEY,
  buildNativePushTokenPayload,
  getNativeRuntimeInfo,
  getNativePushDeviceId,
  resetNativePushListenersForTests,
  syncNativePushNotifications,
} from './nativePushNotifications';
import { isNativeShellRuntime } from './platform';

describe('nativePushNotifications', () => {
  afterEach(() => {
    window.localStorage.clear();
    resetNativePushListenersForTests();
    getCapacitorPlugin.mockReset();
    getCapacitorPlugin.mockReturnValue(null);
    isNativeShellRuntime.mockReset();
    isNativeShellRuntime.mockReturnValue(false);
    settingsAPI.upsertNativePushToken.mockReset();
    settingsAPI.deleteNativePushToken.mockReset();
    vi.restoreAllMocks();
  });

  it('keeps a stable generated device id', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('device-1');

    expect(getNativePushDeviceId()).toBe('device-1');
    expect(getNativePushDeviceId()).toBe('device-1');
    expect(window.localStorage.getItem(NATIVE_PUSH_DEVICE_ID_KEY)).toBe('device-1');
  });

  it('builds backend token payload', () => {
    window.localStorage.setItem(NATIVE_PUSH_DEVICE_ID_KEY, 'device-2');

    expect(buildNativePushTokenPayload(' token-1 ', { platform: 'Android', appVersion: '1.0.0' })).toEqual({
      token: 'token-1',
      platform: 'android',
      device_id: 'device-2',
      device_label: expect.any(String),
      app_version: '1.0.0',
    });
  });

  it('reports Firebase as unavailable when the native runtime plugin is missing', async () => {
    isNativeShellRuntime.mockReturnValue(true);
    getCapacitorPlugin.mockReturnValue(null);

    await expect(getNativeRuntimeInfo()).resolves.toMatchObject({
      firebaseConfigured: false,
      reason: 'runtime_plugin_missing',
    });
  });

  it('does not call PushNotifications.register without Firebase config in the APK', async () => {
    isNativeShellRuntime.mockReturnValue(true);
    const runtimePlugin = {
      getInfo: vi.fn().mockResolvedValue({ firebaseConfigured: false }),
    };
    getCapacitorPlugin.mockImplementation((pluginName) => (
      pluginName === 'HubitRuntime' ? runtimePlugin : null
    ));

    await expect(syncNativePushNotifications({
      user: { id: 42 },
      enabled: true,
    })).resolves.toMatchObject({
      ok: false,
      supported: false,
      reason: 'firebase_missing',
    });

    expect(runtimePlugin.getInfo).toHaveBeenCalledTimes(1);
    expect(getCapacitorPlugin).not.toHaveBeenCalledWith('PushNotifications');
  });
});
