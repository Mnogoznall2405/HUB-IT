import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Popover } from '@mui/material';
import { alpha } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DoneAllRoundedIcon from '@mui/icons-material/DoneAllRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ForwardRoundedIcon from '@mui/icons-material/ForwardRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import ReplyRoundedIcon from '@mui/icons-material/ReplyRounded';
import StopCircleOutlinedIcon from '@mui/icons-material/StopCircleOutlined';
import UndoRoundedIcon from '@mui/icons-material/UndoRounded';

import { chatAPI } from '../../api/client';
import {
  canDeleteChatMessage,
  canEditChatMessage,
  formatMessageTime,
  getMessagePreview,
} from './chatHelpers';
import { resolveChatMessagePoll } from './chatStructuredContent';
import { CHAT_FONT_FAMILY } from './chatUiTokens';

import { ChatEmojiImage } from './ChatEmoji';
import {
  TELEGRAM_MESSAGE_MENU_REACTIONS,
  TELEGRAM_MESSAGE_MENU_REACTIONS_EXPANDED,
} from './chatReactions';

export { TELEGRAM_MESSAGE_MENU_REACTIONS, TELEGRAM_MESSAGE_MENU_REACTIONS_EXPANDED };

const ALL_MESSAGE_MENU_REACTIONS = [
  ...TELEGRAM_MESSAGE_MENU_REACTIONS,
  ...TELEGRAM_MESSAGE_MENU_REACTIONS_EXPANDED,
];

const READS_PREVIEW_LIMIT = 6;

function getCollapsedReactionCount(isMobile) {
  return isMobile ? 6 : 8;
}

function getReactionMetrics(isMobile, expanded) {
  if (expanded) {
    return {
      emojiSize: 26,
      cellSize: isMobile ? 34 : 36,
      cellPadding: '4px',
    };
  }
  return {
    // R48: reaction images in the menu strip are 26-28 px.
    emojiSize: 26,
    cellSize: null,
    cellPadding: isMobile ? '4px 1px' : '5px 2px',
  };
}

