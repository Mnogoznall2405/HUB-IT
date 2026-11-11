import { memo } from 'react';
import { Alert, Box, Button, Paper, Typography } from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

const UploadActPdfPreviewPanel = memo(function UploadActPdfPreviewPanel({
  file,
  previewUrl,
  previewError,
  onOpenPreview,
}) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, display: 'grid', gap: 1.25 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Предпросмотр PDF
        </Typography>
        {previewUrl && (
          <Button size="small" variant="outlined" startIcon={<OpenInNewIcon />} onClick={onOpenPreview}>
            Открыть отдельно
          </Button>
        )}
      </Box>

      {!file && (
        <Alert severity="info" variant="outlined">
          Выберите PDF-файл акта, чтобы увидеть его прямо в окне загрузки.
        </Alert>
      )}

      {file && previewError && (
        <Alert severity="warning" variant="outlined">
          {previewError}
        </Alert>
      )}

      {file && previewUrl && !previewError && (
        <Box
          component="iframe"
          src={previewUrl}
          title="Предпросмотр подписанного акта"
          sx={{
            width: '100%',
            height: { xs: 360, md: 720 },
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1.5,
            bgcolor: '#fff',
          }}
        />
      )}
    </Paper>
  );
});

export default UploadActPdfPreviewPanel;
