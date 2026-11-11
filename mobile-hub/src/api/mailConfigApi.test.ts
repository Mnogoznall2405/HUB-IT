import apiClient from './client';
import {
  getNativeMailPreferences,
  getMyMailConfig,
  saveMyMailCredentials,
  testMyMailConnection,
  updateNativeMailPreferences,
  updateMyMailSignature,
} from './mailConfigApi';

jest.mock('./client', () => ({
  __esModule: true,
  default: { get: jest.fn(), patch: jest.fn(), post: jest.fn() },
}));

it('loads and tests the exact mailbox-scoped native mail configuration', async () => {
  (apiClient.get as jest.Mock).mockResolvedValue({ data: { mailbox_id: 'box/1', mail_is_configured: true } });
  (apiClient.post as jest.Mock).mockResolvedValue({ data: { ok: true } });

  await expect(getMyMailConfig('box/1')).resolves.toMatchObject({ mailbox_id: 'box/1' });
  await expect(testMyMailConnection('box/1')).resolves.toEqual({ ok: true });

  expect(apiClient.get).toHaveBeenCalledWith('/mail/config/me', { params: { mailbox_id: 'box/1' } });
  expect(apiClient.post).toHaveBeenCalledWith('/mail/test-connection', { mailbox_id: 'box/1' });
});

it('updates the mailbox-scoped HTML signature through the existing self-service endpoint', async () => {
  (apiClient.patch as jest.Mock).mockResolvedValue({ data: { mailbox_id: 'box-1', mail_signature_html: '<p>Иван</p>' } });

  await expect(updateMyMailSignature('box-1', '<p>Иван</p>')).resolves.toMatchObject({
    mail_signature_html: '<p>Иван</p>',
  });

  expect(apiClient.patch).toHaveBeenCalledWith('/mail/config/me', {
    mailbox_id: 'box-1',
    mail_signature_html: '<p>Иван</p>',
  });
});

it('verifies and saves changed mailbox credentials without logging or retaining the password', async () => {
  (apiClient.post as jest.Mock).mockResolvedValue({ data: { mailbox_id: 'box-1', mailbox_email: 'new@example.com' } });

  await expect(saveMyMailCredentials({
    mailboxId: 'box-1',
    mailboxLogin: 'DOMAIN\\me',
    mailboxPassword: ' Secret123! ',
    mailboxEmail: 'new@example.com',
  })).resolves.toMatchObject({ mailbox_email: 'new@example.com' });

  expect(apiClient.post).toHaveBeenCalledWith('/mail/config/me/credentials', {
    mailbox_id: 'box-1',
    mailbox_login: 'DOMAIN\\me',
    mailbox_password: 'Secret123!',
    mailbox_email: 'new@example.com',
  });
});

it('rejects an empty mailbox password before the request', async () => {
  await expect(saveMyMailCredentials({ mailboxPassword: '   ' })).rejects.toThrow('Введите корректный пароль');
  expect(apiClient.post).not.toHaveBeenCalled();
});

it('loads and updates the existing user mail preferences contract', async () => {
  (apiClient.get as jest.Mock).mockResolvedValueOnce({
    data: { preferences: { density: 'compact', show_preview_snippets: false } },
  });
  (apiClient.patch as jest.Mock).mockResolvedValueOnce({
    data: { preferences: { density: 'comfortable', show_preview_snippets: true, mark_read_on_select: true } },
  });

  await expect(getNativeMailPreferences()).resolves.toMatchObject({
    density: 'compact',
    show_preview_snippets: false,
    show_favorites_first: true,
  });
  await expect(updateNativeMailPreferences({
    density: 'comfortable',
    show_preview_snippets: true,
    mark_read_on_select: true,
  })).resolves.toMatchObject({
    density: 'comfortable',
    show_preview_snippets: true,
    mark_read_on_select: true,
  });

  expect(apiClient.get).toHaveBeenCalledWith('/mail/preferences');
  expect(apiClient.patch).toHaveBeenCalledWith('/mail/preferences', {
    density: 'comfortable',
    show_preview_snippets: true,
    mark_read_on_select: true,
  });
});

it('rejects an unknown mail list density before the request', async () => {
  await expect(updateNativeMailPreferences({ density: 'wide' })).rejects.toThrow('Некорректная плотность');
  expect(apiClient.patch).not.toHaveBeenCalled();
});
