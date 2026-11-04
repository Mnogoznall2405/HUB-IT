import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import RestoreRoundedIcon from '@mui/icons-material/RestoreRounded';

import { myFilesOfficeAPI } from '../../api/myFilesOffice';
import { formatFileSize } from '../../lib/myFilesPreview';
import PersonAvatar from './PersonAvatar';

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

const toDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const dayKey = (date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

export const dayLabel = (date, now = new Date()) => {
  if (!date) return 'Без даты';
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(date) === dayKey(now)) return 'Сегодня';
  if (dayKey(date) === dayKey(yesterday)) return 'Вчера';
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
};

const timeLabel = (date) => (date ? date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '');

/**
 * "История версий" как в Google Документах: от новых к старым, по дням; у каждой версии время и автор,
 * её можно скачать или вернуть. Первая запись — текущая версия.
 */
export default function MyFilesVersionHistory({
  fileId,
  fileName = 'файл',
  canRestore = true,
  onRestored,
  refreshKey = 0,
}) {
  const theme = useTheme();
  const [items, setItems] = useState([]);
  const [current, setCurrent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async (signal) => {
    if (!fileId) return;
    setLoading(true);
    setError('');
    try {
      const data = await myFilesOfficeAPI.listVersions(fileId, { signal });
      if (signal?.aborted) return;
      setItems(Array.isArray(data?.items) ? data.items : []);
      setCurrent(data?.current || null);
    } catch (err) {
      if (!signal?.aborted) setError(errorMessage(err, 'Не удалось загрузить версии'));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [fileId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refreshKey]);

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
      onRestored?.(version);
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Не удалось вернуть версию'));
    } finally {
      setBusyId('');
    }
  };

  // A server without authors still answers with who retired each version: fall back to that.
  const rows = useMemo(() => {
    const list = [];
    if (current || items.length > 0) {
      list.push({
        id: 'current',
        isCurrent: true,
        author: current?.author || items[0]?.replaced_by || '',
        at: toDate(current?.authored_at || items[0]?.replaced_at),
        size: current?.size_bytes,
        title: 'Текущая версия',
      });
    }
    items.forEach((item) => {
      list.push({
        ...item,
        isCurrent: false,
        author: item.author || item.replaced_by || '',
        at: toDate(item.authored_at || item.replaced_at),
        size: item.size_bytes,
        title: `Версия ${item.version_no}`,
      });
    });
    return list;
  }, [current, items]);

  const groups = useMemo(() => {
    const result = [];
    rows.forEach((row) => {
      const label = dayLabel(row.at);
      const last = result[result.length - 1];
      if (last && last.label === label) last.rows.push(row);
      else result.push({ label, rows: [row] });
    });
    return result;
  }, [rows]);

  const currentBackground = alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.08);

  return (
    <Box data-testid="my-files-version-history">
      {loading && rows.length === 0 ? (
        <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress size={28} /></Stack>
      ) : null}
      {!loading && rows.length === 0 && !error ? (
        <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
          Версий пока нет: они появляются после первого сохранения в редакторе.
        </Typography>
      ) : null}
      {groups.map((group) => (
        <Box key={group.label}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', px: 2, pt: 1.5, pb: 0.5, fontWeight: 700 }}
          >
            {group.label}
          </Typography>
          {group.rows.map((row) => (
            <Stack
              key={row.id}
              direction="row"
              spacing={1.25}
              alignItems="center"
              data-testid={row.isCurrent ? 'my-files-version-current' : `my-files-version-${row.version_no}`}
              sx={{
                px: 2,
                py: 1,
                bgcolor: row.isCurrent ? currentBackground : 'transparent',
                '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.08) },
                '& .version-actions': { opacity: { xs: 1, md: 0 }, transition: 'opacity 0.15s' },
                '&:hover .version-actions, &:focus-within .version-actions': { opacity: 1 },
              }}
            >
              <PersonAvatar name={row.author} />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: row.isCurrent ? 700 : 600 }} noWrap>
                  {timeLabel(row.at)}{row.at ? ' · ' : ''}{row.title}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap component="div">
                  {row.author || 'Автор не указан'}{row.size ? ` · ${formatFileSize(row.size)}` : ''}
                </Typography>
              </Box>
              {row.isCurrent ? null : (
                <Stack direction="row" className="version-actions" sx={{ flexShrink: 0 }}>
                  <Tooltip title="Скачать эту версию">
                    <span>
                      <IconButton
                        size="small"
                        aria-label={`Скачать версию ${row.version_no}`}
                        disabled={Boolean(busyId)}
                        onClick={() => download(row)}
                        data-testid={`my-files-version-download-${row.version_no}`}
                      >
                        {busyId === row.id ? <CircularProgress size={18} /> : <DownloadOutlinedIcon fontSize="small" />}
                      </IconButton>
                    </span>
                  </Tooltip>
                  {canRestore ? (
                    <Tooltip title="Вернуть эту версию">
                      <span>
                        <IconButton
                          size="small"
                          aria-label={`Вернуть версию ${row.version_no}`}
                          disabled={Boolean(busyId)}
                          onClick={() => restore(row)}
                          data-testid={`my-files-version-restore-${row.version_no}`}
                        >
                          <RestoreRoundedIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  ) : null}
                </Stack>
              )}
            </Stack>
          ))}
        </Box>
      ))}
      {error ? <Alert severity="error" sx={{ m: 2 }}>{error}</Alert> : null}
      {rows.length > 0 ? (
        <Box sx={{ p: 2 }}>
          <Button size="small" onClick={() => load()} disabled={loading}>Обновить</Button>
        </Box>
      ) : null}
    </Box>
  );
}
