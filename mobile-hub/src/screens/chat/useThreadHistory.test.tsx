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
import type { createNativeChatOutbox } from '../../chat/nativeChatOutbox';
import type { NativeChatThreadSnapshot } from '../../chat/nativeChatThreadHistory';
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

const mockedChatApi = chatApi as jest.Mocked<typeof chatApi>;
const readSnapshot = jest.mocked(readNativeEntitySnapshot);

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

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

const cachedSnapshot = (
  messages: ChatMessage[],
  title = 'Кэш диалога',
): NativeSnapshot<NativeChatThreadSnapshot> => ({
  savedAt: 1,
  data: {
    conversation: { id: 'conversation-1', kind: 'direct', title },
    title,
    messages,
    hasOlder: false,
    olderCursor: null,
    hasNewer: false,
    newerCursor: null,
    unreadBoundaryId: null,
    focusAnchorId: null,
    pinnedMessageId: null,
  },
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
    knownMessageIdsRef,
    pendingAttachmentUploadsRef,
  };
}

beforeEach(() => {
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

it('starts the bootstrap page and conversation requests before the snapshot read resolves', async () => {
  const snapshot = deferred<NativeSnapshot<NativeChatThreadSnapshot> | null>();
  readSnapshot.mockImplementation(() => snapshot.promise);
  const view = await renderHook(
    (props: HarnessProps) => useHarness(props),
    { initialProps: makeHarnessProps({ conversationId: 'conversation-1' }) },
  );

  let loadPromise!: Promise<void>;
  await act(async () => {
    loadPromise = view.result.current.history.loadInitial();
  });

  // The encrypted snapshot is still pending, but both requests are in flight.
  // M7: the ordinary open goes through thread-bootstrap (first-unread anchor).
  expect(mockedChatApi.getThreadBootstrap).toHaveBeenCalledTimes(1);
  expect(mockedChatApi.getThreadBootstrap).toHaveBeenCalledWith('conversation-1', {
    limit: 80,
    lightweight: false,
  });
  expect(mockedChatApi.getMessagesPage).not.toHaveBeenCalled();
  expect(mockedChatApi.getConversation).toHaveBeenCalledWith('conversation-1');

  await act(async () => {
    snapshot.resolve(null);
    await loadPromise;
  });
  expect(view.result.current.history.loading).toBe(false);
  expect(view.result.current.history.threadHydrated).toBe(true);
});

it('falls back to the plain messages page when thread bootstrap is unavailable', async () => {
  readSnapshot.mockResolvedValue(null);
  mockedChatApi.getThreadBootstrap.mockRejectedValueOnce(new Error('404'));
  mockedChatApi.getMessagesPage.mockResolvedValueOnce(livePage([
    peerMessage('m-fallback', 'из fallback-страницы', '2026-08-23T08:00:00Z'),
  ]));
  const view = await renderHook(
    (props: HarnessProps) => useHarness(props),
    { initialProps: makeHarnessProps({ conversationId: 'conversation-1' }) },
  );

  await act(async () => {
    await view.result.current.history.loadInitial();
  });

  expect(mockedChatApi.getMessagesPage).toHaveBeenCalledWith('conversation-1', { limit: 80 });
  expect(view.result.current.messages.map((item) => item.id)).toEqual(['m-fallback']);
  expect(view.result.current.history.loading).toBe(false);
});

it('anchors on the first unread message when bootstrap reports it (M7)', async () => {
  readSnapshot.mockResolvedValue(null);
  const items = [
    peerMessage('m-new', 'новое', '2026-08-23T08:02:00Z'),
    peerMessage('m-unread', 'первое непрочитанное', '2026-08-23T08:01:00Z'),
    peerMessage('m-old', 'прочитанное', '2026-08-23T08:00:00Z'),
  ];
  mockedChatApi.getThreadBootstrap.mockResolvedValueOnce({
    ...liveBootstrap(items),
    has_older: true,
    older_cursor_message_id: 'm-old',
    has_newer: true,
    newer_cursor_message_id: 'm-new',
    initial_anchor_mode: 'first_unread',
    initial_anchor_message_id: 'm-unread',
  });
  const props = makeHarnessProps({ conversationId: 'conversation-1' });
  const view = await renderHook(
    (current: HarnessProps) => useHarness(current),
    { initialProps: props },
  );

  await act(async () => {
    await view.result.current.history.loadInitial();
  });

  // The first-unread anchor becomes both the unread boundary and the focus
  // target; has_newer keeps the jump-to-bottom affordance instead of markRead.
  expect(view.result.current.unreadBoundaryId).toBe('m-unread');
  expect(view.result.current.focusAnchorId).toBe('m-unread');
  expect(view.result.current.showJumpToBottom).toBe(true);
  expect(props.markRead).not.toHaveBeenCalled();
});

it('starts getThreadBootstrap before the snapshot read when opened on a message', async () => {
  const snapshot = deferred<NativeSnapshot<NativeChatThreadSnapshot> | null>();
  readSnapshot.mockImplementation(() => snapshot.promise);
  const view = await renderHook(
    (props: HarnessProps) => useHarness(props),
    { initialProps: makeHarnessProps({ conversationId: 'conversation-1', messageId: 'message-77' }) },
  );

  let loadPromise!: Promise<void>;
  await act(async () => {
    loadPromise = view.result.current.history.loadInitial();
  });

  expect(mockedChatApi.getThreadBootstrap).toHaveBeenCalledWith('conversation-1', {
    focusMessageId: 'message-77',
    limit: 80,
    lightweight: false,
  });
  expect(mockedChatApi.getMessagesPage).not.toHaveBeenCalled();
  expect(mockedChatApi.getConversation).toHaveBeenCalledWith('conversation-1');

  await act(async () => {
    snapshot.resolve(null);
    await loadPromise;
  });
  expect(view.result.current.history.loading).toBe(false);
});

it('keeps an earlier network response when the snapshot resolves afterwards', async () => {
  const snapshot = deferred<NativeSnapshot<NativeChatThreadSnapshot> | null>();
  readSnapshot.mockImplementation(() => snapshot.promise);
  const page = deferred<ChatThreadBootstrapPage>();
  mockedChatApi.getThreadBootstrap.mockImplementation(() => page.promise);
  const view = await renderHook(
    (props: HarnessProps) => useHarness(props),
    { initialProps: makeHarnessProps({ conversationId: 'conversation-1' }) },
  );

  let loadPromise!: Promise<void>;
  await act(async () => {
    loadPromise = view.result.current.history.loadInitial();
  });
  await act(async () => {
    // The network answers while the snapshot decryption is still running.
    page.resolve(liveBootstrap([
      peerMessage('m-1', 'из сети', '2026-08-23T08:00:00Z'),
      peerMessage('net-2', 'только сеть', '2026-08-23T08:01:00Z'),
    ]));
    snapshot.resolve(cachedSnapshot([
      peerMessage('m-1', 'из кэша', '2026-08-23T08:00:00Z'),
      peerMessage('cached-2', 'только кэш', '2026-08-23T07:00:00Z'),
    ]));
    await loadPromise;
  });

  const byId = new Map(view.result.current.messages.map((item) => [item.id, item]));
  expect(byId.get('m-1')?.body_text).toBe('из сети');
  expect(byId.has('net-2')).toBe(true);
  expect(byId.has('cached-2')).toBe(true);
  expect(view.result.current.title).toBe('Живой диалог');
  expect(view.result.current.history.loading).toBe(false);
});

it('makes no network requests in offline mode', async () => {
  const view = await renderHook(
    (props: HarnessProps) => useHarness(props),
    { initialProps: makeHarnessProps({ conversationId: 'conversation-1', offlineMode: true }) },
  );

  await act(async () => {
    await view.result.current.history.loadInitial();
  });

  expect(mockedChatApi.getMessagesPage).not.toHaveBeenCalled();
  expect(mockedChatApi.getThreadBootstrap).not.toHaveBeenCalled();
  expect(mockedChatApi.getConversation).not.toHaveBeenCalled();
  expect(view.result.current.history.historyUnavailableOffline).toBe(true);
  expect(view.result.current.history.loading).toBe(false);
});

it('drops the stale load when the conversation changes mid-flight', async () => {
  const snapshot = deferred<NativeSnapshot<NativeChatThreadSnapshot> | null>();
  readSnapshot.mockImplementation(() => snapshot.promise);
  const page = deferred<ChatThreadBootstrapPage>();
  mockedChatApi.getThreadBootstrap.mockImplementation(() => page.promise);
  const view = await renderHook(
    (props: HarnessProps) => useHarness(props),
    { initialProps: makeHarnessProps({ conversationId: 'conversation-1' }) },
  );

  let staleLoad!: Promise<void>;
  await act(async () => {
    staleLoad = view.result.current.history.loadInitial();
  });
  expect(mockedChatApi.getThreadBootstrap).toHaveBeenCalledWith('conversation-1', {
    limit: 80,
    lightweight: false,
  });

  await act(async () => {
    await view.rerender(makeHarnessProps({ conversationId: 'conversation-2' }));
  });
  await act(async () => {
    snapshot.resolve(cachedSnapshot([peerMessage('m-old', 'старый', '2026-08-23T08:00:00Z')]));
    page.resolve(liveBootstrap([peerMessage('m-old', 'старый', '2026-08-23T08:00:00Z')]));
    await staleLoad;
  });

  expect(view.result.current.messages).toEqual([]);
  expect(view.result.current.conversation).toBeNull();
  expect(view.result.current.title).toBe('Chat');
});
