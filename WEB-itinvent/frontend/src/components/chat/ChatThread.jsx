import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Avatar,
  Badge,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import ForwardRoundedIcon from '@mui/icons-material/ForwardRounded';
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import { AnimatePresence, motion } from 'framer-motion';

import { emitAgentDebugLog } from '../../lib/debugClientLog';
import { ConversationAvatar, PresenceAvatar } from './ChatCommon';
import ChatComposer from './ChatComposer';
import ChatMessageList from './ChatMessageList';
import ChatSelectionActionDock from './ChatSelectionActionDock';
import ChatThreadComposerBridge from './ChatThreadComposerBridge';
import ChatThreadHeader, { AiRunStatusBanner } from './ChatThreadHeader';
import { useMainLayoutShell } from '../layout/MainLayoutShellContext';
import {
  CHAT_THREAD_NEAR_BOTTOM_DISTANCE_PX,
  getConversationDisplayTitle,
} from './chatHelpers';
import {
  computePrependScrollRestoreTop,
  shouldDeferPinnedBottomScroll,
  shouldRetryPrependRestore,
} from '../../lib/chat/chatThreadScrollModel';
import {
  buildChatThreadMessageBodyTypographySx,
  CHAT_DEFAULT_FONT_SIZES,
  CHAT_FONT_FAMILY,
} from './chatUiTokens';

const COMPOSER_STICK_DISTANCE_PX = CHAT_THREAD_NEAR_BOTTOM_DISTANCE_PX;
const BLUR_SCROLL_DELTA_PX = 12;
const BACK_SWIPE_EDGE_PX = 28;
const BACK_SWIPE_START_PX = 14;
const BACK_SWIPE_TRIGGER_PX = 84;
const HISTORY_AUTO_LOAD_ARM_DISTANCE_PX = 160;
// Single arbiter for programmatic scrollTop writes. Several effects (reaction
// height compensation, pin-to-bottom, selection-mode restore, keyboard) can fire
// inside the same frame; without arbitration they clobber each other and the
// viewport visibly jumps. Higher priority wins within SCROLL_WRITE_WINDOW_MS.
const SCROLL_WRITE_PRIORITY = {
  compensation: 1,
  pinnedBottom: 2,
  preserve: 3,
  prependRestore: 4,
};
const SCROLL_WRITE_WINDOW_MS = 32;

const getMessageReactionSignature = (message) => {
  const reactions = Array.isArray(message?.reactions) ? message.reactions : [];
  if (reactions.length === 0) return '';
  return reactions
    .map((reaction) => {
      const emoji = String(reaction?.emoji || '').trim();
      const count = Number(reaction?.count || 0);
      const users = Array.isArray(reaction?.user_ids)
        ? reaction.user_ids.map((value) => String(value || '').trim()).filter(Boolean).sort().join(',')
        : '';
      return `${emoji}:${count}:${users}`;
    })
    .sort()
    .join('|');
};

export const getChatKeyboardBottomSpacer = ({ compactMobile = false, keyboardInset = 0, composerHeight = 0 } = {}) => {
  if (!compactMobile || Number(keyboardInset || 0) <= 0) return 0;
  const measuredComposerHeight = Number(composerHeight || 0);
  const baseGap = Number.isFinite(measuredComposerHeight) && measuredComposerHeight > 0
    ? Math.round(measuredComposerHeight * 0.18)
    : 12;
  return Math.max(16, Math.min(32, baseGap));
};

export const getChatThreadBottomPadding = ({
  compactMobile = false,
  keyboardInset = 0,
  composerHeight = 0,
} = {}) => {
  const measuredComposerHeight = Math.max(0, Number(composerHeight || 0));
  const measuredKeyboardInset = Math.max(0, Number(keyboardInset || 0));
  const effectiveKeyboardInset = compactMobile ? measuredKeyboardInset : 0;
  const baseGap = compactMobile ? 8 : 18;
  const keyboardSpacer = getChatKeyboardBottomSpacer({
    compactMobile,
    keyboardInset: effectiveKeyboardInset,
    composerHeight: measuredComposerHeight,
  });
  return Math.max(baseGap, Math.round(baseGap + effectiveKeyboardInset + keyboardSpacer));
};

const JUMP_TO_LATEST_ABOVE_COMPOSER_GAP_PX = 24;
const JUMP_TO_LATEST_FAB_SIZE_PX = {
  mobile: 56,
  desktop: 52,
};
const JUMP_TO_LATEST_FAB_ICON_PX = {
  mobile: 32,
  desktop: 30,
};

export const getChatJumpToLatestBottomOffset = ({
  compactMobile = false,
  composerHeight = 0,
  keyboardInset = 0,
  selectionMode = false,
} = {}) => {
  if (selectionMode) {
    return compactMobile ? 92 : 96;
  }
  const measuredComposer = Math.max(compactMobile ? 72 : 80, Number(composerHeight || 0));
  const keyboard = compactMobile ? Math.max(0, Number(keyboardInset || 0)) : 0;
  return Math.round(measuredComposer + keyboard + JUMP_TO_LATEST_ABOVE_COMPOSER_GAP_PX);
};

export const getTaskCompletedBannerText = (completedAt) => {
  const raw = String(completedAt || '').trim();
  if (!raw) return 'Задача выполнена. Обсуждение остаётся открытым';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return 'Задача выполнена. Обсуждение остаётся открытым';
  const dateLabel = date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const timeLabel = date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `Задача выполнена ${dateLabel} в ${timeLabel}. Обсуждение остаётся открытым`;
};

const TaskCompletedBanner = memo(function TaskCompletedBanner({
  activeConversation,
  compactMobile,
  onOpenTask,
  theme,
  ui,
}) {
  const taskId = String(activeConversation?.task_id || '').trim();
  const completed = String(activeConversation?.task_status || '').trim().toLowerCase() === 'done';
  if (!taskId || !completed) return null;

  return (
    <Box
      data-testid="task-completed-banner"
      sx={{
        px: compactMobile ? 1 : 1.5,
        py: compactMobile ? 0.7 : 0.8,
        bgcolor: theme.palette.mode === 'dark' ? alpha('#059669', 0.18) : alpha('#10b981', 0.12),
        borderBottom: `1px solid ${alpha('#059669', theme.palette.mode === 'dark' ? 0.38 : 0.22)}`,
        color: theme.palette.mode === 'dark' ? '#a7f3d0' : '#065f46',
        flexShrink: 0,
      }}
    >
      <Stack
        direction="row"
        spacing={0.8}
        alignItems="center"
        justifyContent="space-between"
        sx={{
          maxWidth: compactMobile ? '100%' : `${Number(ui?.density?.contentMaxWidth || ui?.contentMaxWidth || 980) + 56}px`,
          mx: 'auto',
        }}
      >
        <Stack direction="row" spacing={0.7} alignItems="center" sx={{ minWidth: 0 }}>
          <CheckCircleRoundedIcon sx={{ fontSize: compactMobile ? 18 : 20, flexShrink: 0 }} />
          <Typography
            variant="body2"
            sx={{
              minWidth: 0,
              fontSize: compactMobile ? '0.75rem' : '0.8rem',
              lineHeight: 1.25,
              fontWeight: 700,
              color: 'inherit',
            }}
          >
            {getTaskCompletedBannerText(activeConversation?.task_completed_at)}
          </Typography>
        </Stack>
        <Button
          size="small"
          onClick={() => onOpenTask?.(taskId)}
          sx={{
            minWidth: 'auto',
            px: compactMobile ? 0.7 : 1,
            flexShrink: 0,
            textTransform: 'none',
            fontSize: compactMobile ? '0.72rem' : '0.76rem',
            fontWeight: 800,
            color: 'inherit',
          }}
        >
          Открыть задачу
        </Button>
      </Stack>
    </Box>
  );
});

