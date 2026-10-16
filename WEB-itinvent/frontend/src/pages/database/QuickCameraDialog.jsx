import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Dialog, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

import { PHOTO_UPLOAD_MAX_EDGE_PX } from '../../lib/resumablePhotoUpload';

export const canUseLiveCamera = () => (
  typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'
);

const CAMERA_ERROR = 'Нет доступа к камере. Разрешите камеру для сайта или используйте «Сделать фото».';

// Серия снимков: камера остаётся открытой, каждый кадр сразу уходит в очередь загрузки.
// Подтверждения нет — повернуть или удалить снимок можно потом в карточке.
export default function QuickCameraDialog({ open, onClose, onShot, label = '' }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [shots, setShots] = useState(0);
  const [flash, setFlash] = useState(false);
  const [busy, setBusy] = useState(false);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks?.().forEach((track) => track.stop());
    streamRef.current = null;
    setReady(false);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setError('');
    setShots(0);
    navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: PHOTO_UPLOAD_MAX_EDGE_PX },
        height: { ideal: PHOTO_UPLOAD_MAX_EDGE_PX },
      },
      audio: false,
    }).then((stream) => {
      if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        void video.play?.();
      }
      setReady(true);
    }).catch(() => { if (!cancelled) setError(CAMERA_ERROR); });
    return () => { cancelled = true; stopStream(); };
  }, [open, stopStream]);

  const handleShot = async () => {
    const video = videoRef.current;
    if (!video || !ready || busy || !video.videoWidth) return;
    setBusy(true);
    try {
      const scale = Math.min(1, PHOTO_UPLOAD_MAX_EDGE_PX / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => { canvas.toBlob(resolve, 'image/jpeg', 0.85); });
      if (!blob) throw new Error('empty frame');
      const stamp = Date.now();
      const file = new File([blob], `photo-${stamp}.jpg`, { type: 'image/jpeg', lastModified: stamp });
      setShots((count) => count + 1);
      setFlash(true);
      setTimeout(() => setFlash(false), 120);
      await onShot(file);
    } catch {
      setError('Не удалось сделать снимок. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen
      sx={{ zIndex: (theme) => `${theme.zIndex.modal + 5} !important` }}
      PaperProps={{ sx: { bgcolor: '#000', color: '#fff', backgroundImage: 'none' } }}
      aria-label="Серия снимков"
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1 }}>
        <Typography variant="subtitle1" sx={{ flex: 1, minWidth: 0 }} noWrap>
          {label || 'Серия снимков'}
        </Typography>
        <IconButton aria-label="Закрыть камеру" onClick={onClose} sx={{ color: 'inherit' }}>
          <CloseIcon />
        </IconButton>
      </Box>
      <Box sx={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          playsInline
          muted
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
        />
        {flash ? <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'rgba(255,255,255,0.6)' }} /> : null}
        {error ? (
          <Alert severity="error" sx={{ position: 'absolute', left: 12, right: 12, top: 12 }}>{error}</Alert>
        ) : null}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, px: 2, py: 2, pb: 'calc(16px + env(safe-area-inset-bottom))' }}>
        <Typography variant="body2" sx={{ minWidth: 90 }}>
          {shots ? `Снято: ${shots}` : 'Наведите камеру'}
        </Typography>
        <IconButton
          aria-label="Сделать снимок"
          onClick={() => { void handleShot(); }}
          disabled={!ready || busy}
          sx={{
            width: 72, height: 72, border: '4px solid #fff', bgcolor: 'rgba(255,255,255,0.25)',
            '&:hover': { bgcolor: 'rgba(255,255,255,0.4)' },
            '&.Mui-disabled': { borderColor: 'rgba(255,255,255,0.35)' },
          }}
        />
        <Button onClick={onClose} variant="contained" sx={{ minWidth: 90 }}>Готово</Button>
      </Box>
    </Dialog>
  );
}
