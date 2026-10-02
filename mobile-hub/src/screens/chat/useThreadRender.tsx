import React, { memo, useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { Text, View, type ListRenderItemInfo, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import type { ChatAttachment, ChatConversationSummary, ChatMessage, ChatUserSummary } from '../../api/types';
import { canSelectChatMessage } from '../../chat/chatMessageSelection';
import {
  buildChatThreadRowDecorations,
  resolveChatMessageIsOwn,
  type ChatThreadRowDecoration,
} from '../../chat/chatState';
import { getNativeChatQueueState } from '../../chat/nativeChatOutbox';
import { shouldShowSenderAvatarsForKind } from '../../chat/chatBubbleLayout';
import type { ChatMenuAnchor } from '../../chat/chatMessageMenuLayout';
import {
  ChatMessageEnterMotion,
  chatMessageMotionKey,
  type ChatMessageEnterKind,
} from '../../components/chat/ChatMessageEnterMotion';
import { SwipeableChatBubble } from '../../components/chat/SwipeableChatBubble';
import type { ChatAttachmentTransfer } from '../../components/chat/ChatDocumentAttachment';
import { buildChatMediaAlbumMap, type ChatMediaAlbum } from '../../chat/chatMediaAlbum';
import { isVideoChatAttachment, pickChatAttachmentPreviewUrl } from '../../chat/chatMedia';
import { hapticSelection } from '../../native/haptics';

type ThreadStyles = Record<string, StyleProp<ViewStyle | TextStyle>>;

const THREAD_ROW_SELECTED = 1;
const THREAD_ROW_HIGHLIGHTED = 2;
const THREAD_ROW_SELECTING = 4;

/** External per-row flags for selection/highlight. Selection state changes are
 * high-frequency user input; keeping them in `extraData` would re-invoke
 * `renderItem` for every cell and flip the shared `selecting` prop on each row.
 * Rows subscribe with a per-id snapshot instead, so a one-message toggle
 * rerenders only the rows whose own flags changed. */
type ThreadRowStore = {
  subscribe: (listener: () => void) => () => void;
  setSelectedIds: (ids: string[]) => void;
  setHighlightedId: (id: string | null) => void;
  isSelecting: () => boolean;
  flagsFor: (id: string, includeSelecting: boolean) => number;
};

function createThreadRowStore(): ThreadRowStore {
  let selectedIds = new Set<string>();
  let highlightedId: string | null = null;
  const listeners = new Set<() => void>();
  const emit = () => {
    listeners.forEach((listener) => {
      try { listener(); } catch { /* Observer only. */ }
    });
  };
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setSelectedIds: (ids) => {
      const next = new Set(ids);
      let changed = selectedIds.size !== next.size;
      if (!changed) {
        next.forEach((id) => { if (!selectedIds.has(id)) changed = true; });
      }
      if (!changed) return;
      selectedIds = next;
      emit();
    },
    setHighlightedId: (id) => {
      if (id === highlightedId) return;
      highlightedId = id;
      emit();
    },
    isSelecting: () => selectedIds.size > 0,
    flagsFor: (id, includeSelecting) => (
      (selectedIds.has(id) ? THREAD_ROW_SELECTED : 0)
      | (highlightedId === id ? THREAD_ROW_HIGHLIGHTED : 0)
      | (includeSelecting && selectedIds.size ? THREAD_ROW_SELECTING : 0)
    ),
  };
}

type MessageActionsBag = {
  canWrite: boolean;
  offlineMode: boolean;
  cancelAttachmentTransfer: (message: ChatMessage, attachment: ChatAttachment) => void;
  conversationKind?: ChatConversationSummary['kind'];
  currentUserId?: number;
  showSenderAvatars: boolean;
  focusMessageById: (targetMessageId: string) => Promise<void>;
  openAttachment: (message: ChatMessage, attachment: ChatAttachment) => void;
  openAttachmentActions: (message: ChatMessage, attachment: ChatAttachment) => void;
  openForward: (messagesToForward: ChatMessage | ChatMessage[]) => Promise<void>;
  openPersonProfile: (user: ChatUserSummary) => void;
  openTask: (taskId: string) => void;
  votePoll: (message: ChatMessage, optionIndex: number) => Promise<void>;
  closePoll: (message: ChatMessage) => Promise<void>;
  runAiAction: (actionId: string, action: 'confirm' | 'cancel') => Promise<void>;
  retryAttachmentTransfer: (message: ChatMessage, attachment: ChatAttachment) => void;
  startReply: (message: ChatMessage) => void;
  startSelection: (message: ChatMessage) => void;
  toggleReaction: (message: ChatMessage, emoji: string) => Promise<void>;
  toggleSelection: (message: ChatMessage) => void;
  /** F-REACTORS: show "who reacted" for a reaction chip long-press. */
  showReactionUsers: (message: ChatMessage, emoji: string, userIds: number[]) => void;
};

/** One list row. Memoized on the message object identity plus the handful of
 * per-row primitives that actually change its output, so a FlatList cell
 * rerender caused by an index shift stays a no-op for untouched messages. */
const ThreadMessageRow = memo(function ThreadMessageRow({
  item,
  album,
  decoration,
  canCompose,
  showSenderAvatars,
  actionsRef,
  rowStore,
  attachmentTransfersRef,
  messageEnterMotionsRef,
  finishMessageEnterMotion,
  setActionMessage,
  setActionAnchor,
  reduceMotion,
  styles,
}: {
  item: ChatMessage;
  decoration?: ChatThreadRowDecoration;
  canCompose: boolean;
  /** Prop rather than actions-bag field: the memoized row must rerender when
   * the group conversation arrives after its messages (T2). */
  showSenderAvatars: boolean;
  actionsRef: MutableRefObject<MessageActionsBag>;
  rowStore: ThreadRowStore;
  album?: ChatMediaAlbum;
  attachmentTransfersRef: MutableRefObject<Record<string, ChatAttachmentTransfer>>;
  messageEnterMotionsRef: MutableRefObject<Map<string, ChatMessageEnterKind>>;
  finishMessageEnterMotion: (motionKey: string) => void;
  setActionMessage: Dispatch<SetStateAction<ChatMessage | null>>;
  setActionAnchor: Dispatch<SetStateAction<ChatMenuAnchor | null>>;
  reduceMotion: boolean;
  styles: ThreadStyles;
}) {
  const actions = actionsRef.current;
  const isOwn = Boolean(resolveChatMessageIsOwn(item, actions.currentUserId));
  // Selected/highlight flip only this row's snapshot; the shared "selecting"
  // flag is exposed to album rows (they must expand, DEV-MEDIA-1) so that
  // entering/leaving selection mode does not rerender the whole list. Other
  // rows read it at event time via rowStore.isSelecting().
  const rowFlags = useSyncExternalStore(
    rowStore.subscribe,
    () => rowStore.flagsFor(item.id, Boolean(album)),
  );
  const selected = Boolean(rowFlags & THREAD_ROW_SELECTED);
  const highlighted = Boolean(rowFlags & THREAD_ROW_HIGHLIGHTED);
  const selecting = Boolean(rowFlags & THREAD_ROW_SELECTING);
  const openActions = item.kind === 'system'
    ? undefined
    : () => {
      void hapticSelection();
      setActionAnchor(null);
      setActionMessage(item);
    };
  const motionKey = chatMessageMotionKey(item);
  const enterKind = messageEnterMotionsRef.current.get(motionKey);
  // DEV-MEDIA-1: non-head album rows collapse into the head's grid bubble.
  // While selecting, every message stays visible for per-message selection.
  const albumCollapsed = Boolean(album) && album!.headId !== item.id && !selecting;
  const activeAlbum = album && !albumCollapsed && !selecting ? album : undefined;
  const decorations = (
    <>
      {decoration?.showDate ? (
        <View style={styles.dateSeparator} accessibilityRole="text">
          <Text style={styles.dateSeparatorText}>{decoration.dateLabel}</Text>
        </View>
      ) : null}
      {decoration?.unreadBoundary ? (
        <View style={styles.unreadSeparator} accessibilityLiveRegion="polite">
          <View style={styles.unreadLine} />
          <Text style={styles.unreadText}>Непрочитанные сообщения</Text>
          <View style={styles.unreadLine} />
        </View>
      ) : null}
    </>
  );
  if (albumCollapsed) return <View>{decorations}</View>;
  const bubble = (
    <SwipeableChatBubble
      message={item}
      isOwn={isOwn}
      selected={selected}
      highlighted={highlighted}
      swipeEnabled={!selecting}
      showSenderAvatars={showSenderAvatars}
      groupPosition={decoration?.groupPosition || 'single'}
      // Non-album rows keep `selecting` = false so a mode change never
      // invalidates their memoization; the swipe/press/quick-reaction guards
      // therefore read the flag from the store at event time.
      onSwipeReply={canCompose && !item.is_deleted && !item.local_status && item.kind !== 'system'
        ? () => {
          if (rowStore.isSelecting()) return;
          actions.startReply(item);
        }
        : undefined}
      onSwipeForward={!item.is_deleted && !item.local_status && item.kind !== 'system'
        ? () => {
          if (!rowStore.isSelecting()) void actions.openForward(item);
        }
        : undefined}
      onPress={openActions
        ? () => {
          if (rowStore.isSelecting()) actions.toggleSelection(item);
          else openActions();
        }
        : undefined}
      onActionsAnchor={(next) => setActionAnchor(next)}
      onLongPress={canSelectChatMessage(item) ? () => {
        void hapticSelection();
        actions.startSelection(item);
      } : openActions}
      onReactionPress={actions.canWrite && !item.local_status ? (emoji) => void actions.toggleReaction(item, emoji) : undefined}
      onReactionLongPress={(emoji, userIds) => actions.showReactionUsers(item, emoji, userIds)}
      onQuickReaction={actions.canWrite && !item.local_status ? (emoji) => {
        if (rowStore.isSelecting()) {
          actions.toggleSelection(item);
          return;
        }
        setActionMessage(null);
        void actions.toggleReaction(item, emoji);
      } : undefined}
      onReplyPreviewPress={(targetId) => void actions.focusMessageById(targetId)}
      attachmentTransfers={attachmentTransfersRef.current}
      onAttachmentTransferCancel={(attachment) => actions.cancelAttachmentTransfer(item, attachment)}
      onAttachmentTransferRetry={(attachment) => actions.retryAttachmentTransfer(item, attachment)}
      onAttachmentOpen={!item.local_status
        ? (attachment) => {
          if (rowStore.isSelecting()) {
            actions.toggleSelection(item);
            return;
          }
          actions.openAttachment(item, attachment);
        }
        : undefined}
      onAttachmentPress={!item.local_status
        ? (attachment) => {
          if (rowStore.isSelecting()) {
            actions.toggleSelection(item);
            return;
          }
          actions.openAttachmentActions(item, attachment);
        }
        : undefined}
      onSenderPress={showSenderAvatars || actions.conversationKind === 'direct'
        ? (sender) => actions.openPersonProfile(sender)
        : undefined}
      onTaskPress={actions.openTask}
      onPollVote={!item.local_status && actions.canWrite
        ? (optionIndex) => void actions.votePoll(item, optionIndex)
        : undefined}
      onPollClose={!item.local_status && actions.canWrite
        ? () => void actions.closePoll(item)
        : undefined}
      onConfirmAction={(actionId) => void actions.runAiAction(actionId, 'confirm')}
      onCancelAction={(actionId) => void actions.runAiAction(actionId, 'cancel')}
      album={activeAlbum}
      onAlbumAttachmentPress={(entry) => {
        if (rowStore.isSelecting()) {
          actions.toggleSelection(entry.message);
          return;
        }
        actions.openAttachment(entry.message, entry.attachment);
      }}
      awaitingConnection={['queued', 'retry'].includes(getNativeChatQueueState(item) || '')}
      offline={actions.offlineMode}
    />
  );
  return (
    <View>
      {decorations}
      {(
        <ChatMessageEnterMotion
          motionKey={motionKey}
          kind={enterKind}
          reduceMotion={reduceMotion}
          onFinished={finishMessageEnterMotion}
        >
          {bubble}
        </ChatMessageEnterMotion>
      )}
    </View>
  );
});

/** Content key for the album identity cache (T12): head, caption and the
 * per-entry fields the album grid actually renders (preview, video badge,
 * duration, disabled state). A change to any of them yields a new album
 * object; unrelated message edits keep the previous identity. */
function chatMediaAlbumRenderKey(album: ChatMediaAlbum): string {
  return [
    album.headId,
    album.caption,
    ...album.entries.map((entry) => [
      entry.message.id,
      entry.message.local_status || '',
      entry.attachment.id,
      entry.attachment.file_name || '',
      entry.attachment.duration_seconds ?? '',
      entry.attachment.local_uri || '',
      pickChatAttachmentPreviewUrl(entry.attachment) || '',
      isVideoChatAttachment(entry.attachment) ? 'v' : 'i',
    ].join('~')),
  ].join('|');
}

/** Row rendering for the inverted message list: decorations, selection,
 * enter-motion and the ref-held action bag that keeps renderMessage stable. */
export function useThreadRender({
  conversation,
  userId,
  canWrite,
  canCompose,
  offlineMode,
  reduceMotion,
  messages,
  unreadBoundaryId,
  selectedMessageIds,
  highlightedMessageId,
  attachmentTransfersRef,
  messageEnterMotionsRef,
  setActionMessage,
  setActionAnchor,
  focusMessageById,
  openAttachment,
  openAttachmentActions,
  openForward,
  openPersonProfile,
  openTask,
  votePoll,
  closePoll,
  runAiAction,
  cancelAttachmentTransfer,
  retryAttachmentTransfer,
  startReply,
  startSelection,
  toggleReaction,
  toggleSelection,
  showReactionUsers,
  styles,
}: {
  conversation: ChatConversationSummary | null;
  userId?: number;
  canWrite: boolean;
  canCompose: boolean;
  offlineMode: boolean;
  reduceMotion: boolean;
  messages: ChatMessage[];
  unreadBoundaryId: string | null;
  selectedMessageIds: string[];
  highlightedMessageId: string | null;
  attachmentTransfersRef: MutableRefObject<Record<string, ChatAttachmentTransfer>>;
  messageEnterMotionsRef: MutableRefObject<Map<string, ChatMessageEnterKind>>;
  setActionMessage: Dispatch<SetStateAction<ChatMessage | null>>;
  setActionAnchor: Dispatch<SetStateAction<ChatMenuAnchor | null>>;
  focusMessageById: (targetMessageId: string) => Promise<void>;
  openAttachment: (message: ChatMessage, attachment: ChatAttachment) => void;
  openAttachmentActions: (message: ChatMessage, attachment: ChatAttachment) => void;
  openForward: (messagesToForward: ChatMessage | ChatMessage[]) => Promise<void>;
  openPersonProfile: (user: ChatUserSummary) => void;
  openTask: (taskId: string) => void;
  votePoll: (message: ChatMessage, optionIndex: number) => Promise<void>;
  closePoll: (message: ChatMessage) => Promise<void>;
  runAiAction: (actionId: string, action: 'confirm' | 'cancel') => Promise<void>;
  cancelAttachmentTransfer: (message: ChatMessage, attachment: ChatAttachment) => void;
  retryAttachmentTransfer: (message: ChatMessage, attachment: ChatAttachment) => void;
  startReply: (message: ChatMessage) => void;
  startSelection: (message: ChatMessage) => void;
  toggleReaction: (message: ChatMessage, emoji: string) => Promise<void>;
  toggleSelection: (message: ChatMessage) => void;
  showReactionUsers: (message: ChatMessage, emoji: string, userIds: number[]) => void;
  styles: ThreadStyles;
}) {
  const showSenderAvatars = shouldShowSenderAvatarsForKind(conversation?.kind);
  const rowDecorations = useMemo(
    () => buildChatThreadRowDecorations(messages, unreadBoundaryId),
    [messages, unreadBoundaryId],
  );
  // Decorations keyed by message id with identity preservation: rows compare
  // them shallowly via memo, so only rows whose decoration actually changed
  // (date/boundary/group neighbours of a new message) rerender.
  const decorationsById = useMemo(() => {
    const next = new Map<string, ChatThreadRowDecoration>();
    messages.forEach((message, index) => {
      const decoration = rowDecorations[index];
      if (decoration) next.set(message.id, decoration);
    });
    return next;
  }, [messages, rowDecorations]);
  const decorationsByIdRef = useRef(decorationsById);
  const previousDecorations = decorationsByIdRef.current;
  const mergedDecorations = new Map<string, ChatThreadRowDecoration>();
  decorationsById.forEach((decoration, id) => {
    const previous = previousDecorations.get(id);
    mergedDecorations.set(id, previous
      && previous.showDate === decoration.showDate
      && previous.dateLabel === decoration.dateLabel
      && previous.groupPosition === decoration.groupPosition
      && previous.unreadBoundary === decoration.unreadBoundary
      ? previous
      : decoration);
  });
  decorationsByIdRef.current = mergedDecorations;

  // DEV-MEDIA-1: consecutive photo-only messages of one sender share one
  // album grid rendered by the chronologically first row.
  const albumByMessageId = useMemo(() => buildChatMediaAlbumMap(messages), [messages]);
  // T12: the builder returns fresh album objects on every `messages` change,
  // which would invalidate memoized album rows on unrelated edits. Keep the
  // previous object while its render-relevant content key did not change.
  const albumCacheRef = useRef(new Map<string, { key: string; album: ChatMediaAlbum }>());
  const albumByHeadId = new Map<string, ChatMediaAlbum>();
  albumByMessageId.forEach((album) => {
    if (!albumByHeadId.has(album.headId)) albumByHeadId.set(album.headId, album);
  });
  const stableAlbumByMessageId = new Map<string, ChatMediaAlbum>();
  const nextAlbumCache = new Map<string, { key: string; album: ChatMediaAlbum }>();
  albumByHeadId.forEach((album, headId) => {
    const key = chatMediaAlbumRenderKey(album);
    const cached = albumCacheRef.current.get(headId);
    const stable = cached && cached.key === key ? cached.album : album;
    nextAlbumCache.set(headId, { key, album: stable });
    album.entries.forEach((entry) => stableAlbumByMessageId.set(entry.message.id, stable));
  });
  albumCacheRef.current = nextAlbumCache;
  const albumByMessageIdRef = useRef(stableAlbumByMessageId);
  albumByMessageIdRef.current = stableAlbumByMessageId;

  const selectedMessageIdsRef = useRef(selectedMessageIds);
  selectedMessageIdsRef.current = selectedMessageIds;
  const highlightedMessageIdRef = useRef(highlightedMessageId);
  highlightedMessageIdRef.current = highlightedMessageId;
  // Selection/highlight live in a per-screen store subscribed per row; the
  // list's extraData stays stable, so toggling one message rerenders only the
  // rows whose own flags flipped (PERF-OPEN-2).
  const rowStoreRef = useRef<ThreadRowStore | null>(null);
  if (!rowStoreRef.current) rowStoreRef.current = createThreadRowStore();
  const rowStore = rowStoreRef.current;
  useEffect(() => { rowStore.setSelectedIds(selectedMessageIds); }, [rowStore, selectedMessageIds]);
  useEffect(() => { rowStore.setHighlightedId(highlightedMessageId); }, [rowStore, highlightedMessageId]);
  // T15: enter-motion intents are consumed by the mounted row's animation.
  // When the window is replaced before such a row ever mounts, its map entry
  // would survive forever and replay a stale animation on revisit — prune
  // motions whose message is no longer in the window.
  useEffect(() => {
    const motions = messageEnterMotionsRef.current;
    if (!motions.size) return;
    const liveKeys = new Set(messages.map((message) => chatMessageMotionKey(message)));
    motions.forEach((_kind, motionKey) => {
      if (!liveKeys.has(motionKey)) motions.delete(motionKey);
    });
  }, [messages, messageEnterMotionsRef]);
  const messageActionsRef = useRef<MessageActionsBag>({
    canWrite,
    offlineMode,
    cancelAttachmentTransfer,
    conversationKind: conversation?.kind,
    currentUserId: userId,
    showSenderAvatars,
    focusMessageById,
    openAttachment,
    openAttachmentActions,
    openForward,
    openPersonProfile,
    openTask,
    votePoll,
    closePoll,
    runAiAction,
    retryAttachmentTransfer,
    startReply,
    startSelection,
    toggleReaction,
    toggleSelection,
    showReactionUsers,
  });
  messageActionsRef.current = {
    canWrite,
    offlineMode,
    cancelAttachmentTransfer,
    conversationKind: conversation?.kind,
    currentUserId: userId,
    showSenderAvatars,
    focusMessageById,
    openAttachment,
    openAttachmentActions,
    openForward,
    openPersonProfile,
    openTask,
    votePoll,
    closePoll,
    runAiAction,
    retryAttachmentTransfer,
    startReply,
    startSelection,
    toggleReaction,
    toggleSelection,
    showReactionUsers,
  };

  const finishMessageEnterMotion = useCallback((motionKey: string) => {
    messageEnterMotionsRef.current.delete(motionKey);
  }, [messageEnterMotionsRef]);

  const renderMessage = useCallback(({ item }: ListRenderItemInfo<ChatMessage>) => (
    <ThreadMessageRow
      item={item}
      album={albumByMessageIdRef.current.get(item.id)}
      decoration={decorationsByIdRef.current.get(item.id)}
      canCompose={canCompose}
      showSenderAvatars={showSenderAvatars}
      actionsRef={messageActionsRef}
      rowStore={rowStore}
      attachmentTransfersRef={attachmentTransfersRef}
      messageEnterMotionsRef={messageEnterMotionsRef}
      finishMessageEnterMotion={finishMessageEnterMotion}
      setActionMessage={setActionMessage}
      setActionAnchor={setActionAnchor}
      reduceMotion={reduceMotion}
      styles={styles}
    />
  ), [attachmentTransfersRef, canCompose, finishMessageEnterMotion, messageEnterMotionsRef,
    reduceMotion, rowStore, setActionAnchor, setActionMessage, showSenderAvatars, styles]);

  /** Static clone of a bubble, rendered by the actions menu over the dimmed
   * backdrop at the measured anchor — Telegram's "bubble lifts in place". */
  const renderLiftedBubble = useCallback((item: ChatMessage) => {
    const actions = messageActionsRef.current;
    const isOwn = Boolean(resolveChatMessageIsOwn(item, actions.currentUserId));
    const decoration = decorationsByIdRef.current.get(item.id);
    const selectedIds = selectedMessageIdsRef.current;
    return (
      <SwipeableChatBubble
        message={item}
        isOwn={isOwn}
        selected={selectedIds.includes(item.id)}
        highlighted={item.id === highlightedMessageIdRef.current}
        swipeEnabled={false}
        showSenderAvatars={actions.showSenderAvatars}
        groupPosition={decoration?.groupPosition || 'single'}
        attachmentTransfers={attachmentTransfersRef.current}
        awaitingConnection={['queued', 'retry'].includes(getNativeChatQueueState(item) || '')}
        offline={actions.offlineMode}
      />
    );
  }, [attachmentTransfersRef]);

  return { renderMessage, renderLiftedBubble };
}
