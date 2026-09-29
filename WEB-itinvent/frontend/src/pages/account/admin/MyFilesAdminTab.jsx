import { useCallback, useEffect, useState } from 'react';

import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import {
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';

import { myFilesAPI } from '../../../api/myFiles';
import { authUserAdminAPI } from '../../../api/authUserAdmin';
import { formatFileSize } from '../../../lib/myFilesPreview';
import { useNotification } from '../../../contexts/NotificationContext';

const QUOTA_MAX_GB = 400;

const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ru-RU');
};

function QuotaEditor({ row, saving, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const currentGb = Math.round(Number(row.quota_limit_bytes || 0) / (1024 ** 3));

  const startEdit = () => {
    setValue(row.quota_is_custom ? String(currentGb) : '');
    setEditing(true);
  };

  const submit = async () => {
    const trimmed = String(value).trim();
    const gb = trimmed === '' ? 0 : Number(trimmed);
    if (trimmed !== '' && (!Number.isFinite(gb) || gb < 1 || gb > QUOTA_MAX_GB)) return;
    const ok = await onSave(row, gb > 0 ? gb : null);
    if (ok) setEditing(false);
  };

  if (!editing) {
    return (
      <Stack direction="row" spacing={0.5} alignItems="center">
        <Typography variant="body2">
          {currentGb} ГБ{row.quota_is_custom ? '' : ' (стандарт)'}
        </Typography>
        <IconButton size="small" aria-label="Изменить лимит" onClick={startEdit} disabled={saving}>
          <EditOutlinedIcon fontSize="small" />
        </IconButton>
      </Stack>
    );
  }

  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <TextField
        size="small"
        type="number"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={String(currentGb)}
        inputProps={{ min: 1, max: QUOTA_MAX_GB }}
        sx={{ width: 96 }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void submit();
          if (event.key === 'Escape') setEditing(false);
        }}
        autoFocus
      />
      <IconButton size="small" color="primary" aria-label="Сохранить лимит" onClick={() => void submit()} disabled={saving}>
        <CheckIcon fontSize="small" />
      </IconButton>
      <IconButton size="small" aria-label="Отменить" onClick={() => setEditing(false)} disabled={saving}>
        <CloseIcon fontSize="small" />
      </IconButton>
    </Stack>
  );
}

