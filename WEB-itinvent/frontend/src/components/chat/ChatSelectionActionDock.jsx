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

// Д3-1 (R45): панель выделения встаёт на место поля ввода — те же фон дока,
// ширина и высота полосы (density.composerCapsuleMinHeight), без плашки, рамки,
// тени и пилюль. Крестик и «N сообщений» слева, действия справа.
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
  const isDark = theme.palette.mode === 'dark';
  const density = ui.density || {};
  const stripHeight = compactMobile ? 46 : (density.composerCapsuleMinHeight || 46);
  const dockBg = ui.composerDockBg || ui.composerBg || theme.palette.background.paper;
  const stripBg = ui.composerInputBg || ui.composerDockBg || dockBg;
  const textPrimary = ui.textPrimary || theme.palette.text.primary;
  const accent = ui.accentText || theme.palette.primary.main;
  const canReply = canReplySelectedMessage
    && selectedMessageCount === 1
    && typeof onReplySelectedMessage === 'function';
  const canForward = selectedMessageCount > 0 && typeof onForwardSelectedMessages === 'function';
  const canDelete = canDeleteSelectedMessages
    && selectedMessageCount > 0
    && typeof onDeleteSelectedMessages === 'function';

  const actionSx = (color) => ({
    height: stripHeight - 8,
    minWidth: 0,
    border: 'none',
    bgcolor: 'transparent',
    color,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0.6,
    px: compactMobile ? 1 : 1.25,
    borderRadius: 1.5,
    cursor: 'pointer',
    fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
    transition: 'background-color 120ms ease, opacity 100ms ease',
    '&:hover': { bgcolor: alpha(color, isDark ? 0.14 : 0.08) },
    '&:active': { opacity: 0.7 },
    '&:disabled': { opacity: 0.36, cursor: 'not-allowed', bgcolor: 'transparent' },
  });
  const labelSx = {
    fontSize: compactMobile ? 14 : 14.5,
    fontWeight: 500,
    lineHeight: 1,
    fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
    whiteSpace: 'nowrap',
  };
  const iconSx = { fontSize: 20 };

  return (
    <Box
      data-testid="chat-selection-action-dock"
      className="chat-safe-bottom"
      sx={{
        flexShrink: 0,
        position: 'relative',
        zIndex: 5,
        pb: compactMobile ? 'max(env(safe-area-inset-bottom, 0px), 0px)' : 0,
        bgcolor: dockBg,
        borderTop: !compactMobile && isDark ? `0.5px solid ${ui.borderSoft}` : 'none',
        boxShadow: compactMobile
          ? 'none'
          : isDark
            ? '0 -1px 0 rgba(255,255,255,0.04)'
            : `0 -1px 0 ${ui.borderSoft}, 0 -14px 26px rgba(80,104,128,0.08)`,
        fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
      }}
    >
      <Box sx={{ width: '100%', px: { xs: compactMobile ? 0.6 : 0.75, md: 1 } }}>
        <Stack
          direction="row"
          alignItems="center"
          data-testid="chat-selection-strip"
          sx={{
            width: '100%',
            height: stripHeight,
            px: compactMobile ? 0.5 : 0.75,
            gap: compactMobile ? 0.15 : 0.25,
            bgcolor: stripBg,
          }}
        >
          {compactMobile ? (
            <>
              <Box
                component="button"
                type="button"
                data-testid="chat-selection-reply-action"
                aria-label="Ответить"
                disabled={!canReply}
                onClick={onReplySelectedMessage}
                sx={{ ...actionSx(textPrimary), flex: '1 1 0' }}
              >
                <ReplyRoundedIcon sx={iconSx} />
                <Typography component="span" sx={labelSx}>Ответить</Typography>
              </Box>
              <Box
                component="button"
                type="button"
                data-testid="chat-selection-forward-action"
                aria-label="Переслать"
                disabled={!canForward}
                onClick={onForwardSelectedMessages}
                sx={{ ...actionSx(textPrimary), flex: '1 1 0' }}
              >
                <ForwardRoundedIcon sx={iconSx} />
                <Typography component="span" sx={labelSx}>Переслать</Typography>
              </Box>
            </>
          ) : (
            <>
              <Box
                component="button"
                type="button"
                data-testid="chat-selection-clear"
                aria-label="Отменить выделение"
                onClick={onClearMessageSelection}
                sx={{ ...actionSx(textPrimary), width: 40, px: 0, borderRadius: '50%', flexShrink: 0 }}
              >
                <CloseRoundedIcon sx={{ fontSize: 22 }} />
              </Box>
              <Typography
                data-testid="chat-selection-count-label"
                sx={{
                  flex: '1 1 88px',
                  minWidth: 0,
                  ml: 0.5,
                  color: textPrimary,
                  fontSize: 15,
                  fontWeight: 600,
                  lineHeight: 1.2,
                  fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
                  whiteSpace: 'nowrap',
                }}
              >
                {formatSelectedMessageCount(selectedMessageCount)}
              </Typography>
              {canReply ? (
                <Box
                  component="button"
                  type="button"
                  data-testid="chat-selection-reply-action"
                  aria-label="Ответить на выбранное сообщение"
                  onClick={onReplySelectedMessage}
                  sx={actionSx(accent)}
                >
                  <ReplyRoundedIcon sx={iconSx} />
                  <Typography component="span" sx={labelSx}>Ответить</Typography>
                </Box>
              ) : null}
              <Box
                component="button"
                type="button"
                data-testid="chat-selection-forward-action"
                aria-label="Переслать выбранные сообщения"
                disabled={!canForward}
                onClick={onForwardSelectedMessages}
                sx={actionSx(accent)}
              >
                <ForwardRoundedIcon sx={iconSx} />
                <Typography component="span" sx={labelSx}>Переслать</Typography>
              </Box>
              <Box
                component="button"
                type="button"
                data-testid="chat-selection-delete-action"
                aria-label="Удалить выбранные сообщения"
                disabled={!canDelete}
                onClick={onDeleteSelectedMessages}
                sx={actionSx(theme.palette.error.main)}
              >
                <DeleteRoundedIcon sx={iconSx} />
                <Typography component="span" sx={labelSx}>Удалить</Typography>
              </Box>
            </>
          )}
        </Stack>
      </Box>
    </Box>
  );
});

export default ChatSelectionActionDock;
