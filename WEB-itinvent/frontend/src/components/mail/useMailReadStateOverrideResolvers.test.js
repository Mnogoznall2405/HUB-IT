import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { setLocalReadStateOverride } from './mailReadStateModel';
import useMailReadStateOverrideResolvers from './useMailReadStateOverrideResolvers';

describe('useMailReadStateOverrideResolvers', () => {
  it('applies a fresh list override and drops a stale one', () => {
    const now = Date.now();
    const localReadStateOverridesRef = {
      current: setLocalReadStateOverride({
        mode: 'messages',
        targetId: 'msg-1',
        isRead: true,
        overrides: new Map(),
        now,
        ttlMs: 60_000,
      }),
    };
    localReadStateOverridesRef.current = setLocalReadStateOverride({
      mode: 'messages',
      targetId: 'msg-stale',
      isRead: true,
      overrides: localReadStateOverridesRef.current,
      now: now - 120_000,
      ttlMs: 60_000,
    });

    const { result } = renderHook(() => useMailReadStateOverrideResolvers({
      localReadStateOverridesRef,
      ttlMs: 60_000,
      viewMode: 'messages',
    }));

    const nextList = result.current.resolveListDataReadStateOverrides({
      items: [
        { id: 'msg-1', is_read: false },
        { id: 'msg-stale', is_read: false },
      ],
    });

    expect(nextList.items.find((item) => item.id === 'msg-1')?.is_read).toBe(true);
    expect(nextList.items.find((item) => item.id === 'msg-stale')?.is_read).toBe(false);
    expect(localReadStateOverridesRef.current.has('messages:msg-stale')).toBe(false);
  });
});
