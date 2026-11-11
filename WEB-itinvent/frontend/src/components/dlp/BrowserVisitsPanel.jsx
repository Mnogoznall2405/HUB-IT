import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import { fsEgressAPI } from '../../api/fsEgress';
import { formatDwell, shortLabel } from './utils';

// Mirrors backend dlp_categories.CATEGORY_META; rows also carry category_meta.
const CATEGORY_META = {
  internal: { label: 'Внутренние', color: 'primary' },
  work: { label: 'Работа', color: 'success' },
  mail: { label: 'Почта', color: 'info' },
  search: { label: 'Поиск', color: 'secondary' },
  maps: { label: 'Карты', color: 'info' },
  shopping: { label: 'Покупки', color: 'warning' },
  social: { label: 'Соцсети', color: 'secondary' },
  im: { label: 'Мессенджеры', color: 'info' },
  news: { label: 'Новости', color: 'default' },
  entertainment: { label: 'Развлечения', color: 'warning' },
  other: { label: 'Прочее', color: 'default' },
};

const BROWSER_LABELS = {
  chrome: 'Chrome',
  edge: 'Edge',
  yandex: 'Яндекс',
};

function formatIsoVisited(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('ru-RU');
  } catch {
    return String(value);
  }
}

function CategoryChip({ category, meta }) {
  const info = meta || CATEGORY_META[category] || CATEGORY_META.other;
  return <Chip size="small" label={info.label} color={info.color} variant={info.color === 'default' ? 'outlined' : 'filled'} />;
}

function BrowserDaySummary({ stats: dayStats, selected = 'all', onSelect }) {
  const stats = useMemo(() => {
    const work = Number(dayStats?.work) || 0;
    const entertainment = Number(dayStats?.entertainment) || 0;
    const other = Number(dayStats?.other) || 0;
    const workDwell = Number(dayStats?.work_dwell) || 0;
    const entDwell = Number(dayStats?.entertainment_dwell) || 0;
    const otherDwell = Number(dayStats?.other_dwell) || 0;
    const idleDwell = Number(dayStats?.idle_dwell) || 0;
    const dwellTotal = workDwell + entDwell + otherDwell;
    const useDwell = dwellTotal > 0;
    const denom = useDwell ? dwellTotal : (work + entertainment + other || 1);
    const workShare = useDwell ? workDwell : work;
    const entShare = useDwell ? entDwell : entertainment;
    return {
      work,
      entertainment,
      other,
      workDwell,
      entDwell,
      otherDwell,
      idleDwell,
      useDwell,
      workPct: Math.round((workShare / denom) * 100),
      entPct: Math.round((entShare / denom) * 100),
    };
  }, [dayStats]);

  return (
    <Paper variant="outlined" sx={{ p: 1.25 }}>
      <Stack spacing={0.75}>
        <Typography variant="subtitle2">
          Сводка за день {stats.useDwell ? '(по активному времени)' : '(по числу визитов)'}
        </Typography>
        <Stack direction="row" spacing={0.5} sx={{ height: 10, borderRadius: 1, overflow: 'hidden', bgcolor: 'action.hover' }}>
          <Box sx={{ width: `${stats.workPct}%`, bgcolor: 'success.main', minWidth: stats.workPct ? 4 : 0 }} />
          <Box sx={{ width: `${stats.entPct}%`, bgcolor: 'warning.main', minWidth: stats.entPct ? 4 : 0 }} />
          <Box sx={{ flex: 1, bgcolor: 'divider' }} />
        </Stack>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {[
            {
              key: 'work',
              color: 'success',
              label: stats.useDwell
                ? `Работа ${formatDwell(stats.workDwell)} (${stats.workPct}%) · ${stats.work} виз.`
                : `Работа ${stats.work} (${stats.workPct}%)`,
            },
            {
              key: 'entertainment',
              color: 'warning',
              label: stats.useDwell
                ? `Развлечения ${formatDwell(stats.entDwell)} (${stats.entPct}%) · ${stats.entertainment} виз.`
                : `Развлечения ${stats.entertainment} (${stats.entPct}%)`,
            },
            {
              key: 'other',
              color: 'default',
              label: stats.useDwell
                ? `Прочее ${formatDwell(stats.otherDwell)} · ${stats.other} виз.`
                : `Прочее ${stats.other}`,
            },
          ].map((item) => {
            const active = selected === item.key;
            return (
              <Chip
                key={item.key}
                size="small"
                color={item.color}
                variant={active || item.color !== 'default' ? 'filled' : 'outlined'}
                label={item.label}
                onClick={onSelect ? () => onSelect(item.key) : undefined}
                onDelete={active && onSelect ? () => onSelect(item.key) : undefined}
                sx={onSelect ? { cursor: 'pointer' } : undefined}
              />
            );
          })}
        </Stack>
        {stats.idleDwell > 0 ? (
          <Typography variant="caption" color="text.secondary">
            {`Простой: ${formatDwell(stats.idleDwell)} — без ввода, в доли выше не входит`}
          </Typography>
        ) : null}
      </Stack>
    </Paper>
  );
}

