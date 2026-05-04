import { describe, expect, it } from 'vitest';

import {
  buildMailBootstrapCacheKey,
  buildMailConversationDetailCacheKey,
  buildMailFolderSummaryCacheKey,
  buildMailFolderTreeCacheKey,
  buildMailListCacheKey,
  buildMailListRequestContext,
  buildMailListState,
  buildMailMessageDetailCacheKey,
  createEmptyListData,
  isExpandedMailListData,
  isListItemSame,
  normalizeMailListResponse,
} from './mailListModel';

describe('mailListModel cache keys', () => {
  it('normalizes mail list cache key inputs without changing key shape', () => {
    expect(buildMailBootstrapCacheKey({ scope: 'user-1', limit: 0 }))
      .toEqual(['mail', 'user-1', 'bootstrap', 20]);
    expect(buildMailFolderSummaryCacheKey({ scope: 'user-1' }))
      .toEqual(['mail', 'user-1', 'folder-summary']);
    expect(buildMailFolderTreeCacheKey({ scope: 'user-1' }))
      .toEqual(['mail', 'user-1', 'folder-tree']);
    expect(buildMailMessageDetailCacheKey({ scope: 'user-1', messageId: 42 }))
      .toEqual(['mail', 'user-1', 'message-detail', '42']);
    expect(buildMailConversationDetailCacheKey({ scope: 'user-1', conversationId: 7, folder: ' Sent ', folderScope: '' }))
      .toEqual(['mail', 'user-1', 'conversation-detail', '7', 'sent', 'current']);

    expect(buildMailListCacheKey({
      scope: 'user-1',
      folder: ' Inbox ',
      viewMode: 'unknown',
      q: null,
      unreadOnly: true,
      hasAttachmentsOnly: false,
      dateFrom: null,
      dateTo: '2026-05-03',
      folderScope: '',
      fromFilter: 'from@example.com',
      toFilter: null,
      subjectFilter: 'subject',
      bodyFilter: undefined,
      importance: 'high',
      limit: 0,
      offset: undefined,
    })).toEqual([
      'mail',
      'user-1',
      'list',
      'messages',
      'inbox',
      '',
      1,
      0,
      '',
      '2026-05-03',
      'current',
      'from@example.com',
      '',
      'subject',
      '',
      'high',
      50,
      0,
    ]);
  });

  it('builds one list request context for API params, cache key, and bootstrap eligibility', () => {
    const context = buildMailListRequestContext({
      scope: 'user-1',
      folder: ' Inbox ',
      viewMode: 'messages',
      search: '',
      unreadOnly: false,
      hasAttachmentsOnly: false,
      advancedFilters: { folder_scope: 'current' },
      limit: 20,
    });

    expect(context).toMatchObject({
      folder: 'inbox',
      viewMode: 'messages',
      folderScope: 'current',
      usesBootstrapList: true,
      params: {
        folder: 'inbox',
        q: undefined,
        unread_only: undefined,
        has_attachments: undefined,
        folder_scope: 'current',
        limit: 20,
        offset: 0,
      },
      cacheKey: [
        'mail',
        'user-1',
        'list',
        'messages',
        'inbox',
        '',
        0,
        0,
        '',
        '',
        'current',
        '',
        '',
        '',
        '',
        '',
        20,
        0,
      ],
    });
    expect(context.contextKey).toBe(JSON.stringify(context.cacheKey));

    expect(buildMailListRequestContext({
      scope: 'user-1',
      folder: 'inbox',
      viewMode: 'messages',
      search: 'printer',
      advancedFilters: { folder_scope: 'current' },
    }).usesBootstrapList).toBe(false);
  });
});

