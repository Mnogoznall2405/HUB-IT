import { act, renderHook } from '@testing-library/react-native';
import { useEffect, useRef, useState } from 'react';
import * as chatApi from '../../api/chatApi';
import type {
  ChatAiBot,
  ChatConversationSummary,
  ChatMessage,
  ChatMessagePage,
  ChatThreadBootstrapPage,
} from '../../api/types';
import type { NativeSnapshot } from '../../cache/nativeSnapshotCache';
import { readNativeEntitySnapshot } from '../../cache/nativeSnapshotCache';
import { mergeMessages } from '../../chat/chatState';
import {
  mergeNativeChatThreadHistory,
  scheduleNativeChatThreadSnapshotWrite,
  type NativeChatThreadSnapshot,
} from '../../chat/nativeChatThreadHistory';
import type { createNativeChatOutbox } from '../../chat/nativeChatOutbox';
import { showNativeToast } from '../../components/nativeToast';
import type { ChatMessageEnterKind } from '../../components/chat/ChatMessageEnterMotion';
import { useThreadHistory } from './useThreadHistory';
import type { PendingAttachmentUpload } from './NativeChatThreadScreen';

jest.mock('../../api/chatApi', () => ({
  getConversation: jest.fn(),
  getMessagesPage: jest.fn(),
  getThreadBootstrap: jest.fn(),
  getAiBots: jest.fn(),
}));

jest.mock('../../cache/nativeSnapshotCache', () => ({
  readNativeEntitySnapshot: jest.fn(),
  writeNativeEntitySnapshot: jest.fn(async () => undefined),
}));

jest.mock('../../chat/chatPinnedMessages', () => ({
  getPinnedChatMessageId: jest.fn(async () => null),
  setPinnedChatMessageId: jest.fn(async () => undefined),
}));

jest.mock('../../diagnostics/diagnostics', () => ({
  recordDiagnosticEvent: jest.fn(async () => undefined),
}));

jest.mock('../../components/nativeToast', () => ({
  showNativeToast: jest.fn(),
}));

jest.mock('../../chat/nativeChatThreadHistory', () => {
  const actual = jest.requireActual<typeof import('../../chat/nativeChatThreadHistory')>(
    '../../chat/nativeChatThreadHistory',
  );
  return {
    ...actual,
    mergeNativeChatThreadHistory: jest.fn(actual.mergeNativeChatThreadHistory),
    scheduleNativeChatThreadSnapshotWrite: jest.fn(async () => true),
  };
});

const mockedChatApi = chatApi as jest.Mocked<typeof chatApi>;
const readSnapshot = jest.mocked(readNativeEntitySnapshot);
const toastMock = jest.mocked(showNativeToast);
const mergeHistorySpy = jest.mocked(mergeNativeChatThreadHistory);
const scheduleWriteSpy = jest.mocked(scheduleNativeChatThreadSnapshotWrite);

type ThreadOutbox = ReturnType<typeof createNativeChatOutbox>;

type HarnessProps = {
  conversationId: string;
  userId: number;
  messageId?: string;
  offlineMode: boolean;
  outbox: ThreadOutbox;
  markRead: jest.Mock;
  requestBottomAnchor: jest.Mock;
};

const peerMessage = (
  id: string,
  body: string,
  createdAt: string,
  conversationId = 'conversation-1',
): ChatMessage => ({
  id,
  conversation_id: conversationId,
  sender_user_id: 2,
  sender: { id: 2, username: 'maria', full_name: 'Мария Иванова' },
  body_text: body,
  created_at: createdAt,
});

const livePage = (
  items: ChatMessage[],
  overrides: Partial<ChatMessagePage> = {},
): ChatMessagePage => ({
  items,
  has_more: false,
  has_older: false,
  has_newer: false,
  cursor_invalid: false,
  older_cursor_message_id: null,
  newer_cursor_message_id: null,
  viewer_last_read_message_id: null,
  viewer_last_read_at: null,
  ...overrides,
});

const liveBootstrap = (items: ChatMessage[]): ChatThreadBootstrapPage => ({
  ...livePage(items),
  initial_anchor_mode: 'bottom',
  initial_anchor_message_id: null,
});

