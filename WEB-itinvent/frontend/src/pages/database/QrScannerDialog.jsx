import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  IconButton,
  Typography,
} from '@mui/material';
import AddAPhotoOutlinedIcon from '@mui/icons-material/AddAPhotoOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CloseIcon from '@mui/icons-material/Close';
import FlashlightOffIcon from '@mui/icons-material/FlashlightOff';
import FlashlightOnIcon from '@mui/icons-material/FlashlightOn';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';

import { readFirst, readQty } from './databaseRecordModel';

const pairConsumableLabel = (item) => {
  const name = String(readFirst(item, ['MODEL_NAME', 'model_name'], '') || '').trim()
    || String(readFirst(item, ['TYPE_NAME', 'type_name'], '') || '').trim()
    || 'Расходник';
  return `${name} · остаток ${readQty(item, 0)} шт.`;
};

const pairPrinterLabel = (row) => {
  const name = String(readFirst(row, ['MODEL_NAME', 'model_name'], '') || '').trim() || 'МФУ';
  const invNo = String(readFirst(row, ['INV_NO', 'inv_no'], '') || '').trim();
  return invNo ? `${name} · инв. ${invNo}` : name;
};

// Плашки поверх картинки камеры: читаются на любом фоне.
const OVERLAY_PILL_SX = {
  px: 1.5,
  py: 0.75,
  borderRadius: 5,
  bgcolor: 'rgba(0, 0, 0, 0.62)',
  color: '#fff',
  backdropFilter: 'blur(4px)',
  maxWidth: 'calc(100% - 24px)',
  textAlign: 'center',
  lineHeight: 1.3,
};

// Все нажимаемые элементы — не ниже 48 px: попадать пальцем надо с первого раза.
const BIG_BUTTON_SX = { minHeight: 48, borderRadius: 2, textTransform: 'none', fontWeight: 600 };

