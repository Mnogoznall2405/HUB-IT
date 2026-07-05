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
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DoneAllRoundedIcon from '@mui/icons-material/DoneAllRounded';
import FlagOutlinedIcon from '@mui/icons-material/FlagOutlined';
import ForwardRoundedIcon from '@mui/icons-material/ForwardRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import PhotoLibraryRoundedIcon from '@mui/icons-material/PhotoLibraryRounded';
import PhotoCameraRoundedIcon from '@mui/icons-material/PhotoCameraRounded';
import AddAPhotoRoundedIcon from '@mui/icons-material/AddAPhotoRounded';
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import ReplyRoundedIcon from '@mui/icons-material/ReplyRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import ShareIcon from '@mui/icons-material/Share';
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';

import ChatContextPanel from './ChatContextPanel';
import {
  DialogListSkeleton,
  GroupUserCheckboxRow,
  SearchResultCard,
  SelectedUserPill,
} from './ChatDialogsPrimitives';
import ChatFileUploadDialog from './ChatFileUploadDialog';
import ChatMediaPreviewDialog from './ChatMediaPreviewDialog';
import MailAttachmentPreviewDialog from '../mail/MailAttachmentPreviewDialog';
import { ConversationAvatar, PresenceAvatar } from './ChatCommon';
import ChatMessageContextMenu from './ChatMessageContextMenu';
import {
  CHAT_MAX_FILE_COUNT,
  formatFileSize,
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

const LazyEmojiPickerModule = lazy(() => import('emoji-picker-react'));
const LazyEmojiPicker = LazyEmojiPickerModule;

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

export default function ChatDialogs({
  theme,
  ui,
  activeConversation,
  activeConversationId,
  currentUser,
  threadMenuAnchor,
  onCloseThreadMenu,
  threadInfoOpen = false,
  onOpenInfo,
  messageMenuAnchor,
  messageMenuMessage,
  onCloseMessageMenu,
  onToggleReactionFromMenu,
  onReplyFromMessageMenu,
  onCopyMessage,
  onTogglePinMessageFromMenu,
  messageMenuPinned = false,
  onCopyMessageLink,
  onForwardMessageFromMenu,
  onReportMessageFromMenu,
  onDeleteMessageFromMenu,
  onEditMessageFromMenu,
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
  documentPreview,
  onCloseDocumentPreview,
  onDownloadDocumentPreview,
  onDownloadDocumentPreviewPdf,
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
  onRequestDeleteConversation,
  onAddGroupMembers,
  onRemoveGroupParticipant,
  onUpdateGroupMemberRole,
  onTransferGroupOwnership,
  onLeaveGroup,
  onUpdateGroupProfile,
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
  const density = ui.density || {};
  const isMobileEmojiLayout = useMediaQuery(theme.breakpoints.down('md'));
  const prefersReducedMotion = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const groupSearchInputRef = useRef(null);
  const [groupStep, setGroupStep] = useState('members');
  const [groupAvatarFile, setGroupAvatarFile] = useState(null);
  const [groupAvatarPreview, setGroupAvatarPreview] = useState(null);
  const groupAvatarInputRef = useRef(null);
  const selectedGroupUsers = Array.isArray(groupSelectedUsers) ? groupSelectedUsers : [];
  const availableGroupUsers = Array.isArray(groupUsers) ? groupUsers : [];
  const activeConversationKind = String(activeConversation?.kind || '').trim();
  const messageMenuAnchorElement = messageMenuAnchor?.nodeType === 1
    ? messageMenuAnchor
    : (messageMenuAnchor?.anchorEl || null);
  const messageMenuAnchorPosition = messageMenuAnchor?.anchorPosition || null;
  const messageMenuUsesPointerAnchor = Boolean(messageMenuAnchorPosition);
  const messageMenuOpen = Boolean(messageMenuMessage && (messageMenuAnchorElement || messageMenuAnchorPosition));
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
    borderRadius: { xs: 2, sm: 2 },
    border: 'none',
    bgcolor: alpha(ui.drawerBg || ui.panelBg || '#0f172a', 0.97),
    color: dialogTextColor,
    fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
    backgroundImage: 'none',
    boxShadow: ui.shadowStrong || (theme.palette.mode === 'dark' ? '0 28px 72px rgba(2, 6, 23, 0.5)' : '0 24px 64px rgba(15, 23, 42, 0.16)'),
    backdropFilter: 'blur(22px) saturate(1.08)',
  }), [dialogTextColor, theme.palette.mode, ui.drawerBg, ui.panelBg, ui.shadowStrong]);
  const dialogTitleSx = useMemo(() => ({
    p: density.dialogTitlePadding || '20px 24px 12px',
    fontWeight: 800,
    fontSize: density.dialogMenuFontSize || '1.05rem',
    letterSpacing: '-0.01em',
    borderBottom: `1px solid ${ui.borderSoft}`,
  }), [density.dialogMenuFontSize, density.dialogTitlePadding, ui.borderSoft]);
  const dialogContentSx = useMemo(() => ({
    p: density.dialogContentPadding || '16px 24px',
    bgcolor: 'transparent',
  }), [density.dialogContentPadding]);
  const dialogActionsSx = useMemo(() => ({
    p: density.dialogActionsPadding || '10px 24px 18px',
    borderTop: `1px solid ${alpha(ui.borderSoft || '#334155', 0.72)}`,
  }), [density.dialogActionsPadding, ui.borderSoft]);
  const surfaceCardSx = useMemo(() => ({
    borderRadius: 3,
    border: `1px solid ${ui.borderSoft}`,
    overflow: 'hidden',
    bgcolor: ui.surfaceMuted || alpha(ui.pageBg || ui.panelBg || '#020617', 0.44),
    boxShadow: 'none',
  }), [ui.borderSoft, ui.pageBg, ui.panelBg, ui.surfaceMuted]);
  const forwardDialogPaperSx = useMemo(() => ({
    borderRadius: { xs: 3, sm: 4 },
    border: `1px solid ${popupBorderColor}`,
    bgcolor: popupSurface,
    color: popupTextColor,
    fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
    backgroundImage: 'none',
    boxShadow: popupShadow,
    width: density.dialogForwardWidth || 'min(100vw - 24px, 560px)',
    maxWidth: '100%',
    height: density.dialogForwardHeight || 'min(calc(100dvh - 28px), 760px)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  }), [density.dialogForwardHeight, density.dialogForwardWidth, popupBorderColor, popupShadow, popupSurface, popupTextColor]);
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
    minHeight: density.dialogMenuItemMinHeight || 46,
    px: 0.25,
  }), [density.dialogMenuItemMinHeight]);
  const forwardRowSx = useMemo(() => ({
    width: '100%',
    border: 'none',
    borderRadius: 2.4,
    display: 'flex',
    alignItems: 'center',
    gap: 1.4,
    px: { xs: 1.25, sm: density.dialogForwardRowPx || 1.45 },
    py: density.dialogForwardRowPy || 1.2,
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
  }), [density.dialogForwardRowPx, density.dialogForwardRowPy, popupActiveBg, popupHoverBg, popupTextColor]);
  const handleCloseForwardDialog = useCallback((_, reason) => {
    if (forwardingConversationId && (reason === 'backdropClick' || reason === 'escapeKeyDown')) return;
    onCloseForward?.();
  }, [forwardingConversationId, onCloseForward]);

  useEffect(() => {
    if (!groupOpen) {
      setGroupStep('members');
      setGroupAvatarFile(null);
      setGroupAvatarPreview(null);
    }
  }, [groupOpen]);

  const handleGroupAvatarChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setGroupAvatarFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setGroupAvatarPreview(e.target.result);
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  const handleAddGroupMember = (item) => {
    if (!item?.id || selectedGroupMemberIds.has(String(item.id))) return;
    onAddGroupMember?.(item);
    onGroupSearchChange?.('');
    if (!previewFullScreen) {
      window.requestAnimationFrame(() => {
        groupSearchInputRef.current?.focus?.();
      });
    }
  };

  const handleRemoveGroupMember = (item) => {
    if (!item?.id) return;
    onRemoveGroupMember?.(item.id);
    if (!previewFullScreen) {
      window.requestAnimationFrame(() => {
        groupSearchInputRef.current?.focus?.();
      });
    }
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
      <ChatMessageContextMenu
        theme={theme}
        ui={ui}
        open={messageMenuOpen}
        onClose={onCloseMessageMenu}
        anchorEl={messageMenuAnchorElement}
        anchorPosition={messageMenuAnchorPosition}
        usesPointerAnchor={messageMenuUsesPointerAnchor}
        message={messageMenuMessage}
        activeConversation={activeConversation}
        activeConversationId={activeConversationId}
        messageMenuPinned={messageMenuPinned}
        onToggleReactionFromMenu={onToggleReactionFromMenu}
        onReplyFromMessageMenu={onReplyFromMessageMenu}
        onCopyMessage={onCopyMessage}
        onTogglePinMessageFromMenu={onTogglePinMessageFromMenu}
        onCopyMessageLink={onCopyMessageLink}
        onForwardMessageFromMenu={onForwardMessageFromMenu}
        onReportMessageFromMenu={onReportMessageFromMenu}
        onSelectMessageFromMenu={onSelectMessageFromMenu}
        onEditMessageFromMenu={onEditMessageFromMenu}
        onDeleteMessageFromMenu={onDeleteMessageFromMenu}
        onOpenReadsFromMessageMenu={onOpenReadsFromMessageMenu}
        onOpenAttachmentFromMessageMenu={onOpenAttachmentFromMessageMenu}
        onOpenTaskFromMessageMenu={onOpenTaskFromMessageMenu}
      />

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
              minHeight: density.dialogMenuItemMinHeight || 48,
              py: density.dialogMenuItemPy || 1.2,
              px: density.dialogMenuItemPx || 2,
              fontSize: density.dialogMenuFontSize || '1.02rem',
              fontWeight: 400,
              gap: density.dialogMenuItemGap || 1.5,
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
          <InfoOutlinedIcon sx={{ fontSize: density.dialogMenuIconSize || 22, color: popupIconColor, flexShrink: 0 }} />
          {activeConversationKind === 'group' ? 'Информация о группе' : 'Информация о чате'}
        </MenuItem>

        <Divider sx={{ bgcolor: popupBorderColor }} />

        <MenuItem onClick={runThreadMenuAction(onOpenSearch)} disabled={!activeConversationId}>
          <SearchRoundedIcon sx={{ fontSize: density.dialogMenuIconSize || 22, color: popupIconColor, flexShrink: 0 }} />
          Поиск
        </MenuItem>

        <MenuItem onClick={toggleConversationSetting({ is_pinned: !activeConversation?.is_pinned })} disabled={!activeConversationId || settingsUpdating}>
          <PushPinOutlinedIcon sx={{ fontSize: density.dialogMenuIconSize || 22, color: popupIconColor, flexShrink: 0 }} />
          {activeConversation?.is_pinned ? 'Открепить чат' : 'Закрепить чат'}
        </MenuItem>

        <MenuItem onClick={toggleConversationSetting({ is_muted: !activeConversation?.is_muted })} disabled={!activeConversationId || settingsUpdating}>
          {activeConversation?.is_muted ? (
            <VolumeUpIcon sx={{ fontSize: density.dialogMenuIconSize || 22, color: popupIconColor, flexShrink: 0 }} />
          ) : (
            <VolumeOffIcon sx={{ fontSize: density.dialogMenuIconSize || 22, color: popupIconColor, flexShrink: 0 }} />
          )}
          {activeConversation?.is_muted ? 'Включить уведомления' : 'Отключить уведомления'}
        </MenuItem>

        <MenuItem onClick={runThreadMenuAction(onOpenShare)} disabled={!activeConversationId}>
          <ShareIcon sx={{ fontSize: density.dialogMenuIconSize || 22, color: popupIconColor, flexShrink: 0 }} />
          Поделиться задачей
        </MenuItem>

        <Divider sx={{ bgcolor: popupBorderColor }} />

        <MenuItem
          onClick={runThreadMenuAction(() => onRequestDeleteConversation?.(activeConversation))}
          disabled={
            !activeConversationId
            || activeConversationKind === 'task'
            || Boolean(String(activeConversation?.task_id || '').trim())
            || activeConversationKind === 'ai'
          }
          sx={{
            color: popupDangerColor,
            '&:active': { bgcolor: alpha(popupDangerColor, 0.12) },
          }}
        >
          <DeleteOutlineIcon sx={{ fontSize: density.dialogMenuIconSize || 22, color: popupDangerColor, flexShrink: 0 }} />
          {activeConversationKind === 'group'
          && String(activeConversation?.viewer_member_role || '').trim() !== 'owner'
            ? 'Выйти из группы'
            : 'Удалить чат'}
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
              borderRadius: 2,
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
        <MenuItem onClick={runComposerMenuAction(onOpenMediaPicker)} disabled={!activeConversationId}>
          <PhotoLibraryRoundedIcon sx={{ mr: 1.2, fontSize: 20 }} />
          Фото или видео
        </MenuItem>
        <MenuItem onClick={runComposerMenuAction(onOpenFilePicker)} disabled={!activeConversationId}>
          <InsertDriveFileRoundedIcon sx={{ mr: 1.2, fontSize: 20 }} />
          Файл
        </MenuItem>
        <MenuItem onClick={runComposerMenuAction(onOpenShare)} disabled={!activeConversationId}>
          <TaskAltRoundedIcon sx={{ mr: 1.2, fontSize: 20 }} />
          Задача
        </MenuItem>
      </Menu>

      {/* Desktop: Popover emoji picker */}
      <Popover
        open={emojiPickerOpen && !isMobileEmojiLayout}
        anchorEl={emojiAnchorEl}
        onClose={onCloseEmojiPicker}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { elevation: 8 } }}
        PaperProps={{
          sx: {
            borderRadius: '8px',
            border: `1px solid ${ui.borderSoft}`,
            bgcolor: ui.composerBg || ui.panelBg || theme.palette.background.paper,
            backdropFilter: 'blur(12px)',
            overflow: 'hidden',
            '& .EmojiPickerReact': {
              '--epr-bg-color': ui.composerBg || ui.panelBg || theme.palette.background.paper,
              '--epr-category-label-bg-color': ui.composerBg || ui.panelBg || theme.palette.background.paper,
              '--epr-hover-bg-color': alpha(ui.accentText || theme.palette.primary.main, 0.1),
              '--epr-search-bg-color': alpha(theme.palette.mode === 'dark' ? '#fff' : '#000', 0.06),
              '--epr-text-color': ui.textPrimary || theme.palette.text.primary,
              '--epr-search-input-bg-color': alpha(theme.palette.mode === 'dark' ? '#fff' : '#000', 0.06),
              '--epr-search-border-color': ui.borderSoft || theme.palette.divider,
              '--epr-category-icon-active-color': ui.accentText || theme.palette.primary.main,
              '--epr-highlight-color': ui.accentText || theme.palette.primary.main,
              border: 'none',
              borderRadius: 0,
            },
          },
        }}
      >
        {emojiPickerOpen && !isMobileEmojiLayout ? (
          <Suspense
            fallback={(
              <Box sx={{ width: 352, height: 400, display: 'grid', placeItems: 'center' }}>
                <CircularProgress size={24} />
              </Box>
            )}
          >
            <LazyEmojiPicker
              onEmojiClick={(emojiData) => onInsertEmoji?.(emojiData?.emoji || '')}
              autoFocusSearch={false}
              searchPlaceholder="Поиск"
              skinTonesDisabled={false}
              previewConfig={{ showPreview: false }}
              emojiStyle="native"
              suggestedEmojisMode="recent"
              lazyLoadEmojis
              width={352}
              height={400}
              theme={theme.palette.mode === 'dark' ? 'dark' : 'light'}
              categories={[
                { category: 'suggested', name: 'Недавние' },
                { category: 'smileys_people', name: 'Смайлы и люди' },
                { category: 'animals_nature', name: 'Животные' },
                { category: 'food_drink', name: 'Еда' },
                { category: 'travel_places', name: 'Путешествия' },
                { category: 'activities', name: 'Активности' },
                { category: 'objects', name: 'Объекты' },
                { category: 'symbols', name: 'Символы' },
                { category: 'flags', name: 'Флаги' },
              ]}
            />
          </Suspense>
        ) : null}
      </Popover>

      {/* Mobile emoji panel moved to ChatComposer dock */}

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
        maxWidth="xs"
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
          sx={{
            ...dialogTitleSx,
            px: previewFullScreen ? 1.6 : 3,
            pt: previewFullScreen ? 'max(env(safe-area-inset-top), 10px)' : 2.5,
            pb: 1.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            ...(previewFullScreen ? {
              bgcolor: alpha(fullScreenDialogBg, 0.94),
              backdropFilter: 'blur(18px)',
              position: 'sticky',
              top: 0,
              zIndex: 2,
            } : {}),
          }}
        >
          {previewFullScreen ? (
            <IconButton
              aria-label={isGroupDetailsStep ? 'Назад к выбору участников' : 'Закрыть создание группы'}
              onClick={isGroupDetailsStep ? () => setGroupStep('members') : onCloseGroup}
              sx={{ color: dialogTextColor, ml: -0.5 }}
            >
              <ChevronLeftRoundedIcon />
            </IconButton>
          ) : null}
          <Box sx={{ flex: 1 }}>
            <Typography component="div" variant="subtitle1" sx={{ fontWeight: 800, fontSize: '1rem', lineHeight: 1.2 }}>
              {isGroupDetailsStep ? 'Новая группа' : 'Добавить участников'}
            </Typography>
            {!isGroupDetailsStep ? (
              <Typography component="div" variant="caption" sx={{ color: ui.textSecondary, fontWeight: 500 }}>
                {selectedGroupUsers.length} / 200000
              </Typography>
            ) : null}
          </Box>
        </DialogTitle>
        <DialogContent
          sx={{
            px: 0,
            py: 0,
            bgcolor: 'transparent',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          {!isGroupDetailsStep ? (
            <Box data-testid="group-dialog-members-step" sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

              {/* Selected users strip */}
              {selectedGroupUsers.length > 0 ? (
                <Box
                  data-testid="group-selected-users"
                  sx={{
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    gap: 0.5,
                    overflowX: 'auto',
                    px: 1,
                    pt: 1.25,
                    pb: 1,
                    minHeight: 88,
                    borderBottom: `1px solid ${ui.borderSoft || alpha(accentColor, 0.1)}`,
                    scrollbarWidth: 'none',
                    '&::-webkit-scrollbar': { display: 'none' },
                  }}
                >
                  <Typography
                    sx={{
                      flexShrink: 0,
                      alignSelf: 'center',
                      px: 0.5,
                      fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
                      fontSize: density.composerAuxFontSize || '0.78rem',
                      fontWeight: 800,
                      color: ui.textSecondary,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Выбранные участники
                  </Typography>
                  {selectedGroupUsers.map((item) => (
                    <SelectedUserPill
                      key={item.id}
                      item={item}
                      ui={ui}
                      onRemove={handleRemoveGroupMember}
                    />
                  ))}
                </Box>
              ) : null}

              {/* Search */}
              <Box
                sx={{
                  px: 1,
                  py: 1,
                  borderBottom: `1px solid ${ui.borderSoft || alpha(accentColor, 0.1)}`,
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    bgcolor: groupInputBg,
                    borderRadius: 3,
                    px: 1.2,
                    py: 0.6,
                  }}
                >
                  <SearchRoundedIcon sx={{ fontSize: 20, color: ui.textSecondary, flexShrink: 0 }} />
                  <InputBase
                    inputRef={groupSearchInputRef}
                    fullWidth
                    autoFocus={!previewFullScreen}
                    value={groupSearch}
                    onChange={(event) => onGroupSearchChange(event.target.value)}
                    placeholder="Поиск"
                    inputProps={{ 'aria-label': 'Поиск участников', enterKeyHint: 'search' }}
                    sx={{
                      fontSize: '0.97rem',
                      color: dialogTextColor,
                      '& input::placeholder': { color: ui.textSecondary, opacity: 1 },
                    }}
                  />
                  {groupSearch ? (
                    <IconButton size="small" onClick={() => onGroupSearchChange('')} sx={{ p: 0.2 }}>
                      <CloseRoundedIcon sx={{ fontSize: 16, color: ui.textSecondary }} />
                    </IconButton>
                  ) : null}
                </Box>
              </Box>

              {/* User list */}
              <Box
                sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
                data-testid={!previewFullScreen ? 'group-dialog-desktop-layout' : undefined}
              >
                <Box
                  data-testid="group-user-search-results"
                  sx={{ height: '100%', overflowY: 'auto', minHeight: 0 }}
                >
                  {groupUsersLoading ? (
                    <DialogListSkeleton ui={ui} rows={7} compact />
                  ) : availableGroupUsers.length === 0 ? (
                    <Stack alignItems="center" justifyContent="center" sx={{ py: 5 }}>
                      <Typography variant="body2" sx={{ color: ui.textSecondary }}>
                        Никого не найдено
                      </Typography>
                    </Stack>
                  ) : (
                    availableGroupUsers.map((item, index) => (
                      <Box key={item.id}>
                        {index > 0 ? <Box sx={{ borderTop: `1px solid ${alpha(ui.borderSoft || '#334155', 0.5)}` }} /> : null}
                        <GroupUserCheckboxRow
                          item={item}
                          ui={ui}
                          checked={selectedGroupMemberIds.has(String(item.id))}
                          onToggle={handleToggleGroupMember}
                          compact={previewFullScreen}
                        />
                      </Box>
                    ))
                  )}
                </Box>
              </Box>
            </Box>
          ) : (
            <Box
              data-testid="group-dialog-details-step"
              sx={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
              }}
            >
              {/* Hidden file input */}
              <input
                ref={groupAvatarInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleGroupAvatarChange}
              />

              {/* Avatar + title row */}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2.5,
                  px: 2.5,
                  pt: 2.5,
                  pb: 1.5,
                }}
              >
                {/* Avatar button */}
                <Box
                  component="button"
                  type="button"
                  onClick={() => groupAvatarInputRef.current?.click()}
                  sx={{
                    flexShrink: 0,
                    width: 72,
                    height: 72,
                    borderRadius: '50%',
                    border: 'none',
                    cursor: 'pointer',
                    bgcolor: accentColor,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    transition: 'opacity 120ms ease',
                    '&:hover': { opacity: 0.88 },
                    '&:active': { opacity: 0.72 },
                    p: 0,
                  }}
                >
                  {groupAvatarPreview ? (
                    <Box
                      component="img"
                      src={groupAvatarPreview}
                      alt=""
                      sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  ) : (
                    <AddAPhotoRoundedIcon sx={{ fontSize: 30, color: '#fff' }} />
                  )}
                </Box>

                {/* Title input */}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <InputBase
                    inputProps={{ 'data-testid': 'group-dialog-title-input' }}
                    fullWidth
                    autoFocus
                    value={groupTitle}
                    onChange={(event) => onGroupTitleChange(event.target.value)}
                    placeholder="Название группы"
                    sx={{
                      fontSize: '1rem',
                      fontWeight: 500,
                      color: dialogTextColor,
                      '& input': {
                        borderBottom: `1.5px solid ${accentColor}`,
                        pb: 0.5,
                      },
                      '& input::placeholder': { color: ui.textSecondary, opacity: 1 },
                    }}
                  />
                </Box>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={dialogActionsSx}>
          {!isGroupDetailsStep ? (
            <>
              <Button
                onClick={onCloseGroup}
                sx={{ textTransform: 'none', fontWeight: 700, color: accentColor }}
              >
                Отмена
              </Button>
              <Button
                variant="text"
                data-testid="group-dialog-primary-action"
                aria-label="Next group step"
                onClick={() => setGroupStep('details')}
                disabled={!canProceedToGroupDetails}
                sx={{ textTransform: 'none', fontWeight: 700, color: accentColor }}
              >
                Далее
              </Button>
            </>
          ) : (
            <>
              <Button
                onClick={() => setGroupStep('members')}
                sx={{ textTransform: 'none', fontWeight: 700, color: accentColor }}
              >
                Назад
              </Button>
              <Button
                variant="text"
                data-testid="group-dialog-primary-action"
                onClick={() => void onCreateGroup(groupAvatarFile)}
                disabled={groupCreateDisabled}
                sx={{ textTransform: 'none', fontWeight: 700, color: accentColor }}
              >
                Создать
              </Button>
            </>
          )}
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
                fontSize: density.dialogMenuFontSize || '1.08rem',
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
                <Typography sx={{ color: popupTextColor, fontWeight: 700, fontFamily: TELEGRAM_CHAT_FONT_FAMILY, fontSize: density.dialogMenuFontSize || '1.08rem' }}>
                  Чаты не найдены
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.65, color: popupMutedTextColor, fontFamily: TELEGRAM_CHAT_FONT_FAMILY, fontSize: density.composerAuxFontSize || '0.98rem' }}>
                  Попробуйте другое название чата или имя участника.
                </Typography>
              </Stack>
            ) : (
              <List disablePadding>
                {forwardConversationItems.map((item) => {
                  const isForwarding = forwardingConversationId === item.id;
                  const hasOtherForward = Boolean(forwardingConversationId) && !isForwarding;
                  const subtitle = getConversationHeaderSubtitle(item) || item?.last_message_preview || 'Чат';
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
                        <ConversationAvatar
                          conversation={item}
                          online={Boolean(item?.kind === 'direct' && item?.direct_peer?.presence?.is_online)}
                          size={density.dialogForwardAvatar || 52}
                        />
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography sx={{ color: popupTextColor, fontWeight: 700, fontSize: density.dialogMenuFontSize || '1.08rem', fontFamily: TELEGRAM_CHAT_FONT_FAMILY, letterSpacing: '-0.01em' }} noWrap>
                            {item?.title || 'Чат'}
                          </Typography>
                          <Typography variant="body2" sx={{ color: popupMutedTextColor, mt: 0.1, fontFamily: TELEGRAM_CHAT_FONT_FAMILY, fontSize: density.composerAuxFontSize || '0.98rem' }} noWrap>
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
      {documentPreview?.open ? (
        <MailAttachmentPreviewDialog
          attachmentPreview={documentPreview}
          onClose={onCloseDocumentPreview}
          onDownload={onDownloadDocumentPreview}
          onDownloadPreviewPdf={onDownloadDocumentPreviewPdf}
          formatFileSize={formatFileSize}
        />
      ) : null}
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
            currentUser={currentUser}
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
            onAddGroupMembers={onAddGroupMembers}
            onRemoveGroupMember={onRemoveGroupParticipant}
            onUpdateGroupMemberRole={onUpdateGroupMemberRole}
            onTransferGroupOwnership={onTransferGroupOwnership}
            onLeaveGroup={onLeaveGroup}
            onUpdateGroupProfile={onUpdateGroupProfile}
            settingsUpdating={settingsUpdating}
            onOpenAttachmentPreview={onOpenAttachmentPreview}
            onOpenTask={onOpenTask}
          />
        </Box>
      </Dialog>
    </>
  );
}
