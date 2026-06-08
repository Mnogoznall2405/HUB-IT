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
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import { myFilesAPI } from '../api/myFiles';
import { getMailAttachmentVisual } from '../components/mail/mailAttachmentVisuals';
import MailOfficePreviewTeaser from '../components/mail/MailOfficePreviewTeaser';
import {
  getOfficeAttachmentSourceKind,
  normalizeAttachmentPreviewMetadata,
} from '../components/mail/mailMessageFileActions';
import { parseExcelWorkbookFromBlob } from '../lib/excelPreview';

const MailPdfPreviewSurface = lazy(() => import('../components/mail/MailPdfPreviewSurface'));
const MailExcelPreviewGrid = lazy(() => import('../components/mail/MailExcelPreviewGrid'));

const TEXT = '#111827';
const MUTED = '#64748b';
const PAGE_BG = '#eef2f6';
const PANEL_BG = '#ffffff';
const WARNING_TEXT = '#92400e';
const WARNING_BORDER = '#fed7aa';
const WARNING_BG = '#fff7ed';

const RATE_LIMIT_MESSAGE = 'Слишком много запросов. Попробуйте скачать через несколько минут.';
const PREVIEW_UNAVAILABLE_MESSAGE = 'Предпросмотр не удалось подготовить. Файл можно скачать по этой ссылке.';

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

const isRateLimitedError = (error) => Number(error?.response?.status) === 429;

const resolvePublicFileError = (error) => {
  if (isRateLimitedError(error)) return RATE_LIMIT_MESSAGE;
  return 'Файл недоступен или срок хранения истёк.';
};

