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

  it('matches a numeric conversation id from the list against the url string', async () => {
    const { renderHook } = await import('@testing-library/react');
    const setActiveConversationId = vi.fn();
    const setConversationBootstrapComplete = vi.fn();
    const navigate = vi.fn();

    const { unmount } = renderHook(() => useChatUrlConversationBootstrap({
      activeConversationId: '',
      applyingRequestedConversationRef: { current: '' },
      cancelPendingInitialAnchor: vi.fn(),
      clearStoredConversationState: vi.fn(),
      composePrefillRequested: false,
      conversationBootstrapComplete: false,
      conversations: [{ id: 42 }],
      conversationsLoading: false,
      invalidConversationRef: { current: '' },
      isMobile: false,
      loadConversations: vi.fn().mockResolvedValue([]),
      locationSearch: '?conversation=42&task_layout=split',
      mobileHistoryReadyRef: { current: false },
      navigate,
      notifyInfo: vi.fn(),
      requestedConversationHandledRef: { current: '' },
      requestedConversationRetryRef: { current: '' },
      requestedConversationId: '42',
      restoredConversationId: '',
      restoredMobileView: 'inbox',
      setActiveConversationId,
      setConversationBootstrapComplete,
      setMobileView: vi.fn(),
      writeMobileHistoryState: vi.fn(),
    }));

    expect(setActiveConversationId).toHaveBeenCalledWith('42');
    expect(navigate).not.toHaveBeenCalledWith('/chat', { replace: true });
    unmount();
  });

  it('does not treat a missing conversation as gone while a retry is in flight', async () => {
    const { renderHook } = await import('@testing-library/react');
    const navigate = vi.fn();
    const loadConversations = vi.fn().mockReturnValue(new Promise(() => {}));

    const { unmount, rerender } = renderHook(() => useChatUrlConversationBootstrap({
      activeConversationId: '',
      applyingRequestedConversationRef: { current: '' },
      cancelPendingInitialAnchor: vi.fn(),
      clearStoredConversationState: vi.fn(),
      composePrefillRequested: false,
      conversationBootstrapComplete: false,
      conversations: [{ id: 'other' }],
      conversationsLoading: false,
      invalidConversationRef: { current: '' },
      isMobile: false,
      loadConversations,
      locationSearch: '?conversation=conv-task-1&task_layout=split',
      mobileHistoryReadyRef: { current: false },
      navigate,
      notifyInfo: vi.fn(),
      requestedConversationHandledRef: { current: '' },
      requestedConversationRetryRef: { current: '' },
      requestedConversationId: 'conv-task-1',
      restoredConversationId: '',
      restoredMobileView: 'inbox',
      setActiveConversationId: vi.fn(),
      setConversationBootstrapComplete: vi.fn(),
      setMobileView: vi.fn(),
      writeMobileHistoryState: vi.fn(),
    }));

    expect(loadConversations).toHaveBeenCalledTimes(1);
    rerender();
    expect(navigate).not.toHaveBeenCalledWith('/chat', { replace: true });
    unmount();
  });
});
