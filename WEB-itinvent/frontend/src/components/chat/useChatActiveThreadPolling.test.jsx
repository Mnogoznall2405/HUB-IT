import React, { useRef } from 'react';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { shouldPollActiveThreadIncrementally } from '../../pages/chat/chatThreadTransport';
import useChatActiveThreadPolling from './useChatActiveThreadPolling';

vi.mock('../../lib/chatFeature', () => ({
  CHAT_FEATURE_ENABLED: true,
  CHAT_WS_ENABLED: true,
}));

// Stable identity across rerenders — matches the real pages, which pass the
// imported buildActiveThreadPollLoadOptions/shouldPoll fns straight through.
const buildPollLoadOptions = () => ({ silent: true });
const alwaysPoll = () => true;

function Harness({
  activeThreadTransportState = 'degraded',
  incrementalPollMs = 1000,
  lastConversationsLoadAt = 0,
  loadConversations = vi.fn(),
  loadMessages,
  shouldPollFn,
  socketStatus = 'disconnected',
}) {
  const activeConversationIdRef = useRef('conv-1');
  const degradedThreadRevalidateCountRef = useRef(0);
  const lastConversationsLoadAtRef = useRef(lastConversationsLoadAt);
  const lastForegroundRefreshAtRef = useRef(0);
  const loadMessagesRef = useRef(loadMessages);
  const logChatDebugRef = useRef(vi.fn());
  const messagesLoadingRef = useRef(false);
  const messagesRef = useRef([{ id: 'msg-1' }]);

  loadMessagesRef.current = loadMessages;

  useChatActiveThreadPolling({
    activeConversationId: 'conv-1',
    activeConversationIdRef,
    activeThreadTransportState,
    buildActiveThreadPollLoadOptions: buildPollLoadOptions,
    conversationBootstrapComplete: true,
    degradedThreadRevalidateCountRef,
    incrementalPollMs,
    lastConversationsLoadAtRef,
    lastForegroundRefreshAtRef,
    listPollMs: 15000,
    loadConversations,
    loadMessages,
    loadMessagesRef,
    logChatDebugRef,
    messagesLoadingRef,
    messagesRef,
    sidebarSearchActive: false,
    shouldPollActiveThreadIncrementally: shouldPollFn || alwaysPoll,
    socketStatus,
    threadPollMs: 6000,
  });

  return null;
}

