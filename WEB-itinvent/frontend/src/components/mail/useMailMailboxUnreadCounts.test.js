import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import useMailMailboxUnreadCounts from './useMailMailboxUnreadCounts';

const createMailbox = (overrides = {}) => ({
  id: 'mbox-1',
  is_active: true,
  unread_count: 0,
  unread_count_state: 'deferred',
  ...overrides,
});

const renderUnreadHook = ({ mailboxes, activeMailboxId = 'mbox-1', mailAPI } = {}) => {
  const api = mailAPI || {
    getUnreadCount: vi.fn(({ mailboxId }) => Promise.resolve({ unread_count: mailboxId === 'mbox-2' ? 7 : 3 })),
  };

  const rendered = renderHook(() => {
    const [items, setItems] = useState(mailboxes || []);
    const hook = useMailMailboxUnreadCounts({
      mailAPI: api,
      mailboxes: items,
      activeMailboxId,
      setMailboxes: setItems,
    });
    return {
      ...hook,
      mailboxes: items,
    };
  });

  return { ...rendered, mailAPI: api };
};

describe('useMailMailboxUnreadCounts', () => {
  it('skips active, inactive, fresh, and blank mailbox ids', async () => {
    const { result, mailAPI } = renderUnreadHook({
      activeMailboxId: 'mbox-1',
      mailboxes: [
        createMailbox({ id: 'mbox-1', unread_count_state: 'stale' }),
        createMailbox({ id: 'mbox-2', unread_count_state: 'fresh' }),
        createMailbox({ id: 'mbox-3', unread_count_state: 'stale' }),
        createMailbox({ id: 'mbox-4', is_active: false, unread_count_state: 'stale' }),
        createMailbox({ id: '', mailbox_id: '', unread_count_state: 'stale' }),
      ],
    });

    await act(async () => {
      await result.current.refreshMailboxUnreadCounts();
    });

    expect(mailAPI.getUnreadCount).toHaveBeenCalledTimes(1);
    expect(mailAPI.getUnreadCount).toHaveBeenCalledWith({ mailboxId: 'mbox-3' });
  });

  it('updates only fulfilled mailbox counts', async () => {
    const mailAPI = {
      getUnreadCount: vi.fn(({ mailboxId }) => (
        mailboxId === 'mbox-2'
          ? Promise.reject(new Error('mailbox failed'))
          : Promise.resolve({ unread_count: 5 })
      )),
    };
    const { result } = renderUnreadHook({
      activeMailboxId: 'mbox-1',
      mailAPI,
      mailboxes: [
        createMailbox({ id: 'mbox-1', unread_count_state: 'fresh' }),
        createMailbox({ id: 'mbox-2', unread_count: 1, unread_count_state: 'stale' }),
        createMailbox({ id: 'mbox-3', unread_count: 2, unread_count_state: 'stale' }),
      ],
    });

    await act(async () => {
      await result.current.refreshMailboxUnreadCounts();
    });

    expect(result.current.mailboxes).toEqual([
      expect.objectContaining({ id: 'mbox-1', unread_count_state: 'fresh' }),
      expect.objectContaining({ id: 'mbox-2', unread_count: 1, unread_count_state: 'stale' }),
      expect.objectContaining({ id: 'mbox-3', unread_count: 5, unread_count_state: 'fresh' }),
    ]);
  });

  it('respects explicit mailboxIds and force refreshes fresh entries', async () => {
    const { result, mailAPI } = renderUnreadHook({
      activeMailboxId: 'mbox-1',
      mailboxes: [
        createMailbox({ id: 'mbox-1', unread_count_state: 'fresh' }),
        createMailbox({ id: 'mbox-2', unread_count_state: 'fresh' }),
        createMailbox({ id: 'mbox-3', unread_count_state: 'stale' }),
      ],
    });

    await act(async () => {
      await result.current.refreshMailboxUnreadCounts({ mailboxIds: ['mbox-2'], force: true });
    });

    expect(mailAPI.getUnreadCount).toHaveBeenCalledTimes(1);
    expect(mailAPI.getUnreadCount).toHaveBeenCalledWith({ mailboxId: 'mbox-2' });
    expect(result.current.mailboxes.find((item) => item.id === 'mbox-2')).toEqual(
      expect.objectContaining({ unread_count: 7, unread_count_state: 'fresh' }),
    );
  });

  it('dedupes in-flight mailbox refreshes', async () => {
    let resolveUnread;
    const mailAPI = {
      getUnreadCount: vi.fn(() => new Promise((resolve) => {
        resolveUnread = resolve;
      })),
    };
    const { result } = renderUnreadHook({
      activeMailboxId: 'mbox-1',
      mailAPI,
      mailboxes: [
        createMailbox({ id: 'mbox-1', unread_count_state: 'fresh' }),
        createMailbox({ id: 'mbox-2', unread_count_state: 'stale' }),
      ],
    });

    let first;
    let second;
    act(() => {
      first = result.current.refreshMailboxUnreadCounts();
      second = result.current.refreshMailboxUnreadCounts();
    });

    expect(mailAPI.getUnreadCount).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveUnread({ unread_count: 9 });
      await Promise.all([first, second]);
    });

    expect(result.current.mailboxes.find((item) => item.id === 'mbox-2')).toEqual(
      expect.objectContaining({ unread_count: 9, unread_count_state: 'fresh' }),
    );
  });
});
