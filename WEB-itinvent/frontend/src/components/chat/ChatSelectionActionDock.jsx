import { memo } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded';
import ForwardRoundedIcon from '@mui/icons-material/ForwardRounded';
import ReplyRoundedIcon from '@mui/icons-material/ReplyRounded';

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

function formatSelectedMessageCount(count = 0) {
  const normalizedCount = Math.max(0, Number(count || 0));
  const mod100 = normalizedCount % 100;
  const mod10 = normalizedCount % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${normalizedCount} сообщений`;
  if (mod10 === 1) return `${normalizedCount} сообщение`;
  if (mod10 >= 2 && mod10 <= 4) return `${normalizedCount} сообщения`;
  return `${normalizedCount} сообщений`;
}

const ChatSelectionActionDock = memo(function ChatSelectionActionDock({
  theme,
  ui,
  compactMobile,
  selectedMessageCount = 0,
  canReplySelectedMessage = false,
  canDeleteSelectedMessages = false,
  onClearMessageSelection,
  onReplySelectedMessage,
  onForwardSelectedMessages,
  onDeleteSelectedMessages,
}) {
  const actionButtonSx = {
    minWidth: 0,
    height: compactMobile ? 48 : 52,
    border: 'none',
    bgcolor: 'transparent',
    color: ui.textPrimary || theme.palette.text.primary,
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: compactMobile ? 0.45 : 0.8,
    px: compactMobile ? 0.7 : 1.6,
    py: 0.8,
    borderRadius: 999,
    cursor: 'pointer',
    transition: 'background-color 120ms ease, opacity 100ms ease, transform 100ms ease',
    '&:active': {
      transform: 'scale(0.96)',
      opacity: 0.72,
    },
    '&:disabled': {
      opacity: 0.36,
      cursor: 'not-allowed',
    },
  };

  if (compactMobile) {
    const mobilePillSx = {
      flex: '1 1 0',
      minWidth: 0,
      height: 48,
      border: `1px solid ${ui.borderSoft || alpha(theme.palette.divider, 0.14)}`,
      bgcolor: alpha(ui.composerBg || theme.palette.background.paper, 0.98),
      color: ui.textPrimary || theme.palette.text.primary,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 0.65,
      px: 0.95,
      borderRadius: 999,
      boxShadow: theme.palette.mode === 'dark' ? '0 9px 24px rgba(0,0,0,0.3)' : '0 9px 24px rgba(15,23,42,0.12)',
      backdropFilter: 'blur(18px) saturate(1.06)',
      cursor: 'pointer',
      transition: 'opacity 120ms ease, transform 120ms ease, background-color 120ms ease',
      '&:active': {
        transform: 'scale(0.97)',
        opacity: 0.72,
      },
      '&:disabled': {
        opacity: 0.36,
        cursor: 'not-allowed',
      },
    };
    const mobileLabelSx = {
      fontSize: 17,
      fontWeight: 780,
      lineHeight: 1,
      fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
      whiteSpace: 'nowrap',
    };

    return (
      <Box
        data-testid="chat-selection-action-dock"
        sx={{
          flexShrink: 0,
          px: 0.72,
          pt: 0.45,
          pb: 'max(env(safe-area-inset-bottom), 8px)',
          bgcolor: 'transparent',
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          spacing={0.65}
          sx={{
            width: '100%',
            mx: 'auto',
          }}
        >
          <Box
            component="button"
            type="button"
            data-testid="chat-selection-reply-action"
            aria-label="Ответить"
            disabled={!canReplySelectedMessage || selectedMessageCount !== 1 || typeof onReplySelectedMessage !== 'function'}
            onClick={onReplySelectedMessage}
            sx={mobilePillSx}
          >
            <Typography sx={mobileLabelSx}>Ответить</Typography>
            <ReplyRoundedIcon sx={{ fontSize: 23 }} />
          </Box>
          <Box
            component="button"
            type="button"
            data-testid="chat-selection-forward-action"
            aria-label="Переслать"
            disabled={selectedMessageCount <= 0 || typeof onForwardSelectedMessages !== 'function'}
            onClick={onForwardSelectedMessages}
            sx={mobilePillSx}
          >
            <ForwardRoundedIcon sx={{ fontSize: 23 }} />
            <Typography sx={mobileLabelSx}>Переслать</Typography>
          </Box>
        </Stack>
      </Box>
    );
  }

  return (
    <Box
      data-testid="chat-selection-action-dock"
      sx={{
        flexShrink: 0,
        px: compactMobile ? 1.05 : 1.6,
        pt: compactMobile ? 0.75 : 1,
        pb: compactMobile ? 'max(env(safe-area-inset-bottom), 10px)' : 1.1,
        bgcolor: 'transparent',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={compactMobile ? 0.35 : 1.1}
        sx={{
          maxWidth: 760,
          mx: 'auto',
          minHeight: compactMobile ? 70 : 72,
          px: compactMobile ? 0.75 : 1.5,
          py: compactMobile ? 0.65 : 0.8,
          borderRadius: compactMobile ? 4 : 3,
          bgcolor: alpha(ui.composerBg || theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.96 : 0.94),
          border: `1px solid ${ui.borderSoft}`,
          boxShadow: theme.palette.mode === 'dark' ? '0 14px 36px rgba(0,0,0,0.32)' : '0 14px 34px rgba(15, 23, 42, 0.16)',
          backdropFilter: 'blur(22px) saturate(1.08)',
        }}
      >
        <Box
          component="button"
          type="button"
          data-testid="chat-selection-clear"
          aria-label="Отменить выделение"
          onClick={onClearMessageSelection}
          sx={{
            ...actionButtonSx,
            width: compactMobile ? 44 : 50,
            px: 0,
            flexShrink: 0,
          }}
        >
          <CloseRoundedIcon sx={{ fontSize: compactMobile ? 27 : 30 }} />
        </Box>
        <Typography
          data-testid="chat-selection-count-label"
          sx={{
            flex: '1 1 88px',
            minWidth: 0,
            color: ui.textPrimary || theme.palette.text.primary,
            fontSize: compactMobile ? 16.5 : 19,
            fontWeight: 850,
            lineHeight: 1.1,
            fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
            whiteSpace: 'nowrap',
          }}
        >
          {formatSelectedMessageCount(selectedMessageCount)}
        </Typography>
        <Box
          component="button"
          type="button"
          data-testid="chat-selection-forward-action"
          aria-label="Переслать выбранные сообщения"
          disabled={selectedMessageCount <= 0}
          onClick={onForwardSelectedMessages}
          sx={{
            ...actionButtonSx,
            color: ui.accentText || theme.palette.primary.main,
            flex: '0 0 auto',
          }}
        >
          <ForwardRoundedIcon sx={{ fontSize: compactMobile ? 24 : 28 }} />
          <Typography sx={{ fontSize: compactMobile ? 15.5 : 18, fontWeight: 850, lineHeight: 1, fontFamily: TELEGRAM_CHAT_FONT_FAMILY }}>
            Переслать
          </Typography>
        </Box>
        <Box
          component="button"
          type="button"
          data-testid="chat-selection-delete-action"
          aria-label="Удалить выбранные сообщения"
          disabled={!canDeleteSelectedMessages || selectedMessageCount <= 0 || typeof onDeleteSelectedMessages !== 'function'}
          onClick={onDeleteSelectedMessages}
          sx={{
            ...actionButtonSx,
            color: theme.palette.error.main,
            flex: '0 0 auto',
          }}
        >
          <DeleteRoundedIcon sx={{ fontSize: compactMobile ? 24 : 28 }} />
          <Typography sx={{ fontSize: compactMobile ? 15.5 : 18, fontWeight: 850, lineHeight: 1, fontFamily: TELEGRAM_CHAT_FONT_FAMILY }}>
            Удалить
          </Typography>
        </Box>
      </Stack>
    </Box>
  );
});

export default ChatSelectionActionDock;
