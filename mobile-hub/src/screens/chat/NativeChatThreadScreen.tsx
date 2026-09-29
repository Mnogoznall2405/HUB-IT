import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardStickyView, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as chatApi from '../../api/chatApi';
import { HUB_WEB_ORIGIN } from '../../api/config';
import { formatApiError } from '../../api/formatError';
import { recordDiagnosticEvent } from '../../diagnostics/diagnostics';
import { markChatSend } from '../../diagnostics/chatSendTiming';
import type {
  ChatAiBot,
  ChatAttachment,
  ChatConversationSummary,
  ChatMember,
  ChatMessage,
  ChatSticker,
  ChatStickerPack,
  ChatTaskPreview,
  ChatUserSummary,
} from '../../api/types';
import { isAiConversation, resolveAiBotForConversation } from '../../chat/chatAiWorkspace';
import { useAiAgentAccess } from '../../chat/useAiAgentAccess';
import type { ChatMenuAnchor } from '../../chat/chatMessageMenuLayout';
import { useAuth } from '../../auth/AuthContext';
import { hapticSelection } from '../../native/haptics';
import {
  applyReactionEnvelope,
  buildChatThreadRowDecorations,
  findLatestIncomingMessage,
  getUnreadBoundaryMessageId,
  mergeMessages,
  messageFromEnvelope,
  resolveChatMessageIsOwn,
  toggleReactionOptimistic,
} from '../../chat/chatState';
import {
  type ChatListAnchorReason,
  shouldAnimateBottomAnchor,
  shouldRequestBottomAnchor,
  shouldUseMaintainVisibleContentPosition,
} from '../../chat/chatListAnchor';
import { useChatKeyboardMotion } from '../../chat/useChatKeyboardMotion';
import {
  getActiveNativeChatConversationId,
  notifyNativeChatConversationRead,
  setActiveNativeChatConversationId,
  subscribeNativeChatConversationRead,
} from '../../chat/chatActiveConversation';
import { nextChatThreadBackAction } from '../../chat/chatGestures';
import { findUnreadMentionMessageId } from '../../chat/chatMentions';
import { detectChatBodyFormat } from '../../chat/chatMarkdown';
import { shouldShowSenderAvatarsForKind } from '../../chat/chatBubbleLayout';
import { downloadGifToCache, type ChatGifItem } from '../../chat/chatGiphy';
import { getRecentStickerIds, rememberRecentSticker } from '../../chat/chatStickers';
import { ChatAttachmentDraftSheet } from '../../components/chat/ChatAttachmentDraftSheet';
import type { ChatAttachmentTransfer } from '../../components/chat/ChatDocumentAttachment';
import {
  collectThreadMedia,
  isImageChatAttachment,
  isMediaChatAttachment,
  mediaItemFromConversationAttachment,
  mergeChatMediaItems,
  type ChatMediaItem,
} from '../../chat/chatMedia';
import {
  applyTypingParticipant,
  formatPresenceSubtitle,
  formatTypingLine,
  parsePresenceEnvelope,
  parseTypingEnvelope,
} from '../../chat/chatTyping';
import {
  canDeleteSelectedMessages,
  canReplyToSelectedMessages,
  canSelectChatMessage,
  getSelectedMessagesCopyText,
  selectedMessagesFromIds,
  startMessageSelection,
  toggleSelectedMessageId,
} from '../../chat/chatMessageSelection';
import { useAndroidBackHandler } from '../../chat/useAndroidBackHandler';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import {
  clearNativeChatDraft,
  NativeChatDraftLimitError,
  getNativeChatDraftState,
} from '../../chat/chatDrafts';
import { useNativeChatDraftAutosave } from '../../chat/useNativeChatDraftAutosave';
import { createNativeChatOutbox, getNativeChatQueueState } from '../../chat/nativeChatOutbox';
import { useNativeChatOutboxMessages } from '../../chat/useNativeChatOutboxMessages';
import { setChatAttachmentTransfer, syncChatAttachmentTransfers } from '../../chat/nativeChatAttachmentTransfers';
import { useThreadSelection } from './useThreadSelection';
import { useThreadForward } from './useThreadForward';
import { useThreadComposerState } from './useThreadComposerState';
import { useThreadHistory } from './useThreadHistory';
import { useThreadSend } from './useThreadSend';
import { useThreadRealtime } from './useThreadRealtime';
import { useThreadSheets } from './useThreadSheets';
import { useThreadMessageActions } from './useThreadMessageActions';
import { useThreadAttachments } from './useThreadAttachments';
import { useThreadSearch } from './useThreadSearch';
import { useThreadScrollAnchor } from './useThreadScrollAnchor';
import { useThreadBack } from './useThreadBack';
import { useThreadRender } from './useThreadRender';
import { ChatThreadOverlays } from './ChatThreadOverlays';
import { NativeToastHost, showNativeToast } from '../../components/nativeToast';
import { useUnsavedFormGuard } from '../../navigation/useUnsavedFormGuard';
import { getPinnedChatMessageId, setPinnedChatMessageId } from '../../chat/chatPinnedMessages';
import {
  buildPendingAttachmentMessage,
  isAttachmentTransferAbort,
  type PendingAttachmentMediaKind,
} from '../../chat/chatAttachmentTransfers';
import { chatSocket, shouldUseChatHttpFallback, type ChatSocketStatus } from '../../chat/chatSocket';
import { NativeChatComposerDock } from '../../components/chat/NativeChatComposerDock';
import {
  ChatMessageEnterMotion,
  chatMessageMotionKey,
  type ChatMessageEnterKind,
} from '../../components/chat/ChatMessageEnterMotion';
import { ChatConversationInfoSheet } from '../../components/chat/ChatConversationInfoSheet';
import { ChatParticipantProfileSheet } from '../../components/chat/ChatParticipantProfileSheet';
import { ChatEmojiPickerSheet } from '../../components/chat/ChatEmojiPickerSheet';
import { ChatMemberPickerSheet, ChatRenameSheet } from '../../components/chat/ChatGroupEditSheets';
import { ChatHeader } from '../../components/chat/ChatHeader';
import { TypingDots } from '../../components/chat/TypingDots';
import { ChatJumpToBottomButton } from '../../components/chat/ChatJumpToBottomButton';
import { ChatThreadSkeleton } from '../../components/chat/ChatListSkeleton';
import { ChatMediaViewer } from '../../components/chat/ChatMediaViewer';
import { ChatAttachmentActionsSheet } from '../../components/chat/ChatAttachmentActionsSheet';
import { ChatSelectionHeader } from '../../components/chat/ChatSelectionHeader';
import { ChatInteractiveBackGesture } from '../../components/chat/ChatInteractiveBackGesture';
import {
  ChatMentionSuggestions,
  getTrailingMentionQuery,
  replaceTrailingMention,
} from '../../components/chat/ChatMentionSuggestions';
import { ChatMessageSearch } from '../../components/chat/ChatMessageSearch';
import { ChatImageEditorSheet } from '../../components/chat/ChatImageEditorSheet';
import { ChatStickerPickerSheet } from '../../components/chat/ChatStickerPickerSheet';
import { ChatTaskShareSheet } from '../../components/chat/ChatTaskShareSheet';
import { ForwardMessageSheet } from '../../components/chat/ForwardMessageSheet';
import { MessageActionsSheet } from '../../components/chat/MessageActionsSheet';
import { SwipeableChatBubble } from '../../components/chat/SwipeableChatBubble';
import {
  NativeFilePermissionError,
  openAppPermissionSettings,
  pickNativeAttachments,
  type NativeAttachmentSource,
  type NativePickedFile,
} from '../../files/nativeFilePicker';
import {
  downloadChatAttachment,
  openNativeFile,
  shareNativeFile,
} from '../../files/nativeAttachmentDownloads';
import { type ChatTokens, useChatStyles, useChatTokens } from '../../theme/chatTokens';
import {
  readNativeEntitySnapshot,
} from '../../cache/nativeSnapshotCache';
import {
  getNativeChatThreadHistoryGeneration,
  mergeNativeChatThreadHistory,
  scheduleNativeChatThreadSnapshotWrite,
  type NativeChatThreadSnapshot,
} from '../../chat/nativeChatThreadHistory';

