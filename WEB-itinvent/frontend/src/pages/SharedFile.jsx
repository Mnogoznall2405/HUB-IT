import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined';
import { myFilesAPI } from '../api/myFiles';
import { getMailAttachmentVisual } from '../components/mail/mailAttachmentVisuals';
import { normalizeAttachmentPreviewMetadata } from '../components/mail/mailMessageFileActions';

const MailPdfPreviewSurface = lazy(() => import('../components/mail/MailPdfPreviewSurface'));

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

const RATE_LIMIT_MESSAGE = 'Слишком много запросов. Попробуйте скачать через несколько минут.';

const isRateLimitedError = (error) => Number(error?.response?.status) === 429;

const resolvePublicFileError = (error) => {
  if (isRateLimitedError(error)) return RATE_LIMIT_MESSAGE;
  return 'Файл недоступен или срок хранения истёк.';
};

const pad2 = (value) => String(Math.max(0, value)).padStart(2, '0');

const formatCountdown = (expiresAt, nowMs) => {
  const target = new Date(String(expiresAt || '')).getTime();
  if (!Number.isFinite(target)) return '';
  const diffMs = target - nowMs;
  if (diffMs <= 0) return 'Срок хранения истёк';

  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `Доступно ещё ${days} д. ${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
  }
  return `Доступно ещё ${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
};

function SharedFilePreviewPanel({
  payload,
  token,
  previewMeta,
  previewLoading,
  previewError,
}) {
  const attachmentVisual = useMemo(
    () => getMailAttachmentVisual({ name: payload?.file_name, content_type: payload?.mime_type }),
    [payload?.file_name, payload?.mime_type],
  );
  const AttachmentIcon = attachmentVisual.Icon;
  const previewKind = String(payload?.preview_kind || 'unsupported');
  const previewUrl = myFilesAPI.buildPublicPreviewContentUrl(token);

  if (!payload?.preview_available) {
    return (
      <Stack spacing={2} alignItems="center" sx={{ py: { xs: 4, sm: 8 } }}>
        <Box
          sx={{
            width: 120,
            height: 120,
            borderRadius: 3,
            bgcolor: '#fff',
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <AttachmentIcon sx={{ fontSize: 56, color: attachmentVisual.color }} />
        </Box>
        <Stack spacing={0.5} alignItems="center" sx={{ maxWidth: 420, px: 2 }}>
          <Typography variant="body1" sx={{ fontWeight: 600, textAlign: 'center' }}>
            {attachmentVisual.label}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
            {formatFileSize(payload?.size_bytes)} · предпросмотр недоступен
          </Typography>
        </Box>
      </Stack>
    );
  }

  if (previewLoading) {
    return (
      <Stack spacing={1.5} sx={{ width: '100%', maxWidth: 920, mx: 'auto' }}>
        <Skeleton variant="text" width="30%" />
        <Skeleton variant="rectangular" height={420} sx={{ borderRadius: 2 }} />
      </Stack>
    );
  }

  if (previewError) {
    return (
      <Stack spacing={2} alignItems="center" sx={{ width: '100%', maxWidth: 640, mx: 'auto', py: 4 }}>
        <Alert severity="warning" sx={{ width: '100%' }}>{previewError}</Alert>
        <Box
          sx={{
            width: 96,
            height: 96,
            borderRadius: 2,
            bgcolor: '#fff',
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <AttachmentIcon sx={{ fontSize: 44, color: attachmentVisual.color }} />
        </Box>
      </Stack>
    );
  }

  if (previewKind === 'image') {
    return (
      <Box
        sx={{
          width: '100%',
          maxWidth: 920,
          mx: 'auto',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <Paper
          elevation={0}
          sx={{
            p: 1,
            bgcolor: '#fff',
            borderRadius: 2,
            boxShadow: '0 12px 40px rgba(15, 23, 42, 0.12)',
            maxWidth: '100%',
          }}
        >
          <Box
            component="img"
            src={previewUrl}
            alt={payload?.file_name || 'предпросмотр'}
            sx={{
              display: 'block',
              maxWidth: '100%',
              maxHeight: 'calc(100dvh - 180px)',
              objectFit: 'contain',
              borderRadius: 1,
            }}
          />
        </Paper>
      </Box>
    );
  }

  if (previewKind === 'pdf' || previewKind === 'office_pdf') {
    return (
      <Box sx={{ width: '100%', maxWidth: 920, mx: 'auto' }}>
        <Paper
          elevation={0}
          sx={{
            p: { xs: 1, sm: 1.5 },
            bgcolor: '#fff',
            borderRadius: 2,
            boxShadow: '0 12px 40px rgba(15, 23, 42, 0.12)',
          }}
        >
          <Suspense fallback={<Skeleton variant="rectangular" height={420} sx={{ borderRadius: 1 }} />}>
            <MailPdfPreviewSurface
              objectUrl={previewUrl}
              filename={payload?.file_name || 'предпросмотр PDF'}
              sourceKind={previewMeta?.sourceKind || ''}
              sheets={previewMeta?.sheets || []}
              pageCount={previewMeta?.pageCount || 0}
              initialPage={1}
            />
          </Suspense>
        </Paper>
      </Box>
    );
  }

  return null;
}

export default function SharedFile() {
  const { token = '' } = useParams();
  const [payload, setPayload] = useState(null);
  const [previewMeta, setPreviewMeta] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timerId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timerId);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setPreviewMeta(null);
    setPreviewError('');
    myFilesAPI.getPublicFile(token)
      .then((data) => {
        if (!cancelled) setPayload(data);
      })
      .catch((requestError) => {
        if (!cancelled) setError(resolvePublicFileError(requestError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!payload?.preview_available) {
      setPreviewLoading(false);
      setPreviewMeta(null);
      setPreviewError('');
      return undefined;
    }

    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError('');
    myFilesAPI.getPublicPreviewMeta(token)
      .then((data) => {
        if (!cancelled) {
          setPreviewMeta(normalizeAttachmentPreviewMetadata(data));
        }
      })
      .catch((requestError) => {
        if (!cancelled) {
          const detail = requestError?.response?.data?.detail;
          setPreviewError(typeof detail === 'string' && detail.trim()
            ? detail
            : 'Не удалось подготовить предпросмотр.');
        }
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [payload?.preview_available, token]);

  const countdownLabel = useMemo(
    () => formatCountdown(payload?.expires_at, nowMs),
    [payload?.expires_at, nowMs],
  );
  const countdownExpired = countdownLabel === 'Срок хранения истёк';

  return (
    <Box sx={{
      minHeight: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      bgcolor: '#eef1f4',
    }}>
      <Box
        component="header"
        sx={{
          px: { xs: 1.5, sm: 2.5 },
          py: 1.25,
          bgcolor: '#fff',
          borderBottom: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'space-between',
          gap: 1.5,
          flexWrap: 'wrap',
        }}
      >
        <Box sx={{ minWidth: 0, flex: '1 1 240px' }}>
          {loading ? (
            <Skeleton variant="text" width="60%" height={32} />
          ) : payload ? (
            <>
              <Typography
                variant="h6"
                sx={{
                  fontWeight: 600,
                  wordBreak: 'break-word',
                  lineHeight: 1.3,
                }}
              >
                {payload.file_name}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {formatFileSize(payload.size_bytes)}
              </Typography>
            </>
          ) : null}
        </Box>

        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{ flexWrap: 'wrap', justifyContent: { xs: 'flex-start', sm: 'flex-end' } }}
        >
          {!loading && payload && countdownLabel ? (
            <Chip
              icon={<AccessTimeOutlinedIcon />}
              label={countdownLabel}
              size="small"
              color={countdownExpired ? 'error' : 'default'}
              variant={countdownExpired ? 'filled' : 'outlined'}
              sx={{ fontWeight: 600 }}
            />
          ) : null}
          {!loading && payload ? (
            <Button
              component="a"
              href={myFilesAPI.buildPublicDownloadUrl(token)}
              download={payload.file_name || true}
              variant="contained"
              startIcon={<DownloadOutlinedIcon />}
              sx={{
                textTransform: 'none',
                borderRadius: 2,
                px: 2,
                boxShadow: 'none',
              }}
            >
              Скачать
            </Button>
          ) : null}
        </Stack>
      </Box>

      <Box sx={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: { xs: 1, sm: 2 },
        py: { xs: 2, sm: 3 },
        overflow: 'auto',
      }}>
        {loading ? (
          <Stack direction="row" spacing={1.25} alignItems="center">
            <CircularProgress size={24} />
            <Typography color="text.secondary">Загрузка...</Typography>
          </Stack>
        ) : null}

        {!loading && error && !payload ? (
          <Alert severity="error" sx={{ maxWidth: 560, width: '100%' }}>{error}</Alert>
        ) : null}

        {!loading && payload ? (
          <Box sx={{ width: '100%' }}>
            {error ? <Alert severity="warning" sx={{ maxWidth: 920, mx: 'auto', mb: 2 }}>{error}</Alert> : null}
            <SharedFilePreviewPanel
              payload={payload}
              token={token}
              previewMeta={previewMeta}
              previewLoading={previewLoading}
              previewError={previewError}
            />
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
