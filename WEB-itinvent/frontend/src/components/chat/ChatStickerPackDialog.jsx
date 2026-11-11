import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  IconButton,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';

import { chatStickersAPI } from '../../api/chatStickers';
import ChatStickerThumbnail from './ChatStickerThumbnail';

const getApiError = (error, fallback) => String(
  error?.response?.data?.detail
  || error?.message
  || fallback,
).trim();

export default function ChatStickerPackDialog({ open, shortName, theme, ui, onClose }) {
  const normalizedShortName = String(shortName || '').trim();
  const [pack, setPack] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  useEffect(() => {
    if (!open || !normalizedShortName) return undefined;
    const controller = new AbortController();
    setPack(null);
    setLoading(true);
    setLoadError('');
    setAddError('');
    chatStickersAPI.previewPack(normalizedShortName, { signal: controller.signal })
      .then((payload) => {
        if (!controller.signal.aborted) setPack(payload || null);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setLoadError(getApiError(error, 'Не удалось открыть набор стикеров.'));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [normalizedShortName, open]);

  const stickers = useMemo(
    () => (Array.isArray(pack?.stickers) ? pack.stickers : []),
    [pack?.stickers],
  );
  const accent = ui?.accentText || theme.palette.primary.main;
  const panelBg = ui?.panelBg || theme.palette.background.paper;
  const border = ui?.borderSoft || alpha(theme.palette.common.white, 0.1);

  const handleAdd = async () => {
    if (!pack || pack.is_added || adding) return;
    setAdding(true);
    setAddError('');
    try {
      const payload = await chatStickersAPI.importPack(pack.short_name);
      const installedPack = (Array.isArray(payload?.items) ? payload.items : []).find(
        (item) => String(item?.short_name || '').toLowerCase() === pack.short_name.toLowerCase(),
      );
      setPack((current) => ({ ...current, ...(installedPack || {}), is_added: true }));
      window.dispatchEvent(new CustomEvent('chat-sticker-packs-changed'));
    } catch (error) {
      setAddError(getApiError(error, 'Не удалось добавить набор стикеров.'));
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog
      open={Boolean(open)}
      onClose={adding ? undefined : onClose}
      aria-labelledby="chat-sticker-pack-dialog-title"
      scroll="paper"
      fullWidth
      maxWidth="xs"
      PaperProps={{
        sx: {
          width: 'min(420px, calc(100vw - 24px))',
          maxHeight: 'calc(100dvh - 24px)',
          m: 1.5,
          borderRadius: 3,
          bgcolor: panelBg,
          backgroundImage: 'none',
          border: `1px solid ${border}`,
          overflow: 'hidden',
        },
      }}
    >
      <Box
        sx={{
          minHeight: 66,
          px: 2,
          py: 1.4,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          borderBottom: `1px solid ${border}`,
        }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            id="chat-sticker-pack-dialog-title"
            sx={{ fontSize: 17, fontWeight: 800, lineHeight: 1.25, color: ui?.textPrimary || theme.palette.text.primary }}
          >
            {pack?.title || 'Набор стикеров'}
          </Typography>
          <Typography sx={{ mt: 0.25, fontSize: 12.5, color: ui?.textSecondary || theme.palette.text.secondary }}>
            @{pack?.short_name || normalizedShortName}
          </Typography>
        </Box>
        <IconButton aria-label="Закрыть" onClick={onClose} disabled={adding} sx={{ color: ui?.textSecondary || theme.palette.text.secondary }}>
          <CloseRoundedIcon />
        </IconButton>
      </Box>

      <DialogContent sx={{ p: 1.5, minHeight: 230, bgcolor: panelBg }}>
        {loading ? (
          <Box sx={{ minHeight: 210, display: 'grid', placeItems: 'center' }}>
            <CircularProgress size={28} aria-label="Загрузка набора стикеров" />
          </Box>
        ) : loadError ? (
          <Alert severity="error">{loadError}</Alert>
        ) : (
          <Box
            data-testid="chat-sticker-pack-grid"
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: 0.75,
              alignItems: 'start',
            }}
          >
            {stickers.map((sticker) => (
              <Box
                key={sticker.id}
                sx={{
                  minWidth: 0,
                  aspectRatio: '1 / 1',
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: 2,
                  bgcolor: alpha(theme.palette.common.white, 0.025),
                  overflow: 'hidden',
                }}
              >
                <ChatStickerThumbnail sticker={sticker} size={82} staticOnly />
              </Box>
            ))}
          </Box>
        )}
        {addError ? <Alert severity="error" sx={{ mt: 1 }}>{addError}</Alert> : null}
      </DialogContent>

      <DialogActions sx={{ px: 1.5, py: 1.25, gap: 0.5, borderTop: `1px solid ${border}` }}>
        <Button onClick={onClose} disabled={adding} sx={{ textTransform: 'none', color: ui?.textSecondary || theme.palette.text.secondary }}>
          Отмена
        </Button>
        <Button
          variant="contained"
          onClick={handleAdd}
          disabled={loading || Boolean(loadError) || !pack || pack.is_added || adding}
          startIcon={adding ? <CircularProgress size={16} color="inherit" /> : (pack?.is_added ? <CheckRoundedIcon /> : <AddRoundedIcon />)}
          sx={{ minHeight: 40, px: 2, textTransform: 'none', bgcolor: accent }}
        >
          {adding ? 'Добавляем…' : (pack?.is_added ? 'Набор добавлен' : 'Добавить набор')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
