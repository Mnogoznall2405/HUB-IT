import { describe, expect, it, vi } from 'vitest';

import useChatThreadMessageMerge from './useChatThreadMessageMerge';

describe('useChatThreadMessageMerge', () => {
  it('exports a default hook function', () => {
    expect(typeof useChatThreadMessageMerge).toBe('function');
  });

  it('mergeMessageIntoThread replaces optimistic match', async () => {
    const { renderHook, act } = await import('@testing-library/react');
    const optimistic = {
      id: 'optimistic:c1:1',
      renderKey: 'optimistic:c1:1',
      isOptimistic: true,
      optimisticStatus: 'sending',
      conversation_id: 'c1',
      kind: 'text',
      client_message_id: 'client-1',
      body: 'hi',
      created_at: '2026-01-01T00:00:00.000Z',
    };
    const messagesRef = { current: [optimistic] };
    const setMessages = vi.fn((updater) => {
      if (typeof updater === 'function') {
        messagesRef.current = updater(messagesRef.current);
      }
    });

    const { result, unmount } = renderHook(() => useChatThreadMessageMerge({
      activeConversationIdRef: { current: 'c1' },
      isLikelyOptimisticReplacement: (left, right) => (
        left?.client_message_id && left.client_message_id === right?.client_message_id
      ),
      messagesRef,
      promoteConversationToTop: vi.fn(),
      queueAutoScroll: vi.fn(),
      setMessages,
      setViewerLastReadAt: vi.fn(),
      setViewerLastReadMessageId: vi.fn(),
      syncConversationPreview: vi.fn(),
      withStableMessageRenderKey: (message, existing) => ({
        ...message,
        renderKey: existing?.renderKey || message.id,
      }),
    }));

    act(() => {
      result.current.mergeMessageIntoThread({
        id: 'm1',
        is_own: true,
        conversation_id: 'c1',
        kind: 'text',
        client_message_id: 'client-1',
        body: 'hi',
        created_at: '2026-01-01T00:00:01.000Z',
      });
    });

    expect(messagesRef.current).toHaveLength(1);
    expect(messagesRef.current[0]?.id).toBe('m1');
    expect(messagesRef.current[0]?.renderKey).toBe('optimistic:c1:1');

    unmount();
  });

  it('applyOutgoingThreadMessage scrolls when requested', async () => {
    const { renderHook, act } = await import('@testing-library/react');
    const queueAutoScroll = vi.fn();
    const setMessages = vi.fn((updater) => {
      if (typeof updater === 'function') updater([]);
    });

    const { result, unmount } = renderHook(() => useChatThreadMessageMerge({
      activeConversationIdRef: { current: 'c1' },
      isLikelyOptimisticReplacement: vi.fn(),
      messagesRef: { current: [] },
      promoteConversationToTop: vi.fn(),
      queueAutoScroll,
      setMessages,
      setViewerLastReadAt: vi.fn(),
      setViewerLastReadMessageId: vi.fn(),
      syncConversationPreview: vi.fn(),
      withStableMessageRenderKey: (message) => message,
    }));

    act(() => {
      const applied = result.current.applyOutgoingThreadMessage('c1', {
        id: 'm1',
        conversation_id: 'c1',
        created_at: '2026-01-01T00:00:01.000Z',
        is_own: true,
      }, { scroll: true, scrollSource: 'sendMessage' });
      expect(applied).toBe(true);
    });

    expect(queueAutoScroll).toHaveBeenCalledWith('bottom_instant', 'sendMessage', { userInitiated: true });

    unmount();
  });
});
