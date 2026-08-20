import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useMailSelectedMailboxPersistence from './useMailSelectedMailboxPersistence';

describe('useMailSelectedMailboxPersistence', () => {
  it('persists a selected mailbox id', () => {
    const persistSelectedMailboxId = vi.fn();
    renderHook(() => useMailSelectedMailboxPersistence({
      activeMailboxId: 'mb-1',
      persistSelectedMailboxId,
    }));
    expect(persistSelectedMailboxId).toHaveBeenCalledWith('mb-1');
  });

  it('does not persist an empty mailbox id', () => {
    const persistSelectedMailboxId = vi.fn();
    renderHook(() => useMailSelectedMailboxPersistence({
      activeMailboxId: '',
      persistSelectedMailboxId,
    }));
    expect(persistSelectedMailboxId).not.toHaveBeenCalled();
  });
});
