import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSecretWatermark,
  buildVaultSourceTag,
  buildVaultUnlockStorageKey,
  copyPasswordWithAutoClear,
  formatWatermarkDateTime,
  isVaultUnlockRequiredError,
  pickActiveUnlockedUntil,
  readStoredVaultUnlockUntil,
  retryPendingClipboardClear,
  writeStoredVaultUnlockUntil,
} from './passwordVaultUtils';

describe('pickActiveUnlockedUntil', () => {
  it('prefers the latest active unlock timestamp', () => {
    const earlier = new Date(Date.now() + 60_000).toISOString();
    const later = new Date(Date.now() + 240_000).toISOString();

    expect(pickActiveUnlockedUntil(earlier, later)).toBe(later);
    expect(pickActiveUnlockedUntil(null, later)).toBe(later);
    expect(pickActiveUnlockedUntil(earlier, null)).toBe(earlier);
  });

  it('returns null when all candidates are expired or empty', () => {
    const expired = new Date(Date.now() - 60_000).toISOString();
    expect(pickActiveUnlockedUntil(expired, null, '')).toBeNull();
  });
});

describe('vault unlock sessionStorage', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('persists active unlock until per user', () => {
    const until = new Date(Date.now() + 120_000).toISOString();
    writeStoredVaultUnlockUntil(42, until);
    expect(window.sessionStorage.getItem(buildVaultUnlockStorageKey(42))).toBe(until);
    expect(readStoredVaultUnlockUntil(42)).toBe(until);
    expect(readStoredVaultUnlockUntil(99)).toBeNull();
  });

  it('clears expired unlock timestamps', () => {
    const expired = new Date(Date.now() - 60_000).toISOString();
    writeStoredVaultUnlockUntil(1, expired);
    expect(readStoredVaultUnlockUntil(1)).toBeNull();
    expect(window.sessionStorage.getItem(buildVaultUnlockStorageKey(1))).toBeNull();
  });
});

describe('copyPasswordWithAutoClear', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports a failed clear and clears on retry after focus returns', async () => {
    navigator.clipboard.writeText
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
      .mockResolvedValue(undefined);
    const onCleared = vi.fn();
    const onClearFailed = vi.fn();

    await copyPasswordWithAutoClear('secret', { ttlMs: 25_000, onCleared, onClearFailed });
    await vi.advanceTimersByTimeAsync(25_000);

    expect(onClearFailed).toHaveBeenCalledTimes(1);
    expect(onCleared).not.toHaveBeenCalled();

    retryPendingClipboardClear({ onCleared, onClearFailed });
    await vi.waitFor(() => expect(onCleared).toHaveBeenCalledTimes(1));
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('');
  });

  it('skips clearing when the user replaced the clipboard content', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
        readText: vi.fn().mockResolvedValue('other-content'),
      },
    });
    const onCleared = vi.fn();
    const onClearFailed = vi.fn();

    await copyPasswordWithAutoClear('secret', { ttlMs: 25_000, onCleared, onClearFailed });
    await vi.advanceTimersByTimeAsync(25_000);

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(onCleared).not.toHaveBeenCalled();
    expect(onClearFailed).not.toHaveBeenCalled();
  });
});

describe('secret watermark', () => {
  it('renders username, timestamp with seconds and a masked source tag', () => {
    const stamp = buildSecretWatermark('admin', new Date(2026, 8, 17, 14, 32, 15).getTime());
    expect(stamp).toContain('admin');
    expect(stamp).toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(stamp).toContain('src:');
  });

  it('keeps the source tag stable across calls', () => {
    expect(buildVaultSourceTag()).toBe(buildVaultSourceTag());
  });

  it('formats invalid dates as a placeholder', () => {
    expect(formatWatermarkDateTime('not-a-date')).toBe('—');
  });
});

describe('isVaultUnlockRequiredError', () => {
  it('detects unlock-required vault errors', () => {
    expect(isVaultUnlockRequiredError({
      response: { status: 403, data: { detail: 'Password vault unlock is required' } },
    })).toBe(true);
    expect(isVaultUnlockRequiredError({
      response: { status: 403, data: { detail: 'Нужна разблокировка хранилища' } },
    })).toBe(true);
    expect(isVaultUnlockRequiredError({
      response: { status: 404, data: { detail: 'Entry not found' } },
    })).toBe(false);
  });
});
