import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useMailViewRefreshController, { MAIL_ACTIVE_REFRESH_INTERVAL_MS } from './useMailViewRefreshController';

describe('useMailViewRefreshController', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
  });

  afterEach(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
  });

  it('starts the background interval only after the document becomes visible', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const silentRevalidateCurrentMailView = vi.fn();
    renderHook(() => useMailViewRefreshController({ silentRevalidateCurrentMailView }));

    expect(setIntervalSpy.mock.calls.some(([, delay]) => delay === MAIL_ACTIVE_REFRESH_INTERVAL_MS)).toBe(false);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(setIntervalSpy.mock.calls.some(([, delay]) => delay === MAIL_ACTIVE_REFRESH_INTERVAL_MS)).toBe(true);
    setIntervalSpy.mockRestore();
  });
});
