import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import usePasswordVaultAccess from './usePasswordVaultAccess';

const revealEntry = vi.fn();
const copyPasswordWithAutoClear = vi.fn();

vi.mock('../../api/passwords', () => ({
  passwordsAPI: { revealEntry: (...args) => revealEntry(...args) },
}));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 7, username: 'u', is_2fa_enabled: true }, refreshSession: vi.fn() }),
}));
vi.mock('../../contexts/NotificationContext', () => ({
  useNotification: () => ({
    notifySuccess: vi.fn(), notifyInfo: vi.fn(), notifyWarning: vi.fn(), notifyApiError: vi.fn(),
  }),
}));
vi.mock('../../lib/useWebAuthnAvailability', () => ({
  useWebAuthnAvailability: () => ({ webAuthnReady: false }),
}));
vi.mock('./passwordVaultUtils', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    copyPasswordWithAutoClear: (...args) => copyPasswordWithAutoClear(...args),
    readStoredVaultUnlockUntil: () => null,
    writeStoredVaultUnlockUntil: vi.fn(),
  };
});

const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

describe('usePasswordVaultAccess late reveal', () => {
  beforeEach(() => {
    revealEntry.mockReset();
    copyPasswordWithAutoClear.mockReset();
    copyPasswordWithAutoClear.mockResolvedValue(true);
  });

  it('does not restore a revealed password after the window lost focus', async () => {
    const pending = deferred();
    revealEntry.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => usePasswordVaultAccess());

    act(() => { result.current.requestReveal({ id: 'e1' }, 'show'); });
    act(() => { window.dispatchEvent(new Event('blur')); });
    await act(async () => {
      pending.resolve({ password: 'SECRET', unlocked_until: null });
      await settle();
    });

    expect(result.current.revealedPasswords).toEqual({});
  });

  it('does not put a late copy-purpose secret on the clipboard after hide', async () => {
    const pending = deferred();
    revealEntry.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => usePasswordVaultAccess());

    act(() => { result.current.requestReveal({ id: 'e1' }, 'copy'); });
    act(() => { window.dispatchEvent(new Event('blur')); });
    await act(async () => {
      pending.resolve({ password: 'SECRET', unlocked_until: null });
      await settle();
    });

    expect(copyPasswordWithAutoClear).not.toHaveBeenCalled();
  });

  it('reveals normally when no hide happened in between', async () => {
    revealEntry.mockResolvedValueOnce({ password: 'SECRET', unlocked_until: null });
    const { result } = renderHook(() => usePasswordVaultAccess());

    await act(async () => {
      result.current.requestReveal({ id: 'e1' }, 'show');
      await settle();
    });

    expect(result.current.revealedPasswords).toEqual({ e1: 'SECRET' });
  });
});
