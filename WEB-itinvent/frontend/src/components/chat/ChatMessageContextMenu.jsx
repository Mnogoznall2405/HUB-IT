import { useMemo, useState } from 'react';
import { Box, Popover } from '@mui/material';
import { alpha } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DoneAllRoundedIcon from '@mui/icons-material/DoneAllRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import ForwardRoundedIcon from '@mui/icons-material/ForwardRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import ReplyRoundedIcon from '@mui/icons-material/ReplyRounded';
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded';

import {
  canDeleteChatMessage,
  canEditChatMessage,
  getMessagePreview,
} from './chatHelpers';

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

export const TELEGRAM_MESSAGE_MENU_REACTIONS = ['❤️', '👍', '🗿', '🔥', '👎', '🥰', '👏', '😁'];
export const TELEGRAM_MESSAGE_MENU_REACTIONS_EXPANDED = ['🤔', '😂', '😮', '😢', '🎉', '💯', '👀', '⚡'];

const ALL_MESSAGE_MENU_REACTIONS = [
  ...TELEGRAM_MESSAGE_MENU_REACTIONS,
  ...TELEGRAM_MESSAGE_MENU_REACTIONS_EXPANDED,
];

function getCollapsedReactionCount(isMobile) {
  return isMobile ? 6 : 8;
}

function getReactionMetrics(isMobile, expanded) {
  if (expanded) {
    return {
      emojiSize: isMobile ? 22 : 24,
      cellSize: isMobile ? 34 : 36,
      cellPadding: '6px',
    };
  }
  return {
    emojiSize: isMobile ? 22 : 24,
    cellSize: null,
    cellPadding: isMobile ? '4px 1px' : '5px 2px',
  };
}

function MessageMenuAction({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  tone = 'default',
  dangerColor,
  textColor,
  hoverBg,
  activeBg,
  compact,
}) {
  return (
    <Box
      component="button"
      type="button"
      role="menuitem"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: compact ? 1.35 : 1.65,
        width: '100%',
        minHeight: compact ? 40 : 44,
        px: compact ? 1.5 : 1.85,
        py: 0,
        border: 'none',
        bgcolor: 'transparent',
        color: tone === 'danger' ? dangerColor : textColor,
        fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
        fontSize: compact ? '0.875rem' : '0.9375rem',
        fontWeight: 400,
        lineHeight: 1.25,
        letterSpacing: '-0.01em',
        textAlign: 'left',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.42 : 1,
        transition: 'background-color 120ms ease, opacity 100ms ease',
        '&:hover': disabled ? undefined : { bgcolor: hoverBg },
        '&:active': disabled ? undefined : { bgcolor: activeBg },
        '& .MuiSvgIcon-root': {
          fontSize: compact ? 20 : 22,
          color: tone === 'danger' ? dangerColor : 'inherit',
          opacity: tone === 'danger' ? 1 : 0.92,
          flexShrink: 0,
        },
      }}
    >
      <Icon />
      <span>{label}</span>
    </Box>
  );
}

