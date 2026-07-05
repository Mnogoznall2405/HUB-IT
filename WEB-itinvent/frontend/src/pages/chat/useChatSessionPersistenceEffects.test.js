import { describe, expect, it, vi } from 'vitest';

import {
  buildActiveThreadCachePayload,
  resolveLastConversationSessionStorageAction,
  resolveLastMobileViewSessionStorageValue,
  shouldSyncActiveThreadCache,
  shouldSyncAiBotsCache,
  shouldSyncConversationsCache,
  syncLastConversationSessionStorage,
  syncLastMobileViewSessionStorage,
} from './useChatSessionPersistenceEffects';
import useChatSessionPersistenceEffects from './useChatSessionPersistenceEffects';

describe('useChatSessionPersistenceEffects helpers', () => {
  it('shouldSyncConversationsCache requires hydrated ref', () => {
    expect(shouldSyncConversationsCache({ current: true })).toBe(true);
    expect(shouldSyncConversationsCache({ current: false })).toBe(false);
    expect(shouldSyncConversationsCache(null)).toBe(false);
  });

  it('shouldSyncAiBotsCache gates on permission and hydration', () => {
    expect(shouldSyncAiBotsCache({
      canUseAiChat: true,
      aiBotsCacheHydratedRef: { current: true },
    })).toBe(true);
    expect(shouldSyncAiBotsCache({
      canUseAiChat: false,
      aiBotsCacheHydratedRef: { current: true },
    })).toBe(false);
    expect(shouldSyncAiBotsCache({
      canUseAiChat: true,
      aiBotsCacheHydratedRef: { current: false },
    })).toBe(false);
  });

  it('shouldSyncActiveThreadCache matches hydrated conversation id', () => {
    const hydratedRef = { current: 'c-1' };
    expect(shouldSyncActiveThreadCache('c-1', hydratedRef)).toBe(true);
    expect(shouldSyncActiveThreadCache(' c-1 ', hydratedRef)).toBe(true);
    expect(shouldSyncActiveThreadCache('', hydratedRef)).toBe(false);
    expect(shouldSyncActiveThreadCache('c-2', hydratedRef)).toBe(false);
  });

  it('buildActiveThreadCachePayload maps thread cache fields', () => {
    expect(buildActiveThreadCachePayload({
      messages: [{ id: 'm1' }],
      messagesHasMore: true,
      messagesHasNewer: false,
      viewerLastReadMessageId: 'm1',
      viewerLastReadAt: '2026-01-01T00:00:00Z',
    })).toEqual({
      items: [{ id: 'm1' }],
      has_more: true,
      has_older: true,
      has_newer: false,
      viewer_last_read_message_id: 'm1',
      viewer_last_read_at: '2026-01-01T00:00:00Z',
    });
  });

  it('resolveLastConversationSessionStorageAction chooses set or remove', () => {
    expect(resolveLastConversationSessionStorageAction(' c-42 ')).toEqual({
      action: 'set',
      value: 'c-42',
    });
    expect(resolveLastConversationSessionStorageAction('')).toEqual({ action: 'remove' });
  });

  it('resolveLastMobileViewSessionStorageValue maps mobile view', () => {
    expect(resolveLastMobileViewSessionStorageValue('thread')).toBe('thread');
    expect(resolveLastMobileViewSessionStorageValue('inbox')).toBe('inbox');
    expect(resolveLastMobileViewSessionStorageValue('other')).toBe('inbox');
  });

  it('syncLastConversationSessionStorage writes or removes session key', () => {
    const sessionStorage = {
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    syncLastConversationSessionStorage('c-1', 'chat:last-conversation', sessionStorage);
    expect(sessionStorage.setItem).toHaveBeenCalledWith('chat:last-conversation', 'c-1');
    syncLastConversationSessionStorage('', 'chat:last-conversation', sessionStorage);
    expect(sessionStorage.removeItem).toHaveBeenCalledWith('chat:last-conversation');
  });

  it('syncLastMobileViewSessionStorage persists normalized mobile view', () => {
    const sessionStorage = { setItem: vi.fn(), removeItem: vi.fn() };
    syncLastMobileViewSessionStorage('thread', 'chat:last-mobile-view', sessionStorage);
    expect(sessionStorage.setItem).toHaveBeenCalledWith('chat:last-mobile-view', 'thread');
    syncLastMobileViewSessionStorage('inbox', 'chat:last-mobile-view', sessionStorage);
    expect(sessionStorage.setItem).toHaveBeenCalledWith('chat:last-mobile-view', 'inbox');
  });

  it('syncLastConversationSessionStorage ignores storage failures', () => {
    const sessionStorage = {
      setItem: vi.fn(() => {
        throw new Error('quota');
      }),
      removeItem: vi.fn(),
    };
    expect(() => syncLastConversationSessionStorage('c-1', 'key', sessionStorage)).not.toThrow();
  });
});

describe('useChatSessionPersistenceEffects', () => {
  it('exports a default hook function', () => {
    expect(typeof useChatSessionPersistenceEffects).toBe('function');
  });

  it('mounts without throwing when caches are not hydrated', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { unmount } = renderHook(() => useChatSessionPersistenceEffects({
      activeConversationId: '',
      aiBots: [],
      aiBotsCacheHydratedRef: { current: false },
      aiBotsCacheKeyParts: ['ai-bots'],
      canUseAiChat: false,
      conversations: [],
      conversationsCacheHydratedRef: { current: false },
      conversationsCacheKeyParts: ['conversations'],
      hydratedThreadConversationIdRef: { current: '' },
      lastConversationSessionKey: 'chat:last-conversation',
      lastMobileViewSessionKey: 'chat:last-mobile-view',
      messages: [],
      messagesHasMore: false,
      messagesHasNewer: false,
      mobileView: 'inbox',
      userCacheId: 'u1',
      viewerLastReadAt: '',
      viewerLastReadMessageId: '',
    }));
    unmount();
  });
});
