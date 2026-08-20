import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import useMailPendingListScrollRestore from './useMailPendingListScrollRestore';

describe('useMailPendingListScrollRestore', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('restores pending mobile list scroll and then clears the pending entry', () => {
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      cb();
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const pendingListScrollRestoreRef = {
      current: { contextKey: 'messages:inbox', scrollTop: 88 },
    };
    const messageListRef = { current: { scrollTop: 0 } };

    renderHook(() => useMailPendingListScrollRestore({
      isMobile: true,
      hasMobileSelection: false,
      currentListContextKey: 'messages:inbox',
      pendingListScrollRestoreRef,
      messageListRef,
      listItemCount: 3,
      listTotal: 3,
    }));

    expect(messageListRef.current.scrollTop).toBe(88);
    expect(pendingListScrollRestoreRef.current).toBeNull();
  });

  it('does not restore while a mobile preview is open', () => {
    const pendingListScrollRestoreRef = {
      current: { contextKey: 'messages:inbox', scrollTop: 88 },
    };
    const messageListRef = { current: { scrollTop: 0 } };

    renderHook(() => useMailPendingListScrollRestore({
      isMobile: true,
      hasMobileSelection: true,
      currentListContextKey: 'messages:inbox',
      pendingListScrollRestoreRef,
      messageListRef,
      listItemCount: 3,
      listTotal: 3,
    }));

    expect(messageListRef.current.scrollTop).toBe(0);
    expect(pendingListScrollRestoreRef.current.scrollTop).toBe(88);
  });
});
