import { describe, expect, it, vi } from 'vitest';

import useChatUrlConversationBootstrap from './useChatUrlConversationBootstrap';

// Re-import internal helpers via module re-export pattern: test via hook behavior
// using renderHook for URL sync deferral is covered in Chat.test.jsx for the model;
// here we smoke-test the hook mounts without throwing.

describe('useChatUrlConversationBootstrap', () => {
  it('exports a default hook function', () => {
    expect(typeof useChatUrlConversationBootstrap).toBe('function');
  });

  it('module loads applyRequestedConversation path without error when bootstrap incomplete', async () => {
    const { renderHook } = await import('@testing-library/react');
    const setActiveConversationId = vi.fn();
    const setConversationBootstrapComplete = vi.fn();
    const setMobileView = vi.fn();

    const { unmount } = renderHook(() => useChatUrlConversationBootstrap({
      activeConversationId: '',
      applyingRequestedConversationRef: { current: '' },
      cancelPendingInitialAnchor: vi.fn(),
      clearStoredConversationState: vi.fn(),
      composePrefillRequested: false,
      conversationBootstrapComplete: false,
      conversations: [{ id: 'c1' }],
      conversationsLoading: false,
      invalidConversationRef: { current: '' },
      isMobile: false,
      loadConversations: vi.fn().mockResolvedValue([]),
      locationSearch: '?conversation=c1',
      mobileHistoryReadyRef: { current: false },
      navigate: vi.fn(),
      notifyInfo: vi.fn(),
      requestedConversationHandledRef: { current: '' },
      requestedConversationRetryRef: { current: '' },
      requestedConversationId: 'c1',
      restoredConversationId: '',
      restoredMobileView: 'inbox',
      setActiveConversationId,
      setConversationBootstrapComplete,
      setMobileView,
      writeMobileHistoryState: vi.fn(),
    }));

    expect(setActiveConversationId).toHaveBeenCalledWith('c1');
    expect(setConversationBootstrapComplete).toHaveBeenCalledWith(true);
    unmount();
  });
});
