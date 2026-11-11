import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useMailCredentialsController from './useMailCredentialsController';
import { getMailboxEntryId, mergeMailboxEntries } from './mailMailboxModel';

const createMailAPI = (overrides = {}) => ({
  saveMyCredentials: vi.fn(async () => ({
    mailbox_id: 'mailbox-1',
    mailbox_email: 'user@example.com',
    mailbox_login: 'corp\\user',
    auth_mode: 'stored_credentials',
  })),
  ...overrides,
});

describe('useMailCredentialsController', () => {
  let mailAPI;
  let setMailboxInfo;
  let setMailboxes;
  let setSelectedMailboxId;
  let refreshConfig;
  let refreshBootstrap;
  let invalidateMailClientCache;
  let onError;
  let onMessage;

  const mailboxInfo = {
    mailbox_id: 'mailbox-1',
    mailbox_email: 'user@example.com',
    mailbox_login: 'corp\\user',
    effective_mailbox_login: 'corp\\user',
    auth_mode: 'stored_credentials',
  };

  const renderCredentialsHook = (overrides = {}) => renderHook(() => useMailCredentialsController({
    mailAPI,
    activeMailboxId: 'mailbox-1',
    mailboxInfo,
    setMailboxInfo,
    setMailboxes,
    setSelectedMailboxId,
    mergeMailboxEntries,
    getMailboxEntryId,
    getMailErrorCode: (error) => String(error?.code || ''),
    getMailErrorDetail: (error, fallback) => error?.detail || fallback,
    refreshConfig,
    refreshBootstrap,
    invalidateMailClientCache,
    onError,
    onMessage,
    ...overrides,
  }));

  beforeEach(() => {
    mailAPI = createMailAPI();
    setMailboxInfo = vi.fn();
    setMailboxes = vi.fn((updater) => (typeof updater === 'function' ? updater([]) : updater));
    setSelectedMailboxId = vi.fn();
    refreshConfig = vi.fn(async () => mailboxInfo);
    refreshBootstrap = vi.fn(async () => ({}));
    invalidateMailClientCache = vi.fn();
    onError = vi.fn();
    onMessage = vi.fn();
  });

  it('opens the dialog for MAIL_PASSWORD_REQUIRED and ignores unrelated errors', async () => {
    const { result } = renderCredentialsHook();

    let handledUnrelated;
    await act(async () => {
      handledUnrelated = await result.current.handleMailCredentialsRequired({ code: 'MAIL_ERROR' }, 'fallback');
    });
    expect(handledUnrelated).toBe(false);
    expect(result.current.mailCredentialsOpen).toBe(false);

    let handled;
    await act(async () => {
      handled = await result.current.handleMailCredentialsRequired(
        { code: 'MAIL_PASSWORD_REQUIRED' },
        'Нужен пароль.',
      );
    });
    expect(handled).toBe(true);
    expect(result.current.mailCredentialsOpen).toBe(true);
    expect(result.current.mailCredentialsReason).toBe('missing');
    expect(onError).toHaveBeenCalledWith('Нужен пароль.');
  });

  it('keeps AUTH_INVALID on the mail page when the mailbox identity is known', async () => {
    const { result } = renderCredentialsHook();

    await act(async () => {
      await result.current.handleMailCredentialsRequired({ code: 'MAIL_AUTH_INVALID' });
    });

    expect(result.current.mailCredentialsOpen).toBe(true);
    expect(result.current.mailCredentialsReason).toBe('expired');
    expect(onError).toHaveBeenCalledWith('Пароль изменился. Обновите его здесь, на странице Почта.');
  });

  it('asks to save shared credentials on MAIL_RELOGIN_REQUIRED for primary_session', async () => {
    refreshConfig.mockResolvedValue({
      ...mailboxInfo,
      auth_mode: 'primary_session',
    });
    const { result } = renderCredentialsHook();

    await act(async () => {
      await result.current.handleMailCredentialsRequired({ code: 'MAIL_RELOGIN_REQUIRED' });
    });

    expect(result.current.mailCredentialsOpen).toBe(true);
    expect(result.current.mailCredentialsReason).toBe('shared');
    expect(onError).toHaveBeenCalledWith(
      'Сохраните корпоративный пароль, чтобы почта снова открывалась без повторного входа.',
    );
  });

  it('does not open the dialog for primary_credentials mailboxes', async () => {
    refreshConfig.mockResolvedValue({
      ...mailboxInfo,
      auth_mode: 'primary_credentials',
    });
    const { result } = renderCredentialsHook();

    await act(async () => {
      await result.current.handleMailCredentialsRequired({ code: 'MAIL_PASSWORD_REQUIRED' });
    });

    expect(result.current.mailCredentialsOpen).toBe(false);
    expect(onError).toHaveBeenCalledWith(
      'Для общего ящика нужно заново войти через AD, чтобы обновить пароль основной учетной записи.',
    );
  });

  it('refuses to save an empty password and persists credentials when present', async () => {
    const { result } = renderCredentialsHook();

    await act(async () => {
      await result.current.handleSaveMailCredentials();
    });
    expect(mailAPI.saveMyCredentials).not.toHaveBeenCalled();
    expect(result.current.mailCredentialsError).toBe('Введите пароль от корпоративного компьютера.');

    await act(async () => {
      result.current.setMailCredentialsPassword('Secret123!');
      result.current.setMailCredentialsLogin('corp\\user');
    });
    await act(async () => {
      await result.current.handleSaveMailCredentials();
    });

    expect(mailAPI.saveMyCredentials).toHaveBeenCalledWith({
      mailbox_id: 'mailbox-1',
      mailbox_login: 'corp\\user',
      mailbox_password: 'Secret123!',
      mailbox_email: undefined,
    });
    expect(result.current.mailCredentialsOpen).toBe(false);
    expect(result.current.mailCredentialsPassword).toBe('');
    expect(onMessage).toHaveBeenCalled();
    expect(refreshBootstrap).toHaveBeenCalledWith({ force: true, live: true });
    expect(invalidateMailClientCache).toHaveBeenCalled();
  });
});
