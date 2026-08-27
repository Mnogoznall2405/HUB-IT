import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { NativeSecuritySettingsScreen } from './NativeSecuritySettingsScreen';

const mockExecute = jest.fn(async (command: string) => {
  if (command === 'appLock.getState') {
    return { enabled: false, timeoutSeconds: 60, biometricEnabled: false };
  }
  if (command === 'biometrics.enable') {
    return { enabled: false, timeoutSeconds: 60, biometricEnabled: true };
  }
  return { enabled: false, timeoutSeconds: 60, biometricEnabled: false };
});

let mockAuth: {
  biometricEnrollmentAvailable: boolean;
  refreshUser: jest.Mock<Promise<void>, []>;
  user: {
    id: number;
    username: string;
    role: string;
    permissions: string[];
    is_2fa_enabled: boolean;
  };
};

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

jest.mock('../../native/useNativeCommands', () => ({
  useNativeCommands: () => ({ execute: mockExecute }),
}));

jest.mock('../../api/authSecurityApi', () => ({
  listTrustedDevices: jest.fn(async () => []),
  regenerateBackupCodes: jest.fn(async () => []),
  resetOwnTwoFactor: jest.fn(async () => undefined),
  revokeTrustedDevice: jest.fn(async () => undefined),
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'light' } }),
}));

describe('NativeSecuritySettingsScreen biometric enrollment', () => {
  beforeEach(() => {
    mockExecute.mockClear();
    jest.mocked(router.push).mockClear();
    mockAuth = {
      biometricEnrollmentAvailable: false,
      refreshUser: jest.fn(async () => undefined),
      user: {
        id: 7,
        username: 'mobile-test',
        role: 'viewer',
        permissions: [],
        is_2fa_enabled: true,
      },
    };
  });

  it('offers re-authentication instead of pretending biometrics can be enabled immediately', async () => {
    const view = await render(<NativeSecuritySettingsScreen />);

    await waitFor(() => expect(mockExecute).toHaveBeenCalledWith('appLock.getState'));
    expect(view.getByText('Подтвердить вход и 2FA')).toBeTruthy();
    expect(view.queryByText('Включить вход по отпечатку')).toBeNull();
    expect(view.getByText(/До успешного подтверждения текущая сессия и настройки не изменятся/)).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByTestId('native-security-biometric-action'));
    });

    expect(router.push).toHaveBeenCalledWith('/(auth)/login');
    expect(mockExecute).not.toHaveBeenCalledWith('biometrics.enable');
  });

  it('enables biometrics directly only while a fresh 2FA enrollment code is available', async () => {
    mockAuth.biometricEnrollmentAvailable = true;
    const view = await render(<NativeSecuritySettingsScreen />);

    await waitFor(() => expect(view.getByText('Включить вход по отпечатку')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('native-security-biometric-action'));
    });

    await waitFor(() => expect(mockExecute).toHaveBeenCalledWith('biometrics.enable'));
    expect(router.push).not.toHaveBeenCalled();
  });

  it('keeps biometric enrollment unavailable until 2FA is configured', async () => {
    mockAuth.user.is_2fa_enabled = false;
    const view = await render(<NativeSecuritySettingsScreen />);

    await waitFor(() => expect(view.getByText('Сначала настройте 2FA')).toBeTruthy());
    expect(view.getByText(/Вход по отпечатку недоступен без 2FA/)).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByTestId('native-security-biometric-action'));
    });
    expect(router.push).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalledWith('biometrics.enable');
  });
});
