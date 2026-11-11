import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as passwordsApi from '../../api/passwordsApi';
import type { PasswordVaultEntry } from '../../api/passwordsApi';
import { NativePasswordsScreen } from './NativePasswordsScreen';

const mockPasswordCardRender = jest.fn();

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 7 },
    biometricEnabled: true,
    offlineMode: false,
    hasPermission: () => true,
  }),
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'dark' } }),
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

jest.mock('../../components/passwords/NativePasswordEntryCard', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    NativePasswordEntryCard: React.memo(({ entry }: { entry: PasswordVaultEntry }) => {
      mockPasswordCardRender(entry.id);
      return React.createElement(Text, null, entry.login);
    }),
  };
});

const entries = Array.from({ length: 30 }, (_, index) => ({
  id: `entry-${index}`,
  group: 'Серверы',
  tags: ['prod'],
  login: `user-${String(index).padStart(2, '0')}`,
  description: 'Стабильное описание',
  is_archived: false,
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-02T10:00:00Z',
  created_by: 'admin',
  updated_by: 'admin',
  password_configured: true,
})) as PasswordVaultEntry[];

const mockedApi = passwordsApi as jest.Mocked<typeof passwordsApi>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.listPasswordVaultEntries.mockResolvedValue({
    items: entries,
    groups: ['Серверы'],
    tags: ['prod'],
    unlocked_until: '',
  });
});

it('does not rerender mounted password cards for a draft keystroke or refresh spinner', async () => {
  const view = await render(<NativePasswordsScreen />);
  await waitFor(() => expect(view.getByText('user-09')).toBeTruthy());
  mockPasswordCardRender.mockClear();

  await fireEvent.changeText(view.getByTestId('native-passwords-search'), 'u');
  const draftTypingRenders = mockPasswordCardRender.mock.calls.length;
  mockPasswordCardRender.mockClear();

  mockedApi.listPasswordVaultEntries.mockReturnValueOnce(new Promise(() => undefined));
  await act(async () => {
    view.getByTestId('native-passwords-list').props.onRefresh();
  });
  const refreshSpinnerRenders = mockPasswordCardRender.mock.calls.length;

  expect({ draftTypingRenders, refreshSpinnerRenders }).toEqual({
    draftTypingRenders: 0,
    refreshSpinnerRenders: 0,
  });
});
