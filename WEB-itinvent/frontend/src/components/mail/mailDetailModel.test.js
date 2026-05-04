import { describe, expect, it } from 'vitest';
import {
  buildMailDetailCacheKey,
  buildMailDetailContextKey,
  createSelectedMessagePreviewShell,
  hasMailDetailBodyContent,
  mergeMessageDetailPreservingBody,
  resolveMailDetailLoadErrorAction,
  resolveMailDetailInitialState,
  shouldForceMailDetailFetch,
  shouldPreferRecentMailMessageDetail,
} from './mailDetailModel';

describe('mailDetailModel', () => {
  it('builds stable detail context keys for messages and conversations', () => {
    expect(buildMailDetailContextKey({
      viewMode: 'messages',
      folder: 'inbox',
      selectedId: 'msg-1',
    })).toBe('messages:inbox:msg-1');
    expect(buildMailDetailContextKey({
      viewMode: 'conversations',
      folder: 'sent',
      selectedId: 'conv-1',
    })).toBe('conversations:sent:conv-1');
  });

  it('builds message and conversation cache keys with the same domain shape as list model helpers', () => {
    expect(buildMailDetailCacheKey({
      viewMode: 'messages',
      scope: 'mailbox-a',
      selectedId: 'msg-1',
      folder: 'inbox',
      folderScope: 'current',
    })).toEqual(['mail', 'mailbox-a', 'message-detail', 'msg-1']);

    expect(buildMailDetailCacheKey({
      viewMode: 'conversations',
      scope: 'mailbox-a',
      selectedId: 'conv-1',
      folder: 'inbox',
      folderScope: 'all',
    })).toEqual(['mail', 'mailbox-a', 'conversation-detail', 'conv-1', 'inbox', 'all']);
  });

  it('prefers recent message detail only when it has body content missing from cache', () => {
    const recentDetail = { id: 'msg-1', body_html: '<p>Cached body</p>' };

    expect(shouldPreferRecentMailMessageDetail({
      viewMode: 'messages',
      cachedDetail: { data: { id: 'msg-1', body_html: '' } },
      recentDetail,
    })).toBe(true);

    expect(shouldPreferRecentMailMessageDetail({
      viewMode: 'messages',
      cachedDetail: { data: { id: 'msg-1', body_text: 'Already loaded' } },
      recentDetail,
    })).toBe(false);

    expect(shouldPreferRecentMailMessageDetail({
      viewMode: 'conversations',
      cachedDetail: null,
      recentDetail,
    })).toBe(false);
  });

  it('detects usable detail body content and force-fetch intent', () => {
    expect(hasMailDetailBodyContent({ body_html: '  ', body_text: '' })).toBe(false);
    expect(hasMailDetailBodyContent({ body_text: 'plain text' })).toBe(true);
    expect(shouldForceMailDetailFetch({ force: false, cachedDetail: null })).toBe(false);
    expect(shouldForceMailDetailFetch({ force: false, cachedDetail: { data: { id: 'msg-1' } } })).toBe(true);
    expect(shouldForceMailDetailFetch({ force: true, cachedDetail: null })).toBe(true);
  });

  it('creates a selected message preview shell from a list item without pretending it has full body', () => {
    expect(createSelectedMessagePreviewShell({
      id: ' msg-1 ',
      folder: 'inbox',
      subject: 'Hello',
      sender: 'sender@example.com',
      body_preview: 'Short preview',
      is_read: false,
      conversation_id: 'conv-1',
      categories: ['blue'],
    }, 'sent')).toMatchObject({
      id: 'msg-1',
      folder: 'inbox',
      subject: 'Hello',
      body_html: '',
      body_text: 'Short preview',
      is_read: false,
      attachments: [],
      conversation_id: 'conv-1',
      categories: ['blue'],
      can_archive: true,
      __previewOnly: true,
    });
    expect(createSelectedMessagePreviewShell({ id: '' })).toBeNull();
  });

  it('preserves a loaded message body when a live detail response arrives without body content', () => {
    const merged = mergeMessageDetailPreservingBody({
      nextMessage: { id: 'msg-1', subject: 'Updated', body_html: '', attachments: [] },
      previousMessage: {
        id: 'msg-1',
        subject: 'Old',
        body_html: '<p>Loaded body</p>',
        attachments: [{ id: 'att-1' }],
      },
    });

    expect(merged).toMatchObject({
      id: 'msg-1',
      subject: 'Updated',
      body_html: '<p>Loaded body</p>',
      attachments: [{ id: 'att-1' }],
    });
  });

  it('does not preserve body across different messages or when the live response has body content', () => {
    expect(mergeMessageDetailPreservingBody({
      nextMessage: { id: 'msg-2', body_html: '' },
      previousMessage: { id: 'msg-1', body_html: '<p>Old</p>' },
    })).toEqual({ id: 'msg-2', body_html: '' });

    expect(mergeMessageDetailPreservingBody({
      nextMessage: { id: 'msg-1', body_html: '<p>Fresh</p>' },
      previousMessage: { id: 'msg-1', body_html: '<p>Old</p>' },
    })).toEqual({ id: 'msg-1', body_html: '<p>Fresh</p>' });
  });

  it('hydrates initial detail from cache before showing a skeleton', () => {
    expect(resolveMailDetailInitialState({
      cachedDetail: { data: { id: 'msg-1', body_html: '<p>Cached</p>' } },
      recentDetail: { id: 'msg-1', body_html: '<p>Recent</p>' },
      shouldShowSkeleton: true,
    })).toMatchObject({
      detail: { id: 'msg-1', body_html: '<p>Cached</p>' },
      source: 'cache',
      shouldShowLoading: false,
    });
  });

  it('uses a recent message snapshot when the cached detail has no body yet', () => {
    expect(resolveMailDetailInitialState({
      viewMode: 'messages',
      cachedDetail: { data: { id: 'msg-1', body_html: '' } },
      recentDetail: { id: 'msg-1', body_html: '<p>Recent body</p>' },
      shouldShowSkeleton: true,
    })).toMatchObject({
      detail: { id: 'msg-1', body_html: '<p>Recent body</p>' },
      source: 'recent',
      shouldShowLoading: false,
    });
  });

  it('returns skeleton intent when no initial detail exists', () => {
    expect(resolveMailDetailInitialState({
      cachedDetail: null,
      recentDetail: null,
      shouldShowSkeleton: true,
    })).toMatchObject({
      detail: null,
      source: 'none',
      shouldShowLoading: true,
    });
  });

  it('clears one-shot auto-read suppression only when an initial detail is applied', () => {
    const withDetail = resolveMailDetailInitialState({
      cachedDetail: { data: { id: 'msg-1', body_html: '<p>Cached</p>' } },
      detailContextKey: 'messages:inbox:msg-1',
      suppressAutoReadKey: 'messages:inbox:msg-1',
    });
    const withoutDetail = resolveMailDetailInitialState({
      cachedDetail: null,
      recentDetail: null,
      detailContextKey: 'messages:inbox:msg-1',
      suppressAutoReadKey: 'messages:inbox:msg-1',
    });

    expect(withDetail).toMatchObject({
      suppressAutoRead: true,
      nextSuppressAutoReadKey: '',
    });
    expect(withoutDetail).toMatchObject({
      suppressAutoRead: false,
      nextSuppressAutoReadKey: 'messages:inbox:msg-1',
    });
  });

  it('chooses detail error recovery actions without touching runtime state', () => {
    expect(resolveMailDetailLoadErrorAction({
      viewMode: 'conversations',
      requestError: { response: { status: 404 } },
    })).toEqual({ type: 'clear-conversation-selection' });

    expect(resolveMailDetailLoadErrorAction({
      viewMode: 'messages',
      requestError: { response: { status: 400 } },
      errorDetail: 'Message not found: msg-1',
      isMissingDetailError: () => true,
    })).toEqual({
      type: 'clear-missing-message-selection',
      userMessage: 'Выбранное письмо больше недоступно. Список обновлен.',
    });

    expect(resolveMailDetailLoadErrorAction({
      viewMode: 'messages',
      requestError: { code: 'ERR_NETWORK' },
      hasStableSelectedMessageBody: true,
      isTransientRequestError: () => true,
    })).toEqual({ type: 'suppress-transient-error' });

    expect(resolveMailDetailLoadErrorAction({
      viewMode: 'messages',
      requestError: { response: { status: 500 } },
      errorDetail: 'Backend failed',
    })).toEqual({
      type: 'show-error',
      errorDetail: 'Backend failed',
    });
  });
});
