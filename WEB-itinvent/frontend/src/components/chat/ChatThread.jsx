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
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import ForwardRoundedIcon from '@mui/icons-material/ForwardRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import { AnimatePresence, motion } from 'framer-motion';

import { PresenceAvatar } from './ChatCommon';
import ChatComposer from './ChatComposer';
import ChatMessageList from './ChatMessageList';
import ChatSelectionActionDock from './ChatSelectionActionDock';
import { useMainLayoutShell } from '../layout/MainLayoutShellContext';
import {
  CHAT_THREAD_NEAR_BOTTOM_DISTANCE_PX,
} from './chatHelpers';

export {
  ChatBubble,
  isMobileMessageLongPress,
  shouldAnimateChatBubble,
  shouldCancelLongPressMove,
  shouldSuppressNativeMessageGesture,
} from './ChatBubble';
export { getComposerMentionTrigger } from './ChatComposer';

const COMPOSER_STICK_DISTANCE_PX = CHAT_THREAD_NEAR_BOTTOM_DISTANCE_PX;
const BLUR_SCROLL_DELTA_PX = 12;
const BACK_SWIPE_EDGE_PX = 28;
const BACK_SWIPE_START_PX = 14;
const BACK_SWIPE_TRIGGER_PX = 84;
const HISTORY_AUTO_LOAD_ARM_DISTANCE_PX = 160;
const TELEGRAM_CHAT_FONT_FAMILY = [
  '"SF Pro Text"',
  '"SF Pro Display"',
  '"Segoe UI Variable Text"',
  '"Segoe UI"',
  'Roboto',
  'Helvetica',
  'Arial',
  'sans-serif',
].join(', ');
const CHAT_FONT_SIZES = {
  meta: '12px',
  previewLabel: '12px',
  previewTitle: '14px',
  previewBody: '13px',
  sender: '15px',
  body: '17px',
  headerTitleMobile: '17.5px',
  headerSubtitleMobile: '13px',
  composer: '17px',
  composerAux: '13px',
};

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
  const baseGap = compactMobile ? 8 : 18;
  const keyboardSpacer = getChatKeyboardBottomSpacer({
    compactMobile,
    keyboardInset,
    composerHeight: measuredComposerHeight,
  });
  return Math.max(baseGap, Math.round(baseGap + keyboardSpacer));
};

function HeaderAction({ title, children, onClick, active = false, compactMobile = false, hidden = false, disabled = false }) {
  if (hidden) return null;
  return (
    <Tooltip title={title}>
      <span>
        <IconButton
          size="small"
          aria-label={title}
          onClick={onClick}
          disabled={disabled}
          sx={{
            width: compactMobile ? 32 : 34,
            height: compactMobile ? 32 : 34,
            borderRadius: 0,
            color: active ? 'var(--chat-action-active-text)' : 'inherit',
            bgcolor: 'transparent',
            transition: 'opacity 100ms ease, background-color 120ms ease, transform 120ms ease',
            ...(compactMobile ? {
              '&:active': {
                opacity: 0.62,
                transform: 'scale(0.96)',
              },
            } : {
              '&:hover': {
                bgcolor: active ? 'var(--chat-action-active-bg)' : 'var(--chat-action-hover-bg)',
              },
            }),
            '&.Mui-disabled': {
              opacity: 0.36,
              color: 'inherit',
            },
          }}
        >
          {children}
        </IconButton>
      </span>
    </Tooltip>
  );
}

function AiRunStatusBanner({ aiStatus, theme, ui, compactMobile = false }) {
  const status = String(aiStatus?.status || '').trim();
  if (!status || status === 'completed') return null;
  const label = status === 'queued'
    ? 'AI поставлен в очередь'
    : status === 'running'
      ? 'AI анализирует запрос и файлы'
      : 'AI не смог обработать запрос';
  const tone = status === 'failed'
    ? {
      bg: alpha(theme.palette.error.main, theme.palette.mode === 'dark' ? 0.16 : 0.1),
      border: alpha(theme.palette.error.main, 0.22),
      text: theme.palette.error.main,
    }
    : {
      bg: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.1),
      border: alpha(theme.palette.primary.main, 0.22),
      text: ui.accentText,
    };
  return (
    <Box
      sx={{
        px: compactMobile ? 1.5 : 2,
        py: 1.1,
        borderBottom: `1px solid ${ui.borderSoft}`,
        backgroundColor: tone.bg,
      }}
    >
      <Typography sx={{ fontSize: compactMobile ? 13 : 13.5, fontWeight: 700, color: tone.text, fontFamily: TELEGRAM_CHAT_FONT_FAMILY }}>
        {label}
      </Typography>
      {status === 'failed' && aiStatus?.error_text ? (
        <Typography sx={{ mt: 0.4, fontSize: 12.5, color: ui.textSecondary, fontFamily: TELEGRAM_CHAT_FONT_FAMILY }}>
          {aiStatus.error_text}
        </Typography>
      ) : null}
    </Box>
  );
}

