import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined';
import CheckOutlinedIcon from '@mui/icons-material/CheckOutlined';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import { myFilesAPI } from '../api/myFiles';
import DocumentPreviewDialog from '../components/documentPreview/DocumentPreviewDialog';
import { getMailAttachmentVisual } from '../components/mail/mailAttachmentVisuals';
import MailOfficePreviewTeaser from '../components/mail/MailOfficePreviewTeaser';
import {
  getOfficeAttachmentSourceKind,
  normalizeAttachmentPreviewMetadata,
} from '../components/mail/mailMessageFileActions';
import { parseExcelWorkbookFromBlob } from '../lib/excelPreview';

const MailPdfPreviewSurface = lazy(() => import('../components/mail/MailPdfPreviewSurface'));
const MailExcelPreviewGrid = lazy(() => import('../components/mail/MailExcelPreviewGrid'));

const TEXT = '#0f172a';
const MUTED = '#64748b';
const ACCENT = '#0b70d7';
const PANEL_BG = '#ffffff';
const PAGE_TOP = '#f4f7fb';
const PAGE_BOTTOM = '#e8eef5';

const RATE_LIMIT_MESSAGE = 'Слишком много запросов. Попробуйте скачать через несколько минут.';
const PREVIEW_UNAVAILABLE_MESSAGE = 'Предпросмотр не удалось подготовить. Файл можно скачать.';

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

const pressableSx = {
  textTransform: 'none',
  transitionProperty: 'transform, background-color, border-color, box-shadow, color',
  transitionDuration: '160ms',
  transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  '&:active': { transform: 'scale(0.96)' },
  '@media (prefers-reduced-motion: reduce)': {
    transition: 'none',
    '&:active': { transform: 'none' },
  },
};

function BrandHeader() {
  return (
    <Box
      component="header"
      sx={{
        px: { xs: 2, sm: 3 },
        py: 1.25,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1.5,
        borderBottom: '1px solid',
        borderColor: alpha('#0f172a', 0.06),
        bgcolor: alpha(PANEL_BG, 0.82),
        backdropFilter: 'blur(10px)',
      }}
    >
      <Typography
        component="div"
        sx={{
          fontWeight: 800,
          letterSpacing: '0.08em',
          fontSize: 13,
          color: TEXT,
        }}
      >
        HUB-IT
      </Typography>
      <Typography variant="body2" sx={{ color: MUTED, fontWeight: 500 }}>
        Общий файл
      </Typography>
    </Box>
  );
}

