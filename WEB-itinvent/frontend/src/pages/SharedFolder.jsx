import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import { myFilesAPI } from '../api/myFiles';
import { formatFileSize } from '../lib/myFilesPreview';

const TEXT = '#0f172a';
const MUTED = '#64748b';
const ACCENT = '#0b70d7';
const PANEL_BG = '#ffffff';
const PAGE_TOP = '#f4f7fb';
const PAGE_BOTTOM = '#e8eef5';

const resolveError = (error) => {
  if (Number(error?.response?.status) === 429) {
    return 'Слишком много запросов. Попробуйте через несколько минут.';
  }
  const status = Number(error?.response?.status || 0);
  if (!status || status >= 500) return 'Не удалось связаться с сервером. Повторите попытку позже.';
  return 'Файлы недоступны — ссылка отключена или срок хранения истёк.';
};

const resolveDownloadError = (error) => {
  if (!error?.response) return 'Не удалось начать скачивание. Попробуйте ещё раз.';
  if (Number(error.response.status) === 429) {
    return 'Слишком много запросов. Попробуйте через несколько минут.';
  }
  const status = Number(error.response.status || 0);
  if (status >= 500) return 'Не удалось связаться с сервером. Попробуйте повторить скачивание позже.';
  return 'Файл недоступен — ссылка отключена или срок хранения истёк.';
};

const FILES_PAGE_SIZE = 200;

