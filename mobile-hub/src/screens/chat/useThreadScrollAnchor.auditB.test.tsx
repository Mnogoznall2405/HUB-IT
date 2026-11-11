import { act, renderHook } from '@testing-library/react-native';
import { useEffect, useRef, useState } from 'react';
import type { FlatList } from 'react-native';
import * as chatApi from '../../api/chatApi';
import type { ChatMessage, ChatMessagePage, ChatThreadBootstrapPage } from '../../api/types';
import type { ChatMessageEnterKind } from '../../components/chat/ChatMessageEnterMotion';
import { useThreadScrollAnchor } from './useThreadScrollAnchor';
import type { useThreadSearch } from './useThreadSearch';

jest.mock('../../api/chatApi', () => ({
  getMessagesPage: jest.fn(),
  getThreadBootstrap: jest.fn(),
}));

const mockedChatApi = chatApi as jest.Mocked<typeof chatApi>;

type ThreadSearch = ReturnType<typeof useThreadSearch>;

type HarnessProps = {
  conversationId: string;
  userId?: number;
  offlineMode: boolean;
  reduceMotion: boolean;
  hasNewer: boolean;
  initialMessages: ChatMessage[];
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

function useHarness(props: HarnessProps) {
  const mountedRef = useRef(true);
  const nearBottomRef = useRef(true);
  const knownMessageIdsRef = useRef(new Set<string>());
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBottomAnchorRef = useRef(false);
  const pendingAnchorAnimatedRef = useRef(false);
  const pendingAnchorGenerationRef = useRef(0);
  const pendingAnchorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadGenerationRef = useRef(0);
  const historyNavigationRef = useRef(0);
  const accumulatedMessagesRef = useRef<ChatMessage[]>([]);
  const historyMayHaveGapsRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const loadingNewerRef = useRef(false);
  const messageEnterMotionsRef = useRef(new Map<string, ChatMessageEnterKind>());
  const listRef = useRef<FlatList<ChatMessage> | null>(null);
  if (!listRef.current) {
    listRef.current = {
      scrollToOffset: jest.fn(),
      scrollToIndex: jest.fn(),
      scrollToEnd: jest.fn(),
    } as unknown as FlatList<ChatMessage>;
  }
  const [loading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(props.initialMessages);
  const [hasNewer, setHasNewer] = useState(props.hasNewer);
  const [hasOlder, setHasOlder] = useState(false);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [newerCursor, setNewerCursor] = useState<string | null>(null);
  const [, setLoadingOlder] = useState(false);
  const [focusAnchorId, setFocusAnchorId] = useState<string | null>(null);
  const [, setHighlightedMessageId] = useState<string | null>(null);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<ChatMessage[]>([]);
  const [searchCompleted, setSearchCompleted] = useState(false);
  const anchorToBottom = useRef((_animated?: boolean, _complete?: boolean) => undefined).current;
  const loadOlder = useRef(async () => undefined).current;
  const loadNewer = useRef(async () => undefined).current;
  const markRead = useRef((_latest?: ChatMessage | null) => undefined).current;
  const search = {
    setSearching,
    setSearchOpen,
    setSearchResults,
    setSearchCompleted,
  } as unknown as ThreadSearch;
  const anchor = useThreadScrollAnchor({
    conversationId: props.conversationId,
    userId: props.userId,
    offlineMode: props.offlineMode,
    reduceMotion: props.reduceMotion,
    mountedRef,
    loading,
    messages,
    setMessages,
    listRef,
    nearBottomRef,
    knownMessageIdsRef,
    highlightTimerRef,
    pendingBottomAnchorRef,
    pendingAnchorAnimatedRef,
    pendingAnchorGenerationRef,
    pendingAnchorTimerRef,
    anchorToBottom,
    loadGenerationRef,
    historyNavigationRef,
    accumulatedMessagesRef,
    historyMayHaveGapsRef,
    loadingOlderRef,
    loadingNewerRef,
    setLoadingOlder,
    hasNewer,
    setHasOlder,
    setOlderCursor,
    setHasNewer,
    setNewerCursor,
    loadOlder,
    loadNewer,
    focusAnchorId,
    setFocusAnchorId,
    setHighlightedMessageId,
    setShowJumpToBottom,
    setNewMessageCount,
    markRead,
    search,
  });
  useEffect(() => {
    void messageEnterMotionsRef;
  }, []);
  return {
    anchor,
    listRef,
    mountedRef,
    nearBottomRef,
    historyNavigationRef,
    knownMessageIdsRef,
    messages,
    searching,
    searchOpen,
    searchResults,
    searchCompleted,
    hasNewer,
    hasOlder,
    olderCursor,
    newerCursor,
    showJumpToBottom,
    newMessageCount,
    focusAnchorId,
  };
}

function makeProps(options: Partial<HarnessProps> = {}): HarnessProps {
  return {
    conversationId: 'conversation-1',
    userId: 1,
    offlineMode: false,
    reduceMotion: true,
    hasNewer: false,
    initialMessages: [],
    ...options,
  };
}

// Deterministic rAF queue: onScrollToIndexFailed retries scrollToIndex on the
// next frame.
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
  mockedChatApi.getMessagesPage.mockResolvedValue(livePage([]));
  mockedChatApi.getThreadBootstrap.mockResolvedValue(liveBootstrap([]));
});

