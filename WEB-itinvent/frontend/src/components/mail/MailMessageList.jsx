import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Menu,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import ArchiveRoundedIcon from '@mui/icons-material/ArchiveRounded';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import DeleteForeverRoundedIcon from '@mui/icons-material/DeleteForeverRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import DragIndicatorRoundedIcon from '@mui/icons-material/DragIndicatorRounded';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import InboxIcon from '@mui/icons-material/Inbox';
import MarkEmailReadRoundedIcon from '@mui/icons-material/MarkEmailReadRounded';
import MarkEmailUnreadRoundedIcon from '@mui/icons-material/MarkEmailUnreadRounded';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import PrintOutlinedIcon from '@mui/icons-material/PrintOutlined';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import RestoreFromTrashRoundedIcon from '@mui/icons-material/RestoreFromTrashRounded';
import SubjectRoundedIcon from '@mui/icons-material/SubjectRounded';
import { motion } from 'framer-motion';
import {
  buildMailUiTokens,
  getMailIconButtonSx,
  getMailMenuPaperSx,
  getMailMetaTextSx,
  getMailSurfaceButtonSx,
} from './mailUiTokens';
import { formatMailPeopleLine, getMailPersonDisplay } from './mailPeople';
import { formatPrimaryCorrespondentLabel, getPrimaryCorrespondent } from './mailCorrespondent';
import { MailCompactMenuItem, MailMoveSection } from './MailMoveToMenu';
import { filterMailMoveTargets } from './mailMoveTargets';
import { buildMailMonthGroups } from './mailDateGrouping';
import { formatFullDate } from './mailMessagePresentation';

const LONG_PRESS_MS = 420;
const SWIPE_AXIS_LOCK_THRESHOLD = 10;
const SWIPE_REVEAL_THRESHOLD = 50;
const SWIPE_COMMIT_THRESHOLD = 132;
const SWIPE_REVEAL_OFFSET = 78;
const SWIPE_COMMIT_OFFSET = 164;
const SWIPE_MAX_OFFSET = 168;

