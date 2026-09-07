import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
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
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as chatApi from '../../api/chatApi';
import { HUB_WEB_ORIGIN } from '../../api/config';
import { formatApiError } from '../../api/formatError';
import { recordDiagnosticEvent } from '../../diagnostics/diagnostics';
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
import { chatKeyboardAvoidingProps } from '../../chat/chatKeyboard';
import { useChatKeyboardMotion } from '../../chat/useChatKeyboardMotion';
import {
  getActiveNativeChatConversationId,
  notifyNativeChatConversationRead,
  setActiveNativeChatConversationId,
  subscribeNativeChatConversationRead,
} from '../../chat/chatActiveConversation';
import { nextChatThreadBackAction } from '../../chat/chatGestures';
import { detectChatBodyFormat } from '../../chat/chatMarkdown';
import { shouldShowSenderAvatarsForKind } from '../../chat/chatBubbleLayout';
import { downloadGifToCache, type ChatGifItem } from '../../chat/chatGiphy';
import { getRecentStickerIds, rememberRecentSticker } from '../../chat/chatStickers';
import { AttachmentPickerSheet } from '../../components/chat/AttachmentPickerSheet';
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
import { createNativeChatOutbox } from '../../chat/nativeChatOutbox';
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
import { ChatMediaViewer } from '../../components/chat/ChatMediaViewer';
import { ChatAttachmentActionsSheet } from '../../components/chat/ChatAttachmentActionsSheet';
import { ChatSelectionHeader } from '../../components/chat/ChatSelectionHeader';
import { EdgeBackSwipeOverlay } from '../../components/chat/EdgeBackSwipeOverlay';
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
  buildAttachmentsFormData,
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
import { createNativeChatLeaveController } from '../../chat/nativeChatLeaveThread';

