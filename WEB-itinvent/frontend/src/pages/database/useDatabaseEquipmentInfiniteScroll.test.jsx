import { render, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { useDatabaseEquipmentInfiniteScroll } from './useDatabaseEquipmentInfiniteScroll';

function installIntersectionObserverMock() {
  const instances = [];
  const OriginalIntersectionObserver = window.IntersectionObserver;

  class MockIntersectionObserver {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
      instances.push(this);
    }

    observe() {}

    disconnect() {}
  }

  window.IntersectionObserver = MockIntersectionObserver;

  return {
    triggerIntersecting(isIntersecting = true) {
      instances.forEach((instance) => {
        instance.callback([{ isIntersecting }]);
      });
    },
    restore() {
      if (OriginalIntersectionObserver) {
        window.IntersectionObserver = OriginalIntersectionObserver;
      } else {
        delete window.IntersectionObserver;
      }
    },
  };
}

function Harness({ onLoadMore, loading = false }) {
  const sentinelRef = useDatabaseEquipmentInfiniteScroll({
    enabled: true,
    hasMore: true,
    loading,
    onLoadMore,
    nextPage: 3,
    loadedCount: 2,
    serverTotal: 3,
  });

  return <div data-testid="sentinel" ref={sentinelRef} />;
}

describe('useDatabaseEquipmentInfiniteScroll', () => {
  let intersection;

  beforeEach(() => {
    intersection = installIntersectionObserverMock();
  });

  afterEach(() => {
    intersection.restore();
  });

  it('calls onLoadMore when sentinel intersects and loading is idle', () => {
    const onLoadMore = vi.fn();
    render(<Harness onLoadMore={onLoadMore} />);

    act(() => {
      intersection.triggerIntersecting(true);
    });

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('does not call onLoadMore while loading', () => {
    const onLoadMore = vi.fn();
    render(<Harness onLoadMore={onLoadMore} loading />);

    act(() => {
      intersection.triggerIntersecting(true);
    });

    expect(onLoadMore).not.toHaveBeenCalled();
  });
});