function AiInteractiveStatusBanner({ aiStatusDisplay, theme, ui, compactMobile = false }) {
  if (!aiStatusDisplay?.visible) return null;
  const tone = aiStatusDisplay.tone === 'error'
    ? {
      bg: alpha(theme.palette.error.main, theme.palette.mode === 'dark' ? 0.16 : 0.1),
      border: alpha(theme.palette.error.main, 0.22),
      text: theme.palette.error.main,
    }
    : {
      bg: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.1),
      border: alpha(theme.palette.primary.main, 0.22),
      text: ui.accentText,
    };
  return (
    <motion.div
      key={`${aiStatusDisplay.status}:${aiStatusDisplay.stage}:${aiStatusDisplay.primaryText}`}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      <Box
        sx={{
          px: compactMobile ? 1.5 : 2,
          py: 1.1,
          borderBottom: `1px solid ${ui.borderSoft}`,
          backgroundColor: tone.bg,
        }}
      >
        <Stack direction="row" spacing={1.1} alignItems="flex-start">
          {aiStatusDisplay.showSpinner ? (
            <CircularProgress
              size={compactMobile ? 15 : 16}
              thickness={5}
              sx={{ mt: 0.15, color: tone.text, flexShrink: 0 }}
            />
          ) : (
            <SmartToyOutlinedIcon sx={{ mt: 0.05, fontSize: 17, color: tone.text, flexShrink: 0 }} />
          )}
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: compactMobile ? 13 : 13.5, fontWeight: 700, color: tone.text, fontFamily: TELEGRAM_CHAT_FONT_FAMILY }}>
              {aiStatusDisplay.primaryText}
            </Typography>
            {aiStatusDisplay.secondaryText ? (
              <Typography sx={{ mt: 0.4, fontSize: 12.5, color: ui.textSecondary, fontFamily: TELEGRAM_CHAT_FONT_FAMILY }}>
                {aiStatusDisplay.secondaryText}
              </Typography>
            ) : null}
          </Box>
        </Stack>
      </Box>
    </motion.div>
  );
}

