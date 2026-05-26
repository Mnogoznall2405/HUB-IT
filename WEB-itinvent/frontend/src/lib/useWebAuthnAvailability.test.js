import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WEBAUTHN_READY_EVENT,
  isCapacitorNativeRuntime,
  isWebAuthnApiAvailable,
  useWebAuthnAvailability,
  waitForWebAuthnApi,
} from './useWebAuthnAvailability';

describe('useWebAuthnAvailability', () => {
  beforeEach(() => {
    delete window.PublicKeyCredential;
    window.navigator.credentials = {
      create: vi.fn(),
      get: vi.fn(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns ready immediately when PublicKeyCredential exists', () => {
    window.PublicKeyCredential = function PublicKeyCredential() {};

    const { result } = renderHook(() => useWebAuthnAvailability());

    expect(result.current.webAuthnReady).toBe(true);
    expect(result.current.webAuthnTimedOut).toBe(false);
  });

  it('becomes ready after hubit:webauthn-ready event', async () => {
    const { result } = renderHook(() => useWebAuthnAvailability());

    expect(result.current.webAuthnReady).toBe(false);

    act(() => {
      window.PublicKeyCredential = function PublicKeyCredential() {};
      window.dispatchEvent(new Event(WEBAUTHN_READY_EVENT));
    });

    await waitFor(() => {
      expect(result.current.webAuthnReady).toBe(true);
    });
  });

  it('polls until PublicKeyCredential appears', () => {
    vi.useFakeTimers();

    try {
      const { result } = renderHook(() => useWebAuthnAvailability());

      expect(result.current.webAuthnReady).toBe(false);

      act(() => {
        window.PublicKeyCredential = function PublicKeyCredential() {};
        vi.advanceTimersByTime(100);
      });

      expect(result.current.webAuthnReady).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('isCapacitorNativeRuntime', () => {
  it('is always false after APK removal', () => {
    expect(isCapacitorNativeRuntime()).toBe(false);
  });
});

describe('waitForWebAuthnApi', () => {
  beforeEach(() => {
    delete window.PublicKeyCredential;
  });

  it('waits and resolves when API appears', async () => {
    const pending = waitForWebAuthnApi({ delayMs: 100, maxWaitMs: 500 });

    window.setTimeout(() => {
      window.PublicKeyCredential = function PublicKeyCredential() {};
    }, 50);

    const result = await pending;
    expect(result).toBe(true);
    expect(isWebAuthnApiAvailable()).toBe(true);
  });
});
