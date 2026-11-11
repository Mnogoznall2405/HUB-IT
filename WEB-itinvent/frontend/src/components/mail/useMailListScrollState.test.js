import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MAIL_LIST_VIEW_STATE_STORAGE_KEY } from './mailViewStateModel';
import useMailListScrollState from './useMailListScrollState';

const createSessionStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    dump: () => Object.fromEntries(map.entries()),
  };
};

describe('useMailListScrollState', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists the current list scroll and queues a restore for that context', () => {
    const storage = createSessionStorage();
    vi.stubGlobal('sessionStorage', storage);
    const listViewStateRef = { current: {} };
    const pendingListScrollRestoreRef = { current: null };
    const messageListRef = { current: { scrollTop: 140 } };
    const currentListKeyRef = { current: 'messages:inbox' };

    const { result } = renderHook(() => useMailListScrollState({
      listViewStateRef,
      pendingListScrollRestoreRef,
      messageListRef,
      currentListKeyRef,
      currentListContextKey: 'messages:inbox',
    }));

    act(() => {
      result.current.saveCurrentListScrollPosition({ selectedMessageIdAtOpen: 'msg-9' });
    });

    expect(listViewStateRef.current).toEqual({
      'messages:inbox': { scrollTop: 140, selectedMessageIdAtOpen: 'msg-9' },
    });
    expect(JSON.parse(storage.dump()[MAIL_LIST_VIEW_STATE_STORAGE_KEY])).toEqual({
      'messages:inbox': { scrollTop: 140, selectedMessageIdAtOpen: 'msg-9' },
    });

    act(() => {
      result.current.queueListScrollRestore('messages:inbox');
    });

    expect(pendingListScrollRestoreRef.current).toEqual({
      contextKey: 'messages:inbox',
      scrollTop: 140,
      selectedMessageIdAtOpen: 'msg-9',
    });
  });
});
