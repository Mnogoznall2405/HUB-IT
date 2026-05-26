import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureNativeCameraPermission } from './hubitPermissionsNative';

describe('ensureNativeCameraPermission', () => {
  beforeEach(() => {
    delete window.Capacitor;
  });

  it('skips on web', async () => {
    await expect(ensureNativeCameraPermission()).resolves.toBe(true);
  });

  it('throws when native plugin is missing', async () => {
    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: {},
    };
    await expect(ensureNativeCameraPermission()).rejects.toThrow('CameraPermissionPluginMissing');
  });

  it('requests and verifies camera permission on native', async () => {
    const checkCamera = vi.fn()
      .mockResolvedValueOnce({ granted: false })
      .mockResolvedValueOnce({ granted: true });
    const requestCamera = vi.fn().mockResolvedValue({});

    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: {
        HubitPermissions: { checkCamera, requestCamera },
      },
    };

    await expect(ensureNativeCameraPermission()).resolves.toBe(true);
    expect(requestCamera).toHaveBeenCalledTimes(1);
    expect(checkCamera).toHaveBeenCalledTimes(2);
  });
});
