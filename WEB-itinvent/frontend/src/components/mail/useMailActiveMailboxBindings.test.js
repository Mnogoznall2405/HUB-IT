import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import useMailActiveMailboxBindings from './useMailActiveMailboxBindings';

describe('useMailActiveMailboxBindings', () => {
  it('adds the active mailbox id to params and payload', () => {
    const { result } = renderHook(() => useMailActiveMailboxBindings({
      activeMailboxId: 'mb-1',
      composeFromOptions: [{ id: 'mb-fallback' }],
    }));

    expect(result.current.withActiveMailboxParams({ folder: 'inbox' })).toEqual({
      folder: 'inbox',
      mailbox_id: 'mb-1',
    });
    expect(result.current.withActiveMailboxPayload({ id: 'msg-1' })).toEqual({
      id: 'msg-1',
      mailbox_id: 'mb-1',
    });
  });

  it('resolves item and compose mailbox ids from the item, then active, then fallback', () => {
    const { result } = renderHook(() => useMailActiveMailboxBindings({
      activeMailboxId: 'mb-active',
      composeFromOptions: [{ id: 'mb-fallback' }],
    }));

    expect(result.current.resolveItemMailboxId({ mailbox_id: 'mb-item' })).toBe('mb-item');
    expect(result.current.resolveItemMailboxId({})).toBe('mb-active');
    expect(result.current.resolveComposeMailboxId('mb-compose')).toBe('mb-compose');
    expect(result.current.resolveComposeMailboxId('')).toBe('mb-active');
  });

  it('falls back to the first compose option when no active mailbox is selected', () => {
    const { result } = renderHook(() => useMailActiveMailboxBindings({
      activeMailboxId: '',
      composeFromOptions: [{ id: 'mb-fallback' }],
    }));

    expect(result.current.withActiveMailboxParams({ folder: 'inbox' })).toEqual({ folder: 'inbox' });
    expect(result.current.resolveComposeMailboxId('')).toBe('mb-fallback');
    expect(result.current.resolveItemMailboxId({})).toBe('');
  });
});
