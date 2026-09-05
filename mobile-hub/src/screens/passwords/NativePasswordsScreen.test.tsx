import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import * as ScreenCapture from 'expo-screen-capture';
import { AppState, type AppStateStatus } from 'react-native';
import * as passwordsApi from '../../api/passwordsApi';
import { unlockBiometricLogin } from '../../auth/biometricAuth';
import { NativePasswordsScreen } from './NativePasswordsScreen';

let mockPermissions = ['passwords.read', 'passwords.write'];
let mockOfflineMode = false;
let mockBiometricEnabled = true;

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 7, role: 'operator', is_2fa_enabled: true },
    biometricEnabled: mockBiometricEnabled,
    offlineMode: mockOfflineMode,
    hasPermission: (permission: string) => mockPermissions.includes(permission),
  }),
}));
jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'system' } }),
}));
jest.mock('../../api/passwordsApi', () => ({
  listPasswordVaultEntries: jest.fn(),
  unlockPasswordVaultWithBiometrics: jest.fn(),
  revealPasswordVaultEntry: jest.fn(),
  updatePasswordVaultEntry: jest.fn(),
}));
jest.mock('../../auth/biometricAuth', () => ({ unlockBiometricLogin: jest.fn() }));
jest.mock('expo-screen-capture', () => ({
  preventScreenCaptureAsync: jest.fn(async () => undefined),
  allowScreenCaptureAsync: jest.fn(async () => undefined),
}));

const entry: passwordsApi.PasswordVaultEntry = {
  id: 'entry-1',
  group: 'Серверы',
  tags: ['prod'],
  login: 'administrator',
  description: 'Основной сервер',
  is_archived: false,
  created_at: '2026-08-20T10:00:00Z',
  updated_at: '2026-08-24T10:00:00Z',
  created_by: 'admin',
  updated_by: 'admin',
  password_configured: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPermissions = ['passwords.read', 'passwords.write'];
  mockOfflineMode = false;
  mockBiometricEnabled = true;
  (passwordsApi.listPasswordVaultEntries as jest.Mock).mockResolvedValue({
    items: [entry], groups: ['Серверы'], tags: ['prod'], unlocked_until: '',
  });
  (unlockBiometricLogin as jest.Mock).mockResolvedValue({
    version: 2,
    user: { id: 7 },
    renewalToken: 'mb1.credential.secret',
  });
  const unlockedUntil = new Date(Date.now() + 5 * 60_000).toISOString();
  (passwordsApi.unlockPasswordVaultWithBiometrics as jest.Mock).mockResolvedValue({
    unlocked_until: unlockedUntil,
  });
  (passwordsApi.revealPasswordVaultEntry as jest.Mock).mockResolvedValue({
    password: 'plain-secret',
    unlocked_until: unlockedUntil,
  });
  (passwordsApi.updatePasswordVaultEntry as jest.Mock).mockResolvedValue(entry);
});

it('protects the screen and reveals a password only after biometric confirmation', async () => {
  const view = await render(<NativePasswordsScreen />);
  await waitFor(() => expect(view.getByText('administrator')).toBeTruthy());
  expect(passwordsApi.listPasswordVaultEntries).toHaveBeenCalledWith(expect.objectContaining({ includeArchived: false, signal: expect.anything() }));
  expect(ScreenCapture.preventScreenCaptureAsync).toHaveBeenCalledWith('hubit-password-vault');

  await fireEvent.press(view.getByTestId('native-password-entry-entry-1'));
  await fireEvent.press(view.getByText('Показать'));
  await waitFor(() => expect(view.getByText('plain-secret')).toBeTruthy());
  expect(unlockBiometricLogin).toHaveBeenCalledTimes(1);
  expect(passwordsApi.unlockPasswordVaultWithBiometrics).toHaveBeenCalledWith('mb1.credential.secret');
  expect(passwordsApi.revealPasswordVaultEntry).toHaveBeenCalledWith('entry-1', 'show');
  await view.unmount();
});

it('copies a password without leaving the plaintext visible', async () => {
  const view = await render(<NativePasswordsScreen />);
  await waitFor(() => expect(view.getByTestId('native-password-entry-entry-1')).toBeTruthy());
  await fireEvent.press(view.getByTestId('native-password-entry-entry-1'));
  await fireEvent.press(view.getByText('Копировать'));
  await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith('plain-secret'));
  expect(view.queryByText('plain-secret')).toBeNull();
  await view.unmount();
});

