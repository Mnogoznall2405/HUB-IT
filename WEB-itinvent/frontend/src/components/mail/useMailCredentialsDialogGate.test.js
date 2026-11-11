import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useMailCredentialsDialogGate from './useMailCredentialsDialogGate';

const createDeps = (overrides = {}) => ({
  mailboxInfo: { mailbox_email: 'a@b.c' },
  mailRequiresRelogin: false,
  mailRequiresPassword: false,
  mailboxUsesPrimaryCredentials: false,
  canSaveMailForAllDevices: false,
  mailCredentialsOpen: false,
  mailCredentialsReason: '',
  mailCredentialsError: '',
  selectedIdRef: { current: 'msg-1' },
  openMailCredentialsDialog: vi.fn(),
  closeMailCredentialsDialog: vi.fn(),
  setError: vi.fn(),
  setSelectedId: vi.fn(),
  setSelectedMessage: vi.fn(),
  setSelectedConversation: vi.fn(),
  setSelectedItems: vi.fn(),
  setSelectedByMode: vi.fn(),
  ...overrides,
});

describe('useMailCredentialsDialogGate', () => {
  it('closes the dialog when access is ready', () => {
    const deps = createDeps();
    renderHook(() => useMailCredentialsDialogGate(deps));
    expect(deps.closeMailCredentialsDialog).toHaveBeenCalledTimes(1);
    expect(deps.openMailCredentialsDialog).not.toHaveBeenCalled();
  });

  it('keeps an expired-password dialog open', () => {
    const deps = createDeps({
      mailCredentialsOpen: true,
      mailCredentialsReason: 'expired',
    });
    renderHook(() => useMailCredentialsDialogGate(deps));
    expect(deps.closeMailCredentialsDialog).not.toHaveBeenCalled();
  });

  it('opens the password dialog and clears selection', () => {
    const deps = createDeps({
      mailRequiresPassword: true,
      mailCredentialsError: 'need password',
    });
    renderHook(() => useMailCredentialsDialogGate(deps));
    expect(deps.openMailCredentialsDialog).toHaveBeenCalledWith(deps.mailboxInfo, {
      reason: 'missing',
      errorText: 'need password',
    });
    expect(deps.setSelectedId).toHaveBeenCalledWith('');
    expect(deps.selectedIdRef.current).toBe('');
    expect(deps.setSelectedByMode).toHaveBeenCalledWith({ messages: '', conversations: '' });
  });

  it('asks to re-login via AD for a shared mailbox using primary credentials', () => {
    const deps = createDeps({
      mailRequiresPassword: true,
      mailboxUsesPrimaryCredentials: true,
    });
    renderHook(() => useMailCredentialsDialogGate(deps));
    expect(deps.closeMailCredentialsDialog).toHaveBeenCalled();
    expect(deps.openMailCredentialsDialog).not.toHaveBeenCalled();
    expect(deps.setError).toHaveBeenCalledWith(
      'Для общего ящика нужно заново войти через AD, чтобы обновить пароль основной учетной записи.',
    );
    expect(deps.setSelectedId).toHaveBeenCalledWith('');
  });

  it('closes the dialog on relogin unless save-for-all-devices is available', () => {
    const deps = createDeps({ mailRequiresRelogin: true });
    renderHook(() => useMailCredentialsDialogGate(deps));
    expect(deps.closeMailCredentialsDialog).toHaveBeenCalled();

    const keepOpen = createDeps({
      mailRequiresRelogin: true,
      canSaveMailForAllDevices: true,
    });
    renderHook(() => useMailCredentialsDialogGate(keepOpen));
    expect(keepOpen.closeMailCredentialsDialog).not.toHaveBeenCalled();
  });
});
