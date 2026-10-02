import React, { useRef } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chatAPI } from '../../api/client';
import { getOrFetchSWR, peekSWRCache } from '../../lib/swrCache';
import useChatThreadController from './useChatThreadController';

vi.mock('../../api/client', () => ({
  chatAPI: {
    getThreadBootstrap: vi.fn(),
    getMessages: vi.fn(),
  },
}));

vi.mock('../../lib/chatFeature', () => ({
  CHAT_FEATURE_ENABLED: true,
}));

vi.mock('../../lib/debugClientLog', () => ({
  emitAgentDebugLog: vi.fn(),
}));

vi.mock('../../lib/swrCache', () => ({
  getOrFetchSWR: vi.fn(),
  peekSWRCache: vi.fn(() => null),
  setSWRCache: vi.fn(),
}));

function Harness({
  onReady,
  initialThreadCache = null,
  initialConversationId = 'conv-1',
  activeConversationId = 'conv-1',
  loadMessagesRef: loadMessagesRefProp,
  failedThreadMessagesRef: failedThreadMessagesRefProp,
}) {
  const internalLoadMessagesRef = useRef(null);
  const internalFailedThreadMessagesRef = useRef(new Map());
  const loadMessagesRef = loadMessagesRefProp || internalLoadMessagesRef;
  const failedThreadMessagesRef = failedThreadMessagesRefProp || internalFailedThreadMessagesRef;
  const activeConversationIdRef = useRef(activeConversationId);
  activeConversationIdRef.current = activeConversationId;
  const autoScrollRef = useRef(false);
  const autoScrollMetaRef = useRef(null);
  const conversationsRef = useRef([]);
  const threadNearBottomRef = useRef(true);
  const prependScrollRestoreRef = useRef(null);
  const threadLoadAbortRef = useRef(null);
  const threadPrefetchAbortControllersRef = useRef(new Map());
  const loadOlderInFlightCursorRef = useRef('');
  const showJumpToLatestRef = useRef(false);
  const hydratedThreadConversationIdRef = useRef('');
  const logChatDebugRef = useRef(vi.fn());
  const cancelPendingInitialAnchorRef = useRef(vi.fn());
  const scrollToMessageRef = useRef(() => false);
  const scrollThreadBottomIntoViewRef = useRef(vi.fn());
  const isInitialViewportGuardActiveRef = useRef(() => false);
  const capturePrependScrollRestoreRef = useRef(() => null);
  const resolvePendingInitialAnchorFromPayloadRef = useRef(() => false);
  const hasPendingInitialAnchorForConversationRef = useRef(() => false);
  const syncConversationPreviewRef = useRef(vi.fn());

  const controller = useChatThreadController({
    activeConversationId,
    activeConversationIdRef,
    autoScrollMetaRef,
    autoScrollRef,
    cancelPendingInitialAnchorRef,
    capturePrependScrollRestoreRef,
    conversationsRef,
    failedThreadMessagesRef,
    hasPendingInitialAnchorForConversationRef,
    hydratedThreadConversationIdRef,
    initialConversationId,
    initialThreadCache,
    isInitialViewportGuardActiveRef,
    loadMessagesRef,
    loadOlderInFlightCursorRef,
    logChatDebugRef,
    notifyApiError: vi.fn(),
    prependScrollRestoreRef,
    resolvePendingInitialAnchorFromPayloadRef,
    scrollThreadBottomIntoViewRef,
    scrollToMessageRef,
    setShowJumpToLatest: vi.fn(),
    showJumpToLatestRef,
    syncConversationPreviewRef,
    threadLoadAbortRef,
    threadNearBottomRef,
    threadPrefetchAbortControllersRef,
    userCacheId: 'user-1',
  });

  React.useEffect(() => {
    onReady?.(controller);
  }, [controller, onReady]);

  return React.createElement('div', { 'data-testid': 'thread-controller-harness' });
}

