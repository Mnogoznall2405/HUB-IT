import { useEffect, useMemo, useState } from 'react';
import { Box } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded';

import {
  avatarLabel,
  buildAttachmentUrl,
  formatFileSize,
  formatFullDate,
  getPriorityMeta,
  getStatusMeta,
  getTaskAssignee,
  isImageAttachment,
  isVideoAttachment,
  normalizeChatAttachmentUrl,
} from './chatHelpers';

const FILE_EXTENSION_COLORS = {
  pdf: '#e53935',
  xls: '#43a047',
  xlsx: '#43a047',
  csv: '#43a047',
  doc: '#1e88e5',
  docx: '#1e88e5',
  zip: '#f9a825',
  rar: '#f9a825',
  '7z': '#f9a825',
};

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'm4v']);
const EMPTY_URL_LIST = [];

const clampFileName = (value, maxLength = 28) => {
  const normalized = String(value || '').trim();
  if (!normalized) return 'Файл';
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
};

const getExtensionFromFileName = (fileName) => {
  const normalized = String(fileName || '').trim();
  if (!normalized.includes('.')) return '';
  return normalized.split('.').pop().toLowerCase();
};

const resolveAttachmentKind = ({ fileName, fileType, mimeType }) => {
  const normalizedExtension = getExtensionFromFileName(fileName);
  const normalizedMimeType = String(mimeType || '').trim().toLowerCase();
  const normalizedFileType = String(fileType || '').trim().toLowerCase();
  if (normalizedMimeType.startsWith('image/') || IMAGE_EXTENSIONS.has(normalizedExtension) || normalizedFileType === 'image') return 'image';
  if (normalizedMimeType.startsWith('video/') || VIDEO_EXTENSIONS.has(normalizedExtension) || normalizedFileType === 'video') return 'video';
  return 'file';
};

const resolveFileAccent = (extension) => FILE_EXTENSION_COLORS[String(extension || '').toLowerCase()] || '#708fa0';

const getDisplayExtension = (fileName, mimeType) => {
  const extension = getExtensionFromFileName(fileName);
  if (extension) return extension.toUpperCase();
  const normalizedMimeType = String(mimeType || '').trim().toLowerCase();
  if (normalizedMimeType.startsWith('image/')) return 'IMG';
  if (normalizedMimeType.startsWith('video/')) return 'VID';
  return 'FILE';
};

const formatVideoDuration = (value) => {
  const totalSeconds = Math.max(0, Math.floor(Number(value || 0)));
  if (!totalSeconds) return '';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const buildClickableSurfaceStyle = (isOwn, ui, theme) => ({
  display: 'block',
  width: '100%',
  border: `1px solid ${ui.borderSoft || alpha(theme.palette.common.white, 0.08)}`,
  borderRadius: 14,
  backgroundColor: ui.surfaceStrong || ui.composerInputBg || alpha(theme.palette.background.paper, isOwn ? 0.5 : 0.72),
  color: isOwn ? (ui.bubbleOwnText || theme.palette.text.primary) : (ui.bubbleOtherText || theme.palette.text.primary),
  textDecoration: 'none',
  overflow: 'hidden',
  cursor: 'pointer',
  boxShadow: 'none',
  transition: 'transform 100ms ease, opacity 100ms ease, background-color 120ms ease',
});

const compactUrlList = (...items) => {
  const urls = [];
  items.flat().forEach((item) => {
    const normalized = normalizeChatAttachmentUrl(item);
    if (normalized && !urls.includes(normalized)) urls.push(normalized);
  });
  return urls;
};

export function PresenceAvatar({ item, online = false, size = 48, sx = {} }) {
  const label = avatarLabel(item);
  const theme = useTheme();

  return (
    <Box
      sx={{
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
        ...sx,
      }}
    >
      <Box
        sx={(muiTheme) => ({
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          borderRadius: '999px',
          fontSize: '0.875rem',
          fontWeight: 700,
          letterSpacing: '-0.02em',
          bgcolor: muiTheme.palette.mode === 'dark' ? '#445161' : alpha(muiTheme.palette.primary.main, 0.14),
          color: muiTheme.palette.mode === 'dark' ? '#ffffff' : muiTheme.palette.primary.main,
          boxShadow: muiTheme.palette.mode === 'dark'
            ? 'inset 0 1px 0 rgba(255,255,255,0.08)'
            : 'inset 0 1px 0 rgba(255,255,255,0.72)',
        })}
      >
        {label}
      </Box>
      {online ? (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: 14,
            height: 14,
            borderRadius: '999px',
            border: `2px solid ${theme.palette.mode === 'dark' ? '#17212b' : '#ffffff'}`,
            backgroundColor: '#4ade80',
            boxShadow: theme.palette.mode === 'dark' ? '0 0 0 2px rgba(15,23,42,0.16)' : '0 0 0 2px rgba(255,255,255,0.65)',
          }}
        />
      ) : null}
    </Box>
  );
}

