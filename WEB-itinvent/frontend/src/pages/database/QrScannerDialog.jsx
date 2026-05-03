import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

function QrScannerDialog({
  open,
  onClose,
  isMobile = false,
  loading = false,
  ready = false,
  error = '',
  result = '',
  overlayBgcolor = 'background.paper',
}) {
  const borderColor = error ? 'error.main' : (ready ? 'success.main' : 'action.disabled');

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      fullScreen={isMobile}
    >
      <DialogTitle>
        Сканер QR-кода
        <IconButton
          aria-label="close"
          onClick={onClose}
          sx={{ position: 'absolute', right: 8, top: 8 }}
          size="small"
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ pt: 2 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
            Наведите камеру на QR-код оборудования
          </Typography>

          <Box
            sx={{
              width: '100%',
              maxWidth: 400,
              minHeight: 250,
              borderRadius: 2,
              overflow: 'hidden',
              border: '2px solid',
              borderColor,
              position: 'relative',
            }}
          >
            {/* Html5Qrcode owns this node; keep React-rendered children outside it. */}
            <Box
              id="qr-reader"
              sx={{
                width: '100%',
                minHeight: 250,
                '& video': {
                  width: '100% !important',
                  borderRadius: 1,
                },
                '& canvas': {
                  maxWidth: '100%',
                },
              }}
            />
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

          {ready && !loading && !error && (
            <Alert severity="info" sx={{ width: '100%' }}>
              Камера активна. Держите QR-код в центре рамки.
            </Alert>
          )}
          {result && (
            <Alert severity="success" sx={{ width: '100%' }}>
              Распознано: {result.substring(0, 100)}
            </Alert>
          )}
          {error && (
            <Alert severity="error" sx={{ width: '100%' }}>
              {error}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} variant="outlined" color="inherit">
          Закрыть
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default QrScannerDialog;
