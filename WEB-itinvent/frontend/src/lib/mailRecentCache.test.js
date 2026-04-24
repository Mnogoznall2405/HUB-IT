import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __MAIL_RECENT_CACHE_TESTING__,
  clearAllMailRecentCache,
  clearMailRecentCacheForScope,
  getMailRecentHydration,
  getMailRecentMessageDetail,
  writeMailRecentBootstrap,
  writeMailRecentList,
  writeMailRecentMessageDetail,
} from './mailRecentCache';

describe('mailRecentCache', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearAllMailRecentCache();
    vi.restoreAllMocks();
  });

  it('stores and reads bootstrap and list snapshots for a mailbox scope', () => {
    writeMailRecentBootstrap({
      scope: 'user-1',
      folderSummary: { inbox: { total: 5, unread: 2 } },
      folderTree: [{ id: 'inbox', label: 'Inbox' }],
    });
    writeMailRecentList({
      scope: 'user-1',
      contextKey: 'ctx:inbox',
      listData: {
        items: [{ id: 'msg-1', subject: 'Hello' }],
        total: 1,
        offset: 0,
        limit: 50,
        has_more: false,
      },
    });

    expect(getMailRecentHydration({ scope: 'user-1', contextKey: 'ctx:inbox' })).toEqual(
      expect.objectContaining({
        folderSummary: { inbox: { total: 5, unread: 2 } },
        folderTree: [{ id: 'inbox', label: 'Inbox' }],
        listData: expect.objectContaining({
          items: [{ id: 'msg-1', subject: 'Hello' }],
          total: 1,
        }),
      })
    );
  });

  it('expires stale snapshots and clears scoped cache', () => {
    const baseNow = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(baseNow);

    writeMailRecentBootstrap({
      scope: 'user-1',
      folderSummary: { inbox: { total: 1, unread: 1 } },
      folderTree: [{ id: 'inbox', label: 'Inbox' }],
    });
    writeMailRecentList({
      scope: 'user-1',
      contextKey: 'ctx:inbox',
      listData: { items: [{ id: 'msg-1' }], total: 1 },
    });

    vi.spyOn(Date, 'now').mockReturnValue(baseNow + __MAIL_RECENT_CACHE_TESTING__.MAIL_RECENT_CACHE_TTL_MS + 1000);

    expect(getMailRecentHydration({ scope: 'user-1', contextKey: 'ctx:inbox' })).toBeNull();

    vi.spyOn(Date, 'now').mockReturnValue(baseNow);
    writeMailRecentBootstrap({
      scope: 'user-2',
      folderSummary: { inbox: { total: 2, unread: 0 } },
      folderTree: [{ id: 'inbox', label: 'Inbox' }],
    });
    clearMailRecentCacheForScope('user-2');
    expect(getMailRecentHydration({ scope: 'user-2', contextKey: 'ctx:inbox' })).toBeNull();
  });

  it('stores and reads recent message detail snapshots without attachment bytes', () => {
    writeMailRecentMessageDetail({
      scope: 'user-1',
      message: {
        id: 'msg-42',
        subject: 'Hello',
        sender: 'boss@example.com',
        body_html: '<p>Hello</p>',
        body_text: 'Hello',
        attachments: [
          {
            id: 'att-1',
            name: 'logo.png',
            content_type: 'image/png',
            size: 128,
            is_inline: true,
            inline_src: '/inline/logo.png',
            content: 'should-not-be-stored',
          },
        ],
      },
    });

    expect(getMailRecentMessageDetail({ scope: 'user-1', messageId: 'msg-42' })).toEqual(
      expect.objectContaining({
        id: 'msg-42',
        subject: 'Hello',
        attachments: [
          expect.objectContaining({
            id: 'att-1',
            name: 'logo.png',
            inline_src: '/inline/logo.png',
          }),
        ],
      }),
    );

    const raw = JSON.parse(window.localStorage.getItem(__MAIL_RECENT_CACHE_TESTING__.MAIL_RECENT_CACHE_STORAGE_KEY));
    expect(raw['user-1'].details['msg-42'].data.attachments[0].content).toBeUndefined();
  });
});