const resolvePreviewError = (error) => {
  if (isRateLimitedError(error)) return RATE_LIMIT_MESSAGE;
  const detail = String(error?.response?.data?.detail || '').trim();
  if (!detail || /my files request failed/i.test(detail) || /preview is temporarily unavailable/i.test(detail)) {
    return PREVIEW_UNAVAILABLE_MESSAGE;
  }
  return detail;
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

function FileFallbackPanel({ payload, message = '', tone = 'neutral' }) {
  const attachmentVisual = useMemo(
    () => getMailAttachmentVisual({ name: payload?.file_name, content_type: payload?.mime_type }),
    [payload?.file_name, payload?.mime_type],
  );
  const AttachmentIcon = attachmentVisual.Icon;
  const isWarning = tone === 'warning';

  return (
    <Stack
      data-testid="shared-file-fallback"
      spacing={2.2}
      alignItems="center"
      sx={{
        width: '100%',
        maxWidth: 520,
        mx: 'auto',
        textAlign: 'center',
        color: TEXT,
      }}
    >
      {message ? (
        <Alert
          severity={isWarning ? 'warning' : 'info'}
          sx={{
            width: '100%',
            borderRadius: '8px',
            border: `1px solid ${isWarning ? WARNING_BORDER : '#bfdbfe'}`,
            bgcolor: isWarning ? WARNING_BG : '#eff6ff',
            color: isWarning ? WARNING_TEXT : '#1e3a8a',
            '& .MuiAlert-icon': { color: isWarning ? '#f59e0b' : '#2563eb' },
            '& .MuiAlert-message': { color: 'inherit', fontWeight: 600 },
          }}
        >
          {message}
        </Alert>
      ) : null}

      <Paper
        elevation={0}
        sx={{
          width: 122,
          height: 122,
          borderRadius: '22px',
          bgcolor: PANEL_BG,
          boxShadow: '0 24px 70px rgba(15, 23, 42, 0.16)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <AttachmentIcon sx={{ fontSize: 58, color: attachmentVisual.color }} />
      </Paper>

      <Stack spacing={0.6} alignItems="center" sx={{ px: 2 }}>
        <Typography variant="subtitle1" sx={{ color: TEXT, fontWeight: 800, lineHeight: 1.25 }}>
          {attachmentVisual.label || 'Файл'}
        </Typography>
        <Typography variant="body2" sx={{ color: MUTED, lineHeight: 1.45 }}>
          {formatFileSize(payload?.size_bytes)}
          {payload?.preview_available === false ? ' · предпросмотр недоступен' : ''}
        </Typography>
      </Stack>
    </Stack>
  );
}

function SharedFilePreviewTeaserBody({
  payload,
  excelLoading,
  excelWorkbook,
}) {
  const attachmentVisual = useMemo(
    () => getMailAttachmentVisual({ name: payload?.file_name, content_type: payload?.mime_type }),
    [payload?.file_name, payload?.mime_type],
  );
  const AttachmentIcon = attachmentVisual.Icon;

  if (excelLoading) {
    return <Skeleton variant="rectangular" height={280} sx={{ borderRadius: '8px' }} />;
  }

  if (excelWorkbook) {
    return (
      <Suspense fallback={<Skeleton variant="rectangular" height={280} sx={{ borderRadius: '8px' }} />}>
        <MailExcelPreviewGrid workbook={excelWorkbook} compact />
      </Suspense>
    );
  }

  return (
    <Stack
      spacing={1.2}
      alignItems="center"
      justifyContent="center"
      sx={{
        minHeight: 280,
        px: 2,
        py: 3,
        bgcolor: '#fff',
        borderRadius: '8px',
        border: '1px solid #e5e7eb',
      }}
    >
      <AttachmentIcon sx={{ fontSize: 54, color: attachmentVisual.color }} />
      <Typography variant="subtitle1" sx={{ color: TEXT, fontWeight: 800, textAlign: 'center' }}>
        {attachmentVisual.label || 'Документ'}
      </Typography>
      <Typography variant="body2" sx={{ color: MUTED, textAlign: 'center', maxWidth: 360 }}>
        Наведите курсор и нажмите «Просмотреть» для полного просмотра
      </Typography>
    </Stack>
  );
}

function PreviewPanel({ payload, token }) {
  const previewKind = String(payload?.preview_kind || 'unsupported');
  const previewUrl = myFilesAPI.buildPublicPreviewContentUrl(token);
  const sourceKind = useMemo(
    () => getOfficeAttachmentSourceKind({
      filename: payload?.file_name,
      contentType: payload?.mime_type,
    }),
    [payload?.file_name, payload?.mime_type],
  );
  const isDeferredDocumentPreview = previewKind === 'pdf' || previewKind === 'office_pdf';
  const [fullPreviewOpen, setFullPreviewOpen] = useState(false);
  const [previewMeta, setPreviewMeta] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [excelWorkbook, setExcelWorkbook] = useState(null);
  const [excelLoading, setExcelLoading] = useState(false);

  useEffect(() => {
    if (!payload?.preview_available || fullPreviewOpen || !isDeferredDocumentPreview || sourceKind !== 'excel') {
      return undefined;
    }

    let cancelled = false;
    setExcelLoading(true);
    setExcelWorkbook(null);

    fetch(myFilesAPI.buildPublicDownloadUrl(token))
      .then((response) => {
        if (!response.ok) throw new Error('download failed');
        return response.blob();
      })
      .then((blob) => parseExcelWorkbookFromBlob(blob))
      .then((workbook) => {
        if (!cancelled) setExcelWorkbook(workbook);
      })
      .catch(() => {
        if (!cancelled) setExcelWorkbook(null);
      })
      .finally(() => {
        if (!cancelled) setExcelLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fullPreviewOpen, isDeferredDocumentPreview, payload?.preview_available, sourceKind, token]);

  useEffect(() => {
    if (!payload?.preview_available || !fullPreviewOpen || !isDeferredDocumentPreview) {
      return undefined;
    }
    if (sourceKind === 'excel' && excelWorkbook) {
      setPreviewLoading(false);
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
          setPreviewError(resolvePreviewError(requestError));
        }
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    excelWorkbook,
    fullPreviewOpen,
    isDeferredDocumentPreview,
    payload?.preview_available,
    sourceKind,
    token,
  ]);

  if (!payload?.preview_available) {
    return (
      <FileFallbackPanel
        payload={payload}
        message="Для этого файла доступно скачивание. Предпросмотр не поддерживается или ещё не подготовлен."
      />
    );
  }

  if (isDeferredDocumentPreview && !fullPreviewOpen) {
    return (
      <Box sx={{ width: '100%', maxWidth: 920, mx: 'auto' }}>
        <Paper
          elevation={0}
          sx={{
            p: { xs: 1, sm: 1.5 },
            bgcolor: PANEL_BG,
            borderRadius: '8px',
            boxShadow: '0 20px 64px rgba(15, 23, 42, 0.16)',
            color: TEXT,
          }}
        >
          <MailOfficePreviewTeaser
            onOpenFull={() => setFullPreviewOpen(true)}
            compact={false}
            alwaysShowAction
          >
            <SharedFilePreviewTeaserBody
              payload={payload}
              excelLoading={excelLoading}
              excelWorkbook={excelWorkbook}
            />
          </MailOfficePreviewTeaser>
        </Paper>
      </Box>
    );
  }

  if (isDeferredDocumentPreview && fullPreviewOpen && previewLoading) {
    return (
      <Stack spacing={1.5} sx={{ width: '100%', maxWidth: 920, mx: 'auto' }}>
        <Skeleton variant="text" width="30%" />
        <Skeleton variant="rectangular" height={420} sx={{ borderRadius: '8px' }} />
      </Stack>
    );
  }

  if (isDeferredDocumentPreview && fullPreviewOpen && previewError) {
    return <FileFallbackPanel payload={payload} message={previewError} tone="warning" />;
  }

  if (previewKind === 'image') {
    return (
      <Box sx={{ width: '100%', maxWidth: 980, mx: 'auto', display: 'flex', justifyContent: 'center' }}>
        <Paper
          elevation={0}
          sx={{
            p: 1,
            bgcolor: PANEL_BG,
            borderRadius: '8px',
            boxShadow: '0 20px 64px rgba(15, 23, 42, 0.16)',
            maxWidth: '100%',
          }}
        >
          <Box
            component="img"
            src={previewUrl}
            alt={payload?.file_name || 'Предпросмотр файла'}
            sx={{
              display: 'block',
              maxWidth: '100%',
              maxHeight: 'calc(100dvh - 180px)',
              objectFit: 'contain',
              borderRadius: '6px',
            }}
          />
        </Paper>
      </Box>
    );
  }

  if (isDeferredDocumentPreview && fullPreviewOpen) {
    const resolvedSourceKind = previewMeta?.sourceKind || sourceKind;

    return (
      <Box sx={{ width: '100%', maxWidth: 980, mx: 'auto' }}>
        <Paper
          elevation={0}
          sx={{
            p: { xs: 1, sm: 1.5 },
            bgcolor: PANEL_BG,
            borderRadius: '8px',
            boxShadow: '0 20px 64px rgba(15, 23, 42, 0.16)',
            color: TEXT,
          }}
        >
          {resolvedSourceKind === 'excel' && excelWorkbook ? (
            <Suspense fallback={<Skeleton variant="rectangular" height={420} sx={{ borderRadius: '6px' }} />}>
              <MailExcelPreviewGrid workbook={excelWorkbook} compact={false} />
            </Suspense>
          ) : (
            <Suspense fallback={<Skeleton variant="rectangular" height={420} sx={{ borderRadius: '6px' }} />}>
              <MailPdfPreviewSurface
                objectUrl={previewUrl}
                filename={payload?.file_name || 'Предпросмотр PDF'}
                sourceKind={resolvedSourceKind}
                sheets={previewMeta?.sheets || []}
                pageCount={previewMeta?.pageCount || 0}
                initialPage={1}
              />
            </Suspense>
          )}
        </Paper>
      </Box>
    );
  }

  return <FileFallbackPanel payload={payload} />;
}

export default function SharedFile() {
  const { token = '' } = useParams();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copyState, setCopyState] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timerId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timerId);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setPayload(null);

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

  const countdownLabel = useMemo(
    () => formatCountdown(payload?.expires_at, nowMs),
    [payload?.expires_at, nowMs],
  );
  const countdownExpired = countdownLabel === 'Срок хранения истёк';
  const downloadUrl = useMemo(() => myFilesAPI.buildPublicDownloadUrl(token), [token]);

  const handleCopyLink = async () => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    if (!url || !navigator?.clipboard?.writeText) {
      setCopyState('Не удалось скопировать');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopyState('Ссылка скопирована');
      window.setTimeout(() => setCopyState(''), 2200);
    } catch {
      setCopyState('Не удалось скопировать');
    }
  };

  return (
    <Box
      data-testid="shared-file-page"
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: PAGE_BG,
        color: TEXT,
      }}
    >
      <Box
        component="header"
        sx={{
          px: { xs: 1.5, sm: 2.5, md: 3 },
          py: 1.25,
          bgcolor: PANEL_BG,
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'space-between',
          gap: 1.5,
          flexWrap: 'wrap',
          color: TEXT,
        }}
      >
        <Box sx={{ minWidth: 0, flex: '1 1 260px' }}>
          {loading ? (
            <Skeleton variant="text" width="60%" height={32} />
          ) : payload ? (
            <>
              <Typography
                variant="h6"
                sx={{
                  color: TEXT,
                  fontWeight: 800,
                  wordBreak: 'break-word',
                  lineHeight: 1.25,
                  letterSpacing: 0,
                }}
              >
                {payload.file_name}
              </Typography>
              <Typography variant="body2" sx={{ color: MUTED, mt: 0.25 }}>
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
              sx={{
                color: countdownExpired ? '#fff' : '#334155',
                borderColor: countdownExpired ? undefined : '#cbd5e1',
                fontWeight: 700,
                '& .MuiChip-icon': { color: countdownExpired ? '#fff' : '#64748b' },
              }}
            />
          ) : null}
          {!loading && payload ? (
            <Button
              onClick={handleCopyLink}
              variant="outlined"
              startIcon={<ContentCopyOutlinedIcon />}
              sx={{
                textTransform: 'none',
                borderRadius: '8px',
                px: 1.8,
                color: '#334155',
                borderColor: '#cbd5e1',
                bgcolor: '#fff',
                '&:hover': { borderColor: '#94a3b8', bgcolor: '#f8fafc' },
              }}
            >
              {copyState || 'Скопировать ссылку'}
            </Button>
          ) : null}
          {!loading && payload ? (
            <Button
              component="a"
              href={downloadUrl}
              download={payload.file_name || true}
              variant="contained"
              startIcon={<DownloadOutlinedIcon />}
              sx={{
                textTransform: 'none',
                borderRadius: '8px',
                px: 2.2,
                bgcolor: '#0b70d7',
                boxShadow: 'none',
                fontWeight: 800,
                '&:hover': { bgcolor: '#075fb8', boxShadow: 'none' },
              }}
            >
              Скачать
            </Button>
          ) : null}
        </Stack>
      </Box>

      <Box
        component="main"
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          px: { xs: 1.5, sm: 2.5, md: 4 },
          py: { xs: 3, sm: 4 },
          overflow: 'auto',
          color: TEXT,
        }}
      >
        {loading ? (
          <Stack direction="row" spacing={1.25} alignItems="center" sx={{ color: MUTED }}>
            <CircularProgress size={24} />
            <Typography sx={{ color: MUTED }}>Загрузка...</Typography>
          </Stack>
        ) : null}

        {!loading && error && !payload ? (
          <Alert
            severity="error"
            sx={{
              maxWidth: 560,
              width: '100%',
              borderRadius: '8px',
              border: '1px solid #fecaca',
              bgcolor: '#fef2f2',
              color: '#991b1b',
              '& .MuiAlert-icon': { color: '#dc2626' },
              '& .MuiAlert-message': { color: 'inherit', fontWeight: 700 },
            }}
          >
            {error}
          </Alert>
        ) : null}

        {!loading && payload ? (
          <Box sx={{ width: '100%' }}>
            <PreviewPanel payload={payload} token={token} />
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
