import { memo } from 'react';
import { Alert, Box, Button, Fade, Paper, Typography } from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';

const UploadActPdfParsePanel = memo(function UploadActPdfParsePanel({
  file,
  parsing = false,
  committing = false,
  onFileSelect,
  onParse,
}) {
  const isBusy = parsing || committing;
  const parseDisabled = !file || parsing || committing;

  return (
    <Fade in timeout={220}>
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
          1. Выбор и распознавание PDF
        </Typography>
        <Alert severity="info" variant="outlined" sx={{ mb: 1.5 }}>
          Загрузите подписанный PDF. Если API распознавания недоступен, используйте ручной режим без API.
        </Alert>
        <Box sx={{ display: 'grid', gap: 1.5 }}>
          <Button
            component="label"
            variant="outlined"
            startIcon={<UploadFileIcon />}
            disabled={isBusy}
            sx={{ justifyContent: 'flex-start' }}
          >
            {file ? `Файл: ${file.name}` : 'Выбрать PDF'}
            <input hidden type="file" accept="application/pdf,.pdf" onChange={onFileSelect} />
          </Button>

          <Button variant="contained" onClick={() => onParse?.(false)} disabled={parseDisabled}>
            {parsing ? 'Распознавание...' : 'Распознать акт'}
          </Button>
          <Button variant="outlined" onClick={() => onParse?.(true)} disabled={parseDisabled}>
            {parsing ? 'Подготовка...' : 'Заполнить вручную (без API)'}
          </Button>
        </Box>
      </Paper>
    </Fade>
  );
});

export default UploadActPdfParsePanel;
