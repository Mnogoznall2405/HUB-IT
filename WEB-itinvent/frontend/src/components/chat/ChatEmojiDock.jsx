import { Suspense, lazy, memo, useLayoutEffect, useRef, useState } from 'react';
import { Box, CircularProgress, IconButton, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';

const LazyChatEmojiPanel = lazy(() => import('./ChatEmojiPanel'));

// Режим дока выбирается по ФАКТИЧЕСКОЙ ширине контейнера треда
// (`chat-thread-pane-wrap`), а не по viewport: sidebar, dock и правая
// инфо-панель отнимают место одновременно, и при фиксированном
// breakpoint переписка сжималась бы до нерабочей ширины.
// Колонка включается только если после дока остаётся >= MIN_THREAD_WIDTH
// для переписки — иначе overlay поверх колонки треда.
const DOCK_COLUMN_WIDTH = 360;
const MIN_THREAD_WIDTH = 470;
const DOCK_COLUMN_MIN_WRAP = DOCK_COLUMN_WIDTH + MIN_THREAD_WIDTH;

export const EMOJI_DOCK_LAYOUT = {
  columnWidth: DOCK_COLUMN_WIDTH,
  minThreadWidth: MIN_THREAD_WIDTH,
  minWrapWidthForColumn: DOCK_COLUMN_MIN_WRAP,
};

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
  const rootRef = useRef(null);
  const [asColumn, setAsColumn] = useState(false);
  const panelBg = ui.composerBg || ui.panelBg || theme.palette.background.paper;
  const borderColor = ui.borderSoft || theme.palette.divider;

  useLayoutEffect(() => {
    const wrap = rootRef.current?.parentElement;
    if (!wrap) return undefined;
    const evaluate = () => {
      // Ширина wrap задаётся внешним flex-раскладом и не зависит от режима
      // дока — измерение не зацикливается на переключении column/overlay.
      setAsColumn(wrap.clientWidth >= DOCK_COLUMN_MIN_WRAP);
    };
    evaluate();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(evaluate);
      observer.observe(wrap);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', evaluate);
    return () => window.removeEventListener('resize', evaluate);
  }, []);

  return (
    <Box
      ref={rootRef}
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
              width: DOCK_COLUMN_WIDTH,
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
