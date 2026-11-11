import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';

import { computersFleetAPI } from '../../api/computersFleet';

export const FLEET_ISSUE_LABELS = {
  silent: 'Молчит больше 7 дней',
  fs_dead: 'fs_egress не работает',
  dead_letter: 'Есть недоставленные события',
  scan_down: 'Scan-модуль не работает',
  backlog: 'Копится очередь',
  old_version: 'Старая версия агента',
  no_egress: 'Нет fs_egress (старый агент)',
};

const ISSUE_COLORS = {
  silent: 'error',
  fs_dead: 'error',
  dead_letter: 'warning',
  scan_down: 'warning',
  backlog: 'warning',
  old_version: 'default',
  no_egress: 'default',
};

const AGE_BUCKETS = [
  ['online', 'На связи', 'success'],
  ['stale', 'Давно не отвечали', 'warning'],
  ['offline_week', 'Не в сети до 7 дней', 'warning'],
  ['silent', 'Молчат больше 7 дней', 'error'],
];

export function formatFleetAge(seconds) {
  if (seconds === null || seconds === undefined) return 'нет данных';
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return 'нет данных';
  if (value < 3600) return `${Math.max(1, Math.round(value / 60))} мин`;
  if (value < 86400) return `${Math.round(value / 3600)} ч`;
  return `${Math.round(value / 86400)} дн`;
}

function Metric({ label, value, color = 'text.primary' }) {
  return (
    <Box sx={{ minWidth: 120 }}>
      <Typography variant="h5" sx={{ fontWeight: 700 }} color={color}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Box>
  );
}

export default function FleetHealthDialog({ open, onClose, scope = 'selected' }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [issueFilter, setIssueFilter] = useState('');

  const load = useCallback(
    async (signal) => {
      setLoading(true);
      setError('');
      try {
        setData(await computersFleetAPI.getHealth({ scope, signal }));
      } catch (err) {
        if (signal?.aborted || err?.code === 'ERR_CANCELED') return;
        setError(err?.response?.data?.detail || 'Не удалось загрузить состояние парка');
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [scope],
  );

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [open, load]);

  const rows = useMemo(() => {
    const list = Array.isArray(data?.problems) ? data.problems : [];
    return issueFilter ? list.filter((row) => row.issues.includes(issueFilter)) : list;
  }, [data, issueFilter]);

  const sidecars = data?.sidecars || {};
  const buckets = data?.age_buckets || {};

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>Панель парка агентов</DialogTitle>
      <DialogContent>
        {loading ? <LinearProgress sx={{ mb: 1 }} /> : null}
        {error ? <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert> : null}
        {data ? (
          <>
            <Stack direction="row" flexWrap="wrap" useFlexGap spacing={2} sx={{ mb: 2, mt: 0.5 }}>
              <Metric label="Всего компьютеров" value={data.computers_total} />
              {AGE_BUCKETS.map(([key, label, color]) => (
                <Metric key={key} label={label} value={buckets[key] ?? 0} color={`${color}.main`} />
              ))}
            </Stack>

            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              Версии агента{data.latest_version ? ` (новейшая в парке: ${data.latest_version})` : ''}
            </Typography>
            <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.8} sx={{ mb: 2 }}>
              {(data.versions || []).map((row) => (
                <Chip
                  key={row.version || 'unknown'}
                  size="small"
                  variant={row.version === data.latest_version ? 'filled' : 'outlined'}
                  label={`${row.version || 'не сообщает'} — ${row.count}`}
                />
              ))}
            </Stack>

            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Модули агентов</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              fs_egress: работает на {sidecars.fs_egress_alive ?? 0} из {sidecars.fs_egress_reporting ?? 0} сообщающих ·
              Scan: работает на {sidecars.scan_alive ?? 0} из {sidecars.scan_reporting ?? 0} ·
              недоставленных событий: {sidecars.dead_letter_total ?? 0} на {sidecars.dead_letter_hosts ?? 0} компьютерах
            </Typography>

            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              Проблемы ({data.problems_total}) — нажмите, чтобы отфильтровать
            </Typography>
            <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.8} sx={{ mb: 1.5 }}>
              <Chip
                size="small"
                label={`Все — ${data.problems_total}`}
                color={issueFilter === '' ? 'primary' : 'default'}
                onClick={() => setIssueFilter('')}
              />
              {Object.entries(FLEET_ISSUE_LABELS).map(([code, label]) => (
                <Chip
                  key={code}
                  size="small"
                  label={`${label} — ${data.issue_counts?.[code] ?? 0}`}
                  color={issueFilter === code ? 'primary' : 'default'}
                  variant={issueFilter === code ? 'filled' : 'outlined'}
                  onClick={() => setIssueFilter(issueFilter === code ? '' : code)}
                />
              ))}
            </Stack>
            {data.truncated ? (
              <Alert severity="info" sx={{ mb: 1 }}>
                Показаны первые {data.problems.length} из {data.problems_total} проблемных компьютеров.
              </Alert>
            ) : null}

            {rows.length === 0 ? (
              <Typography variant="body2" color="text.secondary">Проблем нет.</Typography>
            ) : (
              <Box sx={{ maxHeight: 420, overflow: 'auto' }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Компьютер</TableCell>
                      <TableCell>Версия</TableCell>
                      <TableCell>Последний отчёт</TableCell>
                      <TableCell>Недоставлено</TableCell>
                      <TableCell>Проблемы</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => {
                      const dead = Object.values(row.dead_letter || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
                      return (
                        <TableRow key={row.mac_address || row.hostname}>
                          <TableCell>
                            {row.hostname || '-'}
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              {[row.branch_name, row.user_login].filter(Boolean).join(' · ')}
                            </Typography>
                          </TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{row.agent_version || '-'}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatFleetAge(row.age_sec)} назад</TableCell>
                          <TableCell>{dead || '-'}</TableCell>
                          <TableCell>
                            <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.5}>
                              {row.issues.map((code) => (
                                <Chip
                                  key={code}
                                  size="small"
                                  color={ISSUE_COLORS[code] || 'default'}
                                  variant="outlined"
                                  label={FLEET_ISSUE_LABELS[code] || code}
                                />
                              ))}
                            </Stack>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Box>
            )}
          </>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => load()} disabled={loading}>Обновить</Button>
        <Button onClick={onClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
}
