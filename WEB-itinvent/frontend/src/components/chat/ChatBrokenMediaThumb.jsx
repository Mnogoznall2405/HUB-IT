import { useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import BrokenImageOutlinedIcon from '@mui/icons-material/BrokenImageOutlined';

import { formatFileSize } from './chatHelpers';

export default function ChatBrokenMediaThumb({
  src,
  alt = '',
  fileName = '',
  fileSize,
  onOpen,
  onDownload,
  sx = {},
}) {
  const [failed, setFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const resolvedName = String(fileName || alt || 'Файл').trim() || 'Файл';

  if (failed || !src) {
    return (
      <Box
        data-testid="chat-broken-media-thumb"
        sx={{
          width: '100%',
          height: '100%',
          minHeight: 72,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          px: 0.75,
          bgcolor: 'var(--chat-sheet-panel-cell, rgba(148,163,184,0.16))',
          ...sx,
        }}
      >
        <Stack spacing={0.35} alignItems="center" sx={{ textAlign: 'center', maxWidth: '100%' }}>
          <BrokenImageOutlinedIcon sx={{ fontSize: 22, color: 'text.secondary' }} />
          <Typography sx={{ fontSize: '0.72rem', fontWeight: 700 }} noWrap>
            {resolvedName}
          </Typography>
          {fileSize ? (
            <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>
              {formatFileSize(fileSize)}
            </Typography>
          ) : null}
          <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>
            Не удалось загрузить превью
          </Typography>
          <Stack direction="row" spacing={0.4} useFlexGap flexWrap="wrap" justifyContent="center">
            <Button
              size="small"
              onClick={() => {
                setFailed(false);
                setRetryKey((current) => current + 1);
              }}
              sx={{ minHeight: 32, px: 0.8, textTransform: 'none', fontSize: '0.72rem' }}
            >
              Повторить
            </Button>
            {onOpen ? (
              <Button size="small" onClick={onOpen} sx={{ minHeight: 32, px: 0.8, textTransform: 'none', fontSize: '0.72rem' }}>
                Открыть
              </Button>
            ) : null}
            {onDownload ? (
              <Button size="small" onClick={onDownload} sx={{ minHeight: 32, px: 0.8, textTransform: 'none', fontSize: '0.72rem' }}>
                Скачать
              </Button>
            ) : null}
          </Stack>
        </Stack>
      </Box>
    );
  }

  return (
    <Box
      key={retryKey}
      component="img"
      src={src}
      alt={alt || resolvedName}
      onError={() => setFailed(true)}
      sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', ...sx }}
    />
  );
}
