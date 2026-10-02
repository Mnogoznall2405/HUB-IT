import { act, renderHook } from '@testing-library/react-native';
import { useRef, useState } from 'react';
import type { ChatConversationSummary, ChatMessage } from '../../api/types';
import type { ChatMessageEnterKind } from '../../components/chat/ChatMessageEnterMotion';
import { useThreadRealtime } from './useThreadRealtime';

const mockSocketHandlers = new Map<string, Set<(payload: unknown) => void>>();
const emitSocket = (event: string, payload: unknown) => {
  mockSocketHandlers.get(event)?.forEach((handler) => handler(payload));
};

jest.mock('../../chat/chatSocket', () => ({
  shouldUseChatHttpFallback: (status: string) => ['offline', 'error', 'reconnecting'].includes(status),
  chatSocket: {
    getStatus: () => 'connected',
    on: jest.fn((event: string, handler: (payload: unknown) => void) => {
      if (!mockSocketHandlers.has(event)) mockSocketHandlers.set(event, new Set());
      mockSocketHandlers.get(event)!.add(handler);
      return () => mockSocketHandlers.get(event)?.delete(handler);
    }),
    connect: jest.fn(async () => undefined),
    subscribeInbox: jest.fn(),
    subscribeConversation: jest.fn(),
    unsubscribeConversation: jest.fn(),
    sendTyping: jest.fn(),
    watchPresence: jest.fn(),
  },
}));

// Effect dependencies must keep a stable identity across renders, exactly like
// the screen's useCallback versions — otherwise every render re-subscribes.
const loadInitial = jest.fn(async () => undefined);
const syncLatestMessages = jest.fn(async () => undefined);
const markRead = jest.fn();
const requestBottomAnchor = jest.fn();

type HarnessProps = {
  conversationId: string;
  userId?: number;
  offlineMode?: boolean;
  hasNewer?: boolean;
};

function useHarness(props: HarnessProps) {
  const mountedRef = useRef(true);
  const markedReadRef = useRef('');
  const knownMessageIdsRef = useRef(new Set<string>());
  const messageAnimationReadyRef = useRef(false);
  const messageEnterMotionsRef = useRef(new Map<string, ChatMessageEnterKind>());
  const nearBottomRef = useRef(!props.hasNewer);
  const loadGenerationRef = useRef(0);
  const typingIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingActiveRef = useRef(false);
  const pendingAnchorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uploadControllersRef = useRef(new Map<string, AbortController>());
  const downloadControllersRef = useRef(new Map<string, AbortController>());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversation, setConversation] = useState<ChatConversationSummary | null>(null);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const realtime = useThreadRealtime({
    conversationId: props.conversationId,
    userId: props.userId ?? 1,
    offlineMode: props.offlineMode ?? false,
    hasNewer: props.hasNewer ?? false,
    mountedRef,
    markedReadRef,
    knownMessageIdsRef,
    messageAnimationReadyRef,
    messageEnterMotionsRef,
    nearBottomRef,
    loadGenerationRef,
    typingIdleRef,
    typingActiveRef,
    pendingAnchorTimerRef,
    highlightTimerRef,
    uploadControllersRef,
    downloadControllersRef,
    loadInitial,
    syncLatestMessages,
    markRead,
    requestBottomAnchor,
    setMessages,
    setConversation,
    setNewMessageCount,
    setShowJumpToBottom,
  });
  return { realtime, messages, newMessageCount, showJumpToBottom, nearBottomRef };
}

const incomingMessage = (id: string, seq: number, conversationId = 'conversation-1') => ({
  type: 'chat.message.created',
  payload: {
    message: {
      id,
      conversation_id: conversationId,
      conversation_seq: seq,
      sender_user_id: 2,
      sender: { id: 2, username: 'maria', full_name: 'Мария Иванова' },
      body_text: `body-${id}`,
      created_at: '2026-08-23T08:00:00Z',
    },
  },
});

const typingStarted = (userId: number, expiresInMs?: number, conversationId = 'conversation-1') => ({
  type: 'chat.typing.started',
  conversation_id: conversationId,
  payload: {
    user_id: userId,
    sender_name: 'Мария',
    is_typing: true,
    ...(expiresInMs !== undefined ? { expires_in_ms: expiresInMs } : {}),
  },
});

beforeEach(() => {
  mockSocketHandlers.clear();
});

