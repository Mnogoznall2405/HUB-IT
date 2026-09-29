import React, { memo, useCallback, useMemo, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
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
import { hapticSelection } from '../../native/haptics';

type ThreadStyles = Record<string, StyleProp<ViewStyle | TextStyle>>;

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
  selected,
  selecting,
  highlighted,
  canCompose,
  actionsRef,
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
  selected: boolean;
  selecting: boolean;
  highlighted: boolean;
  canCompose: boolean;
  actionsRef: MutableRefObject<MessageActionsBag>;
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
      showSenderAvatars={actions.showSenderAvatars}
      groupPosition={decoration?.groupPosition || 'single'}
      onSwipeReply={canCompose && !item.is_deleted && !item.local_status && item.kind !== 'system'
        ? () => actions.startReply(item)
        : undefined}
      onSwipeForward={!item.is_deleted && !item.local_status && item.kind !== 'system'
        ? () => void actions.openForward(item)
        : undefined}
      onPress={selecting ? () => actions.toggleSelection(item) : openActions}
      onActionsAnchor={(next) => setActionAnchor(next)}
      onLongPress={canSelectChatMessage(item) ? () => {
        void hapticSelection();
        actions.startSelection(item);
      } : openActions}
      onReactionPress={actions.canWrite && !item.local_status ? (emoji) => void actions.toggleReaction(item, emoji) : undefined}
      onReactionLongPress={(emoji, userIds) => actions.showReactionUsers(item, emoji, userIds)}
      onQuickReaction={actions.canWrite && !selecting && !item.local_status ? (emoji) => {
        setActionMessage(null);
        void actions.toggleReaction(item, emoji);
      } : undefined}
      onReplyPreviewPress={(targetId) => void actions.focusMessageById(targetId)}
      attachmentTransfers={attachmentTransfersRef.current}
      onAttachmentTransferCancel={(attachment) => actions.cancelAttachmentTransfer(item, attachment)}
      onAttachmentTransferRetry={(attachment) => actions.retryAttachmentTransfer(item, attachment)}
      onAttachmentOpen={!item.local_status
        ? (attachment) => actions.openAttachment(item, attachment)
        : undefined}
      onAttachmentPress={!item.local_status
        ? (attachment) => actions.openAttachmentActions(item, attachment)
        : undefined}
      onSenderPress={actions.showSenderAvatars || actions.conversationKind === 'direct'
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
      onAlbumAttachmentPress={(entry) => actions.openAttachment(entry.message, entry.attachment)}
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
  const albumByMessageIdRef = useRef(albumByMessageId);
  albumByMessageIdRef.current = albumByMessageId;

  const selectedMessageIdsRef = useRef(selectedMessageIds);
  selectedMessageIdsRef.current = selectedMessageIds;
  const highlightedMessageIdRef = useRef(highlightedMessageId);
  highlightedMessageIdRef.current = highlightedMessageId;
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

  const renderMessage = useCallback(({ item }: ListRenderItemInfo<ChatMessage>) => {
    const selectedIds = selectedMessageIdsRef.current;
    return (
      <ThreadMessageRow
        item={item}
        album={albumByMessageIdRef.current.get(item.id)}
        decoration={decorationsByIdRef.current.get(item.id)}
        selected={selectedIds.includes(item.id)}
        selecting={selectedIds.length > 0}
        highlighted={item.id === highlightedMessageIdRef.current}
        canCompose={canCompose}
        actionsRef={messageActionsRef}
        attachmentTransfersRef={attachmentTransfersRef}
        messageEnterMotionsRef={messageEnterMotionsRef}
        finishMessageEnterMotion={finishMessageEnterMotion}
        setActionMessage={setActionMessage}
        setActionAnchor={setActionAnchor}
        reduceMotion={reduceMotion}
        styles={styles}
      />
    );
  }, [attachmentTransfersRef, canCompose, finishMessageEnterMotion, messageEnterMotionsRef,
    reduceMotion, setActionAnchor, setActionMessage, styles]);

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
