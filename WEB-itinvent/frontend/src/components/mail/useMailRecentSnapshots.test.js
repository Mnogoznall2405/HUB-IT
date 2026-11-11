import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearAllMailRecentCache, getMailRecentHydration } from '../../lib/mailRecentCache';
import useMailRecentSnapshots from './useMailRecentSnapshots';

describe('useMailRecentSnapshots', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    clearAllMailRecentCache();
  });

  it('persists bootstrap and normalized list snapshots for the active scope', () => {
    const { result } = renderHook(() => useMailRecentSnapshots({
      scope: 'mailbox-1',
      initialScope: 'user-1',
    }));

    act(() => {
      result.current.persistBootstrapSnapshot(
        { inbox: { total: 3, unread: 1 } },
        [{ id: 'inbox', label: 'Inbox' }],
      );
      result.current.persistListSnapshot('ctx:inbox', {
        items: [{ id: 'msg-1', subject: 'Hello' }],
        has_more: false,
      });
    });

    expect(getMailRecentHydration({ scope: 'mailbox-1', contextKey: 'ctx:inbox' })).toEqual(
      expect.objectContaining({
        folderSummary: { inbox: { total: 3, unread: 1 } },
        folderTree: [{ id: 'inbox', label: 'Inbox' }],
        listData: expect.objectContaining({
          items: [{ id: 'msg-1', subject: 'Hello' }],
          total: 1,
        }),
      }),
    );
  });

  it('falls back to the initial scope when a detail is missing from the active scope', () => {
    const initial = renderHook(() => useMailRecentSnapshots({ scope: 'user-1' }));

    act(() => {
      initial.result.current.persistMessageDetailSnapshot({
        id: 'msg-42',
        subject: 'Cached before mailbox switch',
        body_html: '<p>Hello</p>',
      });
    });

    const active = renderHook(() => useMailRecentSnapshots({
      scope: 'mailbox-1',
      initialScope: 'user-1',
    }));

    expect(active.result.current.getMessageDetailSnapshot('msg-42')).toEqual(
      expect.objectContaining({
        id: 'msg-42',
        subject: 'Cached before mailbox switch',
        body_html: '<p>Hello</p>',
      }),
    );
  });

  it('ignores empty context keys and message payloads', () => {
    const { result } = renderHook(() => useMailRecentSnapshots({ scope: 'mailbox-1' }));

    act(() => {
      result.current.persistListSnapshot('', { items: [{ id: 'msg-1' }] });
      result.current.persistMessageDetailSnapshot(null);
      result.current.persistMessageDetailSnapshot({ id: '' });
    });

    expect(getMailRecentHydration({ scope: 'mailbox-1', contextKey: '' })).toBeNull();
    expect(result.current.getMessageDetailSnapshot('msg-1')).toBeNull();
  });
});
