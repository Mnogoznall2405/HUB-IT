import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Drawer,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  TextField,
  Typography,
} from '@mui/material';
import {
  PlayArrow as PlayArrowIcon,
  Refresh as RefreshIcon,
  WarningAmber as WarningAmberIcon,
} from '@mui/icons-material';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import { scanAPI } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

const AUTO_REFRESH_MS = 30_000;
const TASK_POLL_MS = 2_500;
const DEFAULT_ROWS_PER_PAGE = 25;
const ROWS_PER_PAGE_OPTIONS = [25, 50, 100];
const ACTIVE_TASK_STATUSES = new Set(['queued', 'delivered', 'acknowledged']);

function useDebouncedValue(value, delayMs = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

function formatTs(ts) {
  if (!ts) return '-';
  return new Date(Number(ts) * 1000).toLocaleString('ru-RU');
}

function formatAge(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return '-';
  if (value < 60) return `${value}с`;
  const minutes = Math.floor(value / 60);
  if (minutes < 60) return `${minutes}м`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}ч`;
  return `${Math.floor(hours / 24)}д`;
}

function formatLastSeen(seconds, isOnline) {
  const age = formatAge(seconds);
  if (age === '-') return '-';
  return isOnline ? `в сети, обновлено ${age} назад` : `не в сети ${age}`;
}

function formatTaskTimestamp(task) {
  if (!task) return '-';
  return formatTs(task.completed_at || task.updated_at || task.acked_at || task.delivered_at || task.created_at);
}

function taskTimestampLabel(task) {
  const normalized = String(task?.command || '').trim().toLowerCase();
  if (normalized === 'scan_now') return 'Последний скан';
  if (normalized === 'ping') return 'Последняя проверка связи';
  return 'Последняя задача';
}

function normalizeHost(value) {
  return String(value || '').trim().toLowerCase();
}

function inferFileExt(value) {
  const text = String(value || '').trim().replace(/\\/g, '/');
  if (!text) return '';
  const name = text.split('/').pop() || '';
  const idx = name.lastIndexOf('.');
  if (idx < 0 || idx === name.length - 1) return '';
  return name.slice(idx + 1).toLowerCase();
}

function getIncidentFileExt(incident) {
  return String(
    incident?.file_ext
    || inferFileExt(incident?.file_name)
    || inferFileExt(incident?.file_path)
    || ''
  ).trim().toLowerCase();
}

function getIncidentSourceKind(incident) {
  const source = String(incident?.source_kind || '').trim().toLowerCase();
  if (source) return source;
  const ext = getIncidentFileExt(incident);
  if (ext === 'pdf') return 'pdf';
  if (['txt', 'rtf', 'csv', 'json', 'xml', 'ini', 'conf', 'md', 'log'].includes(ext)) return 'text';
  return ext ? 'metadata' : '';
}

function taskStatusLabel(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'queued') return 'В очереди';
  if (normalized === 'delivered') return 'Доставлено агенту';
  if (normalized === 'acknowledged') return 'Выполняется';
  if (normalized === 'completed') return 'Завершено';
  if (normalized === 'failed') return 'Ошибка';
  if (normalized === 'expired') return 'Просрочено';
  return '-';
}

function taskStatusColor(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'acknowledged') return 'info';
  if (normalized === 'completed') return 'success';
  if (normalized === 'failed' || normalized === 'expired') return 'error';
  if (normalized === 'queued' || normalized === 'delivered') return 'warning';
  return 'default';
}

function severityColor(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'high') return 'error';
  if (normalized === 'medium') return 'warning';
  if (normalized === 'low') return 'info';
  return 'default';
}

function isActiveTask(task) {
  return Boolean(task) && ACTIVE_TASK_STATUSES.has(String(task.status || '').trim().toLowerCase());
}

function commandLabel(command) {
  const normalized = String(command || '').trim().toLowerCase();
  if (normalized === 'scan_now') return 'Скан';
  if (normalized === 'ping') return 'Проверка связи';
  return normalized || '-';
}

function summarizeTaskResult(task) {
  if (!task) return '-';
  const status = String(task.status || '').trim().toLowerCase();
  const result = task.result && typeof task.result === 'object' ? task.result : {};
  if (status === 'failed') {
    return String(task.error_text || 'Ошибка выполнения').trim() || 'Ошибка выполнения';
  }
  if (status !== 'completed') return '-';
  if (String(task.command || '').toLowerCase() === 'ping') {
    return result.pong ? 'Связь подтверждена' : 'Проверка завершена';
  }
  if (String(task.command || '').toLowerCase() === 'scan_now') {
    return `Скан: ${Number(result.scanned || 0)} · отправлено: ${Number(result.queued || 0)} · пропущено: ${Number(result.skipped || 0)}`;
  }
  return 'Задача выполнена';
}

function renderFragments(incident) {
  const matches = Array.isArray(incident?.matched_patterns) ? incident.matched_patterns : [];
  if (matches.length === 0) {
    return <Typography variant="caption" color="text.secondary">Фрагменты не найдены</Typography>;
  }
  return (
    <Stack spacing={0.7}>
      {matches.slice(0, 6).map((item, idx) => (
        <Paper key={`${incident.id || 'inc'}-${idx}`} variant="outlined" sx={{ p: 0.8 }}>
          <Typography variant="caption" sx={{ fontWeight: 700 }}>
            {item.pattern_name || item.pattern || 'pattern'}
          </Typography>
          {!!String(item.value || '').trim() && <Typography variant="caption" sx={{ display: 'block' }}>Значение: {String(item.value)}</Typography>}
          {!!String(item.snippet || '').trim() && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Фрагмент: {String(item.snippet)}</Typography>}
        </Paper>
      ))}
    </Stack>
  );
}

function sortToggle(currentBy, currentDir, nextBy) {
  if (currentBy === nextBy) {
    return currentDir === 'asc' ? 'desc' : 'asc';
  }
  return 'desc';
}

function ScanCenter() {
  const { hasPermission } = useAuth();
  const canScanAck = hasPermission('scan.ack');
  const canScanTasks = hasPermission('scan.tasks');

  const [dashboard, setDashboard] = useState({ totals: {}, daily: [], by_severity: [], by_branch: [], new_hosts: [] });
  const [dashboardLoading, setDashboardLoading] = useState(true);

  const [branchFilter, setBranchFilter] = useState('');
  const [branchOptions, setBranchOptions] = useState([]);
  const [branchOptionsLoading, setBranchOptionsLoading] = useState(true);
  const [autoRefreshPaused, setAutoRefreshPaused] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [taskNotice, setTaskNotice] = useState(null);

  const [agentRows, setAgentRows] = useState([]);
  const [agentTotal, setAgentTotal] = useState(0);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentPage, setAgentPage] = useState(0);
  const [agentRowsPerPage, setAgentRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);
  const [agentQ, setAgentQ] = useState('');
  const [agentOnline, setAgentOnline] = useState('all');
  const [agentTaskStatus, setAgentTaskStatus] = useState('all');
  const [agentSortBy, setAgentSortBy] = useState('online');
  const [agentSortDir, setAgentSortDir] = useState('desc');
  const [busyTaskAgent, setBusyTaskAgent] = useState('');
  const [trackedTaskAgentIds, setTrackedTaskAgentIds] = useState([]);

  const [hostRows, setHostRows] = useState([]);
  const [hostTotal, setHostTotal] = useState(0);
  const [hostsLoading, setHostsLoading] = useState(true);
  const [hostPage, setHostPage] = useState(0);
  const [hostRowsPerPage, setHostRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);
  const [hostQ, setHostQ] = useState('');
  const [hostStatus, setHostStatus] = useState('all');
  const [hostSeverity, setHostSeverity] = useState('all');
  const [hostSortBy, setHostSortBy] = useState('incidents_new');
  const [hostSortDir, setHostSortDir] = useState('desc');

  const [hostDrawerOpen, setHostDrawerOpen] = useState(false);
  const [selectedHost, setSelectedHost] = useState('');
  const [hostIncidents, setHostIncidents] = useState([]);
  const [hostIncidentsTotal, setHostIncidentsTotal] = useState(0);
  const [hostLoading, setHostLoading] = useState(false);
  const [incidentQ, setIncidentQ] = useState('');
  const [incidentStatus, setIncidentStatus] = useState('all');
  const [incidentSeverity, setIncidentSeverity] = useState('all');
  const [incidentSourceKind, setIncidentSourceKind] = useState('all');
  const [incidentFileExt, setIncidentFileExt] = useState('');
  const [incidentDateFrom, setIncidentDateFrom] = useState('');
  const [incidentDateTo, setIncidentDateTo] = useState('');
  const [incidentHasFragment, setIncidentHasFragment] = useState(false);
  const [busyIncident, setBusyIncident] = useState('');
  const [busyAckAllHost, setBusyAckAllHost] = useState(false);

  const agentsRequestIdRef = useRef(0);
  const hostsRequestIdRef = useRef(0);
  const hostIncidentRequestIdRef = useRef(0);
  const skipInitialAgentsEffectRef = useRef(true);
  const skipInitialHostsEffectRef = useRef(true);

  const debouncedBranch = useDebouncedValue(branchFilter);
  const debouncedAgentQ = useDebouncedValue(agentQ);
  const debouncedHostQ = useDebouncedValue(hostQ);
  const debouncedIncidentQ = useDebouncedValue(incidentQ);

  const totals = dashboard.totals || {};

  const hostMetaByName = useMemo(() => {
    const map = {};
    hostRows.forEach((row) => {
      map[normalizeHost(row.hostname)] = {
        branch: String(row.branch || '').trim(),
        user: String(row.user || '').trim(),
        ip: String(row.ip_address || '').trim(),
      };
    });
    agentRows.forEach((row) => {
      const key = normalizeHost(row.hostname || row.agent_id);
      if (!key) return;
      if (!map[key]) map[key] = {};
      if (!map[key].branch) map[key].branch = String(row.branch || '').trim();
      if (!map[key].ip) map[key].ip = String(row.ip_address || '').trim();
    });
    return map;
  }, [agentRows, hostRows]);

  const incidentSourceOptions = useMemo(() => {
    const set = new Set();
    hostIncidents.forEach((item) => {
      const source = getIncidentSourceKind(item);
      if (source) set.add(source);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ru'));
  }, [hostIncidents]);

  const hostNewCount = useMemo(
    () => hostIncidents.filter((item) => String(item.status || '').toLowerCase() === 'new').length,
    [hostIncidents],
  );

  const loadDashboard = async ({ silent = false } = {}) => {
    if (!silent) setDashboardLoading(true);
    try {
      const data = await scanAPI.getDashboard();
      setDashboard(data && typeof data === 'object' ? data : { totals: {}, daily: [], by_severity: [], by_branch: [], new_hosts: [] });
    } catch (error) {
      console.error('Scan dashboard load failed', error);
    } finally {
      if (!silent) setDashboardLoading(false);
    }
  };

  const loadBranchOptions = async () => {
    setBranchOptionsLoading(true);
    try {
      const data = await scanAPI.getBranches();
      setBranchOptions(Array.isArray(data) ? data.filter((item) => String(item || '').trim()) : []);
    } catch (error) {
      console.error('Scan branches load failed', error);
      setBranchOptions([]);
    } finally {
      setBranchOptionsLoading(false);
    }
  };

  const loadAgents = async ({ silent = false } = {}) => {
    const requestId = agentsRequestIdRef.current + 1;
    agentsRequestIdRef.current = requestId;
    if (!silent) setAgentsLoading(true);
    try {
      const response = await scanAPI.getAgentsTable({
        q: debouncedAgentQ || undefined,
        branch: debouncedBranch || undefined,
        online: agentOnline === 'all' ? undefined : agentOnline,
        task_status: agentTaskStatus === 'all' ? undefined : agentTaskStatus,
        limit: agentRowsPerPage,
        offset: agentPage * agentRowsPerPage,
        sort_by: agentSortBy,
        sort_dir: agentSortDir,
      });
      if (requestId !== agentsRequestIdRef.current) return;
      setAgentRows(Array.isArray(response?.items) ? response.items : []);
      setAgentTotal(Number(response?.total || 0));
    } catch (error) {
      console.error('Scan agents load failed', error);
      if (requestId === agentsRequestIdRef.current) {
        setAgentRows([]);
        setAgentTotal(0);
      }
    } finally {
      if (requestId === agentsRequestIdRef.current && !silent) {
        setAgentsLoading(false);
      }
    }
  };

  const loadHosts = async ({ silent = false } = {}) => {
    const requestId = hostsRequestIdRef.current + 1;
    hostsRequestIdRef.current = requestId;
    if (!silent) setHostsLoading(true);
    try {
      const response = await scanAPI.getHostsTable({
        q: debouncedHostQ || undefined,
        branch: debouncedBranch || undefined,
        status: hostStatus === 'all' ? undefined : hostStatus,
        severity: hostSeverity === 'all' ? undefined : hostSeverity,
        limit: hostRowsPerPage,
        offset: hostPage * hostRowsPerPage,
        sort_by: hostSortBy,
        sort_dir: hostSortDir,
      });
      if (requestId !== hostsRequestIdRef.current) return;
      setHostRows(Array.isArray(response?.items) ? response.items : []);
      setHostTotal(Number(response?.total || 0));
    } catch (error) {
      console.error('Scan hosts load failed', error);
      if (requestId === hostsRequestIdRef.current) {
        setHostRows([]);
        setHostTotal(0);
      }
    } finally {
      if (requestId === hostsRequestIdRef.current && !silent) {
        setHostsLoading(false);
      }
    }
  };

  const loadHostIncidents = async ({ silent = false } = {}) => {
    const host = String(selectedHost || '').trim();
    if (!host) return;
    const requestId = hostIncidentRequestIdRef.current + 1;
    hostIncidentRequestIdRef.current = requestId;
    if (!silent) setHostLoading(true);
    try {
      const response = await scanAPI.getIncidents({
        hostname: host,
        q: debouncedIncidentQ || undefined,
        status: incidentStatus === 'all' ? undefined : incidentStatus,
        severity: incidentSeverity === 'all' ? undefined : incidentSeverity,
        source_kind: incidentSourceKind === 'all' ? undefined : incidentSourceKind,
        file_ext: incidentFileExt || undefined,
        date_from: incidentDateFrom || undefined,
        date_to: incidentDateTo || undefined,
        has_fragment: incidentHasFragment ? true : undefined,
        limit: 5000,
        offset: 0,
      });
      if (requestId !== hostIncidentRequestIdRef.current) return;
      setHostIncidents(Array.isArray(response?.items) ? response.items : []);
      setHostIncidentsTotal(Number(response?.total || 0));
    } catch (error) {
      console.error('Host incidents load failed', error);
      if (requestId === hostIncidentRequestIdRef.current) {
        setHostIncidents([]);
        setHostIncidentsTotal(0);
      }
    } finally {
      if (requestId === hostIncidentRequestIdRef.current && !silent) {
        setHostLoading(false);
      }
    }
  };

  const refreshAll = async ({ silent = true } = {}) => {
    if (!silent) setRefreshing(true);
    try {
      await Promise.all([
        loadDashboard({ silent }),
        loadAgents({ silent }),
        loadHosts({ silent }),
        hostDrawerOpen && selectedHost ? loadHostIncidents({ silent }) : Promise.resolve(),
      ]);
    } finally {
      if (!silent) setRefreshing(false);
    }
  };

  useEffect(() => {
    loadBranchOptions();
    refreshAll({ silent: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (skipInitialAgentsEffectRef.current) {
      skipInitialAgentsEffectRef.current = false;
      return;
    }
    loadAgents({ silent: agentRows.length > 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedAgentQ, debouncedBranch, agentOnline, agentTaskStatus, agentPage, agentRowsPerPage, agentSortBy, agentSortDir]);

  useEffect(() => {
    if (skipInitialHostsEffectRef.current) {
      skipInitialHostsEffectRef.current = false;
      return;
    }
    loadHosts({ silent: hostRows.length > 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedHostQ, debouncedBranch, hostStatus, hostSeverity, hostPage, hostRowsPerPage, hostSortBy, hostSortDir]);

  useEffect(() => {
    if (!hostDrawerOpen || !selectedHost) return;
    loadHostIncidents({ silent: hostIncidents.length > 0 || hostIncidentsTotal > 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hostDrawerOpen,
    selectedHost,
    debouncedIncidentQ,
    incidentStatus,
    incidentSeverity,
    incidentSourceKind,
    incidentFileExt,
    incidentDateFrom,
    incidentDateTo,
    incidentHasFragment,
  ]);

  useEffect(() => {
    if (autoRefreshPaused) return undefined;
    const timer = window.setInterval(() => {
      refreshAll({ silent: true });
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [autoRefreshPaused, hostDrawerOpen, selectedHost, debouncedBranch, debouncedAgentQ, debouncedHostQ, debouncedIncidentQ, incidentStatus, incidentSeverity, incidentSourceKind, incidentFileExt, incidentDateFrom, incidentDateTo, incidentHasFragment, agentOnline, agentTaskStatus, hostStatus, hostSeverity, agentPage, hostPage, agentRowsPerPage, hostRowsPerPage, agentSortBy, agentSortDir, hostSortBy, hostSortDir]);

  const monitoredAgentIds = useMemo(() => {
    const ids = new Set(trackedTaskAgentIds);
    agentRows.forEach((row) => {
      if (isActiveTask(row.active_task)) ids.add(String(row.agent_id || '').trim());
    });
    return Array.from(ids).filter(Boolean);
  }, [trackedTaskAgentIds, agentRows]);

  useEffect(() => {
    if (monitoredAgentIds.length === 0) return undefined;
    let cancelled = false;

    const tick = async () => {
      try {
        const responses = await Promise.all(
          monitoredAgentIds.map(async (agentId) => {
            const data = await scanAPI.getTasks({ agent_id: agentId, limit: 20, offset: 0 });
            return [agentId, Array.isArray(data?.items) ? data.items : []];
          }),
        );
        if (cancelled) return;
        const tasksByAgent = new Map(responses);
        setAgentRows((prev) => prev.map((row) => {
          const tasks = tasksByAgent.get(String(row.agent_id || '').trim());
          if (!tasks) return row;
          const activeTask = tasks.find((item) => isActiveTask(item)) || null;
          return {
            ...row,
            active_task: activeTask,
            last_task: tasks[0] || row.last_task || null,
            queue_size: tasks.filter((item) => isActiveTask(item)).length,
          };
        }));
        setTrackedTaskAgentIds((prev) => prev.filter((agentId) => {
          const tasks = tasksByAgent.get(agentId) || [];
          return tasks.some((item) => isActiveTask(item));
        }));
      } catch (error) {
        if (!cancelled) {
          console.error('Scan task polling failed', error);
        }
      }
    };

    tick();
    const timer = window.setInterval(tick, TASK_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [monitoredAgentIds]);

  const patchHostNewCount = (hostname, delta) => {
    const host = normalizeHost(hostname);
    if (!host || !delta) return;
    setHostRows((prev) => prev.map((row) => (
      normalizeHost(row.hostname) === host
        ? { ...row, incidents_new: Math.max(0, Number(row.incidents_new || 0) + delta) }
        : row
    )));
    setDashboard((prev) => {
      const next = { ...(prev || {}) };
      const nextTotals = { ...(next.totals || {}) };
      nextTotals.incidents_new = Math.max(0, Number(nextTotals.incidents_new || 0) + delta);
      next.totals = nextTotals;
      return next;
    });
  };

  const handleAckIncident = async (incident) => {
    if (!canScanAck) return;
    const incidentId = String(incident?.id || '').trim();
    if (!incidentId) return;
    setBusyIncident(incidentId);
    try {
      await scanAPI.ackIncident(incidentId, 'web-user');
      if (String(incident?.status || '').toLowerCase() === 'new') {
        patchHostNewCount(selectedHost, -1);
      }
      await loadHostIncidents({ silent: true });
    } catch (error) {
      console.error('Ack incident failed', error);
    } finally {
      setBusyIncident('');
    }
  };

  const handleAckAllHostIncidents = async () => {
    if (!canScanAck) return;
    const pendingIds = hostIncidents
      .filter((item) => String(item.status || '').toLowerCase() === 'new')
      .map((item) => String(item.id || '').trim())
      .filter(Boolean);
    if (pendingIds.length === 0) return;
    setBusyAckAllHost(true);
    try {
      const results = await Promise.allSettled(
        pendingIds.map((incidentId) => scanAPI.ackIncident(incidentId, 'web-user')),
      );
      const acked = results.filter((item) => item.status === 'fulfilled').length;
      if (acked > 0) patchHostNewCount(selectedHost, -acked);
      await loadHostIncidents({ silent: true });
    } catch (error) {
      console.error('Ack all host incidents failed', error);
    } finally {
      setBusyAckAllHost(false);
    }
  };

  const openHostDetails = (hostname) => {
    const host = String(hostname || '').trim();
    if (!host) return;
    setSelectedHost(host);
    setIncidentQ('');
    setIncidentStatus('all');
    setIncidentSeverity('all');
    setIncidentSourceKind('all');
    setIncidentFileExt('');
    setIncidentDateFrom('');
    setIncidentDateTo('');
    setIncidentHasFragment(false);
    setHostDrawerOpen(true);
  };

  const enqueueTask = async (agentId, command) => {
    if (!canScanTasks) return;
    const normalizedAgentId = String(agentId || '').trim();
    if (!normalizedAgentId) return;
    try {
      setBusyTaskAgent(normalizedAgentId);
      const response = await scanAPI.createTask({
        agent_id: normalizedAgentId,
        command,
        dedupe_key: `${command}:${normalizedAgentId}`,
      });
      const task = response?.task && typeof response.task === 'object' ? response.task : null;
      if (task) {
        setAgentRows((prev) => prev.map((row) => (
          String(row.agent_id || '').trim() === normalizedAgentId
            ? {
              ...row,
              active_task: task,
              last_task: row.last_task || task,
              queue_size: Math.max(1, Number(row.queue_size || 0)),
            }
            : row
        )));
        setTrackedTaskAgentIds((prev) => Array.from(new Set([...prev, normalizedAgentId])));
      }
      setTaskNotice({
        severity: 'info',
        text: `${commandLabel(command)} отправлена для ${normalizedAgentId}`,
      });
    } catch (error) {
      console.error('Create task failed', error);
      setTaskNotice({
        severity: 'error',
        text: `Не удалось отправить ${commandLabel(command).toLowerCase()} для ${normalizedAgentId}`,
      });
    } finally {
      setBusyTaskAgent('');
    }
  };

  const resolveIncidentIp = (incident) => {
    const meta = hostMetaByName[normalizeHost(incident?.hostname || selectedHost)] || {};
    return String(incident?.ip_address || meta.ip || '').trim() || '-';
  };

  const renderSummaryCard = (title, value, helper, color = 'text.primary') => (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="body2" color="text.secondary">{title}</Typography>
        <Typography variant="h4" sx={{ fontWeight: 700, color }}>{value}</Typography>
        <Typography variant="caption" color="text.secondary">{helper}</Typography>
      </CardContent>
    </Card>
  );

  return (
    <MainLayout>
      <PageShell sx={{ width: '100%', pb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, gap: 2, flexWrap: 'wrap' }}>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>Центр сканирования</Typography>
            <Typography variant="body2" color="text.secondary">
              Обзор агентов, задач и инцидентов без полного reload страницы.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <FormControlLabel
              control={<Switch checked={!autoRefreshPaused} onChange={(event) => setAutoRefreshPaused(!event.target.checked)} />}
              label={autoRefreshPaused ? 'Автообновление: пауза' : 'Автообновление: 30с'}
            />
            <Button
              type="button"
              variant="outlined"
              startIcon={refreshing ? <CircularProgress size={16} /> : <RefreshIcon />}
              onClick={() => refreshAll({ silent: false })}
              disabled={refreshing}
            >
              Обновить
            </Button>
          </Stack>
        </Box>

        {taskNotice && (
          <Alert severity={taskNotice.severity} sx={{ mb: 2 }} onClose={() => setTaskNotice(null)}>
            {taskNotice.text}
          </Alert>
        )}

        {!dashboardLoading && Number(totals.incidents_new || 0) > 0 && (
          <Alert severity="warning" icon={<WarningAmberIcon fontSize="inherit" />} sx={{ mb: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              Новые инциденты: {Number(totals.incidents_new || 0)}
            </Typography>
            <Typography variant="body2">
              {(Array.isArray(dashboard.new_hosts) ? dashboard.new_hosts : []).slice(0, 8).join(', ')}
            </Typography>
          </Alert>
        )}

        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} sm={6} md={3}>{renderSummaryCard('Агенты', Number(totals.agents_total || 0), 'зарегистрировано')}</Grid>
          <Grid item xs={12} sm={6} md={3}>{renderSummaryCard('В сети', Number(totals.agents_online || 0), 'активны за 5 минут', 'success.main')}</Grid>
          <Grid item xs={12} sm={6} md={3}>{renderSummaryCard('Новые инциденты', Number(totals.incidents_new || 0), 'статус NEW', 'warning.main')}</Grid>
          <Grid item xs={12} sm={6} md={3}>{renderSummaryCard('Очередь задач', Number(totals.queue_active || 0), `просрочено: ${Number(totals.queue_expired || 0)}`, 'info.main')}</Grid>
        </Grid>

        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Autocomplete
            size="small"
            fullWidth
            options={branchOptions}
            loading={branchOptionsLoading}
            value={branchOptions.includes(branchFilter) ? branchFilter : null}
            onChange={(_, nextValue) => {
              setBranchFilter(nextValue || '');
              setAgentPage(0);
              setHostPage(0);
            }}
            clearOnEscape
            noOptionsText="Филиалы не найдены"
            loadingText="Загрузка филиалов..."
            renderInput={(params) => (
              <TextField
                {...params}
                label="Филиал"
                placeholder="Выберите филиал"
              />
            )}
          />
        </Paper>

        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Stack spacing={1.5}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>Агенты и очередь</Typography>
              <Chip size="small" label={`Всего: ${agentTotal}`} />
            </Box>
            <Grid container spacing={1.2}>
              <Grid item xs={12} md={5}>
                <TextField
                  size="small"
                  fullWidth
                  label="Поиск по агентам"
                  value={agentQ}
                  onChange={(event) => {
                    setAgentQ(event.target.value);
                    setAgentPage(0);
                  }}
                  placeholder="Hostname, agent_id, IP, филиал"
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Сеть</InputLabel>
                  <Select value={agentOnline} label="Сеть" onChange={(event) => { setAgentOnline(event.target.value); setAgentPage(0); }}>
                    <MenuItem value="all">Все</MenuItem>
                    <MenuItem value="online">В сети</MenuItem>
                    <MenuItem value="offline">Не в сети</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={4}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Статус задачи</InputLabel>
                  <Select value={agentTaskStatus} label="Статус задачи" onChange={(event) => { setAgentTaskStatus(event.target.value); setAgentPage(0); }}>
                    <MenuItem value="all">Все</MenuItem>
                    <MenuItem value="active">Любая активная</MenuItem>
                    <MenuItem value="queued">В очереди</MenuItem>
                    <MenuItem value="delivered">Доставлено</MenuItem>
                    <MenuItem value="acknowledged">Выполняется</MenuItem>
                    <MenuItem value="completed">Завершено</MenuItem>
                    <MenuItem value="failed">Ошибка</MenuItem>
                    <MenuItem value="expired">Просрочено</MenuItem>
                    <MenuItem value="none">Без активной задачи</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 520 }}>
              <Table stickyHeader size="small" sx={{ minWidth: 1160 }}>
                <TableHead>
                  <TableRow>
                    {[
                      ['hostname', 'Hostname'],
                      ['branch', 'Филиал'],
                      ['ip_address', 'IP'],
                      ['online', 'Связь'],
                      ['last_seen_at', 'Последний heartbeat'],
                      ['active_task', 'Активная задача'],
                      ['queue_size', 'Очередь'],
                      ['last_result', 'Последняя задача'],
                    ].map(([key, label]) => (
                      <TableCell key={key} sortDirection={agentSortBy === key ? agentSortDir : false}>
                        <TableSortLabel
                          active={agentSortBy === key}
                          direction={agentSortBy === key ? agentSortDir : 'desc'}
                          onClick={() => {
                            setAgentSortDir(sortToggle(agentSortBy, agentSortDir, key));
                            setAgentSortBy(key);
                          }}
                        >
                          {label}
                        </TableSortLabel>
                      </TableCell>
                    ))}
                    <TableCell align="right">Действия</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {agentsLoading && agentRows.length === 0 ? (
                    <TableRow><TableCell colSpan={9} align="center"><CircularProgress size={24} /></TableCell></TableRow>
                  ) : agentRows.length === 0 ? (
                    <TableRow><TableCell colSpan={9} align="center">Нет данных по агентам.</TableCell></TableRow>
                  ) : agentRows.map((agent) => (
                    <TableRow hover key={agent.agent_id}>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>{String(agent.hostname || agent.agent_id || '').trim() || '-'}</Typography>
                        <Typography variant="caption" color="text.secondary">{String(agent.agent_id || '').trim() || '-'}</Typography>
                      </TableCell>
                      <TableCell>{String(agent.branch || '').trim() || 'Без филиала'}</TableCell>
                      <TableCell>{String(agent.ip_address || '').trim() || '-'}</TableCell>
                      <TableCell>
                        <Chip size="small" color={agent.is_online ? 'success' : 'default'} label={agent.is_online ? 'В сети' : 'Не в сети'} />
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                          {formatLastSeen(agent.age_seconds, agent.is_online)}
                        </Typography>
                      </TableCell>
                      <TableCell>{formatTs(agent.last_seen_at)}</TableCell>
                      <TableCell>
                        {agent.active_task ? (
                          <Stack direction="row" spacing={0.8} useFlexGap flexWrap="wrap">
                            <Chip
                              size="small"
                              variant="outlined"
                              label={String(agent.active_task.command || '').toLowerCase() === 'scan_now' ? 'Сканирование' : 'Проверка связи'}
                            />
                            <Chip size="small" color={taskStatusColor(agent.active_task.status)} label={taskStatusLabel(agent.active_task.status)} />
                          </Stack>
                        ) : '-'}
                      </TableCell>
                      <TableCell>{Number(agent.queue_size || 0)}</TableCell>
                      <TableCell>
                        {agent.last_task ? (
                          <>
                            <Typography variant="body2">{summarizeTaskResult(agent.last_task)}</Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              {`${commandLabel(agent.last_task.command)} · ${taskStatusLabel(agent.last_task.status)}`}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              {`${taskTimestampLabel(agent.last_task)}: ${formatTaskTimestamp(agent.last_task)}`}
                            </Typography>
                          </>
                        ) : '-'}
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                          <Button
                            type="button"
                            size="small"
                            variant="outlined"
                            startIcon={<PlayArrowIcon />}
                            disabled={!canScanTasks || busyTaskAgent === agent.agent_id}
                            onClick={() => enqueueTask(agent.agent_id, 'scan_now')}
                          >
                            Сканировать
                          </Button>
                          <Button
                            type="button"
                            size="small"
                            variant="outlined"
                            disabled={!canScanTasks || busyTaskAgent === agent.agent_id}
                            onClick={() => enqueueTask(agent.agent_id, 'ping')}
                          >
                            Проверить связь
                          </Button>
                          <Button type="button" size="small" variant="contained" onClick={() => openHostDetails(agent.hostname || agent.agent_id)}>
                            Инциденты
                          </Button>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div"
              count={agentTotal}
              page={agentPage}
              onPageChange={(_, nextPage) => setAgentPage(nextPage)}
              rowsPerPage={agentRowsPerPage}
              onRowsPerPageChange={(event) => {
                setAgentRowsPerPage(Number(event.target.value));
                setAgentPage(0);
              }}
              rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
              labelRowsPerPage="Строк на странице"
            />
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1.5}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>Компьютеры с находками</Typography>
              <Chip size="small" label={`Всего: ${hostTotal}`} />
            </Box>
            <Grid container spacing={1.2}>
              <Grid item xs={12} md={6}>
                <TextField
                  size="small"
                  fullWidth
                  label="Поиск по хостам"
                  value={hostQ}
                  onChange={(event) => {
                    setHostQ(event.target.value);
                    setHostPage(0);
                  }}
                  placeholder="ПК, пользователь, IP, филиал"
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Статус</InputLabel>
                  <Select value={hostStatus} label="Статус" onChange={(event) => { setHostStatus(event.target.value); setHostPage(0); }}>
                    <MenuItem value="all">Все</MenuItem>
                    <MenuItem value="new">NEW</MenuItem>
                    <MenuItem value="ack">ACK</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={3}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Severity</InputLabel>
                  <Select value={hostSeverity} label="Severity" onChange={(event) => { setHostSeverity(event.target.value); setHostPage(0); }}>
                    <MenuItem value="all">Все</MenuItem>
                    <MenuItem value="high">High</MenuItem>
                    <MenuItem value="medium">Medium</MenuItem>
                    <MenuItem value="low">Low</MenuItem>
                    <MenuItem value="none">None</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 520 }}>
              <Table stickyHeader size="small" sx={{ minWidth: 1240 }}>
                <TableHead>
                  <TableRow>
                    {[
                      ['hostname', 'Hostname'],
                      ['branch', 'Филиал'],
                      ['user', 'Пользователь'],
                      ['ip_address', 'IP'],
                      ['incidents_new', 'Новые'],
                      ['incidents_total', 'Всего'],
                      ['severity', 'Severity'],
                      ['last_incident_at', 'Последний инцидент'],
                    ].map(([key, label]) => (
                      <TableCell key={key} sortDirection={hostSortBy === key ? hostSortDir : false}>
                        <TableSortLabel
                          active={hostSortBy === key}
                          direction={hostSortBy === key ? hostSortDir : 'desc'}
                          onClick={() => {
                            setHostSortDir(sortToggle(hostSortBy, hostSortDir, key));
                            setHostSortBy(key);
                          }}
                        >
                          {label}
                        </TableSortLabel>
                      </TableCell>
                    ))}
                    <TableCell>Типы</TableCell>
                    <TableCell align="right">Действия</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {hostsLoading && hostRows.length === 0 ? (
                    <TableRow><TableCell colSpan={10} align="center"><CircularProgress size={24} /></TableCell></TableRow>
                  ) : hostRows.length === 0 ? (
                    <TableRow><TableCell colSpan={10} align="center">Инцидентов пока нет.</TableCell></TableRow>
                  ) : hostRows.map((row) => (
                    <TableRow hover key={row.hostname}>
                      <TableCell>{row.hostname}</TableCell>
                      <TableCell>{row.branch || 'Без филиала'}</TableCell>
                      <TableCell>{row.user || '-'}</TableCell>
                      <TableCell>{row.ip_address || '-'}</TableCell>
                      <TableCell><Chip size="small" color={Number(row.incidents_new || 0) > 0 ? 'warning' : 'default'} label={Number(row.incidents_new || 0)} /></TableCell>
                      <TableCell>{Number(row.incidents_total || 0)}</TableCell>
                      <TableCell><Chip size="small" color={severityColor(row.top_severity)} label={String(row.top_severity || 'none')} /></TableCell>
                      <TableCell>{formatTs(row.last_incident_at)}</TableCell>
                      <TableCell>
                        <Typography variant="body2">{(Array.isArray(row.top_exts) ? row.top_exts : []).join(', ') || '-'}</Typography>
                        <Typography variant="caption" color="text.secondary">{(Array.isArray(row.top_source_kinds) ? row.top_source_kinds : []).join(', ') || '-'}</Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Button type="button" size="small" variant="outlined" onClick={() => openHostDetails(row.hostname)}>
                          Просмотреть
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div"
              count={hostTotal}
              page={hostPage}
              onPageChange={(_, nextPage) => setHostPage(nextPage)}
              rowsPerPage={hostRowsPerPage}
              onRowsPerPageChange={(event) => {
                setHostRowsPerPage(Number(event.target.value));
                setHostPage(0);
              }}
              rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
              labelRowsPerPage="Строк на странице"
            />
          </Stack>
        </Paper>

        <Drawer anchor="right" open={hostDrawerOpen} onClose={() => setHostDrawerOpen(false)}>
          <Box sx={{ width: { xs: 360, sm: 720 }, p: 2.2 }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>{selectedHost || 'Компьютер'}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              Показано: {hostIncidents.length} из {hostIncidentsTotal}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
              <Chip size="small" color={hostNewCount > 0 ? 'warning' : 'default'} label={`Новых: ${hostNewCount}`} />
              <Button type="button" size="small" variant="contained" onClick={handleAckAllHostIncidents} disabled={!canScanAck || hostLoading || busyAckAllHost || hostNewCount === 0}>
                Просмотрено все
              </Button>
              <Button type="button" size="small" variant={incidentHasFragment ? 'contained' : 'outlined'} onClick={() => setIncidentHasFragment((prev) => !prev)}>
                Только с фрагментами
              </Button>
            </Box>
            <Grid container spacing={1.2} sx={{ mb: 1 }}>
              <Grid item xs={12}>
                <TextField size="small" fullWidth label="Поиск по пути/фрагменту/паттерну" value={incidentQ} onChange={(event) => setIncidentQ(event.target.value)} />
              </Grid>
              <Grid item xs={6}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Статус</InputLabel>
                  <Select value={incidentStatus} label="Статус" onChange={(event) => setIncidentStatus(event.target.value)}>
                    <MenuItem value="all">Все</MenuItem>
                    <MenuItem value="new">NEW</MenuItem>
                    <MenuItem value="ack">ACK</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={6}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Severity</InputLabel>
                  <Select value={incidentSeverity} label="Severity" onChange={(event) => setIncidentSeverity(event.target.value)}>
                    <MenuItem value="all">Все</MenuItem>
                    <MenuItem value="high">High</MenuItem>
                    <MenuItem value="medium">Medium</MenuItem>
                    <MenuItem value="low">Low</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={6}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Источник</InputLabel>
                  <Select value={incidentSourceKind} label="Источник" onChange={(event) => setIncidentSourceKind(event.target.value)}>
                    <MenuItem value="all">Все</MenuItem>
                    {incidentSourceOptions.map((option) => <MenuItem key={option} value={option}>{option}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={6}>
                <TextField size="small" fullWidth label="Расширение файла" value={incidentFileExt} onChange={(event) => setIncidentFileExt(event.target.value)} placeholder="pdf/txt/docx" />
              </Grid>
              <Grid item xs={6}>
                <TextField size="small" fullWidth type="date" label="Дата с" value={incidentDateFrom} onChange={(event) => setIncidentDateFrom(event.target.value)} InputLabelProps={{ shrink: true }} />
              </Grid>
              <Grid item xs={6}>
                <TextField size="small" fullWidth type="date" label="Дата по" value={incidentDateTo} onChange={(event) => setIncidentDateTo(event.target.value)} InputLabelProps={{ shrink: true }} />
              </Grid>
            </Grid>
            {hostLoading ? (
              <Box sx={{ py: 3, display: 'flex', justifyContent: 'center' }}><CircularProgress size={30} /></Box>
            ) : hostIncidents.length === 0 ? (
              <Typography color="text.secondary">Инциденты по текущим фильтрам не найдены.</Typography>
            ) : (
              <Stack spacing={1.3}>
                {hostIncidents.map((incident) => (
                  <Paper key={incident.id} variant="outlined" sx={{ p: 1.2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.6, gap: 1 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                        {incident.severity || '-'} · {formatTs(incident.created_at)}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Chip size="small" color={String(incident.status || '').toLowerCase() === 'new' ? 'warning' : 'default'} label={incident.status || '-'} />
                        {String(incident.status || '').toLowerCase() === 'new' && (
                          <Button type="button" size="small" variant="outlined" disabled={!canScanAck || busyIncident === incident.id} onClick={() => handleAckIncident(incident)}>
                            ACK
                          </Button>
                        )}
                      </Box>
                    </Box>
                    <Typography variant="body2" sx={{ mb: 0.8 }}>{incident.file_path || '-'}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.4 }}>
                      Тип: {getIncidentFileExt(incident) || '-'} · Источник: {getIncidentSourceKind(incident) || '-'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.8 }}>
                      {String(incident?.branch || hostMetaByName[normalizeHost(incident?.hostname || selectedHost)]?.branch || '').trim() || 'Без филиала'} · {String(incident?.user_full_name || incident?.user_login || hostMetaByName[normalizeHost(incident?.hostname || selectedHost)]?.user || '').trim() || '-'} · IP: {resolveIncidentIp(incident)}
                    </Typography>
                    {renderFragments(incident)}
                  </Paper>
                ))}
              </Stack>
            )}
          </Box>
        </Drawer>
      </PageShell>
    </MainLayout>
  );
}

export default ScanCenter;
