import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildVaultUnlockStorageKey,
  isVaultUnlockRequiredError,
  pickActiveUnlockedUntil,
  readStoredVaultUnlockUntil,
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
