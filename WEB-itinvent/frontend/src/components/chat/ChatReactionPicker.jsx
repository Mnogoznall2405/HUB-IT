import { memo, useCallback, useEffect, useRef } from 'react';
import { Box, Paper, Tooltip } from '@mui/material';
import { alpha } from '@mui/material/styles';

export const CHAT_REACTION_EMOJIS = [
  '\u{1F44D}',
  '\u{2764}\u{FE0F}',
  '\u{1F602}',
  '\u{1F62E}',
  '\u{1F622}',
  '\u{1F44E}',
];

const isEscapeKey = (event) => (
  event?.key === 'Escape'
  || event?.key === 'Esc'
  || event?.code === 'Escape'
  || event?.keyCode === 27
);

const ChatReactionPicker = memo(function ChatReactionPicker({
  theme,
  ui,
  open,
  isOwn = false,
  selectedEmoji = '',
  compactMobile = false,
  onSelect,
  onClose,
}) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        onClose?.();
      }
    };
    const handleKeyDown = (event) => {
      if (!isEscapeKey(event)) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      onClose?.();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown, { passive: true });
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  const handleSelect = useCallback((emoji) => {
    onSelect?.(emoji);
    onClose?.();
  }, [onClose, onSelect]);

  if (!open) return null;

  return (
    <Box
      ref={containerRef}
      data-testid="chat-reaction-picker"
      sx={{
        position: 'absolute',
        top: compactMobile ? -48 : -50,
        ...(isOwn ? { right: compactMobile ? 0 : 2 } : { left: compactMobile ? 0 : 2 }),
        zIndex: 12,
        maxWidth: 'calc(100vw - 24px)',
      }}
    >
      <Paper
        elevation={4}
        sx={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: compactMobile ? 0.25 : 0.3,
          px: compactMobile ? 0.65 : 0.8,
          py: compactMobile ? 0.45 : 0.5,
          borderRadius: 999,
          maxWidth: 'calc(100vw - 24px)',
          overflowX: 'auto',
          bgcolor: alpha(ui.panelBg || theme.palette.background.paper, 0.97),
          border: `1px solid ${alpha(ui.borderSoft || theme.palette.divider, 0.9)}`,
          backdropFilter: 'blur(14px)',
          boxShadow: theme.palette.mode === 'dark'
            ? '0 10px 28px rgba(0,0,0,0.46)'
            : '0 10px 28px rgba(15,23,42,0.18)',
        }}
      >
        {CHAT_REACTION_EMOJIS.map((emoji) => {
          const selected = emoji === selectedEmoji;
          return (
            <Tooltip key={emoji} title={selected ? 'Убрать реакцию' : 'Поставить реакцию'}>
              <Box
                component="button"
                type="button"
                aria-label={`Reaction ${emoji}`}
                aria-pressed={selected}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  handleSelect(emoji);
                }}
                sx={{
                  width: compactMobile ? 34 : 36,
                  height: compactMobile ? 34 : 36,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 999,
                  border: 'none',
                  bgcolor: selected
                    ? alpha(ui.accentText || theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.3 : 0.17)
                    : 'transparent',
                  boxShadow: selected
                    ? `0 0 0 1.5px ${alpha(ui.accentText || theme.palette.primary.main, 0.42)}`
                    : 'none',
                  cursor: 'pointer',
                  fontSize: compactMobile ? 21 : 22,
                  lineHeight: 1,
                  transition: 'transform 120ms ease, background-color 120ms ease',
                  '&:hover': compactMobile ? undefined : {
                    bgcolor: selected
                      ? alpha(ui.accentText || theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.36 : 0.22)
                      : alpha(theme.palette.mode === 'dark' ? '#ffffff' : '#000000', 0.08),
                    transform: 'scale(1.15)',
                  },
                  '&:active': {
                    transform: 'scale(0.94)',
                  },
                }}
              >
                {emoji}
              </Box>
            </Tooltip>
          );
        })}
      </Paper>
    </Box>
  );
});

export default ChatReactionPicker;