export function TaskShareCard({ task, navigate, ui, theme }) {
  const statusMeta = getStatusMeta(task?.status);
  const priorityMeta = getPriorityMeta(task?.priority);
  const handleOpenTask = () => {
    navigate(`/tasks?task=${encodeURIComponent(task.id)}&task_tab=comments`);
  };

  const handleTaskKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleOpenTask();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleOpenTask}
      onKeyDown={handleTaskKeyDown}
      style={{
        width: '100%',
        borderRadius: 14,
        border: `1px solid ${ui.borderSoft || alpha(theme.palette.primary.main, 0.12)}`,
        padding: 12,
        textAlign: 'left',
        backgroundColor: ui.surfaceStrong || ui.composerInputBg || alpha(theme.palette.primary.main, 0.08),
        color: ui.bubbleOtherText,
        cursor: 'pointer',
        transition: 'transform 100ms ease, opacity 100ms ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div
          style={{
            width: 40,
            height: 40,
            flexShrink: 0,
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: alpha(theme.palette.primary.main, 0.14),
            color: theme.palette.primary.main,
          }}
        >
          <TaskAltRoundedIcon fontSize="small" />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: ui.textSecondary }}>
            Поделились задачей
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 15, fontWeight: 600, lineHeight: 1.35, color: ui.textStrong || theme.palette.text.primary }}>
            {task.title}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            <span style={{ color: statusMeta[1], backgroundColor: statusMeta[2], borderRadius: 999, padding: '4px 10px', fontSize: 11, fontWeight: 700 }}>{statusMeta[0]}</span>
            <span style={{ color: priorityMeta[1], backgroundColor: priorityMeta[2], borderRadius: 999, padding: '4px 10px', fontSize: 11, fontWeight: 700 }}>{priorityMeta[0]}</span>
            {task?.is_overdue ? (
              <span style={{ color: '#fca5a5', backgroundColor: 'rgba(239,68,68,0.16)', borderRadius: 999, padding: '4px 10px', fontSize: 11, fontWeight: 700 }}>
                Просрочено
              </span>
            ) : null}
          </div>
          <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.45, color: ui.textSecondary }}>
            <div>Исполнитель: {getTaskAssignee(task)}</div>
            <div>Срок: {task?.due_at ? formatFullDate(task.due_at) : 'Без срока'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FileAttachment({
  fileName,
  fileSize,
  fileUrl,
  openUrl,
  posterUrl,
  fileType,
  mimeType,
  theme,
  ui,
  isOwn = false,
  onOpenPreview,
  previewWidth,
  previewHeight,
  durationSeconds,
  mediaMaxWidth = 300,
  mediaMaxHeight = null,
  mediaMinWidth = 0,
  forcedAspectRatio = '',
  fallbackFileUrls = EMPTY_URL_LIST,
}) {
  const resolvedOpenUrl = String(openUrl || fileUrl || '').trim();
  const [resolvedDuration, setResolvedDuration] = useState(() => formatVideoDuration(durationSeconds));
  const [isHovered, setIsHovered] = useState(false);
  const attachmentKind = useMemo(
    () => resolveAttachmentKind({ fileName, fileType, mimeType }),
    [fileName, fileType, mimeType],
  );
  const extension = getExtensionFromFileName(fileName);
  const extensionLabel = getDisplayExtension(fileName, mimeType);
  const accentColor = resolveFileAccent(extension);
  const surfaceStyle = buildClickableSurfaceStyle(isOwn, ui, theme);
  const titleText = clampFileName(fileName);
  const subtitleLabel = `${extensionLabel} • ${formatFileSize(fileSize)}`;
  const numericAspectRatio = Number(previewWidth || 0) > 0 && Number(previewHeight || 0) > 0
    ? Number(previewWidth) / Number(previewHeight)
    : (attachmentKind === 'video' ? (16 / 9) : (4 / 3));
  const aspectRatio = String(forcedAspectRatio || '').trim() || (Number(previewWidth || 0) > 0 && Number(previewHeight || 0) > 0
    ? `${Number(previewWidth)} / ${Number(previewHeight)}`
    : (attachmentKind === 'video' ? '16 / 9' : '4 / 3'));
  const hasNumericMediaMaxWidth = typeof mediaMaxWidth === 'number' && Number.isFinite(mediaMaxWidth);
  const hasNumericMediaMaxHeight = typeof mediaMaxHeight === 'number' && Number.isFinite(mediaMaxHeight);
  const hasNumericMediaMinWidth = typeof mediaMinWidth === 'number' && Number.isFinite(mediaMinWidth) && mediaMinWidth > 0;
  const maxWidthValue = hasNumericMediaMaxWidth ? mediaMaxWidth : Number.POSITIVE_INFINITY;
  const minWidthValue = hasNumericMediaMinWidth ? mediaMinWidth : 0;
  const rawConstrainedMediaWidth = hasNumericMediaMaxHeight
    ? Math.min(maxWidthValue, mediaMaxHeight * numericAspectRatio)
    : (hasNumericMediaMaxWidth ? mediaMaxWidth : null);
  const constrainedMediaWidth = rawConstrainedMediaWidth !== null
    ? Math.min(maxWidthValue, Math.max(minWidthValue, rawConstrainedMediaWidth))
    : null;
  const mediaSurfaceStyle = {
    ...surfaceStyle,
    width: constrainedMediaWidth ? `${Math.round(constrainedMediaWidth)}px` : (hasNumericMediaMaxWidth ? `${mediaMaxWidth}px` : '100%'),
    maxWidth: hasNumericMediaMaxWidth ? `${mediaMaxWidth}px` : mediaMaxWidth,
    minWidth: hasNumericMediaMinWidth ? `${mediaMinWidth}px` : undefined,
    padding: 0,
    border: 'none',
    backgroundColor: 'transparent',
    boxShadow: '0 10px 22px rgba(2, 6, 23, 0.18)',
  };
  const imageSourceCandidates = useMemo(
    () => compactUrlList(fileUrl, fallbackFileUrls, resolvedOpenUrl),
    [fallbackFileUrls, fileUrl, resolvedOpenUrl],
  );
  const [activeImageUrl, setActiveImageUrl] = useState(() => imageSourceCandidates[0] || String(fileUrl || '').trim());
  const [failedUrls, setFailedUrls] = useState(new Set());

  useEffect(() => {
    setActiveImageUrl(imageSourceCandidates[0] || String(fileUrl || '').trim());
    setFailedUrls(new Set());
  }, [fileUrl, imageSourceCandidates]);

  if (attachmentKind === 'image') {
    const handleOpenImage = (event) => {
      if (typeof onOpenPreview !== 'function') return;
      event.preventDefault();
      onOpenPreview?.();
    };

    const handleImageError = () => {
      const currentUrl = String(activeImageUrl || '').trim();
      const newFailedUrls = new Set(failedUrls);
      newFailedUrls.add(currentUrl);
      setFailedUrls(newFailedUrls);

      // Find next URL that hasn't failed yet
      const currentIndex = imageSourceCandidates.findIndex((candidate) => candidate === currentUrl);
      const nextUrl = imageSourceCandidates.find((candidate, index) =>
        index > currentIndex && !newFailedUrls.has(candidate)
      );

      if (nextUrl) {
        console.warn(`Image load failed for ${currentUrl}, trying fallback: ${nextUrl}`);
        setActiveImageUrl(nextUrl);
      } else {
        console.error(`All image URLs failed for attachment. Last attempt: ${currentUrl}`);
      }
    };

    const content = (
      <img
        src={activeImageUrl || fileUrl}
        alt={String(fileName || 'image')}
        loading="lazy"
        decoding="async"
        onError={handleImageError}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          backgroundColor: ui.mediaPlaceholderBg || 'rgba(255,255,255,0.04)',
        }}
      />
    );

    return typeof onOpenPreview === 'function' ? (
      <button
        type="button"
        onClick={handleOpenImage}
        aria-label={`Открыть изображение ${fileName}`}
        style={{
          ...mediaSurfaceStyle,
          appearance: 'none',
        }}
      >
        <div
          style={{
            width: '100%',
            aspectRatio,
            maxHeight: hasNumericMediaMaxHeight ? `${mediaMaxHeight}px` : mediaMaxHeight,
            overflow: 'hidden',
            borderRadius: 13,
            border: `1px solid ${ui.mediaBorder || alpha(theme.palette.common.white, 0.08)}`,
            backgroundColor: ui.mediaPlaceholderBg || 'rgba(255,255,255,0.04)',
          }}
        >
          {content}
        </div>
      </button>
    ) : (
      <a
        href={resolvedOpenUrl}
        target="_blank"
        rel="noreferrer"
        aria-label={`Открыть изображение ${fileName}`}
        style={mediaSurfaceStyle}
      >
        <div
          style={{
            width: '100%',
            aspectRatio,
            maxHeight: hasNumericMediaMaxHeight ? `${mediaMaxHeight}px` : mediaMaxHeight,
            overflow: 'hidden',
            borderRadius: 13,
            border: `1px solid ${ui.mediaBorder || alpha(theme.palette.common.white, 0.08)}`,
            backgroundColor: ui.mediaPlaceholderBg || 'rgba(255,255,255,0.04)',
          }}
        >
          {content}
        </div>
      </a>
    );
  }

  if (attachmentKind === 'video' && typeof onOpenPreview === 'function') {
    const handleOpenVideo = (event) => {
      event.preventDefault();
      onOpenPreview?.();
    };

    return (
      <button
        type="button"
        onClick={handleOpenVideo}
        aria-label={`Открыть видео ${fileName}`}
        style={{
          ...mediaSurfaceStyle,
          appearance: 'none',
        }}
      >
        <div
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio,
            maxHeight: hasNumericMediaMaxHeight ? `${mediaMaxHeight}px` : mediaMaxHeight,
            overflow: 'hidden',
            borderRadius: 13,
            border: `1px solid ${ui.mediaBorder || alpha(theme.palette.common.white, 0.08)}`,
            backgroundColor: 'rgba(3,8,20,0.72)',
          }}
        >
          {posterUrl ? (
            <img
              src={posterUrl}
              alt={String(fileName || 'video')}
              loading="lazy"
              decoding="async"
              style={{
                display: 'block',
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                filter: 'brightness(0.84)',
              }}
            />
          ) : (
            <video
              src={fileUrl}
              preload="metadata"
              muted
              playsInline
              onLoadedMetadata={(event) => {
                if (!resolvedDuration) {
                  setResolvedDuration(formatVideoDuration(event.currentTarget.duration));
                }
              }}
              style={{
                display: 'block',
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                filter: 'brightness(0.84)',
              }}
            />
          )}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                width: 54,
                height: 54,
                borderRadius: '999px',
                backgroundColor: 'rgba(15,23,42,0.58)',
                boxShadow: '0 10px 26px rgba(2,6,23,0.32)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: 24,
                paddingLeft: 3,
              }}
            >
              в–¶
            </div>
          </div>
          {resolvedDuration ? (
            <div
              style={{
                position: 'absolute',
                right: 10,
                bottom: 10,
                borderRadius: 999,
                backgroundColor: 'rgba(2,6,23,0.72)',
                color: '#fff',
                padding: '4px 8px',
                fontSize: 11,
                fontWeight: 700,
                lineHeight: 1,
              }}
            >
              {resolvedDuration}
            </div>
          ) : null}
        </div>
      </button>
    );
  }

  if (attachmentKind === 'video') {
    return (
      <a
        href={resolvedOpenUrl}
        target="_blank"
        rel="noreferrer"
        aria-label={`Открыть видео ${fileName}`}
        style={mediaSurfaceStyle}
      >
        <div
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio,
            maxHeight: hasNumericMediaMaxHeight ? `${mediaMaxHeight}px` : mediaMaxHeight,
            overflow: 'hidden',
            borderRadius: 13,
            border: `1px solid ${ui.mediaBorder || alpha(theme.palette.common.white, 0.08)}`,
            backgroundColor: 'rgba(3,8,20,0.72)',
          }}
        >
          {posterUrl ? (
            <img
              src={posterUrl}
              alt={String(fileName || 'video')}
              loading="lazy"
              decoding="async"
              style={{
                display: 'block',
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                filter: 'brightness(0.84)',
              }}
            />
          ) : (
            <video
              src={fileUrl}
              preload="metadata"
              muted
              playsInline
              onLoadedMetadata={(event) => {
                if (!resolvedDuration) {
                  setResolvedDuration(formatVideoDuration(event.currentTarget.duration));
                }
              }}
              style={{
                display: 'block',
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                filter: 'brightness(0.84)',
              }}
            />
          )}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                width: 54,
                height: 54,
                borderRadius: '999px',
                backgroundColor: 'rgba(15,23,42,0.58)',
                boxShadow: '0 10px 26px rgba(2,6,23,0.32)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: 24,
                paddingLeft: 3,
              }}
            >
              ▶
            </div>
          </div>
          {resolvedDuration ? (
            <div
              style={{
                position: 'absolute',
                right: 10,
                bottom: 10,
                borderRadius: 999,
                backgroundColor: 'rgba(2,6,23,0.72)',
                color: '#fff',
                padding: '4px 8px',
                fontSize: 11,
                fontWeight: 700,
                lineHeight: 1,
              }}
            >
              {resolvedDuration}
            </div>
          ) : null}
        </div>
      </a>
    );
  }

  return (
    <a
      href={resolvedOpenUrl}
      target="_blank"
      rel="noreferrer"
      title={String(fileName || 'Файл')}
      aria-label={`Открыть файл ${fileName}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsHovered(true)}
      onBlur={() => setIsHovered(false)}
      style={{
        ...surfaceStyle,
        padding: 10,
        position: 'relative',
        boxShadow: isHovered ? '0 12px 28px rgba(2, 6, 23, 0.22)' : 'none',
        backgroundColor: isHovered
          ? (ui.fileHoverBg || alpha(theme.palette.common.white, 0.07))
          : surfaceStyle.backgroundColor,
      }}
    >
      <div
        data-testid="chat-file-attachment-overlay"
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          width: 28,
          height: 28,
          borderRadius: '999px',
          backgroundColor: ui.fileOverlayBg || alpha('#020617', 0.54),
          border: `1px solid ${ui.mediaBorder || alpha(theme.palette.common.white, 0.08)}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'rgba(255,255,255,0.86)',
          opacity: isHovered ? 1 : 0,
          transform: isHovered ? 'scale(1)' : 'scale(0.92)',
          transition: 'opacity 120ms ease, transform 120ms ease',
          pointerEvents: 'none',
        }}
      >
        <OpenInNewRoundedIcon sx={{ fontSize: 16 }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <div
          style={{
            width: 46,
            height: 46,
            flexShrink: 0,
            borderRadius: '999px',
            backgroundColor: alpha(accentColor, 0.18),
            color: accentColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            boxShadow: `inset 0 0 0 1px ${alpha(accentColor, 0.22)}`,
          }}
        >
          {extensionLabel}
        </div>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              lineHeight: 1.35,
              color: ui.textStrong || theme.palette.text.primary,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {titleText}
          </div>
          <div
            style={{
              marginTop: 3,
              fontSize: 12,
              lineHeight: 1.2,
              color: ui.textSecondary,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {subtitleLabel}
          </div>
        </div>
      </div>
    </a>
  );
}

export function AttachmentCard({ messageId, attachment, theme, ui, onOpenPreview, isOwn = false }) {
  const normalizedMessageId = String(messageId || '').trim();
  const attachmentId = String(attachment?.id || '').trim();
  const canBuildAttachmentUrl = Boolean(normalizedMessageId && attachmentId);
  const directOriginalUrl = normalizeChatAttachmentUrl(attachment?.original_url || attachment?.originalUrl || attachment?.fileUrl);
  const directOpenUrl = normalizeChatAttachmentUrl(attachment?.open_url || attachment?.openUrl);
  const directPreviewUrl = normalizeChatAttachmentUrl(attachment?.preview_url || attachment?.previewUrl);
  const directPosterUrl = normalizeChatAttachmentUrl(attachment?.poster_url || attachment?.posterUrl);
  const inlineOriginalUrl = canBuildAttachmentUrl ? buildAttachmentUrl(normalizedMessageId, attachmentId, { inline: true }) : '';
  const downloadOriginalUrl = canBuildAttachmentUrl ? buildAttachmentUrl(normalizedMessageId, attachmentId) : '';
  const originalUrl = directOriginalUrl || downloadOriginalUrl || inlineOriginalUrl;
  const openUrl = directOpenUrl || directOriginalUrl || inlineOriginalUrl || downloadOriginalUrl;
  const variantUrls = attachment?.variant_urls || {};
  const thumbUrl = normalizeChatAttachmentUrl(variantUrls.thumb);
  const previewUrl = normalizeChatAttachmentUrl(variantUrls.preview);
  const fileUrl = isImageAttachment(attachment)
    ? (directPreviewUrl || thumbUrl || previewUrl || openUrl || originalUrl)
    : (isVideoAttachment(attachment) ? (directPreviewUrl || previewUrl || openUrl || originalUrl) : openUrl);
  const posterUrl = isVideoAttachment(attachment) ? (directPosterUrl || normalizeChatAttachmentUrl(variantUrls.poster)) : '';
  const fallbackFileUrls = useMemo(
    () => compactUrlList(previewUrl, thumbUrl, openUrl, inlineOriginalUrl, originalUrl, downloadOriginalUrl),
    [downloadOriginalUrl, inlineOriginalUrl, openUrl, originalUrl, previewUrl, thumbUrl],
  );
  const previewable = isImageAttachment(attachment)
    || resolveAttachmentKind({
      fileName: attachment?.file_name,
      mimeType: attachment?.mime_type,
      fileType: attachment?.file_type,
    }) === 'video';
  return (
    <FileAttachment
      fileName={attachment?.file_name}
      fileSize={attachment?.file_size}
      fileUrl={fileUrl}
      openUrl={openUrl}
      posterUrl={posterUrl}
      mimeType={attachment?.mime_type}
      fileType={attachment?.file_type}
      theme={theme}
      ui={ui}
      isOwn={isOwn}
      onOpenPreview={previewable && typeof onOpenPreview === 'function'
        ? () => onOpenPreview(messageId, attachment)
        : undefined}
      previewWidth={attachment?.width}
      previewHeight={attachment?.height}
      durationSeconds={attachment?.duration_seconds}
      mediaMaxWidth={attachment?.mediaMaxWidth}
      mediaMaxHeight={attachment?.mediaMaxHeight}
      mediaMinWidth={attachment?.mediaMinWidth}
      forcedAspectRatio={attachment?.forcedAspectRatio}
      fallbackFileUrls={fallbackFileUrls}
    />
  );
}
