import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import useMailListLoadMoreObserver from './useMailListLoadMoreObserver';

describe('useMailListLoadMoreObserver', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the next page when the sentinel intersects', () => {
    const loadMoreMessages = vi.fn();
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', vi.fn(function MockObserver(callback) {
      this.observe = observe;
      this.disconnect = disconnect;
      this.trigger = (isIntersecting) => callback([{ isIntersecting }]);
    }));
    const sentinel = {};
    const loadMoreSentinelRef = { current: sentinel };

    const { unmount } = renderHook(() => useMailListLoadMoreObserver({
      loadMoreSentinelRef,
      hasMore: true,
      loadMoreMessages,
    }));

    expect(observe).toHaveBeenCalledWith(sentinel);
    const observer = vi.mocked(IntersectionObserver).mock.results[0].value;
    observer.trigger(true);
    expect(loadMoreMessages).toHaveBeenCalledTimes(1);
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('does not observe when there is no next page', () => {
    const observe = vi.fn();
    vi.stubGlobal('IntersectionObserver', vi.fn(function MockObserver() {
      this.observe = observe;
      this.disconnect = vi.fn();
    }));

    renderHook(() => useMailListLoadMoreObserver({
      loadMoreSentinelRef: { current: {} },
      hasMore: false,
      loadMoreMessages: vi.fn(),
    }));

    expect(IntersectionObserver).not.toHaveBeenCalled();
    expect(observe).not.toHaveBeenCalled();
  });
});
