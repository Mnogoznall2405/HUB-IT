import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Collapse,
  FormControl,
  FormControlLabel,
  InputAdornment,
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
  TableSortLabel,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchIcon from '@mui/icons-material/Search';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import { formatAgo, formatDwell, formatTs } from './utils';
import { CountCell, GroupStatChip, GroupTimeChip } from './stats';

const EXPANDED_GROUPS_STORAGE_KEY = 'dlp_host_groups_expanded';

function readExpandedGroups() {
  try {
    const raw = localStorage.getItem(EXPANDED_GROUPS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map((item) => String(item)) : []);
  } catch {
    return new Set();
  }
}

function writeExpandedGroups(groups) {
  try {
    localStorage.setItem(EXPANDED_GROUPS_STORAGE_KEY, JSON.stringify([...groups]));
  } catch {
    // localStorage may be unavailable (private mode) — expansion still works for the session.
  }
}

// Filters/sort live in sessionStorage: opening a host unmounts this list, and
// on "К списку хостов" / Esc / F5 the user expects the same view back.
const FILTERS_STORAGE_KEY = 'dlp_hostlist_filters';

function readFilters() {
  try {
    const raw = sessionStorage.getItem(FILTERS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// Sortable host columns: key → (host, dayStat) → comparable value.
const SORTS = {
  host: { get: (h) => String(h.computer_name || ''), defaultDir: 'asc' },
  active: { get: (h, s) => Number(s?.active_sec) || 0, defaultDir: 'desc' },
  away: { get: (h, s) => Number(s?.away_sec) || 0, defaultDir: 'desc' },
  files: { get: (h) => Math.max(0, (Number(h.deleted_events) || 0) - (Number(h.service_files) || 0)), defaultDir: 'desc' },
  usb: { get: (h) => Number(h.usb_events) || 0, defaultDir: 'desc' },
  tg: { get: (h) => Number(h.telegram_events) || 0, defaultDir: 'desc' },
  max: { get: (h) => Number(h.max_events) || 0, defaultDir: 'desc' },
  visits: { get: (h) => Number(h.visits) || 0, defaultDir: 'desc' },
  entertainment: { get: (h, s) => Number(s?.entertainment_sec) || 0, defaultDir: 'desc' },
  last_ts: { get: (h) => Number(h.last_ts) || 0, defaultDir: 'desc' },
};

export default function DlpHostList({ hosts, attentionMap, onOpenHost, onOpenBrowser }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [hostQuery, setHostQuery] = useState(() => String(readFilters().hostQuery || ''));
  const [branchFilter, setBranchFilter] = useState(() => String(readFilters().branchFilter || 'all'));
  const [activeOnly, setActiveOnly] = useState(() => Boolean(readFilters().activeOnly));
  const [sortKey, setSortKey] = useState(() =>
    SORTS[readFilters().sortKey] ? readFilters().sortKey : 'last_ts',
  );
  const [sortDir, setSortDir] = useState(() =>
    readFilters().sortDir === 'asc' ? 'asc' : 'desc',
  );
  // Empty = every branch collapsed on first render (как на странице «База данных»).
  const [expandedGroups, setExpandedGroups] = useState(readExpandedGroups);

  const toggleGroup = (name) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      writeExpandedGroups(next);
      return next;
    });
  };

  useEffect(() => {
    try {
      sessionStorage.setItem(
        FILTERS_STORAGE_KEY,
        JSON.stringify({ hostQuery, branchFilter, activeOnly, sortKey, sortDir }),
      );
    } catch {
      // sessionStorage may be unavailable — filters just won't persist.
    }
  }, [hostQuery, branchFilter, activeOnly, sortKey, sortDir]);

  const todayStartTs = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime() / 1000;
  }, []);

  const visibleHosts = useMemo(() => {
    const needle = hostQuery.trim().toLowerCase();
    return hosts.filter((h) => {
      if (branchFilter !== 'all'
        && (String(h.branch_name || '').trim() || 'Без филиала') !== branchFilter) {
        return false;
      }
      if (activeOnly && (Number(h.last_ts) || 0) < todayStartTs) return false;
      if (!needle) return true;
      return (
        String(h.computer_name || '').toLowerCase().includes(needle)
        || String(h.windows_user || '').toLowerCase().includes(needle)
        || String(h.user_full_name || '').toLowerCase().includes(needle)
        || String(h.user_login || '').toLowerCase().includes(needle)
      );
    });
  }, [hosts, hostQuery, branchFilter, activeOnly, todayStartTs]);

  const branchNames = useMemo(() => {
    const unassigned = new Set(['Неотсортированные', 'Без филиала']);
    const names = [...new Set(
      hosts.map((h) => String(h.branch_name || '').trim() || 'Без филиала'),
    )];
    return names.sort((a, b) => {
      const ua = unassigned.has(a);
      const ub = unassigned.has(b);
      if (ua !== ub) return ua ? 1 : -1;
      return a.localeCompare(b, 'ru');
    });
  }, [hosts]);

  // A persisted branch name may no longer exist (renamed/unassigned) — fall
  // back to "Все" rather than leaving the Select blank.
  useEffect(() => {
    if (branchFilter !== 'all' && !branchNames.includes(branchFilter)) {
      setBranchFilter('all');
    }
  }, [branchFilter, branchNames]);

  const dayStat = (name) => attentionMap?.get(String(name || '').toUpperCase()) || null;

  const onSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(SORTS[key]?.defaultDir || 'desc');
    }
  };

  const branchGroups = useMemo(() => {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const todayTs = dayStart.getTime() / 1000;
    const sort = SORTS[sortKey] || SORTS.last_ts;
    const groups = new Map();
    for (const host of visibleHosts) {
      const name = String(host.branch_name || '').trim() || 'Без филиала';
      const group = groups.get(name) || {
        name, items: [], lastTs: 0, activeToday: 0,
        files: 0, usb: 0, tg: 0, max: 0, visits: 0, workedSec: 0, awaySec: 0, entSec: 0,
      };
      group.items.push(host);
      const lastTs = Number(host.last_ts) || 0;
      group.lastTs = Math.max(group.lastTs, lastTs);
      if (lastTs >= todayTs) group.activeToday += 1;
      group.files += Math.max(0, (Number(host.deleted_events) || 0) - (Number(host.service_files) || 0));
      group.usb += Number(host.usb_events) || 0;
      group.tg += Number(host.telegram_events) || 0;
      group.max += Number(host.max_events) || 0;
      group.visits += Number(host.visits) || 0;
      const stat = attentionMap?.get(String(host.computer_name || '').toUpperCase());
      if (stat) {
        group.workedSec += Number(stat.active_sec) || 0;
        group.awaySec += Number(stat.away_sec) || 0;
        group.entSec += Number(stat.entertainment_sec) || 0;
      }
      groups.set(name, group);
    }
    const unassigned = (n) => n === 'Неотсортированные' || n === 'Без филиала';
    const list = Array.from(groups.values());
    for (const group of list) {
      group.items.sort((a, b) => {
        const av = sort.get(a, attentionMap?.get(String(a.computer_name || '').toUpperCase()));
        const bv = sort.get(b, attentionMap?.get(String(b.computer_name || '').toUpperCase()));
        const base = typeof av === 'string' ? av.localeCompare(bv, 'ru') : av - bv;
        const ordered = sortDir === 'asc' ? base : -base;
        return ordered || ((Number(b.last_ts) || 0) - (Number(a.last_ts) || 0));
      });
    }
    return list.sort((a, b) => {
      const ua = unassigned(a.name);
      const ub = unassigned(b.name);
      if (ua !== ub) return ua ? 1 : -1;
      return (b.activeToday - a.activeToday) || (b.lastTs - a.lastTs) || a.name.localeCompare(b.name, 'ru');
    });
  }, [visibleHosts, attentionMap, sortKey, sortDir]);

  const sortCell = (key, label, align) => (
    <TableCell key={key} align={align} sortDirection={sortKey === key ? sortDir : false}>
      <TableSortLabel
        active={sortKey === key}
        direction={sortKey === key ? sortDir : SORTS[key].defaultDir}
        onClick={() => onSort(key)}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  );

  const allExpanded = branchGroups.length > 0 && branchGroups.every((g) => expandedGroups.has(g.name));

  const setAllExpanded = (expanded) => {
    const next = expanded ? new Set(branchGroups.map((g) => g.name)) : new Set();
    writeExpandedGroups(next);
    setExpandedGroups(next);
  };

  return (
    <>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        sx={{ flexShrink: 0 }}
      >
        <TextField
          size="small"
          placeholder="Поиск по имени ПК или пользователю"
          value={hostQuery}
          onChange={(e) => setHostQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
          sx={{ flex: '1 1 240px', minWidth: 200, maxWidth: 420 }}
        />
        <FormControl size="small" sx={{ minWidth: 200, flex: '0 1 auto' }}>
          <InputLabel id="dlp-branch-label">Филиал</InputLabel>
          <Select
            labelId="dlp-branch-label"
            label="Филиал"
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
          >
            <MenuItem value="all">Все</MenuItem>
            {branchNames.map((name) => (
              <MenuItem key={name} value={name}>{name}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControlLabel
          control={(
            <Switch
              size="small"
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.target.checked)}
            />
          )}
          label="Только активные сегодня"
          sx={{ flexShrink: 0 }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
          Хостов: {visibleHosts.length}{visibleHosts.length !== hosts.length ? ` из ${hosts.length}` : ''}
        </Typography>
        <Button
          size="small"
          variant="text"
          startIcon={allExpanded ? <UnfoldLessIcon /> : <UnfoldMoreIcon />}
          onClick={() => setAllExpanded(!allExpanded)}
          sx={{ flexShrink: 0 }}
        >
          {allExpanded ? 'Свернуть все' : 'Развернуть все'}
        </Button>
      </Stack>
      <Box sx={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
        {branchGroups.map((group, groupIndex) => {
          const expanded = expandedGroups.has(group.name);
          const contentId = `dlp-branch-${groupIndex}-content`;
          return (
            <Box
              key={group.name}
              sx={{
                mb: isMobile ? 1 : 1.5,
                border: '1px solid ' + theme.palette.divider,
                borderRadius: 1,
                overflow: 'hidden',
              }}
            >
              <Box
                component="button"
                type="button"
                aria-expanded={expanded}
                aria-controls={contentId}
                onClick={() => toggleGroup(group.name)}
                sx={{
                  p: isMobile ? 0.65 : 1.2,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 1,
                  cursor: 'pointer',
                  width: '100%',
                  border: 0,
                  font: 'inherit',
                  textAlign: 'left',
                  backgroundColor: theme.palette.mode === 'dark' ? '#0f172a' : theme.palette.grey[100],
                  '&:hover': {
                    backgroundColor: theme.palette.mode === 'dark' ? '#1e293b' : theme.palette.grey[200],
                  },
                  '&:focus-visible': {
                    outline: `2px solid ${theme.palette.primary.main}`,
                    outlineOffset: -2,
                  },
                  color: theme.palette.mode === 'dark' ? '#ffffff' : 'inherit',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                  {expanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
                  <Typography variant={isMobile ? 'subtitle1' : 'h6'} sx={{ fontSize: isMobile ? '0.78rem' : undefined }} noWrap>
                    {group.name}
                  </Typography>
                </Box>
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  flexWrap="wrap"
                  useFlexGap
                  justifyContent="flex-end"
                  sx={{ minWidth: 0 }}
                >
                  <Chip size="small" variant="outlined" label={`${group.items.length} ПК`} />
                  {group.activeToday ? (
                    <Chip size="small" color="success" variant="outlined" label={`активны: ${group.activeToday}`} />
                  ) : null}
                  {group.workedSec > 0 ? (
                    <GroupTimeChip label={`ввод/пауза ${formatDwell(group.workedSec)}`} color="info" />
                  ) : null}
                  {group.awaySec > 0 ? (
                    <GroupTimeChip label={`отошёл ${formatDwell(group.awaySec)}`} />
                  ) : null}
                  {group.entSec > 0 ? (
                    <GroupTimeChip label={`развл. ${formatDwell(group.entSec)}`} color="warning" />
                  ) : null}
                  <GroupStatChip label="USB" count={group.usb} color="warning" />
                  <GroupStatChip label="TG" count={group.tg} color="info" />
                  <GroupStatChip label="MAX" count={group.max} color="secondary" />
                  <GroupStatChip label="Удалено" count={group.files} />
                  <GroupStatChip label="Визиты" count={group.visits} />
                  <GroupTimeChip
                    icon={<AccessTimeIcon sx={{ fontSize: 14 }} />}
                    label={group.lastTs ? formatAgo(group.lastTs) : '—'}
                  />
                </Stack>
              </Box>
              <Collapse in={expanded} timeout="auto" unmountOnExit id={contentId}>
                <Box sx={{ overflow: 'auto', borderTop: '1px solid ' + theme.palette.divider }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        {sortCell('host', 'Хост')}
                        {sortCell('active', 'Ввод/пауза')}
                        {sortCell('away', 'Отошёл')}
                        {sortCell('files', 'Удалено')}
                        {sortCell('usb', 'USB')}
                        {sortCell('tg', 'Telegram')}
                        {sortCell('max', 'MAX')}
                        {sortCell('visits', 'Браузер')}
                        {sortCell('entertainment', 'Развлечения')}
                        {sortCell('last_ts', 'Последнее событие')}
                        <TableCell align="right" />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {group.items.map((host) => {
                        const fileCount = Math.max(
                          0,
                          (Number(host.deleted_events) || 0) - (Number(host.service_files) || 0),
                        );
                        const stat = dayStat(host.computer_name);
                        return (
                          <TableRow
                            key={host.computer_name}
                            hover
                            tabIndex={0}
                            onClick={() => onOpenHost(host.computer_name)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                onOpenHost(host.computer_name);
                              }
                            }}
                            sx={{
                              cursor: 'pointer',
                              '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
                            }}
                          >
                            <TableCell>
                              <Typography fontWeight={600}>{host.computer_name}</Typography>
                              <Typography variant="caption" color="text.secondary">
                                {[host.user_full_name, host.windows_user].filter(Boolean).join(' · ') || '—'}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                                {stat && (Number(stat.active_sec) || 0) > 0 ? formatDwell(stat.active_sec) : '—'}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                                {stat && (Number(stat.away_sec) || 0) > 0 ? formatDwell(stat.away_sec) : '—'}
                              </Typography>
                              {stat && (Number(stat.offshift_sec) || 0) > 0 ? (
                                <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                                  {`вне смены ${formatDwell(stat.offshift_sec)}`}
                                  {(Number(stat.break_sec) || 0) > 0 ? ` · перерыв ${formatDwell(stat.break_sec)}` : ''}
                                </Typography>
                              ) : stat && (Number(stat.break_sec) || 0) > 0 ? (
                                <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                                  {`перерыв ${formatDwell(stat.break_sec)}`}
                                </Typography>
                              ) : null}
                            </TableCell>
                            <TableCell>
                              <CountCell value={fileCount} />
                            </TableCell>
                            <TableCell><CountCell value={host.usb_events} color="warning.main" /></TableCell>
                            <TableCell>
                              <CountCell value={host.telegram_events} color="info.main" />
                              {Number(host.telegram_events) > 0 ? (
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontVariantNumeric: 'tabular-nums' }}>
                                  {`отправлено ${Number(host.telegram_sent) || 0}`}
                                </Typography>
                              ) : null}
                            </TableCell>
                            <TableCell>
                              <CountCell value={host.max_events} color="secondary.main" />
                              {Number(host.max_events) > 0 ? (
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontVariantNumeric: 'tabular-nums' }}>
                                  {`отправлено ${Number(host.max_sent) || 0}`}
                                </Typography>
                              ) : null}
                            </TableCell>
                            <TableCell><CountCell value={host.visits} /></TableCell>
                            <TableCell>
                              {stat && (Number(stat.entertainment_sec) || 0) > 0 ? (
                                onOpenBrowser ? (
                                  <Button
                                    size="small"
                                    variant="text"
                                    title="Сайты категории «Развлечения» за день"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onOpenBrowser(host.computer_name);
                                    }}
                                    sx={{
                                      minWidth: 0,
                                      px: 0.5,
                                      py: 0,
                                      fontSize: 'inherit',
                                      fontVariantNumeric: 'tabular-nums',
                                      color: 'warning.main',
                                      textTransform: 'none',
                                    }}
                                  >
                                    {formatDwell(stat.entertainment_sec)}
                                  </Button>
                                ) : (
                                  <Typography
                                    variant="body2"
                                    color="warning.main"
                                    sx={{ fontVariantNumeric: 'tabular-nums' }}
                                  >
                                    {formatDwell(stat.entertainment_sec)}
                                  </Typography>
                                )
                              ) : (
                                '—'
                              )}
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2" title={formatTs(host.last_ts)}>
                                {formatAgo(host.last_ts)}
                              </Typography>
                            </TableCell>
                            <TableCell align="right">
                              <Button
                                size="small"
                                variant="contained"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenHost(host.computer_name);
                                }}
                              >
                                Открыть
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Box>
              </Collapse>
            </Box>
          );
        })}
        {!visibleHosts.length ? (
          <Paper sx={{ p: 2 }}>
            <Typography color="text.secondary" sx={{ py: 2 }}>
              {hosts.length
                ? 'По фильтру ничего не найдено'
                : 'Хостов пока нет — агент ещё не присылал события'}
            </Typography>
          </Paper>
        ) : null}
      </Box>
    </>
  );
}
