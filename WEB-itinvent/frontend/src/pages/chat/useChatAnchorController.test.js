import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import useChatAnchorController from './useChatAnchorController';

const buildRefs = () => ({
  activeConversationIdRef: { current: 'conv-1' },
  autoScrollMetaRef: { current: null },
  autoScrollRef: { current: false },
  conversationsRef: { current: [{ id: 'conv-1', unread_count: 0 }] },
  initialViewportGuardRef: { current: null },
  messagesRef: { current: [] },
  pendingInitialAnchorRef: { current: null },
  threadContentRef: { current: null },
  threadNearBottomRef: { current: false },
  threadScrollRef: { current: null },
});

describe('useChatAnchorController', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      cb();
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('queueMicrotask', (cb) => {
      cb();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('queues bottom_instant anchor and resets scrollTop', () => {
    const refs = buildRefs();
    const container = {
      scrollTop: 120,
      scrollHeight: 500,
      clientHeight: 200,
      style: {},
    };
    refs.threadScrollRef.current = container;
    const setThreadScrollTop = vi.fn(() => true);
    const syncThreadViewportState = vi.fn();
    const setShowJumpToLatest = vi.fn();
    const logChatDebug = vi.fn();

    const { result } = renderHook(() => useChatAnchorController({
      activeConversationId: 'conv-1',
      ...refs,
      logChatDebug,
      setShowJumpToLatest,
      setThreadScrollTop,
      showJumpToLatestRef: { current: false },
      syncThreadViewportState,
      viewerLastReadMessageId: '',
    }));

    act(() => {
      expect(result.current.queueInitialThreadPosition('conv-1')).toBe('bottom_instant');
    });

    expect(setThreadScrollTop).toHaveBeenCalledWith(0, { source: 'queueInitialThreadPosition:reset' });
    expect(refs.pendingInitialAnchorRef.current).toMatchObject({
      conversationId: 'conv-1',
      mode: 'bottom_instant',
      ready: false,
    });
    expect(result.current.isInitialViewportGuardActive('conv-1')).toBe(true);
  });

  it('applyPendingInitialAnchor scrolls to bottom when ready', () => {
    const refs = buildRefs();
    const container = {
      scrollTop: 0,
      scrollHeight: 500,
      clientHeight: 200,
      querySelector: () => null,
    };
    refs.threadScrollRef.current = container;
    refs.pendingInitialAnchorRef.current = {
      conversationId: 'conv-1',
      mode: 'bottom_instant',
      ready: true,
      anchorResolved: true,
      startedAt: Date.now(),
      lastAppliedTarget: null,
    };
    const setThreadScrollTop = vi.fn(() => true);
    const syncThreadViewportState = vi.fn();

    const { result } = renderHook(() => useChatAnchorController({
      activeConversationId: 'conv-1',
      ...refs,
      logChatDebug: vi.fn(),
      setShowJumpToLatest: vi.fn(),
      setThreadScrollTop,
      showJumpToLatestRef: { current: false },
      syncThreadViewportState,
      viewerLastReadMessageId: '',
    }));

    act(() => {
      expect(result.current.applyPendingInitialAnchor({ source: 'test' })).toBe('changed');
    });

    expect(setThreadScrollTop).toHaveBeenCalledWith(300, { source: 'pendingAnchor:test' });
  });

  it('buffers payload before queue and scrolls to latest messages after queue', () => {
    const refs = buildRefs();
    const container = {
      scrollTop: 0,
      scrollHeight: 500,
      clientHeight: 200,
      querySelector: () => null,
    };
    refs.threadScrollRef.current = container;
    const setThreadScrollTop = vi.fn(() => true);
    const syncThreadViewportState = vi.fn();

    const { result } = renderHook(() => useChatAnchorController({
      activeConversationId: 'conv-1',
      ...refs,
      logChatDebug: vi.fn(),
      setShowJumpToLatest: vi.fn(),
      setThreadScrollTop,
      showJumpToLatestRef: { current: false },
      syncThreadViewportState,
      viewerLastReadMessageId: '',
    }));

    act(() => {
      expect(result.current.resolvePendingInitialAnchorFromPayload('conv-1', {
        items: [{ id: 'm-1' }],
        viewer_last_read_message_id: 'm-1',
        initial_anchor_mode: 'bottom',
      })).toBe(false);
      expect(result.current.queueInitialThreadPosition('conv-1')).toBe('bottom_instant');
    });

    expect(refs.pendingInitialAnchorRef.current).toMatchObject({
      conversationId: 'conv-1',
      mode: 'bottom_instant',
      ready: true,
    });
    expect(setThreadScrollTop).toHaveBeenCalledWith(300, {
      source: 'pendingAnchor:queueInitialThreadPosition:buffer_flush',
    });
  });

  it('anchors the opened conversation on the server-provided first unread message', () => {
    const refs = buildRefs();
    refs.conversationsRef.current = [{ id: 'conv-1', unread_count: 12 }];
    const anchorEl = { offsetTop: 340 };
    const container = {
      scrollTop: 0,
      scrollHeight: 2000,
      clientHeight: 400,
      querySelector: vi.fn((selector) => (selector.includes('m-7') ? anchorEl : null)),
    };
    refs.threadScrollRef.current = container;
    const setThreadScrollTop = vi.fn(() => true);

    const { result } = renderHook(() => useChatAnchorController({
      activeConversationId: 'conv-1',
      ...refs,
      logChatDebug: vi.fn(),
      setShowJumpToLatest: vi.fn(),
      setThreadScrollTop,
      showJumpToLatestRef: { current: false },
      syncThreadViewportState: vi.fn(),
      viewerLastReadMessageId: 'm-2',
    }));

    act(() => {
      expect(result.current.queueInitialThreadPosition('conv-1')).toBe('first_unread_top');
      expect(result.current.resolvePendingInitialAnchorFromPayload('conv-1', {
        items: [{ id: 'm-5', is_own: false }, { id: 'm-7', is_own: false }],
        viewer_last_read_message_id: 'm-2',
        initial_anchor_mode: 'first_unread',
        initial_anchor_message_id: 'm-7',
      })).toBe(true);
    });

    expect(refs.pendingInitialAnchorRef.current).toMatchObject({
      conversationId: 'conv-1',
      mode: 'first_unread_top',
      anchorMessageId: 'm-7',
      anchorResolved: true,
      ready: true,
    });

    act(() => {
      expect(result.current.applyPendingInitialAnchor({ source: 'test' })).toBe('changed');
    });

    expect(setThreadScrollTop).toHaveBeenCalledWith(340 - 14, { source: 'pendingAnchor:test' });
  });

  it('cancelPendingInitialAnchor clears pending state and guard', () => {
    const refs = buildRefs();
    refs.pendingInitialAnchorRef.current = { conversationId: 'conv-1' };
    refs.initialViewportGuardRef.current = {
      conversationId: 'conv-1',
      mode: 'bottom_instant',
      releaseAt: Date.now() + 500,
    };

    const { result } = renderHook(() => useChatAnchorController({
      activeConversationId: 'conv-1',
      ...refs,
      logChatDebug: vi.fn(),
      setShowJumpToLatest: vi.fn(),
      setThreadScrollTop: vi.fn(),
      showJumpToLatestRef: { current: false },
      syncThreadViewportState: vi.fn(),
      viewerLastReadMessageId: '',
    }));

    act(() => {
      result.current.cancelPendingInitialAnchor();
    });

    expect(refs.pendingInitialAnchorRef.current).toBeNull();
    expect(refs.initialViewportGuardRef.current).toBeNull();
  });
});
