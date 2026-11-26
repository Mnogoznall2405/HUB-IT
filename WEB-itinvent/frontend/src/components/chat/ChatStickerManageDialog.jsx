import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  IconButton,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DragIndicatorRoundedIcon from '@mui/icons-material/DragIndicatorRounded';
import TelegramIcon from '@mui/icons-material/Telegram';

import { formatRuCount } from '../../lib/ruPlural';
import ChatStickerThumbnail from './ChatStickerThumbnail';

const getApiError = (error, fallback) => String(
  error?.response?.data?.detail
  || error?.message
  || fallback,
).trim();

// «1 стикер», «3 стикера», «5 стикеров» — общий ru-плюрализатор проекта.
const formatStickerCount = (count) => (
  formatRuCount(count, 'стикер', 'стикера', 'стикеров')
);

// «Управление наборами» в духе Telegram Desktop: список установленных
// наборов с обложкой, переходом к секции панели, удалением с инлайн-
// подтверждением и HTML5 drag-and-drop переупорядочиванием. Сам диалог
// глупый — все API-операции живут в пропах-колбэках вкладки стикеров,
// которая владеет packs-состоянием и кэшем.
export default function ChatStickerManageDialog({
  open,
  packs,
  theme,
  ui,
  onClose,
  onOpenPack,
  onRemovePack,
  onReorderPacks,
  onAddPack,
}) {
  const [confirmingPackId, setConfirmingPackId] = useState('');
  const [busyPackId, setBusyPackId] = useState('');
  const [actionError, setActionError] = useState('');
  const [draggingPackId, setDraggingPackId] = useState('');
  const [dropTargetPackId, setDropTargetPackId] = useState('');
  const dragPackIdRef = useRef('');

  const packItems = Array.isArray(packs) ? packs : [];
  const accent = ui?.accentText || theme.palette.primary.main;
  const panelBg = ui?.panelBg || theme.palette.background.paper;
  const border = ui?.borderSoft || alpha(theme.palette.common.white, 0.1);
  const textPrimary = ui?.textPrimary || theme.palette.text.primary;
  const textSecondary = ui?.textSecondary || theme.palette.text.secondary;

  // Локальное состояние живёт только внутри открытого диалога —
  // при закрытии всё сбрасывается, при следующем открытии чисто.
  useEffect(() => {
    if (open) return;
    setConfirmingPackId('');
    setBusyPackId('');
    setActionError('');
    setDraggingPackId('');
    setDropTargetPackId('');
    dragPackIdRef.current = '';
  }, [open]);

  // Набор мог исчезнуть из списка по внешней причине (другая вкладка
  // панели, смена аккаунта) — висящее на нём подтверждение снимаем.
  useEffect(() => {
    if (!confirmingPackId) return;
    if (!packItems.some((pack) => String(pack?.id) === String(confirmingPackId))) {
      setConfirmingPackId('');
    }
  }, [confirmingPackId, packItems]);

  const handleConfirmRemove = async (pack) => {
    const packId = String(pack?.id || '').trim();
    if (!packId || busyPackId) return;
    setBusyPackId(packId);
    setActionError('');
    try {
      // Ошибка не проглатывается: вкладка бросает исключение, диалог
      // показывает его рядом со списком — ряд остаётся на месте.
      await onRemovePack?.(pack);
      setConfirmingPackId('');
    } catch (error) {
      setActionError(getApiError(error, 'Не удалось удалить набор стикеров.'));
    } finally {
      setBusyPackId('');
    }
  };

  const resetDragState = () => {
    dragPackIdRef.current = '';
    setDraggingPackId('');
    setDropTargetPackId('');
  };

  const handleDragStart = (event, pack) => {
    const packId = String(pack?.id || '').trim();
    if (!packId) return;
    dragPackIdRef.current = packId;
    setDraggingPackId(packId);
    setConfirmingPackId('');
    setActionError('');
    // dataTransfer отсутствует в jsdom — перестраховка, в браузере
    // setData обязателен для Firefox.
    if (event.dataTransfer) {
      try {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', packId);
      } catch {
        // Drag-and-drop всё равно работает без payload.
      }
    }
  };

  const handleDragOverRow = (event, pack) => {
    const dragId = dragPackIdRef.current;
    const targetId = String(pack?.id || '').trim();
    if (!dragId || !targetId || dragId === targetId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    if (dropTargetPackId !== targetId) setDropTargetPackId(targetId);
  };

  const handleDropOnRow = (event, pack) => {
    const dragId = dragPackIdRef.current;
    const targetId = String(pack?.id || '').trim();
    event.preventDefault();
    resetDragState();
    if (!dragId || !targetId || dragId === targetId) return;
    const ids = packItems.map((item) => String(item?.id || '')).filter(Boolean);
    const targetIndex = ids.indexOf(targetId);
    if (targetIndex < 0) return;
    // Перетаскиваемый ряд встаёт на место целевого — как в Telegram Desktop.
    // Индекс берём в исходном списке: при драге вниз позиция цели в
    // отфильтрованном массиве сдвинулась бы на единицу и дроп вёл себя
    // как «встать перед целью», а не «занять её место».
    const nextIds = ids.filter((id) => id !== dragId);
    nextIds.splice(targetIndex, 0, dragId);
    if (nextIds.join('|') === ids.join('|')) return;
    void onReorderPacks?.(nextIds);
  };

  return (
    <Dialog
      open={Boolean(open)}
      onClose={busyPackId ? undefined : onClose}
      aria-labelledby="chat-sticker-manage-dialog-title"
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
            id="chat-sticker-manage-dialog-title"
            sx={{ fontSize: 17, fontWeight: 800, lineHeight: 1.25, color: textPrimary }}
          >
            Наборы стикеров
          </Typography>
          <Typography sx={{ mt: 0.25, fontSize: 12.5, color: textSecondary }}>
            {packItems.length > 0
              ? 'Перетаскивайте наборы, чтобы изменить порядок'
              : 'Установленных наборов пока нет'}
          </Typography>
        </Box>
        <IconButton
          aria-label="Закрыть управление наборами"
          onClick={onClose}
          disabled={Boolean(busyPackId)}
          sx={{ color: textSecondary }}
        >
          <CloseRoundedIcon />
        </IconButton>
      </Box>

      <DialogContent sx={{ p: 1.5, minHeight: 120, bgcolor: panelBg }}>
        {actionError ? (
          <Alert severity="error" sx={{ mb: 1 }}>{actionError}</Alert>
        ) : null}
        <Box
          component="ul"
          role="list"
          aria-label="Установленные наборы стикеров"
          sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 0.4 }}
        >
          {packItems.map((pack) => {
            const packId = String(pack?.id || '');
            const cover = pack?.stickers?.[0];
            const stickerCount = Array.isArray(pack?.stickers) ? pack.stickers.length : 0;
            const confirming = confirmingPackId === packId;
            const busy = busyPackId === packId;
            const dropTarget = dropTargetPackId === packId && draggingPackId !== packId;
            return (
              <Box
                key={packId || pack?.short_name || pack?.title}
                component="li"
                data-testid={`sticker-manage-row-${packId}`}
                onDragOver={(event) => handleDragOverRow(event, pack)}
                onDrop={(event) => handleDropOnRow(event, pack)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.8,
                  px: 0.6,
                  py: 0.55,
                  minHeight: 52,
                  borderRadius: 2,
                  borderTop: dropTarget
                    ? `2px solid ${accent}`
                    : '2px solid transparent',
                  bgcolor: dropTarget
                    ? alpha(accent, 0.08)
                    : alpha(theme.palette.common.white, 0.025),
                  opacity: draggingPackId === packId ? 0.5 : 1,
                  transition: 'background-color 120ms ease, border-color 120ms ease, opacity 120ms ease',
                }}
              >
                <Box
                  draggable
                  onDragStart={(event) => handleDragStart(event, pack)}
                  onDragEnd={resetDragState}
                  role="button"
                  tabIndex={0}
                  aria-label={`Перетащить набор ${pack?.title || ''}`.trim()}
                  sx={{
                    width: 28,
                    height: 40,
                    flexShrink: 0,
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: 1,
                    color: textSecondary,
                    cursor: 'grab',
                    touchAction: 'none',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    '&:active': { cursor: 'grabbing' },
                    '&:focus-visible': { outline: `2px solid ${accent}`, outlineOffset: 1 },
                  }}
                >
                  <DragIndicatorRoundedIcon sx={{ fontSize: 20 }} aria-hidden="true" />
                </Box>
                <Box
                  sx={{
                    width: 44,
                    height: 44,
                    flexShrink: 0,
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: 1.5,
                    bgcolor: alpha(theme.palette.common.white, 0.03),
                    overflow: 'hidden',
                  }}
                >
                  {cover ? (
                    <ChatStickerThumbnail sticker={cover} size={40} staticOnly />
                  ) : (
                    <TelegramIcon sx={{ fontSize: 22, color: accent }} aria-hidden="true" />
                  )}
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography
                    noWrap
                    sx={{ fontSize: 14, fontWeight: 700, lineHeight: 1.25, color: textPrimary }}
                  >
                    {pack?.title || pack?.short_name || 'Набор стикеров'}
                  </Typography>
                  <Typography
                    noWrap
                    sx={{ mt: 0.15, fontSize: 12, lineHeight: 1.25, color: textSecondary }}
                  >
                    {formatStickerCount(stickerCount)}
                  </Typography>
                </Box>
                {confirming ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                    <Button
                      size="small"
                      variant="contained"
                      color="error"
                      disabled={busy}
                      onClick={() => void handleConfirmRemove(pack)}
                      aria-label={`Подтвердить удаление ${pack?.title || ''}`.trim()}
                      startIcon={busy ? <CircularProgress size={14} color="inherit" /> : null}
                      sx={{ minHeight: 34, px: 1.4, textTransform: 'none' }}
                    >
                      {busy ? 'Удаляем…' : 'Удалить'}
                    </Button>
                    <Button
                      size="small"
                      disabled={busy}
                      onClick={() => setConfirmingPackId('')}
                      aria-label={`Отменить удаление ${pack?.title || ''}`.trim()}
                      sx={{ minHeight: 34, px: 1.2, textTransform: 'none', color: textSecondary }}
                    >
                      Отмена
                    </Button>
                  </Box>
                ) : (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3, flexShrink: 0 }}>
                    <Button
                      size="small"
                      onClick={() => onOpenPack?.(pack)}
                      aria-label={`Открыть набор ${pack?.title || ''}`.trim()}
                      sx={{ minHeight: 34, px: 1.2, textTransform: 'none', color: accent }}
                    >
                      Открыть
                    </Button>
                    <IconButton
                      size="small"
                      onClick={() => {
                        setConfirmingPackId(packId);
                        setActionError('');
                      }}
                      aria-label={`Удалить набор ${pack?.title || ''}`.trim()}
                      sx={{
                        width: 36,
                        height: 36,
                        color: textSecondary,
                        '&:hover': { color: theme.palette.error.main, bgcolor: alpha(theme.palette.error.main, 0.1) },
                      }}
                    >
                      <DeleteOutlineRoundedIcon sx={{ fontSize: 19 }} aria-hidden="true" />
                    </IconButton>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
        <Button
          fullWidth
          startIcon={<AddRoundedIcon />}
          onClick={() => onAddPack?.()}
          sx={{
            mt: 0.8,
            minHeight: 40,
            justifyContent: 'flex-start',
            px: 1.2,
            borderRadius: 2,
            textTransform: 'none',
            fontWeight: 700,
            color: accent,
            '&:hover': { bgcolor: alpha(accent, 0.1) },
          }}
        >
          Добавить набор
        </Button>
      </DialogContent>
    </Dialog>
  );
}