const PinnedMessageBar = memo(function PinnedMessageBar({
  theme,
  ui,
  compactMobile,
  pinnedMessage,
  onOpenPinnedMessage,
  onUnpinPinnedMessage,
}) {
  if (!pinnedMessage?.id) return null;
  const density = ui.density || {};

  const previewText = String(pinnedMessage?.preview || '').trim() || 'Сообщение';
  const senderName = String(pinnedMessage?.senderName || '').trim();

  return (
    <Box
      sx={{
        px: { xs: compactMobile ? 0.75 : 1.1, md: density.threadHeaderPx || 1.8 },
        py: compactMobile ? 0.48 : 0.5,
        bgcolor: ui.threadTopbarBg,
        backdropFilter: 'blur(18px)',
        borderBottom: `1px solid ${alpha(ui.borderSoft, 0.8)}`,
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{
          maxWidth: compactMobile ? '100%' : `${Number(density.contentMaxWidth || ui.contentMaxWidth || 980) + 56}px`,
          mx: 'auto',
          width: '100%',
        }}
      >
        <Box
          component="button"
          type="button"
          data-testid="chat-pinned-message-open"
          aria-label="Открыть закрепленное сообщение"
          onClick={() => void onOpenPinnedMessage?.()}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.1,
            flex: 1,
            minWidth: 0,
            textAlign: 'left',
            border: 'none',
            bgcolor: ui.surfaceMuted || (compactMobile ? alpha(theme.palette.common.white, 0.03) : alpha(theme.palette.common.white, 0.02)),
            color: theme.palette.text.primary,
            borderRadius: compactMobile ? 2.5 : 1.5,
            px: compactMobile ? 1.1 : 1.2,
            py: compactMobile ? 0.8 : 0.75,
            transition: 'background-color 120ms ease, opacity 100ms ease',
            cursor: 'pointer',
            '&:hover': compactMobile ? undefined : {
              bgcolor: ui.surfaceHover || alpha(theme.palette.common.white, 0.05),
            },
            '&:active': {
              opacity: 0.74,
            },
          }}
        >
          <Box
            sx={{
              width: density.threadPinnedIcon || 30,
              height: density.threadPinnedIcon || 30,
              borderRadius: compactMobile ? 2 : 1.25,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: ui.accentSoft,
              color: ui.accentText,
              flexShrink: 0,
            }}
          >
            <PushPinOutlinedIcon sx={{ fontSize: 16 }} />
          </Box>

          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="caption" sx={{ color: ui.accentText, fontWeight: 800, lineHeight: 1.1 }} noWrap>
              Закрепленное сообщение
            </Typography>
            <Typography variant="body2" sx={{ color: ui.textSecondary, lineHeight: 1.25 }} noWrap>
              {senderName ? `${senderName}: ${previewText}` : previewText}
            </Typography>
          </Box>
        </Box>

        <IconButton
          size="small"
          data-testid="chat-pinned-message-close"
          aria-label="Снять закрепленное сообщение"
          onClick={() => onUnpinPinnedMessage?.()}
          sx={{
            width: compactMobile ? 44 : (density.threadPinnedClose || 32),
            height: compactMobile ? 44 : (density.threadPinnedClose || 32),
            borderRadius: compactMobile ? 999 : 1.5,
            color: ui.textSecondary,
            bgcolor: ui.surfaceMuted || alpha(theme.palette.common.white, 0.03),
            '&:hover': compactMobile ? undefined : {
              bgcolor: ui.surfaceHover || alpha(theme.palette.common.white, 0.06),
            },
            '&:active': {
              opacity: 0.62,
            },
          }}
        >
          <CloseRoundedIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Stack>
    </Box>
  );
});

