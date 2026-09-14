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

const TEXT = '#0f172a';
const MUTED = '#64748b';
const ACCENT = '#0b70d7';
const PANEL_BG = '#ffffff';
const PAGE_TOP = '#f4f7fb';
const PAGE_BOTTOM = '#e8eef5';

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

const resolveError = (error) => {
  if (Number(error?.response?.status) === 429) {
    return 'Слишком много запросов. Попробуйте через несколько минут.';
  }
  const status = Number(error?.response?.status || 0);
  if (!status || status >= 500) return 'Не удалось связаться с сервером. Повторите попытку позже.';
  return 'Папка недоступна — ссылка отключена или срок хранения истёк.';
};

export default function SharedFolder() {
  const { token = '' } = useParams();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloadingId, setDownloadingId] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    myFilesAPI.getPublicFolder(token)
      .then((data) => { if (!cancelled) setPayload(data); })
      .catch((requestError) => { if (!cancelled) setError(resolveError(requestError)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  const handleDownload = async (file) => {
    if (downloadingId) return;
    setDownloadingId(String(file.id));
    try {
      const grant = await myFilesAPI.createPublicFolderDownloadGrant(token, file.id);
      const url = myFilesAPI.buildDownloadGrantUrl(grant?.download_path);
      if (!url || !myFilesAPI.triggerNativeDownload(url)) {
        throw new Error('download failed');
      }
    } catch (requestError) {
      setError(resolveError(requestError));
    } finally {
      setDownloadingId('');
    }
  };

  const items = Array.isArray(payload?.items) ? payload.items : [];

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
          Общая папка
        </Typography>
      </Box>

      <Box sx={{ flex: 1, px: { xs: 2, sm: 3 }, py: { xs: 3, sm: 4 }, maxWidth: 760, width: '100%', mx: 'auto' }}>
        {loading ? (
          <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="center" sx={{ py: 8 }}>
            <CircularProgress size={24} />
            <Typography sx={{ color: MUTED }}>Загрузка…</Typography>
          </Stack>
        ) : null}

        {!loading && error ? (
          <Alert severity="warning" sx={{ maxWidth: 520, mx: 'auto' }}>{error}</Alert>
        ) : null}

        {!loading && !error && payload ? (
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
              <Box sx={{ minWidth: 0 }}>
                <Typography component="h1" sx={{ fontWeight: 800, fontSize: '1.1rem', wordBreak: 'break-word' }}>
                  {payload.folder_name || 'Папка'}
                </Typography>
                <Typography variant="body2" sx={{ color: MUTED }}>
                  {items.length > 0 ? `Файлов: ${items.length}` : 'В папке нет доступных файлов'}
                </Typography>
              </Box>
            </Stack>

            {items.length === 0 ? (
              <Typography align="center" sx={{ color: MUTED, py: 5 }}>
                Папка пуста.
              </Typography>
            ) : (
              items.map((file) => (
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
              ))
            )}
          </Paper>
        ) : null}
      </Box>
    </Box>
  );
}
