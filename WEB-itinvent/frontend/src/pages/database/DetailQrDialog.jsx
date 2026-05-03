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
} from '@mui/material';

function DetailQrDialog({
  open,
  onClose,
  isMobile = false,
  borderColor = 'divider',
  loading = false,
  url = '',
  text = '',
  fileName = 'equipment-qr.png',
}) {
  const qrSize = isMobile ? 260 : 300;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      fullScreen={isMobile}
    >
      <DialogTitle>QR-code оборудования</DialogTitle>
      <DialogContent sx={{ pt: 2 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
          {loading ? (
            <Box sx={{ width: qrSize, height: qrSize, display: 'grid', placeItems: 'center' }}>
              <CircularProgress />
            </Box>
          ) : url ? (
            <Box
              component="img"
              src={url}
              alt="Equipment QR"
              sx={{
                width: qrSize,
                height: qrSize,
                borderRadius: 1,
                border: '1px solid',
                borderColor,
                backgroundColor: '#fff',
                p: 1,
              }}
            />
          ) : (
            <Alert severity="warning" sx={{ width: '100%' }}>
              Недостаточно данных для генерации QR-code.
            </Alert>
          )}
          <TextField
            fullWidth
            multiline
            minRows={4}
            label="Содержимое QR"
            value={text}
            InputProps={{ readOnly: true }}
          />
        </Box>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} variant="outlined">
          Закрыть
        </Button>
        <Button
          component="a"
          href={url || '#'}
          download={fileName}
          variant="contained"
          disabled={!url || loading}
        >
          Скачать PNG
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default DetailQrDialog;