function SharedDownloadCard({
  payload,
  downloadUrl,
  countdownLabel,
  countdownExpired,
  copyState,
  onCopyLink,
}) {
  const attachmentVisual = useMemo(
    () => getMailAttachmentVisual({ name: payload?.file_name, content_type: payload?.mime_type }),
    [payload?.file_name, payload?.mime_type],
  );
  const AttachmentIcon = attachmentVisual.Icon;
  const copied = copyState === 'copied';

  return (
    <Paper
      elevation={0}
      data-testid="shared-file-fallback"
      sx={{
        width: '100%',
        maxWidth: 440,
        mx: 'auto',
        px: { xs: 2.5, sm: 3.5 },
        py: { xs: 3, sm: 3.5 },
        borderRadius: '28px',
        bgcolor: PANEL_BG,
        border: `1px solid ${alpha('#0f172a', 0.06)}`,
        boxShadow: `
          0 1px 0 ${alpha('#fff', 0.8)} inset,
          0 18px 50px ${alpha('#0f172a', 0.1)}
        `,
      }}
    >
      <Stack spacing={2.5} alignItems="center" sx={{ textAlign: 'center' }}>
        <Box
          sx={{
            width: 88,
            height: 88,
            borderRadius: '24px',
            display: 'grid',
            placeItems: 'center',
            bgcolor: alpha(attachmentVisual.color || ACCENT, 0.12),
            color: attachmentVisual.color || ACCENT,
            outline: `1px solid ${alpha('#000', 0.06)}`,
          }}
        >
          <AttachmentIcon sx={{ fontSize: 42 }} />
        </Box>

        <Stack spacing={0.75} sx={{ width: '100%', minWidth: 0 }}>
          <Typography
            component="h1"
            sx={{
              color: TEXT,
              fontWeight: 800,
              fontSize: { xs: '1.25rem', sm: '1.4rem' },
              lineHeight: 1.25,
              wordBreak: 'break-word',
            }}
          >
            {payload?.file_name || 'Файл'}
          </Typography>
          <Typography variant="body2" sx={{ color: MUTED }}>
            {[attachmentVisual.label || 'Файл', formatFileSize(payload?.size_bytes)].filter(Boolean).join(' · ')}
          </Typography>
        </Stack>

        {countdownLabel ? (
          <Stack
            direction="row"
            spacing={0.75}
            alignItems="center"
            justifyContent="center"
            sx={{
              px: 1.25,
              py: 0.65,
              borderRadius: '999px',
              bgcolor: countdownExpired ? alpha('#dc2626', 0.08) : alpha('#0f172a', 0.04),
              color: countdownExpired ? '#b91c1c' : MUTED,
            }}
          >
            <AccessTimeOutlinedIcon sx={{ fontSize: 16 }} />
            <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: 0.01 }}>
              {countdownLabel}
            </Typography>
          </Stack>
        ) : null}

        <Stack spacing={1.25} sx={{ width: '100%', pt: 0.5 }}>
          <Button
            component="a"
            href={downloadUrl}
            download={payload?.file_name || true}
            variant="contained"
            size="large"
            startIcon={<DownloadOutlinedIcon />}
            fullWidth
            sx={{
              ...pressableSx,
              minHeight: 48,
              borderRadius: '14px',
              bgcolor: ACCENT,
              fontWeight: 800,
              fontSize: '1rem',
              boxShadow: `0 10px 24px ${alpha(ACCENT, 0.28)}`,
              '&:hover': {
                bgcolor: '#075fb8',
                boxShadow: `0 12px 28px ${alpha(ACCENT, 0.34)}`,
              },
            }}
          >
            Скачать
          </Button>
          <Button
            onClick={onCopyLink}
            variant="outlined"
            startIcon={copied ? <CheckOutlinedIcon /> : <ContentCopyOutlinedIcon />}
            fullWidth
            color={copied ? 'success' : 'inherit'}
            sx={{
              ...pressableSx,
              minHeight: 44,
              borderRadius: '14px',
              fontWeight: 700,
              borderColor: copied ? undefined : alpha('#0f172a', 0.12),
              color: copied ? undefined : TEXT,
              bgcolor: PANEL_BG,
            }}
          >
            {copied ? 'Ссылка скопирована' : 'Скопировать ссылку'}
          </Button>
        </Stack>
      </Stack>
    </Paper>
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
    return <Skeleton variant="rectangular" height={280} sx={{ borderRadius: '12px' }} />;
  }

  if (excelWorkbook) {
    return (
      <Suspense fallback={<Skeleton variant="rectangular" height={280} sx={{ borderRadius: '12px' }} />}>
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
        borderRadius: '12px',
        border: `1px solid ${alpha('#0f172a', 0.08)}`,
      }}
    >
      <AttachmentIcon sx={{ fontSize: 54, color: attachmentVisual.color }} />
      <Typography variant="subtitle1" sx={{ color: TEXT, fontWeight: 800, textAlign: 'center' }}>
        {attachmentVisual.label || 'Документ'}
      </Typography>
      <Typography variant="body2" sx={{ color: MUTED, textAlign: 'center', maxWidth: 360 }}>
        Нажмите «Просмотреть», чтобы открыть файл
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
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
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
    let cancelled = false;
    setPreviewLoading(!(sourceKind === 'excel' && excelWorkbook));
    setPreviewError('');

    myFilesAPI.getPublicPreviewMeta(token)
      .then((data) => {
        if (!cancelled) {
          setPreviewMeta(normalizeAttachmentPreviewMetadata(data));
        }
      })
      .catch((requestError) => {
        if (!cancelled) {
          setPreviewError(sourceKind === 'excel' && excelWorkbook ? '' : resolvePreviewError(requestError));
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
    previewRefreshKey,
    sourceKind,
    token,
  ]);

  if (!payload?.preview_available) {
    return null;
  }

  if (isDeferredDocumentPreview) {
    const resolvedSourceKind = previewMeta?.sourceKind || sourceKind;
    const resolvedKind = resolvedSourceKind === 'excel' && excelWorkbook
      ? 'office_excel'
      : (previewMeta?.previewKind || previewKind);
    const triggerDownload = (url, filename) => {
      if (typeof document === 'undefined') return;
      const link = document.createElement('a');
      link.href = url;
      if (filename) link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };

    return (
      <>
        <Box sx={{ width: '100%', maxWidth: 920, mx: 'auto' }}>
          <Paper
            elevation={0}
            sx={{
              p: { xs: 1, sm: 1.5 },
              bgcolor: PANEL_BG,
              borderRadius: '20px',
              border: `1px solid ${alpha('#0f172a', 0.06)}`,
              boxShadow: `0 18px 48px ${alpha('#0f172a', 0.1)}`,
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
        <DocumentPreviewDialog
          open={fullPreviewOpen}
          title={payload?.file_name || 'Документ'}
          subtitle={resolvedSourceKind === 'excel' ? 'Excel' : 'PDF-предпросмотр'}
          kind={resolvedKind}
          sourceKind={resolvedSourceKind}
          objectUrl={previewUrl}
          excelWorkbook={excelWorkbook}
          pageCount={previewMeta?.pageCount || 0}
          sheets={previewMeta?.sheets || []}
          loading={previewLoading}
          error={previewError}
          onClose={() => setFullPreviewOpen(false)}
          onRefresh={() => {
            setPreviewMeta(null);
            setPreviewError('');
            setPreviewRefreshKey((current) => current + 1);
          }}
          onDownloadOriginal={() => triggerDownload(myFilesAPI.buildPublicDownloadUrl(token), payload?.file_name || '')}
          onDownloadPdf={() => triggerDownload(previewUrl, previewMeta?.pdfFilename || `${payload?.file_name || 'preview'}.pdf`)}
          canDownloadOriginal
          canDownloadPdf={Boolean(resolvedKind !== 'pdf')}
        />
      </>
    );
  }

  if (previewKind === 'image') {
    return (
      <Box sx={{ width: '100%', maxWidth: 980, mx: 'auto', display: 'flex', justifyContent: 'center' }}>
        <Paper
          elevation={0}
          sx={{
            p: 1,
            bgcolor: PANEL_BG,
            borderRadius: '20px',
            border: `1px solid ${alpha('#0f172a', 0.06)}`,
            boxShadow: `0 18px 48px ${alpha('#0f172a', 0.1)}`,
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
              maxHeight: 'calc(100dvh - 200px)',
              objectFit: 'contain',
              borderRadius: '14px',
              outline: `1px solid ${alpha('#000', 0.08)}`,
            }}
          />
        </Paper>
      </Box>
    );
  }

  return null;
}

export default function SharedFile() {
  const { token = '' } = useParams();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copyState, setCopyState] = useState('idle');
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
  const hasPreview = Boolean(payload?.preview_available);

  const handleCopyLink = async () => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    if (!url || !navigator?.clipboard?.writeText) {
      setCopyState('error');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 2200);
    } catch {
      setCopyState('error');
    }
  };

  return (
    <Box
      data-testid="shared-file-page"
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        color: TEXT,
        background: `linear-gradient(180deg, ${PAGE_TOP} 0%, ${PAGE_BOTTOM} 100%)`,
      }}
    >
      <BrandHeader />

      {hasPreview && !loading && payload ? (
        <Box
          sx={{
            px: { xs: 2, sm: 3 },
            py: 1.5,
            display: 'flex',
            alignItems: { xs: 'stretch', sm: 'center' },
            justifyContent: 'space-between',
            gap: 1.5,
            flexWrap: 'wrap',
            borderBottom: `1px solid ${alpha('#0f172a', 0.06)}`,
            bgcolor: alpha(PANEL_BG, 0.65),
          }}
        >
          <Box sx={{ minWidth: 0, flex: '1 1 220px' }}>
            <Typography
              component="h1"
              sx={{
                color: TEXT,
                fontWeight: 800,
                fontSize: { xs: '1.05rem', sm: '1.2rem' },
                wordBreak: 'break-word',
                lineHeight: 1.25,
              }}
            >
              {payload.file_name}
            </Typography>
            <Typography variant="body2" sx={{ color: MUTED, mt: 0.25 }}>
              {formatFileSize(payload.size_bytes)}
              {countdownLabel ? ` · ${countdownLabel}` : ''}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
            <Button
              onClick={handleCopyLink}
              variant="outlined"
              startIcon={copyState === 'copied' ? <CheckOutlinedIcon /> : <ContentCopyOutlinedIcon />}
              sx={{
                ...pressableSx,
                minHeight: 40,
                borderRadius: '12px',
                fontWeight: 700,
                borderColor: alpha('#0f172a', 0.12),
                color: TEXT,
                bgcolor: PANEL_BG,
              }}
            >
              {copyState === 'copied' ? 'Скопировано' : 'Скопировать ссылку'}
            </Button>
            <Button
              component="a"
              href={downloadUrl}
              download={payload.file_name || true}
              variant="contained"
              startIcon={<DownloadOutlinedIcon />}
              sx={{
                ...pressableSx,
                minHeight: 40,
                borderRadius: '12px',
                px: 2.2,
                bgcolor: ACCENT,
                fontWeight: 800,
                boxShadow: `0 8px 20px ${alpha(ACCENT, 0.24)}`,
                '&:hover': { bgcolor: '#075fb8' },
              }}
            >
              Скачать
            </Button>
          </Stack>
        </Box>
      ) : null}

      <Box
        component="main"
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: hasPreview ? 'flex-start' : 'center',
          justifyContent: 'center',
          px: { xs: 2, sm: 3, md: 4 },
          py: { xs: 3, sm: 4.5 },
          overflow: 'auto',
        }}
      >
        {loading ? (
          <Stack spacing={1.5} alignItems="center" sx={{ color: MUTED }}>
            <CircularProgress size={28} sx={{ color: ACCENT }} />
            <Typography sx={{ color: MUTED, fontWeight: 600 }}>Загрузка файла…</Typography>
          </Stack>
        ) : null}

        {!loading && error && !payload ? (
          <Paper
            elevation={0}
            sx={{
              width: '100%',
              maxWidth: 440,
              p: 3,
              borderRadius: '24px',
              bgcolor: PANEL_BG,
              border: `1px solid ${alpha('#dc2626', 0.14)}`,
              boxShadow: `0 18px 48px ${alpha('#0f172a', 0.08)}`,
              textAlign: 'center',
            }}
          >
            <Alert
              severity="error"
              sx={{
                borderRadius: '14px',
                justifyContent: 'center',
                bgcolor: 'transparent',
                color: '#991b1b',
                '& .MuiAlert-icon': { color: '#dc2626' },
                '& .MuiAlert-message': { fontWeight: 700, textAlign: 'left' },
              }}
            >
              {error}
            </Alert>
          </Paper>
        ) : null}

        {!loading && payload && !hasPreview ? (
          <SharedDownloadCard
            payload={payload}
            downloadUrl={downloadUrl}
            countdownLabel={countdownLabel}
            countdownExpired={countdownExpired}
            copyState={copyState}
            onCopyLink={handleCopyLink}
          />
        ) : null}

        {!loading && payload && hasPreview ? (
          <Box sx={{ width: '100%' }}>
            <PreviewPanel payload={payload} token={token} />
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
