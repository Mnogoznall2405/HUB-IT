import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';

import {
  buildEquipmentQrLabelContent,
  buildEquipmentQrLabelDataUrl,
} from './equipmentQrLabel';

function DetailQrDialog({
  open,
  onClose,
  isMobile = false,
  loading = false,
  url = '',
  text = '',
  fileName = 'equipment-qr.png',
  equipment = null,
}) {
  const label = useMemo(() => buildEquipmentQrLabelContent(equipment), [equipment]);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [downloadLoading, setDownloadLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDownloadUrl('');
    if (!open || !url || loading) {
      setDownloadLoading(false);
      return undefined;
    }

    setDownloadLoading(true);
    buildEquipmentQrLabelDataUrl({ equipment, qrDataUrl: url })
      .then((nextUrl) => {
        if (!cancelled) setDownloadUrl(nextUrl);
      })
      .catch((error) => {
        console.error('Error generating equipment QR label:', error);
        if (!cancelled) setDownloadUrl('');
      })
      .finally(() => {
        if (!cancelled) setDownloadLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [equipment, loading, open, url]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      fullScreen={isMobile}
    >
      <DialogTitle>QR-код оборудования</DialogTitle>
      <DialogContent sx={{ pt: 2, overscrollBehavior: 'contain' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
          <Box
            aria-label={`Инвентарная этикетка ${label.invNo}`}
            sx={{
              width: '100%',
              maxWidth: 500,
              aspectRatio: '1 / 1',
              mx: 'auto',
              display: 'grid',
              gridTemplateRows: 'auto minmax(0, 1fr) auto',
              justifyItems: 'center',
              gap: { xs: 0.5, sm: 1 },
              bgcolor: '#fff',
              color: '#000',
              borderRadius: 0,
              p: { xs: 1.5, sm: 2 },
              boxShadow: 'none',
              overflow: 'hidden',
            }}
          >
            <Box
              aria-label={label.brandName}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1.25,
                minWidth: 0,
              }}
            >
              <Box
                component="span"
                aria-hidden="true"
                sx={{
                  display: 'block',
                  width: { xs: 44, sm: 54 },
                  height: { xs: 44, sm: 54 },
                  flexShrink: 0,
                  bgcolor: '#000',
                  mask: 'url(/favicon.png) center / contain no-repeat',
                  WebkitMask: 'url(/favicon.png) center / contain no-repeat',
                }}
              />
              <Typography
                component="div"
                translate="no"
                sx={{ fontSize: { xs: 24, sm: 30 }, lineHeight: 1, fontWeight: 800 }}
              >
                {label.brandName}
              </Typography>
            </Box>

            <Box
              sx={{
                width: { xs: '70%', sm: '74%' },
                maxWidth: 370,
                alignSelf: 'center',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              {loading ? (
                <Box sx={{ width: '100%', aspectRatio: '1 / 1', display: 'grid', placeItems: 'center' }}>
                  <CircularProgress />
                </Box>
              ) : url ? (
                <Box
                  component="img"
                  src={url}
                  alt={`QR-код оборудования ${label.invNo}`}
                  sx={{
                    display: 'block',
                    width: '100%',
                    aspectRatio: '1 / 1',
                    backgroundColor: '#fff',
                  }}
                />
              ) : (
                <Alert severity="warning" sx={{ width: '100%' }}>
                  Недостаточно данных для генерации QR-кода.
                </Alert>
              )}
            </Box>

            <Box component="dl" sx={{ m: 0, minWidth: 0, maxWidth: '100%', textAlign: 'center' }}>
              <Typography
                component="dt"
                sx={{ color: '#000', fontSize: { xs: 10, sm: 12 }, lineHeight: 1.25, fontWeight: 600 }}
              >
                СЕРИЙНЫЙ НОМЕР
              </Typography>
              <Typography
                component="dd"
                sx={{
                  m: 0,
                  mt: 0.25,
                  color: '#000',
                  fontSize: { xs: 18, sm: 22 },
                  lineHeight: 1.15,
                  fontWeight: 800,
                  overflowWrap: 'anywhere',
                }}
              >
                {label.serialNo}
              </Typography>
            </Box>
          </Box>

          <TextField
            fullWidth
            multiline
            minRows={2}
            maxRows={4}
            label="Ссылка в QR-коде"
            value={text}
            InputProps={{ readOnly: true }}
          />
        </Box>
      </DialogContent>
      <DialogActions
        sx={{
          p: 2,
          gap: 1,
          flexDirection: { xs: 'column', sm: 'row' },
          '& > :not(style) ~ :not(style)': { ml: 0 },
          '& .MuiButton-root': { width: { xs: '100%', sm: 'auto' } },
        }}
      >
        <Button onClick={onClose} variant="outlined">
          Закрыть
        </Button>
        <Button
          component="a"
          href={downloadUrl || '#'}
          download={fileName}
          variant="contained"
          disabled={!downloadUrl || loading || downloadLoading}
        >
          {downloadLoading ? 'Готовим PNG…' : 'Скачать этикетку PNG'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default DetailQrDialog;
