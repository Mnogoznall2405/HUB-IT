import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAIL_VISIBILITY_REFRESH_COALESCE_MS,
  createMailVisibilityRefreshScheduler,
} from './mailVisibilityRefresh';

describe('createMailVisibilityRefreshScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
  });

  it('coalesces overlapping focus and visibility triggers into one refresh', () => {
    const refresh = vi.fn();
    const { schedule } = createMailVisibilityRefreshScheduler(refresh);

    schedule();
    schedule();
    expect(refresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(MAIL_VISIBILITY_REFRESH_COALESCE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith({ reason: 'visibility' });
  });

  it('does not refresh when the document is hidden, including if it hides before the timer fires', () => {
    const refresh = vi.fn();
    const { schedule } = createMailVisibilityRefreshScheduler(refresh);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    schedule();
    vi.advanceTimersByTime(MAIL_VISIBILITY_REFRESH_COALESCE_MS);
    expect(refresh).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    schedule();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    vi.advanceTimersByTime(MAIL_VISIBILITY_REFRESH_COALESCE_MS);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('cancels a pending refresh on unmount', () => {
    const refresh = vi.fn();
    const { schedule, cancel } = createMailVisibilityRefreshScheduler(refresh);

    schedule();
    cancel();
    vi.advanceTimersByTime(MAIL_VISIBILITY_REFRESH_COALESCE_MS);
    expect(refresh).not.toHaveBeenCalled();
  });
});