function ChatThread({
  theme,
  ui,
  isMobile,
  compactMobile = false,
  mobileInteractionsEnabled = false,
  activeConversation,
  activeConversationId,
  navigate,
  threadWallpaperSx,
  messages,
  messagesLoading,
  effectiveLastReadMessageId,
  messagesHasMore,
  loadingOlder,
  prependScrollRestoreRef,
  onLoadOlder,
  threadScrollRef,
  threadContentRef,
  onThreadScroll,
  bottomRef,
  onBack,
  onOpenInfo,
  onOpenTask,
  onOpenSearch,
  onOpenMenu,
  onOpenReads,
  onOpenAttachmentPreview,
  onReplyMessage,
  onOpenMessageMenu,
  onConfirmAction,
  onCancelAction,
  onEditAction,
  selectedMessageIds = [],
  selectedMessageCount = 0,
  canReplySelectedMessage = false,
  canCopySelectedMessages = false,
  canDeleteSelectedMessages = false,
  onToggleMessageSelection,
  onStartMessageSelection,
  onClearMessageSelection,
  onReplySelectedMessage,
  onCopySelectedMessages,
  onForwardSelectedMessages,
  onDeleteSelectedMessages,
  onOpenComposerMenu,
  composerRef,
  composerTextBridge,
  messageText,
  onMessageTextChange,
  onComposerKeyDown,
  onComposerSelectionSync,
  onOpenEmojiPicker,
  onCloseEmojiPicker,
  onSendMessage,
  onComposerPaste,
  onComposerDrop,
  onComposerDragOver,
  onComposerDragLeave,
  isFileDragActive,
  mentionCandidates = [],
  onSearchMentionPeople,
  showJumpToLatest,
  onJumpToLatest,
  replyMessage,
  onClearReply,
  editingMessage,
  onClearEditing,
  aiTypingStatus,
  aiStatus,
  pinnedMessage,
  onOpenPinnedMessage,
  onUnpinPinnedMessage,
  highlightedMessageId,
  headerSubtitle,
  typingLine,
  contextPanelOpen,
  selectedFiles,
  fileCaption,
  onOpenFileDialog,
  onClearSelectedFiles,
  preparingFiles,
  sendingFiles,
  fileUploadProgress,
  selectedFilesSummary,
  getReadTargetRef,
  onComposerFocusChange,
  onToggleReaction,
  onScrollToMessage,
  currentUserId,
  mobileEmojiPickerOpen = false,
  onInsertEmoji,
  onSendSticker,
  onSendGif,
  voiceRecording = false,
  voiceRecordingDuration = 0,
  voiceRecordingLevelRef = null,
  onStartVoiceRecording,
  onStopVoiceRecording,
  onCancelVoiceRecording,
  onBindPinnedScroll,
}) {
  const { openDrawer, headerMode } = useMainLayoutShell();
  const resolvedMobileInteractionsEnabled = Boolean(mobileInteractionsEnabled || isMobile);
  const composerDockRef = useRef(null);
  const lastScrollTopRef = useRef(0);
  const lastProgrammaticScrollRef = useRef({ at: 0, priority: 0 });
  const composerFocusedRef = useRef(false);
  const threadPinnedToBottomRef = useRef(true);
  const threadPinnedScrollFrameRef = useRef(null);
  const threadViewportHeightRef = useRef(0);
  const threadContentHeightRef = useRef(0);
  const previousComposerLayoutRef = useRef({ composerHeight: null, keyboardInset: null });
  const keyboardViewportBaselineRef = useRef(0);
  const messageReactionMetricsRef = useRef(new Map());
  const previousSelectionModeRef = useRef(false);
  const backSwipeRef = useRef({ tracking: false, engaged: false, startX: 0, startY: 0 });
  const [composerHeight, setComposerHeight] = useState(compactMobile ? 92 : 102);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [backSwipeOffset, setBackSwipeOffset] = useState(0);
  const hasConversationTarget = Boolean(String(activeConversationId || '').trim());
  const showConversationLoadingState = !activeConversation && (messagesLoading || hasConversationTarget);
  const showEmbeddedMenuButton = false;
  const selectionMode = Number(selectedMessageCount || 0) > 0;
  const servicePillBg = ui.servicePillBg || alpha(ui.composerDockBg || ui.panelBg || theme.palette.background.paper, 0.78);
  const servicePillText = ui.servicePillText || ui.textSecondary;
  const jumpFabBg = ui.jumpFabBg || ui.surfaceStrong || theme.palette.background.paper;
  const jumpFabIcon = ui.jumpFabIcon || ui.textSecondary || theme.palette.text.secondary;
  const jumpFabHoverBg = ui.jumpFabHoverBg || ui.surfaceHover || alpha(theme.palette.common.white, 0.08);
  const jumpFabShadow = ui.jumpFabShadow || ui.shadowSoft || '0 4px 14px rgba(0,0,0,0.2)';
  const jumpToLatestBottomOffset = getChatJumpToLatestBottomOffset({
    compactMobile,
    composerHeight,
    keyboardInset,
    selectionMode,
  });
  const jumpFabSize = compactMobile
    ? JUMP_TO_LATEST_FAB_SIZE_PX.mobile
    : JUMP_TO_LATEST_FAB_SIZE_PX.desktop;
  const jumpFabIconSize = compactMobile
    ? JUMP_TO_LATEST_FAB_ICON_PX.mobile
    : JUMP_TO_LATEST_FAB_ICON_PX.desktop;
  const density = ui.density || {};
  const contentMaxWidth = Number(density.contentMaxWidth || ui.contentMaxWidth || 980);
  const aiRunStatus = String(aiStatus?.status || '').trim();
  const previousAiRunStatusRef = useRef('');
  const scrollBottomPadding = getChatThreadBottomPadding({
    compactMobile,
    keyboardInset,
    composerHeight,
  });
  const messageCount = Array.isArray(messages) ? messages.length : 0;
  const [historyAutoLoadEnabled, setHistoryAutoLoadEnabled] = useState(false);
  const loadingOlderRef = useRef(loadingOlder);
  loadingOlderRef.current = loadingOlder;

  const shouldDeferThreadPinnedScroll = useCallback(() => (
    shouldDeferPinnedBottomScroll({
      loadingOlder: loadingOlderRef.current,
      prependRestorePending: Boolean(prependScrollRestoreRef?.current),
    })
  ), [prependScrollRestoreRef]);

  useEffect(() => {
    setHistoryAutoLoadEnabled(false);
  }, [activeConversationId]);

  useEffect(() => {
    if (!messagesHasMore) {
      setHistoryAutoLoadEnabled(false);
    }
  }, [messagesHasMore]);

  const isThreadScrollable = useCallback((node) => {
    if (!node) return false;
    return Number(node.scrollHeight) > Number(node.clientHeight) + 2;
  }, []);

  const armHistoryAutoLoadIfNearTop = useCallback((event) => {
    if (historyAutoLoadEnabled) return;
    const node = event?.currentTarget;
    if (!node || !isThreadScrollable(node)) return;
    const scrollTop = Number(node.scrollTop || 0);
    if (scrollTop > HISTORY_AUTO_LOAD_ARM_DISTANCE_PX) return;
    setHistoryAutoLoadEnabled(true);
  }, [historyAutoLoadEnabled, isThreadScrollable]);

  const handleThreadWheel = useCallback((event) => {
    const deltaY = Number(event?.deltaY ?? event?.nativeEvent?.deltaY ?? 0);
    if (deltaY <= 0) {
      armHistoryAutoLoadIfNearTop(event);
    }
  }, [armHistoryAutoLoadIfNearTop]);

  // Centralised, clamped scrollTop writer. Returns the applied value, or null
  // when a higher-priority write already claimed the current frame (so the
  // caller keeps its previous position instead of fighting the winner).
  const applyThreadScroll = useCallback((container, rawTarget, priority = 0) => {
    if (!container) return null;
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    const last = lastProgrammaticScrollRef.current;
    if (last && (now - Number(last.at || 0)) <= SCROLL_WRITE_WINDOW_MS && priority < Number(last.priority || 0)) {
      return null;
    }
    const maxScrollTop = Math.max(0, Number(container.scrollHeight || 0) - Number(container.clientHeight || 0));
    const nextTop = Math.max(0, Math.min(maxScrollTop, Number(rawTarget || 0)));
    if (Math.abs(nextTop - Number(container.scrollTop || 0)) <= 1) {
      return nextTop;
    }
    container.scrollTop = nextTop;
    lastScrollTopRef.current = nextTop;
    lastProgrammaticScrollRef.current = { at: now, priority };
    // #region agent log
    emitAgentDebugLog({
      location: 'ChatThread.jsx:applyThreadScroll',
      message: 'thread scroll write',
      data: {
        priority,
        nextTop: Math.round(nextTop),
        scrollHeight: Math.round(Number(container.scrollHeight || 0)),
        clientHeight: Math.round(Number(container.clientHeight || 0)),
        distanceFromBottom: Math.round(Math.max(0, Number(container.scrollHeight || 0) - nextTop - Number(container.clientHeight || 0))),
      },
      hypothesisId: 'H1',
    });
    // #endregion
    return nextTop;
  }, []);

  const applyPrependScrollRestore = useCallback((restore) => {
    const container = threadScrollRef.current;
    if (!container || !restore) return false;
    const nextScrollTop = computePrependScrollRestoreTop(container, restore);
    if (nextScrollTop === null) return false;
    const applied = applyThreadScroll(container, nextScrollTop, SCROLL_WRITE_PRIORITY.prependRestore);
    if (applied !== null) {
      const distanceFromBottom = Number(container.scrollHeight || 0) - applied - Number(container.clientHeight || 0);
      threadPinnedToBottomRef.current = distanceFromBottom <= COMPOSER_STICK_DISTANCE_PX;
      lastScrollTopRef.current = applied;
    }
    return applied !== null;
  }, [applyThreadScroll, threadScrollRef]);

  const schedulePrependScrollRestoreLocal = useCallback((restore, { onSettled } = {}) => {
    if (!restore) return () => {};
    let frameIndex = 0;
    let frameId = null;
    let cancelled = false;

    const attempt = () => {
      if (cancelled) return;
      applyPrependScrollRestore(restore);
      const container = threadScrollRef.current;
      if (container && shouldRetryPrependRestore(container, restore, frameIndex)) {
        frameIndex += 1;
        frameId = window.requestAnimationFrame(attempt);
        return;
      }
      onSettled?.();
    };

    attempt();
    return () => {
      cancelled = true;
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [applyPrependScrollRestore, threadScrollRef]);

  useLayoutEffect(() => {
    const restore = prependScrollRestoreRef?.current;
    if (!restore || !threadScrollRef.current) return undefined;

    return schedulePrependScrollRestoreLocal(restore, {
      onSettled: () => {
        if (prependScrollRestoreRef) {
          prependScrollRestoreRef.current = null;
        }
      },
    });
  }, [messages, prependScrollRestoreRef, schedulePrependScrollRestoreLocal, threadScrollRef]);

  useLayoutEffect(() => {
    const previousSelectionMode = previousSelectionModeRef.current;
    previousSelectionModeRef.current = selectionMode;
    if (previousSelectionMode === selectionMode) return;
    const container = threadScrollRef.current;
    if (!container) return;
    const preservedScrollTop = Number(lastScrollTopRef.current || container.scrollTop || 0);
    window.requestAnimationFrame(() => {
      if (threadScrollRef.current !== container) return;
      if (Math.abs(Number(container.scrollTop || 0) - preservedScrollTop) < 1) return;
      applyThreadScroll(container, preservedScrollTop, SCROLL_WRITE_PRIORITY.preserve);
    });
  }, [selectionMode, threadScrollRef, applyThreadScroll]);

  const scrollPinnedThreadToBottom = useCallback(({ settleFrames = 1, forcePin = false } = {}) => {
    const container = threadScrollRef.current;
    if (!container) return;
    if (forcePin) {
      threadPinnedToBottomRef.current = true;
    }
    if (!threadPinnedToBottomRef.current) return;

    const scrollToBottom = () => {
      const bottomTarget = Math.max(
        0,
        Number(container.scrollHeight || 0) - Number(container.clientHeight || 0),
      );
      applyThreadScroll(container, bottomTarget, SCROLL_WRITE_PRIORITY.pinnedBottom);
    };

    scrollToBottom();

    let remainingFrames = Math.max(0, Math.floor(Number(settleFrames || 0)));
    if (remainingFrames <= 0) return;

    const settle = () => {
      if (forcePin) {
        threadPinnedToBottomRef.current = true;
      }
      if (!threadPinnedToBottomRef.current) return;
      scrollToBottom();
      remainingFrames -= 1;
      if (remainingFrames > 0) {
        window.requestAnimationFrame(settle);
      }
    };

    window.requestAnimationFrame(settle);
  }, [threadScrollRef, applyThreadScroll]);

  const schedulePinnedBottomScroll = useCallback(({ settleFrames = 0, forcePin = false } = {}) => {
    if (shouldDeferThreadPinnedScroll()) return;
    if (threadPinnedScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(threadPinnedScrollFrameRef.current);
      threadPinnedScrollFrameRef.current = null;
    }

    const framesLeft = Math.max(1, Math.floor(Number(settleFrames || 0)) + 1);
    let remaining = framesLeft;

    const tick = () => {
      threadPinnedScrollFrameRef.current = null;
      if (forcePin) {
        threadPinnedToBottomRef.current = true;
      }
      if (!threadPinnedToBottomRef.current) return;
      scrollPinnedThreadToBottom({ settleFrames: 0, forcePin });
      remaining -= 1;
      if (remaining <= 0) return;
      threadPinnedScrollFrameRef.current = window.requestAnimationFrame(tick);
    };

    if (!threadPinnedToBottomRef.current) return;
    scrollPinnedThreadToBottom({ settleFrames: 0 });
    remaining -= 1;
    if (remaining <= 0) return;
    threadPinnedScrollFrameRef.current = window.requestAnimationFrame(tick);
  }, [scrollPinnedThreadToBottom, shouldDeferThreadPinnedScroll]);

  const schedulePinnedBottomScrollRef = useRef(schedulePinnedBottomScroll);
  schedulePinnedBottomScrollRef.current = schedulePinnedBottomScroll;

  useEffect(() => {
    if (typeof onBindPinnedScroll !== 'function') return undefined;
    onBindPinnedScroll(schedulePinnedBottomScroll);
    return () => {
      onBindPinnedScroll(null);
    };
  }, [onBindPinnedScroll, schedulePinnedBottomScroll]);

  useLayoutEffect(() => {
    const prev = String(previousAiRunStatusRef.current || '').trim();
    previousAiRunStatusRef.current = aiRunStatus;
    if (prev === aiRunStatus) return;
    // #region agent log
    emitAgentDebugLog({
      location: 'ChatThread.jsx:aiRunStatusChange',
      message: 'AI banner layout shift',
      data: {
        prevStatus: prev,
        nextStatus: aiRunStatus,
        pinned: Boolean(threadPinnedToBottomRef.current),
        aiTypingVisible: Boolean(aiTypingStatus?.visible),
      },
      hypothesisId: 'H3',
    });
    // #endregion
    if (threadPinnedToBottomRef.current) {
      schedulePinnedBottomScroll({ settleFrames: 0 });
    }
  }, [aiRunStatus, aiTypingStatus?.visible, schedulePinnedBottomScroll]);

  useLayoutEffect(() => {
    if (!compactMobile) return undefined;
    const container = threadScrollRef.current;
    if (!container) return undefined;

    threadViewportHeightRef.current = Number(container.clientHeight || 0);

    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
        const node = threadScrollRef.current;
        if (!node) return;
        const nextHeight = Number(node.clientHeight || 0);
        const previousHeight = Number(threadViewportHeightRef.current || 0);
        const heightDelta = nextHeight - previousHeight;
        if (Math.abs(heightDelta) <= 1) return;
        const scrollTop = Number(node.scrollTop || 0);
        const scrollHeight = Number(node.scrollHeight || 0);
        const distanceFromBottom = scrollHeight - scrollTop - nextHeight;
        threadViewportHeightRef.current = nextHeight;
        const heightShrunk = heightDelta < -20;
        const shouldRecoverBottom = threadPinnedToBottomRef.current
          || distanceFromBottom <= COMPOSER_STICK_DISTANCE_PX
          || (heightShrunk && Math.abs(heightDelta) > 80);
        // #region agent log
        emitAgentDebugLog({
          location: 'ChatThread.jsx:viewportResizeObserver',
          message: shouldRecoverBottom
            ? 'viewport height changed — recover bottom scroll'
            : 'viewport height changed — skip recover',
          data: {
            previousHeight: Math.round(previousHeight),
            nextHeight: Math.round(nextHeight),
            heightDelta: Math.round(heightDelta),
            distanceFromBottom: Math.round(Math.max(0, distanceFromBottom)),
            pinned: Boolean(threadPinnedToBottomRef.current),
            shouldRecoverBottom,
          },
          hypothesisId: 'H-M9',
        });
        // #endregion
        if (!shouldRecoverBottom) return;
        threadPinnedToBottomRef.current = true;
        schedulePinnedBottomScrollRef.current?.({ settleFrames: 2, forcePin: true });
      })
      : null;
    observer?.observe?.(container);

    return () => {
      observer?.disconnect?.();
      if (threadPinnedScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(threadPinnedScrollFrameRef.current);
        threadPinnedScrollFrameRef.current = null;
      }
    };
  }, [compactMobile, threadScrollRef]);

  useLayoutEffect(() => {
    const content = threadContentRef?.current;
    if (!content) return undefined;

    threadContentHeightRef.current = Number(content.offsetHeight || content.scrollHeight || 0);

    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
        const contentNode = threadContentRef?.current;
        const scrollNode = threadScrollRef.current;
        if (!contentNode || !scrollNode) return;
        if (shouldDeferPinnedBottomScroll({
          loadingOlder: loadingOlderRef.current,
          prependRestorePending: Boolean(prependScrollRestoreRef?.current),
        })) return;
        const nextHeight = Number(contentNode.offsetHeight || contentNode.scrollHeight || 0);
        const previousHeight = Number(threadContentHeightRef.current || 0);
        if (Math.abs(nextHeight - previousHeight) <= 1) return;
        threadContentHeightRef.current = nextHeight;
        if (!threadPinnedToBottomRef.current) return;
        // #region agent log
        emitAgentDebugLog({
          location: 'ChatThread.jsx:contentResizeObserver',
          message: 'content height changed while pinned',
          data: {
            previousHeight: Math.round(previousHeight),
            nextHeight: Math.round(nextHeight),
            scrollHeight: Math.round(Number(scrollNode.scrollHeight || 0)),
            clientHeight: Math.round(Number(scrollNode.clientHeight || 0)),
            distanceFromBottom: Math.round(Math.max(
              0,
              Number(scrollNode.scrollHeight || 0) - Number(scrollNode.scrollTop || 0) - Number(scrollNode.clientHeight || 0),
            )),
          },
          hypothesisId: 'H-M1',
        });
        // #endregion
        schedulePinnedBottomScroll({ settleFrames: 1, forcePin: true });
      })
      : null;
    observer?.observe?.(content);

    return () => {
      observer?.disconnect?.();
    };
  }, [activeConversationId, messageCount, messagesLoading, prependScrollRestoreRef, threadContentRef, threadScrollRef, schedulePinnedBottomScroll]);

  useEffect(() => {
    const node = composerDockRef.current;
    if (!node) return undefined;

    const updateHeight = () => {
      const nextHeight = Math.round(node.getBoundingClientRect?.().height || 0);
      if (nextHeight > 0) setComposerHeight(nextHeight);
    };

    updateHeight();

    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      updateHeight();
    });
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const previousLayout = previousComposerLayoutRef.current;
    previousComposerLayoutRef.current = { composerHeight, keyboardInset };

    const hadPreviousMeasurement = Number.isFinite(Number(previousLayout.composerHeight))
      || Number.isFinite(Number(previousLayout.keyboardInset));
    if (!hadPreviousMeasurement) return;

    const heightChanged = Math.abs(Number(composerHeight || 0) - Number(previousLayout.composerHeight || 0)) > 1;
    const insetChanged = Math.abs(Number(keyboardInset || 0) - Number(previousLayout.keyboardInset || 0)) > 1;
    const shouldScrollPinned = insetChanged
      || (heightChanged && threadPinnedToBottomRef.current);
    if (!shouldScrollPinned) return;

    // #region agent log
    emitAgentDebugLog({
      location: 'ChatThread.jsx:composerLayoutEffect',
      message: 'layout scroll pinned',
      data: {
        heightChanged,
        insetChanged,
        composerHeight: Math.round(Number(composerHeight || 0)),
        keyboardInset: Math.round(Number(keyboardInset || 0)),
        scrollBottomPadding,
        pinned: Boolean(threadPinnedToBottomRef.current),
      },
      hypothesisId: insetChanged ? 'H4' : 'H-M2',
    });
    // #endregion
    schedulePinnedBottomScroll({ settleFrames: heightChanged && !insetChanged ? 1 : 0 });
  }, [composerHeight, keyboardInset, scrollBottomPadding, schedulePinnedBottomScroll]);

  useLayoutEffect(() => {
    const container = threadScrollRef.current;
    const content = threadContentRef?.current;
    if (!container || !content) return;

    const deferPinnedScroll = shouldDeferPinnedBottomScroll({
      loadingOlder: loadingOlderRef.current,
      prependRestorePending: Boolean(prependScrollRestoreRef?.current),
    });

    const wasPinned = threadPinnedToBottomRef.current;
    const previousMetrics = messageReactionMetricsRef.current;
    const nextMetrics = new Map();
    const messageElements = Array.from(content.querySelectorAll('[data-message-id]'));
    const messageById = new Map((Array.isArray(messages) ? messages : []).map((message) => [
      String(message?.id || '').trim(),
      message,
    ]));
    const scrollTop = Number(container.scrollTop || 0);
    const viewportBottom = scrollTop + Number(container.clientHeight || 0);
    let compensation = 0;

    messageElements.forEach((element) => {
      const messageId = String(element.getAttribute('data-message-id') || '').trim();
      if (!messageId || !messageById.has(messageId)) return;

      const message = messageById.get(messageId);
      const signature = getMessageReactionSignature(message);
      const rect = element.getBoundingClientRect?.();
      const height = Math.round(Number(rect?.height || element.offsetHeight || 0));
      const elementTop = Number(element.offsetTop || 0);
      const previous = previousMetrics.get(messageId);

      if (previous && previous.signature !== signature && Number.isFinite(previous.height)) {
        const delta = height - Number(previous.height || 0);
        if (Math.abs(delta) > 1 && elementTop <= viewportBottom + 1) {
          compensation += delta;
        }
      }

      nextMetrics.set(messageId, { height, signature });
    });

    messageReactionMetricsRef.current = nextMetrics;
    if (compensation < 0) {
      const alreadyReducedScroll = Math.max(0, Number(lastScrollTopRef.current || 0) - scrollTop);
      compensation = Math.min(0, compensation + alreadyReducedScroll);
    }

    if (Math.abs(compensation) <= 1) {
      lastScrollTopRef.current = scrollTop;
      const distanceFromBottom = Number(container.scrollHeight || 0) - scrollTop - Number(container.clientHeight || 0);
      if (deferPinnedScroll) {
        threadPinnedToBottomRef.current = distanceFromBottom <= COMPOSER_STICK_DISTANCE_PX;
        return;
      }
      if (wasPinned && distanceFromBottom > COMPOSER_STICK_DISTANCE_PX) {
        // #region agent log
        emitAgentDebugLog({
          location: 'ChatThread.jsx:messagesLayoutPinnedCatchUp',
          message: 'content grew while pinned — catch-up scroll',
          data: {
            distanceFromBottom: Math.round(distanceFromBottom),
            scrollHeight: Math.round(Number(container.scrollHeight || 0)),
            clientHeight: Math.round(Number(container.clientHeight || 0)),
          },
          hypothesisId: 'H-M3',
        });
        // #endregion
        threadPinnedToBottomRef.current = true;
        schedulePinnedBottomScroll({ settleFrames: 2, forcePin: true });
        return;
      }
      threadPinnedToBottomRef.current = distanceFromBottom <= COMPOSER_STICK_DISTANCE_PX;
      return;
    }

    const applied = applyThreadScroll(container, scrollTop + compensation, SCROLL_WRITE_PRIORITY.compensation);
    const effectiveScrollTop = applied == null ? scrollTop : applied;
    lastScrollTopRef.current = effectiveScrollTop;
    const distanceFromBottom = Number(container.scrollHeight || 0) - effectiveScrollTop - Number(container.clientHeight || 0);
    threadPinnedToBottomRef.current = distanceFromBottom <= COMPOSER_STICK_DISTANCE_PX;
  }, [messages, prependScrollRestoreRef, threadContentRef, threadScrollRef, applyThreadScroll, schedulePinnedBottomScroll]);

  // Простое отслеживание клавиатуры через resize окна
  useEffect(() => {
    if (!compactMobile) {
      keyboardViewportBaselineRef.current = 0;
      setKeyboardInset(0);
      return undefined;
    }

    const measureKeyboardInset = () => {
      const layoutHeight = Math.round(
        Number(window.innerHeight || document.documentElement?.clientHeight || 0),
      );
      if (layoutHeight > keyboardViewportBaselineRef.current) {
        keyboardViewportBaselineRef.current = layoutHeight;
      }

      const visualViewport = window.visualViewport;
      if (!visualViewport) {
        setKeyboardInset(0);
        return;
      }

      const baselineHeight = Math.max(keyboardViewportBaselineRef.current, layoutHeight);
      const viewportHeight = Math.round(Number(visualViewport.height || 0));
      const viewportOffsetTop = Math.max(0, Math.round(Number(visualViewport.offsetTop || 0)));
      const layoutResizeDelta = Math.max(0, baselineHeight - layoutHeight);
      const overlayInset = Math.max(0, layoutHeight - viewportHeight - viewportOffsetTop);
      const nextInset = layoutResizeDelta > 80 ? 0 : (overlayInset > 80 ? overlayInset : 0);

      setKeyboardInset((currentInset) => {
        const willUpdate = Math.abs(Number(currentInset || 0) - nextInset) > 1;
        if (willUpdate || layoutResizeDelta > 80) {
          const container = threadScrollRef.current;
          const scrollTop = Number(container?.scrollTop || 0);
          const scrollHeight = Number(container?.scrollHeight || 0);
          const clientHeight = Number(container?.clientHeight || 0);
          const measuredComposerHeight = Math.round(
            Number(composerDockRef.current?.getBoundingClientRect?.().height || composerHeight || 0),
          );
          const distanceFromBottom = Math.max(0, scrollHeight - scrollTop - clientHeight);
          const nextPadding = getChatThreadBottomPadding({
            compactMobile,
            keyboardInset: nextInset,
            composerHeight: measuredComposerHeight,
          });
          // #region agent log
          emitAgentDebugLog({
            location: 'ChatThread.jsx:measureKeyboardInset',
            message: 'keyboard inset change',
            data: {
              prevInset: Math.round(Number(currentInset || 0)),
              nextInset: Math.round(nextInset),
              layoutResizeDelta: Math.round(layoutResizeDelta),
              composerHeight: measuredComposerHeight,
              scrollBottomPadding: nextPadding,
              distanceFromBottom: Math.round(distanceFromBottom),
              pinned: Boolean(threadPinnedToBottomRef.current),
            },
            hypothesisId: 'H2',
          });
          // #endregion
          if (
            layoutResizeDelta > 80
            && (
              threadPinnedToBottomRef.current
              || distanceFromBottom > COMPOSER_STICK_DISTANCE_PX
            )
          ) {
            schedulePinnedBottomScroll({ settleFrames: 2, forcePin: true });
          }
        }
        return willUpdate ? nextInset : currentInset;
      });
    };

    measureKeyboardInset();
    window.addEventListener('resize', measureKeyboardInset);
    window.visualViewport?.addEventListener?.('resize', measureKeyboardInset);
    window.visualViewport?.addEventListener?.('scroll', measureKeyboardInset);
    return () => {
      window.removeEventListener('resize', measureKeyboardInset);
      window.visualViewport?.removeEventListener?.('resize', measureKeyboardInset);
      window.visualViewport?.removeEventListener?.('scroll', measureKeyboardInset);
    };
  }, [compactMobile, threadScrollRef, schedulePinnedBottomScroll]);

  useEffect(() => {
    const container = threadScrollRef.current;
    if (!container) return undefined;
    const handleMediaLoaded = () => {
      if (!threadPinnedToBottomRef.current) return;
      // #region agent log
      emitAgentDebugLog({
        location: 'ChatThread.jsx:mediaLoaded',
        message: 'media asset loaded while pinned',
        data: {
          scrollHeight: Math.round(Number(container.scrollHeight || 0)),
          clientHeight: Math.round(Number(container.clientHeight || 0)),
          distanceFromBottom: Math.round(Math.max(
            0,
            Number(container.scrollHeight || 0) - Number(container.scrollTop || 0) - Number(container.clientHeight || 0),
          )),
        },
        hypothesisId: 'H-M5',
      });
      // #endregion
      schedulePinnedBottomScroll({ settleFrames: 2, forcePin: true });
    };
    container.addEventListener('chat-media-loaded', handleMediaLoaded);
    return () => container.removeEventListener('chat-media-loaded', handleMediaLoaded);
  }, [activeConversationId, threadScrollRef, schedulePinnedBottomScroll]);

  // На Android клавиатура сжимает visualViewport — скроллим при каждом изменении
  const handleComposerFocusChange = useCallback((focused) => {
    composerFocusedRef.current = Boolean(focused);
    onComposerFocusChange?.(focused);
    if (!focused) return;
    if (!threadPinnedToBottomRef.current) return;
    // #region agent log
    emitAgentDebugLog({
      location: 'ChatThread.jsx:composerFocus',
      message: 'composer focused scroll listeners',
      data: { keyboardInset: Math.round(Number(keyboardInset || 0)), pinned: true },
      hypothesisId: 'H4',
    });
    // #endregion

    if (window.visualViewport) {
      const vp = window.visualViewport;
      const scrollOnce = () => {
        if (!composerFocusedRef.current || !threadPinnedToBottomRef.current) return;
        schedulePinnedBottomScroll({ settleFrames: 0 });
      };
      vp.addEventListener('resize', scrollOnce);
      vp.addEventListener('scroll', scrollOnce);
      setTimeout(() => {
        vp.removeEventListener('resize', scrollOnce);
        vp.removeEventListener('scroll', scrollOnce);
      }, 1200);
    }
  }, [keyboardInset, onComposerFocusChange, schedulePinnedBottomScroll]);

  const handleThreadTouchStart = useCallback((event) => {
    if (!compactMobile || typeof onBack !== 'function') return;
    const touch = event.touches?.[0];
    if (!touch) return;
    const target = event.target;
    if (target?.closest?.('button, a, input, textarea, video, [role="button"], [data-chat-no-back-swipe]')) return;
    const bounds = event.currentTarget?.getBoundingClientRect?.();
    const relativeX = Number(touch.clientX || 0) - Number(bounds?.left || 0);
    if (relativeX > BACK_SWIPE_EDGE_PX) return;
    backSwipeRef.current = {
      tracking: true,
      engaged: false,
      startX: Number(touch.clientX || 0),
      startY: Number(touch.clientY || 0),
    };
    setBackSwipeOffset(0);
  }, [compactMobile, onBack]);

  const handleThreadTouchMove = useCallback((event) => {
    if (!backSwipeRef.current.tracking) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    const deltaX = Number(touch.clientX || 0) - backSwipeRef.current.startX;
    const deltaY = Number(touch.clientY || 0) - backSwipeRef.current.startY;

    if (!backSwipeRef.current.engaged) {
      if (Math.abs(deltaY) > 18 && Math.abs(deltaY) > Math.abs(deltaX)) {
        backSwipeRef.current = { tracking: false, engaged: false, startX: 0, startY: 0 };
        setBackSwipeOffset(0);
        return;
      }
      if (deltaX < BACK_SWIPE_START_PX || Math.abs(deltaX) <= (Math.abs(deltaY) + 4)) return;
      backSwipeRef.current.engaged = true;
    }

    if (event.cancelable) event.preventDefault();
    setBackSwipeOffset(Math.max(0, Math.min(112, deltaX)));
  }, []);

  const finishBackSwipe = useCallback(() => {
    const shouldNavigateBack = backSwipeRef.current.engaged && backSwipeOffset >= BACK_SWIPE_TRIGGER_PX;
    backSwipeRef.current = { tracking: false, engaged: false, startX: 0, startY: 0 };
    setBackSwipeOffset(0);
    if (shouldNavigateBack) onBack?.();
  }, [backSwipeOffset, onBack]);

  const handleThreadScroll = useCallback((event) => {
    const node = event?.currentTarget;
    if (!node) {
      onThreadScroll?.(event);
      return;
    }

    const previousScrollTop = Number(lastScrollTopRef.current || 0);
    const currentScrollTop = Number(node.scrollTop || 0);
    const distanceFromBottom = node.scrollHeight - currentScrollTop - node.clientHeight;
    threadPinnedToBottomRef.current = distanceFromBottom <= COMPOSER_STICK_DISTANCE_PX;
    if (
      !historyAutoLoadEnabled
      && isThreadScrollable(node)
      && currentScrollTop <= HISTORY_AUTO_LOAD_ARM_DISTANCE_PX
      && currentScrollTop < previousScrollTop - 1
      && event?.nativeEvent?.isTrusted
    ) {
      setHistoryAutoLoadEnabled(true);
    }

    if (
      composerFocusedRef.current
      && currentScrollTop < (previousScrollTop - BLUR_SCROLL_DELTA_PX)
      && distanceFromBottom > COMPOSER_STICK_DISTANCE_PX
    ) {
      composerRef.current?.blur?.();
    }

    lastScrollTopRef.current = currentScrollTop;
    onThreadScroll?.(event);
  }, [composerRef, historyAutoLoadEnabled, isThreadScrollable, onThreadScroll]);

  if (!activeConversation) {
    return (
      <Stack
        data-testid={showConversationLoadingState ? 'chat-thread-loading-state' : 'chat-empty-state'}
        alignItems="center"
        justifyContent="center"
        className="chat-native-shell chat-no-select"
        sx={{
          flex: 1,
          minWidth: 0,
          minHeight: 360,
          px: 3,
          textAlign: 'center',
          ...threadWallpaperSx,
        }}
      >
        <Avatar
          sx={{
            width: 72,
            height: 72,
            mb: 2,
            bgcolor: ui.accentSoft,
            color: ui.accentText,
          }}
        >
          {showConversationLoadingState ? <CircularProgress size={28} color="inherit" /> : <SmartToyOutlinedIcon fontSize="large" />}
        </Avatar>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>
          {showConversationLoadingState ? 'Открываем диалог…' : 'Выберите чат'}
        </Typography>
        <Typography variant="body2" sx={{ mt: 1, color: ui.textSecondary, maxWidth: 460 }}>
          {showConversationLoadingState
            ? 'Загружаем сообщения и карточку собеседника.'
            : 'Откройте диалог слева, чтобы продолжить переписку, отправить файл или поделиться задачей.'}
        </Typography>
      </Stack>
    );
  }

  return (
    <Box
      data-testid="chat-thread-root"
      className="chat-native-shell"
      onTouchStart={handleThreadTouchStart}
      onTouchMove={handleThreadTouchMove}
      onTouchEnd={finishBackSwipe}
      onTouchCancel={finishBackSwipe}
      sx={{
        '--chat-action-bg': ui.headerActionBg || alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.04 : 0.06),
        '--chat-action-hover-bg': ui.headerActionHoverBg || ui.sidebarRowHover,
        '--chat-action-press-bg': ui.headerActionBg || alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.06 : 0.08),
        '--chat-action-active-bg': ui.accentSoft,
        '--chat-action-active-text': ui.accentText,
        '--chat-font-family': CHAT_FONT_FAMILY,
        ...buildChatThreadMessageBodyTypographySx(ui, compactMobile),
        '--chat-focus-ring': ui.focusRing,
        '--chat-skeleton-base': ui.skeletonBase,
        '--chat-skeleton-wave': ui.skeletonWave,
        '--chat-skeleton-own-bg': alpha(ui.bubbleOwnBg || '#d9fdd3', theme.palette.mode === 'dark' ? 0.34 : 0.58),
        '--chat-skeleton-other-bg': alpha(ui.bubbleOtherBg || '#ffffff', theme.palette.mode === 'dark' ? 0.5 : 0.82),
        '--chat-skeleton-shadow': ui.shadowSoft,
        flex: 1,
        minWidth: 0,
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: compactMobile ? ui.threadBg : (ui.desktopShellBg || ui.threadBg),
        position: 'relative',
        overscrollBehaviorY: compactMobile ? 'none' : 'contain',
        borderLeft: compactMobile ? 'none' : `1px solid ${ui.desktopShellBorder || ui.borderSoft}`,
        transform: compactMobile && backSwipeOffset > 0 ? `translateX(${backSwipeOffset}px)` : 'translateX(0)',
        transition: compactMobile && backSwipeOffset > 0 ? 'none' : 'transform 170ms ease-out',
        boxShadow: compactMobile && backSwipeOffset > 0 ? `-20px 0 40px ${alpha('#020617', 0.24)}` : 'none',
        fontFamily: 'var(--chat-font-family)',
        '& .MuiTypography-root, & button, & input, & textarea': {
          fontFamily: 'var(--chat-font-family)',
        },
      }}
    >
      <ChatThreadHeader
        theme={theme}
        ui={ui}
        isMobile={isMobile}
        compactMobile={compactMobile}
        activeConversation={activeConversation}
        headerSubtitle={headerSubtitle}
        typingLine={typingLine}
        contextPanelOpen={contextPanelOpen}
        onBack={onBack}
        onOpenDrawer={showEmbeddedMenuButton ? openDrawer : undefined}
        onOpenInfo={onOpenInfo}
        onOpenTask={onOpenTask}
        onOpenSearch={onOpenSearch}
        onOpenMenu={onOpenMenu}
        selectionMode={selectionMode}
        selectedMessageCount={selectedMessageCount}
        canCopySelectedMessages={canCopySelectedMessages}
        canDeleteSelectedMessages={canDeleteSelectedMessages}
        onClearMessageSelection={onClearMessageSelection}
        onCopySelectedMessages={onCopySelectedMessages}
        onForwardSelectedMessages={onForwardSelectedMessages}
        onDeleteSelectedMessages={onDeleteSelectedMessages}
      />

      <TaskCompletedBanner
        activeConversation={activeConversation}
        compactMobile={compactMobile}
        onOpenTask={onOpenTask}
        theme={theme}
        ui={ui}
      />

      <PinnedMessageBar
        theme={theme}
        ui={ui}
        compactMobile={compactMobile}
        pinnedMessage={selectionMode ? null : pinnedMessage}
        onOpenPinnedMessage={onOpenPinnedMessage}
        onUnpinPinnedMessage={onUnpinPinnedMessage}
      />

      <AnimatePresence initial={false}>
        {aiRunStatus && aiRunStatus !== 'completed' ? (
          <AiRunStatusBanner
            aiStatus={aiStatus}
            theme={theme}
            ui={ui}
            compactMobile={compactMobile}
          />
        ) : null}
      </AnimatePresence>

      <Box
        ref={threadScrollRef}
        data-testid="chat-thread-scroll"
        className="chat-scroll-hidden chat-native-shell"
        onScroll={handleThreadScroll}
        onWheel={handleThreadWheel}
        onTouchMove={armHistoryAutoLoadIfNearTop}
        onDrop={onComposerDrop}
        onDragOver={onComposerDragOver}
        onDragLeave={onComposerDragLeave}
        sx={{
          ...threadWallpaperSx,
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowAnchor: 'none',
          overscrollBehaviorY: compactMobile ? 'none' : 'contain',
          px: { xs: compactMobile ? 0.7 : 1.8, md: density.threadScrollPxMd || 3.5 },
          pt: { xs: 0.5, md: density.threadScrollPtMd || 1.8 },
          pb: {
            xs: `${scrollBottomPadding}px`,
            md: `${density.threadScrollPbMd || 18}px`,
          },
          scrollPaddingBottom: {
            xs: `${Math.max(24, scrollBottomPadding + 16)}px`,
            md: `${Math.max(28, scrollBottomPadding + 10)}px`,
          },
          position: 'relative',
          userSelect: 'none',
        }}
      >
        <Box sx={{ maxWidth: { xs: '100%', md: `${contentMaxWidth}px` }, mx: 'auto', width: '100%' }}>
          <ChatMessageList
            theme={theme}
            ui={ui}
            isMobile={isMobile}
            compactMobile={compactMobile}
            mobileInteractionsEnabled={resolvedMobileInteractionsEnabled}
            activeConversation={activeConversation}
            navigate={navigate}
            messages={messages}
            messagesLoading={messagesLoading}
            effectiveLastReadMessageId={effectiveLastReadMessageId}
            messagesHasMore={messagesHasMore}
            loadingOlder={loadingOlder}
            onLoadOlder={onLoadOlder}
            historyAutoLoadEnabled={historyAutoLoadEnabled}
            threadScrollRef={threadScrollRef}
            threadContentRef={threadContentRef}
            bottomRef={bottomRef}
            onOpenReads={onOpenReads}
            onOpenAttachmentPreview={onOpenAttachmentPreview}
            onReplyMessage={onReplyMessage}
            onOpenMessageMenu={onOpenMessageMenu}
            onConfirmAction={onConfirmAction}
            onCancelAction={onCancelAction}
            onEditAction={onEditAction}
            selectedMessageIds={selectedMessageIds}
            onToggleMessageSelection={onToggleMessageSelection}
            onStartMessageSelection={onStartMessageSelection}
            highlightedMessageId={highlightedMessageId}
            isFileDragActive={isFileDragActive}
            getReadTargetRef={getReadTargetRef}
            onToggleReaction={onToggleReaction}
            onScrollToMessage={onScrollToMessage}
            currentUserId={currentUserId}
            aiTypingStatus={aiTypingStatus}
          />
        </Box>
      </Box>

      <AnimatePresence initial={false}>{showJumpToLatest ? (
        <Box
          component={motion.div}
          initial={{ opacity: 0, y: 10, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.96 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          sx={{
            position: 'absolute',
            right: { xs: 12, md: 22 },
            bottom: `${jumpToLatestBottomOffset}px`,
            zIndex: 4,
          }}
        >
          <Badge
            badgeContent={Number(activeConversation?.unread_count || 0)}
            color="primary"
            invisible={Number(activeConversation?.unread_count || 0) <= 0}
            overlap="circular"
            anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
          >
            <IconButton
              data-testid="chat-jump-to-latest"
              aria-label="К последним сообщениям"
              onClick={onJumpToLatest}
              sx={{
                width: jumpFabSize,
                height: jumpFabSize,
                minWidth: jumpFabSize,
                minHeight: jumpFabSize,
                p: 0,
                borderRadius: '50%',
                overflow: 'hidden',
                bgcolor: jumpFabBg,
                color: jumpFabIcon,
                boxShadow: jumpFabShadow,
                border: `1px solid ${alpha(jumpFabIcon, theme.palette.mode === 'dark' ? 0.08 : 0.12)}`,
                '&:hover': {
                  bgcolor: jumpFabHoverBg,
                },
                '&:active': compactMobile ? {
                  opacity: 0.72,
                } : undefined,
              }}
            >
              <KeyboardArrowDownRoundedIcon sx={{ fontSize: jumpFabIconSize }} />
            </IconButton>
          </Badge>
        </Box>
      ) : null}</AnimatePresence>

      {selectionMode ? (
        <ChatSelectionActionDock
          theme={theme}
          ui={ui}
          compactMobile={compactMobile}
          selectedMessageCount={selectedMessageCount}
          canReplySelectedMessage={canReplySelectedMessage}
          canDeleteSelectedMessages={canDeleteSelectedMessages}
          onClearMessageSelection={onClearMessageSelection}
          onReplySelectedMessage={onReplySelectedMessage}
          onForwardSelectedMessages={onForwardSelectedMessages}
          onDeleteSelectedMessages={onDeleteSelectedMessages}
        />
      ) : composerTextBridge ? (
        <ChatThreadComposerBridge
          bridge={composerTextBridge}
          composerProps={{
            theme,
            ui,
            compactMobile,
            activeConversationId,
            selectedFiles,
            fileCaption,
            onOpenFileDialog,
            onClearSelectedFiles,
            preparingFiles,
            sendingFiles,
            fileUploadProgress,
            selectedFilesSummary,
            replyMessage,
            onClearReply,
            editingMessage,
            onClearEditing,
            onOpenComposerMenu,
            composerRef,
            onOpenEmojiPicker,
            onCloseEmojiPicker,
            onSendMessage,
            onComposerPaste,
            onComposerDrop,
            onComposerDragOver,
            onComposerDragLeave,
            onComposerFocusChange: handleComposerFocusChange,
            mentionCandidates,
            onSearchMentionPeople,
            composerDockRef,
            keyboardInset,
            mobileEmojiPickerOpen,
            onInsertEmoji,
            onSendSticker,
            onSendGif,
            voiceRecording,
            voiceRecordingDuration,
            voiceRecordingLevelRef,
            onStartVoiceRecording,
            onStopVoiceRecording,
            onCancelVoiceRecording,
          }}
        />
      ) : (
        <ChatComposer
          theme={theme}
          ui={ui}
          compactMobile={compactMobile}
          activeConversationId={activeConversationId}
          selectedFiles={selectedFiles}
          fileCaption={fileCaption}
          onOpenFileDialog={onOpenFileDialog}
          onClearSelectedFiles={onClearSelectedFiles}
          preparingFiles={preparingFiles}
          sendingFiles={sendingFiles}
          fileUploadProgress={fileUploadProgress}
          selectedFilesSummary={selectedFilesSummary}
          replyMessage={replyMessage}
          onClearReply={onClearReply}
          editingMessage={editingMessage}
          onClearEditing={onClearEditing}
          onOpenComposerMenu={onOpenComposerMenu}
          composerRef={composerRef}
          messageText={messageText}
          onMessageTextChange={onMessageTextChange}
          onComposerKeyDown={onComposerKeyDown}
          onComposerSelectionSync={onComposerSelectionSync}
          onOpenEmojiPicker={onOpenEmojiPicker}
          onCloseEmojiPicker={onCloseEmojiPicker}
          onSendMessage={onSendMessage}
          onComposerPaste={onComposerPaste}
          onComposerDrop={onComposerDrop}
          onComposerDragOver={onComposerDragOver}
          onComposerDragLeave={onComposerDragLeave}
          onComposerFocusChange={handleComposerFocusChange}
          mentionCandidates={mentionCandidates}
          onSearchMentionPeople={onSearchMentionPeople}
          composerDockRef={composerDockRef}
          keyboardInset={keyboardInset}
          mobileEmojiPickerOpen={mobileEmojiPickerOpen}
          onInsertEmoji={onInsertEmoji}
          onSendSticker={onSendSticker}
          onSendGif={onSendGif}
          voiceRecording={voiceRecording}
          voiceRecordingDuration={voiceRecordingDuration}
          voiceRecordingLevelRef={voiceRecordingLevelRef}
          onStartVoiceRecording={onStartVoiceRecording}
          onStopVoiceRecording={onStopVoiceRecording}
          onCancelVoiceRecording={onCancelVoiceRecording}
        />
      )}
    </Box>
  );
}

export default memo(ChatThread);
