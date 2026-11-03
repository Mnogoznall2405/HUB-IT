import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  Stack,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';

import { myFilesOfficeAPI } from '../../api/myFilesOffice';
import { formatFileSize } from '../../lib/myFilesPreview';

const formatTime = (value) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const errorMessage = (err, fallback) => String(err?.response?.data?.detail || err?.message || fallback);

const fileNameFromDisposition = (header, fallback) => {
  const value = String(header || '');
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value);
  if (encoded) {
    try { return decodeURIComponent(encoded[1]); } catch { /* fall through to the plain name */ }
  }
  const plain = /filename="?([^";]+)"?/i.exec(value);
  return plain ? plain[1] : fallback;
};

const saveBlob = (blob, fileName) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export default function MyFilesVersionsDialog({ open, file, onClose }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const fileId = String(file?.id || '');
  const fileName = String(file?.original_file_name || 'файл');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError('');
    try {
      const data = await myFilesOfficeAPI.listVersions(fileId, { signal });
      if (!signal?.aborted) setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      if (!signal?.aborted) setError(errorMessage(err, 'Не удалось загрузить версии'));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [fileId]);

  useEffect(() => {
    if (!open || !fileId) return undefined;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [fileId, load, open]);

  const download = async (version) => {
    setBusyId(version.id);
    setError('');
    try {
      const response = await myFilesOfficeAPI.downloadVersion(fileId, version.id);
      saveBlob(
        response.data,
        fileNameFromDisposition(response.headers?.['content-disposition'], `${fileName} (версия ${version.version_no})`),
      );
    } catch (err) {
      setError(errorMessage(err, 'Не удалось скачать версию'));
    } finally {
      setBusyId('');
    }
  };

  const restore = async (version) => {
    setBusyId(version.id);
    setError('');
    try {
      await myFilesOfficeAPI.restoreVersion(fileId, version.id);
      onClose?.(true);
    } catch (err) {
      setError(errorMessage(err, 'Не удалось вернуть версию'));
    } finally {
      setBusyId('');
    }
  };

  return (
    <Dialog open={Boolean(open)} onClose={() => onClose?.(false)} maxWidth="sm" fullWidth fullScreen={isMobile}>
      <DialogTitle sx={{ pb: 1 }}>
        <Typography component="div" variant="h6" sx={{ fontWeight: 700 }}>Предыдущие версии</Typography>
        <Typography variant="body2" color="text.secondary" noWrap>{fileName}</Typography>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {loading ? (
          <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress size={28} /></Stack>
        ) : items.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            Версий пока нет: они появляются после первого сохранения в редакторе.
          </Typography>
        ) : (
          <List dense disablePadding>
            {items.map((item) => (
              <ListItem
                key={item.id}
                divider
                secondaryAction={(
                  <Stack direction="row" spacing={0.5}>
                    <Button size="small" disabled={Boolean(busyId)} onClick={() => download(item)} data-testid={`my-files-version-download-${item.version_no}`}>
                      Скачать
                    </Button>
                    <Button size="small" disabled={Boolean(busyId)} onClick={() => restore(item)} data-testid={`my-files-version-restore-${item.version_no}`}>
                      Вернуть
                    </Button>
                  </Stack>
                )}
              >
                <Stack spacing={0.25} sx={{ minWidth: 0, pr: 22 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    Версия {item.version_no} · {formatFileSize(item.size_bytes)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Заменена {formatTime(item.replaced_at)}{item.replaced_by ? ` · ${item.replaced_by}` : ''}
                  </Typography>
                </Stack>
              </ListItem>
            ))}
          </List>
        )}
        {error ? <Alert severity="error" sx={{ m: 2 }}>{error}</Alert> : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose?.(false)}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
}
