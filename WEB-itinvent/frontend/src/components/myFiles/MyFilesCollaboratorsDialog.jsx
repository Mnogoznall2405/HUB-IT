import { useEffect, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';

import chatDirectoryAPI from '../../api/chatDirectory';
import { myFilesOfficeAPI } from '../../api/myFilesOffice';

const userLabel = (user) => {
  const fullName = String(user?.full_name || '').trim();
  const username = String(user?.username || '').trim();
  return fullName && fullName !== username ? `${fullName} (${username})` : username;
};

const errorMessage = (err, fallback) => String(err?.response?.data?.detail || err?.message || fallback);

export default function MyFilesCollaboratorsDialog({ open, file, onClose }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const fileId = String(file?.id || '');
  const fileName = String(file?.original_file_name || 'файл');
  const [selected, setSelected] = useState([]);
  const [options, setOptions] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !fileId) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    myFilesOfficeAPI.listCollaborators(fileId, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setSelected((data?.items || []).map((item) => ({ id: item.user_id, username: item.username, full_name: item.full_name })));
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(errorMessage(err, 'Не удалось загрузить список'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [fileId, open]);

  useEffect(() => {
    if (!open) return undefined;
    const text = query.trim();
    if (text.length < 2) {
      setOptions([]);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      chatDirectoryAPI.getUsers({ q: text, limit: 20 })
        .then((data) => { if (!cancelled) setOptions(Array.isArray(data?.items) ? data.items : []); })
        .catch(() => { if (!cancelled) setOptions([]); });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await myFilesOfficeAPI.setCollaborators(fileId, selected.map((user) => user.id));
      onClose?.(true);
    } catch (err) {
      setError(errorMessage(err, 'Не удалось сохранить доступ'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(open)} onClose={() => onClose?.(false)} maxWidth="sm" fullWidth fullScreen={isMobile}>
      <DialogTitle sx={{ pb: 1 }}>
        <Typography component="div" variant="h6" sx={{ fontWeight: 700 }}>Совместное редактирование</Typography>
        <Typography variant="body2" color="text.secondary" noWrap>{fileName}</Typography>
      </DialogTitle>
      <DialogContent dividers>
        {loading ? (
          <Stack alignItems="center" sx={{ py: 3 }}><CircularProgress size={28} /></Stack>
        ) : (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Выбранные пользователи портала смогут открывать документ в редакторе и править его вместе с вами.
              Предыдущие версии сохраняются.
            </Typography>
            <Autocomplete
              multiple
              filterSelectedOptions
              options={options}
              value={selected}
              inputValue={query}
              onInputChange={(_event, value) => setQuery(value)}
              onChange={(_event, value) => setSelected(value)}
              getOptionLabel={userLabel}
              isOptionEqualToValue={(option, value) => option.id === value.id}
              filterOptions={(items) => items}
              noOptionsText={query.trim().length < 2 ? 'Введите минимум 2 символа' : 'Никого не найдено'}
              renderTags={(value, getTagProps) => value.map((user, index) => (
                <Chip {...getTagProps({ index })} key={user.id} size="small" label={userLabel(user)} />
              ))}
              renderInput={(params) => (
                <TextField {...params} label="Добавить пользователей" placeholder="Имя или логин" />
              )}
            />
            {error ? <Alert severity="error">{error}</Alert> : null}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose?.(false)}>Отмена</Button>
        <Button variant="contained" onClick={save} disabled={loading || saving} data-testid="my-files-collaborators-save">
          Сохранить
        </Button>
      </DialogActions>
    </Dialog>
  );
}