// Экран сканера на телефоне не прокручивается: шапка, камера на всё свободное место
// и нижняя панель действий с безопасным отступом под жестовую полосу.
function QrScannerDialog({
  open,
  onClose,
  onRetry = null,
  isMobile = false,
  loading = false,
  ready = false,
  error = '',
  result = '',
  overlayBgcolor = 'background.paper',
  pair = null,
  photoMode = null,
  torch = null,
}) {
  const borderColor = error ? 'error.main' : (ready ? 'success.main' : 'divider');
  const pairActive = Boolean(pair?.active);
  const showHint = ready && !loading && !error && !result;

  // Высота окна камеры: видео вписывается в неё целиком (без обрезки), иначе рамка
  // распознавания библиотеки съезжает относительно картинки.
  const viewRef = useRef(null);
  const [viewHeight, setViewHeight] = useState(0);
  useEffect(() => {
    const node = viewRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setViewHeight(Math.floor(node.clientHeight)));
    observer.observe(node);
    setViewHeight(Math.floor(node.clientHeight));
    return () => observer.disconnect();
  }, [open]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      fullScreen={isMobile}
      // Тема сажает любой диалог уже 600 px в рамку с полями 16 px — сканеру нужен весь экран.
      sx={{
        '& .MuiDialog-paper': isMobile
          ? { margin: '0 !important', maxWidth: '100% !important', width: '100%', height: '100dvh', maxHeight: '100dvh', borderRadius: 0 }
          : { height: 'min(720px, 92dvh)' },
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 2,
            minHeight: 56,
            flexShrink: 0,
          }}
        >
          <QrCodeScannerIcon color="primary" />
          <Typography component="h2" variant="h6" sx={{ flex: 1, minWidth: 0, fontWeight: 700 }} noWrap>
            Сканер QR-кода
          </Typography>
          <IconButton aria-label="close" onClick={onClose} edge="end" sx={{ width: 48, height: 48, color: 'text.primary' }}>
            <CloseIcon />
          </IconButton>
        </Box>

        {/* Камера занимает всё свободное место; цвет нижней кромки — состояние сканера. */}
        <Box
          ref={viewRef}
          sx={{
            position: 'relative',
            flex: '1 1 auto',
            minHeight: 200,
            bgcolor: '#000',
            borderBottom: '4px solid',
            borderColor,
            overflow: 'hidden',
          }}
        >
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {/* Html5Qrcode owns this node; keep React-rendered children outside it. */}
            <Box
              id="qr-reader"
              sx={{
                // Узел обтягивает видео: рамка и затемнение библиотеки считаются от его углов.
                width: 'fit-content',
                maxWidth: '100%',
                border: '0 !important',
                '& video': {
                  display: 'block',
                  width: 'auto !important',
                  height: 'auto !important',
                  maxWidth: '100%',
                  maxHeight: viewHeight ? `${viewHeight}px` : '100%',
                },
                '& canvas': {
                  maxWidth: '100%',
                },
              }}
            />
          </Box>

          {showHint ? (
            <Box sx={{ position: 'absolute', top: 12, left: 0, right: 0, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
              <Typography variant="body2" sx={OVERLAY_PILL_SX}>
                Камера активна. Держите QR-код в центре рамки.
              </Typography>
            </Box>
          ) : null}

          {result ? (
            <Box sx={{ position: 'absolute', top: 12, left: 0, right: 0, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
              <Typography
                variant="body2"
                role="status"
                sx={{ ...OVERLAY_PILL_SX, display: 'flex', alignItems: 'center', gap: 0.75 }}
              >
                <CheckCircleIcon fontSize="small" sx={{ color: 'success.light', flexShrink: 0 }} />
                <span>{`Распознано: ${result.substring(0, 100)}`}</span>
              </Typography>
            </Box>
          ) : null}

          {torch && !loading && !error ? (
            <IconButton
              aria-label={torch.on ? 'Выключить фонарик' : 'Включить фонарик'}
              aria-pressed={Boolean(torch.on)}
              onClick={() => { void torch.onToggle?.(); }}
              sx={{
                position: 'absolute',
                right: 12,
                bottom: 12,
                width: 56,
                height: 56,
                color: '#fff',
                bgcolor: torch.on ? 'warning.main' : 'rgba(0, 0, 0, 0.62)',
                '&:hover': { bgcolor: torch.on ? 'warning.dark' : 'rgba(0, 0, 0, 0.8)' },
              }}
            >
              {torch.on ? <FlashlightOnIcon /> : <FlashlightOffIcon />}
            </IconButton>
          ) : null}

          {loading && (
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1,
                bgcolor: overlayBgcolor,
                pointerEvents: 'none',
              }}
            >
              <CircularProgress size={40} />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                Инициализация камеры...
              </Typography>
            </Box>
          )}
        </Box>

        <Box
          sx={{
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            p: 1.5,
            pb: 'calc(12px + env(safe-area-inset-bottom))',
          }}
        >
          {error ? (
            <Alert severity="error" sx={{ alignItems: 'center' }}>
              {error}
            </Alert>
          ) : null}
          {error && onRetry ? (
            <Button
              fullWidth
              variant="contained"
              startIcon={<QrCodeScannerIcon />}
              onClick={onRetry}
              sx={BIG_BUTTON_SX}
            >
              Разрешить доступ к камере
            </Button>
          ) : null}

          {pairActive ? (
            <Box
              sx={{
                border: '1px solid',
                borderColor: 'primary.main',
                borderRadius: 2,
                p: 1.25,
                display: 'flex',
                flexDirection: 'column',
                gap: 0.75,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <SwapHorizIcon fontSize="small" color="primary" />
                <Typography variant="body2" sx={{ fontWeight: 700, flex: 1 }}>
                  Списание расходника в МФУ
                </Typography>
                {pair.busy ? <CircularProgress size={16} /> : null}
                <Button size="small" onClick={pair.onCancel} sx={{ minHeight: 36 }}>Отмена</Button>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {pair.consumable ? <CheckCircleOutlineIcon fontSize="small" color="success" /> : <RadioButtonUncheckedIcon fontSize="small" color="disabled" />}
                <Typography variant="body2" color={pair.consumable ? 'text.primary' : 'text.secondary'} noWrap>
                  {pair.consumable ? pairConsumableLabel(pair.consumable) : 'Сканируйте QR расходника'}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {pair.printer ? <CheckCircleOutlineIcon fontSize="small" color="success" /> : <RadioButtonUncheckedIcon fontSize="small" color="disabled" />}
                <Typography variant="body2" color={pair.printer ? 'text.primary' : 'text.secondary'} noWrap>
                  {pair.printer ? pairPrinterLabel(pair.printer) : 'Сканируйте QR МФУ'}
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary">
                Порядок любой — после второго кода откроется карточка расходника.
              </Typography>
            </Box>
          ) : (photoMode || pair?.onStart) ? (
            <Box sx={{ display: 'grid', gridTemplateColumns: photoMode && pair?.onStart ? '1fr 1fr' : '1fr', gap: 1 }}>
              {photoMode ? (
                <Button
                  fullWidth
                  role="switch"
                  aria-checked={Boolean(photoMode.enabled)}
                  aria-label="После скана сразу добавить фото"
                  variant={photoMode.enabled ? 'contained' : 'outlined'}
                  startIcon={photoMode.enabled ? <CheckCircleIcon /> : <AddAPhotoOutlinedIcon />}
                  onClick={() => photoMode.onChange?.(!photoMode.enabled)}
                  sx={{ ...BIG_BUTTON_SX, lineHeight: 1.2 }}
                >
                  {photoMode.enabled ? 'Фото: включено' : 'Фото после скана'}
                </Button>
              ) : null}
              {pair?.onStart ? (
                <Button
                  fullWidth
                  variant="outlined"
                  aria-label="Списание расходника в МФУ"
                  startIcon={<SwapHorizIcon />}
                  onClick={pair.onStart}
                  sx={{ ...BIG_BUTTON_SX, lineHeight: 1.2 }}
                >
                  Расходник → МФУ
                </Button>
              ) : null}
            </Box>
          ) : null}

          <Button fullWidth onClick={onClose} variant="outlined" color="inherit" sx={BIG_BUTTON_SX}>
            Закрыть
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
}

export default QrScannerDialog;
