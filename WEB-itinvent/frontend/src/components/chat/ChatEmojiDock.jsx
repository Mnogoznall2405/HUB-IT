import { Suspense, lazy, memo } from 'react';
import { Box, CircularProgress, IconButton, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';

const LazyChatEmojiPanel = lazy(() => import('./ChatEmojiPanel'));

// При достаточной ширине viewport док — отдельная колонка справа от
// переписки (как Telegram Desktop); на узком — overlay внутри колонки
// треда, чтобы не вызывать горизонтальный скролл страницы.
const COLUMN_MIN_VIEWPORT = '(min-width:1200px)';

const dockFallback = (
  <Box sx={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
    <CircularProgress size={24} />
  </Box>
);

const ChatEmojiDock = memo(function ChatEmojiDock({
  theme,
  ui,
  currentUserId,
  onInsertEmoji,
  onSendSticker,
  onClose,
}) {
  const asColumn = useMediaQuery(COLUMN_MIN_VIEWPORT);
  const panelBg = ui.composerBg || ui.panelBg || theme.palette.background.paper;
  const borderColor = ui.borderSoft || theme.palette.divider;

  return (
    <Box
      data-testid="chat-emoji-dock"
      data-layout={asColumn ? 'column' : 'overlay'}
      role="dialog"
      aria-label="Эмодзи и стикеры"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        onClose?.();
      }}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        flexShrink: 0,
        bgcolor: panelBg,
        borderLeft: `1px solid ${borderColor}`,
        ...(asColumn
          ? {
              width: 'clamp(320px, 30vw, 380px)',
            }
          : {
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              width: 'min(360px, 92%)',
              zIndex: 12,
              boxShadow: `-16px 0 40px ${alpha('#0f172a', theme.palette.mode === 'dark' ? 0.5 : 0.18)}`,
            }),
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pl: 2,
          pr: 1,
          py: 0.5,
          borderBottom: `1px solid ${borderColor}`,
          flexShrink: 0,
        }}
      >
        <Typography
          component="h2"
          sx={{
            fontSize: 13,
            fontWeight: 700,
            color: ui.textSecondary || theme.palette.text.secondary,
            letterSpacing: 0.2,
          }}
        >
          Эмодзи и стикеры
        </Typography>
        <IconButton
          size="small"
          onClick={onClose}
          aria-label="Закрыть панель эмодзи и стикеров"
          data-testid="chat-emoji-dock-close"
          sx={{ width: 36, height: 36 }}
        >
          <CloseRoundedIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Suspense fallback={dockFallback}>
          <LazyChatEmojiPanel
            open
            desktopDocked
            theme={theme}
            ui={ui}
            currentUserId={currentUserId}
            onInsertEmoji={onInsertEmoji}
            onSendSticker={onSendSticker}
            onClose={onClose}
          />
        </Suspense>
      </Box>
    </Box>
  );
});

export default ChatEmojiDock;
