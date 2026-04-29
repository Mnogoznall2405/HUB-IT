import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import { AnimatePresence, motion } from 'framer-motion';

import {
  formatFullDate,
  normalizeChatAttachmentUrl,
} from './chatHelpers';

const clampPreviewIndex = (value, length) => {
  const normalizedLength = Number(length || 0);
  if (normalizedLength <= 0) return 0;
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.min(normalizedLength - 1, Math.max(0, Math.trunc(numericValue)));
};

const isPreviewVideo = (item) => String(item?.mime_type || item?.mimeType || '').toLowerCase().startsWith('video/');

export default function ChatMediaPreviewDialog({
  attachmentPreview,
  fullScreen = false,
  onClose,
  prefersReducedMotion = false,
}) {
  const previewGestureRef = useRef({
    startX: 0,
    startY: 0,
    active: false,
    dragged: false,
    mode: 'none',
  });
  const previewChromeTimeoutRef = useRef(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewChromeVisible, setPreviewChromeVisible] = useState(true);
  const [previewMenuAnchorEl, setPreviewMenuAnchorEl] = useState(null);
  const [activePreviewUrl, setActivePreviewUrl] = useState('');
  const previewMenuOpen = Boolean(previewMenuAnchorEl);
  const previewChromeActive = previewChromeVisible || previewMenuOpen;
  const previewItems = useMemo(() => {
    const items = Array.isArray(attachmentPreview?.items) ? attachmentPreview.items : [];
    if (items.length > 0) return items;
    return attachmentPreview?.attachment ? [attachmentPreview.attachment] : [];
  }, [attachmentPreview]);
  const safePreviewIndex = clampPreviewIndex(previewIndex, previewItems.length);
  const activePreviewItem = previewItems[safePreviewIndex] || attachmentPreview?.attachment || null;
  const activePreviewOriginalUrl = normalizeChatAttachmentUrl(
    activePreviewItem?.originalUrl
    || activePreviewItem?.fileUrl
    || attachmentPreview?.originalUrl
    || attachmentPreview?.fileUrl
    || '',
  );
  const activePreviewBaseUrl = normalizeChatAttachmentUrl(
    activePreviewItem?.previewUrl
    || attachmentPreview?.previewUrl
    || activePreviewOriginalUrl
    || '',
  );
  const activePreviewPosterUrl = normalizeChatAttachmentUrl(
    activePreviewItem?.posterUrl
    || attachmentPreview?.posterUrl
    || '',
  );
  const canStepPreview = previewItems.length > 1;
  const activePreviewIsVideo = isPreviewVideo(activePreviewItem);
  const previewKindLabel = activePreviewIsVideo ? 'Видео' : 'Фотография';
  const previewTotalCount = Math.max(1, previewItems.length || Number(attachmentPreview?.totalCount || 0) || 1);
  const previewCountLabel = `${previewKindLabel} ${safePreviewIndex + 1} из ${previewTotalCount}`;
  const previewSenderName = String(attachmentPreview?.senderName || '').trim();
  const previewCreatedAt = String(attachmentPreview?.createdAt || '').trim();
  const previewMetaLine = [previewSenderName, previewCreatedAt ? formatFullDate(previewCreatedAt) : '']
    .filter(Boolean)
    .join(' • ');
  const previewMediaUrl = activePreviewOriginalUrl || activePreviewUrl || activePreviewBaseUrl;
  const previewDownloadName = activePreviewItem?.file_name || attachmentPreview?.attachment?.file_name || undefined;

  useEffect(() => {
    setPreviewIndex(clampPreviewIndex(attachmentPreview?.activeIndex, previewItems.length));
  }, [attachmentPreview, previewItems.length]);

  useEffect(() => {
    const nextBaseUrl = activePreviewBaseUrl || activePreviewOriginalUrl;
    setActivePreviewUrl(nextBaseUrl);
    if (!nextBaseUrl || !activePreviewOriginalUrl || nextBaseUrl === activePreviewOriginalUrl || activePreviewIsVideo) {
      return undefined;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled) {
        setActivePreviewUrl(activePreviewOriginalUrl);
      }
    };
    image.onerror = () => {};
    image.src = activePreviewOriginalUrl;
    return () => {
      cancelled = true;
    };
  }, [activePreviewBaseUrl, activePreviewIsVideo, activePreviewOriginalUrl, safePreviewIndex]);

  useEffect(() => {
    setPreviewMenuAnchorEl(null);
  }, [safePreviewIndex, attachmentPreview]);

  const stepPreview = useCallback((direction) => {
    if (!canStepPreview) return;
    setPreviewIndex((current) => {
      const nextIndex = current + direction;
      if (nextIndex < 0) return previewItems.length - 1;
      if (nextIndex >= previewItems.length) return 0;
      return nextIndex;
    });
  }, [canStepPreview, previewItems.length]);

  const clearPreviewChromeTimer = useCallback(() => {
    if (previewChromeTimeoutRef.current) {
      window.clearTimeout(previewChromeTimeoutRef.current);
      previewChromeTimeoutRef.current = null;
    }
  }, []);

  const bumpPreviewChromeVisibility = useCallback((stick = false) => {
    setPreviewChromeVisible(true);
    clearPreviewChromeTimer();
    if (stick || !attachmentPreview || previewMenuOpen) return;
    previewChromeTimeoutRef.current = window.setTimeout(() => {
      setPreviewChromeVisible(false);
    }, 2200);
  }, [attachmentPreview, clearPreviewChromeTimer, previewMenuOpen]);

  const togglePreviewChrome = useCallback(() => {
    if (previewMenuOpen) {
      setPreviewMenuAnchorEl(null);
      return;
    }
    clearPreviewChromeTimer();
    setPreviewChromeVisible((current) => {
      const next = !current;
      if (next && attachmentPreview) {
        previewChromeTimeoutRef.current = window.setTimeout(() => {
          setPreviewChromeVisible(false);
        }, 2200);
      }
      return next;
    });
  }, [attachmentPreview, clearPreviewChromeTimer, previewMenuOpen]);

  const beginPreviewGesture = useCallback((startX, startY) => {
    previewGestureRef.current = {
      startX: Number(startX || 0),
      startY: Number(startY || 0),
      active: true,
      dragged: false,
      mode: 'none',
    };
    bumpPreviewChromeVisibility(true);
  }, [bumpPreviewChromeVisibility]);

  const updatePreviewGesture = useCallback((currentX, currentY) => {
    if (!previewGestureRef.current.active) return;
    const deltaX = Number(currentX || 0) - previewGestureRef.current.startX;
    const deltaY = Number(currentY || 0) - previewGestureRef.current.startY;
    if (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8) {
      previewGestureRef.current.dragged = true;
    }
    if (previewGestureRef.current.mode === 'none') {
      if (fullScreen && deltaY > 10 && Math.abs(deltaY) > (Math.abs(deltaX) + 8)) {
        previewGestureRef.current.mode = 'dismiss';
      } else if (Math.abs(deltaX) > 10 && Math.abs(deltaX) > (Math.abs(deltaY) + 6)) {
        previewGestureRef.current.mode = 'step';
      }
    }
  }, [fullScreen]);

  const finishPreviewGesture = useCallback((endX, endY) => {
    if (!previewGestureRef.current.active) return;
    const deltaX = Number(endX || 0) - previewGestureRef.current.startX;
    const deltaY = Number(endY || 0) - previewGestureRef.current.startY;
    const dragged = Boolean(previewGestureRef.current.dragged);
    const mode = previewGestureRef.current.mode;
    previewGestureRef.current.active = false;
    previewGestureRef.current.dragged = false;
    previewGestureRef.current.mode = 'none';
    if (!dragged) return;
    if (mode === 'dismiss') {
      if (deltaY > 92) {
        onClose?.();
      }
      return;
    }
    if (Math.abs(deltaX) > 46 && Math.abs(deltaX) > Math.abs(deltaY)) {
      stepPreview(deltaX < 0 ? 1 : -1);
      bumpPreviewChromeVisibility();
    }
  }, [bumpPreviewChromeVisibility, onClose, stepPreview]);

  useEffect(() => {
    if (!attachmentPreview) {
      clearPreviewChromeTimer();
      setPreviewChromeVisible(true);
      setPreviewMenuAnchorEl(null);
      return undefined;
    }
    bumpPreviewChromeVisibility();
    return () => {
      clearPreviewChromeTimer();
    };
  }, [attachmentPreview, safePreviewIndex, bumpPreviewChromeVisibility, clearPreviewChromeTimer]);

  useEffect(() => {
    if (!attachmentPreview || !canStepPreview) return undefined;
    const handlePreviewKeyDown = (event) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        stepPreview(-1);
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        stepPreview(1);
      }
    };
    window.addEventListener('keydown', handlePreviewKeyDown);
    return () => {
      window.removeEventListener('keydown', handlePreviewKeyDown);
    };
  }, [attachmentPreview, canStepPreview, stepPreview]);

  useEffect(() => {
    if (!previewMenuOpen) return undefined;
    clearPreviewChromeTimer();
    setPreviewChromeVisible(true);
    return undefined;
  }, [clearPreviewChromeTimer, previewMenuOpen]);

  const handleOpenPreviewMenu = (event) => {
    clearPreviewChromeTimer();
    setPreviewChromeVisible(true);
    setPreviewMenuAnchorEl(event.currentTarget);
  };

  const handleClosePreviewMenu = () => {
    setPreviewMenuAnchorEl(null);
    bumpPreviewChromeVisibility();
  };

  return (
    <Dialog
      open={Boolean(attachmentPreview)}
      onClose={onClose}
      fullScreen={fullScreen}
      fullWidth
      maxWidth={false}
      BackdropProps={{
        sx: {
          bgcolor: alpha('#000000', 0.64),
          backdropFilter: 'none',
        },
      }}
      PaperProps={{
        sx: {
          m: 0,
          width: '100%',
          maxWidth: '100%',
          height: '100dvh',
          borderRadius: 0,
          bgcolor: 'transparent',
          color: '#fff',
          overflow: 'hidden',
          backgroundImage: 'none',
          boxShadow: 'none',
        },
      }}
    >
      <DialogTitle
        data-testid="chat-attachment-preview-topbar"
        sx={{
          display: previewChromeActive ? 'flex' : 'none',
          justifyContent: 'flex-end',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 4,
          px: { xs: 1.25, md: 2 },
          pt: 'max(env(safe-area-inset-top), 10px)',
          pb: 0,
          borderBottom: 'none',
          background: 'transparent',
          pointerEvents: 'none',
        }}
      >
        <IconButton
          aria-label="Закрыть предпросмотр"
          onClick={onClose}
          sx={{
            pointerEvents: 'auto',
            color: alpha('#fff', 0.88),
            bgcolor: 'transparent',
            '&:hover': { bgcolor: alpha('#ffffff', 0.1) },
          }}
        >
          <CloseRoundedIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent
        data-testid="chat-attachment-preview-content"
        sx={{
          position: 'relative',
          p: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100%',
          bgcolor: 'transparent',
          userSelect: 'none',
        }}
        onTouchStart={(event) => {
          const touch = event.touches?.[0];
          if (!touch) return;
          beginPreviewGesture(touch.clientX, touch.clientY);
        }}
        onTouchMove={(event) => {
          const touch = event.touches?.[0];
          if (!touch) return;
          updatePreviewGesture(touch.clientX, touch.clientY);
        }}
        onTouchEnd={(event) => {
          const touch = event.changedTouches?.[0];
          if (!touch) return;
          finishPreviewGesture(touch.clientX, touch.clientY);
        }}
        onClick={(event) => {
          const interactiveTarget = event.target?.closest?.('button, a');
          if (interactiveTarget) return;
          const mediaTarget = event.target?.closest?.('img, video');
          if (mediaTarget) {
            if (!activePreviewIsVideo) togglePreviewChrome();
            return;
          }
          onClose?.();
        }}
      >
        {canStepPreview && previewChromeActive ? (
          <>
            <IconButton
              aria-label="Предыдущее вложение"
              data-testid="chat-attachment-preview-prev"
              onClick={() => {
                stepPreview(-1);
                bumpPreviewChromeVisibility();
              }}
              sx={{
                position: 'absolute',
                left: { xs: 10, md: 18 },
                top: '50%',
                transform: 'translateY(-50%)',
                zIndex: 4,
                color: '#fff',
                bgcolor: 'transparent',
                textShadow: '0 1px 12px rgba(0,0,0,0.66)',
                '&:hover': { bgcolor: alpha('#ffffff', 0.1) },
              }}
            >
              <ChevronLeftRoundedIcon />
            </IconButton>
            <IconButton
              aria-label="Следующее вложение"
              data-testid="chat-attachment-preview-next"
              onClick={() => {
                stepPreview(1);
                bumpPreviewChromeVisibility();
              }}
              sx={{
                position: 'absolute',
                right: { xs: 10, md: 18 },
                top: '50%',
                transform: 'translateY(-50%)',
                zIndex: 4,
                color: '#fff',
                bgcolor: 'transparent',
                textShadow: '0 1px 12px rgba(0,0,0,0.66)',
                '&:hover': { bgcolor: alpha('#ffffff', 0.1) },
              }}
            >
              <ChevronRightRoundedIcon />
            </IconButton>
          </>
        ) : null}
        <AnimatePresence initial={false} mode="wait">
          {activePreviewUrl ? (
            <Box
              component={motion.div}
              key={`${activePreviewItem?.id || activePreviewUrl}-${activePreviewIsVideo ? 'video' : 'image'}`}
              initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.975 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.985 }}
              transition={{ duration: prefersReducedMotion ? 0.12 : 0.18, ease: 'easeOut' }}
              drag={canStepPreview && !activePreviewIsVideo ? 'x' : false}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.18}
              onDragStart={() => bumpPreviewChromeVisibility(true)}
              onDragEnd={(_, info) => {
                const offsetX = Number(info?.offset?.x || 0);
                const velocityX = Number(info?.velocity?.x || 0);
                if (Math.abs(offsetX) > 72 || Math.abs(velocityX) > 540) {
                  stepPreview(offsetX < 0 ? 1 : -1);
                  bumpPreviewChromeVisibility();
                  return;
                }
                bumpPreviewChromeVisibility(true);
              }}
              sx={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                px: fullScreen ? 0 : { xs: 1.5, md: 4 },
                cursor: canStepPreview && !activePreviewIsVideo ? 'grab' : 'default',
              }}
            >
              {activePreviewIsVideo ? (
                <Box
                  sx={{
                    width: '100%',
                    maxWidth: fullScreen ? '100%' : 'min(1100px, 100%)',
                    maxHeight: fullScreen ? 'calc(100dvh - 96px)' : 'calc(100dvh - 120px)',
                    borderRadius: fullScreen ? 0 : 3,
                    overflow: 'hidden',
                    boxShadow: 'none',
                  }}
                >
                  <video
                    src={activePreviewOriginalUrl || activePreviewUrl}
                    poster={activePreviewPosterUrl || undefined}
                    controls
                    playsInline
                    autoPlay
                    style={{
                      display: 'block',
                      width: '100%',
                      maxWidth: '100%',
                      maxHeight: fullScreen ? 'calc(100dvh - 96px)' : 'calc(100dvh - 120px)',
                      objectFit: 'contain',
                      backgroundColor: 'transparent',
                    }}
                    onPlay={() => bumpPreviewChromeVisibility()}
                    onPause={() => bumpPreviewChromeVisibility(true)}
                  />
                </Box>
              ) : (
                <Box
                  component="img"
                  src={activePreviewUrl}
                  alt={activePreviewItem?.file_name || 'Изображение'}
                  onError={() => {
                    if (activePreviewOriginalUrl && activePreviewUrl !== activePreviewOriginalUrl) {
                      setActivePreviewUrl(activePreviewOriginalUrl);
                    }
                  }}
                  sx={{
                    display: 'block',
                    maxWidth: '100%',
                    maxHeight: fullScreen ? 'calc(100dvh - 96px)' : 'calc(100dvh - 120px)',
                    objectFit: 'contain',
                    borderRadius: 0,
                    boxShadow: 'none',
                  }}
                />
              )}
            </Box>
          ) : null}
        </AnimatePresence>
        {previewChromeActive ? (
          <Box
            data-testid="chat-attachment-preview-bottom-bar"
            sx={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 4,
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              gap: { xs: 1.5, sm: 2 },
              px: { xs: 2, sm: 2.5 },
              pt: { xs: 5, sm: 7 },
              pb: 'max(env(safe-area-inset-bottom), 14px)',
              pointerEvents: 'none',
              background: `linear-gradient(0deg, ${alpha('#000000', 0.42)} 0%, ${alpha('#000000', 0.22)} 46%, ${alpha('#000000', 0)} 100%)`,
            }}
          >
            <Box
              data-testid="chat-attachment-preview-meta"
              sx={{
                minWidth: 0,
                maxWidth: { xs: 'calc(100% - 132px)', sm: '60%' },
                pointerEvents: 'auto',
                textShadow: '0 1px 14px rgba(0,0,0,0.76)',
              }}
            >
              <Typography
                variant="body2"
                sx={{
                  color: '#fff',
                  fontWeight: 700,
                  lineHeight: 1.25,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {previewCountLabel}
              </Typography>
              {previewMetaLine ? (
                <Typography
                  variant="caption"
                  sx={{
                    display: 'block',
                    mt: 0.35,
                    color: alpha('#fff', 0.74),
                    lineHeight: 1.25,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {previewMetaLine}
                </Typography>
              ) : null}
            </Box>
            <Stack
              data-testid="chat-attachment-preview-actions"
              direction="row"
              spacing={0.5}
              sx={{
                flexShrink: 0,
                pointerEvents: 'auto',
              }}
            >
              <IconButton
                component="a"
                href={previewMediaUrl || '#'}
                download={previewDownloadName}
                aria-label="Скачать медиа"
                data-testid="chat-attachment-preview-download"
                disabled={!previewMediaUrl}
                sx={{
                  color: alpha('#fff', 0.9),
                  bgcolor: 'transparent',
                  '&:hover': { bgcolor: alpha('#ffffff', 0.1) },
                  '&.Mui-disabled': { color: alpha('#fff', 0.34) },
                }}
              >
                <DownloadRoundedIcon />
              </IconButton>
              <IconButton
                component="a"
                href={previewMediaUrl || '#'}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Открыть медиа в браузере"
                data-testid="chat-attachment-preview-open"
                disabled={!previewMediaUrl}
                sx={{
                  color: alpha('#fff', 0.9),
                  bgcolor: 'transparent',
                  '&:hover': { bgcolor: alpha('#ffffff', 0.1) },
                  '&.Mui-disabled': { color: alpha('#fff', 0.34) },
                }}
              >
                <OpenInNewRoundedIcon />
              </IconButton>
              <IconButton
                aria-label="Действия с медиа"
                data-testid="chat-attachment-preview-more"
                onClick={handleOpenPreviewMenu}
                sx={{
                  color: alpha('#fff', 0.9),
                  bgcolor: 'transparent',
                  '&:hover': { bgcolor: alpha('#ffffff', 0.1) },
                }}
              >
                <MoreHorizRoundedIcon />
              </IconButton>
            </Stack>
          </Box>
        ) : null}
      </DialogContent>
      <Menu
        anchorEl={previewMenuAnchorEl}
        open={previewMenuOpen}
        onClose={handleClosePreviewMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: {
              mt: 0.5,
              minWidth: 220,
              borderRadius: 3,
              bgcolor: alpha('#0f172a', 0.98),
              color: '#fff',
              border: `1px solid ${alpha('#fff', 0.08)}`,
              backdropFilter: 'blur(20px)',
              boxShadow: '0 22px 64px rgba(2, 6, 23, 0.56)',
            },
          },
        }}
      >
        <MenuItem
          component="a"
          href={previewMediaUrl || '#'}
          download={previewDownloadName}
          disabled={!previewMediaUrl}
          onClick={handleClosePreviewMenu}
          sx={{ gap: 1.25, py: 1.15, fontWeight: 700 }}
        >
          <DownloadRoundedIcon fontSize="small" />
          Скачать
        </MenuItem>
        <MenuItem
          component="a"
          href={previewMediaUrl || '#'}
          target="_blank"
          rel="noopener noreferrer"
          disabled={!previewMediaUrl}
          onClick={handleClosePreviewMenu}
          sx={{ gap: 1.25, py: 1.15, fontWeight: 700 }}
        >
          <OpenInNewRoundedIcon fontSize="small" />
          Открыть в браузере
        </MenuItem>
      </Menu>
    </Dialog>
  );
}