it('merges a fresh socket message while the window is attached to the bottom', async () => {
  const view = await renderHook((props: HarnessProps) => useHarness(props), {
    initialProps: { conversationId: 'conversation-1' },
  });

  await act(async () => {
    emitSocket('chat.message.created', incomingMessage('m-1', 1));
    emitSocket('chat.message.created', incomingMessage('m-2', 2));
  });

  expect(view.result.current.messages.map((item) => item.id)).toEqual(['m-2', 'm-1']);
  expect(view.result.current.newMessageCount).toBe(0);
  expect(markRead).toHaveBeenCalledTimes(2);
  expect(requestBottomAnchor).toHaveBeenCalled();
});

// T4: in a detached history window (hasNewer — e.g. a mid-history slice reached
// via search jump) a new message must not be merged at data[0]; it only counts
// towards the jump-to-bottom badge and is fetched with the gap.
it('does not merge a fresh message into a detached history window (T4)', async () => {
  const view = await renderHook((props: HarnessProps) => useHarness(props), {
    initialProps: { conversationId: 'conversation-1' },
  });
  await act(async () => {
    emitSocket('chat.message.created', incomingMessage('m-1', 1));
  });
  expect(view.result.current.messages.map((item) => item.id)).toEqual(['m-1']);
  expect(markRead).toHaveBeenCalledTimes(1);

  // focusSearchResult-style jump: window no longer reaches the bottom.
  await act(async () => {
    view.rerender({ conversationId: 'conversation-1', hasNewer: true });
    view.result.current.nearBottomRef.current = false;
  });
  await act(async () => {
    emitSocket('chat.message.created', incomingMessage('m-new', 99));
  });

  expect(view.result.current.messages.map((item) => item.id)).toEqual(['m-1']);
  expect(view.result.current.newMessageCount).toBe(1);
  expect(view.result.current.showJumpToBottom).toBe(true);
  expect(markRead).toHaveBeenCalledTimes(1);

  // own-send forces nearBottomRef back on while the slice stays detached —
  // a fresh message still must not merge or mark read, only count.
  await act(async () => {
    view.result.current.nearBottomRef.current = true;
  });
  await act(async () => {
    emitSocket('chat.message.created', incomingMessage('m-new-2', 100));
  });
  expect(view.result.current.messages.map((item) => item.id)).toEqual(['m-1']);
  expect(view.result.current.newMessageCount).toBe(2);
  expect(markRead).toHaveBeenCalledTimes(1);
});

// T10: an in-place conversationId change must drop the previous room's typing
// line and AI run status, not just their timers.
it('clears typing participants and AI status when the conversation changes in place (T10)', async () => {
  const view = await renderHook((props: HarnessProps) => useHarness(props), {
    initialProps: { conversationId: 'conversation-1' },
  });
  await act(async () => {
    emitSocket('chat.typing.started', typingStarted(2, 60_000));
    emitSocket('chat.ai.run.updated', {
      conversation_id: 'conversation-1',
      payload: { status: 'running', bot_title: 'Бот', status_text: 'Думает…' },
    });
  });
  expect(view.result.current.realtime.typingParticipants).toEqual([{ userId: 2, name: 'Мария' }]);
  expect(view.result.current.realtime.aiRunStatus).toEqual({
    botTitle: 'Бот',
    statusText: 'Думает…',
    status: 'running',
  });

  await act(async () => {
    view.rerender({ conversationId: 'conversation-2' });
  });

  expect(view.result.current.realtime.typingParticipants).toEqual([]);
  expect(view.result.current.realtime.aiRunStatus).toBeNull();

  // Events of the previous room are ignored after the switch.
  await act(async () => {
    emitSocket('chat.typing.started', typingStarted(3, undefined, 'conversation-1'));
  });
  expect(view.result.current.realtime.typingParticipants).toEqual([]);
});

// T16: the typing TTL comes from the envelope's expires_in_ms (with the
// parser's fallback), not a hardcoded 4s.
it('expires the typing indicator after the envelope expires_in_ms (T16)', async () => {
  jest.useFakeTimers();
  try {
    const view = await renderHook((props: HarnessProps) => useHarness(props), {
      initialProps: { conversationId: 'conversation-1' },
    });
    await act(async () => {
      emitSocket('chat.typing.started', typingStarted(2, 1000));
    });
    expect(view.result.current.realtime.typingParticipants).toEqual([{ userId: 2, name: 'Мария' }]);

    await act(async () => {
      jest.advanceTimersByTime(999);
    });
    expect(view.result.current.realtime.typingParticipants).toHaveLength(1);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(view.result.current.realtime.typingParticipants).toEqual([]);
  } finally {
    jest.useRealTimers();
  }
});
