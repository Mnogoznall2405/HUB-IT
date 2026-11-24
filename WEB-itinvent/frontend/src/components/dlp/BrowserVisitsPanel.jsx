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
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableSortLabel,
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

// Distinct bar tones per category: meta colors repeat (several categories share
// 'info'/'secondary'/'warning'), so the summary bar uses light/dark variants.
const CATEGORY_BAR_COLORS = {
  internal: 'primary.main',
  work: 'success.main',
  mail: 'info.main',
  search: 'secondary.main',
  maps: 'info.dark',
  shopping: 'warning.light',
  social: 'secondary.dark',
  im: 'info.light',
  news: 'grey.500',
  entertainment: 'warning.main',
  other: 'divider',
};

function FilterField({ label, children, sx }) {
  return (
    <Box sx={sx}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', mb: 0.25, px: 0.25 }}
      >
        {label}
      </Typography>
      {children}
    </Box>
  );
}

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
    const cats = dayStats?.categories && typeof dayStats.categories === 'object'
      ? dayStats.categories
      : null;
    // New payloads carry per-category rollups; older ones only the three
    // classic buckets — fall back so the summary never goes empty.
    const entries = (cats
      ? Object.keys(CATEGORY_META).map((key) => ({
          key,
          visits: Number(cats[key]?.visits) || 0,
          dwell: Number(cats[key]?.dwell) || 0,
        }))
      : [
          { key: 'work', visits: Number(dayStats?.work) || 0, dwell: Number(dayStats?.work_dwell) || 0 },
          { key: 'entertainment', visits: Number(dayStats?.entertainment) || 0, dwell: Number(dayStats?.entertainment_dwell) || 0 },
          { key: 'other', visits: Number(dayStats?.other) || 0, dwell: Number(dayStats?.other_dwell) || 0 },
        ]
    ).filter((e) => e.visits > 0 || e.dwell > 0);
    const dwellTotal = entries.reduce((acc, e) => acc + e.dwell, 0);
    const visitsTotal = entries.reduce((acc, e) => acc + e.visits, 0) || 1;
    const useDwell = dwellTotal > 0;
    const denom = useDwell ? dwellTotal : visitsTotal;
    entries.forEach((e) => {
      e.share = useDwell ? e.dwell : e.visits;
      e.pct = Math.round((e.share / denom) * 100);
    });
    entries.sort((a, b) => b.share - a.share);
    return {
      entries,
      useDwell,
      idleDwell: Number(dayStats?.idle_dwell) || 0,
    };
  }, [dayStats]);

  return (
    <Stack spacing={0.5}>
      <Stack direction="row" spacing={1} alignItems="baseline">
        <Typography variant="subtitle2" noWrap>
          Сводка за день
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          {stats.useDwell ? 'по активному времени' : 'по числу визитов'}
        </Typography>
        {stats.idleDwell > 0 ? (
          <Typography variant="caption" color="text.secondary" noWrap sx={{ ml: 'auto' }}>
            {`Простой: ${formatDwell(stats.idleDwell)} — без ввода, в доли не входит`}
          </Typography>
        ) : null}
      </Stack>
      <Stack direction="row" sx={{ height: 8, borderRadius: 1, overflow: 'hidden', bgcolor: 'action.hover' }}>
        {stats.entries.map((e) => (
          <Box
            key={e.key}
            title={`${CATEGORY_META[e.key].label} · ${e.pct}%`}
            sx={{
              flexGrow: e.share,
              flexBasis: 0,
              minWidth: e.share ? 4 : 0,
              bgcolor: CATEGORY_BAR_COLORS[e.key] || 'divider',
              '& + &': { borderLeft: '1px solid', borderColor: 'background.paper' },
            }}
          />
        ))}
      </Stack>
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
        {stats.entries.map((e) => {
          const meta = CATEGORY_META[e.key];
          const active = selected === e.key;
          return (
            <Chip
              key={e.key}
              size="small"
              color={meta.color}
              variant={active || meta.color !== 'default' ? 'filled' : 'outlined'}
              label={
                stats.useDwell
                  ? `${meta.label} ${formatDwell(e.dwell)} (${e.pct}%) · ${e.visits} виз.`
                  : `${meta.label} ${e.visits} (${e.pct}%)`
              }
              onClick={onSelect ? () => onSelect(e.key) : undefined}
              onDelete={active && onSelect ? () => onSelect(e.key) : undefined}
              sx={onSelect ? { cursor: 'pointer' } : undefined}
            />
          );
        })}
      </Stack>
    </Stack>
  );
}