// Д2-6 (раздел 29, п.4): компактные пункты меню как в Telegram — ~36px,
// шрифт 14, иконки 20px.
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
        gap: 1.25,
        width: '100%',
        minHeight: compact ? 40 : 36,
        px: 1.5,
        py: 0,
        border: 'none',
        bgcolor: 'transparent',
        color: tone === 'danger' ? dangerColor : textColor,
        fontFamily: CHAT_FONT_FAMILY,
        fontSize: '14px',
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
          fontSize: 20,
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
  messageMenuPinned = false,
  onToggleReactionFromMenu,
  onReplyFromMessageMenu,
  onCopyMessage,
  onTogglePinMessageFromMenu,
  onForwardMessageFromMenu,
  onSelectMessageFromMenu,
  onEditMessageFromMenu,
  onDeleteMessageFromMenu,
  onOpenReadsFromMessageMenu,
  onStopPollFromMessageMenu,
  onCancelPollVoteFromMessageMenu,
}) {
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [reactionsExpanded, setReactionsExpanded] = useState(false);
  const [readersPreviewOpen, setReadersPreviewOpen] = useState(false);
  const [readersState, setReadersState] = useState({ status: 'idle', items: [] });
  const readersMessageIdRef = useRef('');

  const isDarkTheme = theme.palette.mode === 'dark';
  const popupSurface = ui.drawerBg || ui.panelBg || (isDarkTheme ? '#17212b' : '#ffffff');
  const popupSurfaceSoft = ui.surfaceMuted || ui.drawerBgSoft || (isDarkTheme ? '#232e3c' : '#f3f5f7');
  const popupTextColor = ui.textStrong || (isDarkTheme ? '#f5f7fa' : '#17212b');
  const popupMetaColor = ui.textSecondary || (isDarkTheme ? 'rgba(255,255,255,0.6)' : '#707579');
  const popupHoverBg = ui.drawerHover || ui.surfaceHover || (isDarkTheme ? alpha('#ffffff', 0.07) : alpha('#17212b', 0.06));
  const popupActiveBg = ui.sidebarRowPressed || (isDarkTheme ? alpha('#ffffff', 0.1) : alpha('#17212b', 0.1));
  const popupDangerColor = ui.dangerText || (isDarkTheme ? '#ff7b7b' : '#d94d4d');
  const popupDividerColor = ui.borderSoft || (isDarkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(175,186,197,0.42)');
  const popupShadow = ui.shadowStrong || (isDarkTheme ? '0 16px 48px rgba(0, 0, 0, 0.44)' : '0 16px 40px rgba(15, 23, 42, 0.18)');

  const activeConversationKind = String(activeConversation?.kind || '').trim();
  const canCopyMessage = Boolean(String(getMessagePreview(message) || '').trim());
  const canTogglePinMessage = Boolean(message?.id);
  const canForwardMessage = Boolean(message?.id);
  const canSelectMessage = Boolean(message?.id);
  const canEditMessage = canEditChatMessage(message);
  const canDeleteMessage = canDeleteChatMessage(message, { conversationKind: activeConversationKind });
  // Д2-6: «Прочитали: N» остаётся внизу меню только для своих сообщений в группах.
  const readByCount = Math.max(0, Number(message?.read_by_count || 0));
  const canShowReadReceipts = activeConversationKind === 'group'
    && Boolean(message?.is_own)
    && readByCount > 0;
  const canToggleReactions = typeof onToggleReactionFromMenu === 'function';
  // R50: действия опроса — только здесь, не в карточке. Остановить может автор своего незакрытого опроса;
  // снять голос — тот, кто проголосовал, пока опрос не закрыт.
  const pollPayload = String(message?.kind || '').trim() === 'poll' ? resolveChatMessagePoll(message) : null;
  const pollOpen = Boolean(pollPayload) && !pollPayload.closed;
  const myPollOption = pollPayload?.my_option_index ?? null;
  const canStopPoll = pollOpen && Boolean(message?.is_own) && typeof onStopPollFromMessageMenu === 'function';
  const canCancelPollVote = pollOpen && myPollOption !== null && myPollOption >= 0
    && typeof onCancelPollVoteFromMessageMenu === 'function';

  const visibleReactions = useMemo(
    () => (reactionsExpanded
      ? ALL_MESSAGE_MENU_REACTIONS
      : TELEGRAM_MESSAGE_MENU_REACTIONS.slice(0, getCollapsedReactionCount(isMobile))),
    [isMobile, reactionsExpanded],
  );

  const reactionMetrics = getReactionMetrics(isMobile, reactionsExpanded);
  const menuWidth = isMobile ? 232 : 240;
  // The collapsed strip carries 8 images of 26 px (6 on a phone), so on desktop it is wider than the menu.
  const collapsedStripWidth = isMobile ? menuWidth : 300;
  const reactionBarWidth = reactionsExpanded
    ? `min(calc(100vw - 24px), ${isMobile ? 292 : 320}px)`
    : collapsedStripWidth;
  const showExpandButton = ALL_MESSAGE_MENU_REACTIONS.length > getCollapsedReactionCount(isMobile);
  const shellWidth = canToggleReactions ? reactionBarWidth : menuWidth;

  const handleClose = () => {
    setReactionsExpanded(false);
    setReadersPreviewOpen(false);
    setReadersState({ status: 'idle', items: [] });
    onClose?.();
  };

  useEffect(() => {
    setReadersPreviewOpen(false);
    setReadersState({ status: 'idle', items: [] });
  }, [open, message?.id]);

  const loadReadersPreview = useCallback(async () => {
    const messageId = String(message?.id || '').trim();
    if (!messageId || typeof chatAPI.getMessageReads !== 'function') return;
    readersMessageIdRef.current = messageId;
    setReadersState((current) => (
      current.status === 'loading' || current.status === 'ready'
        ? current
        : { status: 'loading', items: [] }
    ));
    try {
      const data = await chatAPI.getMessageReads(messageId);
      if (readersMessageIdRef.current !== messageId) return;
      setReadersState({ status: 'ready', items: Array.isArray(data?.items) ? data.items : [] });
    } catch {
      if (readersMessageIdRef.current !== messageId) return;
      setReadersState({ status: 'error', items: [] });
    }
  }, [message?.id]);

  const handleReadsPreviewEnter = useCallback(() => {
    setReadersPreviewOpen(true);
    void loadReadersPreview();
  }, [loadReadersPreview]);

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
              // R41: dark surfaceMuted is white at 4.5% alpha and alpha() REPLACES the alpha, so
              // alpha(surfaceMuted, .94) was a nearly white pill. Dark uses the opaque menu surface.
              bgcolor: isDarkTheme ? popupSurface : alpha(popupSurfaceSoft, 0.94),
              backdropFilter: 'blur(18px) saturate(1.12)',
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
                <ChatEmojiImage emoji={emoji} size={reactionMetrics.emojiSize} style={{ margin: 0, verticalAlign: 'top' }} />
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
            // Д2-6: компактное меню — радиус 12, полупрозрачный фон с блюром.
            borderRadius: '12px',
            bgcolor: alpha(popupSurface, 0.94),
            backdropFilter: 'blur(18px) saturate(1.12)',
            boxShadow: popupShadow,
            overflow: 'hidden',
            py: 0.5,
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
          {canCancelPollVote ? (
            <MessageMenuAction
              icon={UndoRoundedIcon}
              label="Отменить голос"
              onClick={() => { onCancelPollVoteFromMessageMenu?.(message, myPollOption); handleClose(); }}
              textColor={popupTextColor}
              hoverBg={popupHoverBg}
              activeBg={popupActiveBg}
              compact={isMobile}
            />
          ) : null}
          {canStopPoll ? (
            <MessageMenuAction
              icon={StopCircleOutlinedIcon}
              label="Остановить опрос"
              onClick={() => {
                const confirmed = typeof window === 'undefined'
                  || window.confirm('Остановить опрос? После этого голосовать будет нельзя.');
                if (confirmed) onStopPollFromMessageMenu?.(message);
                handleClose();
              }}
              textColor={popupTextColor}
              hoverBg={popupHoverBg}
              activeBg={popupActiveBg}
              compact={isMobile}
            />
          ) : null}
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

          {canShowReadReceipts ? (
            <Box
              sx={{ position: 'relative' }}
              onMouseEnter={handleReadsPreviewEnter}
              onMouseLeave={() => setReadersPreviewOpen(false)}
            >
              <Box sx={{ mx: 0.75, my: 0.35, borderTop: `1px solid ${popupDividerColor}` }} />
              <Box
                component="button"
                type="button"
                role="menuitem"
                aria-label={`Прочитали: ${readByCount}`}
                aria-expanded={readersPreviewOpen}
                data-testid="chat-message-menu-reads"
                onClick={() => { onOpenReadsFromMessageMenu?.(message); handleClose(); }}
                onFocus={handleReadsPreviewEnter}
                onBlur={() => setReadersPreviewOpen(false)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.25,
                  width: '100%',
                  minHeight: isMobile ? 36 : 32,
                  px: 1.5,
                  py: 0,
                  border: 'none',
                  bgcolor: 'transparent',
                  color: popupMetaColor,
                  fontFamily: CHAT_FONT_FAMILY,
                  fontSize: '13px',
                  fontWeight: 400,
                  lineHeight: 1.25,
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'background-color 120ms ease',
                  '&:hover': { bgcolor: popupHoverBg },
                }}
              >
                <DoneAllRoundedIcon
                  sx={{ fontSize: 18, color: ui.statusReadText || popupMetaColor, flexShrink: 0 }}
                />
                <span style={{ flex: 1, minWidth: 0 }}>Прочитали: {readByCount}</span>
              </Box>
              {readersPreviewOpen ? (
                <Box
                  data-testid="chat-message-menu-reads-preview"
                  role="list"
                  aria-label="Список прочитавших"
                  sx={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 'calc(100% - 4px)',
                    zIndex: 2,
                    maxHeight: 196,
                    overflowY: 'auto',
                    overscrollBehavior: 'contain',
                    borderRadius: '10px',
                    bgcolor: alpha(popupSurface, 0.98),
                    backdropFilter: 'blur(18px) saturate(1.12)',
                    boxShadow: popupShadow,
                    py: 0.5,
                  }}
                >
                  {readersState.status === 'error' ? (
                    <Box sx={{ px: 1.5, py: 0.75, fontSize: '13px', color: popupMetaColor }}>
                      Не удалось загрузить список
                    </Box>
                  ) : readersState.status !== 'ready' ? (
                    <Box sx={{ px: 1.5, py: 0.75, fontSize: '13px', color: popupMetaColor }}>
                      Загрузка…
                    </Box>
                  ) : readersState.items.length === 0 ? (
                    <Box sx={{ px: 1.5, py: 0.75, fontSize: '13px', color: popupMetaColor }}>
                      Пока никто не прочитал
                    </Box>
                  ) : (
                    <>
                      {readersState.items.slice(0, READS_PREVIEW_LIMIT).map((item) => {
                        const reader = item?.user || {};
                        const readerName = String(reader.full_name || reader.username || 'Участник').trim();
                        const readAt = formatMessageTime(item?.read_at);
                        const readerKey = String(reader.id || reader.username || readerName);
                        return (
                          <Box
                            key={`${readerKey}-${String(item?.read_at || '')}`}
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 1,
                              px: 1.5,
                              minHeight: 30,
                              fontSize: '13px',
                              color: popupTextColor,
                            }}
                          >
                            <Box component="span" sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {readerName}
                            </Box>
                            {readAt ? (
                              <Box component="span" sx={{ flexShrink: 0, fontSize: '12px', color: popupMetaColor, fontVariantNumeric: 'tabular-nums' }}>
                                {readAt}
                              </Box>
                            ) : null}
                          </Box>
                        );
                      })}
                      {readersState.items.length > READS_PREVIEW_LIMIT ? (
                        <Box sx={{ px: 1.5, py: 0.75, fontSize: '12px', color: popupMetaColor }}>
                          …и ещё {readersState.items.length - READS_PREVIEW_LIMIT}
                        </Box>
                      ) : null}
                    </>
                  )}
                </Box>
              ) : null}
            </Box>
          ) : null}
        </Box>
      </Box>
    </Popover>
  );
}