it('edits metadata and rotates the password after biometric confirmation', async () => {
  const updatedEntry = { ...entry, login: 'administrator-2', description: 'Обновлено' };
  (passwordsApi.updatePasswordVaultEntry as jest.Mock).mockResolvedValue(updatedEntry);
  const view = await render(<NativePasswordsScreen />);
  await waitFor(() => expect(view.getByTestId('native-password-entry-entry-1')).toBeTruthy());

  await fireEvent.press(view.getByTestId('native-password-entry-entry-1'));
  await fireEvent.press(view.getByText('Редактировать'));
  await waitFor(() => expect(view.getByTestId('native-passwords-edit-login')).toBeTruthy());
  await fireEvent.changeText(view.getByTestId('native-passwords-edit-login'), 'administrator-2');
  await fireEvent.changeText(view.getByTestId('native-passwords-edit-description'), 'Обновлено');
  await fireEvent.changeText(view.getByTestId('native-passwords-edit-password'), 'rotated-secret');
  await fireEvent.press(view.getByText('Сохранить'));

  await waitFor(() => expect(passwordsApi.updatePasswordVaultEntry).toHaveBeenCalledWith('entry-1', expect.objectContaining({
    login: 'administrator-2',
    description: 'Обновлено',
    password: 'rotated-secret',
  })));
  expect(view.getAllByText('administrator-2').length).toBeGreaterThan(0);
  await view.unmount();
});

it('keeps editing unavailable without passwords.write', async () => {
  mockPermissions = ['passwords.read'];
  const view = await render(<NativePasswordsScreen />);
  await waitFor(() => expect(view.getByTestId('native-password-entry-entry-1')).toBeTruthy());
  await fireEvent.press(view.getByTestId('native-password-entry-entry-1'));
  expect(view.queryByText('Редактировать')).toBeNull();
  await view.unmount();
});

it('shows retry when metadata request fails', async () => {
  (passwordsApi.listPasswordVaultEntries as jest.Mock)
    .mockRejectedValueOnce(new Error('vault unavailable'))
    .mockResolvedValueOnce({ items: [], groups: [], tags: [], unlocked_until: '' });
  const view = await render(<NativePasswordsScreen />);
  await waitFor(() => expect(view.getByTestId('native-passwords-retry')).toBeTruthy());
  await fireEvent.press(view.getByTestId('native-passwords-retry'));
  await waitFor(() => expect(passwordsApi.listPasswordVaultEntries).toHaveBeenCalledTimes(2));
  await view.unmount();
});

it('does not request the vault without passwords.read or while offline', async () => {
  mockPermissions = [];
  const denied = await render(<NativePasswordsScreen />);
  await waitFor(() => expect(denied.getByText('Нет доступа')).toBeTruthy());
  expect(passwordsApi.listPasswordVaultEntries).not.toHaveBeenCalled();
  await denied.unmount();

  jest.clearAllMocks();
  mockPermissions = ['passwords.read'];
  mockOfflineMode = true;
  const offline = await render(<NativePasswordsScreen />);
  await waitFor(() => expect(offline.getByText(/Автономный режим/)).toBeTruthy());
  expect(passwordsApi.listPasswordVaultEntries).not.toHaveBeenCalled();
  await offline.unmount();
});

it('fails closed when Android screen-capture protection cannot be enabled', async () => {
  (ScreenCapture.preventScreenCaptureAsync as jest.Mock).mockRejectedValueOnce(new Error('FLAG_SECURE unavailable'));

  const view = await render(<NativePasswordsScreen />);

  await waitFor(() => expect(view.getByText('Хранилище заблокировано')).toBeTruthy());
  expect(view.getByTestId('native-passwords-security-retry')).toBeTruthy();
  expect(passwordsApi.listPasswordVaultEntries).not.toHaveBeenCalled();
  expect(view.queryByText('administrator')).toBeNull();
  await view.unmount();
});

it('aborts and clears vault metadata when the app becomes offline', async () => {
  let resolveRequest: (value: unknown) => void = () => undefined;
  (passwordsApi.listPasswordVaultEntries as jest.Mock).mockImplementationOnce(({ signal }) => new Promise((resolve, reject) => {
    resolveRequest = resolve;
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));

  const view = await render(<NativePasswordsScreen />);
  await waitFor(() => expect(passwordsApi.listPasswordVaultEntries).toHaveBeenCalledTimes(1));
  const signal = (passwordsApi.listPasswordVaultEntries as jest.Mock).mock.calls[0][0].signal as AbortSignal;

  mockOfflineMode = true;
  await view.rerender(<NativePasswordsScreen />);
  await waitFor(() => expect(signal.aborted).toBe(true));
  resolveRequest({ items: [entry], groups: ['Серверы'], tags: ['prod'], unlocked_until: '' });

  expect(view.queryByText('administrator')).toBeNull();
  await view.unmount();
});

it('clears the revealed secret as soon as the app leaves the foreground', async () => {
  let onAppStateChange: ((state: AppStateStatus) => void) | null = null;
  const appStateSpy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
    onAppStateChange = listener;
    return { remove: jest.fn() } as never;
  });
  const view = await render(<NativePasswordsScreen />);
  await waitFor(() => expect(view.getByTestId('native-password-entry-entry-1')).toBeTruthy());
  await fireEvent.press(view.getByTestId('native-password-entry-entry-1'));
  await fireEvent.press(view.getByText('Показать'));
  await waitFor(() => expect(view.getByText('plain-secret')).toBeTruthy());

  await act(async () => { onAppStateChange?.('background'); });

  expect(view.queryByText('plain-secret')).toBeNull();
  expect(view.queryByTestId('native-passwords-secret')).toBeNull();
  await view.unmount();
  appStateSpy.mockRestore();
});