function assignRef(ref, value) {
  if (!ref) return;
  if (typeof ref === 'function') {
    ref(value);
    return;
  }
  ref.current = value;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatParticipantLine(participants) {
  return formatMailPeopleLine(participants, '-');
}

function getReadActionMeta({ folder, unread, tokens }) {
  if (folder === 'trash') {
    return {
      key: 'restore',
      label: 'Восстановить',
      shortLabel: 'Вернуть',
      color: tokens.isDark ? '#bfdbfe' : '#1d4ed8',
      icon: <RestoreFromTrashRoundedIcon fontSize="small" />,
    };
  }

  if (unread) {
    return {
      key: 'mark-read',
      label: 'Прочитано',
      shortLabel: 'Прочитано',
      color: tokens.isDark ? '#bfdbfe' : '#1d4ed8',
      icon: <MarkEmailReadRoundedIcon fontSize="small" />,
    };
  }

  return {
    key: 'mark-unread',
    label: 'Непрочитано',
    shortLabel: 'Не прочт.',
    color: tokens.isDark ? '#bfdbfe' : '#1d4ed8',
    icon: <MarkEmailUnreadRoundedIcon fontSize="small" />,
  };
}

function getDeleteActionMeta({ folder, tokens }) {
  if (folder === 'trash') {
    return {
      key: 'delete-forever',
      label: 'Удалить навсегда',
      shortLabel: 'Навсегда',
      color: tokens.isDark ? '#fecaca' : '#b91c1c',
      icon: <DeleteForeverRoundedIcon fontSize="small" />,
    };
  }

  return {
    key: 'delete',
    label: 'Удалить',
    shortLabel: 'Удалить',
    color: tokens.isDark ? '#fecaca' : '#b91c1c',
    icon: <DeleteOutlineRoundedIcon fontSize="small" />,
  };
}

function SwipeActionWell({
  align,
  visible,
  label,
  icon,
  color,
  compact,
  parked,
  onClick,
}) {
  const active = Boolean(visible);
  return (
    <Box
      sx={{
        flex: 1,
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: align === 'left' ? 'flex-start' : 'flex-end',
        opacity: active ? 1 : 0,
        transform: active ? 'translateX(0px)' : `translateX(${align === 'left' ? -10 : 10}px)`,
        transition: 'opacity 0.16s ease, transform 0.16s ease',
        pointerEvents: active && parked ? 'auto' : 'none',
      }}
    >
      <Button
        onClick={onClick}
        startIcon={icon}
        sx={{
          minWidth: parked ? 136 : 108,
          px: compact ? 1.1 : 1.35,
          borderRadius: 0,
          justifyContent: align === 'left' ? 'flex-start' : 'flex-end',
          textTransform: 'none',
          fontWeight: 800,
          fontSize: compact ? '0.75rem' : '0.8rem',
          color,
        }}
      >
        {label}
      </Button>
    </Box>
  );
}

function MessageRow({
  item,
  rowId,
  selected,
  unread,
  folder,
  viewMode,
  selectedItems,
  activeSwipeState,
  dragHandleActive,
  menuOpen,
  onOpen,
  onToggleSelected,
  onStartDragItems,
  onMarkRead,
  onDelete,
  onRestore,
  onOpenDesktopMenu,
  onDragHandleHoverChange,
  onSetActiveSwipeState,
  onSwipeGestureChange,
  formatTime,
  getAvatarColor,
  getInitials,
  density,
  showPreviewSnippets,
  isMobile,
  isSearch = false,
  mailboxEmails,
  tokens,
}) {
  const compact = density === 'compact';
  const [localHover, setLocalHover] = useState(false);
  const longPressTimerRef = useRef(null);
  const longPressTriggeredRef = useRef(false);
  const commitTimeoutRef = useRef(null);
  const revealedSide = activeSwipeState?.rowId === rowId ? activeSwipeState.side : '';
  const rowIsSelectedInBulk = selectedItems.includes(String(item.id));
  const isTrashFolder = folder === 'trash';
  const canSwipe = isMobile && viewMode === 'messages' && Boolean(onMarkRead || onDelete);
  const canLongPressSelect = isMobile && viewMode === 'messages' && Boolean(onToggleSelected);
  const canDesktopActions = !isMobile;
  const canDragHandle = !isMobile && viewMode === 'messages';
  const correspondent = viewMode === 'conversations'
    ? {
      kind: 'from',
      person: null,
      extraCount: 0,
      prefix: '',
      emptyLabel: formatParticipantLine(item?.participant_people || item?.participants),
    }
    : getPrimaryCorrespondent(item, { folder, isSearch, mailboxEmails });
  const senderLine = viewMode === 'conversations'
    ? formatParticipantLine(item?.participant_people || item?.participants)
    : formatPrimaryCorrespondentLabel(correspondent, item?.sender || '-');
  const avatarSource = getMailPersonDisplay(
    correspondent.person,
    senderLine,
  );
  const title = item.subject || '(без темы)';
  const previewLine = viewMode === 'conversations'
    ? (item.preview || '')
    : (item.body_preview || '');
  const showAttachmentIndicator = Boolean(item.has_attachments);
  const conversationCountLabel = String(Number(item.messages_count || 0) || 1);
  const [dragOffset, setDragOffset] = useState(0);
  const [committedSide, setCommittedSide] = useState('');
  const readAction = useMemo(
    () => getReadActionMeta({ folder, unread, tokens }),
    [folder, unread, tokens],
  );
  const deleteAction = useMemo(
    () => getDeleteActionMeta({ folder, tokens }),
    [folder, tokens],
  );
  const parkedOffset = revealedSide === 'right'
    ? SWIPE_REVEAL_OFFSET
    : revealedSide === 'left'
      ? -SWIPE_REVEAL_OFFSET
      : 0;
  const swipeVisualOffset = dragOffset !== 0
    ? dragOffset
    : committedSide
      ? (committedSide === 'right' ? SWIPE_COMMIT_OFFSET : -SWIPE_COMMIT_OFFSET)
      : parkedOffset;
  const positiveSwipeVisible = canSwipe && swipeVisualOffset > 6;
  const negativeSwipeVisible = canSwipe && swipeVisualOffset < -6;
  const parked = activeSwipeState?.rowId === rowId && !committedSide;
  const showDesktopRail = canDesktopActions;
  const desktopRailEmphasis = localHover || selected || rowIsSelectedInBulk || dragHandleActive || menuOpen;
  const showDragHandle = canDragHandle && (localHover || dragHandleActive);
  const desktopRailWidth = 76;

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const clearCommitTimer = useCallback(() => {
    if (commitTimeoutRef.current) {
      clearTimeout(commitTimeoutRef.current);
      commitTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    clearLongPress();
    clearCommitTimer();
  }, [clearCommitTimer, clearLongPress]);

  useEffect(() => {
    if (activeSwipeState?.rowId !== rowId && !committedSide) {
      setDragOffset(0);
    }
  }, [activeSwipeState?.rowId, committedSide, rowId]);

  const stopRowEvent = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const executeCommit = useCallback((side, action) => {
    clearCommitTimer();
    clearLongPress();
    setCommittedSide(side);
    setDragOffset(0);
    onSwipeGestureChange?.(rowId, false);
    commitTimeoutRef.current = window.setTimeout(() => {
      setCommittedSide('');
      onSetActiveSwipeState?.({ rowId: '', side: '' });
      action?.(item);
    }, 140);
  }, [clearCommitTimer, clearLongPress, item, onSetActiveSwipeState, onSwipeGestureChange, rowId]);

  const commitPositiveAction = useCallback(() => {
    if (folder === 'trash') {
      executeCommit('right', onRestore);
      return;
    }
    executeCommit('right', onMarkRead);
  }, [executeCommit, folder, onMarkRead, onRestore]);

  const commitNegativeAction = useCallback((permanentOverride) => {
    const permanent = typeof permanentOverride === 'boolean' ? permanentOverride : folder === 'trash';
    executeCommit('left', (targetItem) => onDelete?.(targetItem, { permanent }));
  }, [executeCommit, folder, onDelete]);

  const openRevealedState = useCallback((side) => {
    setCommittedSide('');
    setDragOffset(0);
    onSetActiveSwipeState?.({ rowId, side });
    onSwipeGestureChange?.(rowId, false);
  }, [onSetActiveSwipeState, onSwipeGestureChange, rowId]);

  const closeReveal = useCallback(() => {
    setCommittedSide('');
    setDragOffset(0);
    onSetActiveSwipeState?.({ rowId: '', side: '' });
    onSwipeGestureChange?.(rowId, false);
  }, [onSetActiveSwipeState, onSwipeGestureChange]);

  const handlePointerDown = (event) => {
    clearLongPress();
    longPressTriggeredRef.current = false;
    if (!canLongPressSelect) return;
    if (event.pointerType && event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      onToggleSelected?.(String(item.id));
    }, LONG_PRESS_MS);
  };

  const handleClick = (event) => {
    clearLongPress();
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    if (activeSwipeState?.rowId) {
      closeReveal();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && viewMode === 'messages') {
      onToggleSelected?.(String(item.id));
      return;
    }
    onOpen?.(rowId, item);
  };

  const handleDragStart = () => {
    clearLongPress();
    if (activeSwipeState?.rowId && activeSwipeState.rowId !== rowId) {
      onSetActiveSwipeState?.({ rowId: '', side: '' });
    }
  };

  const handleDrag = (event, info) => {
    if (!canSwipe) return;
    const offsetX = Number(info?.offset?.x || 0);
    const offsetY = Number(info?.offset?.y || 0);
    const resolvedOffset = clamp(parkedOffset + offsetX, -SWIPE_MAX_OFFSET, SWIPE_MAX_OFFSET);
    if (Math.abs(resolvedOffset) < SWIPE_AXIS_LOCK_THRESHOLD || Math.abs(resolvedOffset) <= Math.abs(offsetY)) {
      return;
    }
    clearLongPress();
    onSwipeGestureChange?.(rowId, true);
    setDragOffset(resolvedOffset);
  };

  const handleDragEnd = (event, info) => {
    if (!canSwipe) return;
    const resolvedOffset = clamp(
      parkedOffset + Number(info?.offset?.x || 0),
      -SWIPE_MAX_OFFSET,
      SWIPE_MAX_OFFSET,
    );
    setDragOffset(0);

    if (resolvedOffset >= SWIPE_COMMIT_THRESHOLD) {
      commitPositiveAction();
      return;
    }

    if (resolvedOffset <= -SWIPE_COMMIT_THRESHOLD && !isTrashFolder) {
      commitNegativeAction(false);
      return;
    }

    if (resolvedOffset >= SWIPE_REVEAL_THRESHOLD) {
      openRevealedState('right');
      return;
    }

    if (resolvedOffset <= -SWIPE_REVEAL_THRESHOLD) {
      openRevealedState('left');
      return;
    }

    closeReveal();
  };

  const unreadCount = viewMode === 'conversations'
    ? Math.max(0, Number(item.unread_count || 0))
    : (unread ? 1 : 0);
  const rowAccent = selected
    ? tokens.selectedBorder
    : rowIsSelectedInBulk
      ? tokens.bulkSelectedBorder
      : unread
        ? tokens.unreadAccent
        : 'transparent';
  const rowBg = selected
    ? tokens.selectedBg
    : rowIsSelectedInBulk
      ? tokens.bulkSelectedBg
      : unread
        ? tokens.unreadBg
        : tokens.panelBg;
  const rowHoverBg = selected
    ? tokens.selectedHover
    : rowIsSelectedInBulk
      ? tokens.bulkSelectedHover
      : unread
        ? tokens.unreadHover
        : tokens.surfaceHover;
  const dragHandleIds = rowIsSelectedInBulk
    ? selectedItems
    : [String(item.id)].filter(Boolean);

  const beginRowDrag = (event) => {
    if (!canDragHandle) return;
    if (event.target?.closest?.('button, a, [role="menuitem"], input, textarea')) {
      event.preventDefault();
      return;
    }
    onStartDragItems?.(dragHandleIds, item);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragHandleIds.join(','));
  };

  return (
    <Box
      data-testid={`mail-row-shell-${rowId}`}
      data-mail-content-visibility="auto"
      className="mail-row-shell"
      draggable={canDragHandle}
      onDragStart={beginRowDrag}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        contentVisibility: 'auto',
        containIntrinsicSize: compact ? '70px' : '72px',
      }}
      onMouseEnter={() => {
        setLocalHover(true);
      }}
      onMouseLeave={() => {
        setLocalHover(false);
        onDragHandleHoverChange?.('');
      }}
    >
      {canSwipe ? (
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'stretch',
            justifyContent: 'space-between',
            px: 0,
            pointerEvents: 'none',
          }}
        >
          <SwipeActionWell
            align="left"
            visible={positiveSwipeVisible}
            label={readAction.shortLabel}
            icon={readAction.icon}
            color={readAction.color}
            compact={compact}
            parked={parked && revealedSide === 'right'}
            onClick={(event) => {
              stopRowEvent(event);
              if (folder === 'trash') {
                onRestore?.(item);
              } else {
                onMarkRead?.(item);
              }
              closeReveal();
            }}
          />
          <SwipeActionWell
            align="right"
            visible={negativeSwipeVisible}
            label={deleteAction.shortLabel}
            icon={deleteAction.icon}
            color={deleteAction.color}
            compact={compact}
            parked={parked && revealedSide === 'left'}
            onClick={(event) => {
              stopRowEvent(event);
              onDelete?.(item, { permanent: isTrashFolder });
              closeReveal();
            }}
          />
        </Box>
      ) : null}

      <motion.div
        data-testid={`mail-row-motion-${rowId}`}
        drag={canSwipe ? 'x' : false}
        dragConstraints={canSwipe ? { left: -SWIPE_MAX_OFFSET, right: SWIPE_MAX_OFFSET } : undefined}
        dragDirectionLock={canSwipe}
        dragElastic={canSwipe ? 0.08 : 0}
        dragMomentum={false}
        animate={{ x: committedSide ? (committedSide === 'right' ? SWIPE_COMMIT_OFFSET : -SWIPE_COMMIT_OFFSET) : parkedOffset }}
        whileTap={canSwipe ? { scale: 0.998 } : undefined}
        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        onDragStart={handleDragStart}
        onDrag={handleDrag}
        onDragEnd={handleDragEnd}
        onPointerDown={canLongPressSelect ? handlePointerDown : undefined}
        onPointerUp={canLongPressSelect ? clearLongPress : undefined}
        onPointerCancel={canLongPressSelect ? clearLongPress : undefined}
        onPointerLeave={canLongPressSelect ? clearLongPress : undefined}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        aria-selected={selected}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleClick(event);
          }
        }}
        style={{
          cursor: 'pointer',
          touchAction: canSwipe ? 'pan-y' : 'auto',
          outline: 'none',
        }}
      >
        <Box
          data-testid={`mail-row-${rowId}`}
          data-mail-unread={unread ? 'true' : 'false'}
          sx={{
            px: { xs: 1.05, md: compact ? 1 : 1.15 },
            py: compact ? 0.55 : 0.7,
            minHeight: compact ? tokens.rowCompactMinHeight : tokens.rowMinHeight,
            borderLeft: selected || unread ? '3px solid' : rowIsSelectedInBulk ? '1px solid' : '3px solid',
            borderLeftColor: rowAccent,
            bgcolor: rowBg,
            transition: tokens.transition,
            '&:hover': {
              bgcolor: rowHoverBg,
            },
            '[role="button"]:focus-visible &': {
              boxShadow: `inset 0 0 0 2px ${tokens.selectedBorder}`,
            },
          }}
        >
          <Stack direction="row" spacing={0.9} alignItems="flex-start" sx={{ position: 'relative' }}>
            {canDragHandle ? (
              <Box
                data-testid={`mail-row-drag-gutter-${rowId}`}
                sx={{
                  width: 18,
                  minWidth: 18,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'center',
                  pt: 0.45,
                }}
              >
                <Tooltip title="Перетащить в папку" enterDelay={240}>
                  <Box
                    role="button"
                    tabIndex={0}
                    draggable
                    aria-label="Перетащить в папку"
                    data-testid={`mail-row-drag-handle-${rowId}`}
                    onClick={(event) => stopRowEvent(event)}
                    onMouseEnter={(event) => {
                      event.stopPropagation();
                      onDragHandleHoverChange?.(rowId);
                    }}
                    onMouseLeave={(event) => {
                      event.stopPropagation();
                      onDragHandleHoverChange?.('');
                    }}
                    onDragStart={(event) => {
                      event.stopPropagation();
                      onStartDragItems?.(dragHandleIds, item);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', dragHandleIds.join(','));
                    }}
                    onDragEnd={() => onDragHandleHoverChange?.('')}
                    sx={{
                      width: 18,
                      height: 22,
                      borderRadius: tokens.iconButtonRadius,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: tokens.textSecondary,
                      cursor: 'grab',
                      opacity: showDragHandle ? 1 : 0,
                      pointerEvents: showDragHandle ? 'auto' : 'none',
                      transition: 'opacity 0.16s ease',
                      '.mail-row-shell:hover &, .mail-row-shell:focus-within &': {
                        opacity: 1,
                        pointerEvents: 'auto',
                      },
                    }}
                  >
                    <DragIndicatorRoundedIcon sx={{ fontSize: 16 }} />
                  </Box>
                </Tooltip>
              </Box>
            ) : null}
            <Box sx={{ position: 'relative', flexShrink: 0 }}>
              <Avatar
                sx={{
                  width: compact ? 30 : 32,
                  height: compact ? 30 : 32,
                  bgcolor: rowIsSelectedInBulk ? tokens.selectedBorder : getAvatarColor(avatarSource),
                  color: rowIsSelectedInBulk ? '#fff' : undefined,
                  fontWeight: 800,
                  fontSize: tokens.fontSizeFine,
                }}
              >
                {getInitials(avatarSource)}
              </Avatar>
              {rowIsSelectedInBulk ? (
                <Box
                  aria-hidden
                  data-testid={`mail-row-selected-check-${rowId}`}
                  sx={{
                    position: 'absolute',
                    right: -4,
                    bottom: -4,
                    width: 18,
                    height: 18,
                    borderRadius: tokens.badgeRadius,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    bgcolor: tokens.panelBg,
                    color: tokens.selectedBorder,
                    boxShadow: `0 0 0 1px ${tokens.panelBg}`,
                  }}
                >
                  <CheckCircleRoundedIcon sx={{ fontSize: 18 }} />
                </Box>
              ) : null}
            </Box>

            <Stack spacing={0.2} sx={{ minWidth: 0, flex: 1, pr: 0.25 }}>
              <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                <Stack direction="row" spacing={0.7} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
                  <Box
                    aria-hidden={!unread}
                    data-testid={unread ? `mail-row-unread-dot-${rowId}` : undefined}
                    title={unread ? 'Непрочитано' : undefined}
                    sx={{
                      width: unreadCount > 1 ? 18 : 8,
                      minWidth: unreadCount > 1 ? 18 : 8,
                      height: unreadCount > 1 ? 18 : 8,
                      flexShrink: 0,
                      borderRadius: unreadCount > 1 ? tokens.badgeRadius : '50%',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: unread ? 'primary.main' : 'transparent',
                      color: '#fff',
                      fontSize: '0.62rem',
                      fontWeight: 800,
                      lineHeight: 1,
                    }}
                  >
                    {unreadCount > 1 ? (unreadCount > 99 ? '99+' : unreadCount) : null}
                  </Box>
                  <Typography
                    noWrap
                    sx={{
                      minWidth: 0,
                      flex: 1,
                      color: tokens.textPrimary,
                      fontWeight: unread ? 800 : 500,
                      fontSize: compact ? '0.8125rem' : '0.875rem',
                      lineHeight: 1.25,
                    }}
                  >
                    {senderLine}
                  </Typography>
                </Stack>

                <Box
                  sx={{
                    position: 'relative',
                    flexShrink: 0,
                    minWidth: canDesktopActions ? desktopRailWidth : 48,
                    width: canDesktopActions ? desktopRailWidth : 'auto',
                    minHeight: 18,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'flex-start',
                    alignItems: 'flex-end',
                    gap: 0.15,
                  }}
                >
                  <Tooltip
                    title={formatFullDate(viewMode === 'conversations' ? item.last_received_at : item.received_at)}
                    enterDelay={400}
                  >
                    <Typography
                      data-testid={`mail-row-time-${rowId}`}
                      sx={{
                        ...getMailMetaTextSx(tokens, {
                          color: unread ? tokens.textPrimary : tokens.textSecondary,
                          fontWeight: unread ? 700 : 500,
                          whiteSpace: 'nowrap',
                          lineHeight: 1.2,
                          fontSize: '0.75rem',
                        }),
                      }}
                    >
                      {formatTime(viewMode === 'conversations' ? item.last_received_at : item.received_at)}
                    </Typography>
                  </Tooltip>

                  {showDesktopRail ? (
                    <Stack
                      className="mail-row-actions"
                      direction="row"
                      spacing={0.05}
                      alignItems="center"
                      sx={{
                        minHeight: 26,
                        opacity: desktopRailEmphasis ? 1 : 0,
                        pointerEvents: desktopRailEmphasis ? 'auto' : 'none',
                        transition: 'opacity 0.16s ease',
                        '.mail-row-shell:focus-within &': {
                          opacity: 1,
                          pointerEvents: 'auto',
                        },
                      }}
                    >
                      <Tooltip title={readAction.label} enterDelay={240}>
                        <IconButton
                          size="small"
                          aria-label={readAction.label}
                          data-testid={`mail-row-read-action-${rowId}`}
                          onClick={(event) => {
                            stopRowEvent(event);
                            if (folder === 'trash') {
                              onRestore?.(item);
                            } else {
                              onMarkRead?.(item);
                            }
                          }}
                          sx={{
                            ...getMailIconButtonSx(tokens, {
                              width: 26,
                              height: 26,
                              border: 'none',
                              bgcolor: 'transparent',
                              color: tokens.textSecondary,
                            }),
                          }}
                        >
                          {readAction.icon}
                        </IconButton>
                      </Tooltip>

                      {viewMode === 'messages' ? (
                        <Tooltip title={folder === 'trash' ? 'Восстановить' : deleteAction.label} enterDelay={240}>
                          <IconButton
                            size="small"
                            aria-label={folder === 'trash' ? 'Восстановить' : deleteAction.label}
                            data-testid={`mail-row-delete-action-${rowId}`}
                            onClick={(event) => {
                              stopRowEvent(event);
                              if (folder === 'trash') {
                                onRestore?.(item);
                              } else {
                                onDelete?.(item, { permanent: false });
                              }
                            }}
                            sx={{
                              ...getMailIconButtonSx(tokens, {
                                width: 26,
                                height: 26,
                                border: 'none',
                                bgcolor: 'transparent',
                                color: tokens.textSecondary,
                                '&:hover': {
                                  color: folder === 'trash' ? readAction.color : 'error.main',
                                },
                              }),
                            }}
                          >
                            {folder === 'trash' ? <RestoreFromTrashRoundedIcon fontSize="small" /> : deleteAction.icon}
                          </IconButton>
                        </Tooltip>
                      ) : null}

                      <Tooltip title="Еще действия" enterDelay={240}>
                        <IconButton
                          size="small"
                          aria-label="Еще действия"
                          data-testid={`mail-row-more-action-${rowId}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenDesktopMenu?.(event.currentTarget, item, rowId);
                          }}
                          sx={{
                            ...getMailIconButtonSx(tokens, {
                              width: 26,
                              height: 26,
                              border: 'none',
                              bgcolor: 'transparent',
                              color: tokens.textSecondary,
                            }),
                          }}
                        >
                          <MoreHorizRoundedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  ) : null}
                </Box>
              </Stack>

              <Stack direction="row" spacing={0.45} alignItems="center" sx={{ minWidth: 0 }}>
                <Typography
                  noWrap
                  sx={{
                    minWidth: 0,
                    flex: 1,
                    color: unread
                      ? tokens.textPrimary
                      : (tokens.isDark ? alpha('#fff', 0.72) : alpha('#0f172a', 0.68)),
                    fontWeight: unread ? 700 : 500,
                    fontSize: compact ? '0.8125rem' : '0.875rem',
                    lineHeight: 1.25,
                  }}
                >
                  {title}
                </Typography>
                {showAttachmentIndicator ? (
                  <Tooltip title={item.attachments_count > 0 ? `Вложений: ${item.attachments_count}` : 'Есть вложения'}>
                    <Box
                      aria-label={item.attachments_count > 0 ? `Вложений: ${item.attachments_count}` : 'Есть вложения'}
                      sx={{ display: 'inline-flex', alignItems: 'center', color: tokens.textSecondary, flexShrink: 0 }}
                    >
                      <AttachFileIcon sx={{ fontSize: 14 }} />
                    </Box>
                  </Tooltip>
                ) : null}
                {viewMode === 'conversations' ? (
                  <Chip
                    size="small"
                    icon={<ForumOutlinedIcon sx={{ fontSize: '14px !important' }} />}
                    label={conversationCountLabel}
                    sx={{
                      height: 20,
                      bgcolor: tokens.surfaceBg,
                      color: tokens.textSecondary,
                      '& .MuiChip-label': {
                        px: 0.6,
                        fontWeight: 600,
                        fontSize: tokens.fontSizeFine,
                      },
                    }}
                  />
                ) : null}
              </Stack>

              {showPreviewSnippets && previewLine ? (
                <Stack direction="row" spacing={0.45} alignItems="center" sx={{ minWidth: 0 }}>
                  {viewMode === 'conversations' ? (
                    <ForumOutlinedIcon sx={{ fontSize: 12, color: tokens.textSecondary, flexShrink: 0 }} />
                  ) : null}
                  <Typography
                    noWrap
                    className="mail-line-clamp-1"
                    sx={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      color: unread
                        ? (tokens.isDark ? alpha('#fff', 0.78) : alpha('#0f172a', 0.72))
                        : (tokens.isDark ? alpha('#fff', 0.52) : alpha('#0f172a', 0.5)),
                      fontSize: '0.75rem',
                      fontWeight: unread ? 500 : 400,
                      lineHeight: 1.25,
                    }}
                  >
                    {previewLine}
                  </Typography>
                </Stack>
              ) : null}
            </Stack>
          </Stack>
        </Box>

        <Box
          className="mail-divider-inset"
          sx={{
            borderBottom: '1px solid',
            borderColor: tokens.isDark ? alpha('#fff', 0.06) : alpha('#0f172a', 0.08),
          }}
        />
      </motion.div>
    </Box>
  );
}

function DesktopRowMenu({
  anchorEl,
  open,
  item,
  rowId,
  folder,
  viewMode,
  moveTargets,
  onClose,
  onOpen,
  onArchive,
  onMove,
  onOpenHeaders,
  onDownloadSource,
  onPrint,
  onDelete,
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);
  const isTrashFolder = folder === 'trash';
  const canArchive = viewMode === 'messages' && folder !== 'archive' && folder !== 'trash';
  const normalizedMoveTargets = filterMailMoveTargets(moveTargets, folder);

  const closeMenu = () => {
    onClose?.();
  };

  return (
    <Menu
      anchorEl={anchorEl}
      open={open}
      onClose={closeMenu}
      transformOrigin={{ horizontal: 'right', vertical: 'top' }}
      anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
      MenuListProps={{ dense: true, 'data-testid': 'mail-row-more-menu' }}
      PaperProps={{
        sx: getMailMenuPaperSx(tokens, {
          minWidth: 248,
          maxHeight: 'min(72vh, 420px)',
          '& .MuiMenuItem-root': { minHeight: 32 },
        }),
      }}
    >
      {viewMode === 'conversations' ? (
        <MailCompactMenuItem
                      label="Открыть цепочку"
          onClick={() => {
            closeMenu();
            onOpen?.(rowId, item);
          }}
        />
      ) : (
        <>
          {canArchive ? (
            <MailCompactMenuItem
              icon={<ArchiveRoundedIcon fontSize="small" />}
              label="В архив"
              onClick={() => {
                closeMenu();
                onArchive?.(item);
              }}
            />
          ) : null}
          {normalizedMoveTargets.length > 0 ? <Divider /> : null}
          <MailMoveSection
            targets={normalizedMoveTargets}
            tokens={tokens}
            currentFolder={folder}
            onSelect={(value) => {
              closeMenu();
              onMove?.(item, value);
            }}
          />
          <Divider />
          <MailCompactMenuItem
            icon={<SubjectRoundedIcon fontSize="small" />}
            label="Заголовки"
            onClick={() => {
              closeMenu();
              onOpenHeaders?.(item);
            }}
          />
          <MailCompactMenuItem
            icon={<DownloadRoundedIcon fontSize="small" />}
            label="Скачать исходник"
            onClick={() => {
              closeMenu();
              onDownloadSource?.(item);
            }}
          />
          <MailCompactMenuItem
            icon={<PrintOutlinedIcon fontSize="small" />}
            label="Печать"
            onClick={() => {
              closeMenu();
              onPrint?.(item);
            }}
          />
          {isTrashFolder ? <Divider /> : null}
          {isTrashFolder ? (
            <MailCompactMenuItem
              icon={<DeleteForeverRoundedIcon fontSize="small" />}
              label="Удалить навсегда"
              danger
              onClick={() => {
                closeMenu();
                onDelete?.(item, { permanent: true });
              }}
            />
          ) : null}
        </>
      )}
    </Menu>
  );
}

export default function MailMessageList({
  listSx,
  folder = 'inbox',
  viewMode,
  listData,
  loading,
  loadingMore,
  selectedItems,
  selectedId,
  onSelectId,
  onToggleSelectedListItem,
  onStartDragItems,
  formatTime,
  getAvatarColor,
  getInitials,
  hasActiveFilters,
  onClearListFilters,
  noResultsHint,
  onLoadMoreMessages,
  messageListRef,
  loadMoreSentinelRef,
  isMobile,
  density = 'comfortable',
  showPreviewSnippets = true,
  onSwipeRead,
  onSwipeDelete,
  onRestoreMessage,
  onArchiveMessage,
  onMoveMessage,
  onOpenHeaders,
  onDownloadSource,
  onPrintMessage,
  moveTargets = [],
  onPullToRefresh,
  bottomInset = 0,
  isSearch = false,
  mailboxEmails,
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);
  const compact = density === 'compact';
  const touchStartRef = useRef(null);
  const pullingRef = useRef(false);
  const localListRef = useRef(null);
  const swipeGestureRowIdRef = useRef('');
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshArmed, setRefreshArmed] = useState(false);
  const [activeSwipeState, setActiveSwipeState] = useState({ rowId: '', side: '' });
  const [dragHandleRowId, setDragHandleRowId] = useState('');
  const [desktopMenuState, setDesktopMenuState] = useState({
    anchorEl: null,
    item: null,
    rowId: '',
  });
  const groupedListItems = useMemo(
    () => buildMailMonthGroups(listData?.items, viewMode),
    [listData?.items, viewMode],
  );

  const closeActiveSwipe = useCallback(() => {
    setActiveSwipeState({ rowId: '', side: '' });
    swipeGestureRowIdRef.current = '';
  }, []);

  useEffect(() => {
    const currentIds = new Set(
      (Array.isArray(listData?.items) ? listData.items : []).map((item) => String(
        viewMode === 'conversations'
          ? (item?.conversation_id || item?.id || '')
          : (item?.id || ''),
      )),
    );
    if (activeSwipeState.rowId && !currentIds.has(activeSwipeState.rowId)) {
      closeActiveSwipe();
    }
    if (desktopMenuState.rowId && !currentIds.has(desktopMenuState.rowId)) {
      setDesktopMenuState({ anchorEl: null, item: null, rowId: '' });
    }
  }, [
    activeSwipeState.rowId,
    closeActiveSwipe,
    desktopMenuState.rowId,
    listData?.items,
    viewMode,
  ]);

  const handleSwipeGestureChange = useCallback((rowId, active) => {
    if (active) {
      swipeGestureRowIdRef.current = String(rowId || '');
      pullingRef.current = false;
      touchStartRef.current = null;
      setPullDistance(0);
      setRefreshArmed(false);
      return;
    }
    if (swipeGestureRowIdRef.current === String(rowId || '')) {
      swipeGestureRowIdRef.current = '';
    }
  }, []);

  const handleTouchStart = (event) => {
    if (!isMobile || !onPullToRefresh) return;
    if (activeSwipeState.rowId || swipeGestureRowIdRef.current) {
      touchStartRef.current = null;
      pullingRef.current = false;
      return;
    }
    const container = localListRef.current;
    if (!container || container.scrollTop > 0) {
      touchStartRef.current = null;
      pullingRef.current = false;
      return;
    }
    const firstTouch = event.touches?.[0];
    touchStartRef.current = firstTouch?.clientY || 0;
    pullingRef.current = true;
  };

  const handleTouchMove = (event) => {
    if (!pullingRef.current || !isMobile || !onPullToRefresh) return;
    if (activeSwipeState.rowId || swipeGestureRowIdRef.current) {
      pullingRef.current = false;
      touchStartRef.current = null;
      setPullDistance(0);
      setRefreshArmed(false);
      return;
    }
    const firstTouch = event.touches?.[0];
    const startY = touchStartRef.current;
    const currentY = firstTouch?.clientY || 0;
    const delta = Math.max(0, currentY - startY);
    if (delta <= 0) {
      setPullDistance(0);
      setRefreshArmed(false);
      return;
    }
    const nextDistance = Math.min(delta * 0.45, 74);
    setPullDistance(nextDistance);
    setRefreshArmed(nextDistance >= 52);
  };

  const handleTouchEnd = () => {
    if (pullingRef.current && refreshArmed && !activeSwipeState.rowId && !swipeGestureRowIdRef.current) {
      onPullToRefresh?.();
    }
    pullingRef.current = false;
    touchStartRef.current = null;
    setPullDistance(0);
    setRefreshArmed(false);
  };

  const handleListScroll = () => {
    if (activeSwipeState.rowId) {
      closeActiveSwipe();
    }
  };

  const handleOpenRow = useCallback((rowId, item) => {
    if (activeSwipeState.rowId) {
      closeActiveSwipe();
      return;
    }
    onSelectId?.(rowId, item);
  }, [activeSwipeState.rowId, closeActiveSwipe, onSelectId]);

  const handleOpenDesktopMenu = useCallback((anchorEl, item, rowId) => {
    setDesktopMenuState({
      anchorEl,
      item,
      rowId: String(rowId || ''),
    });
  }, []);

  const handleCloseDesktopMenu = useCallback(() => {
    setDesktopMenuState({ anchorEl: null, item: null, rowId: '' });
  }, []);

  return (
    <Box sx={{ ...listSx, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, overflow: 'hidden', bgcolor: tokens.panelBg }}>
      <Box
        data-testid="mail-list-scroll-root"
        data-mail-message-list="true"
        ref={(node) => {
          localListRef.current = node;
          assignRef(messageListRef, node);
        }}
        className="mail-scroll-hidden"
        sx={{
          overflowY: 'auto',
          overflowX: 'hidden',
          overscrollBehavior: 'contain',
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y',
          flex: '1 1 0%',
          minHeight: 0,
          minWidth: 0,
          bgcolor: tokens.panelBg,
        }}
        onScroll={handleListScroll}
        onTouchStart={onPullToRefresh ? handleTouchStart : undefined}
        onTouchMove={onPullToRefresh ? handleTouchMove : undefined}
        onTouchEnd={onPullToRefresh ? handleTouchEnd : undefined}
        onTouchCancel={onPullToRefresh ? handleTouchEnd : undefined}
      >
        <Box
          sx={{
            height: pullDistance,
            opacity: pullDistance > 0 ? 1 : 0,
            transition: pullDistance > 0 ? 'none' : 'height 0.16s ease, opacity 0.16s ease',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Stack direction="row" spacing={0.8} alignItems="center" sx={{ color: tokens.textSecondary }}>
            <RefreshRoundedIcon
              fontSize="small"
              sx={{
                transform: refreshArmed ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.18s ease',
              }}
            />
            <Typography sx={{ ...getMailMetaTextSx(tokens, { fontWeight: 700 }) }}>
              {refreshArmed ? 'Отпустите для обновления' : 'Потяните вниз'}
            </Typography>
          </Stack>
        </Box>

        {loading ? (
          Array.from({ length: compact ? 9 : 7 }).map((_, index) => (
            <Box key={index} sx={{ px: { xs: 1.15, md: 1.6 }, py: compact ? 1 : 1.15 }}>
              <Stack direction="row" spacing={1.1}>
                <Skeleton variant="circular" width={compact ? 34 : 38} height={compact ? 34 : 38} />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Stack direction="row" justifyContent="space-between" spacing={1}>
                    <Skeleton variant="text" width="34%" height={20} />
                    <Skeleton variant="text" width={42} height={18} />
                  </Stack>
                  <Skeleton variant="text" width="72%" height={22} />
                  <Skeleton variant="text" width="90%" height={18} />
                </Box>
              </Stack>
              <Box
                className="mail-divider-inset"
                sx={{
                  borderBottom: '1px solid',
                  borderColor: tokens.isDark ? alpha('#fff', 0.06) : alpha('#0f172a', 0.08),
                  mt: 1,
                }}
              />
            </Box>
          ))
        ) : listData.items.length === 0 ? (
          <Box sx={{ flex: 1, minHeight: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', px: 2.4, py: 5 }}>
            <Stack spacing={1.1} alignItems="center" sx={{ textAlign: 'center', maxWidth: 320 }}>
              <InboxIcon sx={{ fontSize: 54, color: tokens.textSecondary }} />
              <Typography sx={{ fontWeight: 700, color: tokens.textPrimary }}>
                {noResultsHint}
              </Typography>
              {hasActiveFilters ? (
                <Button onClick={onClearListFilters} sx={{ textTransform: 'none', fontWeight: 700 }}>
                  Сбросить фильтры
                </Button>
              ) : null}
            </Stack>
          </Box>
        ) : (
          <>
            {groupedListItems.map(({ item, monthKey, monthLabel }) => {
              const rowId = String(
                viewMode === 'conversations'
                  ? (item.conversation_id || item.id || '')
                  : (item.id || '')
              );
              const selected = String(selectedId) === rowId;
              const unread = viewMode === 'conversations'
                ? Number(item.unread_count || 0) > 0
                : !item.is_read;

              return (
                <Fragment key={rowId || `${item.subject}_${item.sender}`}>
                  {monthLabel ? (
                    <Box
                      data-testid={`mail-month-group-${monthKey}`}
                      sx={{
                        px: { xs: 1.2, md: 1.5 },
                        pt: 0.7,
                        pb: 0.35,
                        bgcolor: tokens.panelBg,
                        borderBottom: '1px solid',
                        borderBottomColor: tokens.isDark ? alpha('#fff', 0.06) : alpha('#0f172a', 0.08),
                      }}
                    >
                      <Typography
                        sx={getMailMetaTextSx(tokens, {
                          color: tokens.textSecondary,
                          fontWeight: 800,
                          letterSpacing: '0.02em',
                        })}
                      >
                        {monthLabel}
                      </Typography>
                    </Box>
                  ) : null}
                  <MessageRow
                  item={item}
                  rowId={rowId}
                  selected={selected}
                  unread={unread}
                  folder={folder}
                  viewMode={viewMode}
                  selectedItems={selectedItems}
                  activeSwipeState={activeSwipeState}
                  dragHandleActive={dragHandleRowId === rowId}
                  menuOpen={desktopMenuState.rowId === rowId}
                  onOpen={handleOpenRow}
                  onToggleSelected={onToggleSelectedListItem}
                  onStartDragItems={onStartDragItems}
                  onMarkRead={onSwipeRead}
                  onDelete={onSwipeDelete}
                  onRestore={onRestoreMessage}
                  onOpenDesktopMenu={handleOpenDesktopMenu}
                  onDragHandleHoverChange={setDragHandleRowId}
                  onSetActiveSwipeState={setActiveSwipeState}
                  onSwipeGestureChange={handleSwipeGestureChange}
                  formatTime={formatTime}
                  getAvatarColor={getAvatarColor}
                  getInitials={getInitials}
                  density={density}
                  showPreviewSnippets={showPreviewSnippets}
                  isMobile={isMobile}
                  isSearch={isSearch}
                  mailboxEmails={mailboxEmails}
                  tokens={tokens}
                  />
                </Fragment>
              );
            })}

            {listData.has_more ? (
              <Box
                ref={loadMoreSentinelRef}
                sx={{
                  px: 1.6,
                  py: 1.6,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 0.8,
                }}
              >
                <Button
                  size="small"
                  onClick={onLoadMoreMessages}
                  disabled={loadingMore}
                  sx={getMailSurfaceButtonSx(tokens, { px: 1.6 })}
                >
                  {loadingMore ? 'Загрузка...' : 'Показать ещё'}
                </Button>
                <Typography sx={getMailMetaTextSx(tokens)}>
                  Автодогрузка включена
                </Typography>
              </Box>
            ) : null}

            {bottomInset ? (
              <Box aria-hidden data-testid="mail-list-bottom-inset" sx={{ height: bottomInset, flexShrink: 0 }} />
            ) : null}
          </>
        )}
      </Box>

      <DesktopRowMenu
        anchorEl={desktopMenuState.anchorEl}
        open={Boolean(desktopMenuState.anchorEl)}
        item={desktopMenuState.item}
        rowId={desktopMenuState.rowId}
        folder={folder}
        viewMode={viewMode}
        moveTargets={moveTargets}
        onClose={handleCloseDesktopMenu}
        onOpen={handleOpenRow}
        onArchive={onArchiveMessage}
        onMove={onMoveMessage}
        onOpenHeaders={onOpenHeaders}
        onDownloadSource={onDownloadSource}
        onPrint={onPrintMessage}
        onDelete={onSwipeDelete}
      />
    </Box>
  );
}
