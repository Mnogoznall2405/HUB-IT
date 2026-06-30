import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import useChatThreadInteractionController from './useChatThreadInteractionController';

describe('useChatThreadInteractionController', () => {
  it('jumpToLatest clears jump button and scrolls to bottom', async () => {
    const setShowJumpToLatest = vi.fn();
    const scrollThreadBottomIntoView = vi.fn();
    const loadMessages = vi.fn().mockResolvedValue([]);
    const showJumpToLatestRef = { current: true };
    const threadNearBottomRef = { current: false };
    const messagesHasNewerRef = { current: false };

    const { result } = renderHook(() => useChatThreadInteractionController({
      activeConversationIdRef: { current: 'c1' },
      cancelPendingInitialAnchor: vi.fn(),
      clearInitialViewportGuard: vi.fn(),
      isInitialViewportGuardActive: vi.fn(() => false),
      loadMessages,
      logChatDebug: vi.fn(),
      messagesHasNewerRef,
      messagesRef: { current: [] },
      pendingInitialAnchorRef: { current: null },
      queueAutoScroll: vi.fn(),
      scheduleThreadViewportStateSync: vi.fn(),
      scrollThreadBottomIntoView,
      setShowJumpToLatest,
      showJumpToLatestRef,
      suppressThreadScrollCancelRef: { current: false },
      threadNearBottomRef,
    }));

    await act(async () => {
      await result.current.jumpToLatest();
    });

    expect(setShowJumpToLatest).toHaveBeenCalledWith(false);
    expect(showJumpToLatestRef.current).toBe(false);
    expect(threadNearBottomRef.current).toBe(true);
    expect(scrollThreadBottomIntoView).toHaveBeenCalled();
  });
});
