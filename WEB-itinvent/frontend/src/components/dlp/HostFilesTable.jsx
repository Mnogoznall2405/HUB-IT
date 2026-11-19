import React, { useEffect, useState } from 'react';
import {
  Alert,
  Chip,
  CircularProgress,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import { fsEgressAPI } from '../../api/fsEgress';
import { CHANNEL_LABELS, displayAppDetail, formatTs, isRealTelegramSend, sendStateMeta } from './utils';

export function HostFilesTable({ host, channel, onChannelChange }) {
  const [rows, setRows] = useState([]);
  const [noiseHidden, setNoiseHidden] = useState(0);
  const [includeNoise, setIncludeNoise] = useState(false);
  const [sendOnly, setSendOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!host) return undefined;
    setLoading(true);
    setError('');
    fsEgressAPI
      .listEvents({
        computerName: host,
        channel: channel === 'all' ? '' : channel,
        group: 1,
        includeNoise: includeNoise ? 1 : 0,
        sendState: sendOnly ? 'sent' : '',
        limit: 500,
      })
      .then((res) => {
        if (cancelled) return;
        const items = Array.isArray(res.data?.items) ? res.data.items : [];
        setRows(items.filter((row) => isRealTelegramSend(row)));
        setNoiseHidden(Number(res.data?.noise_hidden) || 0);
      })
      .catch((err) => {
        if (cancelled) return;
        setRows([]);
        setNoiseHidden(0);
        setError(err?.response?.data?.detail || err.message || 'Ошибка загрузки файлов');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [host, channel, includeNoise, sendOnly]);

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
        <FormControl size="small" sx={{ minWidth: 180, maxWidth: 240 }}>
          <InputLabel>Канал</InputLabel>
          <Select label="Канал" value={channel} onChange={(e) => onChannelChange(e.target.value)}>
            <MenuItem value="all">Все каналы</MenuItem>
            <MenuItem value="usb">USB</MenuItem>
            <MenuItem value="network">Сеть</MenuItem>
            <MenuItem value="telegram">Telegram</MenuItem>
            <MenuItem value="max">MAX</MenuItem>
            <MenuItem value="browser">Браузер</MenuItem>
            <MenuItem value="deleted">Удаления</MenuItem>
          </Select>
        </FormControl>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={includeNoise}
              onChange={(e) => setIncludeNoise(e.target.checked)}
            />
          }
          label="Показать служебные файлы"
        />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={sendOnly}
              onChange={(e) => setSendOnly(e.target.checked)}
            />
          }
          label="Только отправленные"
        />
        {!includeNoise && noiseHidden > 0 ? (
          <Typography variant="caption" color="text.secondary">
            {`Скрыто служебных: ${noiseHidden}`}
          </Typography>
        ) : null}
      </Stack>

      {error ? <Alert severity="error">{error}</Alert> : null}

      <Paper sx={{ overflow: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Время</TableCell>
              <TableCell>Пользователь</TableCell>
              <TableCell>Файл</TableCell>
                <TableCell>Путь</TableCell>
              <TableCell>Канал</TableCell>
              <TableCell>Размер</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id || row.event_id}
                hover
                sx={
                  row.channel === 'deleted'
                    ? { opacity: row.service ? 0.45 : 0.65 }
                    : undefined
                }
              >
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  {formatTs(row.last_ts ?? row.ts)}
                  {row.merged && row.first_ts && row.first_ts !== row.last_ts ? (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {`с ${formatTs(row.first_ts)}`}
                    </Typography>
                  ) : null}
                </TableCell>
                <TableCell>{row.windows_user || '—'}</TableCell>
                <TableCell sx={{ maxWidth: 420 }}>
                  <Stack direction="row" spacing={0.75} alignItems="center">
                    {row.details?.kind === 'dir_deleted' ? (
                      <FolderOutlinedIcon fontSize="small" sx={{ flexShrink: 0, color: 'text.secondary' }} />
                    ) : (
                      <InsertDriveFileOutlinedIcon fontSize="small" sx={{ flexShrink: 0, color: 'text.secondary' }} />
                    )}
                    <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                      {row.file_name || '—'}
                    </Typography>
                    {row.count > 1 ? (
                      <Chip size="small" label={`×${row.count}`} color="default" variant="outlined" />
                    ) : null}
                  </Stack>
                </TableCell>
                <TableCell sx={{ maxWidth: 360, wordBreak: 'break-all' }}>
                  {row.dest_path || '—'}
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Chip
                      size="small"
                      label={
                        row.channel === 'deleted'
                          ? row.details?.kind === 'dir_deleted'
                            ? 'Удалена папка'
                            : row.details?.kind === 'recycle'
                              ? 'В корзину'
                              : 'Удаление'
                          : CHANNEL_LABELS[row.channel] || row.channel
                      }
                      color={
                        row.channel === 'usb'
                          ? 'warning'
                          : row.channel === 'telegram' || row.channel === 'max'
                            ? 'info'
                            : 'default'
                      }
                    />
                    {sendStateMeta(row) ? (
                      <Chip
                        size="small"
                        variant="outlined"
                        label={sendStateMeta(row).label}
                        color={sendStateMeta(row).color}
                      />
                    ) : null}
                    {row.details?.fg_exe ? (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        title="Приложение в фокусе в момент события — контекст, не доказательство источника записи"
                      >
                        {`в фокусе: ${displayAppDetail(row.details.fg_exe)}`}
                      </Typography>
                    ) : null}
                  </Stack>
                </TableCell>
                <TableCell>
                  {row.size != null ? `${Math.round(Number(row.size) / 1024)} КБ` : '—'}
                </TableCell>
              </TableRow>
            ))}
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <CircularProgress size={22} sx={{ my: 1.5 }} />
                </TableCell>
              </TableRow>
            ) : null}
            {!loading && !rows.length ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography color="text.secondary" sx={{ py: 2 }}>
                    Залогированных файлов пока нет. USB/сеть — при копировании на флешку или шару;
                    Telegram/MAX — исходящие фото/файлы/видео из диалогов.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Paper>
    </Stack>
  );
}

