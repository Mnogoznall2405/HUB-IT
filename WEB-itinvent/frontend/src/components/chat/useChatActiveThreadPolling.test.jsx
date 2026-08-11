import React, { useRef } from 'react';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import useChatActiveThreadPolling from './useChatActiveThreadPolling';

vi.mock('../../lib/chatFeature', () => ({
  CHAT_FEATURE_ENABLED: true,
  CHAT_WS_ENABLED: true,
}));

function Harness({
  activeThreadTransportState = 'degraded',
  lastConversationsLoadAt = 0,
  loadConversations = vi.fn(),
  loadMessages,
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
    buildActiveThreadPollLoadOptions: () => ({ silent: true }),
    conversationBootstrapComplete: true,
    degradedThreadRevalidateCountRef,
    incrementalPollMs: 1000,
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
    shouldPollActiveThreadIncrementally: () => true,
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
});
