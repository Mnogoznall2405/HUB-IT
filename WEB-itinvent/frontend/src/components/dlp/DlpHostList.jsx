import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
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
} from '@mui/material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchIcon from '@mui/icons-material/Search';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import { formatAgo, formatDwell, formatTs } from './utils';
import { CountCell, GroupStatChip } from './stats';

export default function DlpHostList({ hosts, attentionMap, onOpenHost }) {
  const [hostQuery, setHostQuery] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [activeOnly, setActiveOnly] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const collapseInitRef = useRef(false);

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

  const branchGroups = useMemo(() => {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const todayTs = dayStart.getTime() / 1000;
    const groups = new Map();
    for (const host of visibleHosts) {
      const name = String(host.branch_name || '').trim() || 'Без филиала';
      const group = groups.get(name) || {
        name, items: [], lastTs: 0, activeToday: 0,
        files: 0, usb: 0, tg: 0, max: 0, visits: 0,
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
  }, [visibleHosts]);

  // First load: every branch starts collapsed — expand what you need.
  useEffect(() => {
    if (collapseInitRef.current || !branchGroups.length) return;
    collapseInitRef.current = true;
    setCollapsedGroups(new Set(branchGroups.map((g) => g.name)));
  }, [branchGroups]);

  const dayStat = (name) => attentionMap?.get(String(name || '').toUpperCase()) || null;

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
          startIcon={collapsedGroups.size ? <UnfoldMoreIcon /> : <UnfoldLessIcon />}
          onClick={() => setCollapsedGroups(
            collapsedGroups.size ? new Set() : new Set(branchGroups.map((g) => g.name)),
          )}
          sx={{ flexShrink: 0 }}
        >
          {collapsedGroups.size ? 'Развернуть все' : 'Свернуть все'}
        </Button>
      </Stack>
      <Box sx={{ overflow: 'auto', flex: 1, minHeight: 0, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
        {branchGroups.map((group) => (
          <Accordion
            key={group.name}
            expanded={!collapsedGroups.has(group.name)}
            onChange={(_, expanded) => setCollapsedGroups((prev) => {
              const next = new Set(prev);
              if (expanded) next.delete(group.name); else next.add(group.name);
              return next;
            })}
            disableGutters
            elevation={0}
            sx={{
              mb: 0,
              bgcolor: 'transparent',
              '&::before': { display: 'none' },
              borderBottom: '1px solid',
              borderColor: 'divider',
            }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 48 }}>
              <Stack
                direction="row"
                spacing={1.5}
                alignItems="center"
                flexWrap="wrap"
                useFlexGap
                sx={{ minWidth: 0, width: '100%', pr: 1 }}
              >
                <Typography fontWeight={700} noWrap>{group.name}</Typography>
                <Chip size="small" variant="outlined" label={`${group.items.length} ПК`} />
                {group.activeToday ? (
                  <Chip size="small" color="success" variant="outlined" label={`активны: ${group.activeToday}`} />
                ) : null}
                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ ml: 'auto' }}>
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
              </Stack>
            </AccordionSummary>
            <AccordionDetails sx={{ p: 0, overflow: 'auto' }}>
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
            </AccordionDetails>
          </Accordion>
        ))}
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
