import React, { useMemo, useState } from 'react';
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
import { CountCell, GroupStatChip } from './stats';

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

export default function DlpHostList({ hosts, attentionMap, onOpenHost }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [hostQuery, setHostQuery] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [activeOnly, setActiveOnly] = useState(false);
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

  const dayStat = (name) => attentionMap?.get(String(name || '').toUpperCase()) || null;

  const branchGroups = useMemo(() => {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const todayTs = dayStart.getTime() / 1000;
    const groups = new Map();
    for (const host of visibleHosts) {
      const name = String(host.branch_name || '').trim() || 'Без филиала';
      const group = groups.get(name) || {
        name, items: [], lastTs: 0, activeToday: 0,
        files: 0, usb: 0, tg: 0, max: 0, visits: 0, workedSec: 0, awaySec: 0,
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
      }
      groups.set(name, group);
    }
    const unassigned = (n) => n === 'Неотсортированные' || n === 'Без филиала';
    const list = Array.from(groups.values());
    for (const group of list) {
      group.items.sort((a, b) => (Number(b.last_ts) || 0) - (Number(a.last_ts) || 0));
    }
    return list.sort((a, b) => {
      const ua = unassigned(a.name);
      const ub = unassigned(b.name);
      if (ua !== ub) return ua ? 1 : -1;
      return (b.activeToday - a.activeToday) || (b.lastTs - a.lastTs) || a.name.localeCompare(b.name, 'ru');
    });
  }, [visibleHosts, attentionMap]);

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
                    <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      работал {formatDwell(group.workedSec)}
                    </Typography>
                  ) : null}
                  {group.awaySec > 0 ? (
                    <Typography variant="caption" color="warning.main" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      отошёл {formatDwell(group.awaySec)}
                    </Typography>
                  ) : null}
                  <GroupStatChip label="USB" count={group.usb} color="warning" />
                  <GroupStatChip label="TG" count={group.tg} color="info" />
                  <GroupStatChip label="MAX" count={group.max} color="secondary" />
                  <GroupStatChip label="Удалено" count={group.files} />
                  <GroupStatChip label="Визиты" count={group.visits} />
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}
                  >
                    <AccessTimeIcon sx={{ fontSize: 14 }} />
                    {group.lastTs ? formatAgo(group.lastTs) : '—'}
                  </Typography>
                </Stack>
              </Box>
              <Collapse in={expanded} timeout="auto" unmountOnExit id={contentId}>
                <Box sx={{ overflow: 'auto', borderTop: '1px solid ' + theme.palette.divider }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Хост</TableCell>
                        <TableCell>Работал</TableCell>
                        <TableCell>Отошёл</TableCell>
                        <TableCell>Удалено</TableCell>
                        <TableCell>USB</TableCell>
                        <TableCell>Telegram</TableCell>
                        <TableCell>MAX</TableCell>
                        <TableCell>Браузер</TableCell>
                        <TableCell>Последнее событие</TableCell>
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
                            onClick={() => onOpenHost(host.computer_name)}
                            sx={{ cursor: 'pointer' }}
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
                            <TableCell><CountCell value={host.telegram_events} color="info.main" /></TableCell>
                            <TableCell><CountCell value={host.max_events} color="secondary.main" /></TableCell>
                            <TableCell><CountCell value={host.visits} /></TableCell>
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
