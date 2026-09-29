import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent, ViewToken } from 'react-native';
import * as chatApi from '../../api/chatApi';
import type { ChatMessage } from '../../api/types';
import { formatApiError } from '../../api/formatError';
import { findLatestIncomingMessage, mergeMessages } from '../../chat/chatState';
import { mergeNativeChatThreadHistory } from '../../chat/nativeChatThreadHistory';
import { showNativeToast } from '../../components/nativeToast';
import type { useThreadSearch } from './useThreadSearch';

type ThreadSearch = ReturnType<typeof useThreadSearch>;

/** Scroll anchor + in-thread navigation: focus/highlight a message, jump to
 * bottom (fetching the newest page when newer history exists) and the
 * FlatList scroll/layout handlers that keep the anchor stable. */
export function useThreadScrollAnchor({
  conversationId,
  userId,
  offlineMode,
  reduceMotion,
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
}: {
  conversationId: string;
  userId?: number;
  offlineMode: boolean;
  reduceMotion: boolean;
  mountedRef: MutableRefObject<boolean>;
  loading: boolean;
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  listRef: MutableRefObject<FlatList<ChatMessage> | null>;
  nearBottomRef: MutableRefObject<boolean>;
  knownMessageIdsRef: MutableRefObject<Set<string>>;
  highlightTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  pendingBottomAnchorRef: MutableRefObject<boolean>;
  pendingAnchorAnimatedRef: MutableRefObject<boolean>;
  pendingAnchorGenerationRef: MutableRefObject<number>;
  pendingAnchorTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  anchorToBottom: (animated?: boolean, complete?: boolean) => void;
  loadGenerationRef: MutableRefObject<number>;
  historyNavigationRef: MutableRefObject<number>;
  accumulatedMessagesRef: MutableRefObject<ChatMessage[]>;
  historyMayHaveGapsRef: MutableRefObject<boolean>;
  loadingOlderRef: MutableRefObject<boolean>;
  loadingNewerRef: MutableRefObject<boolean>;
  setLoadingOlder: Dispatch<SetStateAction<boolean>>;
  hasNewer: boolean;
  setHasOlder: Dispatch<SetStateAction<boolean>>;
  setOlderCursor: Dispatch<SetStateAction<string | null>>;
  setHasNewer: Dispatch<SetStateAction<boolean>>;
  setNewerCursor: Dispatch<SetStateAction<string | null>>;
  loadOlder: () => Promise<void>;
  loadNewer: () => Promise<void>;
  focusAnchorId: string | null;
  setFocusAnchorId: Dispatch<SetStateAction<string | null>>;
  setHighlightedMessageId: Dispatch<SetStateAction<string | null>>;
  setShowJumpToBottom: Dispatch<SetStateAction<boolean>>;
  setNewMessageCount: Dispatch<SetStateAction<number>>;
  markRead: (latest?: ChatMessage | null) => void;
  search: ThreadSearch;
}) {
  const { setSearching, setSearchOpen, setSearchResults, setSearchCompleted } = search;

  // F-JUMPBACK: id of the message nearest the visible top edge (inverted
  // list → the largest viewable index). Used as the "where I was" anchor when
  // a reply/search jump leaves the current window.
  const [returnAnchorId, setReturnAnchorId] = useState<string | null>(null);
  const visibleTopMessageIdRef = useRef<string | null>(null);
  const skipAnchorRecordRef = useRef(false);
  const handleViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    let top: string | null = null;
    let maxIndex = -1;
    for (const token of viewableItems) {
      const index = Number(token.index ?? -1);
      if (index > maxIndex && token.item && typeof token.item.id === 'string') {
        maxIndex = index;
        top = token.item.id;
      }
    }
    visibleTopMessageIdRef.current = top;
  });

  useEffect(() => {
    if (loading || !focusAnchorId) return;
    const index = messages.findIndex((item) => item.id === focusAnchorId);
    if (index < 0) return;
    const timer = setTimeout(() => {
      listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.5 });
      setHighlightedMessageId(focusAnchorId);
      setFocusAnchorId(null);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setHighlightedMessageId(null);
        highlightTimerRef.current = null;
      }, 2200);
    }, 0);
    return () => clearTimeout(timer);
  }, [focusAnchorId, loading, messages]);

  const focusSearchResult = useCallback(async (message: ChatMessage) => {
    if (offlineMode && (
      messages.some((item) => item.id === message.id)
      || accumulatedMessagesRef.current.some((item) => item.id === message.id)
    )) {
      // Prefer showing from accumulated history when the current window lacks the hit.
      if (!messages.some((item) => item.id === message.id)) {
        setMessages((current) => mergeMessages(
          accumulatedMessagesRef.current,
          current.filter((item) => item.local_status),
          userId,
        ));
      }
      setFocusAnchorId(message.id);
      setSearchOpen(false);
      setSearchResults([]);
      setSearchCompleted(false);
      return;
    }
    if (offlineMode) {
      showNativeToast('Сообщение не сохранено', 'Для загрузки этого участка переписки нужно подключение.');
      return;
    }
    const generation = loadGenerationRef.current;
    const navigation = ++historyNavigationRef.current;
    loadingOlderRef.current = false;
    loadingNewerRef.current = false;
    setLoadingOlder(false);
    const isCurrentHistory = () => mountedRef.current
      && generation === loadGenerationRef.current
      && navigation === historyNavigationRef.current;
    setSearching(true);
    try {
      const page = await chatApi.getThreadBootstrap(conversationId, {
        focusMessageId: message.id,
        limit: 80,
        lightweight: false,
      });
      if (!isCurrentHistory()) return;
      const normalized = mergeMessages([], page.items, userId);
      knownMessageIdsRef.current = new Set([
        ...knownMessageIdsRef.current,
        ...normalized.map((item) => item.id),
      ]);
      accumulatedMessagesRef.current = mergeNativeChatThreadHistory(
        accumulatedMessagesRef.current,
        normalized,
        userId,
      );
      historyMayHaveGapsRef.current = Boolean(
        historyMayHaveGapsRef.current || page.has_older || page.has_newer,
      );
      // Display window only — durable history stays in accumulatedMessagesRef.
      // Keep queued locals: the page never contains them and the outbox would
      // otherwise re-insert them on its next notify, flashing the rows.
      setMessages((current) => mergeMessages(
        normalized,
        current.filter((item) => item.local_status),
        userId,
      ));
      setHasOlder(page.has_older);
      setOlderCursor(page.older_cursor_message_id);
      setHasNewer(page.has_newer);
      setNewerCursor(page.newer_cursor_message_id);
      setFocusAnchorId(page.initial_anchor_message_id || message.id);
      nearBottomRef.current = !page.has_newer;
      setShowJumpToBottom(page.has_newer);
      setSearchOpen(false);
      setSearchResults([]);
      setSearchCompleted(false);
    } catch (cause) {
      if (isCurrentHistory()) {
        showNativeToast('Не удалось перейти к сообщению', formatApiError(cause, 'Повторите попытку'));
      }
    } finally {
      if (isCurrentHistory()) setSearching(false);
    }
  }, [conversationId, messages, offlineMode, userId]);

  const focusMessageById = useCallback(async (targetMessageId: string) => {
    const normalizedId = String(targetMessageId || '').trim();
    if (!normalizedId) return;
    // Leaving the loaded window → remember where to return to.
    if (!skipAnchorRecordRef.current && !messages.some((message) => message.id === normalizedId)) {
      const origin = visibleTopMessageIdRef.current || messages[messages.length - 1]?.id;
      if (origin && origin !== normalizedId) setReturnAnchorId(origin);
    }
    if (messages.some((message) => message.id === normalizedId)) {
      setFocusAnchorId(normalizedId);
      return;
    }
    if (accumulatedMessagesRef.current.some((message) => message.id === normalizedId)) {
      setMessages((current) => mergeMessages(
        accumulatedMessagesRef.current,
        current.filter((item) => item.local_status),
        userId,
      ));
      setFocusAnchorId(normalizedId);
      return;
    }
    await focusSearchResult({
      id: normalizedId,
      conversation_id: conversationId,
      sender_user_id: 0,
    });
  }, [conversationId, focusSearchResult, messages, userId]);

  const returnToAnchor = useCallback(async () => {
    const targetId = returnAnchorId;
    if (!targetId) return;
    setReturnAnchorId(null);
    skipAnchorRecordRef.current = true;
    try {
      await focusMessageById(targetId);
    } finally {
      skipAnchorRecordRef.current = false;
    }
  }, [focusMessageById, returnAnchorId]);

  const jumpToBottom = useCallback(async () => {
    setReturnAnchorId(null);
    if (offlineMode) {
      const local = mergeMessages(accumulatedMessagesRef.current, messages, userId);
      if (!local.length) return;
      setMessages(local);
      setFocusAnchorId(local[0].id);
      setShowJumpToBottom(false);
      setNewMessageCount(0);
      return;
    }
    if (!hasNewer) {
      listRef.current?.scrollToOffset({ offset: 0, animated: !reduceMotion });
      nearBottomRef.current = true;
      setShowJumpToBottom(false);
      setNewMessageCount(0);
      markRead(findLatestIncomingMessage(messages, userId));
      return;
    }
    const generation = loadGenerationRef.current;
    const navigation = ++historyNavigationRef.current;
    loadingOlderRef.current = false;
    loadingNewerRef.current = false;
    setLoadingOlder(false);
    const isCurrentHistory = () => mountedRef.current
      && generation === loadGenerationRef.current
      && navigation === historyNavigationRef.current;
    try {
      const page = await chatApi.getMessagesPage(conversationId, { limit: 80 });
      if (!isCurrentHistory()) return;
      const normalized = mergeMessages([], page.items, userId);
      knownMessageIdsRef.current = new Set([
        ...knownMessageIdsRef.current,
        ...normalized.map((item) => item.id),
      ]);
      accumulatedMessagesRef.current = mergeNativeChatThreadHistory(
        accumulatedMessagesRef.current,
        normalized,
        userId,
      );
      historyMayHaveGapsRef.current = Boolean(
        historyMayHaveGapsRef.current || page.has_older || page.has_newer,
      );
      setMessages((current) => mergeMessages(
        normalized,
        current.filter((item) => item.local_status),
        userId,
      ));
      setHasOlder(page.has_older);
      setOlderCursor(page.older_cursor_message_id);
      setHasNewer(page.has_newer);
      setNewerCursor(page.newer_cursor_message_id);
      nearBottomRef.current = !page.has_newer;
      setShowJumpToBottom(page.has_newer);
      setNewMessageCount(0);
      markRead(findLatestIncomingMessage(normalized, userId));
    } catch (cause) {
      if (isCurrentHistory()) {
        showNativeToast('Не удалось перейти к новым сообщениям', formatApiError(cause, 'Повторите попытку'));
      }
    }
  }, [conversationId, hasNewer, markRead, messages, offlineMode, reduceMotion, userId]);

  const handleMessageListEndReached = useCallback(() => {
    void loadOlder();
  }, [loadOlder]);

  const handleMessageListScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nearBottom = event.nativeEvent.contentOffset.y < 96;
    const nextNearBottom = nearBottom && !hasNewer;
    if (!nextNearBottom && pendingBottomAnchorRef.current) {
      pendingBottomAnchorRef.current = false;
      pendingAnchorGenerationRef.current += 1;
      if (pendingAnchorTimerRef.current) clearTimeout(pendingAnchorTimerRef.current);
      pendingAnchorTimerRef.current = null;
    }
    if (nearBottomRef.current !== nextNearBottom) {
      nearBottomRef.current = nextNearBottom;
      setShowJumpToBottom(!nextNearBottom);
      if (nextNearBottom) {
        setNewMessageCount(0);
        markRead(findLatestIncomingMessage(messages, userId));
      }
    }
    if (nearBottom && hasNewer) void loadNewer();
  }, [hasNewer, loadNewer, markRead, messages]);

  const handleMessageScrollFailure = useCallback((info: {
    averageItemLength: number;
    index: number;
  }) => {
    listRef.current?.scrollToOffset({
      offset: Math.max(0, info.averageItemLength * info.index),
      animated: false,
    });
  }, []);

  const handleMessageListLayoutChange = useCallback(() => {
    if (pendingBottomAnchorRef.current) {
      anchorToBottom(pendingAnchorAnimatedRef.current);
    } else if (nearBottomRef.current) {
      anchorToBottom(false);
    }
  }, [anchorToBottom]);

  const handleMessageContentSizeChange = useCallback(() => {
    if (!pendingBottomAnchorRef.current) return;
    const generation = pendingAnchorGenerationRef.current;
    requestAnimationFrame(() => {
      if (pendingAnchorGenerationRef.current !== generation) return;
      if (pendingAnchorTimerRef.current) clearTimeout(pendingAnchorTimerRef.current);
      pendingAnchorTimerRef.current = null;
      anchorToBottom(pendingAnchorAnimatedRef.current, true);
    });
  }, [anchorToBottom]);

  return {
    focusSearchResult,
    focusMessageById,
    jumpToBottom,
    returnAnchorId,
    returnToAnchor,
    handleViewableItemsChanged,
    handleMessageListEndReached,
    handleMessageListScroll,
    handleMessageScrollFailure,
    handleMessageListLayoutChange,
    handleMessageContentSizeChange,
  };
}
