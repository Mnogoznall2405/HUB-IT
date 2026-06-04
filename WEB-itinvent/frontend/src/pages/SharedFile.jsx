import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import { myFilesAPI } from '../api/myFiles';

const formatFileSize = (bytes) => {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let current = value;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current >= 10 || index === 0 ? current.toFixed(0) : current.toFixed(1)} ${units[index]}`;
};

const formatDateTime = (value) => {
  const text = String(value || '').trim();
  if (!text) return '-';
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const RATE_LIMIT_MESSAGE = 'Слишком много запросов. Попробуйте скачать через несколько минут.';

const isRateLimitedError = (error) => Number(error?.response?.status) === 429;

const resolvePublicFileError = (error) => {
  if (isRateLimitedError(error)) return RATE_LIMIT_MESSAGE;
  return 'Файл недоступен или срок хранения истёк.';
};

export default function SharedFile() {
  const { token = '' } = useParams();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    myFilesAPI.getPublicFile(token)
      .then((data) => {
        if (!cancelled) setPayload(data);
      })
      .catch((error) => {
        if (!cancelled) setError(resolvePublicFileError(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <Box sx={{
      minHeight: '100dvh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      bgcolor: 'background.default',
      p: 2,
    }}>
      <Paper variant="outlined" sx={{ width: '100%', maxWidth: 560, p: { xs: 2, sm: 3 }, borderRadius: 2 }}>
        {loading ? (
          <Stack direction="row" spacing={1.25} alignItems="center" justifyContent="center" sx={{ py: 4 }}>
            <CircularProgress size={24} />
            <Typography color="text.secondary">Загрузка...</Typography>
          </Stack>
        ) : null}

        {!loading && error && !payload ? (
          <Alert severity="error">{error}</Alert>
        ) : null}

        {!loading && payload ? (
          <Stack spacing={2.5}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <InsertDriveFileOutlinedIcon color="primary" />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="h5" sx={{ fontWeight: 700, wordBreak: 'break-word' }}>
                  {payload.file_name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {formatFileSize(payload.size_bytes)} · доступно до {formatDateTime(payload.expires_at)}
                </Typography>
              </Box>
            </Stack>
            {error ? <Alert severity="warning">{error}</Alert> : null}
            <Button
              component="a"
              href={myFilesAPI.buildPublicDownloadUrl(token)}
              download={payload.file_name || true}
              variant="contained"
              size="large"
              startIcon={<DownloadOutlinedIcon />}
              fullWidth
            >
              Скачать
            </Button>
          </Stack>
        ) : null}
      </Paper>
    </Box>
  );
}
