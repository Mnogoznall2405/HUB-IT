import { memo } from 'react';
import {
  Box,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded';
import ForwardRoundedIcon from '@mui/icons-material/ForwardRounded';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';

import { ConversationAvatar } from './ChatCommon';
import { getConversationDisplayTitle } from './chatHelpers';
import { CHAT_DEFAULT_FONT_SIZES, CHAT_FONT_FAMILY } from './chatUiTokens';

function HeaderAction({ title, children, onClick, active = false, compactMobile = false, hidden = false, disabled = false, density }) {
  if (hidden) return null;
  const actionSize = compactMobile
    ? Math.max(density?.touchTarget || 44, density?.threadHeaderAction || 44)
    : (density?.threadHeaderAction || 34);
  return (
    <Tooltip title={title}>
      <span>
        <IconButton
          size="small"
          aria-label={title}
          onClick={onClick}
          disabled={disabled}
          sx={{
            width: actionSize,
            height: actionSize,
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

export function AiRunStatusBanner({ aiStatus, theme, ui, compactMobile = false }) {
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
      <Typography sx={{ fontSize: compactMobile ? 13 : 13.5, fontWeight: 700, color: tone.text, fontFamily: CHAT_FONT_FAMILY }}>
        {label}
      </Typography>
      {status === 'failed' && aiStatus?.error_text ? (
        <Typography sx={{ mt: 0.4, fontSize: 12.5, color: ui.textSecondary, fontFamily: CHAT_FONT_FAMILY }}>
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
            <Typography sx={{ fontSize: compactMobile ? 13 : 13.5, fontWeight: 700, color: tone.text, fontFamily: CHAT_FONT_FAMILY }}>
              {aiStatusDisplay.primaryText}
            </Typography>
            {aiStatusDisplay.secondaryText ? (
              <Typography sx={{ mt: 0.4, fontSize: 12.5, color: ui.textSecondary, fontFamily: CHAT_FONT_FAMILY }}>
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
  onOpenTask,
  onOpenSearch,
  onOpenMenu,
  selectionMode = false,
  selectedMessageCount = 0,
  canCopySelectedMessages = false,
  canDeleteSelectedMessages = false,
  onClearMessageSelection,
  onCopySelectedMessages,
  onForwardSelectedMessages,
  onDeleteSelectedMessages,
}) {
  const density = ui.density || {};
  const taskId = String(activeConversation?.task_id || '').trim();
  const headerTitle = getConversationDisplayTitle(activeConversation);
  const openHeaderPrimary = () => {
    if (taskId && typeof onOpenTask === 'function') {
      onOpenTask(taskId);
      return;
    }
    onOpenInfo?.();
  };
  const headerShellSx = {
    px: { xs: compactMobile ? 0.65 : 1.15, md: density.threadHeaderPx || 1.6 },
    pb: compactMobile ? 0.45 : (density.threadHeaderPb || 0.78),
    bgcolor: ui.threadTopbarBg,
    backdropFilter: 'blur(16px)',
    position: 'sticky',
    top: 0,
    zIndex: 5,
    boxShadow: theme.palette.mode === 'dark' ? 'none' : `0 1px 0 ${ui.borderSoft}, 0 6px 14px ${alpha('#000', 0.06)}`,
    borderBottom: theme.palette.mode === 'dark' ? `0.5px solid ${ui.borderSoft}` : 'none',
  };
  const headerContentSx = {
    maxWidth: compactMobile ? '100%' : `${Number(density.contentMaxWidth || ui.contentMaxWidth || 980) + 56}px`,
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
                fontFamily: CHAT_FONT_FAMILY,
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
            <IconButton
              data-testid="chat-selection-header-delete-action"
              aria-label="Удалить"
              disabled={!canDeleteSelectedMessages || selectedMessageCount <= 0 || typeof onDeleteSelectedMessages !== 'function'}
              onClick={onDeleteSelectedMessages}
              sx={{ ...selectionIconButtonSx, color: theme.palette.error.main }}
            >
              <DeleteRoundedIcon sx={{ fontSize: 25 }} />
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
                  width: compactMobile ? 44 : 38,
                  height: compactMobile ? 44 : 38,
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
                fontFamily: CHAT_FONT_FAMILY,
              }}
            >
              {selectedMessageCount}
            </Box>
            <Box
              component="button"
              type="button"
              onClick={openHeaderPrimary}
              aria-label={taskId ? 'Открыть задачу' : 'Информация о чате'}
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
              <ConversationAvatar
                conversation={activeConversation}
                online={Boolean(activeConversation?.kind === 'direct' && activeConversation?.direct_peer?.presence?.is_online)}
                size={compactMobile ? 40 : (density.threadHeaderAvatar || 42)}
              />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.1, color: theme.palette.text.primary, fontSize: compactMobile ? CHAT_DEFAULT_FONT_SIZES.headerTitleMobile : (density.threadHeaderTitleFontSize || CHAT_DEFAULT_FONT_SIZES.desktopPrimary), letterSpacing: '-0.01em', fontFamily: CHAT_FONT_FAMILY }} noWrap>
                  {headerTitle}
                </Typography>
                <Typography variant="caption" sx={{ color: ui.textSecondary, fontSize: compactMobile ? CHAT_DEFAULT_FONT_SIZES.headerSubtitleMobile : (density.threadHeaderSubtitleFontSize || '0.82rem'), lineHeight: 1.12, fontFamily: CHAT_FONT_FAMILY }} noWrap>
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
            density={density}
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
                width: compactMobile ? 44 : 38,
                height: compactMobile ? 44 : 38,
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
            onClick={openHeaderPrimary}
            aria-label={taskId ? 'Открыть задачу' : 'Информация о чате'}
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
            <ConversationAvatar
              conversation={activeConversation}
              online={Boolean(activeConversation?.kind === 'direct' && activeConversation?.direct_peer?.presence?.is_online)}
              size={compactMobile ? 40 : (density.threadHeaderAvatar || 42)}
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.1, color: theme.palette.text.primary, fontSize: compactMobile ? CHAT_DEFAULT_FONT_SIZES.headerTitleMobile : (density.threadHeaderTitleFontSize || CHAT_DEFAULT_FONT_SIZES.desktopPrimary), letterSpacing: '-0.01em', fontFamily: CHAT_FONT_FAMILY }} noWrap>
                {headerTitle}
              </Typography>
              <Typography variant="caption" sx={{ color: ui.textSecondary, fontSize: compactMobile ? CHAT_DEFAULT_FONT_SIZES.headerSubtitleMobile : (density.threadHeaderSubtitleFontSize || '0.82rem'), lineHeight: 1.12, fontFamily: CHAT_FONT_FAMILY }} noWrap>
                {typingLine || headerSubtitle}
              </Typography>
            </Box>
          </Box>
        </Stack>

        <Stack direction="row" spacing={0.1} alignItems="center">
          <HeaderAction title="Поиск по сообщениям" onClick={onOpenSearch} compactMobile={compactMobile} hidden={compactMobile} density={density}>
            <SearchRoundedIcon fontSize="small" />
          </HeaderAction>
          <HeaderAction
            title="Действия чата"
            onClick={onOpenMenu}
            active={contextPanelOpen}
            compactMobile={compactMobile}
            density={density}
          >
            <MoreVertRoundedIcon fontSize="small" />
          </HeaderAction>
        </Stack>
      </Stack>
    </Box>
  );
});


export default ChatThreadHeader;