function createClientMessageId(): string {
  return `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

type PendingAttachmentUpload = {
  files: NativePickedFile[];
  mediaKind?: PendingAttachmentMediaKind;
  durationSeconds?: number;
  body: string;
  replyToMessageId?: string;
  replyPreview?: ChatMessage['reply_preview'];
};

type FailedAttachmentAction = {
  messageId: string;
  attachment: ChatAttachment;
  action: 'open' | 'share' | 'save';
};

type ChatThreadSnapshot = NativeChatThreadSnapshot;

const CHAT_LIST_MAINTAIN_VISIBLE_POSITION = { minIndexForVisible: 0 };

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
  const canCompose = hasPermission('chat.write');
  const canWrite = canCompose;
  const reduceMotion = useReducedMotion();
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  useChatKeyboardMotion();
  const [voiceRecording, setVoiceRecording] = useState(false);
  const cancelVoiceRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  const sendScope = useMemo(() => Symbol('chat-send-scope'), [conversationId, user?.id, canCompose, offlineMode]);
  const currentSendScopeRef = useRef(sendScope);
  useLayoutEffect(() => { currentSendScopeRef.current = sendScope; }, [sendScope]);
  const isCurrentSendScope = useCallback(() => mountedRef.current && canCompose && currentSendScopeRef.current === sendScope, [canCompose, sendScope]);
  const serverPinKnownRef = useRef(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const loadingOlderRef = useRef(false);
  const loadingNewerRef = useRef(false);
  const nearBottomRef = useRef(!messageId);
  const markedReadRef = useRef('');
  const knownMessageIdsRef = useRef(new Set<string>());
  const messageEnterMotionsRef = useRef(new Map<string, ChatMessageEnterKind>());
  const messageAnimationReadyRef = useRef(false);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [draftError, setDraftError] = useState('');
  const outboxTitleRef = useRef('Диалог');
  const outbox = useMemo(() => createNativeChatOutbox(Number(user?.id || 0), conversationId, () => outboxTitleRef.current), [user?.id, conversationId]);
  const textRevisionRef = useRef(0);
  const draftBeforeEditRef = useRef('');
  const pendingBottomAnchorRef = useRef(false);
  const pendingAnchorAnimatedRef = useRef(false);
  const pendingAnchorGenerationRef = useRef(0);
  const pendingAnchorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectedOnceRef = useRef(chatSocket.getStatus() === 'connected');
  const reconnectSyncRef = useRef(false);
  const mediaManifestGenerationRef = useRef(0);
  const mediaManifestLoadingRef = useRef(false);
  const mediaManifestHasMoreRef = useRef(false);
  const mediaManifestCursorRef = useRef<string | null>(null);
  const mediaManifestKindRef = useRef<'image' | 'video'>('image');
  const attachmentDraftClientMessageIdRef = useRef('');
  const pendingAttachmentUploadsRef = useRef(new Map<string, PendingAttachmentUpload>());
  const uploadControllersRef = useRef(new Map<string, AbortController>());
  const downloadControllersRef = useRef(new Map<string, AbortController>());
  const failedAttachmentActionsRef = useRef(new Map<string, FailedAttachmentAction>());
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const markReadRef = useRef<(latest?: ChatMessage | null) => void>(() => undefined);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversation, setConversation] = useState<ChatConversationSummary | null>(null);
  const [title, setTitle] = useState('Chat');
  outboxTitleRef.current = title === 'Chat' ? 'Диалог' : title;
  const [text, setTextState] = useState('');
  const setText = useCallback((value: string | ((previous: string) => string)) => {
    textRevisionRef.current += 1;
    setTextState(value);
  }, []);
  const [actionMessage, setActionMessage] = useState<ChatMessage | null>(null);
  const [actionAnchor, setActionAnchor] = useState<ChatMenuAnchor | null>(null);
  const [aiBots, setAiBots] = useState<ChatAiBot[]>([]);
  const [composerMode, setComposerModeState] = useState<{
    type: 'reply' | 'edit';
    message: ChatMessage;
  } | null>(null);
  const setComposerMode = useCallback((value: typeof composerMode) => {
    textRevisionRef.current += 1;
    setComposerModeState(value);
  }, []);
  useEffect(() => {
    if (!composerMode || composerMode.message.is_deleted) return;
    const source = messages.find((message) => message.id === composerMode.message.id);
    if (!source?.is_deleted) return;
    setComposerMode({ ...composerMode, message: { ...composerMode.message, is_deleted: true, body_text: 'Сообщение удалено' } });
  }, [composerMode, messages, setComposerMode]);
  const pendingComposerSendRef = useRef<symbol | null>(null);
  const attachmentDraftSendRef = useRef(false);
  const [composerBusy, updateComposerBusy] = useState(false);
  const composerBusyRef = useRef(false);
  const setComposerBusy = useCallback((value: boolean) => {
    composerBusyRef.current = value;
    updateComposerBusy(value);
  }, []);
  const [attachmentPickerVisible, setAttachmentPickerVisible] = useState(false);
  const [attachmentDraftFiles, setAttachmentDraftFilesState] = useState<NativePickedFile[]>([]);
  const setAttachmentDraftFiles = useCallback((files: NativePickedFile[] | ((current: NativePickedFile[]) => NativePickedFile[])) => {
    textRevisionRef.current += 1;
    setAttachmentDraftFilesState(files);
  }, []);
  const [attachmentDraftError, setAttachmentDraftError] = useState('');
  const [imageEditorFile, setImageEditorFile] = useState<NativePickedFile | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChatMessage[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchCompleted, setSearchCompleted] = useState(false);
  const [forwardSource, setForwardSource] = useState<ChatMessage | null>(null);
  const [forwardQueue, setForwardQueue] = useState<ChatMessage[]>([]);
  const [forwardConversations, setForwardConversations] = useState<ChatConversationSummary[]>([]);
  const [forwarding, setForwarding] = useState(false);
  const forwardInFlightRef = useRef(false);
  const [forwardProgress, setForwardProgress] = useState<{ target: ChatConversationSummary; completed: number; total: number } | null>(null);
  const [forwardError, setForwardError] = useState('');
  const [attachmentTransfers, setAttachmentTransfers] = useState<Record<string, ChatAttachmentTransfer>>({});
  const attachmentTransfersRef = useRef<Record<string, ChatAttachmentTransfer>>({});
  attachmentTransfersRef.current = attachmentTransfers;
  const [unreadBoundaryId, setUnreadBoundaryId] = useState<string | null>(null);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [threadHydrated, setThreadHydrated] = useState(false);
  const [historyUnavailableOffline, setHistoryUnavailableOffline] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasNewer, setHasNewer] = useState(false);
  const [newerCursor, setNewerCursor] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [focusAnchorId, setFocusAnchorId] = useState<string | null>(messageId || null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<ChatSocketStatus>(chatSocket.getStatus());
  const [infoVisible, setInfoVisible] = useState(false);
  const [profileMember, setProfileMember] = useState<ChatMember | null>(null);
  const [conversationBusy, setConversationBusy] = useState(false);
  const [renameVisible, setRenameVisible] = useState(false);
  const [memberPickerVisible, setMemberPickerVisible] = useState(false);
  const [chatUsers, setChatUsers] = useState<ChatUserSummary[]>([]);
  const [taskPickerVisible, setTaskPickerVisible] = useState(false);
  const [shareableTasks, setShareableTasks] = useState<ChatTaskPreview[]>([]);
  const [taskPickerLoading, setTaskPickerLoading] = useState(false);
  const [stickerPickerVisible, setStickerPickerVisible] = useState(false);
  const [stickerPacks, setStickerPacks] = useState<ChatStickerPack[]>([]);
  const [stickerPickerLoading, setStickerPickerLoading] = useState(false);
  const [stickerImporting, setStickerImporting] = useState(false);
  const [recentStickerIds, setRecentStickerIds] = useState<string[]>([]);
  const [pinnedMessageId, setPinnedMessageId] = useState<string | null>(null);
  const [emojiPickerVisible, setEmojiPickerVisible] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [mediaViewer, setMediaViewer] = useState<ChatMediaItem | null>(null);
  const [mediaViewerItems, setMediaViewerItems] = useState<ChatMediaItem[] | null>(null);
  const [attachmentActionTarget, setAttachmentActionTarget] = useState<{
    message: ChatMessage;
    attachment: ChatAttachment;
  } | null>(null);
  const [typingParticipants, setTypingParticipants] = useState<Array<{ userId: number; name: string }>>([]);
  const [holdVisiblePosition, setHoldVisiblePosition] = useState(false);
  const typingIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingActiveRef = useRef(false);
  const incomingTypingTimeoutsRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());

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
  const leaveControllerRef = useRef(createNativeChatLeaveController({
    navigateAway: () => undefined,
  }));
  const loadGenerationRef = useRef(0);
  const accumulatedMessagesRef = useRef<ChatMessage[]>([]);
  const historyMayHaveGapsRef = useRef(false);
  const leaveThread = useCallback(() => {
    leaveControllerRef.current = createNativeChatLeaveController({
      offline: offlineMode,
      navigateAway: () => {
        notifyNativeChatConversationRead(conversationId);
        Keyboard.dismiss();
        requestLeave(() => {
          if (router.canGoBack?.()) router.back();
          else router.replace('/(shell)/chat');
        });
      },
      markRead: async (messageId) => {
        markedReadRef.current = messageId;
        try {
          await chatApi.markConversationRead(conversationId, messageId);
        } catch {
          if (markedReadRef.current === messageId) markedReadRef.current = '';
        }
      },
    });
    leaveControllerRef.current.leave(findLatestIncomingMessage(messagesRef.current, user?.id));
  }, [conversationId, offlineMode, requestLeave, user?.id]);

  useEffect(() => {
    leaveInFlightRef.current = false;
    loadGenerationRef.current += 1;
    accumulatedMessagesRef.current = [];
    historyMayHaveGapsRef.current = false;
  }, [conversationId, user?.id]);

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

  useEffect(() => {
    setDraftHydrated(false);
    setDraftError('');
    const initialRevision = textRevisionRef.current;
    let active = true;
    const userId = Number(user?.id || 0);
    if (!userId) return () => { active = false; };
    void getNativeChatDraftState(userId, conversationId).then((draft) => {
      if (!active) return;
      if (textRevisionRef.current === initialRevision) {
        setTextState(draft?.text || '');
        setComposerMode(draft?.context?.mode || null);
        draftBeforeEditRef.current = draft?.context?.beforeEditText || '';
        setAttachmentDraftFiles(draft?.context?.files || []);
      }
      setDraftHydrated(true);
    }).catch(() => {
      if (active) setDraftError('Не удалось прочитать черновик. Откройте диалог снова, чтобы повторить.');
    });
    return () => { active = false; };
  }, [conversationId, user?.id]);

  const stopOutgoingTyping = useCallback(() => {
    if (typingIdleRef.current) {
      clearTimeout(typingIdleRef.current);
      typingIdleRef.current = null;
    }
    if (typingActiveRef.current) {
      typingActiveRef.current = false;
      chatSocket.sendTyping(conversationId, false);
    }
  }, [conversationId]);

  const handleComposerText = useCallback((value: string) => {
    setText(value);
    if (!canWrite || composerMode?.type === 'edit') return;
    if (!value.trim()) {
      stopOutgoingTyping();
      return;
    }
    if (!typingActiveRef.current) {
      typingActiveRef.current = true;
      chatSocket.sendTyping(conversationId, true);
    }
    if (typingIdleRef.current) clearTimeout(typingIdleRef.current);
    typingIdleRef.current = setTimeout(() => {
      typingActiveRef.current = false;
      chatSocket.sendTyping(conversationId, false);
      typingIdleRef.current = null;
    }, 2000);
  }, [canWrite, composerMode?.type, conversationId, stopOutgoingTyping]);

  const mentionQuery = useMemo(() => getTrailingMentionQuery(text), [text]);

  useEffect(() => {
    if (mentionQuery === null || chatUsers.length) return;
    let active = true;
    void chatApi.getChatUsers().then((users) => {
      if (active) setChatUsers(users);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [chatUsers.length, mentionQuery]);

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
    const peerId = Number(conversation?.direct_peer?.id || conversation?.peer_user_id || 0);
    if (peerId > 0) chatSocket.watchPresence([peerId]);
  }, [conversation?.direct_peer?.id, conversation?.peer_user_id, offlineMode]);



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

  const loadInitial = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    const scopeUserId = Number(user?.id || 0);
    const scopeConversationId = conversationId;
    const isCurrentLoad = () => (
      mountedRef.current
      && loadGenerationRef.current === generation
      && Number(user?.id || 0) === scopeUserId
      && conversationId === scopeConversationId
    );
    messageAnimationReadyRef.current = false;
    setLoading(true);
    setError('');
    setHistoryUnavailableOffline(false);
    let hadCachedSnapshot = false;
    let loadedLiveMessages = false;
    try {
      const userId = scopeUserId;
      const cached = userId
        ? await readNativeEntitySnapshot<ChatThreadSnapshot>(
          'chat-thread-details',
          userId,
          conversationId,
          Number.MAX_SAFE_INTEGER,
        )
        : null;
      if (!isCurrentLoad()) return;
      if (cached) {
        hadCachedSnapshot = true;
        const normalized = mergeMessages([], cached.data.messages || [], user?.id);
        accumulatedMessagesRef.current = normalized;
        historyMayHaveGapsRef.current = Boolean(cached.data.historyMayHaveGaps);
        knownMessageIdsRef.current = new Set(normalized.map((entry) => entry.id));
        setMessages(normalized);
        setConversation(cached.data.conversation || null);
        setTitle(cached.data.title || cached.data.conversation?.title || 'Chat');
        setHasOlder(Boolean(cached.data.hasOlder));
        setOlderCursor(cached.data.olderCursor || null);
        setHasNewer(Boolean(cached.data.hasNewer));
        setNewerCursor(cached.data.newerCursor || null);
        setUnreadBoundaryId(cached.data.unreadBoundaryId || null);
        setFocusAnchorId(messageId || cached.data.focusAnchorId || null);
        setPinnedMessageId(cached.data.pinnedMessageId || null);
        nearBottomRef.current = !cached.data.hasNewer;
        setShowJumpToBottom(Boolean(cached.data.hasNewer));
        setNewMessageCount(0);
        messageAnimationReadyRef.current = true;
        setThreadHydrated(true);
        setLoading(false);
      }
      try {
        const queued = await outbox.read();
        const uploads = await outbox.readUploads();
        if (!isCurrentLoad()) return;
        uploads.forEach(({ id, upload }) => pendingAttachmentUploadsRef.current.set(id, upload));
        setMessages((current) => {
          const merged = mergeMessages(queued, current, userId);
          accumulatedMessagesRef.current = mergeNativeChatThreadHistory(
            accumulatedMessagesRef.current,
            merged,
            userId,
          );
          return merged;
        });
      } catch {
        if (isCurrentLoad()) setDraftError('Не удалось восстановить исходящие сообщения. Откройте диалог снова, чтобы повторить.');
      }
      if (offlineMode) {
        if (!hadCachedSnapshot && isCurrentLoad()) {
          setHistoryUnavailableOffline(true);
          setThreadHydrated(true);
        }
        return;
      }

      const conversationResultPromise = chatApi.getConversation(conversationId).then(
        (value) => ({ value, error: null as unknown }),
        (error: unknown) => ({ value: null, error }),
      );
      const page = messageId
        ? await chatApi.getThreadBootstrap(conversationId, {
          focusMessageId: messageId,
          limit: 80,
          lightweight: false,
        })
        : await chatApi.getMessagesPage(conversationId, { limit: 80 });
      if (!isCurrentLoad()) return;
      loadedLiveMessages = true;
      const normalized = mergeMessages([], page.items, user?.id);
      void outbox.acknowledge(normalized).catch(() => undefined);
      setMessages((current) => {
        const merged = mergeMessages(current, normalized, user?.id);
        knownMessageIdsRef.current = new Set(merged.map((entry) => entry.id));
        accumulatedMessagesRef.current = mergeNativeChatThreadHistory(
          accumulatedMessagesRef.current,
          merged,
          user?.id,
        );
        historyMayHaveGapsRef.current = Boolean(page.has_older || page.has_newer || historyMayHaveGapsRef.current);
        return merged;
      });
      messageAnimationReadyRef.current = true;
      setThreadHydrated(true);
      setLoading(false);
      const pagePinnedMessageId = 'pinned_message_id' in page
        ? (page as { pinned_message_id?: string | null }).pinned_message_id
        : undefined;
      const rawPinnedMessageId = pagePinnedMessageId;
      if (rawPinnedMessageId !== undefined) {
        const serverPinnedMessageId = String(rawPinnedMessageId || '').trim() || null;
        serverPinKnownRef.current = true;
        setPinnedMessageId(serverPinnedMessageId);
        if (userId) void setPinnedChatMessageId(userId, conversationId, serverPinnedMessageId);
      }
      setUnreadBoundaryId(getUnreadBoundaryMessageId(normalized, page.viewer_last_read_message_id));
      setHasOlder(page.has_older);
      setOlderCursor(page.older_cursor_message_id);
      setHasNewer(page.has_newer);
      setNewerCursor(page.newer_cursor_message_id);
      const responseAnchorId = 'initial_anchor_message_id' in page
        ? String(page.initial_anchor_message_id || '').trim()
        : '';
      setFocusAnchorId(responseAnchorId || messageId || null);
      nearBottomRef.current = !page.has_newer;
      setShowJumpToBottom(page.has_newer);
      setNewMessageCount(0);
      if (!page.has_newer) {
        requestBottomAnchor();
        markRead(findLatestIncomingMessage(normalized, user?.id));
      }

      const conversationResult = await conversationResultPromise;
      if (!isCurrentLoad()) return;
      if (conversationResult.value) {
        const liveConversation = conversationResult.value;
        setConversation(liveConversation);
        setTitle(liveConversation.title || 'Chat');
        if (liveConversation.pinned_message_id !== undefined) {
          const serverPinnedMessageId = String(liveConversation.pinned_message_id || '').trim() || null;
          serverPinKnownRef.current = true;
          setPinnedMessageId(serverPinnedMessageId);
          if (userId) void setPinnedChatMessageId(userId, conversationId, serverPinnedMessageId);
        }
        if (isAiConversation(liveConversation)) {
          void chatApi.getAiBots().then((bots) => {
            if (isCurrentLoad()) setAiBots(bots);
          }).catch(() => undefined);
        }
      }
    } catch (cause) {
      if (isCurrentLoad() && !hadCachedSnapshot && !loadedLiveMessages) {
        if (offlineMode) {
          setHistoryUnavailableOffline(true);
          setThreadHydrated(true);
        } else {
          setError(formatApiError(cause, 'Не удалось загрузить сообщения'));
        }
      }
    } finally {
      if (isCurrentLoad()) setLoading(false);
    }
  }, [conversationId, markRead, messageId, offlineMode, outbox, requestBottomAnchor, user?.id]);

  useEffect(() => {
    const userId = Number(user?.id || 0);
    if (!threadHydrated || userId <= 0) return undefined;
    const generation = getNativeChatThreadHistoryGeneration();
    const timer = setTimeout(() => {
      accumulatedMessagesRef.current = mergeNativeChatThreadHistory(
        accumulatedMessagesRef.current,
        messages.filter((message) => !message.local_status),
        user?.id,
      );
      void scheduleNativeChatThreadSnapshotWrite(
        userId,
        conversationId,
        {
          conversation,
          title,
          messages: accumulatedMessagesRef.current,
          hasOlder,
          olderCursor,
          hasNewer,
          newerCursor,
          unreadBoundaryId,
          focusAnchorId,
          pinnedMessageId,
          historyMayHaveGaps: historyMayHaveGapsRef.current || hasOlder || hasNewer,
        },
        { generation, currentUserId: user?.id },
      );
    }, 250);
    // Do not cancel the durable write on unmount — only cancel the debounce timer
    // by flushing immediately when the screen goes away.
    return () => {
      clearTimeout(timer);
      if (!threadHydrated || userId <= 0) return;
      accumulatedMessagesRef.current = mergeNativeChatThreadHistory(
        accumulatedMessagesRef.current,
        messages.filter((message) => !message.local_status),
        user?.id,
      );
      void scheduleNativeChatThreadSnapshotWrite(
        userId,
        conversationId,
        {
          conversation,
          title,
          messages: accumulatedMessagesRef.current,
          hasOlder,
          olderCursor,
          hasNewer,
          newerCursor,
          unreadBoundaryId,
          focusAnchorId,
          pinnedMessageId,
          historyMayHaveGaps: historyMayHaveGapsRef.current || hasOlder || hasNewer,
        },
        { generation, currentUserId: user?.id },
      );
    };
  }, [
    conversation,
    conversationId,
    focusAnchorId,
    hasNewer,
    hasOlder,
    messages,
    newerCursor,
    olderCursor,
    pinnedMessageId,
    threadHydrated,
    title,
    unreadBoundaryId,
    user?.id,
  ]);

  const loadOlder = useCallback(async () => {
    if (offlineMode || !hasOlder || !olderCursor || loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const page = await chatApi.getMessagesPage(conversationId, {
        beforeMessageId: olderCursor,
        limit: 80,
      });
      if (!mountedRef.current) return;
      if (page.cursor_invalid) {
        await loadInitial();
        return;
      }
      page.items.forEach((item) => knownMessageIdsRef.current.add(item.id));
      setHoldVisiblePosition(true);
      setMessages((current) => {
        const merged = mergeMessages(current, page.items, user?.id);
        accumulatedMessagesRef.current = mergeNativeChatThreadHistory(
          accumulatedMessagesRef.current,
          page.items,
          user?.id,
        );
        historyMayHaveGapsRef.current = Boolean(historyMayHaveGapsRef.current || page.has_older);
        return merged;
      });
      setHasOlder(page.has_older);
      setOlderCursor(page.older_cursor_message_id);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (mountedRef.current) setHoldVisiblePosition(false);
        });
      });
    } catch (cause) {
      if (mountedRef.current) setError(formatApiError(cause, 'Не удалось загрузить предыдущие сообщения'));
    } finally {
      loadingOlderRef.current = false;
      if (mountedRef.current) setLoadingOlder(false);
    }
  }, [conversationId, hasOlder, loadInitial, offlineMode, olderCursor, user?.id]);

  const loadNewer = useCallback(async () => {
    if (offlineMode || !hasNewer || !newerCursor || loadingNewerRef.current) return;
    loadingNewerRef.current = true;
    try {
      const page = await chatApi.getMessagesPage(conversationId, {
        afterMessageId: newerCursor,
        limit: 80,
      });
      if (!mountedRef.current) return;
      if (page.cursor_invalid) {
        await loadInitial();
        return;
      }
      page.items.forEach((item) => knownMessageIdsRef.current.add(item.id));
      setMessages((current) => {
        const merged = mergeMessages(current, page.items, user?.id);
        accumulatedMessagesRef.current = mergeNativeChatThreadHistory(
          accumulatedMessagesRef.current,
          page.items,
          user?.id,
        );
        historyMayHaveGapsRef.current = Boolean(historyMayHaveGapsRef.current || page.has_newer);
        return merged;
      });
      setHasNewer(page.has_newer);
      setNewerCursor(page.newer_cursor_message_id);
      if (!page.has_newer) {
        nearBottomRef.current = true;
        setShowJumpToBottom(false);
        setNewMessageCount(0);
        markRead(findLatestIncomingMessage(mergeMessages([], page.items, user?.id), user?.id));
      }
    } catch (cause) {
      if (mountedRef.current) setError(formatApiError(cause, 'Не удалось загрузить новые сообщения'));
    } finally {
      loadingNewerRef.current = false;
    }
  }, [conversationId, hasNewer, loadInitial, markRead, newerCursor, offlineMode, user?.id]);

  const syncLatestMessages = useCallback(async () => {
    if (offlineMode || reconnectSyncRef.current) return;
    reconnectSyncRef.current = true;
    try {
      const page = await chatApi.getMessagesPage(conversationId, { limit: 80 });
      if (!mountedRef.current) return;
      page.items.forEach((message) => {
        const isNew = !knownMessageIdsRef.current.has(message.id);
        if (
          messageAnimationReadyRef.current
          && nearBottomRef.current
          && isNew
          && resolveChatMessageIsOwn(message, user?.id) !== true
        ) {
          messageEnterMotionsRef.current.set(chatMessageMotionKey(message), 'incoming');
        }
        knownMessageIdsRef.current.add(message.id);
      });
      setMessages((current) => mergeMessages(current, page.items, user?.id));
      if (nearBottomRef.current && !page.has_newer) {
        requestBottomAnchor('incoming');
        markRead(findLatestIncomingMessage(mergeMessages([], page.items, user?.id), user?.id));
      }
    } catch {
      // The reconnect banner remains the source of truth; the next reconnect/focus retries the catch-up.
    } finally {
      reconnectSyncRef.current = false;
    }
  }, [conversationId, markRead, offlineMode, requestBottomAnchor, user?.id]);

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

  useEffect(() => {
    mountedRef.current = true;
    markedReadRef.current = '';
    void loadInitial();
    if (offlineMode) {
      setStatus('offline');
      return () => {
        mountedRef.current = false;
        incomingTypingTimeoutsRef.current.forEach((timer) => clearTimeout(timer));
        incomingTypingTimeoutsRef.current.clear();
        if (typingIdleRef.current) clearTimeout(typingIdleRef.current);
        if (pendingAnchorTimerRef.current) clearTimeout(pendingAnchorTimerRef.current);
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      };
    }
    chatSocket.subscribeConversation(conversationId);
    void chatSocket.connect();

    const offStatus = chatSocket.on('status', (next) => {
      const nextStatus = next as ChatSocketStatus;
      setStatus(nextStatus);
      if (nextStatus !== 'connected') return;
      if (connectedOnceRef.current) void syncLatestMessages();
      else connectedOnceRef.current = true;
    });
    const applyMessage = (envelope: unknown, countAsNew = false) => {
      const message = messageFromEnvelope(envelope);
      if (!message || message.conversation_id !== conversationId) return;
      const isNew = !knownMessageIdsRef.current.has(message.id);
      if (
        messageAnimationReadyRef.current
        && nearBottomRef.current
        && countAsNew
        && isNew
        && resolveChatMessageIsOwn(message, user?.id) !== true
      ) {
        messageEnterMotionsRef.current.set(chatMessageMotionKey(message), 'incoming');
      }
      knownMessageIdsRef.current.add(message.id);
      setMessages((current) => mergeMessages(current, message, user?.id));
      if (nearBottomRef.current) {
        requestBottomAnchor();
        markRead(message);
      }
      else if (countAsNew && isNew) {
        setNewMessageCount((current) => current + 1);
        setShowJumpToBottom(true);
      }
    };
    const offCreated = chatSocket.on('chat.message.created', (envelope) => applyMessage(envelope, true));
    const offUpdated = chatSocket.on('chat.message.updated', (envelope) => applyMessage(envelope));
    const offDeleted = chatSocket.on('chat.message.deleted', (envelope) => applyMessage(envelope));
    const offReaction = chatSocket.on('chat.message.reaction', (envelope: unknown) => {
      setMessages((current) => applyReactionEnvelope(current, envelope).items);
    });
    const applyTyping = (envelope: unknown) => {
      const parsed = parseTypingEnvelope(envelope);
      if (!parsed || parsed.conversationId !== conversationId || parsed.userId === Number(user?.id || 0)) {
        return;
      }
      const existing = incomingTypingTimeoutsRef.current.get(parsed.userId);
      if (existing) clearTimeout(existing);
      setTypingParticipants((current) => applyTypingParticipant(
        current,
        { userId: parsed.userId, name: parsed.name || 'Участник' },
        parsed.isTyping,
      ));
      if (parsed.isTyping) {
        incomingTypingTimeoutsRef.current.set(parsed.userId, setTimeout(() => {
          setTypingParticipants((current) => applyTypingParticipant(
            current,
            { userId: parsed.userId, name: parsed.name || 'Участник' },
            false,
          ));
          incomingTypingTimeoutsRef.current.delete(parsed.userId);
        }, 4000));
      } else {
        incomingTypingTimeoutsRef.current.delete(parsed.userId);
      }
    };
    const offTypingStarted = chatSocket.on('chat.typing.started', applyTyping);
    const offTypingStopped = chatSocket.on('chat.typing.stopped', applyTyping);
    const offPresence = chatSocket.on('chat.presence.updated', (envelope: unknown) => {
      const parsed = parsePresenceEnvelope(envelope);
      if (!parsed) return;
      setConversation((current) => {
        if (!current) return current;
        if (current.direct_peer?.id === parsed.userId) {
          return { ...current, direct_peer: { ...current.direct_peer, presence: parsed.presence } };
        }
        if (!current.members?.length) return current;
        return {
          ...current,
          members: current.members.map((member) => (
            member.user.id === parsed.userId
              ? { ...member, user: { ...member.user, presence: parsed.presence } }
              : member
          )),
        };
      });
    });

    return () => {
      mountedRef.current = false;
      incomingTypingTimeoutsRef.current.forEach((timer) => clearTimeout(timer));
      incomingTypingTimeoutsRef.current.clear();
      if (typingIdleRef.current) clearTimeout(typingIdleRef.current);
      if (pendingAnchorTimerRef.current) clearTimeout(pendingAnchorTimerRef.current);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      uploadControllersRef.current.forEach((controller) => controller.abort());
      uploadControllersRef.current.clear();
      downloadControllersRef.current.forEach((controller) => controller.abort());
      downloadControllersRef.current.clear();
      if (typingActiveRef.current) chatSocket.sendTyping(conversationId, false);
      typingActiveRef.current = false;
      offStatus();
      offCreated();
      offUpdated();
      offDeleted();
      offReaction();
      offTypingStarted();
      offTypingStopped();
      offPresence();
      chatSocket.unsubscribeConversation(conversationId);
    };
  }, [conversationId, loadInitial, markRead, offlineMode, requestBottomAnchor, syncLatestMessages, user?.id]);

  useEffect(() => {
    if (offlineMode || !shouldUseChatHttpFallback(status)) return undefined;
    void syncLatestMessages();
    const timer = setInterval(() => {
      void syncLatestMessages();
    }, 15_000);
    return () => clearInterval(timer);
  }, [offlineMode, status, syncLatestMessages]);

  const sendBody = useCallback(async (
    body: string,
    clientMessageId = createClientMessageId(),
    replyPreview?: ChatMessage['reply_preview'],
    animateFromComposer = true,
    onPersisted?: () => void,
  ): Promise<void> => {
    const trimmed = body.trim();
    if (!trimmed || !isCurrentSendScope()) return;
    stopOutgoingTyping();
    const pendingId = `pending:${clientMessageId}`;
    const pending: ChatMessage = {
      id: pendingId,
      conversation_id: conversationId,
      sender_user_id: Number(user?.id || 0),
      sender: user ? {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        avatar_url: user.avatar_url,
      } : null,
      body: trimmed,
      body_text: trimmed,
      body_format: detectChatBodyFormat(trimmed),
      created_at: new Date().toISOString(),
      client_message_id: clientMessageId,
      is_own: true,
      local_status: 'sending',
      attachments: [],
      reactions: [],
      reply_preview: replyPreview || null,
    };
    if (animateFromComposer) {
      messageEnterMotionsRef.current.set(chatMessageMotionKey(pending), 'outgoing');
    }
    requestBottomAnchor('own-send');
    setMessages((current) => mergeMessages(
      current.filter((message) => message.id !== pendingId),
      pending,
      user?.id,
    ));
    knownMessageIdsRef.current.add(pendingId);
    try {
      const saved = await outbox.send(pending, (...args) => {
        if (!isCurrentSendScope()) throw new Error('Отправка приостановлена: доступ к диалогу изменился');
        return chatApi.sendTextMessage(...args);
      }, () => { if (isCurrentSendScope()) onPersisted?.(); }, { deliver: !offlineMode });
      if (!isCurrentSendScope()) return;
      if (offlineMode || saved.local_status === 'failed') {
        setMessages((current) => current.map((message) => (
          message.id === pendingId
            ? { ...message, local_status: 'failed', delivery_status: undefined }
            : message
        )));
        return;
      }
      knownMessageIdsRef.current.add(saved.id);
      setMessages((current) => mergeMessages(
        current,
        saved,
        user?.id,
      ));
    } catch (cause) {
      if (!isCurrentSendScope()) return;
      setMessages((current) => current.map((message) => (
        message.id === pendingId ? { ...message, local_status: 'failed' } : message
      )));
      if (replyPreview?.id && axios.isAxiosError(cause) && cause.response?.status === 404
        && cause.response.data?.detail === 'Quoted message not found') {
        Alert.alert('Исходное сообщение недоступно', 'Ответ сохранён в очереди. Перед повтором проверьте переписку: прежняя отправка могла пройти без подтверждения. Можно отправить текст заново без цитаты.', [
          { text: 'Оставить в очереди', style: 'cancel' },
          { text: 'Отправить без цитаты', onPress: () => {
            if (!isCurrentSendScope()) return;
            void outbox.detachReply(clientMessageId, createClientMessageId(), isCurrentSendScope).then(async ({ message: replacement }) => {
              if (!isCurrentSendScope()) return;
              setMessages((current) => mergeMessages(current.filter((message) => message.client_message_id !== clientMessageId), replacement, user?.id));
              await sendBody(replacement.body_text || '', replacement.client_message_id!, undefined, false);
            }).catch(() => {
              if (isCurrentSendScope()) Alert.alert('Не удалось изменить ответ', 'Исходный ответ сохранён в очереди. Повторите действие.');
            });
          } },
        ]);
      }
    }
  }, [isCurrentSendScope, conversationId, offlineMode, outbox, requestBottomAnchor, stopOutgoingTyping, user]);

  const startReply = useCallback((message: ChatMessage) => {
    if (composerBusyRef.current) return;
    if (composerMode?.type === 'edit') {
      setText(draftBeforeEditRef.current);
      draftBeforeEditRef.current = '';
    }
    setComposerMode({ type: 'reply', message });
  }, [composerBusy, composerMode?.type]);

  const startEdit = useCallback((message: ChatMessage) => {
    if (composerBusyRef.current) return;
    if (offlineMode) {
      Alert.alert('Нет сети', 'Редактирование сообщения на сервере недоступно офлайн. Локальный черновик можно продолжить.');
      return;
    }
    if (composerMode?.type !== 'edit') draftBeforeEditRef.current = text;
    setComposerMode({ type: 'edit', message });
    setText(message.body_text || '');
  }, [composerBusy, composerMode?.type, offlineMode, text]);

  const cancelComposerMode = useCallback(() => {
    if (composerBusyRef.current) return;
    if (composerMode?.type === 'edit') {
      setText(draftBeforeEditRef.current);
      draftBeforeEditRef.current = '';
    }
    setComposerMode(null);
  }, [composerMode?.type]);

  const toggleReaction = useCallback(async (message: ChatMessage, emoji: string) => {
    if (!canWrite || message.is_deleted || message.local_status) return;
    const previousReactions = message.reactions || [];
    setMessages((current) => current.map((item) => (
      item.id === message.id
        ? { ...item, reactions: toggleReactionOptimistic(item.reactions, emoji, user?.id) }
        : item
    )));
    try {
      const reactions = await chatApi.toggleReaction(conversationId, message.id, emoji);
      if (!mountedRef.current) return;
      setMessages((current) => current.map((item) => (
        item.id === message.id ? { ...item, reactions } : item
      )));
    } catch (cause) {
      if (!mountedRef.current) return;
      setMessages((current) => current.map((item) => (
        item.id === message.id ? { ...item, reactions: previousReactions } : item
      )));
      Alert.alert('Не удалось изменить реакцию', formatApiError(cause, 'Повторите попытку'));
    }
  }, [canWrite, conversationId, user?.id]);

  const requestDelete = useCallback((message: ChatMessage) => {
    Alert.alert(
      'Удалить сообщение?',
      'Текст и вложения будут скрыты у всех участников диалога.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => {
            void chatApi.deleteMessage(conversationId, message.id)
              .then((deleted) => {
                if (mountedRef.current) {
                  setMessages((current) => mergeMessages(current, deleted, user?.id));
                }
              })
              .catch((cause) => {
                if (mountedRef.current) {
                  Alert.alert('Не удалось удалить сообщение', formatApiError(cause, 'Повторите попытку'));
                }
              });
          },
        },
      ],
    );
  }, [conversationId, user?.id]);

  const discardPendingMessage = useCallback((message: ChatMessage) => {
    const id = message.client_message_id;
    if (!id || !message.local_status || message.local_status === 'sending') return;
    Alert.alert('Убрать сообщение из очереди?', 'Повторная отправка будет недоступна. Если сервер уже получил сообщение, оно останется в переписке.', [
      { text: 'Оставить', style: 'cancel' },
      { text: 'Убрать', style: 'destructive', onPress: () => {
        if (!mountedRef.current || uploadControllersRef.current.has(id)) return;
        void outbox.discard(id).then(() => {
          if (!mountedRef.current) return;
          pendingAttachmentUploadsRef.current.delete(id);
          setMessages((current) => current.filter((item) => !(item.client_message_id === id && item.local_status)));
        }).catch(() => {
          if (mountedRef.current) Alert.alert('Не удалось убрать сообщение', 'Дождитесь завершения отправки или повторите действие.');
        });
      } },
    ]);
  }, [outbox]);

  const sendMessage = useCallback(async () => {
    if (composerBusyRef.current) return;
    const body = text.trim();
    if (!body) return;

    if (composerMode?.type === 'edit') {
      if (offlineMode) {
        Alert.alert('Нет сети', 'Сохранение правки на сервере недоступно офлайн.');
        return;
      }
      if (composerMode.message.is_deleted) {
        Alert.alert('Сообщение удалено', 'Сохранить изменения нельзя. Текст правки остался в поле ввода. Отмена редактирования вернёт ваш обычный черновик.');
        return;
      }
      setComposerBusy(true);
      try {
        const saved = await chatApi.editMessage(conversationId, composerMode.message.id, body);
        if (!mountedRef.current) return;
        setMessages((current) => mergeMessages(current, saved, user?.id));
        setText(draftBeforeEditRef.current);
        draftBeforeEditRef.current = '';
        setComposerMode(null);
      } catch (cause) {
        if (mountedRef.current) {
          Alert.alert('Не удалось сохранить изменения', formatApiError(cause, 'Повторите попытку'));
        }
      } finally {
        if (mountedRef.current) setComposerBusy(false);
      }
      return;
    }

    const replyMessage = composerMode?.type === 'reply' ? composerMode.message : null;
    if (pendingComposerSendRef.current) return;
    const submission = Symbol('composer-send');
    pendingComposerSendRef.current = submission;
    const replyPreview = replyMessage ? {
      id: replyMessage.id,
      sender_name: replyMessage.sender?.full_name || replyMessage.sender?.username || 'Сообщение',
      kind: replyMessage.kind === 'file' || replyMessage.kind === 'task_share' ? replyMessage.kind : 'text' as const,
      body: replyMessage.body_text || '',
      attachments_count: replyMessage.attachments?.length || 0,
    } : undefined;
    const revision = textRevisionRef.current;
    // Show the bubble immediately, but retain the composer until it is durable.
    const sending = sendBody(body, undefined, replyPreview, true, () => {
      if (pendingComposerSendRef.current === submission) pendingComposerSendRef.current = null;
      if (!mountedRef.current || revision !== textRevisionRef.current) return;
      setText('');
      setComposerMode(null);
      if (user?.id) void clearNativeChatDraft(user.id, conversationId).catch(() => undefined);
    });
    try { await sending; }
    finally { if (pendingComposerSendRef.current === submission) pendingComposerSendRef.current = null; }
  }, [composerMode, conversationId, offlineMode, sendBody, text, user?.id]);

  const setAttachmentTransfersForIds = useCallback((
    attachmentIds: string[],
    transfer: ChatAttachmentTransfer,
  ) => {
    setAttachmentTransfers((current) => {
      const next = { ...current };
      attachmentIds.forEach((attachmentId) => {
        next[attachmentId] = transfer;
      });
      return next;
    });
  }, []);

  const clearAttachmentTransfersForIds = useCallback((attachmentIds: string[]) => {
    setAttachmentTransfers((current) => {
      if (!attachmentIds.some((attachmentId) => current[attachmentId])) return current;
      const next = { ...current };
      attachmentIds.forEach((attachmentId) => delete next[attachmentId]);
      return next;
    });
  }, []);

  const sendPickedFiles = useCallback(async (
    files: NativePickedFile[],
    extra: {
      mediaKind?: PendingAttachmentMediaKind;
      durationSeconds?: number;
      clientMessageId?: string;
      body?: string;
      replyToMessageId?: string;
      replyPreview?: ChatMessage['reply_preview'];
    } = {},
  ): Promise<void> => {
    if (!files.length || !isCurrentSendScope()) return;
    const clientMessageId = extra.clientMessageId || createClientMessageId();
    const previousUpload = pendingAttachmentUploadsRef.current.get(clientMessageId);
    const replyMessage = !previousUpload && composerMode?.type === 'reply' ? composerMode.message : null;
    const replyPreview = extra.replyPreview ?? previousUpload?.replyPreview ?? (replyMessage ? {
      id: replyMessage.id,
      sender_name: replyMessage.sender?.full_name || replyMessage.sender?.username || 'Сообщение',
      kind: replyMessage.kind === 'file' || replyMessage.kind === 'task_share' ? replyMessage.kind : 'text' as const,
      body: replyMessage.body_text || '',
      attachments_count: replyMessage.attachments?.length || 0,
    } : undefined);
    const upload: PendingAttachmentUpload = previousUpload || {
      files: [...files],
      mediaKind: extra.mediaKind,
      durationSeconds: extra.durationSeconds,
      body: extra.body ?? text,
      replyToMessageId: extra.replyToMessageId || replyMessage?.id,
      replyPreview,
    };
    pendingAttachmentUploadsRef.current.set(clientMessageId, upload);

    const pending = buildPendingAttachmentMessage({
      conversationId,
      clientMessageId,
      files: upload.files,
      mediaKind: upload.mediaKind,
      body: upload.body,
      bodyFormat: detectChatBodyFormat(upload.body),
      replyPreview: upload.replyPreview,
      sender: user ? {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        avatar_url: user.avatar_url,
      } : null,
    });
    const attachmentIds = (pending.attachments || []).map((attachment) => attachment.id);
    const controller = new AbortController();
    uploadControllersRef.current.get(clientMessageId)?.abort();
    uploadControllersRef.current.set(clientMessageId, controller);
    setAttachmentTransfersForIds(attachmentIds, {
      action: 'upload',
      progress: 0,
      status: 'active',
      cancellable: true,
    });
    stopOutgoingTyping();
    requestBottomAnchor('own-send');
    const composerRevision = textRevisionRef.current;
    if (!previousUpload) {
      messageEnterMotionsRef.current.set(chatMessageMotionKey(pending), 'outgoing');
    }
    knownMessageIdsRef.current.add(pending.id);
    setMessages((current) => mergeMessages(
      current.filter((message) => message.id !== pending.id),
      pending,
      user?.id,
    ));

    let uploadPrepared = false;
    try {
      const durableUpload = await outbox.prepareUpload(pending, upload);
      uploadPrepared = true;
      if (!isCurrentSendScope()) return;
      pendingAttachmentUploadsRef.current.set(clientMessageId, durableUpload);
      if (!previousUpload && mountedRef.current && composerRevision === textRevisionRef.current) {
        setText('');
        setComposerMode(null);
        setAttachmentDraftFiles([]);
        if (user?.id) void clearNativeChatDraft(user.id, conversationId).catch(() => undefined);
      }
      if (controller.signal.aborted) throw new Error('Отправка отменена');
      const formData = buildAttachmentsFormData(durableUpload.files, {
        body: upload.body,
        clientMessageId,
        replyToMessageId: upload.replyToMessageId,
        mediaKind: upload.mediaKind,
        durationSeconds: upload.durationSeconds,
      });
      const saved = await chatApi.sendFileMessage(conversationId, formData, {
        signal: controller.signal,
        onProgress: (loaded, total) => {
          if (!isCurrentSendScope() || uploadControllersRef.current.get(clientMessageId) !== controller) return;
          setAttachmentTransfersForIds(attachmentIds, {
            action: 'upload',
            progress: total && total > 0 ? Math.max(0, Math.min(1, loaded / total)) : null,
            status: 'active',
            cancellable: true,
          });
        },
      });
      await outbox.completeUpload(clientMessageId).catch(() => undefined);
      if (!isCurrentSendScope() || uploadControllersRef.current.get(clientMessageId) !== controller) return;
      knownMessageIdsRef.current.add(saved.id);
      pendingAttachmentUploadsRef.current.delete(clientMessageId);
      clearAttachmentTransfersForIds(attachmentIds);
      setMessages((current) => mergeMessages(current, {
        ...saved,
        is_own: true,
        sender_user_id: saved.sender_user_id || Number(user?.id || 0),
      }, user?.id));
    } catch (cause) {
      if (!isCurrentSendScope() || uploadControllersRef.current.get(clientMessageId) !== controller) return;
      const authoritativeMessageArrived = messagesRef.current.some((message) => (
        !String(message.id).startsWith('pending:')
        && String(message.client_message_id || '').trim() === clientMessageId
      ));
      if (authoritativeMessageArrived) {
        pendingAttachmentUploadsRef.current.delete(clientMessageId);
        clearAttachmentTransfersForIds(attachmentIds);
        return;
      }
      const cancelled = isAttachmentTransferAbort(cause, controller.signal);
      setMessages((current) => current.map((message) => (
        message.id === pending.id
          ? { ...message, local_status: cancelled ? 'cancelled' : 'failed' }
          : message
      )));
      setAttachmentTransfersForIds(attachmentIds, {
        action: 'upload',
        progress: attachmentTransfersRef.current[attachmentIds[0]]?.progress ?? 0,
        status: cancelled ? 'cancelled' : 'failed',
        cancellable: false,
      });
      if (!cancelled && mountedRef.current) {
        if (!uploadPrepared) {
          void recordDiagnosticEvent('native_file_error');
          Alert.alert(
            'Не удалось сохранить вложение',
            formatApiError(
              cause,
              'Файл не удалось сохранить на устройстве. Сообщение не поставлено в очередь — повторите отправку.',
            ),
          );
        } else if (!(upload.replyToMessageId && axios.isAxiosError(cause) && cause.response?.status === 404
          && cause.response.data?.detail === 'Quoted message not found')) {
          Alert.alert(
            'Не удалось отправить вложение',
            formatApiError(
              cause,
              'Файл сохранён в очереди. Можно повторить отправку без повторного выбора.',
            ),
          );
        }
      }
      if (upload.replyToMessageId && axios.isAxiosError(cause) && cause.response?.status === 404
        && cause.response.data?.detail === 'Quoted message not found') {
        Alert.alert('Исходное сообщение недоступно', 'Ответ и вложения сохранены в очереди. Перед повтором проверьте переписку: прежняя отправка могла пройти без подтверждения. Можно отправить их заново без цитаты.', [
          { text: 'Оставить в очереди', style: 'cancel' },
          { text: 'Отправить без цитаты', onPress: () => {
            if (!isCurrentSendScope()) return;
            void outbox.detachReply(clientMessageId, createClientMessageId(), isCurrentSendScope).then(async ({ message: replacement, upload: replacementUpload }) => {
              if (!isCurrentSendScope() || !replacementUpload) return;
              pendingAttachmentUploadsRef.current.delete(clientMessageId);
              pendingAttachmentUploadsRef.current.set(replacement.client_message_id!, replacementUpload);
              clearAttachmentTransfersForIds(attachmentIds);
              setMessages((current) => mergeMessages(current.filter((message) => message.client_message_id !== clientMessageId), replacement, user?.id));
              await sendPickedFiles(replacementUpload.files, { clientMessageId: replacement.client_message_id! });
            }).catch(() => {
              if (isCurrentSendScope()) Alert.alert('Не удалось изменить ответ', 'Исходный ответ и вложения сохранены в очереди. Повторите действие.');
            });
          } },
        ]);
      }
    } finally {
      if (uploadPrepared) outbox.finishUpload(clientMessageId);
      if (uploadControllersRef.current.get(clientMessageId) === controller) {
        uploadControllersRef.current.delete(clientMessageId);
      }
    }
  }, [
    isCurrentSendScope,
    clearAttachmentTransfersForIds,
    composerMode,
    conversationId,
    outbox,
    requestBottomAnchor,
    setAttachmentTransfersForIds,
    stopOutgoingTyping,
    text,
    user,
  ]);

  const sendPickedFile = useCallback(async (
    file: NativePickedFile | null,
    extra: { mediaKind?: 'image' | 'video' | 'file' | 'audio'; durationSeconds?: number } = {},
  ) => {
    if (file) await sendPickedFiles([file], { ...extra, clientMessageId: createClientMessageId() });
  }, [sendPickedFiles]);

  const cancelPendingAttachmentUpload = useCallback((message: ChatMessage) => {
    const clientMessageId = String(message.client_message_id || '').trim();
    if (!clientMessageId) return;
    uploadControllersRef.current.get(clientMessageId)?.abort();
  }, []);

  const retryPendingAttachmentUpload = useCallback((message: ChatMessage) => {
    const clientMessageId = String(message.client_message_id || '').trim();
    const pending = pendingAttachmentUploadsRef.current.get(clientMessageId);
    if (!clientMessageId || !pending) return;
    void sendPickedFiles(pending.files, {
      clientMessageId,
      mediaKind: pending.mediaKind,
      durationSeconds: pending.durationSeconds,
      body: pending.body,
      replyToMessageId: pending.replyToMessageId,
      replyPreview: pending.replyPreview,
    });
  }, [sendPickedFiles]);

  const pickAndSendAttachment = useCallback(async (source: NativeAttachmentSource) => {
    setAttachmentPickerVisible(false);
    try {
      const files = await pickNativeAttachments(source);
      if (!files.length) return;
      if (files.length === 1 && (source === 'camera' || source === 'gallery') && files[0].mimeType.startsWith('image/')) {
        setImageEditorFile(files[0]);
        return;
      }
      if (files.length > 1) {
        setAttachmentDraftError('');
        attachmentDraftClientMessageIdRef.current = createClientMessageId();
        setAttachmentDraftFiles(files);
        return;
      }
      await sendPickedFile(files[0]);
    } catch (cause) {
      if (!mountedRef.current) return;
      if (cause instanceof NativeFilePermissionError) {
        Alert.alert(
          'Нет доступа к камере',
          'Разрешите HUB-IT использовать камеру в настройках Android.',
          [
            { text: 'Отмена', style: 'cancel' },
            { text: 'Открыть настройки', onPress: () => void openAppPermissionSettings() },
          ],
        );
      } else {
        Alert.alert('Не удалось отправить вложение', formatApiError(cause, 'Повторите попытку'));
      }
    }
  }, [sendPickedFile]);

  const sendAttachmentDraft = useCallback(async () => {
    if (!attachmentDraftFiles.length || attachmentDraftSendRef.current) return;
    attachmentDraftSendRef.current = true;
    setComposerBusy(true);
    const files = attachmentDraftFiles;
    const clientMessageId = attachmentDraftClientMessageIdRef.current || createClientMessageId();
    attachmentDraftClientMessageIdRef.current = '';
    setAttachmentDraftError('');
    try { await sendPickedFiles(files, { clientMessageId }); }
    finally {
      attachmentDraftSendRef.current = false;
      if (mountedRef.current) setComposerBusy(false);
    }
  }, [attachmentDraftFiles, sendPickedFiles]);

  const handleVoiceRecordingChange = useCallback((recording: boolean) => {
    setVoiceRecording(recording);
  }, []);

  const sendGif = useCallback(async (gif: ChatGifItem) => {
    setEmojiPickerVisible(false);
    try {
      const file = await downloadGifToCache(gif);
      await sendPickedFile(file);
    } catch (cause) {
      if (mountedRef.current) {
        Alert.alert('Не удалось отправить GIF', formatApiError(cause, 'Повторите попытку'));
      }
    }
  }, [sendPickedFile]);

  const runSearch = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query || searching) return;
    setSearching(true);
    setSearchCompleted(false);
    if (offlineMode) {
      const normalizedQuery = query.toLocaleLowerCase('ru-RU');
      const corpus = accumulatedMessagesRef.current.length
        ? accumulatedMessagesRef.current
        : messages;
      setSearchResults(corpus.filter((message) => (
        String(message.body_text || '').toLocaleLowerCase('ru-RU').includes(normalizedQuery)
      )));
      setSearchCompleted(true);
      setSearching(false);
      return;
    }
    try {
      const results = await chatApi.searchMessages(conversationId, query);
      if (mountedRef.current) {
        setSearchResults(results);
        setSearchCompleted(true);
      }
    } catch (cause) {
      if (mountedRef.current) {
        Alert.alert('Не удалось выполнить поиск', formatApiError(cause, 'Повторите попытку'));
      }
    } finally {
      if (mountedRef.current) setSearching(false);
    }
  }, [conversationId, messages, offlineMode, searchQuery, searching]);

  const focusSearchResult = useCallback(async (message: ChatMessage) => {
    if (offlineMode && (
      messages.some((item) => item.id === message.id)
      || accumulatedMessagesRef.current.some((item) => item.id === message.id)
    )) {
      // Prefer showing from accumulated history when the current window lacks the hit.
      if (!messages.some((item) => item.id === message.id)) {
        setMessages(accumulatedMessagesRef.current);
      }
      setFocusAnchorId(message.id);
      setSearchOpen(false);
      setSearchResults([]);
      setSearchCompleted(false);
      return;
    }
    setSearching(true);
    try {
      const page = await chatApi.getThreadBootstrap(conversationId, {
        focusMessageId: message.id,
        limit: 80,
        lightweight: false,
      });
      if (!mountedRef.current) return;
      const normalized = mergeMessages([], page.items, user?.id);
      knownMessageIdsRef.current = new Set([
        ...knownMessageIdsRef.current,
        ...normalized.map((item) => item.id),
      ]);
      accumulatedMessagesRef.current = mergeNativeChatThreadHistory(
        accumulatedMessagesRef.current,
        normalized,
        user?.id,
      );
      historyMayHaveGapsRef.current = Boolean(
        historyMayHaveGapsRef.current || page.has_older || page.has_newer,
      );
      // Display window only — durable history stays in accumulatedMessagesRef.
      setMessages(normalized);
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
      if (mountedRef.current) {
        Alert.alert('Не удалось перейти к сообщению', formatApiError(cause, 'Повторите попытку'));
      }
    } finally {
      if (mountedRef.current) setSearching(false);
    }
  }, [conversationId, messages, offlineMode, user?.id]);

  const focusMessageById = useCallback(async (targetMessageId: string) => {
    const normalizedId = String(targetMessageId || '').trim();
    if (!normalizedId) return;
    if (messages.some((message) => message.id === normalizedId)) {
      setFocusAnchorId(normalizedId);
      return;
    }
    if (accumulatedMessagesRef.current.some((message) => message.id === normalizedId)) {
      setMessages(accumulatedMessagesRef.current);
      setFocusAnchorId(normalizedId);
      return;
    }
    await focusSearchResult({
      id: normalizedId,
      conversation_id: conversationId,
      sender_user_id: 0,
    });
  }, [conversationId, focusSearchResult, messages]);

  const jumpToBottom = useCallback(async () => {
    if (!hasNewer) {
      listRef.current?.scrollToOffset({ offset: 0, animated: !reduceMotion });
      nearBottomRef.current = true;
      setShowJumpToBottom(false);
      setNewMessageCount(0);
      markRead(findLatestIncomingMessage(messages, user?.id));
      return;
    }
    try {
      const page = await chatApi.getMessagesPage(conversationId, { limit: 80 });
      if (!mountedRef.current) return;
      const normalized = mergeMessages([], page.items, user?.id);
      knownMessageIdsRef.current = new Set([
        ...knownMessageIdsRef.current,
        ...normalized.map((item) => item.id),
      ]);
      accumulatedMessagesRef.current = mergeNativeChatThreadHistory(
        accumulatedMessagesRef.current,
        normalized,
        user?.id,
      );
      historyMayHaveGapsRef.current = Boolean(
        historyMayHaveGapsRef.current || page.has_older || page.has_newer,
      );
      setMessages(normalized);
      setHasOlder(page.has_older);
      setOlderCursor(page.older_cursor_message_id);
      setHasNewer(page.has_newer);
      setNewerCursor(page.newer_cursor_message_id);
      nearBottomRef.current = !page.has_newer;
      setShowJumpToBottom(page.has_newer);
      setNewMessageCount(0);
      markRead(findLatestIncomingMessage(normalized, user?.id));
    } catch (cause) {
      if (mountedRef.current) {
        Alert.alert('Не удалось перейти к новым сообщениям', formatApiError(cause, 'Повторите попытку'));
      }
    }
  }, [conversationId, hasNewer, markRead, messages, reduceMotion, user?.id]);

  const openForward = useCallback(async (message: ChatMessage | ChatMessage[]) => {
    if (forwardInFlightRef.current) return;
    try {
      const conversations = await chatApi.getConversations();
      if (!mountedRef.current) return;
      setForwardConversations(conversations);
      setForwardProgress(null);
      setForwardError('');
      const queue = Array.isArray(message) ? message : [message];
      setForwardSource(queue[0] || null);
      setForwardQueue(queue);
    } catch (cause) {
      if (mountedRef.current) {
        Alert.alert('Не удалось загрузить диалоги', formatApiError(cause, 'Повторите попытку'));
      }
    }
  }, []);

  const forwardToConversation = useCallback(async (target: ChatConversationSummary) => {
    const queue = forwardQueue.length ? forwardQueue : (forwardSource ? [forwardSource] : []);
    if (!queue.length || forwardInFlightRef.current || forwarding) return;
    if (forwardProgress && forwardProgress.target.id !== target.id) return;
    forwardInFlightRef.current = true;
    setForwarding(true);
    setForwardError('');
    const completedBefore = forwardProgress?.completed || 0;
    const total = forwardProgress?.total || queue.length;
    let completed = 0;
    try {
      for (const item of queue) {
        const forwarded = await chatApi.forwardMessage(target.id, item.id);
        if (!mountedRef.current) return;
        completed += 1;
        // Commit each ACK before starting the next request; never replay these items.
        setForwardQueue(queue.slice(completed));
        setForwardProgress({ target, completed: completedBefore + completed, total });
        setSelectedMessageIds((current) => current.filter((id) => id !== item.id));
        if (target.id === conversationId) {
          requestBottomAnchor('own-send');
          setMessages((current) => mergeMessages(current, forwarded, user?.id));
        }
      }
      setForwardSource(null);
      setForwardQueue([]);
      setForwardProgress(null);
      setSelectedMessageIds([]);
      Alert.alert(
        total > 1 ? 'Сообщения пересланы' : 'Сообщение переслано',
        `Диалог: ${target.title || 'Без названия'}`,
      );
    } catch {
      if (mountedRef.current) {
        setForwardQueue(queue.slice(completed));
        setForwardSource(queue[completed] || null);
        setForwardProgress({ target, completed: completedBefore + completed, total });
        setForwardError('Не получено подтверждение следующего сообщения. Проверьте диалог перед повтором: оно могло быть доставлено. Уже подтверждённые сообщения повторно не отправятся.');
      }
    } finally {
      forwardInFlightRef.current = false;
      if (mountedRef.current) setForwarding(false);
    }
  }, [conversationId, forwardQueue, forwardSource, forwardProgress, forwarding, requestBottomAnchor, user?.id]);

  const openConversationInfo = useCallback(() => {
    setInfoVisible(true);
    if (offlineMode) return;
    void chatApi.getConversation(conversationId).then((details) => {
      if (!mountedRef.current) return;
      setConversation(details);
      setTitle(details.title || 'Chat');
    }).catch(() => undefined);
  }, [conversationId, offlineMode]);

  const updateConversationSetting = useCallback(async (
    key: 'is_muted' | 'is_pinned' | 'is_archived',
    value: boolean,
  ) => {
    if (conversationBusy) return;
    setConversationBusy(true);
    try {
      const updated = await chatApi.updateConversationSettings(conversationId, { [key]: value });
      if (mountedRef.current) setConversation(updated);
    } catch (cause) {
      if (mountedRef.current) {
        Alert.alert('Не удалось изменить настройки чата', formatApiError(cause, 'Повторите попытку'));
      }
    } finally {
      if (mountedRef.current) setConversationBusy(false);
    }
  }, [conversationBusy, conversationId]);

  const renameGroup = useCallback(async (nextTitle: string) => {
    if (!nextTitle.trim() || conversationBusy) return;
    setConversationBusy(true);
    try {
      const updated = isAiConversation(conversation)
        ? await chatApi.renameAiConversation(conversationId, nextTitle.trim())
        : await chatApi.updateGroupProfile(conversationId, nextTitle.trim());
      if (!mountedRef.current) return;
      setConversation(updated);
      setTitle(updated.title || nextTitle.trim());
      setRenameVisible(false);
    } catch (cause) {
      if (mountedRef.current) {
        Alert.alert('Не удалось изменить название', formatApiError(cause, 'Повторите попытку'));
      }
    } finally {
      if (mountedRef.current) setConversationBusy(false);
    }
  }, [conversation, conversationBusy, conversationId]);

  const resetAiContext = useCallback(() => {
    Alert.alert(
      'Сбросить контекст?',
      'Старые сообщения останутся видимыми, но помощник перестанет учитывать их в новых ответах.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Сбросить',
          onPress: () => {
            void (async () => {
              setConversationBusy(true);
              try {
                await chatApi.resetAiConversationContext(conversationId);
                if (mountedRef.current) {
                  setInfoVisible(false);
                  Alert.alert('Контекст сброшен', 'Новые ответы не будут учитывать предыдущую историю.');
                }
              } catch (cause) {
                if (mountedRef.current) {
                  Alert.alert('Не удалось сбросить контекст', formatApiError(cause, 'Повторите попытку'));
                }
              } finally {
                if (mountedRef.current) setConversationBusy(false);
              }
            })();
          },
        },
      ],
    );
  }, [conversationId]);

  const deleteAiConversation = useCallback(() => {
    Alert.alert(
      'Удалить AI-чат?',
      'Диалог будет удалён без возможности восстановления.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setConversationBusy(true);
              try {
                await chatApi.deleteAiConversation(conversationId);
                if (mountedRef.current) {
                  setInfoVisible(false);
                  router.back();
                }
              } catch (cause) {
                if (mountedRef.current) {
                  Alert.alert('Не удалось удалить чат', formatApiError(cause, 'Повторите попытку'));
                }
              } finally {
                if (mountedRef.current) setConversationBusy(false);
              }
            })();
          },
        },
      ],
    );
  }, [conversationId]);

  const openMemberPicker = useCallback(async () => {
    setConversationBusy(true);
    try {
      const users = await chatApi.getChatUsers();
      if (!mountedRef.current) return;
      setChatUsers(users);
      setMemberPickerVisible(true);
    } catch (cause) {
      if (mountedRef.current) {
        Alert.alert('Не удалось загрузить пользователей', formatApiError(cause, 'Повторите попытку'));
      }
    } finally {
      if (mountedRef.current) setConversationBusy(false);
    }
  }, []);

  const addMembers = useCallback(async (userIds: number[]) => {
    if (!userIds.length || conversationBusy) return;
    setConversationBusy(true);
    try {
      const updated = await chatApi.addGroupMembers(conversationId, userIds);
      if (!mountedRef.current) return;
      setConversation(updated);
      setMemberPickerVisible(false);
    } catch (cause) {
      if (mountedRef.current) {
        Alert.alert('Не удалось добавить участников', formatApiError(cause, 'Повторите попытку'));
      }
    } finally {
      if (mountedRef.current) setConversationBusy(false);
    }
  }, [conversationBusy, conversationId]);

  const updateMember = useCallback(async (
    member: ChatMember,
    action: 'promote' | 'demote' | 'remove' | 'transfer',
  ) => {
    if (conversationBusy) return;
    setConversationBusy(true);
    try {
      const updated = action === 'remove'
        ? await chatApi.removeGroupMember(conversationId, member.user.id)
        : action === 'transfer'
          ? await chatApi.transferGroupOwnership(conversationId, member.user.id)
          : await chatApi.updateGroupMemberRole(
            conversationId,
            member.user.id,
            action === 'promote' ? 'moderator' : 'member',
          );
      if (mountedRef.current) setConversation(updated);
    } catch (cause) {
      if (mountedRef.current) {
        Alert.alert('Не удалось изменить участника', formatApiError(cause, 'Повторите попытку'));
      }
    } finally {
      if (mountedRef.current) setConversationBusy(false);
    }
  }, [conversationBusy, conversationId]);

  const openPersonProfile = useCallback((user: ChatUserSummary) => {
    const members = conversation?.members || conversation?.member_preview || [];
    const existing = members.find((member) => member.user.id === user.id);
    if (existing) {
      setProfileMember(existing);
      return;
    }
    if (conversation?.direct_peer?.id === user.id) {
      setProfileMember({ user: conversation.direct_peer, member_role: 'member' });
      return;
    }
    setProfileMember({ user, member_role: 'member' });
  }, [conversation]);

  const openMemberActions = useCallback((member: ChatMember) => {
    const viewerRole = conversation?.viewer_member_role;
    const buttons: Array<{
      text: string;
      style?: 'default' | 'cancel' | 'destructive';
      onPress?: () => void;
    }> = [];
    if (member.member_role === 'moderator') {
      buttons.push({ text: 'Сделать участником', onPress: () => void updateMember(member, 'demote') });
    } else {
      buttons.push({ text: 'Сделать администратором', onPress: () => void updateMember(member, 'promote') });
    }
    if (viewerRole === 'owner') {
      buttons.push({ text: 'Передать права владельца', onPress: () => void updateMember(member, 'transfer') });
    }
    buttons.push({ text: 'Удалить из группы', style: 'destructive', onPress: () => void updateMember(member, 'remove') });
    buttons.push({ text: 'Отмена', style: 'cancel' });
    Alert.alert(member.user.full_name || member.user.username, 'Управление участником', buttons);
  }, [conversation?.viewer_member_role, updateMember]);

  const requestLeaveGroup = useCallback(() => {
    Alert.alert('Покинуть группу?', 'Вы перестанете получать новые сообщения этой группы.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Покинуть',
        style: 'destructive',
        onPress: () => {
          setConversationBusy(true);
          void chatApi.leaveGroup(conversationId).then(() => {
            if (!mountedRef.current) return;
            setInfoVisible(false);
            router.replace('/chat');
          }).catch((cause) => {
            if (mountedRef.current) Alert.alert('Не удалось покинуть группу', formatApiError(cause, 'Повторите попытку'));
          }).finally(() => {
            if (mountedRef.current) setConversationBusy(false);
          });
        },
      },
    ]);
  }, [conversationId]);

  const openTask = useCallback((taskId: string) => {
    router.push({ pathname: '/tasks/[taskId]', params: { taskId } });
  }, []);

  const loadShareableTasks = useCallback(async (query = '') => {
    setTaskPickerLoading(true);
    try {
      const tasks = await chatApi.getShareableTasks(conversationId, query);
      if (mountedRef.current) setShareableTasks(tasks);
    } catch (cause) {
      if (mountedRef.current) Alert.alert('Не удалось загрузить задачи', formatApiError(cause, 'Повторите попытку'));
    } finally {
      if (mountedRef.current) setTaskPickerLoading(false);
    }
  }, [conversationId]);

  const openTaskPicker = useCallback(() => {
    setAttachmentPickerVisible(false);
    setTaskPickerVisible(true);
    void loadShareableTasks();
  }, [loadShareableTasks]);

  const shareTask = useCallback(async (task: ChatTaskPreview) => {
    if (composerBusy) return;
    setComposerBusy(true);
    try {
      const replyToMessageId = composerMode?.type === 'reply' ? composerMode.message.id : undefined;
      const saved = await chatApi.shareTask(conversationId, task.id, replyToMessageId);
      if (!mountedRef.current) return;
      requestBottomAnchor('own-send');
      setMessages((current) => mergeMessages(current, saved, user?.id));
      setTaskPickerVisible(false);
      setComposerMode(null);
    } catch (cause) {
      if (mountedRef.current) Alert.alert('Не удалось отправить задачу', formatApiError(cause, 'Повторите попытку'));
    } finally {
      if (mountedRef.current) setComposerBusy(false);
    }
  }, [composerBusy, composerMode, conversationId, requestBottomAnchor, user?.id]);

  const openStickerPicker = useCallback(async () => {
    setAttachmentPickerVisible(false);
    setEmojiPickerVisible(false);
    setStickerPickerVisible(true);
    setStickerPickerLoading(true);
    try {
      const [packs, recent] = await Promise.all([
        chatApi.getStickerPacks(),
        user?.id ? getRecentStickerIds(user.id) : Promise.resolve([]),
      ]);
      if (mountedRef.current) {
        setStickerPacks(packs);
        setRecentStickerIds(recent);
      }
    } catch (cause) {
      if (mountedRef.current) Alert.alert('Не удалось загрузить стикеры', formatApiError(cause, 'Повторите попытку'));
    } finally {
      if (mountedRef.current) setStickerPickerLoading(false);
    }
  }, [user?.id]);

  const importStickerPack = useCallback(async (source: string) => {
    setStickerImporting(true);
    try {
      const packs = await chatApi.importStickerPack(source);
      if (mountedRef.current) setStickerPacks(packs);
    } catch (cause) {
      if (mountedRef.current) Alert.alert('Не удалось добавить набор', formatApiError(cause, 'Проверьте ссылку и повторите'));
    } finally {
      if (mountedRef.current) setStickerImporting(false);
    }
  }, []);

  const removeStickerPack = useCallback((pack: ChatStickerPack) => {
    Alert.alert(
      'Удалить набор?',
      `Набор «${pack.title}» будет убран из вашего списка.`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => {
            void chatApi.removeStickerPack(pack.id)
              .then(() => chatApi.getStickerPacks())
              .then((packs) => {
                if (mountedRef.current) setStickerPacks(packs);
              })
              .catch((cause) => {
                if (mountedRef.current) {
                  Alert.alert('Не удалось удалить набор', formatApiError(cause, 'Повторите попытку'));
                }
              });
          },
        },
      ],
    );
  }, []);

  const sendSticker = useCallback(async (sticker: ChatSticker) => {
    if (composerBusy) return;
    setStickerPickerVisible(false);
    setComposerBusy(true);
    try {
      const replyToMessageId = composerMode?.type === 'reply' ? composerMode.message.id : undefined;
      const saved = await chatApi.sendSticker(conversationId, sticker.id, replyToMessageId);
      if (!mountedRef.current) return;
      if (user?.id) {
        const recent = await rememberRecentSticker(user.id, sticker.id);
        if (mountedRef.current) setRecentStickerIds(recent);
      }
      requestBottomAnchor('own-send');
      setMessages((current) => mergeMessages(current, {
        ...saved,
        is_own: true,
        sender_user_id: saved.sender_user_id || Number(user?.id || 0),
      }, user?.id));
      setComposerMode(null);
    } catch (cause) {
      if (mountedRef.current) Alert.alert('Не удалось отправить стикер', formatApiError(cause, 'Повторите попытку'));
    } finally {
      if (mountedRef.current) setComposerBusy(false);
    }
  }, [composerBusy, composerMode, conversationId, requestBottomAnchor, user?.id]);

  const copyMessageText = useCallback((message: ChatMessage) => {
    void Clipboard.setStringAsync(message.body_text || '').then(() => {
      if (mountedRef.current) Alert.alert('Скопировано', 'Текст сообщения скопирован.');
    });
  }, []);

  const copyMessageLink = useCallback((message: ChatMessage) => {
    const link = `${HUB_WEB_ORIGIN}/chat?conversation=${encodeURIComponent(conversationId)}&message=${encodeURIComponent(message.id)}`;
    void Clipboard.setStringAsync(link).then(() => {
      if (mountedRef.current) Alert.alert('Ссылка скопирована', 'Можно отправить её другому участнику HUB-IT.');
    });
  }, [conversationId]);

  const prepareReport = useCallback((message: ChatMessage) => {
    const payload = [
      `Диалог: ${conversationId}`,
      `Сообщение: ${message.id}`,
      `Автор: ${message.sender?.full_name || message.sender?.username || message.sender_user_id}`,
      `Текст: ${message.body_text || '(без текста)'}`,
    ].join('\n');
    void Clipboard.setStringAsync(payload).then(() => {
      if (mountedRef.current) Alert.alert('Данные жалобы скопированы', 'Передайте их администратору HUB-IT.');
    });
  }, [conversationId]);

  const showMessageReads = useCallback(async (message: ChatMessage) => {
    try {
      const reads = await chatApi.getMessageReads(message.id);
      if (!mountedRef.current) return;
      Alert.alert(
        'Кто прочитал',
        reads.length
          ? reads.map((item) => `${item.user.full_name || item.user.username} · ${new Date(item.read_at).toLocaleString('ru-RU')}`).join('\n')
          : 'Пока никто не прочитал сообщение.',
      );
    } catch (cause) {
      if (mountedRef.current) Alert.alert('Не удалось загрузить прочтения', formatApiError(cause, 'Повторите попытку'));
    }
  }, []);

  const togglePinnedMessage = useCallback((message: ChatMessage) => {
    const userId = Number(user?.id || 0);
    if (!userId) return;
    const next = pinnedMessageId === message.id ? null : message.id;
    setPinnedMessageId(next);
    void setPinnedChatMessageId(userId, conversationId, next);
    void chatApi.setPinnedMessage(conversationId, next).then((updated) => {
      if (!mountedRef.current || updated.pinned_message_id === undefined) return;
      serverPinKnownRef.current = true;
      setPinnedMessageId(updated.pinned_message_id);
      void setPinnedChatMessageId(userId, conversationId, updated.pinned_message_id);
    }).catch(() => undefined);
  }, [conversationId, pinnedMessageId, user?.id]);

  const unpinMessage = useCallback(() => {
    const userId = Number(user?.id || 0);
    const previous = pinnedMessageId;
    if (!userId || !previous) return;
    setPinnedMessageId(null);
    void setPinnedChatMessageId(userId, conversationId, null);
    void chatApi.setPinnedMessage(conversationId, null).then((updated) => {
      if (!mountedRef.current) return;
      serverPinKnownRef.current = true;
      const next = updated.pinned_message_id || null;
      setPinnedMessageId(next);
      void setPinnedChatMessageId(userId, conversationId, next);
    }).catch(() => {
      if (!mountedRef.current) return;
      setPinnedMessageId(previous);
      void setPinnedChatMessageId(userId, conversationId, previous);
    });
  }, [conversationId, pinnedMessageId, user?.id]);

  const runAiAction = useCallback(async (actionId: string, action: 'confirm' | 'cancel') => {
    setMessages((current) => current.map((message) => {
      const card = message.action_card as { id?: string } | null | undefined;
      return card?.id === actionId
        ? {
          ...message,
          action_card: {
            ...message.action_card,
            status: action === 'confirm' ? 'executing' : 'cancelled',
          },
        }
        : message;
    }));
    try {
      if (action === 'confirm') await chatApi.confirmAiAction(actionId);
      else await chatApi.cancelAiAction(actionId);
    } catch (cause) {
      if (mountedRef.current) {
        Alert.alert('Не удалось выполнить действие AI', formatApiError(cause, 'Повторите попытку'));
        void loadInitial();
      }
    }
  }, [loadInitial]);

  const runAttachmentAction = useCallback(async (
    messageIdValue: string,
    attachment: ChatAttachment,
    action: 'open' | 'share' | 'save',
  ) => {
    if (attachmentTransfersRef.current[attachment.id]?.status === 'active') return;
    const controller = action === 'save' ? null : new AbortController();
    if (controller) {
      downloadControllersRef.current.get(attachment.id)?.abort();
      downloadControllersRef.current.set(attachment.id, controller);
    }
    failedAttachmentActionsRef.current.set(attachment.id, { messageId: messageIdValue, attachment, action });
    setAttachmentTransfers((current) => ({
      ...current,
      [attachment.id]: {
        action,
        progress: action === 'save' ? null : 0,
        status: 'active',
        cancellable: Boolean(controller),
      },
    }));
    let completed = false;
    try {
      if (action === 'save') {
        await chatApi.saveAttachmentToMyFiles(messageIdValue, attachment.id);
        if (mountedRef.current) Alert.alert('Сохранено', 'Вложение добавлено в «Мои файлы».');
        completed = true;
        return;
      }
      const file = await downloadChatAttachment(attachment, {
        signal: controller?.signal,
        onProgress: (progress) => {
          if (!mountedRef.current || downloadControllersRef.current.get(attachment.id) !== controller) return;
          setAttachmentTransfers((current) => ({
            ...current,
            [attachment.id]: {
              action,
              progress: progress.progress,
              status: 'active',
              cancellable: true,
            },
          }));
        },
      });
      if (!mountedRef.current || downloadControllersRef.current.get(attachment.id) !== controller) return;
      if (action === 'share') {
        await shareNativeFile(file, attachment.file_name || 'hubit-file', attachment.mime_type);
      } else {
        await openNativeFile(file, attachment.mime_type);
      }
      completed = true;
    } catch (cause) {
      if (!mountedRef.current) return;
      if (controller && downloadControllersRef.current.get(attachment.id) !== controller) return;
      const cancelled = isAttachmentTransferAbort(cause, controller?.signal);
      setAttachmentTransfers((current) => ({
        ...current,
        [attachment.id]: {
          action,
          progress: current[attachment.id]?.progress ?? 0,
          status: cancelled ? 'cancelled' : 'failed',
          cancellable: false,
        },
      }));
    } finally {
      if (controller && downloadControllersRef.current.get(attachment.id) === controller) {
        downloadControllersRef.current.delete(attachment.id);
      }
      if (completed && mountedRef.current) {
        failedAttachmentActionsRef.current.delete(attachment.id);
        setAttachmentTransfers((current) => {
          if (!current[attachment.id]) return current;
          const next = { ...current };
          delete next[attachment.id];
          return next;
        });
      }
    }
  }, []);

  const cancelAttachmentTransfer = useCallback((message: ChatMessage, attachment: ChatAttachment) => {
    if (message.local_status === 'sending') {
      cancelPendingAttachmentUpload(message);
      return;
    }
    downloadControllersRef.current.get(attachment.id)?.abort();
  }, [cancelPendingAttachmentUpload]);

  const retryAttachmentTransfer = useCallback((message: ChatMessage, attachment: ChatAttachment) => {
    if (message.local_status === 'failed' || message.local_status === 'cancelled') {
      retryPendingAttachmentUpload(message);
      return;
    }
    const failedAction = failedAttachmentActionsRef.current.get(attachment.id);
    if (!failedAction) return;
    void runAttachmentAction(failedAction.messageId, failedAction.attachment, failedAction.action);
  }, [retryPendingAttachmentUpload, runAttachmentAction]);

  const loadMoreMediaManifest = useCallback(async (restart = false) => {
    if (offlineMode) {
      mediaManifestHasMoreRef.current = false;
      return;
    }
    if (mediaManifestLoadingRef.current) return;
    if (!restart && !mediaManifestHasMoreRef.current) return;
    const generation = mediaManifestGenerationRef.current;
    mediaManifestLoadingRef.current = true;
    try {
      const page = await chatApi.getConversationAttachments(conversationId, {
        kind: mediaManifestKindRef.current,
        limit: 48,
        beforeAttachmentId: restart ? undefined : mediaManifestCursorRef.current || undefined,
      });
      if (!mountedRef.current || generation !== mediaManifestGenerationRef.current) return;
      const nextItems = page.items.map((entry) => mediaItemFromConversationAttachment(entry, conversationId));
      setMediaViewerItems((current) => mergeChatMediaItems(current || [], nextItems));
      mediaManifestHasMoreRef.current = page.has_more;
      mediaManifestCursorRef.current = page.next_before_attachment_id;
    } catch {
      if (generation === mediaManifestGenerationRef.current) mediaManifestHasMoreRef.current = false;
    } finally {
      if (generation === mediaManifestGenerationRef.current) mediaManifestLoadingRef.current = false;
    }
  }, [conversationId, offlineMode]);

  const openMediaViewer = useCallback((
    nextItem: ChatMediaItem,
    seedItems: ChatMediaItem[] = [],
  ) => {
    const imageKind = isImageChatAttachment(nextItem.attachment);
    mediaManifestGenerationRef.current += 1;
    mediaManifestLoadingRef.current = false;
    mediaManifestHasMoreRef.current = !offlineMode;
    mediaManifestCursorRef.current = null;
    mediaManifestKindRef.current = imageKind ? 'image' : 'video';
    const localCorpus = accumulatedMessagesRef.current.length
      ? accumulatedMessagesRef.current
      : messagesRef.current;
    const localItems = collectThreadMedia(localCorpus).filter((entry) => (
      isImageChatAttachment(entry.attachment) === imageKind
    ));
    setMediaViewerItems(mergeChatMediaItems(seedItems, localItems, [nextItem]));
    setMediaViewer(nextItem);
    if (!offlineMode) void loadMoreMediaManifest(true);
  }, [loadMoreMediaManifest, offlineMode]);

  const closeMediaViewer = useCallback(() => {
    mediaManifestGenerationRef.current += 1;
    mediaManifestLoadingRef.current = false;
    mediaManifestHasMoreRef.current = false;
    mediaManifestCursorRef.current = null;
    setMediaViewer(null);
    setMediaViewerItems(null);
  }, []);

  const openAttachmentActions = useCallback((message: ChatMessage, attachment: ChatAttachment) => {
    if (selectedMessageIds.length) {
      setSelectedMessageIds((current) => toggleSelectedMessageId(current, message.id));
      return;
    }
    if (isMediaChatAttachment(attachment)) {
      openMediaViewer({ message, attachment });
      return;
    }
    setAttachmentActionTarget({ message, attachment });
  }, [openMediaViewer, selectedMessageIds.length]);

  const openAttachment = useCallback((message: ChatMessage, attachment: ChatAttachment) => {
    if (selectedMessageIds.length) {
      setSelectedMessageIds((current) => toggleSelectedMessageId(current, message.id));
      return;
    }
    if (isMediaChatAttachment(attachment)) {
      openMediaViewer({ message, attachment });
      return;
    }
    setAttachmentActionTarget({ message, attachment });
  }, [openMediaViewer, selectedMessageIds.length]);

  const selectedMessages = useMemo(
    () => selectedMessagesFromIds(messages, selectedMessageIds),
    [messages, selectedMessageIds],
  );

  const clearSelection = useCallback(() => setSelectedMessageIds([]), []);

  const startSelection = useCallback((message: ChatMessage) => {
    if (!canSelectChatMessage(message)) return;
    void hapticSelection();
    setActionMessage(null);
    setSelectedMessageIds((current) => (
      current.length ? toggleSelectedMessageId(current, message.id) : startMessageSelection(message.id)
    ));
  }, []);

  const toggleSelection = useCallback((message: ChatMessage) => {
    if (!canSelectChatMessage(message)) return;
    setSelectedMessageIds((current) => toggleSelectedMessageId(current, message.id));
  }, []);

  const copySelected = useCallback(() => {
    const textValue = getSelectedMessagesCopyText(selectedMessages);
    if (!textValue) {
      Alert.alert('Нечего копировать', 'В выбранных сообщениях нет текста.');
      return;
    }
    void Clipboard.setStringAsync(textValue).then(() => {
      if (mountedRef.current) {
        Alert.alert('Скопировано', 'Текст выбранных сообщений скопирован.');
        clearSelection();
      }
    });
  }, [clearSelection, selectedMessages]);

  const deleteSelected = useCallback(() => {
    const deletable = selectedMessages.filter((message) => canSelectChatMessage(message));
    if (!canDeleteSelectedMessages(deletable, {
      conversationKind: conversation?.kind,
      currentUserId: user?.id,
    })) {
      Alert.alert('Нельзя удалить', 'Среди выбранных есть сообщения, которые нельзя удалить.');
      return;
    }
    const confirmLabel = deletable.length === 1
      ? 'Удалить сообщение?'
      : `Удалить ${deletable.length} сообщений?`;
    Alert.alert(
      confirmLabel,
      'Текст и вложения будут скрыты у всех участников диалога.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => {
            void Promise.all(deletable.map((message) => chatApi.deleteMessage(conversationId, message.id)))
              .then((deleted) => {
                if (!mountedRef.current) return;
                setMessages((current) => mergeMessages(current, deleted, user?.id));
                clearSelection();
              })
              .catch((cause) => {
                if (mountedRef.current) {
                  Alert.alert('Не удалось удалить сообщение', formatApiError(cause, 'Повторите попытку'));
                }
              });
          },
        },
      ],
    );
  }, [clearSelection, conversation?.kind, conversationId, selectedMessages, user?.id]);

  const closeThreadLayer = useCallback((layer: ReturnType<typeof nextChatThreadBackAction>) => {
    if (layer === 'viewer') {
      closeMediaViewer();
      return;
    }
    if (layer === 'voice') {
      cancelVoiceRef.current?.();
      return;
    }
    if (layer === 'sheet') {
      if (attachmentActionTarget) {
        setAttachmentActionTarget(null);
        return;
      }
      setActionMessage(null);
      return;
    }
    if (layer === 'forward') {
      if (forwardInFlightRef.current) return;
      setForwardProgress(null);
      setForwardError('');
      setForwardSource(null);
      setForwardQueue([]);
      return;
    }
    if (layer === 'search') {
      setSearchOpen(false);
      setSearchResults([]);
      setSearchCompleted(false);
      return;
    }
    if (layer === 'selection') {
      clearSelection();
      return;
    }
    if (layer === 'picker') {
      if (attachmentDraftFiles.length) {
        attachmentDraftClientMessageIdRef.current = '';
        setAttachmentDraftFiles([]);
        setAttachmentDraftError('');
        return;
      }
      if (profileMember) {
        setProfileMember(null);
        return;
      }
      setAttachmentPickerVisible(false);
      setEmojiPickerVisible(false);
      setInfoVisible(false);
      setRenameVisible(false);
      setMemberPickerVisible(false);
      setTaskPickerVisible(false);
      setStickerPickerVisible(false);
      setImageEditorFile(null);
      return;
    }
    leaveThread();
  }, [attachmentActionTarget, attachmentDraftFiles.length, clearSelection, closeMediaViewer, leaveThread, profileMember]);

  const handleThreadBack = useCallback(() => {
    const pickerOpen = attachmentPickerVisible
      || attachmentDraftFiles.length > 0
      || emojiPickerVisible
      || infoVisible
      || renameVisible
      || memberPickerVisible
      || taskPickerVisible
      || stickerPickerVisible
      || Boolean(imageEditorFile)
      || Boolean(profileMember);
    const action = nextChatThreadBackAction({
      viewer: Boolean(mediaViewer),
      voice: voiceRecording,
      sheet: Boolean(actionMessage || attachmentActionTarget),
      forward: Boolean(forwardSource),
      search: searchOpen,
      selection: selectedMessageIds.length > 0,
      picker: pickerOpen,
    });
    closeThreadLayer(action);
    return true;
  }, [
    actionMessage,
    attachmentActionTarget,
    attachmentPickerVisible,
    attachmentDraftFiles.length,
    closeThreadLayer,
    emojiPickerVisible,
    forwardSource,
    infoVisible,
    mediaViewer,
    memberPickerVisible,
    renameVisible,
    searchOpen,
    selectedMessageIds.length,
    imageEditorFile,
    stickerPickerVisible,
    taskPickerVisible,
    profileMember,
    voiceRecording,
  ]);

  useAndroidBackHandler(handleThreadBack);

  const showSenderAvatars = shouldShowSenderAvatarsForKind(conversation?.kind);
  const rowDecorations = useMemo(
    () => buildChatThreadRowDecorations(messages, unreadBoundaryId),
    [messages, unreadBoundaryId],
  );
  const listEmptyMessage = historyUnavailableOffline
    ? 'Переписка не сохранена на устройстве'
    : 'Сообщений пока нет';
  const listEmptyComponent = useCallback(
    () => <ChatEmptyState message={listEmptyMessage} />,
    [listEmptyMessage],
  );
  const selectedMessageIdsRef = useRef(selectedMessageIds);
  selectedMessageIdsRef.current = selectedMessageIds;
  const highlightedMessageIdRef = useRef(highlightedMessageId);
  highlightedMessageIdRef.current = highlightedMessageId;
  const messageActionsRef = useRef({
    discardPendingMessage,
    canWrite,
    offlineMode,
    cancelAttachmentTransfer,
    conversationKind: conversation?.kind,
    currentUserId: user?.id,
    showSenderAvatars,
    focusMessageById,
    openAttachment,
    openAttachmentActions,
    openForward,
    openPersonProfile,
    openTask,
    runAiAction,
    retryAttachmentTransfer,
    retryPendingAttachmentUpload,
    sendBody,
    startReply,
    startSelection,
    toggleReaction,
    toggleSelection,
  });
  messageActionsRef.current = {
    discardPendingMessage,
    canWrite,
    offlineMode,
    cancelAttachmentTransfer,
    conversationKind: conversation?.kind,
    currentUserId: user?.id,
    showSenderAvatars,
    focusMessageById,
    openAttachment,
    openAttachmentActions,
    openForward,
    openPersonProfile,
    openTask,
    runAiAction,
    retryAttachmentTransfer,
    retryPendingAttachmentUpload,
    sendBody,
    startReply,
    startSelection,
    toggleReaction,
    toggleSelection,
  };

  const finishMessageEnterMotion = useCallback((motionKey: string) => {
    messageEnterMotionsRef.current.delete(motionKey);
  }, []);

  const renderMessage = useCallback(({ item, index }: ListRenderItemInfo<ChatMessage>) => {
    const decoration = rowDecorations[index];
    const actions = messageActionsRef.current;
    const selectedIds = selectedMessageIdsRef.current;
    const isOwn = Boolean(resolveChatMessageIsOwn(item, actions.currentUserId));
    const selecting = selectedIds.length > 0;
    const selected = selectedIds.includes(item.id);
    const openActions = item.kind === 'system' || item.local_status
      ? undefined
      : () => {
        setActionAnchor(null);
        setActionMessage(item);
      };
    const motionKey = chatMessageMotionKey(item);
    const enterKind = messageEnterMotionsRef.current.get(motionKey);
    const bubble = (
      <SwipeableChatBubble
        message={item}
        isOwn={isOwn}
        selected={selected}
        highlighted={item.id === highlightedMessageIdRef.current}
        swipeEnabled={!selecting}
        showSenderAvatars={actions.showSenderAvatars}
        groupPosition={decoration?.groupPosition || 'single'}
        onSwipeReply={actions.canWrite && !item.is_deleted && !item.local_status && item.kind !== 'system'
          ? () => actions.startReply(item)
          : undefined}
        onSwipeForward={!item.is_deleted && !item.local_status && item.kind !== 'system'
          ? () => void actions.openForward(item)
          : undefined}
        onPress={selecting ? () => actions.toggleSelection(item) : openActions}
        onActionsAnchor={(next) => setActionAnchor(next)}
        onLongPress={canSelectChatMessage(item) ? () => actions.startSelection(item) : openActions}
        onReactionPress={actions.canWrite && !item.local_status ? (emoji) => void actions.toggleReaction(item, emoji) : undefined}
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
        onDiscard={() => actions.discardPendingMessage(item)}
        onConfirmAction={(actionId) => void actions.runAiAction(actionId, 'confirm')}
        onCancelAction={(actionId) => void actions.runAiAction(actionId, 'cancel')}
        awaitingConnection={actions.offlineMode && item.local_status === 'failed'}
        onRetry={(item.local_status === 'failed' || item.local_status === 'cancelled')
          ? (actions.offlineMode
            ? undefined
            : item.attachments?.length
              ? () => actions.retryPendingAttachmentUpload(item)
              : () => void actions.sendBody(
                item.body_text || '',
                item.client_message_id || undefined,
                item.reply_preview || undefined,
                false,
              ))
          : undefined}
      />
    );
    return (
      <View>
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
  }, [finishMessageEnterMotion, reduceMotion, rowDecorations, styles]);

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
        markRead(findLatestIncomingMessage(messages, user?.id));
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
  const headerSubtitle = status === 'connected'
    ? typingLine
      || (conversation?.kind === 'group'
        ? `${conversation.member_count || conversation.members?.length || 0} участников · ${conversation.online_member_count || 0} онлайн`
        : formatPresenceSubtitle(conversation?.direct_peer?.presence))
    : undefined;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        testID="native-chat-thread-keyboard"
        style={styles.container}
        {...chatKeyboardAvoidingProps()}
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
            avatarUrl={conversation?.avatar_url}
            muted={conversation?.is_muted}
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
            <ActivityIndicator color={chatTokens.composerActionBg} />
            <Text style={styles.stateText}>Загружаем переписку…</Text>
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
          <View style={styles.listWrap}>
          <FlatList
            ref={listRef}
            testID="native-chat-message-list"
            data={messages}
            keyExtractor={chatMessageKey}
            inverted
            contentContainerStyle={styles.list}
            renderItem={renderMessage}
            extraData={`${selectedMessageIds.join('\0')}|${unreadBoundaryId}|${canWrite}|${highlightedMessageId || ''}|${JSON.stringify(attachmentTransfers)}`}
            onEndReached={handleMessageListEndReached}
            onEndReachedThreshold={0.35}
            onScroll={handleMessageListScroll}
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
          <EdgeBackSwipeOverlay
            enabled={!selectedMessageIds.length && !mediaViewer && !voiceRecording}
            onBack={handleThreadBack}
          />
          </View>
        )}

        {showJumpToBottom && !loading ? (
          <Pressable
            onPress={() => void jumpToBottom()}
            style={({ pressed }) => [styles.jumpButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={newMessageCount > 0
              ? `Перейти вниз. Новых сообщений: ${newMessageCount}`
              : 'Перейти к последним сообщениям'}
          >
            <Text style={styles.jumpIcon}>↓</Text>
            {newMessageCount > 0 ? <Text style={styles.jumpCount}>{newMessageCount}</Text> : null}
          </Pressable>
        ) : null}

        {canWrite ? (
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
              : () => setAttachmentPickerVisible(true)}
            onEmojiPress={composerMode?.type === 'edit' ? undefined : () => { Keyboard.dismiss(); setEmojiPickerVisible(true); }}
            canRecord={canWrite && composerMode?.type !== 'edit'}
            onSendVoiceFile={sendPickedFile}
            onRecordingChange={handleVoiceRecordingChange}
            cancelVoiceRef={cancelVoiceRef}
          />
          </>
        ) : (
          <View style={styles.readOnly} accessibilityLiveRegion="polite">
            <Text style={styles.readOnlyText}>У вас нет права отправлять сообщения</Text>
          </View>
        )}
        <MessageActionsSheet
          message={actionMessage}
          isOwn={Boolean(actionMessage && resolveChatMessageIsOwn(actionMessage, user?.id))}
          anchor={actionAnchor}
          onClose={() => {
            setActionMessage(null);
            setActionAnchor(null);
          }}
          onReply={startReply}
          onEdit={startEdit}
          onDelete={requestDelete}
          onForward={(message) => void openForward(message)}
          onReaction={(message, emoji) => void toggleReaction(message, emoji)}
          onCopyText={copyMessageText}
          onCopyLink={copyMessageLink}
          onPin={togglePinnedMessage}
          onReads={(message) => void showMessageReads(message)}
          onOpenTask={(message) => {
            if (message.task_preview?.id) openTask(message.task_preview.id);
          }}
          onReport={prepareReport}
          onSelect={startSelection}
          pinnedMessageId={pinnedMessageId}
        />
        <ChatAttachmentActionsSheet
          attachment={attachmentActionTarget?.attachment || null}
          onClose={() => setAttachmentActionTarget(null)}
          onOpen={() => {
            if (!attachmentActionTarget) return;
            void runAttachmentAction(
              attachmentActionTarget.message.id,
              attachmentActionTarget.attachment,
              'open',
            );
          }}
          onShare={() => {
            if (!attachmentActionTarget) return;
            void runAttachmentAction(
              attachmentActionTarget.message.id,
              attachmentActionTarget.attachment,
              'share',
            );
          }}
          onForward={() => {
            if (!attachmentActionTarget) return;
            void openForward(attachmentActionTarget.message);
          }}
          onSave={() => {
            if (!attachmentActionTarget) return;
            void runAttachmentAction(
              attachmentActionTarget.message.id,
              attachmentActionTarget.attachment,
              'save',
            );
          }}
        />
        <AttachmentPickerSheet
          visible={attachmentPickerVisible}
          onClose={() => setAttachmentPickerVisible(false)}
          onPick={(source) => void pickAndSendAttachment(source)}
          onTask={openTaskPicker}
          onSticker={() => void openStickerPicker()}
        />
        <ChatAttachmentDraftSheet
          visible={attachmentDraftFiles.length > 0}
          files={attachmentDraftFiles}
          caption={text}
          busy={composerBusy}
          error={attachmentDraftError}
          onChangeCaption={setText}
          onRemove={(index) => {
            setAttachmentDraftFiles((current) => {
              const next = current.filter((_, itemIndex) => itemIndex !== index);
              if (!next.length) {
                attachmentDraftClientMessageIdRef.current = '';
                setAttachmentDraftError('');
              }
              return next;
            });
          }}
          onCancel={() => {
            attachmentDraftClientMessageIdRef.current = '';
            setAttachmentDraftFiles([]);
            setAttachmentDraftError('');
          }}
          onSend={() => void sendAttachmentDraft()}
        />
        <ForwardMessageSheet
          message={forwardSource}
          count={forwardQueue.length || (forwardSource ? 1 : 0)}
          conversations={forwardProgress ? [forwardProgress.target] : forwardConversations}
          status={forwardProgress ? `Подтверждено: ${forwardProgress.completed} из ${forwardProgress.total}. Осталось: ${forwardProgress.total - forwardProgress.completed}.` : ''}
          error={forwardError}
          busy={forwarding}
          onClose={() => {
            if (forwardInFlightRef.current) return;
            setForwardProgress(null);
            setForwardError('');
            setForwardSource(null);
            setForwardQueue([]);
          }}
          onForward={(conversation) => void forwardToConversation(conversation)}
        />
        <ChatMediaViewer
          item={mediaViewer}
          items={viewerMediaItems}
          onChange={setMediaViewer}
          onClose={closeMediaViewer}
          onRequestMore={() => void loadMoreMediaManifest()}
          onOpen={() => {
            if (!mediaViewer) return;
            void runAttachmentAction(mediaViewer.message.id, mediaViewer.attachment, 'open');
          }}
          onShare={() => {
            if (!mediaViewer) return;
            void runAttachmentAction(mediaViewer.message.id, mediaViewer.attachment, 'share');
          }}
          onSave={() => {
            if (!mediaViewer) return;
            void runAttachmentAction(mediaViewer.message.id, mediaViewer.attachment, 'save');
          }}
          onForward={() => {
            if (!mediaViewer) return;
            const message = mediaViewer.message;
            closeMediaViewer();
            void openForward(message);
          }}
        />
        <ChatConversationInfoSheet
          visible={infoVisible}
          conversation={conversation}
          currentUserId={user?.id}
          busy={conversationBusy}
          onClose={() => setInfoVisible(false)}
          onToggleSetting={(key, value) => void updateConversationSetting(key, value)}
          onRename={() => {
            setInfoVisible(false);
            setRenameVisible(true);
          }}
          onResetAiContext={isAiConversation(conversation) ? resetAiContext : undefined}
          onDeleteAi={isAiConversation(conversation) ? deleteAiConversation : undefined}
          aiBot={resolveAiBotForConversation(aiBots, conversation?.id)}
          onAddMembers={() => {
            setInfoVisible(false);
            void openMemberPicker();
          }}
          onMemberPress={(member) => openPersonProfile(member.user)}
          onMemberManage={openMemberActions}
          onLeave={requestLeaveGroup}
          onOpenAttachment={(attachment, galleryItems) => {
            const nextItems = (galleryItems.length ? galleryItems : [attachment])
              .map((item) => mediaItemFromConversationAttachment(item, conversationId));
            setInfoVisible(false);
            openMediaViewer(mediaItemFromConversationAttachment(attachment, conversationId), nextItems);
          }}
        />
        <ChatParticipantProfileSheet
          visible={Boolean(profileMember)}
          member={profileMember}
          isGroup={conversation?.kind === 'group' || conversation?.kind === 'task'}
          onClose={() => setProfileMember(null)}
        />
        <ChatRenameSheet
          visible={renameVisible}
          initialTitle={conversation?.title || title}
          busy={conversationBusy}
          heading={isAiConversation(conversation) ? 'Название диалога' : 'Название группы'}
          inputLabel={isAiConversation(conversation) ? 'Новое название диалога' : 'Новое название группы'}
          onClose={() => setRenameVisible(false)}
          onSave={(nextTitle) => void renameGroup(nextTitle)}
        />
        <ChatMemberPickerSheet
          visible={memberPickerVisible}
          users={chatUsers}
          excludedUserIds={(conversation?.members || []).map((member) => member.user.id)}
          busy={conversationBusy}
          onClose={() => setMemberPickerVisible(false)}
          onAdd={(userIds) => void addMembers(userIds)}
        />
        <ChatTaskShareSheet
          visible={taskPickerVisible}
          tasks={shareableTasks}
          loading={taskPickerLoading}
          onClose={() => setTaskPickerVisible(false)}
          onSearch={(query) => void loadShareableTasks(query)}
          onShare={(task) => void shareTask(task)}
        />
        <ChatStickerPickerSheet
          visible={stickerPickerVisible}
          packs={stickerPacks}
          recentIds={recentStickerIds}
          loading={stickerPickerLoading}
          importing={stickerImporting}
          onClose={() => setStickerPickerVisible(false)}
          onSend={(sticker) => void sendSticker(sticker)}
          onImport={(source) => void importStickerPack(source)}
          onRemove={removeStickerPack}
        />
        <ChatEmojiPickerSheet
          visible={emojiPickerVisible}
          onClose={() => setEmojiPickerVisible(false)}
          onSelect={(emoji) => {
            setText((current) => `${current}${emoji}`);
            setEmojiPickerVisible(false);
          }}
          onSelectGif={(gif) => void sendGif(gif)}
          onOpenStickers={() => void openStickerPicker()}
        />
        <ChatImageEditorSheet
          file={imageEditorFile}
          busy={composerBusy}
          onCancel={() => setImageEditorFile(null)}
          onConfirm={(file) => {
            setImageEditorFile(null);
            void sendPickedFile(file).catch((cause) => {
              if (mountedRef.current) {
                Alert.alert('Не удалось отправить вложение', formatApiError(cause, 'Повторите попытку'));
              }
            }).finally(() => {
              if (mountedRef.current) {
                setComposerBusy(false);
              }
            });
          }}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: chatTokens.threadBg },
  container: { flex: 1, backgroundColor: chatTokens.threadBg, overflow: 'visible' },
  listWrap: { flex: 1 },
  list: { flexGrow: 1, justifyContent: 'flex-start', paddingHorizontal: 12, paddingVertical: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  errorTitle: { color: chatTokens.textPrimary, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  draftError: { color: chatTokens.textPrimary, fontSize: 13, lineHeight: 18, paddingHorizontal: 14, paddingVertical: 8 },
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
  jumpButton: {
    position: 'absolute',
    right: 16,
    bottom: 76,
    minWidth: 48,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 24,
    backgroundColor: chatTokens.panelBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: chatTokens.borderSoft,
    elevation: 4,
  },
  jumpIcon: { color: chatTokens.accentText, fontSize: 24, fontWeight: '700' },
  jumpCount: { marginLeft: 4, color: chatTokens.accentText, fontSize: 13, fontWeight: '800' },
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