function createClientMessageId(): string {
  return `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export type PendingAttachmentUpload = {
  files: NativePickedFile[];
  mediaKind?: PendingAttachmentMediaKind;
  durationSeconds?: number;
  body: string;
  replyToMessageId?: string;
  replyPreview?: ChatMessage['reply_preview'];
};

export type FailedAttachmentAction = {
  messageId: string;
  attachment: ChatAttachment;
  action: 'open' | 'share' | 'save';
};

type ChatThreadSnapshot = NativeChatThreadSnapshot;

const CHAT_LIST_MAINTAIN_VISIBLE_POSITION = { minIndexForVisible: 0 };
const CHAT_LIST_VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 10 };

function chatMessageKey(message: ChatMessage): string {
  return chatMessageMotionKey(message);
}

function ChatEmptyState({ message }: { message: string }) {
  const { styles } = useChatStyles(createStyles);
  return (
    <Text
      testID="native-chat-empty-state"
      style={[styles.empty, styles.invertedListEmpty]}
      accessibilityRole="text"
    >
      {message}
    </Text>
  );
}

export function NativeChatThreadScreen({
  conversationId,
  messageId,
}: {
  conversationId: string;
  messageId?: string;
}) {
  const chatTokens = useChatTokens();
  const styles = useMemo(() => createStyles(chatTokens), [chatTokens]);
  const { user, hasPermission, offlineMode } = useAuth();
  const historySessionGeneration = useMemo(() => getNativeChatThreadHistoryGeneration(), [user?.id]);

  const [conversation, setConversation] = useState<ChatConversationSummary | null>(null);
  const aiAccess = useAiAgentAccess(conversationId, conversation?.id === conversationId && isAiConversation(conversation), user?.id, offlineMode);
  const canCompose = hasPermission('chat.write') && aiAccess.allowed;
  const canWrite = canCompose && !offlineMode;
  const reduceMotion = useReducedMotion();
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  useChatKeyboardMotion();
  // Single keyboard mechanism (RV1-5): the window does not resize under
  // edge-to-edge, so the composer rides the keyboard via KeyboardStickyView
  // and the list is padded on the UI thread by the same animation.
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const listKeyboardStyle = useAnimatedStyle(() => ({
    paddingBottom: -keyboardHeight.value,
  }));
  const mountedRef = useRef(true);
  const sendScope = useMemo(() => Symbol('chat-send-scope'), [conversationId, user?.id, canCompose]);
  const currentSendScopeRef = useRef(sendScope);
  useLayoutEffect(() => { currentSendScopeRef.current = sendScope; }, [sendScope]);
  const isCurrentSendScope = useCallback(() => mountedRef.current && canCompose && currentSendScopeRef.current === sendScope, [canCompose, sendScope]);
  const serverPinKnownRef = useRef(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const nearBottomRef = useRef(!messageId);
  const markedReadRef = useRef('');
  const knownMessageIdsRef = useRef(new Set<string>());
  const messageEnterMotionsRef = useRef(new Map<string, ChatMessageEnterKind>());
  const messageAnimationReadyRef = useRef(false);
  const outboxTitleRef = useRef('Диалог');
  const outbox = useMemo(() => createNativeChatOutbox(Number(user?.id || 0), conversationId, () => outboxTitleRef.current), [user?.id, conversationId]);
  const pendingBottomAnchorRef = useRef(false);
  const pendingAnchorAnimatedRef = useRef(false);
  const pendingAnchorGenerationRef = useRef(0);
  const pendingAnchorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pendingAttachmentUploadsRef = useRef(new Map<string, PendingAttachmentUpload>());
  const uploadControllersRef = useRef(new Map<string, AbortController>());
  const downloadControllersRef = useRef(new Map<string, AbortController>());
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const markReadRef = useRef<(latest?: ChatMessage | null) => void>(() => undefined);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [title, setTitle] = useState('Chat');
  outboxTitleRef.current = title === 'Chat' ? 'Диалог' : title;
  const composerState = useThreadComposerState({
    conversationId,
    userId: user?.id,
    canWrite,
    offlineMode,
    sendScope,
    messages,
  });
  const {
    draftHydrated,
    draftError,
    setDraftError,
    text,
    setText,
    setTextState,
    textRevisionRef,
    draftBeforeEditRef,
    composerMode,
    setComposerMode,
    pendingComposerSendRef,
    attachmentDraftSendRef,
    composerBusy,
    composerBusyRef,
    setComposerBusy,
    attachmentPickerVisible,
    setAttachmentPickerVisible,
    attachmentDraftFiles,
    setAttachmentDraftFiles,
    attachmentDraftError,
    setAttachmentDraftError,
    imageEditorFile,
    setImageEditorFile,
    voiceRecording,
    cancelVoiceRef,
    typingIdleRef,
    typingActiveRef,
    stopOutgoingTyping,
    handleComposerText,
    mentionQuery,
    startReply,
    startEdit,
    cancelComposerMode,
    handleVoiceRecordingChange,
  } = composerState;
  const [actionMessage, setActionMessage] = useState<ChatMessage | null>(null);
  const [actionAnchor, setActionAnchor] = useState<ChatMenuAnchor | null>(null);
  const [aiBots, setAiBots] = useState<ChatAiBot[]>([]);
  const [attachmentTransfers, setAttachmentTransfers] = useState<Record<string, ChatAttachmentTransfer>>({});
  const attachmentTransfersRef = useRef<Record<string, ChatAttachmentTransfer>>({});
  attachmentTransfersRef.current = attachmentTransfers;
  // Coarse status transitions mirror into the per-attachment external store;
  // progress ticks bypass this state entirely and only rerender their row.
  useEffect(() => { syncChatAttachmentTransfers(attachmentTransfers); }, [attachmentTransfers]);
  const [unreadBoundaryId, setUnreadBoundaryId] = useState<string | null>(null);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [focusAnchorId, setFocusAnchorId] = useState<string | null>(messageId || null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [pinnedMessageId, setPinnedMessageId] = useState<string | null>(null);
  const selection = useThreadSelection({
    conversationId,
    conversationKind: conversation?.kind,
    userId: user?.id,
    mountedRef,
    messages,
    setActionMessage,
    setMessages,
  });
  const {
    selectedMessageIds,
    selectedMessages,
    clearSelection,
    startSelection,
    toggleSelection,
    copySelected,
    deleteSelected,
    setSelectedMessageIds,
  } = selection;
  const [holdVisiblePosition, setHoldVisiblePosition] = useState(false);

  const draftAutosave = useNativeChatDraftAutosave(
    Number(user?.id || 0), conversationId, text,
    draftHydrated,
    (error) => setDraftError(error === null ? '' : error instanceof NativeChatDraftLimitError
      ? error.message
      : 'Черновик не сохранён. Не закрывайте диалог до отправки или повторного сохранения.'),
    {
      mode: composerMode ? { type: composerMode.type, message: {
        id: composerMode.message.id, conversation_id: conversationId,
        sender_user_id: composerMode.message.sender_user_id, sender: composerMode.message.sender,
        body_text: composerMode.message.body_text, kind: composerMode.message.kind, is_deleted: composerMode.message.is_deleted,
      } } : undefined,
      beforeEditText: composerMode?.type === 'edit' ? draftBeforeEditRef.current : undefined,
      files: attachmentDraftFiles.length ? attachmentDraftFiles : undefined,
    },
  );
  const { requestLeave } = useUnsavedFormGuard(
    Boolean(text.length || composerMode || attachmentDraftFiles.length) && !draftAutosave.saved,
  );
  const leaveInFlightRef = useRef(false);
  useNativeChatOutboxMessages(outbox, Number(user?.id || 0), conversationId,
    setMessages, pendingAttachmentUploadsRef, setAttachmentTransfers, canWrite);

  const anchorToBottom = useCallback((animated = false, complete = false) => {
    listRef.current?.scrollToOffset({ offset: 0, animated });
    if (complete) pendingBottomAnchorRef.current = false;
  }, []);

  const requestBottomAnchor = useCallback((reason: ChatListAnchorReason = 'incoming') => {
    if (!shouldRequestBottomAnchor(reason, nearBottomRef.current)) return;
    pendingBottomAnchorRef.current = true;
    nearBottomRef.current = true;
    setShowJumpToBottom(false);
    setNewMessageCount(0);
    const animated = shouldAnimateBottomAnchor(reason, reduceMotionRef.current);
    pendingAnchorAnimatedRef.current = animated;
    const generation = ++pendingAnchorGenerationRef.current;
    if (pendingAnchorTimerRef.current) clearTimeout(pendingAnchorTimerRef.current);
    requestAnimationFrame(() => {
      if (pendingAnchorGenerationRef.current === generation) anchorToBottom(animated);
    });
    pendingAnchorTimerRef.current = setTimeout(() => {
      if (pendingAnchorGenerationRef.current !== generation) return;
      anchorToBottom(false, true);
      pendingAnchorTimerRef.current = null;
    }, 320);
  }, [anchorToBottom]);

  const forward = useThreadForward({
    conversationId,
    sendScope,
    isCurrentSendScope,
    userId: user?.id,
    requestBottomAnchor,
    setMessages,
    setSelectedMessageIds,
  });
  const {
    forwardSource,
    forwardQueue,
    forwardConversations,
    forwarding,
    forwardProgress,
    forwardError,
    forwardInFlightRef,
    openForward,
    forwardToConversation,
    setForwardSource,
    setForwardQueue,
    setForwardProgress,
    setForwardError,
  } = forward;

  useEffect(() => {
    let active = true;
    const userId = Number(user?.id || 0);
    if (!userId) return () => { active = false; };
    serverPinKnownRef.current = false;
    void getPinnedChatMessageId(userId, conversationId).then((value) => {
      if (active && !serverPinKnownRef.current) setPinnedMessageId(value);
    });
    return () => { active = false; };
  }, [conversationId, user?.id]);

  useEffect(() => {
    if (offlineMode) return;
    const ids = new Set<number>();
    const peerId = Number(conversation?.direct_peer?.id || conversation?.peer_user_id || 0);
    if (peerId > 0) ids.add(peerId);
    // Group members need explicit watches: the backend fans presence out only
    // to connections that registered the user via chat.watch_presence.
    (conversation?.members || []).forEach((member) => {
      const memberId = Number(member?.user?.id || 0);
      if (memberId > 0) ids.add(memberId);
    });
    if (ids.size) chatSocket.watchPresence([...ids]);
  }, [conversation?.direct_peer?.id, conversation?.peer_user_id, conversation?.members, offlineMode]);



  const markRead = useCallback((latest?: ChatMessage | null) => {
    if (offlineMode || !latest?.id || resolveChatMessageIsOwn(latest, user?.id) === true || markedReadRef.current === latest.id) {
      return;
    }
    markedReadRef.current = latest.id;
    void chatApi.markConversationRead(conversationId, latest.id).then(() => {
      notifyNativeChatConversationRead(conversationId);
    }).catch(() => {
      if (mountedRef.current && markedReadRef.current === latest.id) markedReadRef.current = '';
    });
  }, [conversationId, offlineMode, user?.id]);
  markReadRef.current = markRead;
  messagesRef.current = messages;

  useEffect(() => {
    setActiveNativeChatConversationId(conversationId);
    return () => {
      if (getActiveNativeChatConversationId() === conversationId) {
        setActiveNativeChatConversationId(null);
      }
    };
  }, [conversationId]);

  const {
    loading,
    threadHydrated,
    historyUnavailableOffline,
    loadingOlder,
    hasNewer,
    newerCursor,
    hasOlder,
    olderCursor,
    loadGenerationRef,
    historyNavigationRef,
    accumulatedMessagesRef,
    historyMayHaveGapsRef,
    loadingOlderRef,
    loadingNewerRef,
    reconnectSyncRef,
    loadedThreadScopeRef,
    setLoadingOlder,
    setThreadHydrated,
    setHasNewer,
    setNewerCursor,
    setHasOlder,
    setOlderCursor,
    loadInitial,
    loadOlder,
    loadNewer,
    syncLatestMessages,
    flushHistoryWrite,
    error,
    setError,
  } = useThreadHistory({
    conversationId,
    userId: user?.id,
    messageId,
    offlineMode,
    historySessionGeneration,
    mountedRef,
    nearBottomRef,
    knownMessageIdsRef,
    messageAnimationReadyRef,
    messageEnterMotionsRef,
    serverPinKnownRef,
    leaveInFlightRef,
    pendingAttachmentUploadsRef,
    messagesRef,
    outbox,
    markRead,
    requestBottomAnchor,
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


  const { status, typingParticipants } = useThreadRealtime({
    conversationId,
    userId: user?.id,
    offlineMode,
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


  const sheets = useThreadSheets({
    conversationId,
    userId: user?.id,
    offlineMode,
    mountedRef,
    loadGenerationRef,
    isCurrentSendScope,
    conversation,
    mentionQuery,
    requestBottomAnchor,
    setMessages,
    setConversation,
    setTitle,
    composer: composerState,
  });
  const {
    infoVisible,
    setInfoVisible,
    profileMember,
    setProfileMember,
    conversationBusy,
    renameVisible,
    setRenameVisible,
    memberPickerVisible,
    setMemberPickerVisible,
    chatUsers,
    taskPickerVisible,
    setTaskPickerVisible,
    shareableTasks,
    taskPickerLoading,
    stickerPickerVisible,
    setStickerPickerVisible,
    stickerPacks,
    stickerPickerLoading,
    stickerImporting,
    recentStickerIds,
    emojiPickerVisible,
    setEmojiPickerVisible,
    setPollCreateVisible,
    openConversationInfo,
    updateConversationSetting,
    renameGroup,
    resetAiContext,
    deleteAiConversation,
    openMemberPicker,
    addMembers,
    updateMember,
    openPersonProfile,
    openMemberActions,
    requestLeaveGroup,
    openTask,
    loadShareableTasks,
    openTaskPicker,
    shareTask,
    openStickerPicker,
    importStickerPack,
    removeStickerPack,
    sendSticker,
  } = sheets;

  const send = useThreadSend({
    conversationId,
    user,
    canWrite,
    offlineMode,
    isCurrentSendScope,
    mountedRef,
    outbox,
    requestBottomAnchor,
    setMessages,
    messageEnterMotionsRef,
    knownMessageIdsRef,
    pendingAttachmentUploadsRef,
    uploadControllersRef,
    setAttachmentTransfers,
    setEmojiPickerVisible,
    composer: composerState,
  });
  const {
    sendMessage,
    sendPickedFiles,
    sendPickedFile,
    toggleReaction,
    requestDelete,
    discardPendingMessage,
    cancelPendingAttachmentUpload,
    retryPendingAttachmentUpload,
    retryPendingMessage,
    pickAndSendAttachment,
    sendAttachmentDraft,
    sendGif,
    attachmentDraftClientMessageIdRef,
  } = send;


  const searchState = useThreadSearch({
    conversationId,
    userId: user?.id,
    offlineMode,
    mountedRef,
    accumulatedMessagesRef,
    messages,
  });
  const {
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    searchResults,
    searching,
    searchCompleted,
    runSearch,
    setSearchResults,
    setSearchCompleted,
  } = searchState;
  const {
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
  } = useThreadScrollAnchor({
    conversationId,
    userId: user?.id,
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
    search: searchState,
  });



  const messageActions = useThreadMessageActions({
    conversationId,
    userId: user?.id,
    mountedRef,
    pinnedMessageId,
    setPinnedMessageId,
    serverPinKnownRef,
    setMessages,
    loadInitial,
  });
  const {
    copyMessageText,
    copyMessageLink,
    prepareReport,
    showMessageReads,
    togglePinnedMessage,
    unpinMessage,
    runAiAction,
  } = messageActions;


  const attachments = useThreadAttachments({
    conversationId,
    offlineMode,
    mountedRef,
    accumulatedMessagesRef,
    messagesRef,
    attachmentTransfersRef,
    downloadControllersRef,
    setAttachmentTransfers,
    selectedMessageIdsLength: selectedMessageIds.length,
    setSelectedMessageIds,
    cancelPendingAttachmentUpload,
    retryPendingAttachmentUpload,
  });
  const {
    mediaViewer,
    setMediaViewer,
    mediaViewerItems,
    attachmentActionTarget,
    setAttachmentActionTarget,
    runAttachmentAction,
    cancelAttachmentTransfer,
    retryAttachmentTransfer,
    loadMoreMediaManifest,
    openMediaViewer,
    closeMediaViewer,
    openAttachmentActions,
    openAttachment,
  } = attachments;
  const {
    leaveThread,
    closeThreadLayer,
    handleThreadBack,
  } = useThreadBack({
    conversationId,
    userId: user?.id,
    offlineMode,
    mountedRef,
    leaveInFlightRef,
    requestLeave,
    messagesRef,
    actionMessage,
    setActionMessage,
    voiceRecording,
    attachmentDraftClientMessageIdRef,
    sheets,
    composer: composerState,
    forward,
    selection,
    search: searchState,
    attachments,
  });

  // F-REACTORS: long-press a reaction chip → "who reacted" (names from the
  // member/user directory already loaded for mentions and the header).
  const reactorNameById = useMemo(() => {
    const map = new Map<number, string>();
    (chatUsers || []).forEach((entry) => {
      map.set(Number(entry.id), String(entry.full_name || entry.username || `Участник ${entry.id}`));
    });
    (conversation?.members || []).forEach((member) => {
      map.set(Number(member.user.id), String(member.user.full_name || member.user.username || `Участник ${member.user.id}`));
    });
    if (user?.id) map.set(Number(user.id), 'Вы');
    return map;
  }, [chatUsers, conversation?.members, user?.id]);
  // F-MENTION-JUMP: "@" button → first (oldest) unread mention of me.
  const unreadMentionMessageId = useMemo(
    () => findUnreadMentionMessageId(
      messages,
      Number(user?.id || 0),
      Number(conversation?.viewer_last_read_seq || 0),
    ),
    [conversation?.viewer_last_read_seq, messages, user?.id],
  );

  const showReactionUsers = useCallback((message: ChatMessage, emoji: string, userIds: number[]) => {
    const names = (userIds || [])
      .map((id) => reactorNameById.get(Number(id)) || `Участник ${id}`);
    Alert.alert(
      `Реакция ${emoji}`,
      names.length ? names.join('\n') : 'Нет данных об авторах реакции',
    );
  }, [reactorNameById]);

  const { renderMessage, renderLiftedBubble } = useThreadRender({
    conversation,
    userId: user?.id,
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
    votePoll: send.votePoll,
    closePoll: send.closePoll,
    runAiAction,
    cancelAttachmentTransfer,
    retryAttachmentTransfer,
    startReply,
    startSelection,
    toggleReaction,
    toggleSelection,
    showReactionUsers,
    styles,
  });
  const listEmptyMessage = historyUnavailableOffline
    ? 'Переписка не сохранена на устройстве'
    : 'Сообщений пока нет';
  const listEmptyComponent = useCallback(
    () => <ChatEmptyState message={listEmptyMessage} />,
    [listEmptyMessage],
  );


  const olderMessagesLoader = useMemo(() => loadingOlder ? (
    <ActivityIndicator style={styles.olderLoader} color={chatTokens.composerActionBg} />
  ) : null, [chatTokens, loadingOlder, styles]);
  const pinnedMessage = useMemo(
    () => messages.find((message) => message.id === pinnedMessageId) || null,
    [messages, pinnedMessageId],
  );
  const threadMedia = useMemo(() => collectThreadMedia(messages), [messages]);
  const viewerMediaItems = mediaViewerItems ?? threadMedia;
  const typingLine = formatTypingLine(typingParticipants);
  const headerSubtitle = typingLine
    || (conversation?.kind === 'group'
      ? `${conversation.member_count || conversation.members?.length || 0} участников · ${conversation.online_member_count || 0} онлайн`
      : formatPresenceSubtitle(conversation?.direct_peer?.presence))
    || undefined;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ChatInteractiveBackGesture
        enabled={!selectedMessageIds.length && !mediaViewer && !voiceRecording}
        onBack={handleThreadBack}
      >
      <View
        testID="native-chat-thread-keyboard"
        style={styles.container}
      >
        {selectedMessageIds.length ? (
          <ChatSelectionHeader
            count={selectedMessageIds.length}
            canReply={canReplyToSelectedMessages(selectedMessages)}
            canDelete={canDeleteSelectedMessages(selectedMessages, {
              conversationKind: conversation?.kind,
              currentUserId: user?.id,
            })}
            onClose={clearSelection}
            onReply={() => {
              const [message] = selectedMessages;
              if (message) startReply(message);
              clearSelection();
            }}
            onForward={() => void openForward(selectedMessages)}
            onCopy={copySelected}
            onDelete={deleteSelected}
          />
        ) : (
          <ChatHeader
            title={title}
            subtitle={headerSubtitle}
            subtitleExtra={typingLine ? <TypingDots /> : undefined}
            avatarUrl={conversation?.avatar_url}
            muted={conversation?.is_muted}
            socketStatus={status}
            onBack={handleThreadBack}
            onSearch={() => {
              setSearchOpen((current) => !current);
              setSearchResults([]);
              setSearchCompleted(false);
            }}
            onOpenInfo={openConversationInfo}
          />
        )}
        {searchOpen ? (
          <ChatMessageSearch
            query={searchQuery}
            onChangeQuery={(value) => {
              setSearchQuery(value);
              setSearchResults([]);
              setSearchCompleted(false);
            }}
            onSubmit={() => void runSearch()}
            onClose={() => {
              setSearchOpen(false);
              setSearchResults([]);
              setSearchCompleted(false);
            }}
            results={searchResults}
            loading={searching}
            searched={searchCompleted}
            onSelect={(message) => void focusSearchResult(message)}
          />
        ) : null}
        {pinnedMessageId ? (
          <View style={styles.pinnedBar}>
            <Pressable
              style={styles.pinnedBody}
              onPress={() => void focusMessageById(pinnedMessageId)}
              accessibilityRole="button"
              accessibilityLabel="Перейти к закреплённому сообщению"
            >
              <Text style={styles.pinnedLabel}>Закреплённое сообщение</Text>
              <Text style={styles.pinnedText} numberOfLines={1}>
                {pinnedMessage?.body_text || pinnedMessage?.task_preview?.title || 'Перейти к сообщению'}
              </Text>
            </Pressable>
            <Pressable
              onPress={unpinMessage}
              style={styles.pinnedClose}
              accessibilityRole="button"
              accessibilityLabel="Открепить сообщение"
            >
              <Text style={styles.pinnedCloseText}>×</Text>
            </Pressable>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.center} accessibilityLiveRegion="polite">
            <ChatThreadSkeleton />
          </View>
        ) : error && messages.length === 0 ? (
          <View style={styles.center} accessibilityLiveRegion="assertive">
            <Text style={styles.errorTitle}>Не удалось открыть диалог</Text>
            <Text style={styles.stateText}>{error}</Text>
            <Pressable
              onPress={() => void loadInitial()}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.retryText}>Повторить</Text>
            </Pressable>
          </View>
        ) : (
          <Animated.View style={[styles.listWrap, listKeyboardStyle]}>
          <Image
            source={require('../../../assets/chat-pattern.png')}
            style={styles.pattern}
            resizeMode="repeat"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
          <FlatList
            ref={listRef}
            testID="native-chat-message-list"
            data={messages}
            keyExtractor={chatMessageKey}
            inverted
            contentContainerStyle={styles.list}
            renderItem={renderMessage}
            extraData={`${selectedMessageIds.join('\0')}|${unreadBoundaryId}|${canWrite}|${offlineMode}|${highlightedMessageId || ''}`}
            onEndReached={handleMessageListEndReached}
            onEndReachedThreshold={0.35}
            onScroll={handleMessageListScroll}
            onViewableItemsChanged={handleViewableItemsChanged.current}
            viewabilityConfig={CHAT_LIST_VIEWABILITY_CONFIG}
            onLayout={handleMessageListLayoutChange}
            onContentSizeChange={handleMessageContentSizeChange}
            scrollEventThrottle={32}
            maintainVisibleContentPosition={
              shouldUseMaintainVisibleContentPosition(holdVisiblePosition, !showJumpToBottom)
                ? CHAT_LIST_MAINTAIN_VISIBLE_POSITION
                : undefined
            }
            onScrollToIndexFailed={handleMessageScrollFailure}
            initialNumToRender={16}
            maxToRenderPerBatch={8}
            windowSize={7}
            updateCellsBatchingPeriod={50}
            // Android can detach the contents of variable-height inverted rows after
            // scrollToIndex/highlight updates, leaving an empty message bubble.
            removeClippedSubviews={false}
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={listEmptyComponent}
            ListFooterComponent={olderMessagesLoader}
          />
          </Animated.View>
        )}

        {!loading ? (
          <ChatJumpToBottomButton
            visible={showJumpToBottom}
            count={newMessageCount}
            onPress={() => void jumpToBottom()}
          />
        ) : null}

        {/* F-MENTION-JUMP: "@" chip → first unread mention. */}
        {unreadMentionMessageId ? (
          <Pressable
            style={styles.mentionJumpButton}
            onPress={() => void focusMessageById(unreadMentionMessageId)}
            accessibilityRole="button"
            accessibilityLabel="Перейти к упоминанию"
          >
            <Text style={styles.mentionJumpText}>@</Text>
          </Pressable>
        ) : null}

        {/* F-JUMPBACK: "back to where I was" chip after a reply/search jump. */}
        {returnAnchorId ? (
          <Pressable
            style={styles.returnAnchorChip}
            onPress={() => void returnToAnchor()}
            accessibilityRole="button"
            accessibilityLabel="Вернуться к исходному сообщению"
          >
            <MaterialCommunityIcons
              name="arrow-u-left-top"
              size={16}
              color={chatTokens.accentText}
            />
            <Text style={styles.returnAnchorText}>Назад к сообщению</Text>
          </Pressable>
        ) : null}

        <KeyboardStickyView>
        {canCompose ? (
          <>
          {offlineMode ? (
            <Text
              accessibilityLiveRegion="polite"
              style={styles.draftError}
              testID="native-chat-offline-composer-hint"
            >
              Нет сети: черновик и очередь доставки доступны локально
            </Text>
          ) : null}
          {draftError ? <View>
            <Text accessibilityRole="alert" style={styles.draftError}>{draftError}</Text>
            {draftHydrated ? <Pressable
              accessibilityRole="button"
              accessibilityLabel="Повторить сохранение черновика"
              onPress={() => { void draftAutosave.saveNow(); }}
              style={styles.draftRetry}
            ><Text style={styles.draftError}>Повторить сохранение</Text></Pressable> : null}
          </View> : null}
          {mentionQuery !== null && composerMode?.type !== 'edit' ? (
            <ChatMentionSuggestions
              users={chatUsers}
              query={mentionQuery}
              onSelect={(selectedUser) => setText((current) => replaceTrailingMention(current, selectedUser.username))}
            />
          ) : null}
          <NativeChatComposerDock
            onLayout={() => requestBottomAnchor('composer-layout')}
            value={text}
            onChangeText={handleComposerText}
            onSend={sendMessage}
            mode={composerMode?.type}
            onOpenContext={composerMode ? () => { void focusMessageById(composerMode.message.id); } : undefined}
            contextLabel={composerMode?.type === 'reply'
              ? `Ответ: ${composerMode.message.sender?.full_name || composerMode.message.sender?.username || 'сообщение'}`
              : undefined}
            contextPreview={composerMode?.message.body_text || undefined}
            onCancelMode={cancelComposerMode}
            busy={composerBusy}
            onAttachmentPress={composerMode?.type === 'edit'
              ? undefined
              : () => {
                // Picker panels are mutually exclusive (Telegram swaps them).
                setEmojiPickerVisible(false);
                setStickerPickerVisible(false);
                setPollCreateVisible(false);
                setTaskPickerVisible(false);
                setAttachmentPickerVisible(true);
              }}
            onEmojiPress={composerMode?.type === 'edit' ? undefined : () => {
              Keyboard.dismiss();
              setAttachmentPickerVisible(false);
              setStickerPickerVisible(false);
              setPollCreateVisible(false);
              setTaskPickerVisible(false);
              setEmojiPickerVisible(true);
            }}
            onInputFocus={() => {
              // The input takes the keyboard slot — open pickers close (Telegram swap).
              setAttachmentPickerVisible(false);
              setEmojiPickerVisible(false);
              setStickerPickerVisible(false);
              setPollCreateVisible(false);
              setTaskPickerVisible(false);
            }}
            canRecord={canCompose && composerMode?.type !== 'edit'}
            onSendVoiceFile={sendPickedFile}
            onRecordingChange={handleVoiceRecordingChange}
            cancelVoiceRef={cancelVoiceRef}
          />
          </>
        ) : (
          <View style={styles.readOnly} accessibilityLiveRegion="polite">
            <Text style={styles.readOnlyText}>{!aiAccess.allowed
              ? offlineMode ? 'Нет сети: для отправки ИИ-агенту подключитесь к сети.'
                : aiAccess.loading ? 'Проверяем доступ к ИИ-агенту…'
                  : aiAccess.error ? 'Не удалось проверить доступ к ИИ-агенту. Повторим автоматически.'
                    : 'Доступ к ИИ-агенту не предоставлен или отозван. История доступна, черновик не удалён.'
              : 'У вас нет права отправлять сообщения'}</Text>
          </View>
        )}
        </KeyboardStickyView>
        <ChatThreadOverlays
          conversationId={conversationId}
          conversation={conversation}
          title={title}
          userId={user?.id}
          aiBots={aiBots}
          actionMessage={actionMessage}
          actionAnchor={actionAnchor}
          setActionMessage={setActionMessage}
          setActionAnchor={setActionAnchor}
          pinnedMessageId={pinnedMessageId}
          viewerMediaItems={viewerMediaItems}
          renderBubble={renderLiftedBubble}
          isCurrentSendScope={isCurrentSendScope}
          sheets={sheets}
          composer={composerState}
          forward={forward}
          attachments={attachments}
          messageActions={messageActions}
          send={send}
          selection={selection}
        />
      </View>
      </ChatInteractiveBackGesture>
      <NativeToastHost />
    </SafeAreaView>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: chatTokens.threadBg },
  container: { flex: 1, backgroundColor: chatTokens.threadBg, overflow: 'visible' },
  listWrap: { flex: 1 },
  pattern: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    opacity: chatTokens.scheme === 'dark' ? 0.10 : 0.05,
  },
  list: { flexGrow: 1, justifyContent: 'flex-start', paddingHorizontal: 12, paddingVertical: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  errorTitle: { color: chatTokens.textPrimary, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  draftError: { color: chatTokens.textPrimary, fontSize: 13, lineHeight: 18, paddingHorizontal: 14, paddingVertical: 8 },
  returnAnchorChip: {
    position: 'absolute',
    right: 16,
    bottom: 136,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: chatTokens.panelBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: chatTokens.borderSoft,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  returnAnchorText: { color: chatTokens.accentText, fontSize: 13, fontWeight: '600' },
  mentionJumpButton: {
    position: 'absolute',
    right: 76,
    bottom: 76,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: chatTokens.panelBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: chatTokens.borderSoft,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  mentionJumpText: { color: chatTokens.accentText, fontSize: 20, fontWeight: '700' },
  draftRetry: { minHeight: 44, justifyContent: 'center' },
  stateText: { color: chatTokens.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  retryButton: {
    minWidth: 120,
    minHeight: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    backgroundColor: chatTokens.composerActionBg,
  },
  retryText: { color: chatTokens.composerActionText, fontSize: 15, fontWeight: '700' },
  pressed: { transform: [{ scale: 0.96 }], opacity: 0.9 },
  empty: { color: chatTokens.textSecondary, textAlign: 'center', marginVertical: 48 },
  invertedListEmpty: { transform: [{ scaleY: -1 }] },
  olderLoader: { marginVertical: 16 },
  dateSeparator: { alignItems: 'center', marginVertical: 10 },
  dateSeparatorText: {
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    color: chatTokens.textSecondary,
    backgroundColor: chatTokens.datePillBg,
    fontSize: 12,
    fontWeight: '700',
  },
  unreadSeparator: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 8 },
  unreadLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: chatTokens.composerActionBg },
  unreadText: { color: chatTokens.accentText, fontSize: 12, fontWeight: '700' },
  pinnedBar: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
    backgroundColor: chatTokens.threadTopbarBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chatTokens.borderSoft,
  },
  pinnedBody: {
    flex: 1,
    minWidth: 0,
    paddingLeft: 10,
    borderLeftWidth: 3,
    borderLeftColor: chatTokens.composerActionBg,
  },
  pinnedLabel: { color: chatTokens.accentText, fontSize: 12, fontWeight: '700' },
  pinnedText: { marginTop: 2, color: chatTokens.textPrimary, fontSize: 13 },
  pinnedClose: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  pinnedCloseText: { color: chatTokens.textSecondary, fontSize: 25 },
  readOnly: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    backgroundColor: chatTokens.composerDockBg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: chatTokens.borderSoft,
  },
  readOnlyText: { color: chatTokens.textSecondary, fontSize: 14 },
});