function BrowserShotButton({ host, fileName }) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  const openShot = async () => {
    if (!host || !fileName) return;
    if (url) {
      setOpen(true);
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      const res = await fsEgressAPI.getBrowserMedia(host, fileName);
      const blobUrl = URL.createObjectURL(res.data);
      setUrl(blobUrl);
      setOpen(true);
    } catch {
      setUrl('');
      setFailed(true);
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
      <Button
        size="small"
        variant="outlined"
        color={failed ? 'error' : 'primary'}
        onClick={openShot}
        disabled={busy}
        title={failed ? 'Не удалось загрузить снимок — нажмите, чтобы повторить' : undefined}
      >
        {busy ? '…' : failed ? 'Снимок · ошибка' : 'Снимок'}
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

const VISIT_SORTS = {
  visited_at: { get: (r) => Date.parse(r.visited_at) || 0, defaultDir: 'desc' },
  domain: {
    get: (r) => String(r.domain || r.url || '').toLowerCase(),
    defaultDir: 'asc',
  },
  category: {
    get: (r) => String(r.category_display || r.category || ''),
    defaultDir: 'asc',
  },
  dwell: { get: (r) => Number(r.dwell_total ?? r.dwell_sec) || 0, defaultDir: 'desc' },
  idle: { get: (r) => Number(r.idle_total ?? r.idle_sec) || 0, defaultDir: 'desc' },
};

export function BrowserVisitsPanel({ host, initialDay = '', initialCategory = '' }) {
  // Default: foreground focus records only, not background History SPA noise.
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
  const [view, setView] = useState('rows');
  const [sortKey, setSortKey] = useState('visited_at');
  const [sortDir, setSortDir] = useState('desc');

  const sourceParam = sourceFilter === 'all' ? '' : sourceFilter;

  useEffect(() => {
    const timer = setTimeout(() => setQ(qInput.trim()), 350);
    return () => clearTimeout(timer);
  }, [qInput]);

  useEffect(() => {
    setSourceFilter('focus');
    setDay('');
    setCategoryFilter(initialCategory || 'all');
    setQInput('');
    setQ('');
    setView('rows');
    setSortKey('visited_at');
    setSortDir('desc');
  }, [host, initialCategory]);

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

  const sortedRows = useMemo(() => {
    const sort = VISIT_SORTS[sortKey] || VISIT_SORTS.visited_at;
    return visibleRows
      .map((row, index) => [row, index])
      .sort((a, b) => {
        const av = sort.get(a[0]);
        const bv = sort.get(b[0]);
        const base = typeof av === 'string' ? av.localeCompare(bv, 'ru') : av - bv;
        // Original position breaks ties so the order stays stable while the
        // day still pages in.
        return (sortDir === 'asc' ? base : -base) || a[1] - b[1];
      })
      .map(([row]) => row);
  }, [visibleRows, sortKey, sortDir]);

  // Per-domain totals feed both the "Домены" table and the top-domain chips:
  // on a busy host ~5k rows collapse into a readable top-sites list. Clicking
  // a domain drills back into row view via the server-side search.
  const domainRows = useMemo(() => {
    const map = new Map();
    for (const row of visibleRows) {
      const domain = String(row.domain || '').trim() || '—';
      const key = domain.toLowerCase();
      let agg = map.get(key);
      if (!agg) {
        agg = {
          key,
          domain,
          rows: 0,
          visits: 0,
          dwell: 0,
          idle: 0,
          browsers: new Set(),
          cats: new Map(),
          lastTs: '',
        };
        map.set(key, agg);
      }
      agg.rows += 1;
      agg.visits += Number(row.count) || 1;
      agg.dwell += Number(row.dwell_total ?? row.dwell_sec) || 0;
      agg.idle += Number(row.idle_total ?? row.idle_sec) || 0;
      if (row.browser) agg.browsers.add(row.browser);
      const cat = row.category_display || row.category || 'other';
      agg.cats.set(cat, (agg.cats.get(cat) || 0) + 1);
      if (String(row.visited_at || '') > agg.lastTs) agg.lastTs = String(row.visited_at);
    }
    const list = [...map.values()];
    for (const agg of list) {
      agg.topCat = [...agg.cats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'other';
    }
    list.sort((a, b) => (b.dwell - a.dwell) || (b.visits - a.visits) || a.key.localeCompare(b.key));
    return list;
  }, [visibleRows]);

  const topDomains = useMemo(
    () => domainRows.filter((d) => d.dwell > 0).slice(0, 5),
    [domainRows],
  );

  const onVisitSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir((VISIT_SORTS[key] || VISIT_SORTS.visited_at).defaultDir);
    }
  };

  const visitSortCell = (key, label) => (
    <TableCell key={key} sortDirection={sortKey === key ? sortDir : false}>
      <TableSortLabel
        active={sortKey === key}
        direction={sortKey === key ? sortDir : (VISIT_SORTS[key] || VISIT_SORTS.visited_at).defaultDir}
        onClick={() => onVisitSort(key)}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  );

  const openDomainRows = (domain) => {
    setQInput(domain === '—' ? '' : domain);
    setView('rows');
  };

  // Cap rendered rows: a busy host has ~5k merged rows (~75k DOM nodes without
  // a render window). Extend on demand via the "Показать ещё" row.
  useEffect(() => {
    setRenderLimit(BROWSER_RENDER_PAGE);
  }, [host, sourceFilter, day, q, categoryFilter, view]);
  const displayRows = useMemo(
    () => sortedRows.slice(0, renderLimit),
    [sortedRows, renderLimit],
  );

  if (!host) return null;

  return (
    <Stack spacing={1} sx={{ height: '100%', minHeight: 0 }}>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {sourceFilter === 'focus' && !loading && !total ? (
        <Alert severity="info">
          Пока нет записей «в фокусе». History в фоне не показывается — переключите источник
          на «Вся History», если нужен журнал переходов.
        </Alert>
      ) : null}
      {!loading && !total && !error ? (
        <Typography color="text.secondary" sx={{ py: 1 }}>
          Активности браузера пока нет. Probe пишет фокус активного окна
          и отдельно читает History Chrome / Edge / Яндекс.
        </Typography>
      ) : null}
      <Paper variant="outlined" sx={{ p: 1, flexShrink: 0 }}>
        <Stack spacing={0.75}>
          <Stack direction="row" spacing={1} alignItems="flex-end" flexWrap="wrap" useFlexGap>
            <FilterField label="Источник" sx={{ minWidth: 150 }}>
              <FormControl size="small" fullWidth>
                <Select
                  value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value)}
                  inputProps={{ 'aria-label': 'Источник' }}
                >
                  <MenuItem value="focus">Только в фокусе</MenuItem>
                  <MenuItem value="history">Вся History</MenuItem>
                  <MenuItem value="all">Фокус + History</MenuItem>
                </Select>
              </FormControl>
            </FilterField>
            <FilterField label="День" sx={{ minWidth: 150 }}>
              <FormControl size="small" fullWidth>
                <Select
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                  inputProps={{ 'aria-label': 'День' }}
                >
                  {days.map((d) => (
                    <MenuItem key={d.day} value={d.day}>{`${d.day} (${d.visits})`}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </FilterField>
            <FilterField label="Категория" sx={{ minWidth: 140 }}>
              <FormControl size="small" fullWidth>
                <Select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  inputProps={{ 'aria-label': 'Категория' }}
                >
                  <MenuItem value="all">Все</MenuItem>
                  {Object.entries(CATEGORY_META).map(([key, meta]) => (
                    <MenuItem key={key} value={key}>{meta.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </FilterField>
            <FilterField label="Вид" sx={{ minWidth: 120 }}>
              <FormControl size="small" fullWidth>
                <Select
                  value={view}
                  onChange={(e) => setView(e.target.value)}
                  inputProps={{ 'aria-label': 'Вид' }}
                >
                  <MenuItem value="rows">Строки</MenuItem>
                  <MenuItem value="domains">Домены</MenuItem>
                </Select>
              </FormControl>
            </FilterField>
            <FilterField label="Поиск" sx={{ minWidth: 160, flex: '1 1 180px' }}>
              <TextField
                size="small"
                fullWidth
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
              />
            </FilterField>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ flexShrink: 0, pb: 0.75 }}>
              {view === 'domains' ? `${domainRows.length} доменов · ` : ''}
              {visibleRows.length} {sourceFilter === 'focus' ? 'записей фокуса' : 'записей'}
              {total > visibleRows.length ? ` (из ${total} визитов)` : ''}
              {loading ? ' · загрузка…' : ''}
            </Typography>
          </Stack>
          {dayStats ? (
            <BrowserDaySummary
              stats={dayStats}
              selected={categoryFilter}
              onSelect={(cat) => setCategoryFilter((prev) => (prev === cat ? 'all' : cat))}
            />
          ) : null}
          {topDomains.length ? (
            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                Топ доменов:
              </Typography>
              {topDomains.map((agg) => (
                <Chip
                  key={agg.key}
                  size="small"
                  variant="outlined"
                  label={`${agg.domain} ${formatDwell(agg.dwell)}`}
                  title={agg.domain === '—' ? 'Строки без домена' : `Показать URL домена ${agg.domain}`}
                  onClick={() => openDomainRows(agg.domain)}
                  sx={{ cursor: 'pointer' }}
                />
              ))}
            </Stack>
          ) : null}
          <Typography variant="caption" color="text.secondary">
            День — по серверному времени (Тюмень, UTC+05:00), не по местному времени
            филиала; время строк — в часовом поясе этого браузера. Фокус — вкладка
            в активном окне (первые 5 минут без ввода тоже учитываются), это не
            измерение взгляда.
          </Typography>
        </Stack>
      </Paper>
      <Paper sx={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
        {view === 'domains' ? (
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Домен</TableCell>
                <TableCell>Категория</TableCell>
                <TableCell>Браузеры</TableCell>
                <TableCell align="right">Записей</TableCell>
                <TableCell align="right">Визитов</TableCell>
                <TableCell>В фокусе</TableCell>
                <TableCell>Простой</TableCell>
                <TableCell>Последний визит</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {domainRows.slice(0, renderLimit).map((agg) => (
                <TableRow
                  key={agg.key}
                  hover
                  tabIndex={0}
                  onClick={() => openDomainRows(agg.domain)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openDomainRows(agg.domain);
                    }
                  }}
                  title={agg.domain === '—' ? 'Показать строки без домена' : `Показать URL домена ${agg.domain}`}
                  sx={{
                    cursor: 'pointer',
                    '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
                  }}
                >
                  <TableCell sx={{ maxWidth: 280 }}>
                    <Typography variant="body2" noWrap title={agg.domain}>
                      {agg.domain}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <CategoryChip category={agg.topCat} />
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {[...agg.browsers].sort().map((b) => BROWSER_LABELS[b] || b).join(', ') || '—'}
                  </TableCell>
                  <TableCell align="right">{agg.rows}</TableCell>
                  <TableCell align="right">{agg.visits}</TableCell>
                  <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {agg.dwell > 0 ? formatDwell(agg.dwell) : '—'}
                  </TableCell>
                  <TableCell>
                    {agg.idle > 0 ? formatDwell(agg.idle) : '—'}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {formatIsoVisited(agg.lastTs)}
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
              {domainRows.length > renderLimit ? (
                <TableRow>
                  <TableCell colSpan={8} align="center">
                    <Button
                      size="small"
                      onClick={() => setRenderLimit((l) => l + BROWSER_RENDER_PAGE)}
                    >
                      {`Показать ещё ${Math.min(BROWSER_RENDER_PAGE, domainRows.length - renderLimit)} из ${domainRows.length - renderLimit}`}
                    </Button>
                  </TableCell>
                </TableRow>
              ) : null}
              {!loading && !domainRows.length ? (
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
        ) : (
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {visitSortCell('visited_at', 'Время')}
              <TableCell>Браузер</TableCell>
              {visitSortCell('domain', 'URL / заголовок')}
              <TableCell>Источник</TableCell>
              {visitSortCell('category', 'Категория')}
              {visitSortCell('dwell', 'В фокусе')}
              {visitSortCell('idle', 'Простой')}
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
        )}
      </Paper>
      {total > BROWSER_MAX_RAW ? (
        <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
          Показаны последние {BROWSER_MAX_RAW} визитов из {total} — сузьте день или поиск.
        </Typography>
      ) : null}
    </Stack>
  );
}