function makeHarnessProps(options: {
  conversationId: string;
  userId?: number;
  messageId?: string;
  offlineMode?: boolean;
  queued?: ChatMessage[];
  uploads?: Array<{ id: string; upload: PendingAttachmentUpload }>;
}): HarnessProps {
  return {
    conversationId: options.conversationId,
    userId: options.userId ?? 1,
    messageId: options.messageId,
    offlineMode: options.offlineMode ?? false,
    outbox: {
      read: jest.fn(async () => options.queued || []),
      readUploads: jest.fn(async () => options.uploads || []),
      acknowledge: jest.fn(async () => undefined),
    } as unknown as ThreadOutbox,
    markRead: jest.fn(),
    requestBottomAnchor: jest.fn(),
  };
}

function useHarness(props: HarnessProps) {
  const mountedRef = useRef(true);
  const nearBottomRef = useRef(true);
  const knownMessageIdsRef = useRef(new Set<string>());
  const messageAnimationReadyRef = useRef(false);
  const messageEnterMotionsRef = useRef(new Map<string, ChatMessageEnterKind>());
  const serverPinKnownRef = useRef(false);
  const leaveInFlightRef = useRef(false);
  const pendingAttachmentUploadsRef = useRef(new Map<string, PendingAttachmentUpload>());
  const messagesRef = useRef<ChatMessage[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversation, setConversation] = useState<ChatConversationSummary | null>(null);
  const [title, setTitle] = useState('Chat');
  const [unreadBoundaryId, setUnreadBoundaryId] = useState<string | null>(null);
  const [focusAnchorId, setFocusAnchorId] = useState<string | null>(null);
  const [pinnedMessageId, setPinnedMessageId] = useState<string | null>(null);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [holdVisiblePosition, setHoldVisiblePosition] = useState(false);
  const [aiBots, setAiBots] = useState<ChatAiBot[]>([]);
  const [draftError, setDraftError] = useState('');
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const history = useThreadHistory({
    conversationId: props.conversationId,
    userId: props.userId,
    messageId: props.messageId,
    offlineMode: props.offlineMode,
    historySessionGeneration: 0,
    mountedRef,
    nearBottomRef,
    knownMessageIdsRef,
    messageAnimationReadyRef,
    messageEnterMotionsRef,
    serverPinKnownRef,
    leaveInFlightRef,
    pendingAttachmentUploadsRef,
    messagesRef,
    outbox: props.outbox,
    markRead: props.markRead,
    requestBottomAnchor: props.requestBottomAnchor,
    conversation,
    title,
    messages,
    pinnedMessageId,
    focusAnchorId,
    unreadBoundaryId,
    setMessages,
    setConversation,
    setTitle,
    setUnreadBoundaryId,
    setFocusAnchorId,
    setPinnedMessageId,
    setShowJumpToBottom,
    setNewMessageCount,
    setHoldVisiblePosition,
    setAiBots,
    setDraftError,
  });
  return {
    history,
    messages,
    setMessages,
    conversation,
    title,
    draftError,
    pinnedMessageId,
    unreadBoundaryId,
    focusAnchorId,
    showJumpToBottom,
    newMessageCount,
    holdVisiblePosition,
    aiBots,
    mountedRef,
    nearBottomRef,
    knownMessageIdsRef,
    pendingAttachmentUploadsRef,
  };
}

// Deterministic rAF queue — loadOlder releases holdVisiblePosition through a
// nested requestAnimationFrame pair.
let rafQueue: Array<{ id: number; cb: (time: number) => void }> = [];
let rafSeq = 0;
const originalRaf = globalThis.requestAnimationFrame;
const originalCancelRaf = globalThis.cancelAnimationFrame;

const flushRafFrame = () => {
  const queued = rafQueue;
  rafQueue = [];
  queued.forEach((entry) => entry.cb(0));
};

