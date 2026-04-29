import { Suspense, forwardRef, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Fab,
  InputBase,
  IconButton,
  List,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Popover,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import Slide from '@mui/material/Slide';
import useMediaQuery from '@mui/material/useMediaQuery';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import DoneAllRoundedIcon from '@mui/icons-material/DoneAllRounded';
import FlagOutlinedIcon from '@mui/icons-material/FlagOutlined';
import ForwardRoundedIcon from '@mui/icons-material/ForwardRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import PhotoLibraryRoundedIcon from '@mui/icons-material/PhotoLibraryRounded';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import ReplyRoundedIcon from '@mui/icons-material/ReplyRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import ShareIcon from '@mui/icons-material/Share';
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';

import ChatContextPanel from './ChatContextPanel';
import ChatFileUploadDialog from './ChatFileUploadDialog';
import ChatMediaPreviewDialog from './ChatMediaPreviewDialog';
import { PresenceAvatar } from './ChatCommon';
import {
  CHAT_MAX_FILE_COUNT,
  formatFullDate,
  getConversationHeaderSubtitle,
  getMessagePreview,
  getPersonStatusLine,
  getPriorityMeta,
  getSearchResultPreview,
  getStatusMeta,
  getTaskAssignee,
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

const LazyEmojiPicker = lazy(() => import('emoji-picker-react'));

const MobileInfoTransition = forwardRef(function MobileInfoTransition(props, ref) {
  return (
    <Slide
      direction="left"
      ref={ref}
      easing={{
        enter: 'cubic-bezier(0.22, 1, 0.36, 1)',
        exit: 'cubic-bezier(0.4, 0, 1, 1)',
      }}
      timeout={{
        enter: 260,
        exit: 210,
      }}
      appear
      {...props}
    />
  );
});

function DialogSkeletonLine({ ui, width = '100%', height = 14, radius = 999, sx }) {
  return (
    <Skeleton
      variant="rounded"
      animation="wave"
      width={width}
      height={height}
      sx={{
        borderRadius: radius,
        bgcolor: ui.skeletonBase || alpha(ui.textSecondary || '#78909c', 0.16),
        '&::after': {
          background: `linear-gradient(90deg, transparent, ${ui.skeletonWave || alpha('#ffffff', 0.48)}, transparent)`,
        },
        ...sx,
      }}
    />
  );
}

function DialogListSkeleton({ ui, rows = 4, compact = false }) {
  return (
    <Stack spacing={compact ? 0.9 : 1.05} sx={{ px: compact ? 1.1 : 1.5, py: compact ? 1.25 : 2 }}>
      {Array.from({ length: rows }).map((_, index) => (
        <Stack key={index} direction="row" spacing={1.25} alignItems="center">
          <DialogSkeletonLine ui={ui} width={compact ? 34 : 42} height={compact ? 34 : 42} radius={compact ? 11 : 14} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <DialogSkeletonLine ui={ui} width={index % 2 ? '54%' : '72%'} height={14} radius={8} />
            <DialogSkeletonLine ui={ui} width={index % 2 ? '76%' : '48%'} height={11} radius={8} sx={{ mt: 0.8 }} />
          </Box>
        </Stack>
      ))}
    </Stack>
  );
}

function SearchResultCard({ item, ui, onOpen }) {
  const cardText = ui.textStrong || ui.textPrimary || '#17212b';
  const cardSurface = ui.surfaceMuted || ui.drawerBgSoft || ui.panelBg || '#ffffff';
  const cardHover = ui.surfaceHover || ui.drawerHover || ui.accentSoft || cardSurface;
  return (
    <Paper
      elevation={0}
      component="button"
      type="button"
      onClick={() => onOpen?.(item)}
      sx={{
        width: '100%',
        textAlign: 'left',
        p: 1.4,
        borderRadius: 3,
        border: `1px solid ${ui.borderSoft}`,
        bgcolor: cardSurface,
        cursor: 'pointer',
        color: cardText,
        transition: 'background-color 140ms ease, border-color 140ms ease, transform 100ms ease, opacity 100ms ease',
        '&:hover': {
          bgcolor: cardHover,
          borderColor: ui.accentSoft || alpha(ui.accentText || '#3390ec', 0.24),
        },
        '&:active': {
          opacity: 0.84,
          transform: 'scale(0.995)',
        },
      }}
    >
      <Stack spacing={0.7}>
        <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center">
          <Typography variant="subtitle2" sx={{ fontWeight: 800, color: cardText }} noWrap>
            {item?.sender?.full_name || item?.sender?.username || 'Сообщение'}
          </Typography>
          <Typography variant="caption" sx={{ color: ui.textSecondary, flexShrink: 0 }}>
            {formatFullDate(item?.created_at)}
          </Typography>
        </Stack>
        <Typography variant="body2" sx={{ color: ui.textSecondary }} noWrap>
          {getSearchResultPreview(item)}
        </Typography>
      </Stack>
    </Paper>
  );
}

function GroupUserRow({
  item,
  ui,
  onAction,
  checked = false,
}) {
  const accentColor = ui.accentText || '#3390ec';
  const primaryText = ui.textStrong || ui.bubbleOtherText || '#17212b';
  const selectedBg = ui.sidebarRowSoftActive || ui.accentSoft || alpha(accentColor, 0.12);
  return (
    <Paper
      elevation={0}
      component="button"
      type="button"
      role="checkbox"
      aria-checked={checked}
      data-user-id={String(item?.id || '')}
      onClick={() => onAction?.(item)}
      sx={{
        width: '100%',
        px: 1.4,
        py: 1.15,
        borderRadius: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 1.15,
        textAlign: 'left',
        color: primaryText,
        cursor: 'pointer',
        bgcolor: checked ? selectedBg : 'transparent',
        transition: 'background-color 140ms ease, opacity 100ms ease, transform 120ms ease',
        '&:active': {
          opacity: 0.78,
          transform: 'scale(0.995)',
        },
      }}
    >
      <Checkbox
        checked={checked}
        tabIndex={-1}
        disableRipple
        sx={{
          p: 0.25,
          color: alpha(primaryText, 0.38),
          '&.Mui-checked': {
            color: accentColor,
          },
        }}
      />
      <PresenceAvatar item={item} online={Boolean(item?.presence?.is_online)} size={40} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 800, color: primaryText }} noWrap>
          {item?.full_name || item?.username || 'Пользователь'}
        </Typography>
        <Typography variant="caption" sx={{ color: ui.textSecondary }} noWrap>
          {getPersonStatusLine(item)}
        </Typography>
      </Box>
    </Paper>
  );
}

function GroupUserCheckboxRow({
  item,
  ui,
  checked = false,
  onToggle,
  compact = false,
}) {
  const accentColor = ui.accentText || '#3390ec';
  const primaryText = ui.textStrong || ui.bubbleOtherText || '#17212b';
  const selectedBg = ui.sidebarRowSoftActive || ui.accentSoft || alpha(accentColor, 0.12);
  return (
    <Paper
      elevation={0}
      component="button"
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onToggle?.(item)}
      data-user-id={String(item?.id || '')}
      sx={{
        width: '100%',
        px: compact ? 1.15 : 1.4,
        py: compact ? 1 : 1.2,
        borderRadius: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 1.15,
        textAlign: 'left',
        color: primaryText,
        cursor: 'pointer',
        bgcolor: checked ? selectedBg : 'transparent',
        transition: 'background-color 140ms ease, opacity 100ms ease, transform 120ms ease',
        '&:active': {
          opacity: 0.78,
          transform: 'scale(0.995)',
        },
      }}
    >
      <Checkbox
        checked={checked}
        tabIndex={-1}
        disableRipple
        sx={{
          p: 0.25,
          color: alpha(primaryText, 0.38),
          '&.Mui-checked': {
            color: accentColor,
          },
        }}
      />
      <PresenceAvatar item={item} online={Boolean(item?.presence?.is_online)} size={compact ? 40 : 44} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant={compact ? 'body2' : 'body1'} sx={{ fontWeight: 700, color: primaryText }} noWrap>
          {item?.full_name || item?.username || 'Пользователь'}
        </Typography>
        <Typography variant="body2" sx={{ color: ui.textSecondary }} noWrap>
          {getPersonStatusLine(item)}
        </Typography>
      </Box>
    </Paper>
  );
}

