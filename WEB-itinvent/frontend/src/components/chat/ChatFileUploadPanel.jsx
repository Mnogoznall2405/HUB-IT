import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Checkbox,
  FormControlLabel,
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
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';

import { formatFileSize } from './chatHelpers';
import {
  isChatImageFile,
  isChatMediaFile,
  isChatVideoFile,
} from './chatUploadPrep';

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
    mediaBg: dark ? '#0f1822' : '#e8edf3',
    mediaOutline: dark ? 'oklch(1 0 0 / 0.1)' : 'oklch(0 0 0 / 0.1)',
    muted,
    shadow: dark ? '0 18px 42px rgba(0,0,0,0.42)' : '0 18px 42px rgba(34,48,62,0.18)',
    surface: dark ? surface : alpha(surface, 0.98),
    text,
  };
};

const getFileLabel = (file) => String(file?.name || 'Файл').trim() || 'Файл';

export const getChatUploadDialogTitle = (files = []) => {
  const items = Array.isArray(files) ? files.filter(Boolean) : [];
  if (items.length === 0) return 'Отправить как файл';
  const mediaItems = items.filter(isChatMediaFile);
  if (mediaItems.length !== items.length) {
    return items.length === 1 ? 'Отправить как файл' : 'Отправить файлы';
  }
  const imageCount = mediaItems.filter(isChatImageFile).length;
  const videoCount = mediaItems.filter(isChatVideoFile).length;
  if (items.length === 1) {
    return imageCount === 1 ? 'Отправить изображение' : 'Отправить видео';
  }
  if (imageCount === items.length) return 'Отправить изображения';
  if (videoCount === items.length) return 'Отправить видео';
  return 'Отправить медиа';
};

const formatMediaDuration = (value) => {
  const totalSeconds = Math.max(0, Math.round(Number(value || 0)));
  if (!totalSeconds) return '';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const getMediaGridColumns = (count) => {
  if (count === 1) return 'minmax(0, 1fr)';
  if (count === 5) return 'repeat(6, minmax(0, 1fr))';
  return 'repeat(2, minmax(0, 1fr))';
};

const getMediaGridHeight = (count) => {
  if (count === 1) return 'clamp(180px, 38dvh, 340px)';
  if (count === 2) return 'clamp(180px, 32dvh, 270px)';
  return 'clamp(230px, 40dvh, 330px)';
};

const getMediaTilePlacement = (count, index) => {
  if (count === 3 && index === 0) return { gridRow: 'span 2' };
  if (count === 5) return { gridColumn: index < 2 ? 'span 3' : 'span 2' };
  return {};
};

function useLocalMediaPreviewUrls(files) {
  const mediaFiles = useMemo(
    () => (Array.isArray(files) ? files.filter(isChatMediaFile) : []),
    [files],
  );
  const cacheRef = useRef(new Map());
  const [previewUrls, setPreviewUrls] = useState(() => new Map());

  useEffect(() => {
    const urlApi = typeof URL !== 'undefined' ? URL : null;
    const canCreate = typeof urlApi?.createObjectURL === 'function';
    const canRevoke = typeof urlApi?.revokeObjectURL === 'function';
    const activeFiles = new Set(mediaFiles);

    cacheRef.current.forEach((url, file) => {
      if (activeFiles.has(file)) return;
      if (url && canRevoke) urlApi.revokeObjectURL(url);
      cacheRef.current.delete(file);
    });
    if (canCreate) {
      mediaFiles.forEach((file) => {
        if (!cacheRef.current.has(file)) {
          cacheRef.current.set(file, urlApi.createObjectURL(file));
        }
      });
    }
    setPreviewUrls(new Map(cacheRef.current));
  }, [mediaFiles]);

  useEffect(() => () => {
    const urlApi = typeof URL !== 'undefined' ? URL : null;
    if (typeof urlApi?.revokeObjectURL === 'function') {
      cacheRef.current.forEach((url) => {
        if (url) urlApi.revokeObjectURL(url);
      });
    }
    cacheRef.current.clear();
  }, []);

  return previewUrls;
}

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

function DocumentUploadRow({ busy, file, fileIndex, isDropMode, onRemove, tokens }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1.55}>
      <UploadDocumentIcon color={tokens.iconBg} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ color: tokens.text, fontSize: '13.5px', fontWeight: 700, lineHeight: 1.25 }} noWrap>
          {getFileLabel(file)}
        </Typography>
        <Typography sx={{ color: tokens.muted, fontSize: '13px', lineHeight: 1.25, mt: 0.15 }} noWrap>
          {formatFileSize(file?.size)}
        </Typography>
      </Box>
      {!isDropMode ? (
        <IconButton
          aria-label={`Удалить ${getFileLabel(file)}`}
          data-testid={`file-dialog-remove-${fileIndex}`}
          disabled={busy}
          onClick={() => onRemove?.(fileIndex)}
          size="small"
          sx={{
            width: 40,
            height: 40,
            mr: -1,
            color: tokens.muted,
            '&:focus-visible': { outline: `2px solid ${tokens.accent}`, outlineOffset: 2 },
          }}
        >
          <CloseRoundedIcon sx={{ fontSize: 19 }} />
        </IconButton>
      ) : null}
    </Stack>
  );
}