export default function ChatMessageContextMenu({
  theme,
  ui,
  open,
  onClose,
  anchorEl,
  anchorPosition,
  usesPointerAnchor = false,
  message,
  activeConversation,
  activeConversationId,
  messageMenuPinned = false,
  onToggleReactionFromMenu,
  onReplyFromMessageMenu,
  onCopyMessage,
  onTogglePinMessageFromMenu,
  onCopyMessageLink,
  onForwardMessageFromMenu,
  onReportMessageFromMenu,
  onSelectMessageFromMenu,
  onEditMessageFromMenu,
  onDeleteMessageFromMenu,
  onOpenReadsFromMessageMenu,
  onOpenAttachmentFromMessageMenu,
  onOpenTaskFromMessageMenu,
}) {
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [reactionsExpanded, setReactionsExpanded] = useState(false);

  const isDarkTheme = theme.palette.mode === 'dark';
  const popupSurface = ui.drawerBg || ui.panelBg || (isDarkTheme ? '#17212b' : '#ffffff');
  const popupSurfaceSoft = ui.surfaceMuted || ui.drawerBgSoft || (isDarkTheme ? '#232e3c' : '#f3f5f7');
  const popupTextColor = ui.textStrong || (isDarkTheme ? '#f5f7fa' : '#17212b');
  const popupHoverBg = ui.drawerHover || ui.surfaceHover || (isDarkTheme ? alpha('#ffffff', 0.07) : alpha('#17212b', 0.06));
  const popupActiveBg = ui.sidebarRowPressed || (isDarkTheme ? alpha('#ffffff', 0.1) : alpha('#17212b', 0.1));
  const popupDangerColor = ui.dangerText || (isDarkTheme ? '#ff7b7b' : '#d94d4d');
  const popupShadow = ui.shadowStrong || (isDarkTheme ? '0 16px 48px rgba(0, 0, 0, 0.44)' : '0 16px 40px rgba(15, 23, 42, 0.18)');

  const activeConversationKind = String(activeConversation?.kind || '').trim();
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  const canCopyMessage = Boolean(String(getMessagePreview(message) || '').trim());
  const canTogglePinMessage = Boolean(message?.id);
  const canCopyMessageLink = Boolean(message?.id && (message?.conversation_id || activeConversationId));
  const canForwardMessage = Boolean(message?.id);
  const canReportMessage = Boolean(message?.id && !message?.is_own);
  const canSelectMessage = Boolean(message?.id);
  const canEditMessage = canEditChatMessage(message);
  const canDeleteMessage = canDeleteChatMessage(message, { conversationKind: activeConversationKind });
  const canOpenReadsFromMessage = activeConversationKind === 'group'
    && Boolean(message?.is_own)
    && Number(message?.read_by_count || 0) > 0;
  const canOpenAttachmentFromMessage = attachments.length > 0;
  const canOpenTaskFromMessage = Boolean(message?.kind === 'task_share' && message?.task_preview?.id);
  const canToggleReactions = typeof onToggleReactionFromMenu === 'function';

  const visibleReactions = useMemo(
    () => (reactionsExpanded
      ? ALL_MESSAGE_MENU_REACTIONS
      : TELEGRAM_MESSAGE_MENU_REACTIONS.slice(0, getCollapsedReactionCount(isMobile))),
    [isMobile, reactionsExpanded],
  );

  const reactionMetrics = getReactionMetrics(isMobile, reactionsExpanded);
  const menuWidth = isMobile ? 228 : 248;
  const reactionBarWidth = reactionsExpanded
    ? `min(calc(100vw - 24px), ${isMobile ? 292 : 320}px)`
    : menuWidth;
  const showExpandButton = ALL_MESSAGE_MENU_REACTIONS.length > getCollapsedReactionCount(isMobile);
  const shellWidth = reactionsExpanded ? reactionBarWidth : menuWidth;

  const handleClose = () => {
    setReactionsExpanded(false);
    onClose?.();
  };

  const handleReaction = (emoji) => {
    onToggleReactionFromMenu?.(message, emoji);
    handleClose();
  };

  return (
    <Popover
      data-testid="chat-message-context-menu"
      open={open}
      onClose={handleClose}
      anchorReference={usesPointerAnchor ? 'anchorPosition' : 'anchorEl'}
      anchorEl={usesPointerAnchor ? undefined : anchorEl}
      anchorPosition={usesPointerAnchor ? anchorPosition : undefined}
      anchorOrigin={usesPointerAnchor ? undefined : { vertical: 'bottom', horizontal: 'center' }}
      transformOrigin={usesPointerAnchor ? { vertical: 'top', horizontal: 'left' } : { vertical: 'top', horizontal: 'center' }}
      disableScrollLock
      slotProps={{
        paper: {
          elevation: 0,
          sx: {
            mt: usesPointerAnchor ? 0 : 0.75,
            bgcolor: 'transparent',
            boxShadow: 'none',
            overflow: 'visible',
            backgroundImage: 'none',
            maxWidth: 'none',
          },
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: isMobile ? 0.55 : 0.65,
          width: shellWidth,
          maxWidth: 'calc(100vw - 20px)',
        }}
      >
        {canToggleReactions ? (
          <Box
            data-testid="chat-message-context-reactions"
            sx={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: reactionsExpanded ? 'wrap' : 'nowrap',
              justifyContent: reactionsExpanded ? 'center' : 'stretch',
              gap: reactionsExpanded ? 0.35 : 0.1,
              width: '100%',
              px: reactionsExpanded ? 0.75 : (isMobile ? 0.55 : 0.65),
              py: reactionsExpanded ? 0.65 : (isMobile ? 0.35 : 0.45),
              borderRadius: reactionsExpanded ? 2.5 : 999,
              bgcolor: popupSurfaceSoft,
              boxShadow: popupShadow,
            }}
          >
            {visibleReactions.map((emoji) => (
              <Box
                key={emoji}
                component="button"
                type="button"
                aria-label={`Реакция ${emoji}`}
                onClick={() => handleReaction(emoji)}
                sx={{
                  flex: reactionsExpanded ? '0 0 auto' : '1 1 0',
                  width: reactionMetrics.cellSize || undefined,
                  height: reactionMetrics.cellSize || undefined,
                  minWidth: reactionsExpanded ? reactionMetrics.cellSize : 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: reactionMetrics.emojiSize,
                  lineHeight: 1,
                  cursor: 'pointer',
                  border: 'none',
                  bgcolor: 'transparent',
                  p: reactionMetrics.cellPadding,
                  borderRadius: 999,
                  transition: 'transform 100ms ease, opacity 100ms ease',
                  '&:hover': { transform: 'scale(1.1)' },
                  '&:active': { transform: 'scale(0.92)', opacity: 0.72 },
                }}
              >
                {emoji}
              </Box>
            ))}
            {showExpandButton ? (
              <Box
                component="button"
                type="button"
                aria-label={reactionsExpanded ? 'Свернуть реакции' : 'Ещё реакции'}
                aria-expanded={reactionsExpanded}
                onClick={() => setReactionsExpanded((current) => !current)}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: isMobile ? 30 : 32,
                  height: isMobile ? 30 : 32,
                  flex: '0 0 auto',
                  flexShrink: 0,
                  ml: reactionsExpanded ? 0 : 0.1,
                  border: 'none',
                  borderRadius: 999,
                  bgcolor: isDarkTheme ? alpha('#ffffff', 0.08) : alpha('#17212b', 0.06),
                  color: popupTextColor,
                  cursor: 'pointer',
                  transition: 'background-color 120ms ease, transform 120ms ease',
                  '&:hover': { bgcolor: popupHoverBg },
                  '&:active': { transform: 'scale(0.94)' },
                }}
              >
                <KeyboardArrowDownRoundedIcon
                  sx={{
                    fontSize: 20,
                    transform: reactionsExpanded ? 'rotate(180deg)' : 'none',
                    transition: 'transform 160ms ease',
                  }}
                />
              </Box>
            ) : null}
          </Box>
        ) : null}

        <Box
          role="menu"
          sx={{
            width: menuWidth,
            alignSelf: reactionsExpanded ? 'center' : 'stretch',
            borderRadius: isMobile ? 2.4 : 3,
            bgcolor: popupSurface,
            boxShadow: popupShadow,
            overflow: 'hidden',
            py: 0.35,
          }}
        >
          <MessageMenuAction
            icon={ReplyRoundedIcon}
            label="Ответить"
            onClick={() => { onReplyFromMessageMenu?.(message); handleClose(); }}
            disabled={!message}
            textColor={popupTextColor}
            hoverBg={popupHoverBg}
            activeBg={popupActiveBg}
            compact={isMobile}
          />
          <MessageMenuAction
            icon={ContentCopyOutlinedIcon}
            label="Копировать текст"
            onClick={() => { onCopyMessage?.(message); handleClose(); }}
            disabled={!message || !canCopyMessage}
            textColor={popupTextColor}
            hoverBg={popupHoverBg}
            activeBg={popupActiveBg}
            compact={isMobile}
          />
          {canCopyMessageLink ? (
            <MessageMenuAction
              icon={LinkRoundedIcon}
              label="Копировать ссылку на сообщение"
              onClick={() => { onCopyMessageLink?.(message); handleClose(); }}
              disabled={!message}
              textColor={popupTextColor}
              hoverBg={popupHoverBg}
              activeBg={popupActiveBg}
              compact={isMobile}
            />
          ) : null}
          <MessageMenuAction
            icon={ForwardRoundedIcon}
            label="Переслать"
            onClick={() => { onForwardMessageFromMenu?.(message); handleClose(); }}
            disabled={!message || !canForwardMessage}
            textColor={popupTextColor}
            hoverBg={popupHoverBg}
            activeBg={popupActiveBg}
            compact={isMobile}
          />
          {canReportMessage ? (
            <MessageMenuAction
              icon={ErrorOutlineRoundedIcon}
              label="Пожаловаться"
              onClick={() => { onReportMessageFromMenu?.(message); handleClose(); }}
              textColor={popupTextColor}
              hoverBg={popupHoverBg}
              activeBg={popupActiveBg}
              compact={isMobile}
            />
          ) : null}
          <MessageMenuAction
            icon={CheckCircleOutlineRoundedIcon}
            label="Выделить"
            onClick={() => { onSelectMessageFromMenu?.(message); handleClose(); }}
            disabled={!message || !canSelectMessage}
            textColor={popupTextColor}
            hoverBg={popupHoverBg}
            activeBg={popupActiveBg}
            compact={isMobile}
          />
          {canEditMessage ? (
            <MessageMenuAction
              icon={EditOutlinedIcon}
              label="Изменить"
              onClick={() => { onEditMessageFromMenu?.(message); handleClose(); }}
              textColor={popupTextColor}
              hoverBg={popupHoverBg}
              activeBg={popupActiveBg}
              compact={isMobile}
            />
          ) : null}
          {canTogglePinMessage ? (
            <MessageMenuAction
              icon={PushPinOutlinedIcon}
              label={messageMenuPinned ? 'Открепить' : 'Закрепить'}
              onClick={() => { onTogglePinMessageFromMenu?.(message); handleClose(); }}
              disabled={!message}
              textColor={popupTextColor}
              hoverBg={popupHoverBg}
              activeBg={popupActiveBg}
              compact={isMobile}
            />
          ) : null}
          {canOpenReadsFromMessage ? (
            <MessageMenuAction
              icon={DoneAllRoundedIcon}
              label="Кто прочитал"
              onClick={() => { onOpenReadsFromMessageMenu?.(message); handleClose(); }}
              textColor={popupTextColor}
              hoverBg={popupHoverBg}
              activeBg={popupActiveBg}
              compact={isMobile}
            />
          ) : null}
          {canOpenAttachmentFromMessage ? (
            <MessageMenuAction
              icon={OpenInNewRoundedIcon}
              label="Открыть вложение"
              onClick={() => { onOpenAttachmentFromMessageMenu?.(message); handleClose(); }}
              textColor={popupTextColor}
              hoverBg={popupHoverBg}
              activeBg={popupActiveBg}
              compact={isMobile}
            />
          ) : null}
          {canOpenTaskFromMessage ? (
            <MessageMenuAction
              icon={TaskAltRoundedIcon}
              label="Открыть задачу"
              onClick={() => { onOpenTaskFromMessageMenu?.(message); handleClose(); }}
              textColor={popupTextColor}
              hoverBg={popupHoverBg}
              activeBg={popupActiveBg}
              compact={isMobile}
            />
          ) : null}
          {canDeleteMessage ? (
            <MessageMenuAction
              icon={DeleteOutlineIcon}
              label="Удалить сообщение"
              onClick={() => { onDeleteMessageFromMenu?.(message); handleClose(); }}
              tone="danger"
              dangerColor={popupDangerColor}
              textColor={popupTextColor}
              hoverBg={popupHoverBg}
              activeBg={popupActiveBg}
              compact={isMobile}
            />
          ) : null}
        </Box>
      </Box>
    </Popover>
  );
}