function SelectedUserPill({ item, ui, onRemove, compact = false }) {
  const accentColor = ui.accentText || '#3390ec';
  const primaryText = ui.textStrong || ui.bubbleOtherText || '#17212b';
  return (
    <Stack
      direction="row"
      spacing={0.9}
      alignItems="center"
      sx={{
        pl: 0.6,
        pr: onRemove ? 0.35 : 0.95,
        py: 0.55,
        borderRadius: 999,
        border: `1px solid ${alpha(accentColor, 0.22)}`,
        bgcolor: ui.accentSoft || alpha(accentColor, 0.12),
        minWidth: 0,
        flex: '0 0 auto',
      }}
    >
      <PresenceAvatar item={item} online={Boolean(item?.presence?.is_online)} size={compact ? 28 : 32} />
      <Box sx={{ minWidth: 0, maxWidth: compact ? 136 : 168 }}>
        <Typography variant="caption" sx={{ display: 'block', fontWeight: 800, color: primaryText }} noWrap>
          {item?.full_name || item?.username || 'Участник'}
        </Typography>
        <Typography variant="caption" sx={{ display: 'block', color: ui.textSecondary }} noWrap>
          {item?.username ? `@${item.username}` : getPersonStatusLine(item)}
        </Typography>
      </Box>
      {onRemove ? (
        <IconButton
          size="small"
          aria-label={`Удалить ${item?.full_name || item?.username || 'участника'}`}
          onClick={() => onRemove(item)}
          sx={{
            width: 28,
            height: 28,
            color: alpha(primaryText, 0.62),
            '&:hover': { bgcolor: alpha(primaryText, 0.06) },
            '&:active': { opacity: 0.72 },
          }}
        >
          <CloseRoundedIcon sx={{ fontSize: 16 }} />
        </IconButton>
      ) : null}
    </Stack>
  );
}

