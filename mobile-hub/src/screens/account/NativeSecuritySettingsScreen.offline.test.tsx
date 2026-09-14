import { render, waitFor } from '@testing-library/react-native';
import { NativeSecuritySettingsScreen } from './NativeSecuritySettingsScreen';
import { listTrustedDevices } from '../../api/authSecurityApi';

const mockExecute = jest.fn(async () => ({ enabled: true, timeoutSeconds: 900, biometricEnabled: true }));
jest.mock('../../auth/AuthContext', () => ({ useAuth: () => ({
  offlineMode: true, biometricEnrollmentAvailable: false,
  refreshUser: jest.fn(), user: { id: 7, is_2fa_enabled: true },
}) }));
jest.mock('../../native/useNativeCommands', () => ({ useNativeCommands: () => ({ execute: mockExecute }) }));
jest.mock('../../api/authSecurityApi', () => ({
  listTrustedDevices: jest.fn(), regenerateBackupCodes: jest.fn(), resetOwnTwoFactor: jest.fn(), revokeTrustedDevice: jest.fn(),
}));
jest.mock('../../preferences/PreferencesContext', () => ({ usePreferences: () => ({ preferences: { theme_mode: 'light' } }) }));

it('shows the enabled local lock when trusted devices cannot be loaded', async () => {
  jest.mocked(listTrustedDevices).mockRejectedValueOnce(new Error('Offline devices'));
  const view = await render(<NativeSecuritySettingsScreen />);
  await waitFor(() => expect(view.getByText(/Offline devices/)).toBeTruthy());
  expect(view.getByRole('switch', { checked: true })).toBeTruthy();
  expect(view.getByText('Отключить вход по отпечатку')).toBeTruthy();
  expect(view.queryByText('Подтвердить вход и 2FA')).toBeNull();
});

it('shows local lock settings without waiting for the server request', async () => {
  jest.mocked(listTrustedDevices).mockImplementationOnce(() => new Promise(() => {}));
  const view = await render(<NativeSecuritySettingsScreen />);
  await waitFor(() => expect(view.getByRole('switch', { checked: true })).toBeTruthy());
  expect(view.getByText('Отключить вход по отпечатку')).toBeTruthy();
});