describe('normalizeMailListResponse', () => {
  it('normalizes missing or partial list payloads', () => {
    const fallbackItems = [{ id: 'm1' }, { id: 'm2' }];

    expect(createEmptyListData()).toEqual({
      items: [],
      total: 0,
      offset: 0,
      limit: 50,
      has_more: false,
      next_offset: null,
      append_offset: null,
      loaded_pages: 0,
      search_limited: false,
      searched_window: 0,
    });

    expect(normalizeMailListResponse({
      items: 'not-an-array',
      total: '',
      offset: '10',
      limit: '',
      has_more: 1,
      next_offset: '50',
      search_limited: true,
      searched_window: '100',
    }, fallbackItems)).toEqual({
      items: fallbackItems,
      total: 2,
      offset: 10,
      limit: 50,
      has_more: true,
      next_offset: '50',
      append_offset: '50',
      loaded_pages: 1,
      search_limited: true,
      searched_window: 100,
    });
  });

  it('detects expanded list data from loaded pages or item count over limit', () => {
    expect(isExpandedMailListData({ loaded_pages: 2, items: [], limit: 50 })).toBe(true);
    expect(isExpandedMailListData({ loaded_pages: 1, items: Array.from({ length: 51 }), limit: 50 })).toBe(true);
    expect(isExpandedMailListData({ loaded_pages: 1, items: Array.from({ length: 50 }), limit: 50 })).toBe(false);
  });
});

describe('buildMailListState', () => {
  it('appends pages while preserving previous duplicate items', () => {
    const previousListData = {
      items: [
        { id: 'm1', subject: 'First' },
        { id: 'm2', subject: 'Previous duplicate' },
      ],
      total: 4,
      limit: 2,
      loaded_pages: 1,
      has_more: true,
      append_offset: 2,
    };
    const nextListData = {
      items: [
        { id: 'm2', subject: 'Incoming duplicate' },
        { id: 'm3', subject: 'Third' },
      ],
      total: 4,
      limit: 2,
      next_offset: 4,
    };

    expect(buildMailListState({
      previousListData,
      nextListData,
      updateMode: 'append',
      selectionMode: 'messages',
    })).toMatchObject({
      items: [
        { id: 'm1', subject: 'First' },
        { id: 'm2', subject: 'Previous duplicate' },
        { id: 'm3', subject: 'Third' },
      ],
      total: 4,
      offset: 0,
      has_more: true,
      next_offset: 4,
      append_offset: 4,
      loaded_pages: 2,
    });
  });

  it('head-merges refreshed items without dropping the preserved tail', () => {
    const previousListData = {
      items: [
        { conversation_id: 'c2', preview: 'old c2' },
        { conversation_id: 'c3', preview: 'c3' },
      ],
      total: 4,
      limit: 2,
      loaded_pages: 2,
      has_more: true,
      append_offset: 40,
    };
    const nextListData = {
      items: [
        { conversation_id: 'c1', preview: 'c1' },
        { conversation_id: 'c2', preview: 'new c2' },
      ],
      total: 4,
      limit: 2,
      next_offset: 20,
    };

    expect(buildMailListState({
      previousListData,
      nextListData,
      updateMode: 'head-merge',
      selectionMode: 'conversations',
    })).toMatchObject({
      items: [
        { conversation_id: 'c1', preview: 'c1' },
        { conversation_id: 'c2', preview: 'new c2' },
        { conversation_id: 'c3', preview: 'c3' },
      ],
      total: 4,
      offset: 0,
      has_more: true,
      next_offset: 20,
      append_offset: 40,
      loaded_pages: 2,
    });
  });
});

describe('isListItemSame', () => {
  it('compares message list items by visible list fields', () => {
    const base = {
      id: 'm1',
      is_read: false,
      received_at: '2026-05-03T10:00:00Z',
      has_attachments: true,
      subject: 'Subject',
      body_preview: 'Preview',
      sender: 'ignored-old',
    };

    expect(isListItemSame(base, { ...base, sender: 'ignored-new' }, 'messages')).toBe(true);
    expect(isListItemSame(base, { ...base, is_read: true }, 'messages')).toBe(false);
    expect(isListItemSame(base, { ...base, subject: 'Changed' }, 'messages')).toBe(false);
  });

  it('compares conversation list items by conversation summary fields', () => {
    const base = {
      conversation_id: 'c1',
      unread_count: 1,
      messages_count: 3,
      last_received_at: '2026-05-03T10:00:00Z',
      has_attachments: false,
      preview: 'Preview',
      subject: 'ignored-old',
    };

    expect(isListItemSame(base, { ...base, subject: 'ignored-new' }, 'conversations')).toBe(true);
    expect(isListItemSame(base, { ...base, unread_count: 2 }, 'conversations')).toBe(false);
    expect(isListItemSame(base, { ...base, preview: 'Changed' }, 'conversations')).toBe(false);
  });
});
