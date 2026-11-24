import { Suspense, lazy, memo, useEffect, useState } from 'react';

import {
  Box,
  CircularProgress,
  IconButton,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';

import { useChatEmojiUi } from './ChatEmojiUiContext';

const LazyChatEmojiPanel = lazy(() => import('./ChatEmojiPanel'));

const DESKTOP_EMOJI_POPOVER_WIDTH = 'min(384px, calc(100% - 24px))';
const DESKTOP_EMOJI_POPOVER_HEIGHT = 'min(460px, 68%)';

// Д5/Д6: панель эмодзи и стикеров — поповер над полем ввода,
// не сжимает ленту и не сдвигает шапку.
// Keep-alive: после первого показа остаётся смонтированным и скрывается
// стилем — повторное открытие не платит за remount emoji-picker-react.
// Состояние приходит из ChatEmojiUiContext — переключение перерисовывает
// только этот компонент, а не весь ChatThread.
const ChatDesktopEmojiPopover = memo(function ChatDesktopEmojiPopover({
  theme,
  ui,
  compactMobile = false,
  feedFullWidth = false,
  contentMaxWidth = 0,
  composerHeight = 0,
  composerRef,
  currentUserId,
}) {
  const emojiUi = useChatEmojiUi();
  const emojiPickerOpen = emojiUi?.emojiPickerOpen ?? false;
  const emojiPanelMode = emojiUi?.emojiPanelMode ?? 'popover';
  const onCloseEmojiPicker = emojiUi?.onCloseEmojiPicker;
  const onEmojiHoverStart = emojiUi?.onEmojiHoverStart;
  const onEmojiHoverEnd = emojiUi?.onEmojiHoverEnd;
  const onInsertEmoji = emojiUi?.onInsertEmoji;
  const onSendSticker = emojiUi?.onSendSticker;

  const emojiPopoverVisible = Boolean(
    emojiPickerOpen && !compactMobile && emojiPanelMode !== 'pinned',
  );
  const [emojiPopoverEverVisible, setEmojiPopoverEverVisible] = useState(false);
  useEffect(() => {
    if (emojiPopoverVisible) setEmojiPopoverEverVisible(true);
  }, [emojiPopoverVisible]);

  // Escape закрывает поповер при фокусе в любом месте треда — раньше это был
  // onKeyDown корня ChatThread; вынесен сюда, чтобы ChatThread не зависел от
  // emoji-состояния. Bubble-фаза + defaultPrevented: вложенные обработчики
  // (меню, выделение, диалоги) сохраняют приоритет, как при старой схеме.
  useEffect(() => {
    if (!emojiPopoverVisible || compactMobile) return undefined;
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onCloseEmojiPicker?.();
      composerRef?.current?.focus?.();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [emojiPopoverVisible, compactMobile, onCloseEmojiPicker, composerRef]);

  if (!emojiPopoverEverVisible) return null;

  return (
    // Hover-зона общая с кнопкой: курсор может уходить в панель и обратно.
    <Box
      data-testid="chat-desktop-emoji-panel"
      data-layout="popover"
      role="dialog"
      aria-label="Эмодзи и стикеры"
      onMouseEnter={() => onEmojiHoverStart?.()}
      onMouseLeave={() => onEmojiHoverEnd?.()}
      sx={{
        position: 'absolute',
        right: { xs: 12, md: feedFullWidth ? 14 : `max(14px, calc(50% - ${Math.round(contentMaxWidth / 2)}px))` },
        bottom: `${Math.max(72, composerHeight) + 10}px`,
        zIndex: 20,
        width: DESKTOP_EMOJI_POPOVER_WIDTH,
        height: DESKTOP_EMOJI_POPOVER_HEIGHT,
        minWidth: 0,
        // Keep-alive: скрытие стилем вместо размонтирования.
        display: emojiPopoverVisible ? 'flex' : 'none',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRadius: '16px',
        bgcolor: ui.composerBg || ui.panelBg || theme.palette.background.paper,
        border: `1px solid ${ui.borderSoft || theme.palette.divider}`,
        boxShadow: `0 14px 38px ${alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.42 : 0.2)}`,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 1.5, pr: 0.5, flexShrink: 0 }}>
        <Typography variant="caption" sx={{ flex: 1, minWidth: 0 }}>Эмодзи и стикеры</Typography>
        <IconButton aria-label="Закрыть панель эмодзи" onClick={() => {
          onCloseEmojiPicker?.();
          composerRef?.current?.focus?.();
        }} size="small" sx={{ width: 36, height: 36 }}>
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <Suspense fallback={
        <Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }}>
          <CircularProgress size={24} />
        </Box>
      }>
        <LazyChatEmojiPanel
          open
          desktopDocked
          theme={theme}
          ui={ui}
          onInsertEmoji={onInsertEmoji}
          onSendSticker={onSendSticker}
          currentUserId={currentUserId}
          onClose={onCloseEmojiPicker}
        />
      </Suspense>
      </Box>
    </Box>
  );
});

export default ChatDesktopEmojiPopover;