const ChatThreadHeader = memo(function ChatThreadHeader({
  theme,
  ui,
  isMobile,
  compactMobile,
  activeConversation,
  headerSubtitle,
  typingLine,
  contextPanelOpen,
  onBack,
  onOpenDrawer,
  onOpenInfo,
  onOpenSearch,
  onOpenMenu,
  selectionMode = false,
  selectedMessageCount = 0,
  canCopySelectedMessages = false,
  onClearMessageSelection,
  onCopySelectedMessages,
  onForwardSelectedMessages,
}) {
  const headerShellSx = {
    px: { xs: compactMobile ? 0.65 : 1.15, md: 1.6 },
    pb: compactMobile ? 0.45 : 0.78,
    bgcolor: ui.threadTopbarBg,
    backdropFilter: 'blur(16px)',
    position: 'sticky',
    top: 0,
    zIndex: 5,
    boxShadow: theme.palette.mode === 'dark' ? 'none' : `0 1px 0 ${ui.borderSoft}, 0 6px 14px ${alpha('#000', 0.06)}`,
    borderBottom: theme.palette.mode === 'dark' ? `0.5px solid ${ui.borderSoft}` : 'none',
  };
  const headerContentSx = {
    maxWidth: compactMobile ? '100%' : `${Number(ui.contentMaxWidth || 980) + 56}px`,
    mx: 'auto',
    width: '100%',
  };

  if (selectionMode && compactMobile) {
    const selectionIconButtonSx = {
      width: 38,
      height: 38,
      borderRadius: 0,
      color: theme.palette.text.primary,
      bgcolor: 'transparent',
      transition: 'opacity 120ms ease, transform 120ms ease',
      '&:active': {
        opacity: 0.62,
        transform: 'scale(0.96)',
      },
      '&:disabled': {
        opacity: 0.34,
      },
    };

    return (
      <Box
        className="chat-safe-top chat-no-select"
        data-testid="chat-selection-toolbar"
        sx={{
          ...headerShellSx,
          px: 0.65,
          pb: 0.3,
          bgcolor: alpha(ui.threadTopbarBg || theme.palette.background.paper, 0.98),
          backdropFilter: 'blur(18px) saturate(1.06)',
          borderBottom: `1px solid ${ui.borderSoft || alpha(theme.palette.divider, 0.14)}`,
          boxShadow: 'none',
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{
            ...headerContentSx,
            minHeight: 44,
          }}
        >
          <Stack direction="row" spacing={0.9} alignItems="center" sx={{ minWidth: 0 }}>
            <IconButton
              data-testid="chat-selection-clear"
              aria-label="Отменить выделение"
              onClick={onClearMessageSelection}
              sx={selectionIconButtonSx}
            >
              <CloseRoundedIcon sx={{ fontSize: 28 }} />
            </IconButton>
            <Typography
              data-testid="chat-selection-count-badge"
              sx={{
                color: theme.palette.text.primary,
                fontSize: 21,
                fontWeight: 700,
                lineHeight: 1,
                fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
              }}
            >
              {selectedMessageCount}
            </Typography>
          </Stack>

          <Stack direction="row" spacing={0.65} alignItems="center">
            <IconButton
              data-testid="chat-selection-copy-action"
              aria-label="Копировать"
              disabled={!canCopySelectedMessages || selectedMessageCount <= 0 || typeof onCopySelectedMessages !== 'function'}
              onClick={onCopySelectedMessages}
              sx={selectionIconButtonSx}
            >
              <ContentCopyRoundedIcon sx={{ fontSize: 25 }} />
            </IconButton>
            <IconButton
              data-testid="chat-selection-header-forward-action"
              aria-label="Переслать"
              disabled={selectedMessageCount <= 0 || typeof onForwardSelectedMessages !== 'function'}
              onClick={onForwardSelectedMessages}
              sx={selectionIconButtonSx}
            >
              <ForwardRoundedIcon sx={{ fontSize: 27 }} />
            </IconButton>
          </Stack>
        </Stack>
      </Box>
    );
  }

  if (selectionMode) {
    return (
      <Box className="chat-safe-top chat-no-select" data-testid="chat-selection-toolbar" sx={headerShellSx}>
        <Stack
          direction="row"
          spacing={compactMobile ? 0.85 : 1.05}
          alignItems="center"
          justifyContent="space-between"
          sx={headerContentSx}
        >
          <Stack direction="row" spacing={compactMobile ? 0.75 : 1} alignItems="center" sx={{ minWidth: 0 }}>
            {isMobile ? (
              <IconButton
                size="small"
                onClick={onBack}
                aria-label="Назад к чатам"
                sx={{
                  ml: -0.2,
                  width: compactMobile ? 34 : 38,
                  height: compactMobile ? 34 : 38,
                  borderRadius: 0,
                  bgcolor: 'transparent',
                }}
              >
                <ArrowBackRoundedIcon />
              </IconButton>
            ) : null}
            <Box
              data-testid="chat-selection-count-badge"
              sx={{
                width: compactMobile ? 34 : 36,
                height: compactMobile ? 34 : 36,
                borderRadius: 999,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                bgcolor: ui.accentText || theme.palette.primary.main,
                color: theme.palette.primary.contrastText,
                fontWeight: 850,
                fontSize: compactMobile ? 16 : 17,
                fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
              }}
            >
              {selectedMessageCount}
            </Box>
            <Box
              component="button"
              type="button"
              onClick={onOpenInfo}
              aria-label="Информация о чате"
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: compactMobile ? '10px' : '12px',
                p: 0,
                border: 'none',
                bgcolor: 'transparent',
                color: theme.palette.text.primary,
                textAlign: 'left',
                cursor: 'pointer',
                minWidth: 0,
              }}
            >
              <PresenceAvatar
                item={activeConversation.kind === 'direct' ? (activeConversation.direct_peer || activeConversation) : activeConversation}
                online={Boolean(activeConversation?.kind === 'direct' && activeConversation?.direct_peer?.presence?.is_online)}
                size={compactMobile ? 40 : 42}
              />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.1, color: theme.palette.text.primary, fontSize: compactMobile ? CHAT_FONT_SIZES.headerTitleMobile : '1.02rem', letterSpacing: '-0.01em', fontFamily: TELEGRAM_CHAT_FONT_FAMILY }} noWrap>
                  {activeConversation.title}
                </Typography>
                <Typography variant="caption" sx={{ color: ui.textSecondary, fontSize: compactMobile ? CHAT_FONT_SIZES.previewBody : '0.82rem', lineHeight: 1.12, fontFamily: TELEGRAM_CHAT_FONT_FAMILY }} noWrap>
                  {typingLine || headerSubtitle}
                </Typography>
              </Box>
            </Box>
          </Stack>

          <HeaderAction
            title="Действия чата"
            onClick={onOpenMenu}
            active={contextPanelOpen}
            compactMobile={compactMobile}
          >
            <MoreVertRoundedIcon fontSize="small" />
          </HeaderAction>
        </Stack>
      </Box>
    );
  }

  return (
    <Box
      className="chat-safe-top chat-no-select"
      sx={headerShellSx}
    >
      <Stack
        direction="row"
        spacing={compactMobile ? 0.85 : 1.05}
        alignItems="center"
        justifyContent="space-between"
        sx={{
          ...headerContentSx,
        }}
      >
        <Stack direction="row" spacing={compactMobile ? 0.75 : 1} alignItems="center" sx={{ minWidth: 0 }}>
          {isMobile ? (
            <IconButton
              size="small"
              onClick={onBack}
              aria-label="Назад к чатам"
              sx={{
                ml: -0.2,
                width: compactMobile ? 34 : 38,
                height: compactMobile ? 34 : 38,
                borderRadius: 0,
                bgcolor: 'transparent',
                '&:active': compactMobile ? {
                  opacity: 0.62,
                  transform: 'scale(0.96)',
                } : undefined,
              }}
            >
              <ArrowBackRoundedIcon />
            </IconButton>
          ) : null}

          <Box
            component="button"
            type="button"
            onClick={onOpenInfo}
            aria-label="Информация о чате"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: compactMobile ? '10px' : '12px',
              p: 0,
              border: 'none',
              bgcolor: 'transparent',
              color: theme.palette.text.primary,
              textAlign: 'left',
              cursor: 'pointer',
              minWidth: 0,
              '&:active': compactMobile ? {
                opacity: 0.72,
              } : undefined,
            }}
          >
            <PresenceAvatar
              item={activeConversation.kind === 'direct' ? (activeConversation.direct_peer || activeConversation) : activeConversation}
              online={Boolean(activeConversation?.kind === 'direct' && activeConversation?.direct_peer?.presence?.is_online)}
              size={compactMobile ? 40 : 42}
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.1, color: theme.palette.text.primary, fontSize: compactMobile ? CHAT_FONT_SIZES.headerTitleMobile : '1.02rem', letterSpacing: '-0.01em', fontFamily: TELEGRAM_CHAT_FONT_FAMILY }} noWrap>
                {activeConversation.title}
              </Typography>
              <Typography variant="caption" sx={{ color: ui.textSecondary, fontSize: compactMobile ? CHAT_FONT_SIZES.previewBody : '0.82rem', lineHeight: 1.12, fontFamily: TELEGRAM_CHAT_FONT_FAMILY }} noWrap>
                {typingLine || headerSubtitle}
              </Typography>
            </Box>
          </Box>
        </Stack>

        <Stack direction="row" spacing={0.1} alignItems="center">
          <HeaderAction title="Поиск по сообщениям" onClick={onOpenSearch} compactMobile={compactMobile} hidden={compactMobile}>
            <SearchRoundedIcon fontSize="small" />
          </HeaderAction>
          <HeaderAction
            title="Действия чата"
            onClick={onOpenMenu}
            active={contextPanelOpen}
            compactMobile={compactMobile}
          >
            <MoreVertRoundedIcon fontSize="small" />
          </HeaderAction>
        </Stack>
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

  const previewText = String(pinnedMessage?.preview || '').trim() || 'Сообщение';
  const senderName = String(pinnedMessage?.senderName || '').trim();

  return (
    <Box
      sx={{
        px: { xs: compactMobile ? 0.75 : 1.35, md: 1.8 },
        py: compactMobile ? 0.48 : 0.62,
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
          maxWidth: compactMobile ? '100%' : `${Number(ui.contentMaxWidth || 980) + 56}px`,
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
              width: 30,
              height: 30,
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
            width: compactMobile ? 34 : 32,
            height: compactMobile ? 34 : 32,
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
  onLoadOlder,
  threadScrollRef,
  threadContentRef,
  onThreadScroll,
  bottomRef,
  onBack,
  onOpenInfo,
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
  onStartVoiceRecording,
  onStopVoiceRecording,
  onCancelVoiceRecording,
}) {
  const { openDrawer, headerMode } = useMainLayoutShell();
  const resolvedMobileInteractionsEnabled = Boolean(mobileInteractionsEnabled || isMobile);
  const composerDockRef = useRef(null);
  const lastScrollTopRef = useRef(0);
  const composerFocusedRef = useRef(false);
  const threadPinnedToBottomRef = useRef(true);
  const previousComposerLayoutRef = useRef({ composerHeight: null, keyboardInset: null });
  const messageReactionMetricsRef = useRef(new Map());
  const previousSelectionModeRef = useRef(false);
  const backSwipeRef = useRef({ tracking: false, engaged: false, startX: 0, startY: 0 });
  const [composerHeight, setComposerHeight] = useState(compactMobile ? 92 : 102);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [backSwipeOffset, setBackSwipeOffset] = useState(0);
  const hasConversationTarget = Boolean(String(activeConversationId || '').trim());
  const showConversationLoadingState = !activeConversation && (messagesLoading || hasConversationTarget);
  const showEmbeddedMenuButton = compactMobile && headerMode !== 'notifications-only';
  const selectionMode = Number(selectedMessageCount || 0) > 0;
  const servicePillBg = ui.servicePillBg || alpha(ui.composerDockBg || ui.panelBg || theme.palette.background.paper, 0.78);
  const servicePillText = ui.servicePillText || ui.textSecondary;
  const jumpPillBg = ui.jumpPillBg || theme.palette.primary.main;
  const jumpPillText = ui.jumpPillText || theme.palette.primary.contrastText;
  const contentMaxWidth = Number(ui.contentMaxWidth || 980);
  const scrollBottomPadding = getChatThreadBottomPadding({
    compactMobile,
    keyboardInset,
    composerHeight,
  });
  const messageCount = Array.isArray(messages) ? messages.length : 0;
  const [stickyDateLabel, setStickyDateLabel] = useState('');
  const [historyAutoLoadEnabled, setHistoryAutoLoadEnabled] = useState(false);
  const stickyDateLabelRef = useRef('');
  const stickyDateFrameRef = useRef(null);
  const stickyDateAnchorsRef = useRef([]);

  useEffect(() => {
    setHistoryAutoLoadEnabled(false);
  }, [activeConversationId]);

  const armHistoryAutoLoadIfNearTop = useCallback((event) => {
    if (historyAutoLoadEnabled) return;
    const node = event?.currentTarget;
    if (!node) return;
    const scrollTop = Number(node.scrollTop || 0);
    if (scrollTop > HISTORY_AUTO_LOAD_ARM_DISTANCE_PX) return;
    setHistoryAutoLoadEnabled(true);
  }, [historyAutoLoadEnabled]);

  const handleThreadWheel = useCallback((event) => {
    const deltaY = Number(event?.deltaY ?? event?.nativeEvent?.deltaY ?? 0);
    if (deltaY <= 0) {
      armHistoryAutoLoadIfNearTop(event);
    }
  }, [armHistoryAutoLoadIfNearTop]);

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
      container.scrollTop = preservedScrollTop;
      lastScrollTopRef.current = preservedScrollTop;
    });
  }, [selectionMode, threadScrollRef]);

  const scrollPinnedThreadToBottom = useCallback(({ settleFrames = 1 } = {}) => {
    const container = threadScrollRef.current;
    if (!container || !threadPinnedToBottomRef.current) return;

    const scrollToBottom = () => {
      const nextScrollTop = Math.max(0, Number(container.scrollHeight || 0) - Number(container.clientHeight || 0));
      container.scrollTop = nextScrollTop;
      lastScrollTopRef.current = nextScrollTop;
    };

    scrollToBottom();

    let remainingFrames = Math.max(0, Math.floor(Number(settleFrames || 0)));
    if (remainingFrames <= 0) return;

    const settle = () => {
      if (!threadPinnedToBottomRef.current) return;
      scrollToBottom();
      remainingFrames -= 1;
      if (remainingFrames > 0) {
        window.requestAnimationFrame(settle);
      }
    };

    window.requestAnimationFrame(settle);
  }, [threadScrollRef]);

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
    if (!heightChanged && !insetChanged) return;

    scrollPinnedThreadToBottom({ settleFrames: 2 });
  }, [composerHeight, keyboardInset, scrollPinnedThreadToBottom]);

  useLayoutEffect(() => {
    const container = threadScrollRef.current;
    const content = threadContentRef?.current;
    if (!container || !content) return;

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
      threadPinnedToBottomRef.current = distanceFromBottom <= COMPOSER_STICK_DISTANCE_PX;
      return;
    }

    const maxScrollTop = Math.max(0, Number(container.scrollHeight || 0) - Number(container.clientHeight || 0));
    const nextScrollTop = Math.max(0, Math.min(maxScrollTop, scrollTop + compensation));
    container.scrollTop = nextScrollTop;
    lastScrollTopRef.current = nextScrollTop;
    const distanceFromBottom = Number(container.scrollHeight || 0) - nextScrollTop - Number(container.clientHeight || 0);
    threadPinnedToBottomRef.current = distanceFromBottom <= COMPOSER_STICK_DISTANCE_PX;
  }, [messages, threadContentRef, threadScrollRef]);

  // Простое отслеживание клавиатуры через resize окна
  useEffect(() => {
    if (!compactMobile) {
      setKeyboardInset(0);
      return undefined;
    }

    let lastHeight = window.innerHeight;
    const onResize = () => {
      const diff = lastHeight - window.innerHeight;
      if (Math.abs(diff) > 50) {
        lastHeight = window.innerHeight;
        setKeyboardInset(diff > 0 ? diff : 0);
      }
    };

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [compactMobile]);

  useLayoutEffect(() => {
    if (!compactMobile || !threadScrollRef.current) return undefined;
    const container = threadScrollRef.current;
    if (!container) return undefined;

    const refreshStickyDateAnchors = () => {
      stickyDateAnchorsRef.current = Array.from(container.querySelectorAll('[data-message-date]'))
        .map((el) => ({
          top: Number(el.offsetTop || 0),
          label: String(el.dataset.messageDate || '').trim(),
        }))
        .filter((item) => item.label);
    };

    const updateVisibleDateNow = () => {
      stickyDateFrameRef.current = null;
      const messageElements = stickyDateAnchorsRef.current;
      let currentLabel = '';
      const thresholdTop = Number(container.scrollTop || 0) + 100;
      messageElements.forEach((el) => {
        const elementTop = Number(el.top || 0);
        if (elementTop <= thresholdTop) {
          currentLabel = el.label || currentLabel;
        }
      });
      if (currentLabel && currentLabel !== stickyDateLabelRef.current) {
        stickyDateLabelRef.current = currentLabel;
        setStickyDateLabel(currentLabel);
      }
    };

    const scheduleVisibleDateUpdate = () => {
      if (stickyDateFrameRef.current !== null) return;
      stickyDateFrameRef.current = window.requestAnimationFrame(updateVisibleDateNow);
    };

    refreshStickyDateAnchors();
    scheduleVisibleDateUpdate();
    const resizeTarget = threadContentRef?.current || container;
    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
        refreshStickyDateAnchors();
        scheduleVisibleDateUpdate();
      })
      : null;
    resizeObserver?.observe?.(resizeTarget);

    container.addEventListener('scroll', scheduleVisibleDateUpdate, { passive: true });
    return () => {
      container.removeEventListener('scroll', scheduleVisibleDateUpdate);
      resizeObserver?.disconnect?.();
      if (stickyDateFrameRef.current !== null) {
        window.cancelAnimationFrame(stickyDateFrameRef.current);
        stickyDateFrameRef.current = null;
      }
    };
  }, [compactMobile, messageCount, threadContentRef, threadScrollRef]);

  // На Android клавиатура сжимает visualViewport — скроллим при каждом изменении
  const handleComposerFocusChange = useCallback((focused) => {
    composerFocusedRef.current = Boolean(focused);
    onComposerFocusChange?.(focused);
    if (!focused) return;
    if (!threadPinnedToBottomRef.current) return;

    let scrollFrameId = null;
    let remainingFrames = 2;
    const scrollToEnd = () => {
      if (!composerFocusedRef.current || !threadPinnedToBottomRef.current) return;
      if (scrollFrameId) return;
      scrollFrameId = window.requestAnimationFrame(() => {
        scrollFrameId = null;
        if (!composerFocusedRef.current || !threadPinnedToBottomRef.current) return;
        scrollPinnedThreadToBottom({ settleFrames: 0 });
        remainingFrames -= 1;
        if (remainingFrames > 0) scrollToEnd();
      });
    };

    if (window.visualViewport) {
      const vp = window.visualViewport;
      vp.addEventListener('resize', scrollToEnd);
      vp.addEventListener('scroll', scrollToEnd);
      setTimeout(() => {
        vp.removeEventListener('resize', scrollToEnd);
        vp.removeEventListener('scroll', scrollToEnd);
        if (scrollFrameId) {
          window.cancelAnimationFrame(scrollFrameId);
          scrollFrameId = null;
        }
      }, 2000);
    }
  }, [onComposerFocusChange, scrollPinnedThreadToBottom]);

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
  }, [composerRef, historyAutoLoadEnabled, onThreadScroll]);

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
        '--chat-font-family': TELEGRAM_CHAT_FONT_FAMILY,
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
        onOpenSearch={onOpenSearch}
        onOpenMenu={onOpenMenu}
        selectionMode={selectionMode}
        selectedMessageCount={selectedMessageCount}
        canCopySelectedMessages={canCopySelectedMessages}
        onClearMessageSelection={onClearMessageSelection}
        onCopySelectedMessages={onCopySelectedMessages}
        onForwardSelectedMessages={onForwardSelectedMessages}
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
        {aiStatus?.status === 'failed' ? (
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
          px: { xs: compactMobile ? 0.7 : 1.8, md: 3.5 },
          pt: { xs: 0.5, md: 1.8 },
          pb: {
            xs: `${scrollBottomPadding}px`,
            md: '18px',
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
          {compactMobile && stickyDateLabel && (
            <div
              className="pointer-events-none sticky z-50 flex h-0 justify-center"
              style={{ top: 4 }}
            >
              <div
                className="rounded-full border px-2 py-0.5 text-[11px] font-semibold backdrop-blur-xl"
                style={{
                  backgroundColor: servicePillBg,
                  color: servicePillText,
                  borderColor: ui.borderSoft,
                  minWidth: '70px',
                  textAlign: 'center',
                  transform: 'translateY(4px)',
                }}
              >
                {stickyDateLabel}
              </div>
            </div>
          )}

          <ChatMessageList
            theme={theme}
            ui={ui}
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
            bottom: {
              xs: `${Math.max(12, keyboardInset + (selectionMode ? 92 : 10))}px`,
              md: selectionMode ? '96px' : '20px',
            },
            zIndex: 4,
          }}
        >
          <Badge
            badgeContent={Number(activeConversation?.unread_count || 0)}
            color="primary"
            invisible={Number(activeConversation?.unread_count || 0) <= 0}
          >
            <Button
              variant="contained"
              size="small"
              onClick={onJumpToLatest}
              endIcon={<KeyboardArrowDownRoundedIcon />}
              sx={{
                borderRadius: compactMobile ? 999 : 1.35,
                boxShadow: compactMobile ? '0 6px 14px rgba(6, 18, 32, 0.14)' : ui.shadowStrong,
                textTransform: 'none',
                px: compactMobile ? 0.95 : 1.15,
                minWidth: compactMobile ? 0 : undefined,
                bgcolor: jumpPillBg,
                color: jumpPillText,
                minHeight: compactMobile ? 30 : 34,
                fontSize: compactMobile ? '12px' : '0.78rem',
                fontWeight: 700,
                '&:active': compactMobile ? {
                  opacity: 0.62,
                } : undefined,
              }}
            >
              К последним
            </Button>
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
          onStartVoiceRecording={onStartVoiceRecording}
          onStopVoiceRecording={onStopVoiceRecording}
          onCancelVoiceRecording={onCancelVoiceRecording}
        />
      )}
    </Box>
  );
}

export default memo(ChatThread);
