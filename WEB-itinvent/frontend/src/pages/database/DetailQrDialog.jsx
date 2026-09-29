import { useCallback, useEffect, useMemo, useState } from 'react';
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

const toGenericLabelContent = (equipment) => {
  const base = buildEquipmentQrLabelContent(equipment);
  return {
    brandName: base.brandName,
    topCaption: 'Инв. №',
    topValue: base.invNo,
    bottomCaption: 'Серийный номер',
    bottomValue: base.serialNo,
  };
};

function DetailQrDialog({
  open,
  onClose,
  isMobile = false,
  loading = false,
  url = '',
  text = '',
  fileName = 'equipment-qr.png',
  equipment = null,
  title = 'QR-код оборудования',
  labelContent = null,
  buildLabelDataUrl = null,
  onPrint = null,
  printLoading = false,
}) {
  const label = useMemo(
    () => labelContent || toGenericLabelContent(equipment),
    [equipment, labelContent]
  );
  const qrOnly = Boolean(label.qrOnly);
  const bottomFontSize = String(label.bottomValue || '').length > 32
    ? { xs: 14, sm: 18 }
    : String(label.bottomValue || '').length > 22
      ? { xs: 17, sm: 22 }
      : { xs: 22, sm: 28 };
  const [downloadUrl, setDownloadUrl] = useState('');
  const [downloadLoading, setDownloadLoading] = useState(false);

  const buildLabel = useCallback(
    (qrDataUrl) => (buildLabelDataUrl
      ? buildLabelDataUrl(qrDataUrl)
      : buildEquipmentQrLabelDataUrl({ equipment, qrDataUrl })),
    [buildLabelDataUrl, equipment]
  );

  useEffect(() => {
    let cancelled = false;
    setDownloadUrl('');
    if (!open || !url || loading) {
      setDownloadLoading(false);
      return undefined;
    }

    setDownloadLoading(true);
    buildLabel(url)
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
  }, [buildLabel, loading, open, url]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      fullScreen={isMobile}
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent sx={{ pt: 2, overscrollBehavior: 'contain' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
          <Box
            aria-label={qrOnly ? 'QR-этикетка расходника' : `Инвентарная этикетка ${label.topValue}`}
            sx={{
              width: '100%',
              maxWidth: 500,
              aspectRatio: '1 / 1',
              mx: 'auto',
              display: 'grid',
              gridTemplateRows: qrOnly
                ? (label.modelName ? 'minmax(0, 1fr) auto' : 'minmax(0, 1fr)')
                : 'auto auto minmax(0, 1fr) auto',
              justifyItems: 'center',
              gap: { xs: 0.5, sm: 1 },
              bgcolor: '#fff',
              color: '#000',
              border: qrOnly ? 'none' : '2px solid #000',
              borderRadius: 0,
              boxSizing: 'border-box',
              px: qrOnly ? 0 : { xs: 1.5, sm: 2 },
              py: qrOnly ? 0 : { xs: 2.25, sm: 2.75 },
              boxShadow: 'none',
              overflow: 'hidden',
            }}
          >
            {qrOnly ? (
              loading ? (
                <Box sx={{ alignSelf: 'center', display: 'grid', placeItems: 'center' }}>
                  <CircularProgress />
                </Box>
              ) : url ? (
                <>
                  <Box
                    component="img"
                    src={url}
                    alt={title}
                    sx={{
                      display: 'block',
                      width: '100%',
                      aspectRatio: '1 / 1',
                      backgroundColor: '#fff',
                      alignSelf: 'stretch',
                    }}
                  />
                  {label.modelName ? (
                    <Typography
                      component="div"
                      translate="no"
                      sx={{
                        fontSize: { xs: 13, sm: 16 },
                        lineHeight: 1.15,
                        fontWeight: 800,
                        textAlign: 'center',
                        overflowWrap: 'anywhere',
                        px: 0.5,
                        pb: 0.5,
                      }}
                    >
                      {label.modelName}
                    </Typography>
                  ) : null}
                </>
              ) : (
                <Alert severity="warning" sx={{ width: '100%', alignSelf: 'center' }}>
                  Недостаточно данных для генерации QR-кода.
                </Alert>
              )
            ) : (
            <>
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

            <Box component="dl" sx={{ m: 0, minWidth: 0, width: '100%', maxWidth: '100%', textAlign: 'center' }}>
              <Typography
                component="dt"
                sx={{
                  color: '#000',
                  fontSize: { xs: 10, sm: 12 },
                  lineHeight: 1.2,
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                }}
              >
                {label.topCaption}
              </Typography>
              <Typography
                component="dd"
                sx={{
                  m: 0,
                  color: '#000',
                  fontSize: { xs: 25, sm: 32 },
                  lineHeight: 1.05,
                  fontWeight: 800,
                  fontVariantNumeric: 'tabular-nums',
                  overflowWrap: 'anywhere',
                }}
              >
                {label.topValue}
              </Typography>
            </Box>

            <Box
              sx={{
                width: { xs: '66%', sm: '69%' },
                maxWidth: 345,
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
                  alt={`${title} ${label.topValue}`}
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
                sx={{
                  color: '#000',
                  fontSize: { xs: 10, sm: 12 },
                  lineHeight: 1.25,
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                }}
              >
                {label.bottomCaption}
              </Typography>
              <Typography
                component="dd"
                sx={{
                  m: 0,
                  mt: 0.25,
                  color: '#000',
                  fontSize: bottomFontSize,
                  lineHeight: 1.1,
                  fontWeight: 800,
                  fontVariantNumeric: 'tabular-nums',
                  overflowWrap: 'anywhere',
                  wordBreak: 'break-word',
                  maxWidth: '100%',
                }}
              >
                {label.bottomValue}
              </Typography>
            </Box>
            </>
            )}
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
        {onPrint ? (
          <Button
            onClick={onPrint}
            variant="contained"
            disabled={!url || loading || printLoading}
          >
            {printLoading ? 'Печать…' : 'Печать'}
          </Button>
        ) : null}
        <Button
          component="a"
          href={downloadUrl || '#'}
          download={fileName}
          variant={onPrint ? 'outlined' : 'contained'}
          disabled={!downloadUrl || loading || downloadLoading}
        >
          {downloadLoading ? 'Готовим PNG…' : 'Скачать этикетку PNG'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default DetailQrDialog;
