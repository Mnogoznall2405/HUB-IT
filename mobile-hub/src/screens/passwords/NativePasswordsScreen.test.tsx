import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as ScreenCapture from 'expo-screen-capture';
import * as passwordsApi from '../../api/passwordsApi';
import { NativePasswordsScreen } from './NativePasswordsScreen';

let mockPermissions = ['passwords.read', 'passwords.write'];
let mockOfflineMode = false;

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 7, role: 'operator', is_2fa_enabled: true },
    offlineMode: mockOfflineMode,
    hasPermission: (permission: string) => mockPermissions.includes(permission),
  }),
}));
jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'system' } }),
}));
jest.mock('../../api/passwordsApi', () => ({ listPasswordVaultEntries: jest.fn() }));
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
  (passwordsApi.listPasswordVaultEntries as jest.Mock).mockResolvedValue({
    items: [entry], groups: ['Серверы'], tags: ['prod'], unlocked_until: '',
  });
});

it('loads only vault metadata and protects the active screen from capture', async () => {
  const view = await render(<NativePasswordsScreen />);
  await waitFor(() => expect(view.getByText('administrator')).toBeTruthy());
  expect(passwordsApi.listPasswordVaultEntries).toHaveBeenCalledWith(expect.objectContaining({ includeArchived: false, signal: expect.anything() }));
  expect(ScreenCapture.preventScreenCaptureAsync).toHaveBeenCalledWith('hubit-password-vault-metadata');

  await fireEvent.press(view.getByTestId('native-password-entry-entry-1'));
  await waitFor(() => expect(view.getByText('Пароль не загружается в APK')).toBeTruthy());
  expect(view.queryByText('Показать')).toBeNull();
  expect(view.queryByText('Копировать пароль')).toBeNull();
  expect(view.queryByText('Разблокировать')).toBeNull();
  await view.unmount();
});

it('shows metadata without exposing secret or web actions', async () => {
  const view = await render(<NativePasswordsScreen />);
  await waitFor(() => expect(view.getByTestId('native-password-entry-entry-1')).toBeTruthy());
  expect(view.queryByTestId('native-passwords-open-web')).toBeNull();

  await fireEvent.press(view.getByTestId('native-password-entry-entry-1'));
  await waitFor(() => expect(view.getByText('Пароль не загружается в APK')).toBeTruthy());
  expect(view.queryByTestId('native-passwords-entry-open-web')).toBeNull();
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
