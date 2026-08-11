import { useCallback, useState } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';

const getDraggedItemsLabel = (dataTransfer) => {
  const fileItems = Array.from(dataTransfer?.items || []).filter((item) => item?.kind === 'file');
  if (fileItems.length === 0) return 'файлы';
  const mimeTypes = fileItems.map((item) => String(item?.type || '').toLowerCase()).filter(Boolean);
  if (mimeTypes.length !== fileItems.length) return 'файлы';
  if (mimeTypes.every((mimeType) => mimeType.startsWith('image/'))) return 'фотографии';
  if (mimeTypes.every((mimeType) => mimeType.startsWith('image/') || mimeType.startsWith('video/'))) {
    return 'фото и видео';
  }
  return 'файлы';
};

function DropZone({ active, description, label, onDragEnter, onDrop, testId, tokens }) {
  return (
    <Box
      role="region"
      aria-label={`${label}: ${description}`}
      data-testid={testId}
      onDragEnter={onDragEnter}
      onDrop={onDrop}
      sx={{
        minHeight: 0,
        display: 'grid',
        placeItems: 'center',
        px: { xs: 2, sm: 4 },
        py: { xs: 2.5, sm: 4 },
        borderRadius: { xs: '10px', sm: '12px' },
        bgcolor: active ? tokens.activeSurface : tokens.surface,
        color: active ? tokens.activeText : tokens.text,
        outline: `2px solid ${active ? tokens.activeOutline : tokens.outline}`,
        outlineOffset: '-2px',
        boxShadow: active ? tokens.activeShadow : tokens.shadow,
        transform: active ? 'scale(1)' : 'scale(0.995)',
        transitionProperty: 'background-color, color, box-shadow, outline-color, transform',
        transitionDuration: '130ms',
        transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
        '@media (prefers-reduced-motion: reduce)': {
          transform: 'none',
          transitionProperty: 'background-color, color, outline-color',
        },
      }}
    >
      <Stack spacing={{ xs: 0.55, sm: 0.8 }} alignItems="center" sx={{ textAlign: 'center' }}>
        <Typography
          component="div"
          sx={{
            color: 'inherit',
            fontSize: { xs: 'clamp(1.15rem, 5vw, 1.45rem)', sm: 'clamp(1.35rem, 2.5vw, 1.85rem)' },
            fontWeight: 500,
            lineHeight: 1.22,
            textWrap: 'balance',
          }}
        >
          {label}
        </Typography>
        <Typography
          component="div"
          sx={{
            color: 'inherit',
            fontSize: { xs: '0.95rem', sm: 'clamp(1rem, 1.7vw, 1.25rem)' },
            fontWeight: 400,
            lineHeight: 1.3,
            opacity: active ? 0.94 : 0.82,
            textWrap: 'balance',
          }}
        >
          {description}
        </Typography>
      </Stack>
    </Box>
  );
}

export default function ChatFileDropOverlay({
  compactMobile = false,
  onDragLeave,
  onDragOver,
  onDrop,
  theme,
  ui = {},
}) {
  const [activeZone, setActiveZone] = useState('quick');
  const [itemsLabel, setItemsLabel] = useState('фотографии');
  const dark = theme?.palette?.mode === 'dark';
  const accent = ui.accentText || (dark ? '#64b5f6' : '#3390ec');
  const baseSurface = ui.panelBg || ui.composerBg || (dark ? '#17212b' : '#ffffff');
  const baseText = dark ? alpha('#8fb5da', 0.82) : alpha('#315b80', 0.78);
  const tokens = {
    activeOutline: alpha(accent, dark ? 0.52 : 0.42),
    activeShadow: `0 18px 44px ${alpha('#020617', dark ? 0.34 : 0.16)}`,
    activeSurface: alpha(baseSurface, dark ? 0.995 : 0.985),
    activeText: accent,
    outline: alpha(accent, dark ? 0.12 : 0.14),
    shadow: `0 12px 32px ${alpha('#020617', dark ? 0.25 : 0.1)}`,
    surface: alpha(baseSurface, dark ? 0.965 : 0.955),
    text: baseText,
  };

  const handleDragOver = useCallback((event) => {
    if (!event?.dataTransfer?.types?.includes?.('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setItemsLabel(getDraggedItemsLabel(event.dataTransfer));
    onDragOver?.(event);
  }, [onDragOver]);

  const handleDrop = useCallback((sendMediaAsFiles) => (event) => {
    event.preventDefault();
    event.stopPropagation();
    onDrop?.(event, { sendMediaAsFiles });
  }, [onDrop]);

  const itemTitle = `Перетащите сюда ${itemsLabel}`;

  return (
    <Box
      role="status"
      aria-live="polite"
      aria-label="Выберите способ отправки перетаскиваемых файлов"
      data-testid="chat-file-drop-overlay"
      onDragLeave={onDragLeave}
      onDragOver={handleDragOver}
      sx={{
        position: 'absolute',
        inset: 0,
        zIndex: 8,
        display: 'grid',
        gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr)',
        gap: { xs: 1, sm: 1.5 },
        p: compactMobile ? 1 : { xs: 1.25, md: 2 },
        bgcolor: alpha(ui.threadBg || '#0e1621', dark ? 0.3 : 0.2),
        backdropFilter: 'blur(2px)',
        overscrollBehavior: 'contain',
      }}
    >
      <DropZone
        active={activeZone === 'file'}
        description="для отправки их без сжатия"
        label={itemTitle}
        onDragEnter={() => setActiveZone('file')}
        onDrop={handleDrop(true)}
        testId="chat-file-drop-as-file"
        tokens={tokens}
      />
      <DropZone
        active={activeZone === 'quick'}
        description="для быстрой отправки"
        label={itemTitle}
        onDragEnter={() => setActiveZone('quick')}
        onDrop={handleDrop(false)}
        testId="chat-file-drop-quick"
        tokens={tokens}
      />
    </Box>
  );
}
