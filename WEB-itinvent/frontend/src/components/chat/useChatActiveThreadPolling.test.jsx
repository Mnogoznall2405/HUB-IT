import React, { useRef } from 'react';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import useChatActiveThreadPolling from './useChatActiveThreadPolling';

vi.mock('../../lib/chatFeature', () => ({
  CHAT_FEATURE_ENABLED: true,
  CHAT_WS_ENABLED: true,
}));

function Harness({ loadMessages }) {
  const activeConversationIdRef = useRef('conv-1');
  const degradedThreadRevalidateCountRef = useRef(0);
  const lastConversationsLoadAtRef = useRef(0);
  const lastForegroundRefreshAtRef = useRef(0);
  const loadMessagesRef = useRef(loadMessages);
  const logChatDebugRef = useRef(vi.fn());
  const messagesLoadingRef = useRef(false);
  const messagesRef = useRef([{ id: 'msg-1' }]);

  loadMessagesRef.current = loadMessages;

  useChatActiveThreadPolling({
    activeConversationId: 'conv-1',
    activeConversationIdRef,
    activeThreadTransportState: 'degraded',
    buildActiveThreadPollLoadOptions: () => ({ silent: true }),
    conversationBootstrapComplete: true,
    degradedThreadRevalidateCountRef,
    incrementalPollMs: 1000,
    lastConversationsLoadAtRef,
    lastForegroundRefreshAtRef,
    listPollMs: 15000,
    loadConversations: vi.fn(),
    loadMessages,
    loadMessagesRef,
    logChatDebugRef,
    messagesLoadingRef,
    messagesRef,
    sidebarSearchActive: false,
    shouldPollActiveThreadIncrementally: () => true,
    threadPollMs: 6000,
  });

  return null;
}

describe('useChatActiveThreadPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
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
});
