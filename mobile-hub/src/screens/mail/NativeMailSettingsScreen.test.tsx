import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as mailConfigApi from '../../api/mailConfigApi';
import * as mailboxApi from '../../api/mailMailboxesApi';
import { NativeMailSettingsScreen } from './NativeMailSettingsScreen';

let mockPermissions = ['mail.access'];
let mockOffline = false;

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    offlineMode: mockOffline,
    hasPermission: (permission: string) => mockPermissions.includes(permission),
  }),
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'system' } }),
}));

jest.mock('../../navigation/moduleRegistry', () => ({ openPortalPath: jest.fn() }));
jest.mock('../../components/mail/NativeMailHtmlBody', () => ({ NativeMailHtmlBody: () => null }));
jest.mock('../../api/mailMailboxesApi', () => ({ listMailboxes: jest.fn() }));
jest.mock('../../api/mailConfigApi', () => ({
  DEFAULT_NATIVE_MAIL_PREFERENCES: {
    reading_pane: 'right',
    density: 'comfortable',
    mark_read_on_select: false,
    show_preview_snippets: true,
    show_favorites_first: true,
  },
  getNativeMailPreferences: jest.fn(),
  getMyMailConfig: jest.fn(),
  saveMyMailCredentials: jest.fn(),
  testMyMailConnection: jest.fn(),
  updateNativeMailPreferences: jest.fn(),
  updateMyMailSignature: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockPermissions = ['mail.access'];
  mockOffline = false;
  (useLocalSearchParams as jest.Mock).mockReturnValue({ mailboxId: 'box-1' });
  (mailboxApi.listMailboxes as jest.Mock).mockResolvedValue([
    { id: 'box-1', label: 'Рабочая почта', mailbox_email: 'me@example.com', is_primary: true, is_active: true },
  ]);
  (mailConfigApi.getMyMailConfig as jest.Mock).mockResolvedValue({
    mailbox_id: 'box-1',
    label: 'Рабочая почта',
    mailbox_email: 'me@example.com',
    effective_mailbox_login: 'DOMAIN\\me',
    mail_auth_mode: 'stored_credentials',
    mail_signature_html: '<p>Signature</p>',
    mail_is_configured: true,
  });
  (mailConfigApi.testMyMailConnection as jest.Mock).mockResolvedValue({ ok: true });
  (mailConfigApi.getNativeMailPreferences as jest.Mock).mockResolvedValue({
    reading_pane: 'right',
    density: 'comfortable',
    mark_read_on_select: false,
    show_preview_snippets: true,
    show_favorites_first: true,
  });
  (mailConfigApi.updateNativeMailPreferences as jest.Mock).mockResolvedValue({
    reading_pane: 'right',
    density: 'compact',
    mark_read_on_select: true,
    show_preview_snippets: false,
    show_favorites_first: true,
  });
  (mailConfigApi.saveMyMailCredentials as jest.Mock).mockResolvedValue({
    mailbox_id: 'box-1',
    label: 'Рабочая почта',
    mailbox_email: 'new@example.com',
    mailbox_login: 'DOMAIN\\me',
    mail_is_configured: true,
  });
  (mailConfigApi.updateMyMailSignature as jest.Mock).mockResolvedValue({
    mailbox_id: 'box-1',
    label: 'Рабочая почта',
    mailbox_email: 'me@example.com',
    mail_signature_html: '<p><strong>Иван</strong></p>',
    mail_is_configured: true,
  });
});

it('shows mailbox configuration and checks its connection', async () => {
  const view = await render(<NativeMailSettingsScreen />);
  await waitFor(() => expect(view.getByText('Ящик настроен')).toBeTruthy());
  await act(async () => {
    fireEvent.press(view.getByTestId('native-mail-test-connection'));
  });

  expect(mailConfigApi.testMyMailConnection).toHaveBeenCalledWith('box-1');
  await waitFor(() => expect(view.getByText('Соединение с почтовым ящиком работает.')).toBeTruthy());
});

it('opens the existing native mailbox manager in the profile', async () => {
  const view = await render(<NativeMailSettingsScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-manage-mailboxes')).toBeTruthy());
  await fireEvent.press(view.getByTestId('native-mail-manage-mailboxes'));
  expect(router.push).toHaveBeenCalledWith('/(shell)/menu/profile');
});

it('does not load protected configuration without mail.access', async () => {
  mockPermissions = [];
  const view = await render(<NativeMailSettingsScreen />);
  await waitFor(() => expect(view.getByText('Нет доступа')).toBeTruthy());
  expect(mailConfigApi.getMyMailConfig).not.toHaveBeenCalled();
});

it('verifies and saves changed address, login and password in the native flow', async () => {
  const view = await render(<NativeMailSettingsScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-edit-credentials')).toBeTruthy());

  await fireEvent.press(view.getByTestId('native-mail-edit-credentials'));
  await fireEvent.changeText(await view.findByTestId('native-mail-credentials-email'), 'new@example.com');
  await fireEvent.changeText(view.getByTestId('native-mail-credentials-password'), 'Secret123!');
  await fireEvent.press(view.getByTestId('native-mail-save-credentials'));

  await waitFor(() => expect(mailConfigApi.saveMyMailCredentials).toHaveBeenCalledWith({
    mailboxId: 'box-1',
    mailboxLogin: 'DOMAIN\\me',
    mailboxPassword: 'Secret123!',
    mailboxEmail: 'new@example.com',
  }));
  await waitFor(() => expect(view.getByText('Адрес и пароль проверены и сохранены.')).toBeTruthy());
});

it('clears a rejected password instead of retaining it in the form', async () => {
  (mailConfigApi.saveMyMailCredentials as jest.Mock).mockRejectedValueOnce(new Error('Exchange rejected credentials'));
  const view = await render(<NativeMailSettingsScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-edit-credentials')).toBeEnabled());
  await fireEvent.press(view.getByTestId('native-mail-edit-credentials'));
  await fireEvent.changeText(await view.findByTestId('native-mail-credentials-password'), 'RejectedSecret!');
  await fireEvent.press(view.getByTestId('native-mail-save-credentials'));

  await waitFor(() => expect(view.getByTestId('native-mail-credentials-password').props.value).toBe(''));
});

it('keeps primary-credential mailboxes read-only in this password form', async () => {
  (mailConfigApi.getMyMailConfig as jest.Mock).mockResolvedValueOnce({
    mailbox_id: 'box-1',
    mailbox_email: 'shared@example.com',
    auth_mode: 'primary_credentials',
    mail_is_configured: true,
  });
  const view = await render(<NativeMailSettingsScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-edit-credentials')).toBeDisabled());
  expect(view.getByText('Этот ящик использует основную AD-учётную запись. Обновите её повторным входом в HUB.')).toBeTruthy();
});

it('sanitizes and saves an HTML signature from the native editor', async () => {
  const view = await render(<NativeMailSettingsScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-edit-signature')).toBeTruthy());

  await fireEvent.press(view.getByTestId('native-mail-edit-signature'));
  await fireEvent.changeText(await view.findByTestId('native-mail-signature-html'), '<p onclick="bad()"><strong>Иван</strong></p><img src="https://tracker">');
  await fireEvent.press(view.getByTestId('native-mail-save-signature'));

  await waitFor(() => expect(mailConfigApi.updateMyMailSignature).toHaveBeenCalledWith('box-1', '<p><strong>Иван</strong></p>'));
  await waitFor(() => expect(view.getByText('Подпись сохранена и будет добавляться к исходящим письмам.')).toBeTruthy());
});

it('updates mobile-relevant list preferences through the existing preferences endpoint', async () => {
  const view = await render(<NativeMailSettingsScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-view-settings')).toBeEnabled());

  await fireEvent.press(view.getByTestId('native-mail-view-settings'));
  await fireEvent.press(await view.findByTestId('native-mail-density-compact'));
  await fireEvent.press(view.getByTestId('native-mail-pref-preview'));
  await fireEvent.press(view.getByTestId('native-mail-pref-auto-read'));
  await fireEvent.press(view.getByTestId('native-mail-save-view-settings'));

  await waitFor(() => expect(mailConfigApi.updateNativeMailPreferences).toHaveBeenCalledWith({
    density: 'compact',
    mark_read_on_select: true,
    show_preview_snippets: false,
    show_favorites_first: true,
  }));
  await waitFor(() => expect(view.getByText('Настройки списка почты сохранены.')).toBeTruthy());
});

it('disables native settings mutations while offline', async () => {
  mockOffline = true;
  const view = await render(<NativeMailSettingsScreen />);
  await waitFor(() => expect(view.getByTestId('native-mail-edit-credentials')).toBeDisabled());
  expect(view.getByTestId('native-mail-edit-signature')).toBeDisabled();
  expect(view.getByTestId('native-mail-view-settings')).toBeDisabled();
  expect(view.getByTestId('native-mail-test-connection')).toBeDisabled();
});
