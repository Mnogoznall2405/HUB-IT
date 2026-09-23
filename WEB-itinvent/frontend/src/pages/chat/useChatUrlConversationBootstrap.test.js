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

  it('does not rewrite the host route when url synchronization is disabled', async () => {
    const { renderHook } = await import('@testing-library/react');
    const navigate = vi.fn();

    const { unmount } = renderHook(() => useChatUrlConversationBootstrap({
      activeConversationId: 'conv-task-1',
      applyingRequestedConversationRef: { current: '' },
      cancelPendingInitialAnchor: vi.fn(),
      clearStoredConversationState: vi.fn(),
      composePrefillRequested: false,
      conversationBootstrapComplete: true,
      conversations: [{ id: 'conv-task-1' }],
      conversationsLoading: false,
      invalidConversationRef: { current: '' },
      isMobile: false,
      loadConversations: vi.fn().mockResolvedValue([]),
      locationSearch: '?task=task-1&task_detail_view=discussion',
      mobileHistoryReadyRef: { current: false },
      navigate,
      notifyInfo: vi.fn(),
      requestedConversationHandledRef: { current: 'conv-task-1' },
      requestedConversationRetryRef: { current: '' },
      requestedConversationId: 'conv-task-1',
      restoredConversationId: '',
      restoredMobileView: 'inbox',
      setActiveConversationId: vi.fn(),
      setConversationBootstrapComplete: vi.fn(),
      setMobileView: vi.fn(),
      syncConversationInUrl: false,
      writeMobileHistoryState: vi.fn(),
    }));

    expect(navigate).not.toHaveBeenCalled();
    unmount();
  });

  it('keeps the host route when an embedded conversation is unavailable', async () => {
    const { renderHook } = await import('@testing-library/react');
    const navigate = vi.fn();
    const setActiveConversationId = vi.fn();

    const { unmount } = renderHook(() => useChatUrlConversationBootstrap({
      activeConversationId: 'conv-task-1',
      applyingRequestedConversationRef: { current: '' },
      cancelPendingInitialAnchor: vi.fn(),
      clearStoredConversationState: vi.fn(),
      composePrefillRequested: false,
      conversationBootstrapComplete: false,
      conversations: [],
      conversationsLoading: false,
      invalidConversationRef: { current: '' },
      isMobile: false,
      loadConversations: vi.fn().mockResolvedValue([]),
      locationSearch: '?task=task-1&task_detail_view=discussion',
      mobileHistoryReadyRef: { current: false },
      navigate,
      notifyInfo: vi.fn(),
      requestedConversationHandledRef: { current: '' },
      requestedConversationRetryRef: { current: 'conv-task-1' },
      requestedConversationId: 'conv-task-1',
      restoredConversationId: '',
      restoredMobileView: 'inbox',
      setActiveConversationId,
      setConversationBootstrapComplete: vi.fn(),
      setMobileView: vi.fn(),
      syncConversationInUrl: false,
      writeMobileHistoryState: vi.fn(),
    }));

    expect(setActiveConversationId).toHaveBeenCalledWith('');
    expect(navigate).not.toHaveBeenCalled();
    unmount();
  });

  it('fetches a missing requested conversation by id and upserts it instead of toasting', async () => {
    const { renderHook, waitFor } = await import('@testing-library/react');
    const navigate = vi.fn();
    const notifyInfo = vi.fn();
    const setActiveConversationId = vi.fn();
    const upsertConversation = vi.fn();
    const detail = { id: 'conv-task-1', kind: 'task', task_id: 'task-1', title: 'Задача: x' };
    const fetchConversationById = vi.fn().mockResolvedValue(detail);

    const props = {
      activeConversationId: '',
      applyingRequestedConversationRef: { current: '' },
      cancelPendingInitialAnchor: vi.fn(),
      clearStoredConversationState: vi.fn(),
      composePrefillRequested: false,
      conversationBootstrapComplete: false,
      conversations: [{ id: 'other' }],
      conversationsLoading: false,
      fetchConversationById,
      invalidConversationRef: { current: '' },
      isMobile: false,
      loadConversations: vi.fn().mockResolvedValue([]),
      locationSearch: '?task=task-1&task_detail_view=discussion',
      mobileHistoryReadyRef: { current: false },
      navigate,
      notifyInfo,
      requestedConversationHandledRef: { current: '' },
      requestedConversationRetryRef: { current: 'conv-task-1' },
      requestedConversationId: 'conv-task-1',
      restoredConversationId: '',
      restoredMobileView: 'inbox',
      setActiveConversationId,
      setConversationBootstrapComplete: vi.fn(),
      setMobileView: vi.fn(),
      syncConversationInUrl: false,
      upsertConversation,
      writeMobileHistoryState: vi.fn(),
    };

    const { unmount, rerender } = renderHook(
      (currentProps) => useChatUrlConversationBootstrap(currentProps),
      { initialProps: props },
    );

    await waitFor(() => expect(upsertConversation).toHaveBeenCalledWith(detail));
    expect(fetchConversationById).toHaveBeenCalledWith('conv-task-1');
    expect(notifyInfo).not.toHaveBeenCalled();
    expect(setActiveConversationId).not.toHaveBeenCalledWith('');

    // After the upserted conversation reaches the list, the bootstrap applies it.
    rerender({ ...props, conversations: [{ id: 'other' }, detail] });
    await waitFor(() => expect(setActiveConversationId).toHaveBeenCalledWith('conv-task-1'));
    unmount();
  });

  it('declares the conversation unavailable only after fetch-by-id fails', async () => {
    const { renderHook, waitFor } = await import('@testing-library/react');
    const navigate = vi.fn();
    const notifyInfo = vi.fn();
    const setActiveConversationId = vi.fn();
    const upsertConversation = vi.fn();
    const fetchConversationById = vi.fn().mockRejectedValue(Object.assign(new Error('forbidden'), { response: { status: 403 } }));

    const { unmount } = renderHook(() => useChatUrlConversationBootstrap({
      activeConversationId: '',
      applyingRequestedConversationRef: { current: '' },
      cancelPendingInitialAnchor: vi.fn(),
      clearStoredConversationState: vi.fn(),
      composePrefillRequested: false,
      conversationBootstrapComplete: false,
      conversations: [],
      conversationsLoading: false,
      fetchConversationById,
      invalidConversationRef: { current: '' },
      isMobile: false,
      loadConversations: vi.fn().mockResolvedValue([]),
      locationSearch: '?task=task-1&task_detail_view=discussion',
      mobileHistoryReadyRef: { current: false },
      navigate,
      notifyInfo,
      requestedConversationHandledRef: { current: '' },
      requestedConversationRetryRef: { current: 'conv-task-1' },
      requestedConversationId: 'conv-task-1',
      restoredConversationId: '',
      restoredMobileView: 'inbox',
      setActiveConversationId,
      setConversationBootstrapComplete: vi.fn(),
      setMobileView: vi.fn(),
      syncConversationInUrl: false,
      upsertConversation,
      writeMobileHistoryState: vi.fn(),
    }));

    await waitFor(() => expect(notifyInfo).toHaveBeenCalled());
    expect(fetchConversationById).toHaveBeenCalledWith('conv-task-1');
    expect(upsertConversation).not.toHaveBeenCalled();
    expect(setActiveConversationId).toHaveBeenCalledWith('');
    expect(navigate).not.toHaveBeenCalled();
    unmount();
  });
});