afterAll(() => {
  globalThis.requestAnimationFrame = originalRaf;
  globalThis.cancelAnimationFrame = originalCancelRaf;
});

// T9: onScrollToIndexFailed previously stopped at the approximate offset —
// the focused message could stay outside the viewport.
it('retries scrollToIndex once after the approximate offset scroll', async () => {
  const view = await renderHook(
    (props: HarnessProps) => useHarness(props),
    { initialProps: makeProps() },
  );
  const list = view.result.current.listRef.current as unknown as {
    scrollToOffset: jest.Mock;
    scrollToIndex: jest.Mock;
  };

  await act(async () => {
    view.result.current.anchor.handleMessageScrollFailure({ averageItemLength: 12, index: 4 });
  });
  expect(list.scrollToOffset).toHaveBeenCalledWith({ offset: 48, animated: false });
  expect(list.scrollToIndex).not.toHaveBeenCalled();

  await act(async () => {
    flushRafFrame();
  });
  expect(list.scrollToIndex).toHaveBeenCalledTimes(1);
  expect(list.scrollToIndex).toHaveBeenCalledWith({ index: 4, animated: false, viewPosition: 0.5 });

  // Exactly one retry per failure — further frames do not re-scroll.
  await act(async () => {
    flushRafFrame();
  });
  expect(list.scrollToIndex).toHaveBeenCalledTimes(1);
});

it('replaces a still-pending retry when another failure arrives', async () => {
  const view = await renderHook(
    (props: HarnessProps) => useHarness(props),
    { initialProps: makeProps() },
  );
  const list = view.result.current.listRef.current as unknown as {
    scrollToOffset: jest.Mock;
    scrollToIndex: jest.Mock;
  };

  await act(async () => {
    view.result.current.anchor.handleMessageScrollFailure({ averageItemLength: 10, index: 2 });
    view.result.current.anchor.handleMessageScrollFailure({ averageItemLength: 10, index: 7 });
  });
  await act(async () => {
    flushRafFrame();
  });
  expect(list.scrollToIndex).toHaveBeenCalledTimes(1);
  expect(list.scrollToIndex).toHaveBeenCalledWith({ index: 7, animated: false, viewPosition: 0.5 });
});

// T14: when loadInitial/jumpToBottom bumps historyNavigationRef mid-flight,
// the finally used to skip setSearching(false) — the spinner stuck.
it('clears searching when a jump to bottom supersedes a pending focus load', async () => {
  const bootstrap = deferred<ChatThreadBootstrapPage>();
  mockedChatApi.getThreadBootstrap.mockImplementation(() => bootstrap.promise);
  mockedChatApi.getMessagesPage.mockResolvedValue(livePage([
    peerMessage('fresh-1', 'свежее', '2026-08-23T08:05:00Z'),
  ]));
  const view = await renderHook(
    (props: HarnessProps) => useHarness(props),
    {
      initialProps: makeProps({
        hasNewer: true,
        initialMessages: [peerMessage('w-1', 'старое окно', '2026-08-23T08:00:00Z')],
      }),
    },
  );

  let focusPromise!: Promise<void>;
  await act(async () => {
    focusPromise = view.result.current.anchor.focusSearchResult({
      id: 'target-9',
      conversation_id: 'conversation-1',
      sender_user_id: 2,
    } as ChatMessage);
  });
  expect(view.result.current.searching).toBe(true);

  // The jump bumps historyNavigationRef → the focus load is superseded.
  await act(async () => {
    await view.result.current.anchor.jumpToBottom();
  });
  expect(view.result.current.searching).toBe(true);

  await act(async () => {
    bootstrap.resolve(liveBootstrap([
      peerMessage('target-9', 'найденное', '2026-08-23T07:00:00Z'),
    ]));
    await focusPromise;
  });
  expect(view.result.current.searching).toBe(false);
});