beforeEach(() => {
  rafQueue = [];
  rafSeq = 0;
  globalThis.requestAnimationFrame = ((cb: (time: number) => void) => {
    rafSeq += 1;
    rafQueue.push({ id: rafSeq, cb });
    return rafSeq;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => {
    rafQueue = rafQueue.filter((entry) => entry.id !== id);
  }) as typeof cancelAnimationFrame;

  readSnapshot.mockResolvedValue(null);
  mockedChatApi.getConversation.mockResolvedValue({
    id: 'conversation-1',
    kind: 'direct',
    title: 'Живой диалог',
  });
  mockedChatApi.getMessagesPage.mockResolvedValue(livePage([]));
  mockedChatApi.getThreadBootstrap.mockResolvedValue(liveBootstrap([]));
  mockedChatApi.getAiBots.mockResolvedValue([]);
});

afterAll(() => {
  globalThis.requestAnimationFrame = originalRaf;
  globalThis.cancelAnimationFrame = originalCancelRaf;
});

// T6: pagination failures over a non-empty list must surface — the screen only
// renders `error` for an empty one.
it('shows a toast when loadOlder fails with messages already on screen', async () => {
  mockedChatApi.getThreadBootstrap.mockResolvedValue({
    ...liveBootstrap([peerMessage('m-1', 'новое', '2026-08-23T08:00:00Z')]),
    has_older: true,
    older_cursor_message_id: 'm-1',
  });
  const view = await renderHook(
    (props: HarnessProps) => useHarness(props),
    { initialProps: makeHarnessProps({ conversationId: 'conversation-1' }) },
  );
  await act(async () => {
    await view.result.current.history.loadInitial();
  });
  expect(view.result.current.messages.length).toBeGreaterThan(0);

  mockedChatApi.getMessagesPage.mockRejectedValueOnce(new Error('boom-older'));
  await act(async () => {
    await view.result.current.history.loadOlder();
  });

  expect(mockedChatApi.getMessagesPage).toHaveBeenCalledWith('conversation-1', {
    beforeMessageId: 'm-1',
    limit: 80,
  });
  expect(toastMock).toHaveBeenCalledWith('boom-older');
  expect(view.result.current.history.error).toBe('boom-older');
  expect(view.result.current.messages.length).toBeGreaterThan(0);
});

it('shows a toast when loadNewer fails with messages already on screen', async () => {
  mockedChatApi.getThreadBootstrap.mockResolvedValue({
    ...liveBootstrap([peerMessage('m-1', 'новое', '2026-08-23T08:00:00Z')]),
    has_newer: true,
    newer_cursor_message_id: 'm-1',
  });
  const view = await renderHook(
    (props: HarnessProps) => useHarness(props),
    { initialProps: makeHarnessProps({ conversationId: 'conversation-1' }) },
  );
  await act(async () => {
    await view.result.current.history.loadInitial();
  });
  expect(view.result.current.messages.length).toBeGreaterThan(0);

  mockedChatApi.getMessagesPage.mockRejectedValueOnce(new Error('boom-newer'));
  await act(async () => {
    await view.result.current.history.loadNewer();
  });

  expect(mockedChatApi.getMessagesPage).toHaveBeenCalledWith('conversation-1', {
    afterMessageId: 'm-1',
    limit: 80,
  });
  expect(toastMock).toHaveBeenCalledWith('boom-newer');
  expect(view.result.current.history.error).toBe('boom-newer');
});

// T7: a navigation bump between loadOlder resolving and its rAF pair used to
// leave holdVisiblePosition stuck → maintainVisibleContentPosition stayed on.
it('releases holdVisiblePosition even when a jump supersedes the pending rAF', async () => {
  mockedChatApi.getThreadBootstrap.mockResolvedValue({
    ...liveBootstrap([peerMessage('m-1', 'новое', '2026-08-23T08:00:00Z')]),
    has_older: true,
    older_cursor_message_id: 'm-1',
  });
  const view = await renderHook(
    (props: HarnessProps) => useHarness(props),
    { initialProps: makeHarnessProps({ conversationId: 'conversation-1' }) },
  );
  await act(async () => {
    await view.result.current.history.loadInitial();
  });
  mockedChatApi.getMessagesPage.mockResolvedValueOnce(
    livePage([peerMessage('m-0', 'старое', '2026-08-23T07:59:00Z')]),
  );

  await act(async () => {
    await view.result.current.history.loadOlder();
  });
  expect(view.result.current.holdVisiblePosition).toBe(true);

  // jumpToBottom/focusSearchResult invalidate the pending release like this.
  await act(async () => {
    view.result.current.history.historyNavigationRef.current += 1;
  });
  expect(view.result.current.holdVisiblePosition).toBe(true);

  await act(async () => {
    flushRafFrame();
    flushRafFrame();
  });
  expect(view.result.current.holdVisiblePosition).toBe(false);
});

it('clears holdVisiblePosition when a fresh load starts', async () => {
  mockedChatApi.getThreadBootstrap.mockResolvedValue({
    ...liveBootstrap([peerMessage('m-1', 'новое', '2026-08-23T08:00:00Z')]),
    has_older: true,
    older_cursor_message_id: 'm-1',
  });
  const view = await renderHook(
    (props: HarnessProps) => useHarness(props),
    { initialProps: makeHarnessProps({ conversationId: 'conversation-1' }) },
  );
  await act(async () => {
    await view.result.current.history.loadInitial();
  });
  mockedChatApi.getMessagesPage.mockResolvedValueOnce(
    livePage([peerMessage('m-0', 'старое', '2026-08-23T07:59:00Z')]),
  );
  await act(async () => {
    await view.result.current.history.loadOlder();
  });
  expect(view.result.current.holdVisiblePosition).toBe(true);

  await act(async () => {
    await view.result.current.history.loadInitial();
  });
  expect(view.result.current.holdVisiblePosition).toBe(false);
});

// T11: the disconnected-window early return skipped marking fetched ids as
// known, so a repeated WS delivery counted them as new again.
it('marks fetched ids as known before the disconnected-window early return', async () => {
  const windowItems = [
    peerMessage('w-1', 'верх окна', '2026-08-23T08:02:00Z'),
    peerMessage('w-2', 'низ окна', '2026-08-23T08:01:00Z'),
  ];
  mockedChatApi.getThreadBootstrap.mockResolvedValue(liveBootstrap(windowItems));
  const view = await renderHook(
    (props: HarnessProps) => useHarness(props),
    { initialProps: makeHarnessProps({ conversationId: 'conversation-1' }) },
  );
  await act(async () => {
    await view.result.current.history.loadInitial();
  });
  await act(async () => {
    view.result.current.nearBottomRef.current = false;
  });

  const fetched = [
    peerMessage('n-1', 'свежее 1', '2026-08-23T08:05:00Z'),
    peerMessage('n-2', 'свежее 2', '2026-08-23T08:04:00Z'),
  ];
  mockedChatApi.getMessagesPage.mockResolvedValueOnce(livePage(fetched, { has_older: true }));
  await act(async () => {
    await view.result.current.history.syncLatestMessages();
  });

  // Disconnected branch: the window is kept, a newer gap is opened.
  expect(view.result.current.history.hasNewer).toBe(true);
  expect(view.result.current.showJumpToBottom).toBe(true);
  // The fetched ids are now known — a duplicated chat.message.created for them
  // hits `isNew === false` in useThreadRealtime, so newMessageCount stays flat.
  expect(view.result.current.knownMessageIdsRef.current.has('n-1')).toBe(true);
  expect(view.result.current.knownMessageIdsRef.current.has('n-2')).toBe(true);
  expect(view.result.current.knownMessageIdsRef.current.has('w-1')).toBe(true);
  expect(view.result.current.knownMessageIdsRef.current.has('w-2')).toBe(true);
});

// T13: the durable merge ran on every messages change; now it runs once per
// flush while the written snapshot keeps the same content.
it('merges the window into durable history once per snapshot flush', async () => {
  jest.useFakeTimers();
  try {
    mockedChatApi.getThreadBootstrap.mockResolvedValue(
      liveBootstrap([peerMessage('m-1', 'стартовое', '2026-08-23T08:00:00Z')]),
    );
    const view = await renderHook(
      (props: HarnessProps) => useHarness(props),
      { initialProps: makeHarnessProps({ conversationId: 'conversation-1' }) },
    );
    await act(async () => {
      await view.result.current.history.loadInitial();
    });
    expect(view.result.current.history.threadHydrated).toBe(true);
    mergeHistorySpy.mockClear();
    scheduleWriteSpy.mockClear();

    for (let index = 0; index < 4; index += 1) {
      await act(async () => {
        view.result.current.setMessages((current) => mergeMessages(
          current,
          peerMessage(`ws-${index}`, `ws ${index}`, `2026-08-23T08:0${index + 1}:00Z`),
          1,
        ));
      });
    }
    // Each update only marked the pending write dirty — no merge+sort ran.
    expect(mergeHistorySpy).not.toHaveBeenCalled();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });
    expect(mergeHistorySpy).toHaveBeenCalled();
    expect(mergeHistorySpy.mock.calls.length).toBeLessThanOrEqual(2);

    const write = scheduleWriteSpy.mock.calls.at(-1);
    expect(write).toBeTruthy();
    const snapshot = write?.[2] as NativeChatThreadSnapshot;
    const ids = new Set(snapshot.messages.map((message) => message.id));
    ['m-1', 'ws-0', 'ws-1', 'ws-2', 'ws-3'].forEach((id) => {
      expect(ids.has(id)).toBe(true);
    });
  } finally {
    jest.useRealTimers();
  }
});
