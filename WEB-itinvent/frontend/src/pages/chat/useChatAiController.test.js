import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../api/client', () => ({
  chatAPI: {
    listAiBots: vi.fn().mockResolvedValue({ items: [] }),
    getConversationAiStatus: vi.fn(),
  },
}));

vi.mock('../../lib/swrCache', () => ({
  getOrFetchSWR: vi.fn(),
  peekSWRCache: vi.fn(() => null),
}));

import useChatAiController from './useChatAiController';

describe('useChatAiController', () => {
  it('returns loadAiBots and fetchConversationAiStatus handlers', () => {
    const aiBotsCacheHydratedRef = { current: false };
    const aiBotsRequestSeqRef = { current: 0 };
    const aiBotsLoadingRequestSeqRef = { current: 0 };
    const aiBotsLoadingRef = { current: false };

    const { result } = renderHook(() => useChatAiController({
      userCacheId: 'user-1',
      canUseAiChat: true,
      notifyApiError: vi.fn(),
      setAiBots: vi.fn(),
      setAiBotsLoading: vi.fn(),
      setAiBotsError: vi.fn(),
      setAiStatusByConversation: vi.fn(),
      aiBotsCacheKeyParts: ['ai-bots'],
      aiBotsRequestSeqRef,
      aiBotsLoadingRequestSeqRef,
      aiBotsLoadingRef,
      aiBotsCacheHydratedRef,
    }));

    expect(typeof result.current.loadAiBots).toBe('function');
    expect(typeof result.current.fetchConversationAiStatus).toBe('function');
    expect(typeof result.current.applyAiBotsPayload).toBe('function');
  });
});
