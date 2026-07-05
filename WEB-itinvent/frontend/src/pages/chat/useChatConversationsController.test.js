import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import useChatConversationsController from './useChatConversationsController';

vi.mock('../../api/client', () => ({
  chatAPI: {
    getConversations: vi.fn(),
  },
}));

vi.mock('../../lib/chatFeature', () => ({
  CHAT_FEATURE_ENABLED: true,
}));

vi.mock('../../lib/swrCache', () => ({
  getOrFetchSWR: vi.fn(),
  peekSWRCache: vi.fn(() => null),
}));

import { chatAPI } from '../../api/client';
import { getOrFetchSWR } from '../../lib/swrCache';

describe('useChatConversationsController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applyConversationsPayload sorts items and updates refs', () => {
    const setConversations = vi.fn();
    const conversationsRef = { current: [] };
    const conversationsCacheHydratedRef = { current: false };
    const lastConversationsLoadAtRef = { current: 0 };
    const sidebarScrollRef = { current: { scrollTop: 0 } };

    const { result } = renderHook(() => useChatConversationsController({
      userCacheId: 'u1',
      notifyApiError: vi.fn(),
      setConversations,
      setConversationsLoading: vi.fn(),
      conversationsRequestSeqRef: { current: 0 },
      conversationsLoadingRequestSeqRef: { current: 0 },
      conversationsLoadingRef: { current: false },
      conversationsRef,
      conversationsCacheKeyParts: ['chat', 'conversations', 'u1'],
      conversationsCacheHydratedRef,
      lastConversationsLoadAtRef,
      sidebarScrollRef,
    }));

    const items = result.current.applyConversationsPayload({
      items: [{ id: 'b' }, { id: 'a' }],
    });

    expect(items).toHaveLength(2);
    expect(setConversations).toHaveBeenCalledWith(items);
    expect(conversationsRef.current).toEqual(items);
    expect(conversationsCacheHydratedRef.current).toBe(true);
    expect(lastConversationsLoadAtRef.current).toBeGreaterThan(0);
  });

  it('loadConversations fetches via SWR and applies payload', async () => {
    getOrFetchSWR.mockResolvedValue({
      data: { items: [{ id: 'c1', title: 'Chat' }] },
      fromCache: false,
      isFresh: true,
    });

    const setConversations = vi.fn();
    const setConversationsLoading = vi.fn();
    const conversationsRef = { current: [] };

    const { result } = renderHook(() => useChatConversationsController({
      userCacheId: 'u1',
      notifyApiError: vi.fn(),
      setConversations,
      setConversationsLoading,
      conversationsRequestSeqRef: { current: 0 },
      conversationsLoadingRequestSeqRef: { current: 0 },
      conversationsLoadingRef: { current: false },
      conversationsRef,
      conversationsCacheKeyParts: ['chat', 'conversations', 'u1'],
      conversationsCacheHydratedRef: { current: false },
      lastConversationsLoadAtRef: { current: 0 },
      sidebarScrollRef: { current: null },
    }));

    await waitFor(async () => {
      const items = await result.current.loadConversations();
      expect(items).toHaveLength(1);
    });

    expect(chatAPI.getConversations).not.toHaveBeenCalled();
    expect(getOrFetchSWR).toHaveBeenCalled();
    expect(setConversationsLoading).toHaveBeenCalledWith(true);
    expect(setConversationsLoading).toHaveBeenCalledWith(false);
  });
});