export default function ChatDialogs({
  theme,
  ui,
  activeConversation,
  activeConversationId,
  threadMenuAnchor,
  onCloseThreadMenu,
  threadInfoOpen = false,
  onOpenInfo,
  messageMenuAnchor,
  messageMenuMessage,
  onCloseMessageMenu,
  onReplyFromMessageMenu,
  onCopyMessage,
  onTogglePinMessageFromMenu,
  messageMenuPinned = false,
  onCopyMessageLink,
  onForwardMessageFromMenu,
  onReportMessageFromMenu,
  onSelectMessageFromMenu,
  onOpenReadsFromMessageMenu,
  onOpenAttachmentFromMessageMenu,
  onOpenTaskFromMessageMenu,
  messages,
  composerMenuAnchor,
  onCloseComposerMenu,
  onOpenSearch,
  onOpenShare,
  onOpenFilePicker,
  onOpenMediaPicker,
  emojiPickerOpen,
  emojiAnchorEl,
  onCloseEmojiPicker,
  onInsertEmoji,
  fileInputRef,
  mediaFileInputRef,
  fileDialogOpen,
  onCloseFileDialog,
  selectedFiles,
  fileCaption,
  onFileCaptionChange,
  preparingFiles = false,
  sendingFiles,
  fileUploadProgress = 0,
  fileSummary = null,
  onSendFiles,
  onRemoveSelectedFile,
  onClearSelectedFiles,
  groupOpen,
  onCloseGroup,
  groupTitle,
  onGroupTitleChange,
  groupSearch,
  onGroupSearchChange,
  groupUsers,
  groupUsersLoading,
  groupSelectedUsers,
  onAddGroupMember,
  onRemoveGroupMember,
  creatingConversation,
  groupCreateDisabled,
  onCreateGroup,
  shareOpen,
  onCloseShare,
  taskSearch,
  onTaskSearchChange,
  shareableTasks,
  shareableLoading,
  sharingTaskId,
  onShareTask,
  forwardOpen = false,
  onCloseForward,
  forwardSelectionCount = 0,
  forwardConversationQuery = '',
  onForwardConversationQueryChange,
  forwardTargets,
  forwardTargetsLoading = false,
  forwardingConversationId = '',
  onForwardMessageToConversation,
  onOpenAttachmentPreview,
  attachmentPreview,
  onCloseAttachmentPreview,
  messageReadsOpen,
  onCloseMessageReads,
  messageReadsMessage,
  messageReadsLoading,
  messageReadsItems,
  infoOpen,
  onCloseInfo,
  conversationHeaderSubtitle,
  settingsUpdating,
  onUpdateConversationSettings,
  onOpenTask,
  searchOpen,
  onCloseSearch,
  messageSearch,
  onMessageSearchChange,
  messageSearchResults,
  messageSearchLoading,
  messageSearchHasMore,
  onLoadMoreSearchResults,
  onOpenSearchResult,
}) {
  const previewFullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const prefersReducedMotion = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const groupSearchInputRef = useRef(null);
  const [groupStep, setGroupStep] = useState('members');
  const selectedGroupUsers = Array.isArray(groupSelectedUsers) ? groupSelectedUsers : [];
  const availableGroupUsers = Array.isArray(groupUsers) ? groupUsers : [];
  const activeConversationKind = String(activeConversation?.kind || '').trim();
  const messageMenuAnchorElement = messageMenuAnchor?.nodeType === 1
    ? messageMenuAnchor
    : (messageMenuAnchor?.anchorEl || null);
  const messageMenuAnchorPosition = messageMenuAnchor?.anchorPosition || null;
  const messageMenuUsesPointerAnchor = Boolean(messageMenuAnchorPosition);
  const messageMenuOpen = Boolean(messageMenuMessage && (messageMenuAnchorElement || messageMenuAnchorPosition));
  const messageMenuAttachments = Array.isArray(messageMenuMessage?.attachments) ? messageMenuMessage.attachments : [];
  const canCopyMessage = Boolean(String(getMessagePreview(messageMenuMessage) || '').trim());
  const canTogglePinMessage = Boolean(messageMenuMessage?.id);
  const canCopyMessageLink = Boolean(messageMenuMessage?.id && (messageMenuMessage?.conversation_id || activeConversationId));
  const canForwardMessage = Boolean(messageMenuMessage?.id);
  const canReportMessage = Boolean(messageMenuMessage?.id && !messageMenuMessage?.is_own);
  const canSelectMessage = Boolean(messageMenuMessage?.id);
  const forwardConversationItems = useMemo(() => {
    const source = Array.isArray(forwardTargets) ? forwardTargets : [];
    const normalizedQuery = String(forwardConversationQuery || '').trim().toLowerCase();
    if (!normalizedQuery) return source;
    // Keep the picker resilient if the parent passes an unfiltered list during intermediate renders/tests.
    return source.filter((item) => {
      const haystack = [
        item?.title,
        item?.direct_peer?.full_name,
        item?.direct_peer?.username,
        item?.last_message_preview,
      ]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
        .join(' ');
      return haystack.includes(normalizedQuery);
    });
  }, [forwardConversationQuery, forwardTargets]);
  const forwardSelectedCount = Number(forwardSelectionCount || 0);
  const forwardSearchPlaceholder = forwardSelectedCount > 1
    ? `Переслать ${forwardSelectedCount} сообщений...`
    : 'Переслать...';
  const canOpenReadsFromMessage = activeConversationKind === 'group'
    && Boolean(messageMenuMessage?.is_own)
    && Number(messageMenuMessage?.read_by_count || 0) > 0;
  const canOpenAttachmentFromMessage = messageMenuAttachments.length > 0;
  const canOpenTaskFromMessage = Boolean(messageMenuMessage?.kind === 'task_share' && messageMenuMessage?.task_preview?.id);
  const selectedGroupMemberIds = useMemo(
    () => new Set(selectedGroupUsers.map((item) => String(item?.id || '').trim()).filter(Boolean)),
    [selectedGroupUsers],
  );
  const composerMenuOpen = Boolean(composerMenuAnchor);
  const canProceedToGroupDetails = selectedGroupUsers.length >= 2 && !creatingConversation;
  const isGroupDetailsStep = groupStep === 'details';
  const accentColor = ui.accentText || theme.palette.primary.main;
  const accentSoft = ui.accentSoft || alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.1);
  const dialogTextColor = ui.textStrong || theme.palette.text.primary;
  const fullScreenDialogBg = alpha(ui.panelBg || theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.98 : 0.99);
  const groupInputBg = theme.palette.mode === 'dark'
    ? alpha(ui.sidebarSearchBg || ui.panelBg || '#111827', 0.9)
    : alpha(ui.sidebarSearchBg || '#f8fafc', 0.94);
  const isDarkTheme = theme.palette.mode === 'dark';
  const popupSurface = ui.drawerBg || ui.panelBg || (isDarkTheme ? '#17212b' : '#ffffff');
  const popupSurfaceSoft = ui.surfaceMuted || ui.drawerBgSoft || (isDarkTheme ? alpha('#ffffff', 0.06) : '#f3f5f7');
  const popupTextColor = ui.textStrong || (isDarkTheme ? '#f8fafc' : '#17212b');
  const popupMutedTextColor = ui.textSecondary || (isDarkTheme ? alpha('#ffffff', 0.68) : alpha('#17212b', 0.62));
  const popupIconColor = isDarkTheme ? alpha('#ffffff', 0.86) : alpha('#17212b', 0.78);
  const popupBorderColor = ui.borderSoft || (isDarkTheme ? alpha('#ffffff', 0.06) : alpha('#17212b', 0.08));
  const popupHoverBg = ui.drawerHover || ui.surfaceHover || (isDarkTheme ? alpha('#ffffff', 0.07) : alpha('#17212b', 0.06));
  const popupActiveBg = ui.sidebarRowPressed || (isDarkTheme ? alpha('#ffffff', 0.1) : alpha('#17212b', 0.1));
  const popupDangerColor = ui.dangerText || (isDarkTheme ? '#ff6666' : '#d94d4d');
  const popupShadow = ui.shadowStrong || (isDarkTheme ? '0 20px 56px rgba(0, 0, 0, 0.42)' : '0 18px 48px rgba(15, 23, 42, 0.18)');
  const dialogPaperSx = useMemo(() => ({
    borderRadius: { xs: 3, sm: 3.5 },
    border: `1px solid ${alpha(ui.borderSoft || '#334155', 0.95)}`,
    bgcolor: alpha(ui.drawerBg || ui.panelBg || '#0f172a', 0.97),
    color: dialogTextColor,
    fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
    backgroundImage: 'none',
    boxShadow: ui.shadowStrong || (theme.palette.mode === 'dark' ? '0 28px 72px rgba(2, 6, 23, 0.5)' : '0 24px 64px rgba(15, 23, 42, 0.16)'),
    backdropFilter: 'blur(22px) saturate(1.08)',
  }), [dialogTextColor, theme.palette.mode, ui.borderSoft, ui.drawerBg, ui.panelBg, ui.shadowStrong]);
  const dialogTitleSx = useMemo(() => ({
    px: 3,
    pt: 2.5,
    pb: 1.5,
    fontWeight: 800,
    fontSize: '1.05rem',
    letterSpacing: '-0.01em',
    borderBottom: `1px solid ${ui.borderSoft}`,
  }), [ui.borderSoft]);
  const dialogContentSx = useMemo(() => ({
    px: 3,
    py: 2,
    bgcolor: 'transparent',
  }), []);
  const dialogActionsSx = useMemo(() => ({
    px: 3,
    pb: 2.25,
    pt: 1.25,
    borderTop: `1px solid ${alpha(ui.borderSoft || '#334155', 0.72)}`,
  }), [ui.borderSoft]);
  const surfaceCardSx = useMemo(() => ({
    borderRadius: 3,
    border: `1px solid ${ui.borderSoft}`,
    overflow: 'hidden',
    bgcolor: ui.surfaceMuted || alpha(ui.pageBg || ui.panelBg || '#020617', 0.44),
    boxShadow: 'none',
  }), [ui.borderSoft, ui.pageBg, ui.panelBg, ui.surfaceMuted]);
  const messageMenuPaperSx = useMemo(() => ({
    minWidth: 248,
    maxWidth: 300,
    mt: messageMenuUsesPointerAnchor ? 0 : 0.75,
    borderRadius: 3.2,
    border: `1px solid ${popupBorderColor}`,
    bgcolor: popupSurface,
    color: popupTextColor,
    backgroundImage: 'none',
    backdropFilter: 'blur(18px)',
    boxShadow: popupShadow,
    overflow: 'hidden',
    '& .MuiList-root': {
      py: 0.65,
    },
    '& .MuiMenuItem-root': {
      minHeight: 44,
      gap: 1.55,
      px: 1.8,
      py: 1,
      mx: 0.5,
      my: 0.1,
      borderRadius: 1.7,
      fontSize: '1.05rem',
      fontWeight: 600,
      letterSpacing: '-0.01em',
      fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
      color: popupTextColor,
      transition: 'background-color 120ms ease, opacity 100ms ease',
      '&:hover': {
        bgcolor: popupHoverBg,
      },
      '&:active': {
        bgcolor: popupActiveBg,
      },
      '&.Mui-disabled': {
        opacity: 0.42,
      },
      '& .MuiSvgIcon-root': {
        fontSize: 22,
        color: popupIconColor,
        flexShrink: 0,
      },
      '&[data-message-menu-tone="danger"]': {
        color: popupDangerColor,
      },
      '&[data-message-menu-tone="danger"] .MuiSvgIcon-root': {
        color: popupDangerColor,
      },
    },
    '& .MuiDivider-root': {
      my: 0.4,
      borderColor: popupBorderColor,
    },
  }), [messageMenuUsesPointerAnchor, popupActiveBg, popupBorderColor, popupDangerColor, popupHoverBg, popupIconColor, popupShadow, popupSurface, popupTextColor]);
  const forwardDialogPaperSx = useMemo(() => ({
    borderRadius: { xs: 3, sm: 4 },
    border: `1px solid ${popupBorderColor}`,
    bgcolor: popupSurface,
    color: popupTextColor,
    fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
    backgroundImage: 'none',
    boxShadow: popupShadow,
    width: 'min(100vw - 24px, 560px)',
    maxWidth: '100%',
    height: 'min(calc(100dvh - 28px), 760px)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  }), [popupBorderColor, popupShadow, popupSurface, popupTextColor]);
  const forwardHeaderSx = useMemo(() => ({
    px: { xs: 1.35, sm: 1.6 },
    pt: { xs: 1.3, sm: 1.45 },
    pb: 1.1,
    borderBottom: `1px solid ${popupBorderColor}`,
    bgcolor: popupSurface,
  }), [popupBorderColor, popupSurface]);
  const forwardSearchShellSx = useMemo(() => ({
    display: 'flex',
    alignItems: 'center',
    gap: 1.05,
    width: '100%',
    minHeight: 46,
    px: 0.25,
  }), []);
  const forwardRowSx = useMemo(() => ({
    width: '100%',
    border: 'none',
    borderRadius: 2.4,
    display: 'flex',
    alignItems: 'center',
    gap: 1.4,
    px: { xs: 1.25, sm: 1.45 },
    py: 1.2,
    textAlign: 'left',
    color: popupTextColor,
    bgcolor: 'transparent',
    cursor: 'pointer',
    fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
    transition: 'background-color 120ms ease, opacity 100ms ease, transform 120ms ease',
    '&:hover': {
      bgcolor: popupHoverBg,
    },
    '&:active': {
      bgcolor: popupActiveBg,
      transform: 'scale(0.996)',
    },
    '&:disabled': {
      opacity: 0.48,
      cursor: 'default',
    },
  }), [popupActiveBg, popupHoverBg, popupTextColor]);
  const handleCloseForwardDialog = useCallback((_, reason) => {
    if (forwardingConversationId && (reason === 'backdropClick' || reason === 'escapeKeyDown')) return;
    onCloseForward?.();
  }, [forwardingConversationId, onCloseForward]);

  useEffect(() => {
    if (!groupOpen) {
      setGroupStep('members');
    }
  }, [groupOpen]);

  const handleAddGroupMember = (item) => {
    if (!item?.id || selectedGroupMemberIds.has(String(item.id))) return;
    onAddGroupMember?.(item);
    onGroupSearchChange?.('');
    window.requestAnimationFrame(() => {
      groupSearchInputRef.current?.focus?.();
    });
  };

  const handleRemoveGroupMember = (item) => {
    if (!item?.id) return;
    onRemoveGroupMember?.(item.id);
    window.requestAnimationFrame(() => {
      groupSearchInputRef.current?.focus?.();
    });
  };

  const handleToggleGroupMember = (item) => {
    if (!item?.id) return;
    if (selectedGroupMemberIds.has(String(item.id))) {
      handleRemoveGroupMember(item);
      return;
    }
    handleAddGroupMember(item);
  };

  const closeThreadMenu = () => {
    onCloseThreadMenu?.();
  };

  const closeComposerMenu = () => {
    onCloseComposerMenu?.();
  };

  const runThreadMenuAction = (callback) => () => {
    closeThreadMenu();
    callback?.();
  };

  const runComposerMenuAction = (callback) => () => {
    closeComposerMenu();
    callback?.();
  };

  const toggleConversationSetting = (payload) => () => {
    closeThreadMenu();
    void onUpdateConversationSettings?.(payload);
  };

  return (
    <>
      <Menu
        anchorReference={messageMenuUsesPointerAnchor ? 'anchorPosition' : 'anchorEl'}
        anchorEl={messageMenuUsesPointerAnchor ? null : messageMenuAnchorElement}
        anchorPosition={messageMenuUsesPointerAnchor ? messageMenuAnchorPosition : undefined}
        open={messageMenuOpen}
        onClose={onCloseMessageMenu}
        anchorOrigin={messageMenuUsesPointerAnchor ? undefined : { vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={messageMenuUsesPointerAnchor ? { vertical: 'top', horizontal: 'left' } : { vertical: 'top', horizontal: 'center' }}
        PaperProps={{
          elevation: 0,
          sx: messageMenuPaperSx,
        }}
      >
        <MenuItem onClick={() => onReplyFromMessageMenu?.(messageMenuMessage)} disabled={!messageMenuMessage}>
          <ReplyRoundedIcon />
          Ответить
        </MenuItem>
        <MenuItem onClick={() => onCopyMessage?.(messageMenuMessage)} disabled={!messageMenuMessage || !canCopyMessage}>
          <ContentCopyRoundedIcon />
          Копировать
        </MenuItem>
        <MenuItem onClick={() => onTogglePinMessageFromMenu?.(messageMenuMessage)} disabled={!messageMenuMessage || !canTogglePinMessage}>
          <PushPinOutlinedIcon />
          {messageMenuPinned ? 'Открепить' : 'Закрепить'}
        </MenuItem>
        <MenuItem onClick={() => onForwardMessageFromMenu?.(messageMenuMessage)} disabled={!messageMenuMessage || !canForwardMessage}>
          <ForwardRoundedIcon />
          Переслать
        </MenuItem>
        <MenuItem onClick={() => onSelectMessageFromMenu?.(messageMenuMessage)} disabled={!messageMenuMessage || !canSelectMessage}>
          <CheckCircleOutlineRoundedIcon />
          Выбрать
        </MenuItem>
        {canCopyMessageLink || canOpenReadsFromMessage || canOpenAttachmentFromMessage || canOpenTaskFromMessage || canReportMessage ? <Divider /> : null}
        {canCopyMessageLink ? (
          <MenuItem onClick={() => onCopyMessageLink?.(messageMenuMessage)} disabled={!messageMenuMessage}>
            <LinkRoundedIcon />
            Копировать ссылку
          </MenuItem>
        ) : null}
        {canOpenReadsFromMessage ? (
          <MenuItem onClick={() => onOpenReadsFromMessageMenu?.(messageMenuMessage)}>
            <DoneAllRoundedIcon />
            Кто прочитал
          </MenuItem>
        ) : null}
        {canOpenAttachmentFromMessage ? (
          <MenuItem onClick={() => onOpenAttachmentFromMessageMenu?.(messageMenuMessage)}>
            <OpenInNewRoundedIcon />
            Открыть вложение
          </MenuItem>
        ) : null}
        {canOpenTaskFromMessage ? (
          <MenuItem onClick={() => onOpenTaskFromMessageMenu?.(messageMenuMessage)}>
            <TaskAltRoundedIcon />
            Открыть задачу
          </MenuItem>
        ) : null}
        {canReportMessage ? (
          <MenuItem data-message-menu-tone="danger" onClick={() => onReportMessageFromMenu?.(messageMenuMessage)}>
            <FlagOutlinedIcon />
            Пожаловаться
          </MenuItem>
        ) : null}
      </Menu>

      {/* Меню 3 точки, стиль Telegram */}
      <Menu
        anchorEl={threadMenuAnchor}
        open={Boolean(threadMenuAnchor)}
        onClose={closeThreadMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          sx: {
            width: 280,
            mt: 0.5,
            borderRadius: 2,
            border: `1px solid ${popupBorderColor}`,
            bgcolor: popupSurface,
            color: popupTextColor,
            backgroundImage: 'none',
            boxShadow: popupShadow,
            overflow: 'hidden',
            '& .MuiMenuItem-root': {
              minHeight: 48,
              py: 1.2,
              px: 2,
              fontSize: '1.02rem',
              fontWeight: 400,
              gap: 1.5,
              fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
              color: popupTextColor,
              '&:hover': {
                bgcolor: popupHoverBg,
              },
              '&:active': {
                bgcolor: popupActiveBg,
              },
            },
          },
        }}
      >
        <MenuItem onClick={runThreadMenuAction(onOpenInfo)} disabled={!activeConversationId}>
          <InfoOutlinedIcon sx={{ fontSize: 22, color: popupIconColor, flexShrink: 0 }} />
          {activeConversationKind === 'group' ? 'Информация о группе' : 'Информация о чате'}
        </MenuItem>

        <Divider sx={{ bgcolor: popupBorderColor }} />

        <MenuItem onClick={runThreadMenuAction(onOpenSearch)} disabled={!activeConversationId}>
          <SearchRoundedIcon sx={{ fontSize: 22, color: popupIconColor, flexShrink: 0 }} />
          Поиск
        </MenuItem>

        <MenuItem onClick={toggleConversationSetting({ is_pinned: !activeConversation?.is_pinned })} disabled={!activeConversationId || settingsUpdating}>
          <PushPinOutlinedIcon sx={{ fontSize: 22, color: popupIconColor, flexShrink: 0 }} />
          {activeConversation?.is_pinned ? 'Открепить чат' : 'Закрепить чат'}
        </MenuItem>

        <MenuItem onClick={toggleConversationSetting({ is_muted: !activeConversation?.is_muted })} disabled={!activeConversationId || settingsUpdating}>
          {activeConversation?.is_muted ? (
            <VolumeUpIcon sx={{ fontSize: 22, color: popupIconColor, flexShrink: 0 }} />
          ) : (
            <VolumeOffIcon sx={{ fontSize: 22, color: popupIconColor, flexShrink: 0 }} />
          )}
          {activeConversation?.is_muted ? 'Включить уведомления' : 'Отключить уведомления'}
        </MenuItem>

        <MenuItem onClick={runThreadMenuAction(onOpenShare)} disabled={!activeConversationId}>
          <ShareIcon sx={{ fontSize: 22, color: popupIconColor, flexShrink: 0 }} />
          Поделиться задачей
        </MenuItem>

        <Divider sx={{ bgcolor: popupBorderColor }} />

        <MenuItem
          onClick={runThreadMenuAction(() => {})}
          sx={{
            color: popupDangerColor,
            '&:active': { bgcolor: alpha(popupDangerColor, 0.12) },
          }}
        >
          <DeleteOutlineIcon sx={{ fontSize: 22, color: popupDangerColor, flexShrink: 0 }} />
          Удалить чат
        </MenuItem>
      </Menu>

      {previewFullScreen ? (
        <Popover
          open={composerMenuOpen}
          anchorEl={composerMenuAnchor}
          onClose={closeComposerMenu}
          disableAutoFocus
          disableEnforceFocus
          disableRestoreFocus
          anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
          transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          PaperProps={{
            sx: {
              mt: -1,
              ml: 0.5,
              minWidth: 228,
              borderRadius: 3.5,
              bgcolor: popupSurface,
              color: popupTextColor,
              backgroundImage: 'none',
              border: `1px solid ${popupBorderColor}`,
              boxShadow: popupShadow,
              overflow: 'hidden',
            },
          }}
        >
          <Stack data-testid="chat-composer-attachment-popup" sx={{ py: 0.5 }}>
            <Box
              component="button"
              type="button"
              data-testid="mobile-composer-attachment-media"
              onClick={runComposerMenuAction(onOpenMediaPicker)}
              disabled={!activeConversationId}
              sx={{
                width: '100%',
                px: 2,
                py: 1.45,
                border: 'none',
                bgcolor: 'transparent',
                color: popupTextColor,
                display: 'flex',
                alignItems: 'center',
                gap: 1.75,
                textAlign: 'left',
                transition: 'background-color 120ms ease, opacity 100ms ease',
                '&:active': {
                  opacity: 0.78,
                  bgcolor: popupHoverBg,
                },
                '&:disabled': {
                  opacity: 0.42,
                },
              }}
            >
              <PhotoLibraryRoundedIcon sx={{ fontSize: 28, color: popupIconColor, flexShrink: 0 }} />
              <Typography variant="body1" sx={{ fontWeight: 500 }}>
                Фото или видео
              </Typography>
            </Box>

            <Box
              component="button"
              type="button"
              data-testid="mobile-composer-attachment-file"
              onClick={runComposerMenuAction(onOpenFilePicker)}
              disabled={!activeConversationId}
              sx={{
                width: '100%',
                px: 2,
                py: 1.45,
                border: 'none',
                bgcolor: 'transparent',
                color: popupTextColor,
                display: 'flex',
                alignItems: 'center',
                gap: 1.75,
                textAlign: 'left',
                transition: 'background-color 120ms ease, opacity 100ms ease',
                '&:active': {
                  opacity: 0.78,
                  bgcolor: popupHoverBg,
                },
                '&:disabled': {
                  opacity: 0.42,
                },
              }}
            >
              <DescriptionOutlinedIcon sx={{ fontSize: 28, color: popupIconColor, flexShrink: 0 }} />
              <Typography variant="body1" sx={{ fontWeight: 500 }}>
                Файл
              </Typography>
            </Box>

            <Box
              component="button"
              type="button"
              data-testid="mobile-composer-attachment-task"
              onClick={runComposerMenuAction(onOpenShare)}
              disabled={!activeConversationId}
              sx={{
                width: '100%',
                px: 2,
                py: 1.45,
                border: 'none',
                bgcolor: 'transparent',
                color: popupTextColor,
                display: 'flex',
                alignItems: 'center',
                gap: 1.75,
                textAlign: 'left',
                transition: 'background-color 120ms ease, opacity 100ms ease',
                '&:active': {
                  opacity: 0.78,
                  bgcolor: popupHoverBg,
                },
                '&:disabled': {
                  opacity: 0.42,
                },
              }}
            >
              <TaskAltRoundedIcon sx={{ fontSize: 28, color: popupIconColor, flexShrink: 0 }} />
              <Typography variant="body1" sx={{ fontWeight: 500 }}>
                Задача
              </Typography>
            </Box>
          </Stack>
        </Popover>
      ) : null}

      {false ? (
        <Dialog
          open={composerMenuOpen}
          onClose={closeComposerMenu}
          fullWidth
          maxWidth="xs"
          PaperProps={{
            sx: {
              mt: 'auto',
              mb: 0,
              mx: 0,
              width: '100%',
              maxWidth: '100%',
              borderRadius: '28px 28px 0 0',
              borderTop: `1px solid ${alpha(ui.borderSoft || '#334155', 0.88)}`,
              bgcolor: alpha('#0b1220', 0.992),
              color: '#fff',
              backgroundImage: 'none',
              boxShadow: '0 -18px 48px rgba(2, 6, 23, 0.46)',
            },
          }}
        >
          <Box
            data-testid="chat-composer-attachment-sheet"
            sx={{
              px: 2,
              pt: 1.1,
              pb: 'max(calc(env(safe-area-inset-bottom) + 12px), 18px)',
            }}
          >
            <Box
              sx={{
                width: 38,
                height: 5,
                borderRadius: 999,
                bgcolor: alpha('#fff', 0.18),
                mx: 'auto',
                mb: 1.25,
              }}
            />
            <Typography component="span" variant="subtitle1" sx={{ fontWeight: 900, px: 0.5, mb: 1.1 }}>
              Добавить
            </Typography>
            <Stack spacing={0.9}>
              <Paper
                component="button"
                type="button"
                data-testid="mobile-composer-attachment-media"
                onClick={runComposerMenuAction(onOpenFilePicker)}
                disabled={!activeConversationId}
                sx={{
                  width: '100%',
                  px: 1.5,
                  py: 1.25,
                  borderRadius: 4,
                  border: 'none',
                  bgcolor: alpha('#ffffff', 0.055),
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.2,
                  textAlign: 'left',
                  transition: 'transform 100ms ease, opacity 100ms ease, background-color 140ms ease',
                  '&:active': {
                    opacity: 0.78,
                    transform: 'scale(0.992)',
                  },
                  '&:disabled': {
                    opacity: 0.42,
                  },
                }}
              >
                <Box
                  sx={{
                    width: 42,
                    height: 42,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: ui.accentSoft || alpha(accentColor, 0.18),
                    color: accentColor,
                    flexShrink: 0,
                  }}
                >
                  <PhotoLibraryRoundedIcon sx={{ fontSize: 20 }} />
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 800 }}>
                    Фото или видео
                  </Typography>
                  <Typography variant="caption" sx={{ color: ui.textSecondary }}>
                    Галерея и камера устройства
                  </Typography>
                </Box>
                <ChevronRightRoundedIcon sx={{ color: alpha('#fff', 0.34) }} />
              </Paper>

              <Paper
                component="button"
                type="button"
                data-testid="mobile-composer-attachment-file"
                onClick={runComposerMenuAction(onOpenFilePicker)}
                disabled={!activeConversationId}
                sx={{
                  width: '100%',
                  px: 1.5,
                  py: 1.25,
                  borderRadius: 4,
                  border: 'none',
                  bgcolor: alpha('#ffffff', 0.055),
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.2,
                  textAlign: 'left',
                  transition: 'transform 100ms ease, opacity 100ms ease, background-color 140ms ease',
                  '&:active': {
                    opacity: 0.78,
                    transform: 'scale(0.992)',
                  },
                  '&:disabled': {
                    opacity: 0.42,
                  },
                }}
              >
                <Box
                  sx={{
                    width: 42,
                    height: 42,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: alpha('#38bdf8', 0.18),
                    color: '#bae6fd',
                    flexShrink: 0,
                  }}
                >
                  <DescriptionOutlinedIcon sx={{ fontSize: 20 }} />
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 800 }}>
                    Файл
                  </Typography>
                  <Typography variant="caption" sx={{ color: ui.textSecondary }}>
                    PDF, DOCX, XLSX и другие
                  </Typography>
                </Box>
                <ChevronRightRoundedIcon sx={{ color: alpha('#fff', 0.34) }} />
              </Paper>

              <Paper
                component="button"
                type="button"
                data-testid="mobile-composer-attachment-task"
                onClick={runComposerMenuAction(onOpenShare)}
                disabled={!activeConversationId}
                sx={{
                  width: '100%',
                  px: 1.5,
                  py: 1.25,
                  borderRadius: 4,
                  border: 'none',
                  bgcolor: alpha('#ffffff', 0.055),
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.2,
                  textAlign: 'left',
                  transition: 'transform 100ms ease, opacity 100ms ease, background-color 140ms ease',
                  '&:active': {
                    opacity: 0.78,
                    transform: 'scale(0.992)',
                  },
                  '&:disabled': {
                    opacity: 0.42,
                  },
                }}
              >
                <Box
                  sx={{
                    width: 42,
                    height: 42,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: alpha('#22c55e', 0.18),
                    color: '#bbf7d0',
                    flexShrink: 0,
                  }}
                >
                  <TaskAltRoundedIcon sx={{ fontSize: 20 }} />
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 800 }}>
                    Задача
                  </Typography>
                  <Typography variant="caption" sx={{ color: ui.textSecondary }}>
                    Отправить карточку задачи
                  </Typography>
                </Box>
                <ChevronRightRoundedIcon sx={{ color: alpha('#fff', 0.34) }} />
              </Paper>
            </Stack>
          </Box>
        </Dialog>
      ) : null}

      <Menu
        anchorEl={composerMenuAnchor}
        open={composerMenuOpen && !previewFullScreen}
        onClose={closeComposerMenu}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <MenuItem onClick={runComposerMenuAction(onOpenShare)} disabled={!activeConversationId}>Поделиться задачей</MenuItem>
        <MenuItem onClick={runComposerMenuAction(onOpenFilePicker)} disabled={!activeConversationId}>Отправить файлы</MenuItem>
      </Menu>

      <Popover
        open={emojiPickerOpen}
        anchorEl={emojiAnchorEl}
        onClose={onCloseEmojiPicker}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        PaperProps={{
          elevation: 12,
          sx: {
            borderRadius: 3,
            border: `1px solid ${alpha(ui.borderSoft, 0.96)}`,
            bgcolor: alpha(ui.panelBg, 0.98),
            backdropFilter: 'blur(10px)',
            overflow: 'hidden',
          },
        }}
      >
        {emojiPickerOpen ? (
          <Suspense
            fallback={(
              <Box sx={{ width: 320, height: 360, display: 'grid', placeItems: 'center' }}>
                <CircularProgress size={24} />
              </Box>
            )}
          >
            <LazyEmojiPicker
              onEmojiClick={(emojiData) => onInsertEmoji?.(emojiData?.emoji || '')}
              autoFocusSearch={false}
              searchPlaceholder="Найти эмодзи"
              skinTonesDisabled={false}
              previewConfig={{ showPreview: false }}
              width={320}
              height={360}
              theme={theme.palette.mode === 'dark' ? 'dark' : 'light'}
            />
          </Suspense>
        ) : null}
      </Popover>

      <ChatFileUploadDialog
        caption={fileCaption}
        fileInputRef={fileInputRef}
        files={selectedFiles}
        onCaptionChange={onFileCaptionChange}
        onClearFiles={onClearSelectedFiles}
        onClose={onCloseFileDialog}
        onRemoveFile={onRemoveSelectedFile}
        onSend={onSendFiles}
        open={fileDialogOpen}
        preparing={preparingFiles}
        sending={sendingFiles}
        theme={theme}
        ui={ui}
        uploadProgress={fileUploadProgress}
      />

      <Dialog
        open={groupOpen}
        onClose={onCloseGroup}
        fullScreen={previewFullScreen}
        fullWidth
        maxWidth="lg"
        PaperProps={{
          sx: previewFullScreen
            ? {
              m: 0,
              width: '100%',
              maxWidth: '100%',
              height: '100dvh',
              borderRadius: 0,
              bgcolor: fullScreenDialogBg,
              color: dialogTextColor,
              backgroundImage: 'none',
            }
            : dialogPaperSx,
        }}
      >
        <DialogTitle
          sx={previewFullScreen ? {
            ...dialogTitleSx,
            px: 1.6,
            pt: 'max(env(safe-area-inset-top), 10px)',
            pb: 1.2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: `1px solid ${alpha(ui.borderSoft || '#334155', 0.72)}`,
            bgcolor: alpha(fullScreenDialogBg, 0.94),
            backdropFilter: 'blur(18px)',
            position: 'sticky',
            top: 0,
            zIndex: 2,
          } : dialogTitleSx}
        >
          {previewFullScreen ? (
            <>
              <IconButton
                aria-label={isGroupDetailsStep ? 'Назад к выбору участников' : 'Закрыть создание группы'}
                onClick={isGroupDetailsStep ? () => setGroupStep('members') : onCloseGroup}
                sx={{ color: dialogTextColor }}
              >
                <ChevronLeftRoundedIcon />
              </IconButton>
              <Typography component="span" variant="subtitle1" sx={{ fontWeight: 900 }}>
                {isGroupDetailsStep ? 'Новая группа' : 'Выбор участников'}
              </Typography>
              <Button
                onClick={isGroupDetailsStep ? () => void onCreateGroup() : () => setGroupStep('details')}
                disabled={isGroupDetailsStep ? groupCreateDisabled : !canProceedToGroupDetails}
                sx={{
                  textTransform: 'none',
                  fontWeight: 900,
                  minWidth: 0,
                  px: 1.2,
                  visibility: 'hidden',
                }}
              >
                {isGroupDetailsStep ? 'Создать' : 'Далее'}
              </Button>
            </>
          ) : 'Новый групповой чат'}
        </DialogTitle>
        <DialogContent
          sx={previewFullScreen ? {
            px: 1.5,
            py: 1.5,
            bgcolor: 'transparent',
          } : dialogContentSx}
        >
          {!isGroupDetailsStep ? (
            <Stack spacing={2} sx={{ pt: previewFullScreen ? 0 : 1 }} data-testid="group-dialog-members-step">
              {selectedGroupUsers.length > 0 ? (
                <Stack
                  direction="row"
                  spacing={0.75}
                  sx={{
                    overflowX: 'auto',
                    pb: 0.35,
                    scrollbarWidth: 'none',
                    '&::-webkit-scrollbar': { display: 'none' },
                  }}
                  data-testid="group-selected-users"
                >
                  {selectedGroupUsers.map((item) => (
                    <SelectedUserPill
                      key={item.id}
                      item={item}
                      ui={ui}
                      compact={previewFullScreen}
                      onRemove={handleRemoveGroupMember}
                    />
                  ))}
                </Stack>
              ) : (
                <Box data-testid="group-selected-users-empty">
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    Пока никого не выбрано
                  </Typography>
                  <Typography variant="caption" sx={{ color: ui.textSecondary }}>
                    Добавь минимум двух участников.
                  </Typography>
                </Box>
              )}

              <TextField
                inputRef={groupSearchInputRef}
                size="small"
                label="Поиск участников"
                value={groupSearch}
                onChange={(event) => onGroupSearchChange(event.target.value)}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: previewFullScreen ? 3 : 2.5,
                    bgcolor: groupInputBg,
                  },
                }}
              />

              <Stack
                direction={{ xs: 'column', md: previewFullScreen ? 'column' : 'row' }}
                spacing={2}
                alignItems="stretch"
                data-testid={!previewFullScreen ? 'group-dialog-desktop-layout' : undefined}
              >
              <Paper elevation={0} sx={{ ...surfaceCardSx, flex: 1, minWidth: 0 }}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1.5, py: 1 }}>
                  <Typography variant="caption" sx={{ color: ui.textSecondary, fontWeight: 800 }}>
                    {String(groupSearch || '').trim() ? 'Результаты поиска' : 'Доступные участники'}
                  </Typography>
                  {!groupUsersLoading ? (
                    <Typography variant="caption" sx={{ color: ui.textSecondary }}>
                      {availableGroupUsers.length}
                    </Typography>
                  ) : null}
                </Stack>
                <Box sx={{ borderTop: `1px solid ${ui.borderSoft}` }} />
                {groupUsersLoading ? (
                  <DialogListSkeleton ui={ui} rows={5} compact={previewFullScreen} />
                ) : availableGroupUsers.length === 0 ? (
                  <Box sx={{ px: 1.5, py: 2.2 }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      Никого не найдено
                    </Typography>
                    <Typography variant="caption" sx={{ color: ui.textSecondary }}>
                      Попробуй другое имя или логин.
                    </Typography>
                  </Box>
                ) : (
                  <Box
                    sx={{
                      maxHeight: previewFullScreen ? 'calc(100dvh - 188px)' : 236,
                      overflowY: 'auto',
                      pb: previewFullScreen ? '96px' : 0,
                    }}
                    data-testid="group-user-search-results"
                  >
                    {availableGroupUsers.map((item, index) => (
                      <Box key={item.id}>
                        {index > 0 ? <Box sx={{ borderTop: `1px solid ${ui.borderSoft}` }} /> : null}
                        <GroupUserCheckboxRow
                          item={item}
                          ui={ui}
                          checked={selectedGroupMemberIds.has(String(item.id))}
                          onToggle={handleToggleGroupMember}
                          compact={previewFullScreen}
                        />
                      </Box>
                    ))}
                  </Box>
                )}
              </Paper>

              {previewFullScreen ? (
                <Fab
                  color="primary"
                  aria-label="Next group step"
                  onClick={() => setGroupStep('details')}
                  disabled={!canProceedToGroupDetails}
                  sx={{
                    position: 'fixed',
                    right: 22,
                    bottom: 'max(calc(env(safe-area-inset-bottom) + 22px), 28px)',
                    width: 60,
                    height: 60,
                    boxShadow: '0 18px 40px rgba(37, 99, 235, 0.32)',
                    zIndex: 4,
                  }}
                >
                  <ChevronRightRoundedIcon />
                </Fab>
              ) : null}

              {!previewFullScreen ? (
                <Paper elevation={0} sx={{ ...surfaceCardSx, width: { xs: '100%', md: 280 }, flexShrink: 0 }}>
                  <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1.5, py: 1 }}>
                    <Typography variant="caption" sx={{ color: ui.textSecondary, fontWeight: 800 }}>
                      Выбранные участники
                    </Typography>
                    <Typography variant="caption" sx={{ color: ui.textSecondary }}>
                      {selectedGroupUsers.length}
                    </Typography>
                  </Stack>
                  <Box sx={{ borderTop: `1px solid ${ui.borderSoft}` }} />
                  {selectedGroupUsers.length === 0 ? (
                    <Box sx={{ px: 1.5, py: 2.2 }}>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        Пока никого не выбрано
                      </Typography>
                      <Typography variant="caption" sx={{ color: ui.textSecondary }}>
                        Добавь участников из поиска выше.
                      </Typography>
                    </Box>
                  ) : (
                    <Box>
                      {selectedGroupUsers.map((item, index) => (
                        <Box key={item.id}>
                          {index > 0 ? <Box sx={{ borderTop: `1px solid ${ui.borderSoft}` }} /> : null}
                          <GroupUserCheckboxRow
                            item={item}
                            ui={ui}
                            checked
                            onToggle={handleToggleGroupMember}
                            compact
                          />
                        </Box>
                      ))}
                    </Box>
                  )}
                </Paper>
              ) : null}

              <Typography variant="caption" sx={{ color: ui.textSecondary, px: 0.5 }}>
                Для новой группы сначала выбери минимум 2 участников.
              </Typography>
            </Stack>
          </Stack>
          ) : (
            <Stack spacing={2} sx={{ pt: previewFullScreen ? 0.5 : 1 }} data-testid="group-dialog-details-step">
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2.2} alignItems="stretch">
                <Paper
                  elevation={0}
                  sx={{
                    ...surfaceCardSx,
                    width: { xs: '100%', md: 240 },
                    flexShrink: 0,
                    px: 2.4,
                    py: 2.6,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Stack alignItems="center" spacing={1.25}>
                    <Box
                      sx={{
                        width: 88,
                        height: 88,
                        borderRadius: '50%',
                        display: 'grid',
                        placeItems: 'center',
                        bgcolor: accentSoft,
                        color: accentColor,
                        fontSize: '1.5rem',
                        fontWeight: 900,
                        letterSpacing: '0.04em',
                      }}
                    >
                      {groupTitle ? String(groupTitle).trim().slice(0, 2).toUpperCase() : `${selectedGroupUsers.length}`}
                    </Box>
                    <Typography variant="body2" sx={{ color: ui.textSecondary }}>
                      Название и состав можно изменить позже.
                    </Typography>
                  </Stack>
                </Paper>
                <Paper
                  elevation={0}
                  sx={{
                    ...surfaceCardSx,
                    flex: 1,
                    p: { xs: 1.6, md: 2.1 },
                  }}
                >
                  <Stack spacing={1.7}>
                    <TextField
                      inputProps={{ 'data-testid': 'group-dialog-title-input' }}
                      label="Название группы"
                      value={groupTitle}
                      onChange={(event) => onGroupTitleChange(event.target.value)}
                    />
                    <Stack direction="row" alignItems="center" justifyContent="space-between">
                      <Typography variant="caption" sx={{ color: ui.textSecondary, fontWeight: 800 }}>
                        Участники
                      </Typography>
                      <Typography variant="caption" sx={{ color: ui.textSecondary }}>
                        {selectedGroupUsers.length}
                      </Typography>
                    </Stack>
                    <Stack direction="row" spacing={0.9} flexWrap="wrap" useFlexGap data-testid="group-selected-users">
                      {selectedGroupUsers.map((item) => (
                        <Chip
                          key={item.id}
                          label={item?.full_name || item?.username || 'Участник'}
                          sx={{
                            bgcolor: accentSoft,
                            color: dialogTextColor,
                            borderRadius: 999,
                            fontWeight: 700,
                          }}
                        />
                      ))}
                    </Stack>
                  </Stack>
                </Paper>
              </Stack>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={dialogActionsSx}>
          {previewFullScreen && isGroupDetailsStep ? (
            <Box
              sx={{
                width: '100%',
                px: 0.25,
                pb: 'max(env(safe-area-inset-bottom), 10px)',
                pt: 0.4,
              }}
            >
              <Button
                fullWidth
                variant="contained"
                onClick={() => void onCreateGroup()}
                disabled={groupCreateDisabled}
                sx={{
                  minHeight: 48,
                  borderRadius: 999,
                  textTransform: 'none',
                  fontWeight: 900,
                  boxShadow: 'none',
                }}
              >
                Создать
              </Button>
            </Box>
          ) : null}
          {!previewFullScreen ? (
            !isGroupDetailsStep ? (
              <>
                <Button onClick={onCloseGroup}>Отмена</Button>
                <Button
                  variant="contained"
                  data-testid="group-dialog-primary-action"
                  onClick={() => setGroupStep('details')}
                  disabled={!canProceedToGroupDetails}
                >
                  Далее
                </Button>
              </>
            ) : (
              <>
                <Button onClick={() => setGroupStep('members')}>Назад</Button>
                <Button
                  variant="contained"
                  data-testid="group-dialog-primary-action"
                  onClick={() => void onCreateGroup()}
                  disabled={groupCreateDisabled}
                >
                  Создать
                </Button>
              </>
            )
          ) : null}
        </DialogActions>
      </Dialog>

      <Dialog open={shareOpen} onClose={onCloseShare} fullWidth maxWidth="md" PaperProps={{ sx: dialogPaperSx }}>
        <DialogTitle sx={dialogTitleSx}>Поделиться задачей</DialogTitle>
        <DialogContent sx={dialogContentSx}>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="info" sx={{ borderRadius: 2 }}>
              Показываются только задачи, которые уже доступны всем активным участникам этого чата по текущим правилам hub.
            </Alert>
            <TextField
              size="small"
              label="Поиск по задачам"
              value={taskSearch}
              onChange={(event) => onTaskSearchChange(event.target.value)}
              placeholder="Название или описание задачи"
            />
            <Paper elevation={0} sx={{ ...surfaceCardSx, maxHeight: 420, overflowY: 'auto' }}>
              {shareableLoading ? (
                <DialogListSkeleton ui={ui} rows={4} />
              ) : shareableTasks.length === 0 ? (
                <Alert severity="warning" sx={{ borderRadius: 0 }}>
                  В этом чате нет задач, которые можно безопасно отправить.
                </Alert>
              ) : (
                <List disablePadding>
                  {shareableTasks.map((item, index) => {
                    const statusMeta = getStatusMeta(item.status);
                    const priorityMeta = getPriorityMeta(item.priority);
                    const isSending = sharingTaskId === item.id;
                    const hasOtherSend = Boolean(sharingTaskId) && !isSending;
                    return (
                      <Box key={item.id}>
                        {index > 0 ? <Box sx={{ borderTop: `1px solid ${ui.borderSoft}` }} /> : null}
                        <Box sx={{ px: 2, py: 1.5 }}>
                          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', md: 'center' }}>
                            <Box sx={{ minWidth: 0, flex: 1 }}>
                              <Stack spacing={1}>
                                <Typography sx={{ fontWeight: 800 }}>{item.title}</Typography>
                                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                                  <Chip size="small" label={statusMeta[0]} sx={{ fontWeight: 800, bgcolor: statusMeta[2], color: statusMeta[1] }} />
                                  <Chip size="small" label={priorityMeta[0]} sx={{ fontWeight: 800, bgcolor: priorityMeta[2], color: priorityMeta[1] }} />
                                  {item.is_overdue ? <Chip size="small" label="Просрочено" sx={{ fontWeight: 800, bgcolor: 'rgba(220,38,38,0.12)', color: '#dc2626' }} /> : null}
                                </Stack>
                                <Typography variant="body2" sx={{ color: ui.textSecondary }}>
                                  Исполнитель: {getTaskAssignee(item)}
                                </Typography>
                                <Typography variant="body2" sx={{ color: ui.textSecondary }}>
                                  Срок: {item.due_at ? formatFullDate(item.due_at) : 'Без срока'}
                                </Typography>
                              </Stack>
                            </Box>
                            <Button variant="outlined" disabled={hasOtherSend} onClick={() => void onShareTask(item.id)}>
                              {isSending ? 'Отправка...' : 'Отправить задачу'}
                            </Button>
                          </Stack>
                        </Box>
                      </Box>
                    );
                  })}
                </List>
              )}
            </Paper>
          </Stack>
        </DialogContent>
        <DialogActions sx={dialogActionsSx}>
          <Button onClick={onCloseShare}>Закрыть</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={forwardOpen}
        onClose={handleCloseForwardDialog}
        aria-labelledby="chat-forward-dialog-title"
        fullWidth
        maxWidth="sm"
        PaperProps={{ sx: forwardDialogPaperSx }}
      >
        <DialogTitle
          id="chat-forward-dialog-title"
          sx={{
            position: 'absolute',
            width: 1,
            height: 1,
            p: 0,
            overflow: 'hidden',
            clip: 'rect(0 0 0 0)',
            whiteSpace: 'nowrap',
          }}
        >
          Переслать в другой чат
        </DialogTitle>
        <Box sx={forwardHeaderSx}>
          <Box sx={forwardSearchShellSx}>
            <IconButton
              aria-label="Закрыть окно пересылки"
              onClick={onCloseForward}
              disabled={Boolean(forwardingConversationId)}
              sx={{
                width: 34,
                height: 34,
                color: popupMutedTextColor,
                '&:hover': { bgcolor: popupHoverBg },
              }}
            >
              <CloseRoundedIcon />
            </IconButton>
            <InputBase
              autoFocus
              fullWidth
              value={forwardConversationQuery}
              onChange={(event) => onForwardConversationQueryChange?.(event.target.value)}
              placeholder={forwardSearchPlaceholder}
              inputProps={{ 'aria-label': 'Поиск чата для пересылки' }}
              sx={{
                flex: 1,
                fontSize: '1.08rem',
                fontWeight: 500,
                fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
                color: popupTextColor,
                '& input::placeholder': {
                  color: popupMutedTextColor,
                  opacity: 1,
                },
              }}
            />
          </Box>
        </Box>
        <DialogContent
          sx={{
            px: 0.85,
            py: 0.8,
            bgcolor: popupSurface,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 0.2 }}>
            {forwardTargetsLoading ? (
              <DialogListSkeleton ui={ui} rows={5} />
            ) : forwardConversationItems.length === 0 ? (
              <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 240, px: 3.5, textAlign: 'center' }}>
                <Typography sx={{ color: popupTextColor, fontWeight: 700, fontFamily: TELEGRAM_CHAT_FONT_FAMILY, fontSize: '1.08rem' }}>
                  Чаты не найдены
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.65, color: popupMutedTextColor, fontFamily: TELEGRAM_CHAT_FONT_FAMILY, fontSize: '0.98rem' }}>
                  Попробуйте другое название чата или имя участника.
                </Typography>
              </Stack>
            ) : (
              <List disablePadding>
                {forwardConversationItems.map((item) => {
                  const isForwarding = forwardingConversationId === item.id;
                  const hasOtherForward = Boolean(forwardingConversationId) && !isForwarding;
                  const subtitle = getConversationHeaderSubtitle(item) || item?.last_message_preview || 'Чат';
                  const avatarItem = item?.kind === 'direct' ? (item?.direct_peer || item) : item;
                  return (
                    <Box key={item.id}>
                      <Paper
                        elevation={0}
                        component="button"
                        type="button"
                        onClick={() => void onForwardMessageToConversation?.(item.id)}
                        disabled={Boolean(hasOtherForward || isForwarding)}
                        aria-label={`Переслать в чат ${item?.title || 'Чат'}`}
                        sx={{
                          ...forwardRowSx,
                          bgcolor: isForwarding ? alpha(accentColor, isDarkTheme ? 0.16 : 0.1) : 'transparent',
                        }}
                      >
                        <PresenceAvatar
                          item={avatarItem}
                          online={Boolean(item?.kind === 'direct' && item?.direct_peer?.presence?.is_online)}
                          size={52}
                        />
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography sx={{ color: popupTextColor, fontWeight: 700, fontSize: '1.08rem', fontFamily: TELEGRAM_CHAT_FONT_FAMILY, letterSpacing: '-0.01em' }} noWrap>
                            {item?.title || 'Чат'}
                          </Typography>
                          <Typography variant="body2" sx={{ color: popupMutedTextColor, mt: 0.1, fontFamily: TELEGRAM_CHAT_FONT_FAMILY, fontSize: '0.98rem' }} noWrap>
                            {subtitle}
                          </Typography>
                        </Box>
                        {isForwarding ? (
                          <CircularProgress size={18} thickness={5} sx={{ color: accentColor, flexShrink: 0 }} />
                        ) : null}
                      </Paper>
                    </Box>
                  );
                })}
              </List>
            )}
          </Box>
        </DialogContent>
      </Dialog>

      <ChatMediaPreviewDialog
        attachmentPreview={attachmentPreview}
        fullScreen={previewFullScreen}
        onClose={onCloseAttachmentPreview}
        prefersReducedMotion={prefersReducedMotion}
      />
      <Dialog open={searchOpen} onClose={onCloseSearch} fullWidth maxWidth="sm" PaperProps={{ sx: dialogPaperSx }}>
        <DialogTitle sx={dialogTitleSx}>Поиск по сообщениям</DialogTitle>
        <DialogContent sx={dialogContentSx}>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              autoFocus
              size="small"
              label="Текст сообщения"
              value={messageSearch}
              onChange={(event) => onMessageSearchChange(event.target.value)}
              placeholder="Например: акт, договор, Иванов"
            />
            {messageSearchLoading ? (
              <DialogListSkeleton ui={ui} rows={4} />
            ) : messageSearchResults.length === 0 ? (
              <Alert severity="info" sx={{ borderRadius: 2 }}>
                {String(messageSearch || '').trim() ? 'Совпадения не найдены.' : 'Введите запрос, чтобы найти сообщения в этом чате.'}
              </Alert>
            ) : (
              <Stack spacing={1}>
                {messageSearchResults.map((item) => (
                  <SearchResultCard key={item.id} item={item} ui={ui} onOpen={onOpenSearchResult} />
                ))}
                {messageSearchHasMore ? (
                  <Stack alignItems="center" sx={{ pt: 0.5 }}>
                    <Button variant="text" size="small" onClick={() => void onLoadMoreSearchResults?.()}>
                      Показать ещё
                    </Button>
                  </Stack>
                ) : null}
              </Stack>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={dialogActionsSx}>
          <Button onClick={onCloseSearch}>Закрыть</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={messageReadsOpen} onClose={onCloseMessageReads} fullWidth maxWidth="xs" PaperProps={{ sx: dialogPaperSx }}>
        <DialogTitle sx={dialogTitleSx}>Просмотрено</DialogTitle>
        <DialogContent sx={dialogContentSx}>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {messageReadsMessage ? (
              <Paper elevation={0} sx={{ ...surfaceCardSx, p: 1.5 }}>
                <Typography variant="body2" sx={{ color: ui.textSecondary }}>
                  {getSearchResultPreview(messageReadsMessage)}
                </Typography>
              </Paper>
            ) : null}
            {messageReadsLoading ? (
              <DialogListSkeleton ui={ui} rows={3} compact />
            ) : messageReadsItems.length === 0 ? (
              <Alert severity="info" sx={{ borderRadius: 2 }}>
                Пока никто не открыл это сообщение.
              </Alert>
            ) : (
              <List disablePadding sx={{ ...surfaceCardSx, borderRadius: 2 }}>
                {messageReadsItems.map((item, index) => (
                  <Box key={`${item.user.id}-${item.read_at}`}>
                    {index > 0 ? <Box sx={{ borderTop: `1px solid ${ui.borderSoft}` }} /> : null}
                    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ px: 2, py: 1.25 }}>
                      <PresenceAvatar item={item.user} online={Boolean(item?.user?.presence?.is_online)} size={40} />
                      <ListItemText
                        primary={item.user.full_name || item.user.username}
                        secondary={`${getPersonStatusLine(item.user)} • ${formatFullDate(item.read_at)}`}
                      />
                    </Stack>
                  </Box>
                ))}
              </List>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={dialogActionsSx}>
          <Button onClick={onCloseMessageReads}>Закрыть</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={infoOpen}
        onClose={onCloseInfo}
        fullScreen
        TransitionComponent={MobileInfoTransition}
        transitionDuration={prefersReducedMotion ? 0 : { enter: 220, exit: 180 }}
        PaperProps={{
          sx: {
            bgcolor: 'transparent',
            backgroundImage: 'none',
            boxShadow: 'none',
            overflow: 'hidden',
          },
        }}
      >
        <Box sx={{ height: '100%', minHeight: 0 }}>
          <ChatContextPanel
            theme={theme}
            ui={ui}
            activeConversation={activeConversation}
            conversationHeaderSubtitle={conversationHeaderSubtitle}
            messages={messages}
            open={infoOpen}
            embedded
            mobileScreen
            onClose={onCloseInfo}
            onToggleOpen={onCloseInfo}
            onOpenSearch={onOpenSearch}
            onOpenShare={onOpenShare}
            onOpenFilePicker={onOpenFilePicker}
            onUpdateConversationSettings={onUpdateConversationSettings}
            settingsUpdating={settingsUpdating}
            onOpenAttachmentPreview={onOpenAttachmentPreview}
            onOpenTask={onOpenTask}
          />
        </Box>
      </Dialog>
    </>
  );
}
