import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import {
  disableBiometricLogin,
  enableBiometricLogin,
  getAppLockSettings,
  getBiometricLoginUserId,
  isBiometricLoginEnabled,
  setAppLockSettings,
  shouldLockAfterBackground,
  unlockBiometricLogin,
} from './biometricAuth';

jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn(async () => new Uint8Array(32).fill(0xab)),
}));

jest.mock('expo-local-authentication', () => ({
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
  hasHardwareAsync: jest.fn(async () => true),
  isEnrolledAsync: jest.fn(async () => true),
  supportedAuthenticationTypesAsync: jest.fn(async () => [1]),
}));

const user = {
  id: 7,
  username: 'mobile-test',
  role: 'viewer',
  permissions: ['dashboard.read'],
};
const renewalToken = `mb1.${'1'.repeat(32)}.${'a'.repeat(48)}`;

describe('biometric login credential', () => {
  it('stores a biometric-protected offline key and restores it', async () => {
    const credential = await enableBiometricLogin(user, renewalToken);

    expect(credential.offlineCacheKey).toBe('ab'.repeat(32));
    expect(await isBiometricLoginEnabled()).toBe(true);
    expect(await getBiometricLoginUserId()).toBe(user.id);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      expect.stringContaining('credential'),
      expect.any(String),
      expect.objectContaining({ requireAuthentication: true }),
    );
    await expect(unlockBiometricLogin()).resolves.toEqual(credential);
    expect(Crypto.getRandomBytesAsync).toHaveBeenCalledWith(32);
  });

  it('refuses opt-in when a fingerprint is not enrolled', async () => {
    jest.mocked(LocalAuthentication.isEnrolledAsync).mockResolvedValueOnce(false);
    await expect(enableBiometricLogin(user, renewalToken)).rejects.toThrow('не настроен вход по отпечатку');
    expect(await isBiometricLoginEnabled()).toBe(false);
  });

  it('removes the opt-in marker and protected credential on disable', async () => {
    await enableBiometricLogin(user, renewalToken);
    await disableBiometricLogin();
    expect(await isBiometricLoginEnabled()).toBe(false);
    expect(await getBiometricLoginUserId()).toBeNull();
    await expect(unlockBiometricLogin()).rejects.toThrow('Вход по отпечатку недоступен');
  });

  it('enables biometric login with app lock off by default', async () => {
    await enableBiometricLogin(user, renewalToken);
    await expect(getAppLockSettings()).resolves.toEqual({ enabled: false, timeoutSeconds: 900 });

    await expect(setAppLockSettings({ enabled: true, timeoutSeconds: 300 })).resolves.toEqual({
      enabled: true,
      timeoutSeconds: 300,
    });
    expect(shouldLockAfterBackground(1_000, 301_000, { enabled: true, timeoutSeconds: 300 })).toBe(true);
    expect(shouldLockAfterBackground(1_000, 300_999, { enabled: true, timeoutSeconds: 300 })).toBe(false);
    expect(shouldLockAfterBackground(1_000, 900_000, { enabled: false, timeoutSeconds: 0 })).toBe(false);
  });

  it('treats a missing app-lock flag as disabled', async () => {
    await enableBiometricLogin(user, renewalToken);
    await SecureStore.deleteItemAsync('hubit_app_lock_enabled');
    await SecureStore.deleteItemAsync('hubit_app_lock_timeout_seconds');
    await expect(getAppLockSettings()).resolves.toEqual({ enabled: false, timeoutSeconds: 60 });
  });
});