export default function SharedFolder() {
  const { token = '' } = useParams();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [downloadingId, setDownloadingId] = useState('');
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [visibleCount, setVisibleCount] = useState(FILES_PAGE_SIZE);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setDownloadError('');
    setVisibleCount(FILES_PAGE_SIZE);
    myFilesAPI.getPublicFolder(token)
      .then((data) => { if (!cancelled) setPayload(data); })
      .catch((requestError) => { if (!cancelled) setLoadError(resolveError(requestError)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, reloadTick]);

  const handleDownload = async (file) => {
    if (downloadingId || downloadingAll) return;
    setDownloadingId(String(file.id));
    setDownloadError('');
    try {
      const grant = await myFilesAPI.createPublicFolderDownloadGrant(token, file.id);
      const url = myFilesAPI.buildDownloadGrantUrl(grant?.download_path);
      if (!url || !myFilesAPI.triggerNativeDownload(url)) {
        throw new Error('download failed');
      }
    } catch (requestError) {
      setDownloadError(resolveDownloadError(requestError));
    } finally {
      setDownloadingId('');
    }
  };

  const handleDownloadAll = async () => {
    if (downloadingId || downloadingAll) return;
    setDownloadingAll(true);
    setDownloadError('');
    try {
      const grant = await myFilesAPI.createPublicFolderArchiveGrant(token);
      const url = myFilesAPI.buildDownloadGrantUrl(grant?.download_path);
      if (!url || !myFilesAPI.triggerNativeDownload(url)) {
        throw new Error('download failed');
      }
    } catch (requestError) {
      setDownloadError(resolveDownloadError(requestError));
    } finally {
      setDownloadingAll(false);
    }
  };

  const items = Array.isArray(payload?.items) ? payload.items : [];
  const visibleItems = items.slice(0, visibleCount);
  const hiddenCount = items.length - visibleItems.length;

  return (
    <Box
      data-testid="shared-folder-page"
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        color: TEXT,
        background: `linear-gradient(180deg, ${PAGE_TOP} 0%, ${PAGE_BOTTOM} 100%)`,
      }}
    >
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
          borderColor: alpha(TEXT, 0.06),
          bgcolor: alpha(PANEL_BG, 0.82),
          backdropFilter: 'blur(10px)',
        }}
      >
        <Typography component="div" sx={{ fontWeight: 800, letterSpacing: '0.08em', fontSize: 13 }}>
          HUB-IT
        </Typography>
        <Typography variant="body2" sx={{ color: MUTED, fontWeight: 500 }}>
          {payload?.is_selection ? 'Публичная ссылка' : 'Общая папка'}
        </Typography>
      </Box>

      <Box sx={{ flex: 1, px: { xs: 2, sm: 3 }, py: { xs: 3, sm: 4 }, maxWidth: 760, width: '100%', mx: 'auto' }}>
        {loading ? (
          <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="center" sx={{ py: 8 }}>
            <CircularProgress size={24} />
            <Typography sx={{ color: MUTED }}>Загрузка…</Typography>
          </Stack>
        ) : null}

        {!loading && loadError ? (
          <Alert
            severity="warning"
            sx={{ maxWidth: 520, mx: 'auto' }}
            action={(
              <Button size="small" onClick={() => setReloadTick((tick) => tick + 1)}>
                Повторить
              </Button>
            )}
          >
            {loadError}
          </Alert>
        ) : null}

        {!loading && !loadError && payload ? (
          <Paper
            elevation={0}
            sx={{
              borderRadius: '20px',
              bgcolor: PANEL_BG,
              border: `1px solid ${alpha(TEXT, 0.06)}`,
              boxShadow: `0 18px 48px ${alpha(TEXT, 0.1)}`,
              overflow: 'hidden',
            }}
          >
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: { xs: 2, sm: 3 }, py: 2, borderBottom: `1px solid ${alpha(TEXT, 0.06)}` }}>
              <Box
                sx={{
                  width: 44,
                  height: 44,
                  borderRadius: '12px',
                  display: 'grid',
                  placeItems: 'center',
                  bgcolor: alpha('#ed6c02', 0.12),
                  color: '#ed6c02',
                }}
              >
                <FolderOutlinedIcon />
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography component="h1" sx={{ fontWeight: 800, fontSize: '1.1rem', wordBreak: 'break-word' }}>
                  {payload.folder_name || 'Папка'}
                </Typography>
                <Typography variant="body2" sx={{ color: MUTED }}>
                  {items.length > 0 ? `Файлов: ${items.length}` : 'Нет доступных файлов'}
                </Typography>
              </Box>
              {items.length > 0 && !payload.is_selection ? (
                downloadingAll ? (
                  <CircularProgress size={20} />
                ) : (
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<DownloadOutlinedIcon />}
                    onClick={() => void handleDownloadAll()}
                    data-testid="shared-folder-download-all"
                    sx={{ textTransform: 'none', fontWeight: 700, flexShrink: 0 }}
                  >
                    Скачать всё (.zip)
                  </Button>
                )
              ) : null}
            </Stack>

            {downloadError ? (
              <Alert
                severity="warning"
                onClose={() => setDownloadError('')}
                sx={{ mx: { xs: 2, sm: 3 }, mt: 1.5 }}
              >
                {downloadError}
              </Alert>
            ) : null}

            {items.length === 0 ? (
              <Typography align="center" sx={{ color: MUTED, py: 5 }}>
                Папка пуста.
              </Typography>
            ) : (
              <>
              {visibleItems.map((file) => (
                <Stack
                  key={file.id}
                  direction="row"
                  spacing={1.25}
                  alignItems="center"
                  data-testid={`shared-folder-file-${file.id}`}
                  sx={{
                    px: { xs: 2, sm: 3 },
                    py: 1.25,
                    borderBottom: `1px solid ${alpha(TEXT, 0.05)}`,
                  }}
                >
                  <InsertDriveFileOutlinedIcon sx={{ color: MUTED, fontSize: 20 }} />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: 'break-word' }}>
                      {file.file_name}
                    </Typography>
                    <Typography variant="caption" sx={{ color: MUTED }}>
                      {[file.relative_path, formatFileSize(file.size_bytes)].filter(Boolean).join(' · ')}
                    </Typography>
                  </Box>
                  {file.preview_available ? (
                    <Tooltip title="Просмотреть">
                      <IconButton
                        size="small"
                        component="a"
                        href={myFilesAPI.buildPublicFolderPreviewUrl(token, file.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid={`shared-folder-preview-${file.id}`}
                        sx={{ color: ACCENT }}
                      >
                        <VisibilityOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  ) : null}
                  {downloadingId === String(file.id) ? (
                    <CircularProgress size={20} />
                  ) : (
                    <Tooltip title="Скачать">
                      <IconButton
                        size="small"
                        onClick={() => void handleDownload(file)}
                        data-testid={`shared-folder-download-${file.id}`}
                        sx={{ color: ACCENT }}
                      >
                        <DownloadOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Stack>
              ))}
              {hiddenCount > 0 ? (
                <Box sx={{ px: { xs: 2, sm: 3 }, py: 2, textAlign: 'center' }}>
                  <Button
                    size="small"
                    onClick={() => setVisibleCount((count) => count + FILES_PAGE_SIZE)}
                    sx={{ textTransform: 'none', fontWeight: 700 }}
                  >
                    Показать ещё {Math.min(hiddenCount, FILES_PAGE_SIZE)} из {hiddenCount}
                  </Button>
                </Box>
              ) : null}
              </>
            )}
          </Paper>
        ) : null}
      </Box>
    </Box>
  );
}
