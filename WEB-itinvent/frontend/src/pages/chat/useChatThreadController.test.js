import React, { useRef } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
}) {
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
    hasPendingInitialAnchorForConversationRef,
    hydratedThreadConversationIdRef,
    initialConversationId,
    initialThreadCache,
    isInitialViewportGuardActiveRef,
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
});