export default function MyFilesAdminTab({ canManageUsers = false }) {
  const { notifyApiError, notifySuccess } = useNotification();
  const [stats, setStats] = useState({ items: [], total: 0, totals: {} });
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [savingUserId, setSavingUserId] = useState(0);

  const load = useCallback(async ({ q = query } = {}) => {
    setLoading(true);
    try {
      const payload = await myFilesAPI.listAdminUserStats({ limit: 500, q });
      setStats({
        items: Array.isArray(payload?.items) ? payload.items : [],
        total: Number(payload?.total || 0),
        totals: payload?.totals || {},
      });
    } catch (error) {
      notifyApiError(error, 'Не удалось загрузить статистику «Мой диск».', { dedupeMode: 'recent' });
    } finally {
      setLoading(false);
    }
  }, [notifyApiError, query]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearchSubmit = useCallback((event) => {
    event.preventDefault();
    void load({ q: query.trim() });
  }, [load, query]);

  const handleSaveQuota = useCallback(async (row, quotaGbOrNull) => {
    setSavingUserId(Number(row.user_id));
    try {
      const bytes = quotaGbOrNull == null ? null : Math.round(Number(quotaGbOrNull) * (1024 ** 3));
      await authUserAdminAPI.updateUser(row.user_id, { my_files_quota_bytes: bytes });
      notifySuccess(`Лимит для ${row.username} обновлён.`, { source: 'my-files-admin', dedupeMode: 'none' });
      await load();
      return true;
    } catch (error) {
      notifyApiError(error, 'Не удалось обновить лимит.', { dedupeMode: 'none' });
      return false;
    } finally {
      setSavingUserId(0);
    }
  }, [load, notifyApiError, notifySuccess]);

  const totals = stats.totals || {};
  const rows = stats.items;

  return (
    <Stack spacing={1.5}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <Card sx={{ flex: 1 }} elevation={1}>
          <CardContent sx={{ py: 1.25 }}>
            <Typography variant="caption" color="text.secondary">Всего файлов</Typography>
            <Typography variant="h6">{Number(totals.files_count || 0).toLocaleString('ru-RU')}</Typography>
          </CardContent>
        </Card>
        <Card sx={{ flex: 1 }} elevation={1}>
          <CardContent sx={{ py: 1.25 }}>
            <Typography variant="caption" color="text.secondary">Занято (логически)</Typography>
            <Typography variant="h6">{formatFileSize(totals.used_bytes || 0)}</Typography>
          </CardContent>
        </Card>
        <Card sx={{ flex: 1 }} elevation={1}>
          <CardContent sx={{ py: 1.25 }}>
            <Typography variant="caption" color="text.secondary">Диск хранилища</Typography>
            <Typography variant="h6">
              {Number(totals.storage_total_bytes || 0) > 0
                ? `${formatFileSize(totals.storage_free_bytes)} свободно`
                : formatFileSize(totals.stored_bytes || 0)}
            </Typography>
            {Number(totals.storage_total_bytes || 0) > 0 ? (
              <Typography variant="caption" color="text.secondary">
                из {formatFileSize(totals.storage_total_bytes)} · файлы занимают {formatFileSize(totals.stored_bytes || 0)}
              </Typography>
            ) : null}
          </CardContent>
        </Card>
        <Card sx={{ flex: 1 }} elevation={1}>
          <CardContent sx={{ py: 1.25 }}>
            <Typography variant="caption" color="text.secondary">В очереди обработки</Typography>
            <Typography variant="h6">{Number(totals.processing_queue || 0).toLocaleString('ru-RU')}</Typography>
          </CardContent>
        </Card>
      </Stack>

      <Stack direction="row" spacing={1} alignItems="center" component="form" onSubmit={handleSearchSubmit}>
        <TextField
          size="small"
          placeholder="Поиск по имени пользователя"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          sx={{ minWidth: 280 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
            ),
          }}
        />
        <IconButton aria-label="Обновить" onClick={() => void load()} disabled={loading}>
          <RefreshIcon fontSize="small" />
        </IconButton>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">
          Пользователей с файлами: {stats.total}
        </Typography>
      </Stack>

      {loading && rows.length === 0 ? (
        <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={28} /></Stack>
      ) : rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
          Файлы пока ни у кого не загружены.
        </Typography>
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Пользователь</TableCell>
                <TableCell align="right">Файлов</TableCell>
                <TableCell align="right">Занято</TableCell>
                <TableCell sx={{ minWidth: 180 }}>Лимит</TableCell>
                <TableCell align="right">Ссылок</TableCell>
                <TableCell align="right">Папок</TableCell>
                <TableCell align="right">Загрузки</TableCell>
                <TableCell>Активность</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => {
                const limit = Number(row.quota_limit_bytes || 0);
                const used = Number(row.used_bytes || 0);
                const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
                return (
                  <TableRow key={row.user_id} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.username}</Typography>
                      {row.full_name ? (
                        <Typography variant="caption" color="text.secondary">{row.full_name}</Typography>
                      ) : null}
                    </TableCell>
                    <TableCell align="right">{row.files_count}</TableCell>
                    <TableCell align="right">{formatFileSize(used)}</TableCell>
                    <TableCell>
                      <Stack spacing={0.25}>
                        {canManageUsers ? (
                          <QuotaEditor row={row} saving={savingUserId === row.user_id} onSave={handleSaveQuota} />
                        ) : (
                          <Typography variant="body2">
                            {Math.round(limit / (1024 ** 3))} ГБ{row.quota_is_custom ? '' : ' (стандарт)'}
                          </Typography>
                        )}
                        <LinearProgress
                          variant="determinate"
                          value={percent}
                          color={percent >= 90 ? 'error' : percent >= 75 ? 'warning' : 'primary'}
                          sx={{ height: 4, borderRadius: 2 }}
                        />
                        <Typography variant="caption" color="text.secondary">{percent}%</Typography>
                      </Stack>
                    </TableCell>
                    <TableCell align="right">
                      {row.shared_count > 0
                        ? <Chip size="small" label={row.shared_count} color="primary" variant="outlined" />
                        : '—'}
                    </TableCell>
                    <TableCell align="right">{row.folders_count}</TableCell>
                    <TableCell align="right">
                      {row.active_uploads > 0
                        ? <Tooltip title="Активных загрузок прямо сейчас"><Chip size="small" label={row.active_uploads} color="warning" /></Tooltip>
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">{formatDateTime(row.last_activity_at)}</Typography>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Stack>
  );
}