describe('useChatThreadController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    peekSWRCache.mockReturnValue(null);
    getOrFetchSWR.mockResolvedValue({
      data: {
        items: [
          { id: 'msg-1', conversation_id: 'conv-1', body: 'hello', created_at: '2026-04-28T08:00:00.000Z' },
        ],
        has_older: false,
        has_newer: false,
        viewer_last_read_message_id: 'msg-1',
        viewer_last_read_at: '2026-04-28T08:00:00.000Z',
      },
    });
    chatAPI.getMessages.mockResolvedValue({
      items: [
        { id: 'msg-0', conversation_id: 'conv-1', body: 'older', created_at: '2026-04-28T07:59:00.000Z' },
      ],
      has_older: false,
      has_more: false,
      has_newer: false,
    });
  });

  it('hydrates initial thread cache into messages state', async () => {
    let api = null;
    const items = Array.from({ length: 40 }, (_, index) => ({
      id: `cached-${index + 1}`,
      conversation_id: 'conv-1',
      body: `cached-${index + 1}`,
      created_at: `2026-04-28T08:${String(index).padStart(2, '0')}:00.000Z`,
    }));
    render(React.createElement(Harness, {
      initialThreadCache: {
        data: {
          items,
          has_more: true,
          has_newer: false,
          viewer_last_read_message_id: 'cached-40',
          viewer_last_read_at: '2026-04-28T08:39:00.000Z',
        },
      },
      onReady: (value) => {
        api = value;
      },
    }));

    await waitFor(() => expect(api?.messages).toHaveLength(40));
    expect(api.messages[0].id).toBe('cached-1');
    expect(api.messagesHasMore).toBe(true);
    expect(api.messagesLoading).toBe(false);
    expect(api.viewerLastReadMessageId).toBe('cached-40');
  });

  it('loads thread bootstrap and applies payload to state', async () => {
    let api = null;
    render(React.createElement(Harness, {
      initialThreadCache: null,
      onReady: (value) => {
        api = value;
      },
    }));

    await waitFor(() => expect(api?.loadThreadBootstrap).toBeTypeOf('function'));

    await act(async () => {
      await api.loadThreadBootstrap('conv-1', { reason: 'test:bootstrap' });
    });

    expect(getOrFetchSWR).toHaveBeenCalled();
    expect(api.messages).toHaveLength(1);
    expect(api.messages[0].id).toBe('msg-1');
    expect(api.messagesLoading).toBe(false);
  });

  it('prepends older messages via loadOlderMessages', async () => {
    let api = null;
    const items = Array.from({ length: 40 }, (_, index) => ({
      id: `msg-${index + 1}`,
      conversation_id: 'conv-1',
      body: `message-${index + 1}`,
      created_at: `2026-04-28T08:${String(index).padStart(2, '0')}:00.000Z`,
    }));
    render(React.createElement(Harness, {
      initialThreadCache: {
        data: {
          items,
          has_more: true,
          has_newer: false,
        },
      },
      onReady: (value) => {
        api = value;
      },
    }));

    await waitFor(() => expect(api?.messagesHasMore).toBe(true));

    await act(async () => {
      await api.loadOlderMessages();
    });

    expect(chatAPI.getMessages).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({
        before_message_id: 'msg-1',
        limit: 50,
      }),
    );
    expect(api.messages.map((message) => message.id)).toEqual(['msg-0', ...items.map((item) => item.id)]);
  });

  it('captures prepend scroll restore snapshot when older history load starts', async () => {
    let api = null;
    let prependScrollRestoreRef = null;
    const capturedRestore = {
      mode: 'scrollHeight',
      virtual: false,
      scrollHeight: 1000,
      scrollTop: 0,
    };

    function CaptureHarness({ onReady }) {
      const activeConversationIdRef = useRef('conv-1');
      prependScrollRestoreRef = useRef(null);
      const capturePrependScrollRestoreRef = useRef(() => capturedRestore);
      const controller = useChatThreadController({
        activeConversationId: 'conv-1',
        activeConversationIdRef,
        autoScrollMetaRef: useRef(null),
        autoScrollRef: useRef(false),
        cancelPendingInitialAnchorRef: useRef(vi.fn()),
        capturePrependScrollRestoreRef,
        conversationsRef: useRef([]),
        hasPendingInitialAnchorForConversationRef: useRef(() => false),
        hydratedThreadConversationIdRef: useRef(''),
        initialConversationId: 'conv-1',
        initialThreadCache: {
          data: {
            items: Array.from({ length: 40 }, (_, index) => ({
              id: `msg-${index + 1}`,
              conversation_id: 'conv-1',
              body: `message-${index + 1}`,
              created_at: `2026-04-28T08:${String(index).padStart(2, '0')}:00.000Z`,
            })),
            has_more: true,
            has_newer: false,
          },
        },
        isInitialViewportGuardActiveRef: useRef(() => false),
        loadOlderInFlightCursorRef: useRef(''),
        logChatDebugRef: useRef(vi.fn()),
        notifyApiError: vi.fn(),
        prependScrollRestoreRef,
        resolvePendingInitialAnchorFromPayloadRef: useRef(() => false),
        scrollThreadBottomIntoViewRef: useRef(vi.fn()),
        scrollToMessageRef: useRef(() => false),
        setShowJumpToLatest: vi.fn(),
        showJumpToLatestRef: useRef(false),
        syncConversationPreviewRef: useRef(vi.fn()),
        threadLoadAbortRef: useRef(null),
        threadNearBottomRef: useRef(false),
        threadPrefetchAbortControllersRef: useRef(new Map()),
        userCacheId: 'user-1',
      });

      React.useEffect(() => {
        onReady?.(controller);
      }, [controller, onReady]);

      return null;
    }

    render(React.createElement(CaptureHarness, {
      onReady: (value) => {
        api = value;
      },
    }));

    await waitFor(() => expect(api?.messagesHasMore).toBe(true));

    await act(async () => {
      await api.loadOlderMessages();
    });

    expect(prependScrollRestoreRef.current).toEqual(capturedRestore);
  });

  it('queues auto-scroll only when viewport guard allows it', async () => {
    let api = null;
    const autoScrollRef = { current: false };
    const autoScrollMetaRef = { current: null };

    function GuardHarness({ onReady }) {
      const activeConversationIdRef = useRef('conv-1');
      const isInitialViewportGuardActiveRef = useRef(() => true);
      const controller = useChatThreadController({
        activeConversationId: 'conv-1',
        activeConversationIdRef,
        autoScrollMetaRef,
        autoScrollRef,
        cancelPendingInitialAnchorRef: useRef(vi.fn()),
        capturePrependScrollRestoreRef: useRef(() => null),
        conversationsRef: useRef([]),
        hasPendingInitialAnchorForConversationRef: useRef(() => false),
        hydratedThreadConversationIdRef: useRef(''),
        initialConversationId: 'conv-1',
        initialThreadCache: null,
        isInitialViewportGuardActiveRef,
        loadOlderInFlightCursorRef: useRef(''),
        logChatDebugRef: useRef(vi.fn()),
        notifyApiError: vi.fn(),
        prependScrollRestoreRef: useRef(null),
        resolvePendingInitialAnchorFromPayloadRef: useRef(() => false),
        scrollThreadBottomIntoViewRef: useRef(vi.fn()),
        scrollToMessageRef: useRef(() => false),
        setShowJumpToLatest: vi.fn(),
        showJumpToLatestRef: useRef(false),
        syncConversationPreviewRef: useRef(vi.fn()),
        threadLoadAbortRef: useRef(null),
        threadNearBottomRef: useRef(true),
        threadPrefetchAbortControllersRef: useRef(new Map()),
        userCacheId: 'user-1',
      });

      React.useEffect(() => {
        onReady?.(controller);
      }, [controller, onReady]);

      return null;
    }

    render(React.createElement(GuardHarness, {
      onReady: (value) => {
        api = value;
      },
    }));
    await waitFor(() => expect(api?.queueAutoScroll).toBeTypeOf('function'));

    const blocked = api.queueAutoScroll('bottom', 'test:blocked');
    expect(blocked).toBe(false);
    expect(autoScrollRef.current).toBe(false);

    const queued = api.queueAutoScroll('bottom', 'test:user', { userInitiated: true });
    expect(queued).toBe(true);
    expect(autoScrollRef.current).toBe('bottom');
    expect(autoScrollMetaRef.current).toMatchObject({
      source: 'test:user',
      userInitiated: true,
    });
  });

  describe('thread load retry (P0-1)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it('retries a transient 503 bootstrap failure and applies the payload', async () => {
      getOrFetchSWR
        .mockRejectedValueOnce({ response: { status: 503 } })
        .mockResolvedValue({
          data: {
            items: [
              { id: 'msg-1', conversation_id: 'conv-1', body: 'hello', created_at: '2026-04-28T08:00:00.000Z' },
            ],
            has_older: false,
            has_newer: false,
          },
        });
      let api = null;
      render(React.createElement(Harness, {
        onReady: (value) => { api = value; },
      }));
      await act(async () => { await Promise.resolve(); });

      await act(async () => {
        await api.loadThreadBootstrap('conv-1', { reason: 'test:bootstrap' });
      });

      expect(api.threadLoadError).toBeNull();
      expect(api.messages).toHaveLength(0);
      expect(getOrFetchSWR).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });

      expect(getOrFetchSWR).toHaveBeenCalledTimes(2);
      expect(api.messages.map((message) => message.id)).toEqual(['msg-1']);
      expect(api.threadLoadError).toBeNull();
    });

    it('sets threadLoadError on a non-transient failure and does not retry', async () => {
      getOrFetchSWR.mockRejectedValue({ response: { status: 403 } });
      let api = null;
      render(React.createElement(Harness, {
        onReady: (value) => { api = value; },
      }));
      await act(async () => { await Promise.resolve(); });

      await act(async () => {
        await api.loadThreadBootstrap('conv-1', { reason: 'test:bootstrap' });
      });

      expect(api.threadLoadError).toMatchObject({ conversationId: 'conv-1' });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60000);
      });
      expect(getOrFetchSWR).toHaveBeenCalledTimes(1);
    });

    it('retryThreadLoad clears the error and reloads the thread', async () => {
      getOrFetchSWR.mockRejectedValueOnce({ response: { status: 403 } });
      let api = null;
      render(React.createElement(Harness, {
        onReady: (value) => { api = value; },
      }));
      await act(async () => { await Promise.resolve(); });

      await act(async () => {
        await api.loadThreadBootstrap('conv-1', { reason: 'test:bootstrap' });
      });
      expect(api.threadLoadError).toMatchObject({ conversationId: 'conv-1' });

      await act(async () => {
        await api.retryThreadLoad();
      });

      expect(getOrFetchSWR).toHaveBeenCalledTimes(2);
      expect(api.messages.map((message) => message.id)).toEqual(['msg-1']);
      expect(api.threadLoadError).toBeNull();
    });
  });

  it('R2: loadMessagesRef points at the real loadMessages callback', async () => {
    let api = null;
    const loadMessagesRef = { current: null };
    render(React.createElement(Harness, {
      loadMessagesRef,
      onReady: (value) => { api = value; },
    }));

    await waitFor(() => expect(loadMessagesRef.current).toBeTypeOf('function'));
    expect(loadMessagesRef.current).toBe(api.loadMessages);

    getOrFetchSWR.mockClear();
    await act(async () => {
      await loadMessagesRef.current('conv-1', { reason: 'test:ref' });
    });
    expect(getOrFetchSWR).toHaveBeenCalled();
    expect(api.messages.map((message) => message.id)).toEqual(['msg-1']);
  });

  it('R4: failed outgoing bubble survives switching A → B → A', async () => {
    const failedThreadMessagesRef = { current: new Map() };
    const failedMessage = {
      id: 'optimistic:1',
      conversation_id: 'conv-1',
      client_message_id: 'cm-1',
      body: 'failed hello',
      created_at: '2026-04-28T08:01:00.000Z',
      isOptimistic: true,
      optimisticStatus: 'failed',
      is_own: true,
    };
    failedThreadMessagesRef.current.set('conv-1', new Map([
      [failedMessage.id, {
        conversationId: 'conv-1',
        clientMessageId: 'cm-1',
        body: failedMessage.body,
        bodyFormat: 'plain',
        replyToMessageId: '',
        message: failedMessage,
      }],
    ]));

    let api = null;
    const { rerender } = render(React.createElement(Harness, {
      failedThreadMessagesRef,
      activeConversationId: 'conv-1',
      onReady: (value) => { api = value; },
    }));

    // Conv A: fresh payload — the failed bubble is merged back in.
    await act(async () => {
      await api.applyLatestThreadPayload('conv-1', {
        items: [
          { id: 'msg-1', conversation_id: 'conv-1', body: 'hello', created_at: '2026-04-28T08:00:00.000Z' },
        ],
        has_older: false,
      });
    });
    await waitFor(() => expect(api.messages.some((m) => m.id === 'optimistic:1')).toBe(true));

    // Switch to conv B — its payload carries only B messages.
    rerender(React.createElement(Harness, {
      failedThreadMessagesRef,
      activeConversationId: 'conv-2',
      onReady: (value) => { api = value; },
    }));
    await act(async () => {
      await api.applyLatestThreadPayload('conv-2', {
        items: [
          { id: 'msg-b1', conversation_id: 'conv-2', body: 'b-hello', created_at: '2026-04-28T08:02:00.000Z' },
        ],
        has_older: false,
      });
    });
    await waitFor(() => expect(api.messages.map((m) => m.id)).toEqual(['msg-b1']));

    // Back to conv A — the failed bubble must be restored from the shared ref
    // even though `current` no longer contains it.
    rerender(React.createElement(Harness, {
      failedThreadMessagesRef,
      activeConversationId: 'conv-1',
      onReady: (value) => { api = value; },
    }));
    await act(async () => {
      await api.applyLatestThreadPayload('conv-1', {
        items: [
          { id: 'msg-1', conversation_id: 'conv-1', body: 'hello', created_at: '2026-04-28T08:00:00.000Z' },
        ],
        has_older: false,
      });
    });
    await waitFor(() => {
      const failed = api.messages.filter((m) => m.id === 'optimistic:1');
      expect(failed).toHaveLength(1);
      expect(failed[0].optimisticStatus).toBe('failed');
    });
  });

  it('R4: failed entry is dropped when the payload echoes its client_message_id', async () => {
    const failedThreadMessagesRef = { current: new Map() };
    const failedMessage = {
      id: 'optimistic:1',
      conversation_id: 'conv-1',
      client_message_id: 'cm-1',
      body: 'failed hello',
      created_at: '2026-04-28T08:01:00.000Z',
      isOptimistic: true,
      optimisticStatus: 'failed',
      is_own: true,
    };
    const byConversation = new Map([
      [failedMessage.id, {
        conversationId: 'conv-1',
        clientMessageId: 'cm-1',
        message: failedMessage,
      }],
    ]);
    failedThreadMessagesRef.current.set('conv-1', byConversation);

    let api = null;
    render(React.createElement(Harness, {
      failedThreadMessagesRef,
      activeConversationId: 'conv-1',
      onReady: (value) => { api = value; },
    }));

    await act(async () => {
      await api.applyLatestThreadPayload('conv-1', {
        items: [
          {
            id: 'msg-9',
            conversation_id: 'conv-1',
            client_message_id: 'cm-1',
            body: 'failed hello',
            created_at: '2026-04-28T08:01:00.000Z',
          },
        ],
        has_older: false,
      });
    });

    await waitFor(() => expect(api.messages.map((m) => m.id)).toEqual(['msg-9']));
    expect(byConversation.size).toBe(0);
  });

  it('R4: a failure recorded while another conversation was active appears on return to A', async () => {
    const failedThreadMessagesRef = { current: new Map() };
    let api = null;
    const { rerender } = render(React.createElement(Harness, {
      failedThreadMessagesRef,
      activeConversationId: 'conv-2',
      initialConversationId: 'conv-2',
      onReady: (value) => { api = value; },
    }));

    await act(async () => {
      await api.applyLatestThreadPayload('conv-2', {
        items: [
          { id: 'msg-b1', conversation_id: 'conv-2', body: 'b-hello', created_at: '2026-04-28T08:02:00.000Z' },
        ],
        has_older: false,
      });
    });
    await waitFor(() => expect(api.messages.map((m) => m.id)).toEqual(['msg-b1']));

    // The send error for conv-1 resolves while the viewer is in conv-2 —
    // only the page-level ref sees it, the visible list must not (R4).
    const failedMessage = {
      id: 'optimistic:9',
      conversation_id: 'conv-1',
      client_message_id: 'cm-9',
      body: 'late failure',
      created_at: '2026-04-28T08:03:00.000Z',
      isOptimistic: true,
      optimisticStatus: 'failed',
      is_own: true,
    };
    failedThreadMessagesRef.current.set('conv-1', new Map([
      [failedMessage.id, {
        conversationId: 'conv-1',
        clientMessageId: 'cm-9',
        body: failedMessage.body,
        bodyFormat: 'plain',
        replyToMessageId: '',
        message: failedMessage,
      }],
    ]));
    expect(api.messages.some((m) => m.id === 'optimistic:9')).toBe(false);

    rerender(React.createElement(Harness, {
      failedThreadMessagesRef,
      activeConversationId: 'conv-1',
      onReady: (value) => { api = value; },
    }));
    await act(async () => {
      await api.applyLatestThreadPayload('conv-1', {
        items: [
          { id: 'msg-1', conversation_id: 'conv-1', body: 'hello', created_at: '2026-04-28T08:00:00.000Z' },
        ],
        has_older: false,
      });
    });

    await waitFor(() => {
      const failed = api.messages.filter((m) => m.id === 'optimistic:9');
      expect(failed).toHaveLength(1);
      expect(failed[0].optimisticStatus).toBe('failed');
    });
  });

  it('R12: an optimistic item in the cached payload does not evict the failed registry entry', async () => {
    const failedThreadMessagesRef = { current: new Map() };
    const failedMessage = {
      id: 'optimistic:1',
      conversation_id: 'conv-1',
      client_message_id: 'cm-1',
      body: 'failed hello',
      created_at: '2026-04-28T08:01:00.000Z',
      isOptimistic: true,
      optimisticStatus: 'failed',
      is_own: true,
    };
    const byConversation = new Map([
      [failedMessage.id, {
        conversationId: 'conv-1',
        clientMessageId: 'cm-1',
        message: failedMessage,
      }],
    ]);
    failedThreadMessagesRef.current.set('conv-1', byConversation);

    let api = null;
    render(React.createElement(Harness, {
      failedThreadMessagesRef,
      activeConversationId: 'conv-1',
      onReady: (value) => { api = value; },
    }));

    // Stale cache payloads may still carry the optimistic bubble itself —
    // only persisted items may evict a failed registry entry.
    await act(async () => {
      await api.applyLatestThreadPayload('conv-1', {
        items: [
          { id: 'msg-1', conversation_id: 'conv-1', body: 'hello', created_at: '2026-04-28T08:00:00.000Z' },
          { ...failedMessage },
        ],
        has_older: false,
      });
    });

    expect(byConversation.size).toBe(1);
    await waitFor(() => {
      const failed = api.messages.filter((m) => m.id === 'optimistic:1');
      expect(failed).toHaveLength(1);
      expect(failed[0].optimisticStatus).toBe('failed');
    });
  });

  describe('R19: loadNewerMessages', () => {
    const buildPartialWindowCache = () => ({
      data: {
        items: Array.from({ length: 34 }, (_, index) => ({
          id: `msg-${index + 31}`,
          conversation_id: 'conv-1',
          body: `message-${index + 31}`,
          created_at: `2026-04-28T09:${String(index).padStart(2, '0')}:00.000Z`,
        })),
        has_older: true,
        has_newer: true,
        viewer_last_read_message_id: 'msg-40',
        viewer_last_read_at: '2026-04-28T08:40:00.000Z',
      },
    });

    it('appends the next page after the last loaded message', async () => {
      chatAPI.getMessages.mockResolvedValueOnce({
        items: [
          { id: 'msg-65', conversation_id: 'conv-1', body: 'newer-1', created_at: '2026-04-28T10:00:00.000Z' },
          { id: 'msg-66', conversation_id: 'conv-1', body: 'newer-2', created_at: '2026-04-28T10:01:00.000Z' },
        ],
        has_older: true,
        has_newer: false,
      });
      let api = null;
      render(React.createElement(Harness, {
        initialThreadCache: buildPartialWindowCache(),
        onReady: (value) => { api = value; },
      }));

      await waitFor(() => expect(api?.messagesHasNewer).toBe(true));
      expect(api.messages).toHaveLength(34);

      await act(async () => {
        await api.loadNewerMessages();
      });

      expect(chatAPI.getMessages).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({
          after_message_id: 'msg-64',
          limit: 50,
        }),
      );
      expect(api.messages.map((message) => message.id).slice(-2)).toEqual(['msg-65', 'msg-66']);
      expect(api.messagesHasNewer).toBe(false);
    });

    it('keeps one request in flight and skips it when has_newer is false', async () => {
      let resolveRequest;
      chatAPI.getMessages.mockImplementationOnce(() => new Promise((resolve) => {
        resolveRequest = resolve;
      }));
      let api = null;
      render(React.createElement(Harness, {
        initialThreadCache: buildPartialWindowCache(),
        onReady: (value) => { api = value; },
      }));

      await waitFor(() => expect(api?.messagesHasNewer).toBe(true));

      let firstCall;
      let secondCall;
      await act(async () => {
        firstCall = api.loadNewerMessages();
        secondCall = api.loadNewerMessages();
      });
      expect(chatAPI.getMessages).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveRequest({
          items: [{ id: 'msg-65', conversation_id: 'conv-1', body: 'newer', created_at: '2026-04-28T10:00:00.000Z' }],
          has_older: true,
          has_newer: false,
        });
        await firstCall;
        await secondCall;
      });

      await waitFor(() => expect(api.messagesHasNewer).toBe(false));

      chatAPI.getMessages.mockClear();
      await act(async () => {
        await api.loadNewerMessages();
      });
      expect(chatAPI.getMessages).not.toHaveBeenCalled();
    });

    it('uses the last persisted message as cursor, skipping optimistic tail', async () => {
      let api = null;
      render(React.createElement(Harness, {
        initialThreadCache: buildPartialWindowCache(),
        onReady: (value) => { api = value; },
      }));
      await waitFor(() => expect(api?.messagesHasNewer).toBe(true));

      await act(async () => {
        api.setMessages((current) => [
          ...current,
          {
            id: 'optimistic:tail',
            conversation_id: 'conv-1',
            body: 'pending bubble',
            created_at: '2026-04-28T11:00:00.000Z',
            isOptimistic: true,
            optimisticStatus: 'sending',
            is_own: true,
          },
        ]);
      });

      chatAPI.getMessages.mockResolvedValueOnce({
        items: [{ id: 'msg-65', conversation_id: 'conv-1', body: 'newer', created_at: '2026-04-28T10:00:00.000Z' }],
        has_older: true,
        has_newer: false,
      });

      await act(async () => {
        await api.loadNewerMessages();
      });

      expect(chatAPI.getMessages).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({ after_message_id: 'msg-64' }),
      );
    });
  });
});