function BrowserShotButton({ host, fileName }) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [open, setOpen] = useState(false);

  const openShot = async () => {
    if (!host || !fileName) return;
    if (url) {
      setOpen(true);
      return;
    }
    setBusy(true);
    try {
      const res = await fsEgressAPI.getBrowserMedia(host, fileName);
      const blobUrl = URL.createObjectURL(res.data);
      setUrl(blobUrl);
      setOpen(true);
    } catch {
      setUrl('');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  if (!fileName) return <Typography variant="caption" color="text.secondary">—</Typography>;

  return (
    <>
      <Button size="small" variant="outlined" onClick={openShot} disabled={busy}>
        {busy ? '…' : 'Снимок'}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="lg" fullWidth>
        <DialogContent sx={{ p: 1, position: 'relative' }}>
          <IconButton
            size="small"
            onClick={() => setOpen(false)}
            sx={{ position: 'absolute', top: 8, right: 8, bgcolor: 'background.paper' }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
          {url ? (
            <Box
              component="img"
              src={url}
              alt={fileName}
              sx={{ width: '100%', maxHeight: '80vh', objectFit: 'contain', display: 'block' }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function isFocusVisit(row) {
  return String(row?.profile || '') === 'focus' || Number(row?.dwell_sec) > 0;
}

const BROWSER_PAGE_SIZE = 500;
const BROWSER_MAX_RAW = 5000;
const BROWSER_RENDER_PAGE = 500;

export function BrowserVisitsPanel({ host, initialDay = '' }) {
  // Default: only where the person actually sat (foreground), not background History SPA noise.
  const [sourceFilter, setSourceFilter] = useState('focus');
  const [day, setDay] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [days, setDays] = useState([]);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [renderLimit, setRenderLimit] = useState(BROWSER_RENDER_PAGE);

  const sourceParam = sourceFilter === 'all' ? '' : sourceFilter;

  useEffect(() => {
    const timer = setTimeout(() => setQ(qInput.trim()), 350);
    return () => clearTimeout(timer);
  }, [qInput]);

  useEffect(() => {
    setSourceFilter('focus');
    setDay('');
    setCategoryFilter('all');
    setQInput('');
    setQ('');
  }, [host]);

  useEffect(() => {
    let cancelled = false;
    if (!host) {
      setDays([]);
      return undefined;
    }
    fsEgressAPI
      .listBrowserDays(host, sourceParam)
      .then((res) => {
        if (!cancelled) setDays(Array.isArray(res.data?.days) ? res.data.days : []);
      })
      .catch(() => {
        if (!cancelled) setDays([]);
      });
    return () => {
      cancelled = true;
    };
  }, [host, sourceParam]);

  useEffect(() => {
    // The page-level day (URL ?day=) wins when it exists in this source's list.
    if (!day && days[0]) {
      setDay(days.some((d) => d.day === initialDay) ? initialDay : days[0].day);
    } else if (day && days.length && !days.some((d) => d.day === day)) setDay(days[0]?.day || '');
    else if (day && !days.length) setDay('');
  }, [days, day, initialDay]);

  useEffect(() => {
    let cancelled = false;
    if (!host) return undefined;
    setLoading(true);
    setError('');
    // Load the whole day at once: sequential pages until every raw row is
    // fetched (merged rows are always fewer than the raw total).
    (async () => {
      const acc = [];
      let rawTotal = 0;
      try {
        for (let offset = 0; offset < BROWSER_MAX_RAW; offset += BROWSER_PAGE_SIZE) {
          // eslint-disable-next-line no-await-in-loop
          const res = await fsEgressAPI.listBrowserVisits({
            computerName: host,
            source: sourceParam,
            day,
            q,
            limit: BROWSER_PAGE_SIZE,
            offset,
            merge: 1,
          });
          if (cancelled) return;
          const items = Array.isArray(res.data?.items) ? res.data.items : [];
          rawTotal = Number(res.data?.total) || 0;
          acc.push(...items);
          // Render as pages arrive: first paint after page 1 instead of waiting
          // for the whole day (busy hosts have ~5k rows = 10 sequential fetches).
          setRows([...acc]);
          setTotal(rawTotal);
          if (offset + BROWSER_PAGE_SIZE >= rawTotal || !items.length) break;
        }
      } catch (err) {
        if (cancelled) return;
        setRows(acc);
        setTotal(rawTotal);
        if (!acc.length) {
          setError(err?.response?.data?.detail || err.message || 'Ошибка загрузки визитов');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [host, sourceParam, day, q]);

  // Category filter applies to the display category (recomputed server-side),
  // not the stored column — filter the loaded page client-side.
  const visibleRows = useMemo(() => {
    if (categoryFilter === 'all') return rows;
    return rows.filter(
      (row) => (row.category_display || row.category || 'other') === categoryFilter,
    );
  }, [rows, categoryFilter]);

  const dayStats = useMemo(() => days.find((d) => d.day === day) || null, [days, day]);

  // Cap rendered rows: a busy host has ~5k merged rows (~75k DOM nodes without
  // a render window). Extend on demand via the "Показать ещё" row.
  useEffect(() => {
    setRenderLimit(BROWSER_RENDER_PAGE);
  }, [host, sourceFilter, day, q, categoryFilter]);
  const displayRows = useMemo(
    () => visibleRows.slice(0, renderLimit),
    [visibleRows, renderLimit],
  );

  if (!host) return null;

  return (
    <Stack spacing={1} sx={{ height: '100%', minHeight: 0 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel id="browser-src-label">Источник</InputLabel>
          <Select
            labelId="browser-src-label"
            label="Источник"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
          >
            <MenuItem value="focus">Только в фокусе</MenuItem>
            <MenuItem value="history">Вся History</MenuItem>
            <MenuItem value="all">Фокус + History</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel id="browser-day-label">День</InputLabel>
          <Select
            labelId="browser-day-label"
            label="День"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          >
            {days.map((d) => (
              <MenuItem key={d.day} value={d.day}>{`${d.day} (${d.visits})`}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel id="browser-cat-label">Категория</InputLabel>
          <Select
            labelId="browser-cat-label"
            label="Категория"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <MenuItem value="all">Все</MenuItem>
            {Object.entries(CATEGORY_META).map(([key, meta]) => (
              <MenuItem key={key} value={key}>{meta.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          size="small"
          placeholder="Поиск по URL / заголовку"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
          sx={{ minWidth: 160, flex: '1 1 180px' }}
        />
        <Typography variant="caption" color="text.secondary" noWrap sx={{ flexShrink: 0 }}>
          {visibleRows.length} {sourceFilter === 'focus' ? 'активных вкладок' : 'записей'}
          {total > visibleRows.length ? ` (из ${total} визитов)` : ''}
          {loading ? ' · загрузка…' : ''}
        </Typography>
      </Stack>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {sourceFilter === 'focus' && !loading && !total ? (
        <Alert severity="info">
          Пока нет записей «в фокусе». History в фоне не показывается — переключите источник
          на «Вся History», если нужен журнал переходов.
        </Alert>
      ) : null}
      {!loading && !total && !error ? (
        <Typography color="text.secondary" sx={{ py: 1 }}>
          Активности браузера пока нет. Probe смотрит активное окно (где человек реально сидит)
          и отдельно читает History Chrome / Edge / Яндекс.
        </Typography>
      ) : null}
      {dayStats ? (
        <BrowserDaySummary
          stats={dayStats}
          selected={categoryFilter}
          onSelect={(cat) => setCategoryFilter((prev) => (prev === cat ? 'all' : cat))}
        />
      ) : null}
      <Paper sx={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>Время</TableCell>
              <TableCell>Браузер</TableCell>
              <TableCell>URL / заголовок</TableCell>
              <TableCell>Источник</TableCell>
              <TableCell>Категория</TableCell>
              <TableCell>В фокусе</TableCell>
              <TableCell>Простой</TableCell>
              <TableCell align="right">Снимок</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {displayRows.map((row) => (
              <TableRow key={row.id || `${row.browser}:${row.visit_id}:${row.visited_at}`} hover>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  {formatIsoVisited(row.visited_at)}
                  {row.merged && row.first_visited_at && row.first_visited_at !== row.visited_at ? (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {`с ${formatIsoVisited(row.first_visited_at)}`}
                    </Typography>
                  ) : null}
                </TableCell>
                <TableCell>{BROWSER_LABELS[row.browser] || row.browser || '—'}</TableCell>
                <TableCell sx={{ maxWidth: 420 }}>
                  <Stack direction="row" spacing={0.75} alignItems="baseline" sx={{ minWidth: 0 }}>
                    <Typography variant="body2" noWrap title={row.url || ''}>
                      {row.domain || shortLabel(row.url, 48) || '—'}
                    </Typography>
                    {row.count > 1 ? (
                      <Chip size="small" label={`×${row.count}`} variant="outlined" />
                    ) : null}
                  </Stack>
                  <Typography variant="caption" color="text.secondary" noWrap title={row.title || ''}>
                    {shortLabel(row.title, 72)}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={isFocusVisit(row) ? 'Фокус' : 'History'}
                    color={isFocusVisit(row) ? 'primary' : 'default'}
                    variant={isFocusVisit(row) ? 'filled' : 'outlined'}
                  />
                </TableCell>
                <TableCell>
                  <CategoryChip
                    category={row.category_display || row.category}
                    meta={row.category_meta}
                  />
                </TableCell>
                <TableCell>
                  {(row.dwell_total ?? row.dwell_sec) != null
                    ? formatDwell(row.dwell_total ?? row.dwell_sec)
                    : '—'}
                </TableCell>
                <TableCell>
                  {Number(row.idle_total ?? row.idle_sec) > 0 ? (
                    <Typography component="span" variant="body2" color="text.secondary">
                      {formatDwell(row.idle_total ?? row.idle_sec)}
                    </Typography>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell align="right">
                  <BrowserShotButton host={host} fileName={row.screenshot_file} />
                </TableCell>
              </TableRow>
            ))}
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} align="center">
                  <CircularProgress size={22} sx={{ my: 1.5 }} />
                </TableCell>
              </TableRow>
            ) : null}
            {visibleRows.length > renderLimit ? (
              <TableRow>
                <TableCell colSpan={8} align="center">
                  <Button
                    size="small"
                    onClick={() => setRenderLimit((l) => l + BROWSER_RENDER_PAGE)}
                  >
                    {`Показать ещё ${Math.min(BROWSER_RENDER_PAGE, visibleRows.length - renderLimit)} из ${visibleRows.length - renderLimit}`}
                  </Button>
                </TableCell>
              </TableRow>
            ) : null}
            {!loading && !visibleRows.length ? (
              <TableRow>
                <TableCell colSpan={8}>
                  <Typography color="text.secondary" sx={{ py: 2 }}>
                    Нет визитов для выбранного фильтра
                  </Typography>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Paper>
      {total > BROWSER_MAX_RAW ? (
        <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
          Показаны последние {BROWSER_MAX_RAW} визитов из {total} — сузьте день или поиск.
        </Typography>
      ) : null}
    </Stack>
  );
}

