import { memo, useEffect, useState } from 'react';
import { Box } from '@mui/material';

import ChatStickerMedia from './ChatStickerMedia';

const ChatStickerThumbnail = memo(function ChatStickerThumbnail({ sticker, size, staticOnly = false }) {
  const [previewFailed, setPreviewFailed] = useState(false);
  const normalizedFormat = String(sticker?.format || '').trim().toLowerCase();
  const normalizedMimeType = String(sticker?.mime_type || '').trim().toLowerCase();
  const needsPausedAnimatedFallback = (
    normalizedFormat === 'animated'
    || normalizedFormat === 'video'
    || normalizedMimeType === 'application/x-tgsticker'
    || normalizedMimeType.startsWith('video/')
  );

  useEffect(() => {
    setPreviewFailed(false);
  }, [sticker?.preview_url]);

  if (sticker?.preview_url && !previewFailed) {
    return (
      <Box
        component="img"
        data-testid="chat-sticker-preview-image"
        src={sticker.preview_url}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setPreviewFailed(true)}
        sx={{
          width: size,
          maxWidth: '100%',
          aspectRatio: '1 / 1',
          display: 'block',
          objectFit: 'contain',
        }}
      />
    );
  }

  if (staticOnly && needsPausedAnimatedFallback) {
    return (
      <ChatStickerMedia
        src={sticker?.file_url}
        mimeType={sticker?.mime_type}
        emoji={sticker?.emoji}
        decorative
        autoPlay={false}
        size={size}
      />
    );
  }

  if (staticOnly) {
    return (
      <Box
        data-testid="chat-sticker-thumbnail-placeholder"
        aria-hidden="true"
        sx={{
          width: size,
          maxWidth: '100%',
          aspectRatio: '1 / 1',
          display: 'grid',
          placeItems: 'center',
          fontSize: Math.max(20, Math.round(Number(size || 64) * 0.38)),
          lineHeight: 1,
          opacity: 0.72,
        }}
      >
        {sticker?.emoji || '◌'}
      </Box>
    );
  }

  return (
    <ChatStickerMedia
      src={sticker?.file_url}
      mimeType={sticker?.mime_type}
      emoji={sticker?.emoji}
      decorative
      size={size}
    />
  );
});

export default ChatStickerThumbnail;
