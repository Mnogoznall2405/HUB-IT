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

export default function MyFilesVersionsDialog({ open, file, onClose }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const fileId = String(file?.id || '');
  const fileName = String(file?.original_file_name || 'файл');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState('');
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

  const restore = async (version) => {
    setRestoringId(version.id);
    setError('');
    try {
      await myFilesOfficeAPI.restoreVersion(fileId, version.id);
      onClose?.(true);
    } catch (err) {
      setError(errorMessage(err, 'Не удалось вернуть версию'));
    } finally {
      setRestoringId('');
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
                  <Button size="small" disabled={Boolean(restoringId)} onClick={() => restore(item)} data-testid={`my-files-version-restore-${item.version_no}`}>
                    Вернуть
                  </Button>
                )}
              >
                <Stack spacing={0.25} sx={{ minWidth: 0, pr: 10 }}>
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