describe('useChatActiveThreadPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T04:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not start overlapping degraded thread polls', async () => {
    let resolveLoad;
    const loadMessages = vi.fn(() => new Promise((resolve) => {
      resolveLoad = resolve;
    }));

    render(<Harness loadMessages={loadMessages} />);

    expect(loadMessages).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(loadMessages).toHaveBeenCalledTimes(1);

    resolveLoad();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);

    expect(loadMessages).toHaveBeenCalledTimes(2);
  });

  it('backs off on chat read concurrency full instead of immediate retry', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const loadMessages = vi.fn(() => Promise.reject({
      response: {
        status: 503,
        data: { detail: 'chat read concurrency full (limit=8, acquire_timeout_ms=50)' },
        headers: { 'retry-after': '2' },
      },
    }));

    render(<Harness loadMessages={loadMessages} />);
    expect(loadMessages).toHaveBeenCalledTimes(1);

    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(loadMessages).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(loadMessages).toHaveBeenCalledTimes(2);
    Math.random.mockRestore();
  });

  it('uses the inbox socket status instead of active-thread state on desktop focus', async () => {
    const loadConversations = vi.fn();
    render(
      <Harness
        activeThreadTransportState="offline"
        lastConversationsLoadAt={Date.now()}
        loadConversations={loadConversations}
        loadMessages={vi.fn()}
        socketStatus="connected"
      />,
    );

    await vi.advanceTimersByTimeAsync(4000);
    window.dispatchEvent(new Event('focus'));

    expect(loadConversations).not.toHaveBeenCalled();
  });

  it('deduplicates foreground reconciliation across repeated focus events', async () => {
    const loadConversations = vi.fn();
    render(
      <Harness
        loadConversations={loadConversations}
        loadMessages={vi.fn()}
        socketStatus="disconnected"
      />,
    );

    window.dispatchEvent(new Event('focus'));
    expect(loadConversations).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    window.dispatchEvent(new Event('focus'));
    expect(loadConversations).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(8000);
    window.dispatchEvent(new Event('focus'));
    expect(loadConversations).toHaveBeenCalledTimes(2);
  });

  it('backs off exponentially on generic poll failures up to the cap', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const loadMessages = vi.fn(() => Promise.reject({ response: { status: 500 } }));
    try {
      render(<Harness loadMessages={loadMessages} />);
      expect(loadMessages).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(0);

      await vi.advanceTimersByTimeAsync(999);
      expect(loadMessages).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(0);
      expect(loadMessages).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1999);
      expect(loadMessages).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(0);
      expect(loadMessages).toHaveBeenCalledTimes(3);

      await vi.advanceTimersByTimeAsync(3999);
      expect(loadMessages).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(0);
      expect(loadMessages).toHaveBeenCalledTimes(4);
    } finally {
      Math.random.mockRestore();
    }
  });

  it('does not restart the poll or fire an immediate request on unhealthy-status switches', async () => {
    const loadMessages = vi.fn(() => Promise.resolve([]));
    const renderHarness = (transport) => (
      <Harness
        activeThreadTransportState={transport}
        incrementalPollMs={3000}
        loadMessages={loadMessages}
        shouldPollFn={shouldPollActiveThreadIncrementally}
      />
    );
    const { rerender } = render(renderHarness('offline'));
    expect(loadMessages).toHaveBeenCalledTimes(1);

    // Five disconnected ↔ reconnecting (offline ↔ degraded) switches over 5s.
    const states = ['degraded', 'offline', 'degraded', 'offline', 'degraded'];
    for (const transport of states) {
      await vi.advanceTimersByTimeAsync(1000);
      rerender(renderHarness(transport));
    }

    // 3s interval → at t=5s only the t=0 and t=3 polls ran; churn never
    // re-armed the loop with an extra immediate request.
    expect(loadMessages).toHaveBeenCalledTimes(2);
  });

  it('keeps the backoff window across unhealthy-status switches', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const loadMessages = vi.fn(() => Promise.reject({ response: { status: 500 } }));
    const renderHarness = (transport) => (
      <Harness
        activeThreadTransportState={transport}
        incrementalPollMs={1000}
        loadMessages={loadMessages}
        shouldPollFn={shouldPollActiveThreadIncrementally}
      />
    );
    try {
      const { rerender } = render(renderHarness('offline'));
      expect(loadMessages).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(0); // flush rejection → backoffUntil ≈ +800ms

      // offline → degraded mid-backoff: must not restart the cycle.
      rerender(renderHarness('degraded'));
      rerender(renderHarness('offline'));
      expect(loadMessages).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(799);
      expect(loadMessages).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(0);
      expect(loadMessages).toHaveBeenCalledTimes(2);
    } finally {
      Math.random.mockRestore();
    }
  });

  it('pauses the poll while offline and polls immediately on online', async () => {
    const loadMessages = vi.fn(() => Promise.resolve([]));
    const onLine = { value: true };
    const descriptor = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => onLine.value,
    });
    try {
      onLine.value = false;
      render(<Harness loadMessages={loadMessages} />);
      await vi.advanceTimersByTimeAsync(5000);
      expect(loadMessages).not.toHaveBeenCalled();

      onLine.value = true;
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
      expect(loadMessages).toHaveBeenCalledTimes(1);
    } finally {
      if (descriptor) Object.defineProperty(window.navigator, 'onLine', descriptor);
    }
  });
});
