import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Menu,
  MenuItem,
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
  hovered,
  dragHandleActive,
  menuOpen,
  onOpen,
  onToggleSelected,
  onStartDragItems,
  onMarkRead,
  onDelete,
  onRestore,
  onOpenDesktopMenu,
  onHoverChange,
  onDragHandleHoverChange,
  onSetActiveSwipeState,
  onSwipeGestureChange,
  formatTime,
  getAvatarColor,
  getInitials,
  density,
  showPreviewSnippets,
  isMobile,
  tokens,
}) {
  const compact = density === 'compact';
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
  const senderPerson = item?.sender_person || {
    display: item?.sender_display,
    name: item?.sender_name,
    email: item?.sender_email || item?.sender,
  };
  const senderLine = viewMode === 'conversations'
    ? formatParticipantLine(item?.participant_people || item?.participants)
    : getMailPersonDisplay(senderPerson, item?.sender || '-');
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
  const desktopRailEmphasis = hovered || selected || rowIsSelectedInBulk || dragHandleActive || menuOpen;
  const desktopRailWidth = viewMode === 'messages'
    ? (canDragHandle ? 152 : 120)
    : 90;

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

  const dragHandleIds = rowIsSelectedInBulk
    ? selectedItems
    : [String(item.id)].filter(Boolean);

  return (
    <Box
      data-testid={`mail-row-shell-${rowId}`}
      sx={{ position: 'relative', overflow: 'hidden' }}
      onMouseEnter={() => onHoverChange?.(rowId)}
      onMouseLeave={() => {
        onHoverChange?.('');
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
          sx={{
            px: { xs: 1.15, md: compact ? 1.3 : 1.6 },
            py: compact ? 1 : 1.15,
            minHeight: compact ? tokens.rowCompactMinHeight : tokens.rowMinHeight,
            borderLeft: selected ? '2px solid' : rowIsSelectedInBulk ? '1px solid' : '2px solid',
            borderLeftColor: selected
              ? tokens.selectedBorder
              : rowIsSelectedInBulk
                ? tokens.bulkSelectedBorder
                : 'transparent',
            bgcolor: selected
              ? tokens.selectedBg
              : rowIsSelectedInBulk
                ? tokens.bulkSelectedBg
                : hovered
                  ? tokens.surfaceHover
                  : tokens.panelBg,
            transition: tokens.transition,
            '&:hover': {
              bgcolor: selected ? tokens.selectedHover : tokens.surfaceHover,
            },
            '[role="button"]:focus-visible &': {
              boxShadow: `inset 0 0 0 2px ${tokens.selectedBorder}`,
            },
          }}
        >
          <Stack direction="row" spacing={1.1} alignItems="flex-start">
            <Box sx={{ position: 'relative', flexShrink: 0, mt: 0.2 }}>
              <Avatar
                sx={{
                  width: compact ? 34 : 38,
                  height: compact ? 34 : 38,
                  bgcolor: rowIsSelectedInBulk ? tokens.selectedBorder : getAvatarColor(senderLine),
                  color: rowIsSelectedInBulk ? '#fff' : undefined,
                  fontWeight: 800,
                  fontSize: tokens.fontSizeFine,
                }}
              >
                {getInitials(senderLine)}
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

            <Stack spacing={0.3} sx={{ minWidth: 0, flex: 1, pr: 0.25 }}>
              <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
                <Typography
                  noWrap
                  sx={{
                    minWidth: 0,
                    flex: 1,
                    color: tokens.textPrimary,
                    fontWeight: unread ? 800 : 700,
                    fontSize: compact ? '0.88rem' : '0.94rem',
                    lineHeight: 1.15,
                  }}
                >
                  {senderLine}
                </Typography>

                <Box
                  sx={{
                    flexShrink: 0,
                    minWidth: canDesktopActions ? desktopRailWidth : 48,
                    width: canDesktopActions ? desktopRailWidth : 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                  }}
                >
                  <Typography
                    sx={{
                      ...getMailMetaTextSx(tokens, {
                      color: unread ? tokens.textPrimary : tokens.textSecondary,
                      fontWeight: unread ? 700 : 600,
                      whiteSpace: 'nowrap',
                      lineHeight: 1.2,
                      }),
                    }}
                  >
                    {formatTime(viewMode === 'conversations' ? item.last_received_at : item.received_at)}
                  </Typography>

                  {showDesktopRail ? (
                    <Stack
                      direction="row"
                      spacing={0.2}
                      alignItems="center"
                      sx={{
                        mt: 0.25,
                        opacity: desktopRailEmphasis ? 1 : 0.82,
                        transform: 'translateX(0px)',
                        transition: 'opacity 0.16s ease, transform 0.16s ease',
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
                            width: 30,
                            height: 30,
                            border: 'none',
                            bgcolor: 'transparent',
                            color: readAction.color,
                            opacity: desktopRailEmphasis ? 1 : 0.88,
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
                              width: 30,
                              height: 30,
                              border: 'none',
                              bgcolor: 'transparent',
                              color: folder === 'trash' ? readAction.color : deleteAction.color,
                              opacity: desktopRailEmphasis ? 1 : 0.88,
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
                            width: 30,
                            height: 30,
                            border: 'none',
                            bgcolor: 'transparent',
                            color: tokens.textSecondary,
                            opacity: desktopRailEmphasis ? 1 : 0.82,
                            }),
                          }}
                        >
                          <MoreHorizRoundedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>

                      {canDragHandle ? (
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
                              width: 28,
                              height: 28,
                              borderRadius: tokens.iconButtonRadius,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: tokens.textSecondary,
                              cursor: 'grab',
                              opacity: desktopRailEmphasis ? 1 : 0.82,
                              transition: tokens.transition,
                              '&:hover': {
                                bgcolor: tokens.surfaceBg,
                                transform: 'translateY(-1px)',
                              },
                            }}
                          >
                            <DragIndicatorRoundedIcon fontSize="small" />
                          </Box>
                        </Tooltip>
                      ) : null}
                    </Stack>
                  ) : unread ? (
                    <Box sx={{ width: 8, height: 8, mt: 0.45, borderRadius: '50%', bgcolor: 'primary.main' }} />
                  ) : null}
                </Box>
              </Stack>

              <Typography
                className="mail-line-clamp-2"
                sx={{
                  color: unread
                    ? (tokens.isDark ? alpha('#fff', 0.82) : alpha('#0f172a', 0.76))
                    : tokens.textSecondary,
                  fontWeight: unread ? 600 : 500,
                  fontSize: compact ? '0.84rem' : '0.88rem',
                  lineHeight: 1.34,
                }}
              >
                {title}
              </Typography>

              {showPreviewSnippets && previewLine ? (
                <Stack direction="row" spacing={0.6} alignItems="flex-start" sx={{ minWidth: 0 }}>
                  {viewMode === 'conversations' ? (
                    <ForumOutlinedIcon sx={{ mt: '2px', fontSize: 13, color: tokens.textSecondary, flexShrink: 0 }} />
                  ) : null}
                  <Typography
                    className="mail-line-clamp-2"
                    sx={{
                      color: tokens.isDark
                        ? alpha('#fff', 0.58)
                        : alpha('#0f172a', 0.58),
                      fontSize: compact ? '0.78rem' : '0.82rem',
                      lineHeight: 1.38,
                    }}
                  >
                    {previewLine}
                  </Typography>
                </Stack>
              ) : null}

              <Stack direction="row" spacing={0.65} alignItems="center" sx={{ pt: 0.15 }}>
                {viewMode === 'conversations' ? (
                  <Chip
                    size="small"
                    icon={<ForumOutlinedIcon sx={{ fontSize: '14px !important' }} />}
                    label={conversationCountLabel}
                    sx={{
                      height: 24,
                      bgcolor: tokens.surfaceBg,
                      color: tokens.textSecondary,
                      '& .MuiChip-label': {
                        px: 0.75,
                        fontWeight: 700,
                      fontSize: tokens.fontSizeFine,
                      },
                    }}
                  />
                ) : null}
                {showAttachmentIndicator ? (
                  <Chip
                    size="small"
                    icon={<AttachFileIcon sx={{ fontSize: '14px !important' }} />}
                    label={String(Number(item.attachments_count || 0) || 1)}
                    sx={{
                      height: 24,
                      bgcolor: tokens.surfaceBg,
                      color: tokens.textSecondary,
                      '& .MuiChip-label': {
                        px: 0.75,
                        fontWeight: 700,
                      fontSize: tokens.fontSizeFine,
                      },
                    }}
                  />
                ) : null}
                {rowIsSelectedInBulk && !isMobile ? (
                  <Chip
                    size="small"
                    label="Выбрано"
                    color="primary"
                    sx={{ height: 24, borderRadius: tokens.chipRadius, '& .MuiChip-label': { fontWeight: 700, fontSize: tokens.fontSizeFine } }}
                  />
                ) : null}
              </Stack>
            </Stack>
          </Stack>
        </Box>

        <Box className="mail-divider-inset" sx={{ borderBottom: '1px solid' }} />
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
  const normalizedMoveTargets = Array.isArray(moveTargets) ? moveTargets : [];

  return (
    <Menu
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
      transformOrigin={{ horizontal: 'right', vertical: 'top' }}
      anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
      PaperProps={{ sx: getMailMenuPaperSx(tokens, { minWidth: 250 }) }}
    >
      {viewMode === 'conversations' ? (
        <MenuItem
          onClick={() => {
            onClose?.();
            onOpen?.(rowId, item);
          }}
        >
          Открыть диалог
        </MenuItem>
      ) : (
        [
          canArchive ? (
            <MenuItem
              key="archive"
              onClick={() => {
                onClose?.();
                onArchive?.(item);
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <ArchiveRoundedIcon fontSize="small" />
                <span>В архив</span>
              </Stack>
            </MenuItem>
          ) : null,
          normalizedMoveTargets.length > 0 ? <Divider key="move-divider" /> : null,
          ...normalizedMoveTargets.map((target) => (
            <MenuItem
              key={`move-${String(target?.value || '')}`}
              onClick={() => {
                onClose?.();
                onMove?.(item, String(target?.value || ''));
              }}
            >
              Переместить в {String(target?.label || target?.value || 'папку')}
            </MenuItem>
          )),
          normalizedMoveTargets.length > 0 ? <Divider key="detail-divider" /> : null,
          <MenuItem
            key="headers"
            onClick={() => {
              onClose?.();
              onOpenHeaders?.(item);
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <SubjectRoundedIcon fontSize="small" />
              <span>Заголовки</span>
            </Stack>
          </MenuItem>,
          <MenuItem
            key="source"
            onClick={() => {
              onClose?.();
              onDownloadSource?.(item);
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <DownloadRoundedIcon fontSize="small" />
              <span>Скачать исходник</span>
            </Stack>
          </MenuItem>,
          <MenuItem
            key="print"
            onClick={() => {
              onClose?.();
              onPrint?.(item);
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <PrintOutlinedIcon fontSize="small" />
              <span>Печать</span>
            </Stack>
          </MenuItem>,
          isTrashFolder ? <Divider key="danger-divider" /> : null,
          isTrashFolder ? (
            <MenuItem
              key="delete-forever"
              onClick={() => {
                onClose?.();
                onDelete?.(item, { permanent: true });
              }}
              sx={{ color: 'error.main' }}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <DeleteForeverRoundedIcon fontSize="small" />
                <span>Удалить навсегда</span>
              </Stack>
            </MenuItem>
          ) : null,
        ]
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
  const [hoveredRowId, setHoveredRowId] = useState('');
  const [dragHandleRowId, setDragHandleRowId] = useState('');
  const [desktopMenuState, setDesktopMenuState] = useState({
    anchorEl: null,
    item: null,
    rowId: '',
  });

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
    setHoveredRowId(String(rowId || ''));
  }, []);

  const handleCloseDesktopMenu = useCallback(() => {
    setDesktopMenuState({ anchorEl: null, item: null, rowId: '' });
  }, []);

  return (
    <Box sx={{ ...listSx, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, overflow: 'hidden', bgcolor: tokens.panelBg }}>
      <Box
        data-testid="mail-list-scroll-root"
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
              <Box className="mail-divider-inset" sx={{ borderBottom: '1px solid', mt: 1 }} />
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
            {listData.items.map((item) => {
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
                <MessageRow
                  key={rowId || `${item.subject}_${item.sender}`}
                  item={item}
                  rowId={rowId}
                  selected={selected}
                  unread={unread}
                  folder={folder}
                  viewMode={viewMode}
                  selectedItems={selectedItems}
                  activeSwipeState={activeSwipeState}
                  hovered={hoveredRowId === rowId}
                  dragHandleActive={dragHandleRowId === rowId}
                  menuOpen={desktopMenuState.rowId === rowId}
                  onOpen={handleOpenRow}
                  onToggleSelected={onToggleSelectedListItem}
                  onStartDragItems={onStartDragItems}
                  onMarkRead={onSwipeRead}
                  onDelete={onSwipeDelete}
                  onRestore={onRestoreMessage}
                  onOpenDesktopMenu={handleOpenDesktopMenu}
                  onHoverChange={setHoveredRowId}
                  onDragHandleHoverChange={setDragHandleRowId}
                  onSetActiveSwipeState={setActiveSwipeState}
                  onSwipeGestureChange={handleSwipeGestureChange}
                  formatTime={formatTime}
                  getAvatarColor={getAvatarColor}
                  getInitials={getInitials}
                  density={density}
                  showPreviewSnippets={showPreviewSnippets}
                  isMobile={isMobile}
                  tokens={tokens}
                />
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