function LocalVideoPreview({ file, onPlaybackStart, src, tokens }) {
  const videoRef = useRef(null);
  const [duration, setDuration] = useState('');
  const [playing, setPlaying] = useState(false);

  useEffect(() => () => {
    try {
      videoRef.current?.pause?.();
    } catch {
      // Ignore media cleanup failures while removing a local preview.
    }
  }, []);

  const startPlayback = useCallback(async () => {
    const video = videoRef.current;
    if (!video || typeof video.play !== 'function') return;
    onPlaybackStart?.(video);
    try {
      await video.play();
    } catch {
      setPlaying(false);
    }
  }, [onPlaybackStart]);

  return (
    <>
      <Box
        component="video"
        ref={videoRef}
        src={src || undefined}
        aria-label={`Предпросмотр видео ${getFileLabel(file)}`}
        controls={playing}
        playsInline
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(formatMediaDuration(event.currentTarget.duration))}
        onPlay={(event) => {
          onPlaybackStart?.(event.currentTarget);
          setPlaying(true);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        sx={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover', bgcolor: tokens.mediaBg }}
      />
      {!playing ? (
        <IconButton
          type="button"
          aria-label={`Воспроизвести видео ${getFileLabel(file)}`}
          onClick={startPlayback}
          sx={{
            position: 'absolute',
            insetInlineStart: '50%',
            top: '50%',
            width: 52,
            height: 52,
            transform: 'translate(-50%, -50%)',
            bgcolor: 'rgba(15, 23, 42, 0.68)',
            color: '#ffffff',
            boxShadow: '0 10px 26px rgba(2, 6, 23, 0.32)',
            '&:hover': { bgcolor: 'rgba(15, 23, 42, 0.82)' },
            '&:active': { transform: 'translate(-50%, -50%) scale(0.96)' },
            '&:focus-visible': { outline: `2px solid ${tokens.accent}`, outlineOffset: 2 },
          }}
        >
          <PlayArrowRoundedIcon sx={{ fontSize: 31, ml: 0.3 }} />
        </IconButton>
      ) : null}
      {duration && !playing ? (
        <Box
          aria-hidden="true"
          sx={{
            position: 'absolute',
            insetInlineEnd: 8,
            bottom: 8,
            borderRadius: 999,
            bgcolor: 'rgba(2, 6, 23, 0.72)',
            color: '#ffffff',
            px: 0.8,
            py: 0.4,
            fontSize: '11px',
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          {duration}
        </Box>
      ) : null}
    </>
  );
}

function MediaUploadGrid({ busy, files, isDropMode, onRemove, previewUrls, tokens }) {
  const activeVideoRef = useRef(null);
  const mediaItems = useMemo(
    () => (Array.isArray(files) ? files : [])
      .map((file, fileIndex) => ({ file, fileIndex }))
      .filter(({ file }) => isChatMediaFile(file)),
    [files],
  );
  const itemCount = mediaItems.length;

  const handlePlaybackStart = useCallback((video) => {
    const activeVideo = activeVideoRef.current;
    if (activeVideo && activeVideo !== video) {
      try {
        activeVideo.pause();
      } catch {
        // Ignore browser media cleanup failures.
      }
    }
    activeVideoRef.current = video;
  }, []);

  if (itemCount === 0) return null;

  return (
    <Box
      role="group"
      aria-label="Предпросмотр медиа"
      data-testid={`chat-media-upload-grid-${itemCount}`}
      sx={{
        display: 'grid',
        gridTemplateColumns: getMediaGridColumns(itemCount),
        gridTemplateRows: itemCount === 3 ? 'repeat(2, minmax(0, 1fr))' : undefined,
        gridAutoRows: itemCount === 5 ? 'minmax(0, 1fr)' : undefined,
        gap: '3px',
        width: '100%',
        height: getMediaGridHeight(itemCount),
        overflow: 'hidden',
        borderRadius: '8px',
        bgcolor: tokens.mediaBg,
        outline: `1px solid ${tokens.mediaOutline}`,
        outlineOffset: '-1px',
      }}
    >
      {mediaItems.map(({ file, fileIndex }, mediaIndex) => {
        const previewUrl = previewUrls.get(file) || '';
        const singleItem = itemCount === 1;
        return (
          <Box
            key={`${getFileLabel(file)}-${Number(file?.size || 0)}-${fileIndex}`}
            data-testid={`chat-media-upload-tile-${fileIndex}`}
            sx={{
              ...getMediaTilePlacement(itemCount, mediaIndex),
              position: 'relative',
              minWidth: 0,
              minHeight: 0,
              overflow: 'hidden',
              bgcolor: tokens.mediaBg,
            }}
          >
            {isChatImageFile(file) ? (
              <Box
                component="img"
                src={previewUrl || undefined}
                alt={`Предпросмотр ${getFileLabel(file)}`}
                sx={{
                  display: 'block',
                  width: '100%',
                  height: '100%',
                  objectFit: singleItem ? 'contain' : 'cover',
                  bgcolor: tokens.mediaBg,
                }}
              />
            ) : (
              <LocalVideoPreview
                file={file}
                src={previewUrl}
                tokens={tokens}
                onPlaybackStart={handlePlaybackStart}
              />
            )}
            {!isDropMode ? (
              <IconButton
                aria-label={`Удалить ${getFileLabel(file)}`}
                data-testid={`file-dialog-remove-${fileIndex}`}
                disabled={busy}
                onClick={() => onRemove?.(fileIndex)}
                size="small"
                sx={{
                  position: 'absolute',
                  top: 6,
                  insetInlineEnd: 6,
                  width: 40,
                  height: 40,
                  bgcolor: 'rgba(15, 23, 42, 0.68)',
                  color: '#ffffff',
                  backdropFilter: 'blur(5px)',
                  '&:hover': { bgcolor: 'rgba(15, 23, 42, 0.82)' },
                  '&:active': { transform: 'scale(0.96)' },
                  '&:focus-visible': { outline: `2px solid ${tokens.accent}`, outlineOffset: 2 },
                }}
              >
                <CloseRoundedIcon sx={{ fontSize: 20 }} />
              </IconButton>
            ) : null}
          </Box>
        );
      })}
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
  onSendMediaAsFilesChange,
  preparing = false,
  sending = false,
  sendMediaAsFiles = false,
  showActions = true,
  showCaption = true,
  theme,
  ui = {},
  uploadProgress = 0,
}) {
  const captionInputRef = useRef(null);
  const tokens = getUploadPanelTokens(theme, ui);
  const items = useMemo(() => (Array.isArray(files) ? files.filter(Boolean) : []), [files]);
  const documentItems = useMemo(
    () => items.map((file, fileIndex) => ({ file, fileIndex })).filter(({ file }) => !isChatMediaFile(file)),
    [items],
  );
  const mediaItemCount = items.length - documentItems.length;
  const previewUrls = useLocalMediaPreviewUrls(items);
  const busy = Boolean(disabled || preparing || sending);
  const isDropMode = mode === 'drop';
  const normalizedProgress = Math.max(0, Math.min(100, Math.round(Number(uploadProgress || 0))));
  const title = getChatUploadDialogTitle(items);

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
          ? { xs: 'min(430px, calc(100vw - 20px))', sm: 'min(520px, max(420px, 42vw))' }
          : '100%',
        maxWidth: { xs: 430, sm: 520 },
        maxHeight: isDropMode ? undefined : 'calc(100dvh - 20px)',
        borderRadius: '8px',
        bgcolor: tokens.surface,
        color: tokens.text,
        boxShadow: tokens.shadow,
        fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
        overflowX: 'hidden',
        overflowY: isDropMode ? 'hidden' : 'auto',
        overscrollBehavior: 'contain',
        pointerEvents: isDropMode ? 'none' : 'auto',
      }}
    >
      <Box sx={{ px: { xs: 2.6, sm: 3.5 }, pt: { xs: 1.5, sm: 1.8 }, pb: { xs: 1.45, sm: 1.65 } }}>
        <Stack spacing={{ xs: 1.4, sm: 1.6 }}>
          <Stack direction="row" alignItems="center" spacing={1.2}>
            <Typography component="h2" sx={{ flex: 1, minWidth: 0, color: tokens.text, fontSize: '16px', fontWeight: 700, lineHeight: 1.25 }}>
              {title}
            </Typography>
            <IconButton
              aria-label="Действия с файлами"
              disabled={busy || isDropMode}
              onClick={onOpenMenu}
              size="small"
              sx={{
                width: 40,
                height: 40,
                mr: -1.4,
                color: tokens.muted,
                opacity: isDropMode ? 0 : 1,
                '&:focus-visible': { outline: `2px solid ${tokens.accent}`, outlineOffset: 2 },
              }}
            >
              <MoreVertRoundedIcon sx={{ fontSize: 21 }} />
            </IconButton>
          </Stack>

          {mediaItemCount > 0 ? (
            <MediaUploadGrid
              busy={busy}
              files={items}
              isDropMode={isDropMode}
              onRemove={onRemoveFile}
              previewUrls={previewUrls}
              tokens={tokens}
            />
          ) : null}

          {documentItems.length > 0 ? (
            <Stack spacing={1.1} sx={{ maxHeight: mediaItemCount > 0 ? 132 : 220, overflowY: 'auto', pr: 0.25 }}>
              {documentItems.map(({ file, fileIndex }) => (
                <DocumentUploadRow
                  key={`${getFileLabel(file)}-${Number(file?.size || 0)}-${fileIndex}`}
                  busy={busy}
                  file={file}
                  fileIndex={fileIndex}
                  isDropMode={isDropMode}
                  onRemove={onRemoveFile}
                  tokens={tokens}
                />
              ))}
            </Stack>
          ) : null}

          {items.length === 0 ? (
            <Stack direction="row" alignItems="center" spacing={1.55}>
              <UploadDocumentIcon color={tokens.iconBg} />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ color: tokens.text, fontSize: '13.5px', fontWeight: 700 }} noWrap>
                  Файл для отправки
                </Typography>
                <Typography sx={{ color: tokens.muted, fontSize: '13px' }} noWrap>
                  {isDropMode ? 'Отпустите мышь, чтобы добавить файл' : 'Файлы не выбраны'}
                </Typography>
              </Box>
            </Stack>
          ) : null}

          {mediaItemCount > 0 && !isDropMode ? (
            <FormControlLabel
              data-testid="send-media-as-files-control"
              disabled={busy}
              control={(
                <Checkbox
                  checked={Boolean(sendMediaAsFiles)}
                  onChange={(event) => onSendMediaAsFilesChange?.(event.target.checked)}
                  inputProps={{ 'aria-label': 'Отправить как файл' }}
                  sx={{ color: tokens.muted, '&.Mui-checked': { color: tokens.accent } }}
                />
              )}
              label="Отправить как файл"
              sx={{
                alignSelf: 'flex-start',
                m: 0,
                color: tokens.text,
                '& .MuiFormControlLabel-label': { fontSize: '14px', lineHeight: 1.3 },
              }}
            />
          ) : null}

          {(preparing || sending) ? (
            <Box role="status" aria-live="polite">
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
                  '& .MuiLinearProgress-bar': { borderRadius: 999, bgcolor: tokens.divider },
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
                    fontSize: { xs: '16px', sm: '13.5px' },
                    lineHeight: 1.35,
                    '& textarea': { p: 0 },
                    '& textarea::placeholder': { color: tokens.actionText, opacity: 0.95 },
                  }}
                />
                <IconButton
                  aria-label="Эмодзи для подписи"
                  disabled={busy || isDropMode}
                  onClick={onOpenEmoji}
                  size="small"
                  sx={{
                    width: 40,
                    height: 40,
                    mb: -0.65,
                    mr: -0.7,
                    color: tokens.muted,
                    '&:focus-visible': { outline: `2px solid ${tokens.accent}`, outlineOffset: 2 },
                  }}
                >
                  <InsertEmoticonRoundedIcon sx={{ fontSize: 21 }} />
                </IconButton>
              </Stack>
              <Box sx={{ mt: 0.7, height: 1.5, bgcolor: tokens.divider }} />
            </Box>
          ) : null}

          {showActions ? (
            <Stack data-testid="file-dialog-mobile-dock" direction="row" spacing={{ xs: 2.5, sm: 2.9 }} alignItems="center" sx={{ pt: 0.25 }}>
              <Box component="button" type="button" onClick={onAdd} disabled={busy} sx={textActionButtonSx(tokens)}>
                Добавить
              </Box>
              <Box component="button" type="button" onClick={onCancel} disabled={busy} sx={textActionButtonSx(tokens)}>
                Отмена
              </Box>
              <Box
                component="button"
                type="button"
                data-testid="file-dialog-send"
                onClick={() => onSend?.()}
                disabled={busy || items.length === 0}
                sx={{ ...textActionButtonSx(tokens), ml: 'auto', opacity: busy || items.length === 0 ? 0.45 : 1 }}
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
  minHeight: 40,
  px: 0.5,
  py: 0,
  transition: 'opacity 120ms ease, transform 120ms ease',
  '&:active': { transform: 'scale(0.96)' },
  '&:focus-visible': { outline: `2px solid ${tokens.accent}`, outlineOffset: 2, borderRadius: 1 },
  '&:disabled': { cursor: 'default', opacity: 0.45 },
});
