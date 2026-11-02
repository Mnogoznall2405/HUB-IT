import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';

import { myFilesOfficeAPI } from '../../api/myFilesOffice';
import { formatFileSize } from '../../lib/myFilesPreview';

export default function MyFilesSharedForEditingDialog({ open, onClose, onOpenFile }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    myFilesOfficeAPI.listSharedWithMe({ signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setItems(Array.isArray(data?.items) ? data.items : []); })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(String(err?.response?.data?.detail || err?.message || 'Не удалось загрузить список'));
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open]);

  return (
    <Dialog open={Boolean(open)} onClose={onClose} maxWidth="sm" fullWidth fullScreen={isMobile}>
      <DialogTitle>
        <Typography component="div" variant="h6" sx={{ fontWeight: 700 }}>Доступно мне для правки</Typography>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {loading ? (
          <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress size={28} /></Stack>
        ) : error ? (
          <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>
        ) : items.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            Вам пока никто не открыл документы для совместной правки.
          </Typography>
        ) : (
          <List disablePadding>
            {items.map((item) => (
              <ListItemButton
                key={item.id}
                divider
                disabled={!item.editable}
                onClick={() => onOpenFile?.({ id: item.id, file_name: item.file_name })}
                data-testid={`my-files-shared-${item.id}`}
              >
                <ListItemText
                  primary={item.file_name}
                  secondary={`Владелец: ${item.owner_username || '—'} · ${formatFileSize(item.size_bytes)}`}
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
}
