import { useEffect, useRef } from 'react';
import {
  Box,
  IconButton,
  InputBase,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import InsertEmoticonRoundedIcon from '@mui/icons-material/InsertEmoticonRounded';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';

import { formatFileSize } from './chatHelpers';

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

const getUploadPanelTokens = (theme, ui = {}) => {
  const dark = theme.palette.mode === 'dark';
  const accent = ui.accentText || (dark ? '#64b5f6' : '#3390ec');
  const surface = dark ? '#17212b' : '#ffffff';
  const text = ui.textStrong || (dark ? '#ffffff' : '#17212b');
  const muted = ui.textSecondary || (dark ? alpha('#ffffff', 0.58) : '#707579');

  return {
    accent,
    actionText: accent,
    divider: dark ? alpha('#64b5f6', 0.72) : alpha('#3390ec', 0.62),
    iconBg: dark ? '#54a8e8' : '#3390ec',
    inputText: text,
    muted,
    shadow: dark ? '0 18px 42px rgba(0,0,0,0.42)' : '0 18px 42px rgba(34,48,62,0.18)',
    surface: dark ? surface : alpha(surface, 0.98),
    text,
  };
};

const getFileLabel = (file) => String(file?.name || 'Файл').trim() || 'Файл';

function UploadDocumentIcon({ color }) {
  return (
    <Box
      aria-hidden="true"
      sx={{
        width: 44,
        height: 44,
        borderRadius: '50%',
        bgcolor: color,
        color: '#ffffff',
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
      }}
    >
      <DescriptionOutlinedIcon sx={{ fontSize: 24 }} />
    </Box>
  );
}

export default function ChatFileUploadPanel({
  autoFocusCaption = false,
  caption = '',
  disabled = false,
  files = [],
  mode = 'dialog',
  onAdd,
  onCancel,
  onCaptionChange,
  onOpenEmoji,
  onOpenMenu,
  onRemoveFile,
  onSend,
  preparing = false,
  sending = false,
  showActions = true,
  showCaption = true,
  theme,
  ui = {},
  uploadProgress = 0,
}) {
  const captionInputRef = useRef(null);
  const tokens = getUploadPanelTokens(theme, ui);
  const items = Array.isArray(files) ? files.filter(Boolean) : [];
  const busy = Boolean(disabled || preparing || sending);
  const isDropMode = mode === 'drop';
  const normalizedProgress = Math.max(0, Math.min(100, Math.round(Number(uploadProgress || 0))));
  const primaryFile = items[0] || null;
  const title = 'Отправить как файл';
  const secondaryText = primaryFile
    ? formatFileSize(primaryFile.size)
    : (isDropMode ? 'Отпустите мышку, чтобы добавить файл' : 'Файлы не выбраны');

  useEffect(() => {
    if (!autoFocusCaption || !showCaption || isDropMode || busy || items.length === 0) return undefined;
    let cancelled = false;
    const frameId = window.requestAnimationFrame(() => {
      if (cancelled) return;
      const input = captionInputRef.current;
      if (!input || typeof input.focus !== 'function') return;
      input.focus({ preventScroll: true });
      const cursorPosition = String(caption || '').length;
      if (typeof input.setSelectionRange === 'function') {
        try {
          input.setSelectionRange(cursorPosition, cursorPosition);
        } catch {
          // Some input implementations reject selection updates while hidden.
        }
      }
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
    };
  }, [autoFocusCaption, busy, caption, isDropMode, items.length, showCaption]);

  return (
    <Box
      data-testid={isDropMode ? 'chat-file-drop-panel' : 'chat-file-upload-panel'}
      sx={{
        width: isDropMode
          ? {
            xs: 'min(430px, calc(100vw - 20px))',
            sm: 'min(520px, max(420px, 42vw))',
          }
          : '100%',
        maxWidth: { xs: 430, sm: 520 },
        borderRadius: '8px',
        bgcolor: tokens.surface,
        color: tokens.text,
        boxShadow: tokens.shadow,
        fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
        overflow: 'hidden',
        pointerEvents: isDropMode ? 'none' : 'auto',
      }}
    >
      <Box sx={{ px: { xs: 2.6, sm: 3.5 }, pt: { xs: 1.9, sm: 2.15 }, pb: { xs: 1.45, sm: 1.65 } }}>
        <Stack spacing={{ xs: 1.5, sm: 1.75 }}>
          <Stack direction="row" alignItems="center" spacing={1.2}>
            <Typography
              component="h2"
              sx={{
                flex: 1,
                minWidth: 0,
                color: tokens.text,
                fontSize: '16px',
                fontWeight: 700,
                lineHeight: 1.25,
              }}
            >
              {title}
            </Typography>
            <IconButton
              aria-label="Действия с файлами"
              disabled={busy || isDropMode}
              onClick={onOpenMenu}
              size="small"
              sx={{
                width: 30,
                height: 30,
                mr: -1.4,
                color: tokens.muted,
                opacity: isDropMode ? 0 : 1,
              }}
            >
              <MoreVertRoundedIcon sx={{ fontSize: 20 }} />
            </IconButton>
          </Stack>

          <Stack direction="row" alignItems="center" spacing={1.55}>
            <UploadDocumentIcon color={tokens.iconBg} />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography
                sx={{
                  color: tokens.text,
                  fontSize: '13.5px',
                  fontWeight: 700,
                  lineHeight: 1.25,
                }}
                noWrap
              >
                {primaryFile ? getFileLabel(primaryFile) : 'Файл для отправки'}
              </Typography>
              <Typography
                sx={{
                  color: tokens.muted,
                  fontSize: '13px',
                  lineHeight: 1.25,
                  mt: 0.15,
                }}
                noWrap
              >
                {secondaryText}
                {items.length > 1 ? ` · ещё ${items.length - 1}` : ''}
              </Typography>
            </Box>
            <IconButton
              aria-label="Действия с файлом"
              disabled={busy || isDropMode}
              onClick={onOpenMenu}
              size="small"
              sx={{
                width: 30,
                height: 30,
                color: tokens.muted,
                opacity: isDropMode ? 0 : 1,
              }}
            >
              <MoreVertRoundedIcon sx={{ fontSize: 20 }} />
            </IconButton>
            <IconButton
              aria-label={primaryFile ? `Удалить ${getFileLabel(primaryFile)}` : 'Удалить файл'}
              data-testid="file-dialog-remove-0"
              disabled={busy || isDropMode || items.length === 0}
              onClick={() => onRemoveFile?.(0)}
              size="small"
              sx={{
                width: 30,
                height: 30,
                mr: -1.4,
                color: tokens.muted,
                opacity: isDropMode ? 0 : 1,
              }}
            >
              <CloseRoundedIcon sx={{ fontSize: 19 }} />
            </IconButton>
          </Stack>

          {items.length > 1 ? (
            <Stack spacing={0.85} sx={{ maxHeight: 92, overflowY: 'auto', pr: 0.25 }}>
              {items.slice(1).map((file, index) => (
                <Stack key={`${getFileLabel(file)}-${file.size}-${index}`} direction="row" spacing={1} alignItems="center">
                  <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: alpha(tokens.iconBg, 0.42), flexShrink: 0 }} />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ color: tokens.text, fontSize: '13px', fontWeight: 650 }} noWrap>
                      {getFileLabel(file)}
                    </Typography>
                    <Typography sx={{ color: tokens.muted, fontSize: '12px' }} noWrap>
                      {formatFileSize(file.size)}
                    </Typography>
                  </Box>
                  {!isDropMode ? (
                    <IconButton
                      aria-label={`Удалить ${getFileLabel(file)}`}
                      data-testid={`file-dialog-remove-${index + 1}`}
                      disabled={busy}
                      onClick={() => onRemoveFile?.(index + 1)}
                      size="small"
                      sx={{ width: 28, height: 28, color: tokens.muted }}
                    >
                      <CloseRoundedIcon sx={{ fontSize: 17 }} />
                    </IconButton>
                  ) : null}
                </Stack>
              ))}
            </Stack>
          ) : null}

          {(preparing || sending) ? (
            <Box>
              <Typography sx={{ color: tokens.muted, fontSize: '12.5px', mb: 0.7 }}>
                {preparing ? 'Подготовка файлов...' : `Отправка ${normalizedProgress}%`}
              </Typography>
              <LinearProgress
                variant={sending ? 'determinate' : 'indeterminate'}
                value={normalizedProgress}
                sx={{
                  height: 3,
                  borderRadius: 999,
                  bgcolor: alpha(tokens.divider, 0.24),
                  '& .MuiLinearProgress-bar': {
                    borderRadius: 999,
                    bgcolor: tokens.divider,
                  },
                }}
              />
            </Box>
          ) : null}

          {showCaption ? (
            <Box>
              <Stack direction="row" alignItems="flex-end" spacing={1}>
                <InputBase
                  inputRef={captionInputRef}
                  aria-label="Подпись"
                  placeholder="Подпись"
                  value={caption}
                  onChange={(event) => onCaptionChange?.(event.target.value)}
                  disabled={busy || isDropMode}
                  multiline
                  minRows={1}
                  maxRows={4}
                  inputProps={{ maxLength: 12000 }}
                  sx={{
                    flex: 1,
                    color: tokens.inputText,
                    fontSize: '13.5px',
                    lineHeight: 1.35,
                    '& textarea': { p: 0 },
                    '& textarea::placeholder': {
                      color: tokens.actionText,
                      opacity: 0.95,
                    },
                  }}
                />
                <IconButton
                  aria-label="Эмодзи для подписи"
                  disabled={busy || isDropMode}
                  onClick={onOpenEmoji}
                  size="small"
                  sx={{
                    width: 30,
                    height: 30,
                    mb: -0.45,
                    color: tokens.muted,
                  }}
                >
                  <InsertEmoticonRoundedIcon sx={{ fontSize: 21 }} />
                </IconButton>
              </Stack>
              <Box sx={{ mt: 0.9, height: 1.5, bgcolor: tokens.divider }} />
            </Box>
          ) : null}

          {showActions ? (
            <Stack data-testid="file-dialog-mobile-dock" direction="row" spacing={2.9} alignItems="center" sx={{ pt: 0.25 }}>
              <Box
                component="button"
                type="button"
                onClick={onAdd}
                disabled={busy}
                sx={textActionButtonSx(tokens)}
              >
                Добавить
              </Box>
              <Box
                component="button"
                type="button"
                onClick={onCancel}
                disabled={busy}
                sx={textActionButtonSx(tokens)}
              >
                Отмена
              </Box>
              <Box
                component="button"
                type="button"
                data-testid="file-dialog-send"
                onClick={() => onSend?.()}
                disabled={busy || items.length === 0}
                sx={{
                  ...textActionButtonSx(tokens),
                  ml: 'auto',
                  opacity: busy || items.length === 0 ? 0.45 : 1,
                }}
              >
                Отправить
              </Box>
            </Stack>
          ) : null}
        </Stack>
      </Box>
    </Box>
  );
}

const textActionButtonSx = (tokens) => ({
  appearance: 'none',
  border: 'none',
  background: 'transparent',
  color: tokens.actionText,
  cursor: 'pointer',
  fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
  fontSize: '14px',
  fontWeight: 500,
  lineHeight: 1.2,
  p: 0,
  transition: 'opacity 120ms ease, transform 120ms ease',
  '&:active': {
    transform: 'scale(0.98)',
  },
  '&:disabled': {
    cursor: 'default',
    opacity: 0.45,
  },
});
