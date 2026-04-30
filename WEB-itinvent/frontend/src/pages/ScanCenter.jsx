import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  FormControl,
  FormControlLabel,
  Grid,
  LinearProgress,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  Download as DownloadIcon,
  ExpandMore as ExpandMoreIcon,
  PlayArrow as PlayArrowIcon,
  Refresh as RefreshIcon,
  WarningAmber as WarningAmberIcon,
} from '@mui/icons-material';
import { FixedSizeList as VirtualList } from 'react-window';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import { scanAPI } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useScanIncidentInbox, INCIDENT_BATCH_SIZE } from '../hooks/useScanIncidentInbox';
import { buildOfficeUiTokens, getOfficeMetricBlockSx, getOfficePanelSx, getOfficeQuietActionSx } from '../theme/officeUiTokens';
import {
  flattenIncidentGroups,
  getIncidentFileExt as getInboxIncidentFileExt,
  getIncidentSourceKind as getInboxIncidentSourceKind,
  groupIncidentsByHostFile,
} from '../lib/scanIncidentInbox';

const AUTO_REFRESH_MS = 30_000;
const TASK_POLL_MS = 3_000;
const DEFAULT_ROWS_PER_PAGE = 25;
const ROWS_PER_PAGE_OPTIONS = [25, 50, 100];
const SCAN_RUN_OBSERVATION_LIMIT = 80;
const ACTIVE_TASK_STATUSES = new Set(['queued', 'delivered', 'acknowledged']);

function normalizePatternRows(value) {
  const items = Array.isArray(value?.items) ? value.items : Array.isArray(value) ? value : [];
  return items
    .map((item) => ({
      id: String(item?.id || '').trim(),
      name: String(item?.name || item?.id || '').trim(),
      category: String(item?.category || 'Общие').trim() || 'Общие',
      weight: Number(item?.weight || 0),
      enabled_by_default: item?.enabled_by_default !== false,
    }))
    .filter((item) => item.id);
}

function selectedPatternIdsFromRows(rows) {
  return normalizePatternRows(rows)
    .filter((item) => item.enabled_by_default)
    .map((item) => item.id);
}

function groupPatternsByCategory(rows, query) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  const groups = new Map();
  normalizePatternRows(rows).forEach((item) => {
    const haystack = `${item.id} ${item.name} ${item.category}`.toLowerCase();
    if (normalizedQuery && !haystack.includes(normalizedQuery)) return;
    const key = item.category || 'Общие';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  return Array.from(groups.entries()).map(([category, items]) => ({
    category,
    items: items.sort((a, b) => a.name.localeCompare(b.name, 'ru')),
  }));
}

function patternPayloadSummary(payload, patterns) {
  const selected = Array.isArray(payload?.server_pdf_pattern_ids) ? payload.server_pdf_pattern_ids.length : 0;
  const total = Array.isArray(patterns) ? patterns.length : 0;
  if (!total) return '';
  return `PDF паттерны: ${selected} из ${total}`;
}

function parseFilename(contentDisposition) {
  if (!contentDisposition) return '';
  const matched = /filename="?([^"]+)"?/i.exec(String(contentDisposition));
  return matched?.[1] || '';
}

function downloadBlobResponse(response, fallbackName) {
  const blob = response?.data instanceof Blob
    ? response.data
    : new Blob([response?.data || response], { type: response?.headers?.['content-type'] || 'application/octet-stream' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = parseFilename(response?.headers?.['content-disposition']) || fallbackName || 'scan_report.xlsx';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

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

function isForceScanTask(task) {
  if (!task || typeof task !== 'object') return false;
  const result = task.result && typeof task.result === 'object' ? task.result : {};
  const payload = task.payload && typeof task.payload === 'object' ? task.payload : {};
  return Boolean(result.force_rescan || payload.force_rescan);
}

function commandLabel(command, task = null) {
  const normalized = String(command || '').trim().toLowerCase();
  if (normalized === 'scan_now') return isForceScanTask(task) ? 'Скан с 0' : 'Скан';
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

function scanRunErrorText(run) {
  const status = String(run?.status || '').trim().toLowerCase();
  if (status !== 'failed') return '';
  const result = run?.result && typeof run.result === 'object' ? run.result : {};
  const failedJobs = Number(run?.failed_jobs_count || result.jobs_failed || 0);
  const failedJobErrors = String(run?.failed_job_errors || result.failed_job_errors || '').trim();
  if (failedJobs > 0 && failedJobErrors) {
    return `Не обработано PDF: ${failedJobs}. ${failedJobErrors}`;
  }
  if (failedJobs > 0) {
    return `Не обработано PDF: ${failedJobs}. Проверьте ошибки заданий обработки PDF.`;
  }
  return String(
    run?.error_text
      || result.error_text
      || result.error
      || result.message
      || 'Запуск скана завершился с ошибкой без подробного текста',
  ).trim();
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

function renderTaskStatusLabel(task) {
  if (!task) return '-';
  const normalized = String(task.status || '').trim().toLowerCase();
  const command = String(task.command || '').trim().toLowerCase();
  const result = task.result && typeof task.result === 'object' ? task.result : {};
  const phase = String(result.phase || '').trim().toLowerCase();
  if (normalized === 'acknowledged' && command === 'scan_now') {
    if (phase === 'local_scan') return 'Локальное сканирование';
    if (phase === 'server_processing') return 'OCR/обработка';
  }
  if (normalized === 'completed' && command === 'scan_now') {
    return 'Завершено после OCR';
  }
  return taskStatusLabel(task.status);
}

const SCAN_SKIP_REASON_LABELS = {
  unsupported_extension: 'неподдерживаемые типы',
  no_match: 'без совпадений',
  already_scanned: 'уже учтены',
  size_limit: 'размер/пустые',
  stat_error: 'нет доступа',
  hash_error: 'ошибка чтения',
  not_file: 'не файлы',
};

function formatSkippedReasons(reasons) {
  if (!reasons || typeof reasons !== 'object') return '';
  return Object.entries(reasons)
    .map(([reason, count]) => ({
      label: SCAN_SKIP_REASON_LABELS[reason] || reason,
      count: Number(count || 0),
    }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((item) => `${item.label}: ${item.count}`)
    .join(' · ');
}

const OBSERVATION_LABELS = {
  found_new: 'Найдено впервые',
  found_duplicate: 'Найдено повторно',
  deleted: 'Файл удалён',
  cleaned: 'Файл очищен',
  moved: 'Файл перемещён',
};

const RESOLVED_STATUS_LABELS = {
  resolved_deleted: 'Удалён',
  resolved_clean: 'Очищен',
  resolved_moved: 'Перемещён',
};

function fileStatusLabel(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return RESOLVED_STATUS_LABELS[normalized] || (normalized === 'new' ? 'Актуален' : (normalized === 'ack' ? 'ACK' : normalized || '-'));
}

function fileStatusColor(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'new') return 'warning';
  if (normalized === 'ack') return 'info';
  if (normalized.startsWith('resolved_')) return 'success';
  return 'default';
}

function observationLabel(type) {
  const normalized = String(type || '').trim().toLowerCase();
  return OBSERVATION_LABELS[normalized] || normalized || '-';
}

function renderTaskSummary(task) {
  if (!task) return '-';
  const command = String(task.command || '').trim().toLowerCase();
  if (command !== 'scan_now') return summarizeTaskResult(task);

  const status = String(task.status || '').trim().toLowerCase();
  const result = task.result && typeof task.result === 'object' ? task.result : {};
  const phase = String(result.phase || '').trim().toLowerCase();
  const scanned = Number(result.scanned || 0);
  const queued = Number(result.queued || 0);
  const skipped = Number(result.skipped || 0);
  const deferred = Number(result.deferred || 0);
  const deduped = Number(result.deduped || 0);
  const deletedFromState = Number(result.deleted_from_state || 0);
  const filesSeen = Number(result.files_seen || 0);
  const skippedReasonsText = formatSkippedReasons(result.skipped_reasons);
  const scanLabel = isForceScanTask(task) ? 'Скан с 0' : 'Скан';
  const extra = [
    filesSeen > 0 ? `файлов всего: ${filesSeen}` : '',
    skippedReasonsText ? `пропуски: ${skippedReasonsText}` : '',
    deduped > 0 ? `дубли: ${deduped}` : '',
    deletedFromState > 0 ? `удалено из учета: ${deletedFromState}` : '',
  ].filter(Boolean);
  const extraText = extra.length > 0 ? ` · ${extra.join(' · ')}` : '';
  const jobsPending = Number(result.jobs_pending || 0);
  const jobsDoneClean = Number(result.jobs_done_clean || 0);
  const jobsDoneWithIncident = Number(result.jobs_done_with_incident || 0);
  const jobsFailed = Number(result.jobs_failed || 0);

  if (status === 'acknowledged' && phase === 'local_scan') {
    return `${scanLabel}: проверено ${scanned} · отправлено: ${queued} · пропущено: ${skipped}${extraText}`;
  }
  if (status === 'acknowledged' && phase === 'server_processing') {
    return `OCR: осталось ${jobsPending} · без инцидентов ${jobsDoneClean} · с инцидентами ${jobsDoneWithIncident} · ошибок ${jobsFailed}${extraText}`;
  }
  if (status === 'failed') {
    if (deferred > 0) {
      return `${scanLabel}: проверено ${scanned} · отправлено: ${queued} · в локальной очереди: ${deferred}${extraText}`;
    }
    if (jobsFailed > 0) {
      return `OCR: ошибок ${jobsFailed} · без инцидентов ${jobsDoneClean} · с инцидентами ${jobsDoneWithIncident}${extraText}`;
    }
  }
  if (status === 'completed') {
    if (Number(result.jobs_total || 0) > 0) {
      return `${scanLabel}: проверено ${scanned} · без инцидентов ${jobsDoneClean} · с инцидентами ${jobsDoneWithIncident}${extraText}`;
    }
    return `${scanLabel}: проверено ${scanned} · отправлено: ${queued} · пропущено: ${skipped}${extraText}`;
  }
  return summarizeTaskResult(task);
}

function ScanCenter() {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const incidentWorkAreaHeight = 'calc(100dvh - var(--app-shell-header-offset) - 360px)';
  const { hasPermission } = useAuth();
  const canScanRead = hasPermission('scan.read');
  const canScanAck = hasPermission('scan.ack');
  const canScanTasks = hasPermission('scan.tasks');

  const [activeSection, setActiveSection] = useState('incidents');
  const [dashboard, setDashboard] = useState({ totals: {}, daily: [], by_severity: [], by_branch: [], new_hosts: [] });
  const [dashboardLoading, setDashboardLoading] = useState(true);

  const [branchFilter, setBranchFilter] = useState('');
  const [branchOptions, setBranchOptions] = useState([]);
  const [branchOptionsLoading, setBranchOptionsLoading] = useState(true);
  const [autoRefreshPaused, setAutoRefreshPaused] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [taskNotice, setTaskNotice] = useState(null);
  const [scanPatterns, setScanPatterns] = useState([]);
  const [scanPatternsLoading, setScanPatternsLoading] = useState(true);
  const [scanLaunchDialog, setScanLaunchDialog] = useState({
    open: false,
    agentId: '',
    forceRescan: false,
  });
  const [scanPatternQuery, setScanPatternQuery] = useState('');
  const [selectedScanPatternIds, setSelectedScanPatternIds] = useState([]);

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
  const [hostScanRuns, setHostScanRuns] = useState([]);
  const [hostScanRunsTotal, setHostScanRunsTotal] = useState(0);
  const [hostScanRunsLoading, setHostScanRunsLoading] = useState(false);
  const [expandedScanRunId, setExpandedScanRunId] = useState('');
  const [scanRunObservations, setScanRunObservations] = useState({});
  const [scanRunObservationsLoading, setScanRunObservationsLoading] = useState('');
  const [exportingScanRunId, setExportingScanRunId] = useState('');
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
  const [busyAckInbox, setBusyAckInbox] = useState(false);
  const [selectedInboxIncidentId, setSelectedInboxIncidentId] = useState('');
  const [expandedIncidentRows, setExpandedIncidentRows] = useState({});

  const agentsRequestIdRef = useRef(0);
  const hostsRequestIdRef = useRef(0);
  const hostIncidentRequestIdRef = useRef(0);
  const hostScanRunsRequestIdRef = useRef(0);
  const skipInitialAgentsEffectRef = useRef(true);
  const skipInitialHostsEffectRef = useRef(true);

  const debouncedBranch = useDebouncedValue(branchFilter);
  const debouncedAgentQ = useDebouncedValue(agentQ);
  const debouncedHostQ = useDebouncedValue(hostQ);
  const debouncedIncidentQ = useDebouncedValue(incidentQ);

  const totals = dashboard.totals || {};
  const selectedScanPatternSet = useMemo(() => new Set(selectedScanPatternIds), [selectedScanPatternIds]);
  const groupedScanPatterns = useMemo(
    () => groupPatternsByCategory(scanPatterns, scanPatternQuery),
    [scanPatterns, scanPatternQuery],
  );

  const incidentInboxFilters = useMemo(() => ({
    branch: debouncedBranch || undefined,
    q: debouncedIncidentQ || undefined,
    status: incidentStatus === 'all' ? undefined : incidentStatus,
    severity: incidentSeverity === 'all' ? undefined : incidentSeverity,
    source_kind: incidentSourceKind === 'all' ? undefined : incidentSourceKind,
    file_ext: incidentFileExt || undefined,
    date_from: incidentDateFrom || undefined,
    date_to: incidentDateTo || undefined,
    has_fragment: incidentHasFragment ? true : undefined,
  }), [
    debouncedBranch,
    debouncedIncidentQ,
    incidentStatus,
    incidentSeverity,
    incidentSourceKind,
    incidentFileExt,
    incidentDateFrom,
    incidentDateTo,
    incidentHasFragment,
  ]);

  const incidentInbox = useScanIncidentInbox(incidentInboxFilters, { batchSize: INCIDENT_BATCH_SIZE });
  const incidentGroups = useMemo(() => groupIncidentsByHostFile(incidentInbox.items), [incidentInbox.items]);
  const incidentRows = useMemo(
    () => flattenIncidentGroups(incidentGroups, expandedIncidentRows),
    [expandedIncidentRows, incidentGroups],
  );
  const selectedInboxIncident = useMemo(() => (
    incidentInbox.items.find((item) => String(item?.id || '') === String(selectedInboxIncidentId || ''))
    || incidentInbox.items[0]
    || null
  ), [incidentInbox.items, selectedInboxIncidentId]);

  useEffect(() => {
    if (!selectedInboxIncidentId && incidentInbox.items[0]?.id) {
      setSelectedInboxIncidentId(String(incidentInbox.items[0].id));
    }
  }, [incidentInbox.items, selectedInboxIncidentId]);

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
    [...hostIncidents, ...incidentInbox.items].forEach((item) => {
      const source = getIncidentSourceKind(item);
      if (source) set.add(source);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ru'));
  }, [hostIncidents, incidentInbox.items]);

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
        if (!silent) {
          setAgentRows([]);
          setAgentTotal(0);
        }
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
        if (!silent) {
          setHostRows([]);
          setHostTotal(0);
        }
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
        if (!silent) {
          setHostIncidents([]);
          setHostIncidentsTotal(0);
        }
      }
    } finally {
      if (requestId === hostIncidentRequestIdRef.current && !silent) {
        setHostLoading(false);
      }
    }
  };

  const loadScanPatterns = async () => {
    setScanPatternsLoading(true);
    try {
      const data = await scanAPI.getPatterns();
      const rows = normalizePatternRows(data);
      setScanPatterns(rows);
      setSelectedScanPatternIds((prev) => {
        const allowed = new Set(rows.map((item) => item.id));
        const next = (Array.isArray(prev) ? prev : []).filter((item) => allowed.has(item));
        return next.length > 0 ? next : selectedPatternIdsFromRows(rows);
      });
    } catch (error) {
      console.error('Scan patterns load failed', error);
      setScanPatterns([]);
      setSelectedScanPatternIds([]);
    } finally {
      setScanPatternsLoading(false);
    }
  };

  const loadHostScanRuns = async ({ silent = false } = {}) => {
    const host = String(selectedHost || '').trim();
    if (!host) return;
    const requestId = hostScanRunsRequestIdRef.current + 1;
    hostScanRunsRequestIdRef.current = requestId;
    if (!silent) setHostScanRunsLoading(true);
    try {
      const response = await scanAPI.getHostScanRuns(host, { limit: 30, offset: 0 });
      if (requestId !== hostScanRunsRequestIdRef.current) return;
      const items = Array.isArray(response?.items) ? response.items : [];
      setHostScanRuns(items);
      setHostScanRunsTotal(Number(response?.total || 0));
    } catch (error) {
      console.error('Host scan runs load failed', error);
      if (requestId === hostScanRunsRequestIdRef.current && !silent) {
        setHostScanRuns([]);
        setHostScanRunsTotal(0);
      }
    } finally {
      if (requestId === hostScanRunsRequestIdRef.current && !silent) {
        setHostScanRunsLoading(false);
      }
    }
  };

  const loadScanRunObservations = async (taskId) => {
    const normalizedTaskId = String(taskId || '').trim();
    if (!normalizedTaskId || scanRunObservations[normalizedTaskId]) return;
    setScanRunObservationsLoading(normalizedTaskId);
    try {
      const response = await scanAPI.getTaskObservations(normalizedTaskId, { limit: SCAN_RUN_OBSERVATION_LIMIT, offset: 0 });
      setScanRunObservations((prev) => ({
        ...prev,
        [normalizedTaskId]: {
          total: Number(response?.total || 0),
          items: Array.isArray(response?.items) ? response.items : [],
        },
      }));
    } catch (error) {
      console.error('Scan run observations load failed', error);
      setScanRunObservations((prev) => ({
        ...prev,
        [normalizedTaskId]: { total: 0, items: [] },
      }));
    } finally {
      setScanRunObservationsLoading((prev) => (prev === normalizedTaskId ? '' : prev));
    }
  };

  const handleExportScanRunIncidents = async (event, run) => {
    event?.stopPropagation?.();
    const taskId = String(run?.id || '').trim();
    if (!taskId || !canScanRead) return;
    setExportingScanRunId(taskId);
    try {
      const response = await scanAPI.exportScanTaskIncidents(taskId);
      const hostPart = String(run?.hostname || selectedHost || 'host').trim().replace(/[^A-Za-z0-9._-]+/g, '_') || 'host';
      downloadBlobResponse(response, `scan_incidents_${hostPart}_${taskId.slice(0, 8) || 'task'}.xlsx`);
    } catch (error) {
      console.error('Scan run export failed', error);
      setTaskNotice({
        severity: 'error',
        text: 'Не удалось экспортировать отчет запуска скана',
      });
    } finally {
      setExportingScanRunId('');
    }
  };

  const refreshAll = async ({ silent = true } = {}) => {
    if (!silent) setRefreshing(true);
    try {
      await Promise.all([
        loadDashboard({ silent }),
        loadAgents({ silent }),
        loadHosts({ silent }),
        incidentInbox.loaded > 0 ? incidentInbox.refreshFirstPage({ silent: true }) : Promise.resolve(),
        hostDrawerOpen && selectedHost ? loadHostIncidents({ silent }) : Promise.resolve(),
        hostDrawerOpen && selectedHost ? loadHostScanRuns({ silent }) : Promise.resolve(),
      ]);
    } finally {
      if (!silent) setRefreshing(false);
    }
  };

  useEffect(() => {
    loadBranchOptions();
    loadScanPatterns();
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
    if (!hostDrawerOpen || !selectedHost) return;
    loadHostScanRuns({ silent: hostScanRuns.length > 0 || hostScanRunsTotal > 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostDrawerOpen, selectedHost]);

  useEffect(() => {
    if (!expandedScanRunId) return;
    loadScanRunObservations(expandedScanRunId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedScanRunId]);

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
        const data = await scanAPI.getAgentsActivity(monitoredAgentIds);
        if (cancelled) return;
        const activityByAgent = new Map(
          (Array.isArray(data?.items) ? data.items : []).map((item) => [String(item?.agent_id || '').trim(), item]),
        );
        const nowTs = Math.floor(Date.now() / 1000);
        setAgentRows((prev) => prev.map((row) => {
          const activity = activityByAgent.get(String(row.agent_id || '').trim());
          if (!activity) return row;
          const lastSeenAt = Number(activity.last_seen_at || row.last_seen_at || 0);
          return {
            ...row,
            is_online: Boolean(activity.is_online),
            last_seen_at: lastSeenAt,
            age_seconds: lastSeenAt > 0 ? Math.max(0, nowTs - lastSeenAt) : row.age_seconds,
            active_task: activity.active_task || null,
            last_task: activity.last_task || row.last_task || null,
            queue_size: Number(activity.queue_size || 0),
          };
        }));
        setTrackedTaskAgentIds((prev) => prev.filter((agentId) => {
          const activity = activityByAgent.get(agentId);
          return Boolean(activity && isActiveTask(activity.active_task));
        }));
      } catch (error) {
        if (!cancelled) {
          console.error('Scan activity polling failed', error);
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
      await incidentInbox.refreshFirstPage({ silent: true });
    } catch (error) {
      console.error('Ack incident failed', error);
    } finally {
      setBusyIncident('');
    }
  };

  const buildIncidentFilters = (overrides = {}) => ({
    branch: debouncedBranch || undefined,
    hostname: overrides.hostname,
    q: debouncedIncidentQ || undefined,
    status: incidentStatus === 'all' ? undefined : incidentStatus,
    severity: incidentSeverity === 'all' ? undefined : incidentSeverity,
    source_kind: incidentSourceKind === 'all' ? undefined : incidentSourceKind,
    file_ext: incidentFileExt || undefined,
    date_from: incidentDateFrom || undefined,
    date_to: incidentDateTo || undefined,
    has_fragment: incidentHasFragment ? true : undefined,
    ...overrides,
  });

  const handleAckAllHostIncidents = async () => {
    if (!canScanAck) return;
    if (hostNewCount === 0) return;
    setBusyAckAllHost(true);
    try {
      const response = await scanAPI.ackIncidentsBatch({
        filters: buildIncidentFilters({ hostname: selectedHost }),
        ack_by: 'web-user',
      });
      const acked = Number(response?.acked_count || 0);
      if (acked > 0) patchHostNewCount(selectedHost, -acked);
      await loadHostIncidents({ silent: true });
      await incidentInbox.reload({ silent: true });
    } catch (error) {
      console.error('Ack all host incidents failed', error);
    } finally {
      setBusyAckAllHost(false);
    }
  };

  const handleAckInboxFiltered = async () => {
    if (!canScanAck) return;
    const pending = incidentInbox.items.filter((item) => String(item?.status || '').toLowerCase() === 'new').length;
    if (pending <= 0) return;
    setBusyAckInbox(true);
    try {
      const response = await scanAPI.ackIncidentsBatch({
        filters: buildIncidentFilters(),
        ack_by: 'web-user',
      });
      const acked = Number(response?.acked_count || 0);
      if (acked > 0) patchHostNewCount('', -acked);
      await Promise.all([
        incidentInbox.reload({ silent: true }),
        loadHosts({ silent: true }),
        loadDashboard({ silent: true }),
        hostDrawerOpen && selectedHost ? loadHostIncidents({ silent: true }) : Promise.resolve(),
      ]);
    } catch (error) {
      console.error('Ack inbox incidents failed', error);
    } finally {
      setBusyAckInbox(false);
    }
  };

  const resetIncidentFilters = () => {
    setIncidentQ('');
    setIncidentStatus('all');
    setIncidentSeverity('all');
    setIncidentSourceKind('all');
    setIncidentFileExt('');
    setIncidentDateFrom('');
    setIncidentDateTo('');
    setIncidentHasFragment(false);
  };

  const expandAllIncidentRows = () => {
    const next = {};
    incidentGroups.forEach((host) => {
      next[host.id] = true;
      (Array.isArray(host.files) ? host.files : []).forEach((file) => {
        next[file.id] = true;
      });
    });
    setExpandedIncidentRows(next);
  };

  const collapseAllIncidentRows = () => {
    setExpandedIncidentRows({});
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
    setHostScanRuns([]);
    setHostScanRunsTotal(0);
    setExpandedScanRunId('');
    setScanRunObservations({});
    setHostDrawerOpen(true);
  };

  const enqueueTask = async (agentId, command, options = {}) => {
    if (!canScanTasks) return;
    const normalizedAgentId = String(agentId || '').trim();
    if (!normalizedAgentId) return;
    const payload = options.payload && typeof options.payload === 'object' ? options.payload : undefined;
    const dedupeKey = String(options.dedupeKey || `${command}:${normalizedAgentId}`).trim();
    try {
      setBusyTaskAgent(normalizedAgentId);
      const response = await scanAPI.createTask({
        agent_id: normalizedAgentId,
        command,
        ...(payload ? { payload } : {}),
        dedupe_key: dedupeKey,
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
      const label = commandLabel(command, { payload });
      setTaskNotice({
        severity: 'info',
        text: `${label} отправлена для ${normalizedAgentId}`,
      });
    } catch (error) {
      console.error('Create task failed', error);
      const label = commandLabel(command, { payload }).toLowerCase();
      setTaskNotice({
        severity: 'error',
        text: `Не удалось отправить ${label} для ${normalizedAgentId}`,
      });
    } finally {
      setBusyTaskAgent('');
    }
  };

  const enqueueForceScanTask = (agentId) => {
    const normalizedAgentId = String(agentId || '').trim();
    if (!normalizedAgentId) return;
    if (!window.confirm(`Запустить скан с 0 для ${normalizedAgentId}?`)) {
      return;
    }
    enqueueTask(normalizedAgentId, 'scan_now', {
      payload: { force_rescan: true },
      dedupeKey: `scan_now_force:${normalizedAgentId}`,
    });
  };

  const openScanLaunchDialog = (agentId, forceRescan = false) => {
    const normalizedAgentId = String(agentId || '').trim();
    if (!normalizedAgentId) return;
    const defaultSelected = selectedPatternIdsFromRows(scanPatterns);
    setSelectedScanPatternIds((prev) => {
      const allowed = new Set(scanPatterns.map((item) => item.id));
      const next = (Array.isArray(prev) ? prev : []).filter((item) => allowed.has(item));
      return next.length > 0 ? next : defaultSelected;
    });
    setScanPatternQuery('');
    setScanLaunchDialog({ open: true, agentId: normalizedAgentId, forceRescan: Boolean(forceRescan) });
  };

  const closeScanLaunchDialog = () => {
    setScanLaunchDialog((prev) => ({ ...prev, open: false }));
  };

  const toggleScanPattern = (patternId) => {
    const normalized = String(patternId || '').trim();
    if (!normalized) return;
    setSelectedScanPatternIds((prev) => {
      const set = new Set(Array.isArray(prev) ? prev : []);
      if (set.has(normalized)) set.delete(normalized);
      else set.add(normalized);
      return Array.from(set);
    });
  };

  const selectAllScanPatterns = () => {
    setSelectedScanPatternIds(scanPatterns.map((item) => item.id));
  };

  const clearScanPatterns = () => {
    setSelectedScanPatternIds([]);
  };

  const selectLoanScanPatterns = () => {
    const loanIds = scanPatterns
      .filter((item) => item.id === 'loan_keyword' || item.name.toLowerCase().includes('займ'))
      .map((item) => item.id);
    if (loanIds.length > 0) setSelectedScanPatternIds(loanIds);
  };

  const submitScanLaunch = () => {
    const agentId = String(scanLaunchDialog.agentId || '').trim();
    if (!agentId || selectedScanPatternIds.length === 0) return;
    const payload = {
      ...(scanLaunchDialog.forceRescan ? { force_rescan: true } : {}),
      server_pdf_pattern_ids: selectedScanPatternIds,
    };
    closeScanLaunchDialog();
    enqueueTask(agentId, 'scan_now', {
      payload,
      dedupeKey: scanLaunchDialog.forceRescan ? `scan_now_force:${agentId}` : `scan_now:${agentId}`,
    });
  };

  const resolveIncidentIp = (incident) => {
    const meta = hostMetaByName[normalizeHost(incident?.hostname || selectedHost)] || {};
    return String(incident?.ip_address || meta.ip || '').trim() || '-';
  };

  const renderScanRunObservations = (runId) => {
    const bucket = scanRunObservations[runId];
    const items = Array.isArray(bucket?.items) ? bucket.items : [];
    const total = Number(bucket?.total || 0);
    const visibleItems = items.slice(0, SCAN_RUN_OBSERVATION_LIMIT);
    if (scanRunObservationsLoading === runId && items.length === 0) {
      return <Box sx={{ py: 2, display: 'flex', justifyContent: 'center' }}><CircularProgress size={22} /></Box>;
    }
    if (items.length === 0) {
      return <Typography variant="body2" color="text.secondary">Значимые изменения в этом запуске не найдены.</Typography>;
    }
    return (
      <Stack spacing={0.8}>
        {visibleItems.map((item) => (
          <Paper key={item.id} variant="outlined" sx={{ p: 1, borderRadius: 1.2 }}>
            <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 700, wordBreak: 'break-all' }}>
                  {item.file_path || '-'}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  {item.source_kind || '-'} · {item.file_hash ? `hash ${String(item.file_hash).slice(0, 10)}` : 'hash -'}
                </Typography>
              </Box>
              <Stack direction="row" spacing={0.8} alignItems="center" sx={{ flexShrink: 0 }}>
                <Chip size="small" label={observationLabel(item.observation_type)} />
                {!!item.incident_status && (
                  <Chip size="small" color={fileStatusColor(item.incident_status)} label={fileStatusLabel(item.incident_status)} />
                )}
              </Stack>
            </Stack>
          </Paper>
        ))}
        {total > visibleItems.length && (
          <Typography variant="caption" color="text.secondary" sx={{ px: 0.3 }}>
            Показано {visibleItems.length} из {total}. Полный список доступен в Excel-отчете.
          </Typography>
        )}
      </Stack>
    );
  };

  const renderHostScanRuns = () => {
    if (hostScanRunsLoading && hostScanRuns.length === 0) {
      return <Box sx={{ py: 2, display: 'flex', justifyContent: 'center' }}><CircularProgress size={24} /></Box>;
    }
    if (hostScanRuns.length === 0) {
      return <Typography color="text.secondary">Запусков скана по этому компьютеру пока нет.</Typography>;
    }
    return (
      <Stack spacing={1}>
        {hostScanRuns.map((run) => {
          const runId = String(run.id || '');
          const counts = run.observation_counts || {};
          const isForce = isForceScanTask(run);
          const checked = Number(run.result?.scanned || 0);
          const skipped = Number(run.result?.skipped || 0);
          const expanded = expandedScanRunId === runId;
          const runError = scanRunErrorText(run);
          const toggleRun = () => setExpandedScanRunId((prev) => (prev === runId ? '' : runId));
          return (
            <Paper
              key={runId}
              variant="outlined"
              sx={{
                borderRadius: 1,
                overflow: 'hidden',
                borderColor: expanded ? 'primary.light' : 'divider',
              }}
            >
              <Box
                sx={{
                  p: 1.2,
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) auto' },
                  gap: 1,
                  alignItems: 'start',
                }}
              >
                <Box
                  role="button"
                  tabIndex={0}
                  onClick={toggleRun}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      toggleRun();
                    }
                  }}
                  sx={{ minWidth: 0, cursor: 'pointer' }}
                >
                  <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                      {isForce ? 'Скан с 0' : 'Скан'} · {formatTaskTimestamp(run)}
                    </Typography>
                    <Chip size="small" color={taskStatusColor(run.status)} label={taskStatusLabel(run.status)} />
                  </Stack>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.3 }}>
                    проверено {checked} · пропущено {skipped} · наблюдений {Number(counts.total || 0)}
                  </Typography>
                  {!!patternPayloadSummary(run.payload, scanPatterns) && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.2 }}>
                      {patternPayloadSummary(run.payload, scanPatterns)}
                    </Typography>
                  )}
                  <Stack direction="row" spacing={0.8} sx={{ mt: 0.8, flexWrap: 'wrap', rowGap: 0.6 }}>
                    <Chip size="small" label={`новые ${Number(counts.found_new || 0)}`} />
                    <Chip size="small" label={`повторно ${Number(counts.found_duplicate || 0)}`} />
                    <Chip size="small" color="success" label={`удалены ${Number(counts.deleted || 0)}`} />
                    <Chip size="small" color="success" label={`очищены ${Number(counts.cleaned || 0)}`} />
                    <Chip size="small" color="success" label={`перемещены ${Number(counts.moved || 0)}`} />
                  </Stack>
                  {!!runError && (
                    <Alert severity="error" sx={{ mt: 0.9, py: 0.2, alignItems: 'center' }}>
                      <Typography variant="caption" sx={{ fontWeight: 700, wordBreak: 'break-word' }}>
                        {runError}
                      </Typography>
                    </Alert>
                  )}
                </Box>
                <Stack direction="row" spacing={0.8} sx={{ justifyContent: { xs: 'stretch', sm: 'flex-end' } }}>
                  <Button
                    type="button"
                    aria-label="Экспорт Excel"
                    size="small"
                    variant="contained"
                    startIcon={exportingScanRunId === runId ? <CircularProgress size={15} color="inherit" /> : <DownloadIcon />}
                    disabled={!canScanRead || exportingScanRunId === runId}
                    onClick={(event) => handleExportScanRunIncidents(event, run)}
                    sx={{
                      flex: { xs: 1, sm: '0 0 auto' },
                      minHeight: 32,
                      borderRadius: 1,
                      px: 1.4,
                      fontWeight: 800,
                      textTransform: 'none',
                      bgcolor: '#1f5f4a',
                      color: '#fff',
                      boxShadow: 'none',
                      transition: 'transform 160ms ease, background-color 160ms ease',
                      '&:hover': { bgcolor: '#184b3a', boxShadow: 'none', transform: 'translateY(-1px)' },
                      '&:active': { transform: 'translateY(0)' },
                      '&.Mui-disabled': { bgcolor: 'action.disabledBackground' },
                    }}
                  >
                    {exportingScanRunId === runId ? 'Готовлю...' : 'Экспорт Excel'}
                  </Button>
                  <Button
                    type="button"
                    aria-label={expanded ? 'Свернуть запуск скана' : 'Развернуть запуск скана'}
                    size="small"
                    variant="outlined"
                    onClick={toggleRun}
                    sx={{ minWidth: 34, px: 0.6, borderRadius: 1 }}
                  >
                    <ExpandMoreIcon sx={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 160ms ease' }} />
                  </Button>
                </Stack>
              </Box>
              <Collapse in={expanded} timeout="auto" unmountOnExit>
                <Box sx={{ px: 1.2, pb: 1.2 }}>
                  {renderScanRunObservations(runId)}
                </Box>
              </Collapse>
            </Paper>
          );
        })}
      </Stack>
    );
  };

  const toggleIncidentRow = (rowId, defaultExpanded = false) => {
    setExpandedIncidentRows((prev) => {
      const current = Object.prototype.hasOwnProperty.call(prev, rowId) ? Boolean(prev[rowId]) : Boolean(defaultExpanded);
      return { ...prev, [rowId]: !current };
    });
  };

  const renderInboxFragments = (incident) => {
    const matches = Array.isArray(incident?.matched_patterns) ? incident.matched_patterns : [];
    if (matches.length === 0) return <Typography variant="body2" color="text.secondary">Фрагменты не найдены</Typography>;
    return (
      <Stack spacing={1}>
        {matches.slice(0, 8).map((item, idx) => (
          <Paper key={`${incident.id || 'inc'}-${idx}`} variant="outlined" sx={{ p: 1, borderRadius: 1.2 }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {item.pattern_name || item.pattern || 'pattern'}
            </Typography>
            {!!String(item.value || '').trim() && (
              <Typography variant="body2">Значение: {String(item.value)}</Typography>
            )}
            {!!String(item.snippet || '').trim() && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.4 }}>
                {String(item.snippet)}
              </Typography>
            )}
          </Paper>
        ))}
      </Stack>
    );
  };

  const renderIncidentVirtualRow = ({ index, style }) => {
    const row = incidentRows[index];
    if (!row) return null;
    if (row.type === 'host') {
      const host = row.host;
      const expanded = expandedIncidentRows[host.id] === true;
      return (
        <Box style={style} sx={{ px: 1, py: 0.5 }}>
          <Paper
            variant="outlined"
            onClick={() => toggleIncidentRow(host.id, false)}
            sx={{
              p: 1,
              borderRadius: 1.5,
              cursor: 'pointer',
              bgcolor: ui.panelBg,
              borderColor: ui.borderSoft,
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{expanded ? '▾' : '▸'} {host.hostname}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  {host.branch || 'Без филиала'} · {host.user || '-'} · {host.ip_address || '-'}
                </Typography>
              </Box>
              <Stack direction="row" spacing={0.8}>
                <Chip size="small" color={Number(host.incidents_new || 0) > 0 ? 'warning' : 'default'} label={`NEW ${Number(host.incidents_new || 0)}`} />
                <Chip size="small" label={`Всего ${Number(host.incidents_total || 0)}`} />
                <Chip size="small" color={severityColor(host.top_severity)} label={host.top_severity} />
              </Stack>
            </Stack>
          </Paper>
        </Box>
      );
    }
    if (row.type === 'file') {
      const file = row.file;
      const selected = file.incidents.some((incident) => String(incident?.id || '') === String(selectedInboxIncident?.id || ''));
      return (
        <Box style={style} sx={{ pl: 3, pr: 1, py: 0.45 }}>
          <Paper
            variant="outlined"
            onClick={() => {
              setSelectedInboxIncidentId(String(file.incidents[0]?.id || ''));
              toggleIncidentRow(file.id, false);
            }}
            sx={{
              p: 1,
              borderRadius: 1.2,
              cursor: 'pointer',
              borderColor: selected ? 'primary.main' : ui.borderSoft,
              bgcolor: selected ? ui.selectedBg : ui.panelSolid,
            }}
          >
            <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 750, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {expandedIncidentRows[file.id] ? '▾' : '▸'} {file.file_path}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {file.file_ext || '-'} · {file.source_kind || '-'} · {formatTs(file.last_incident_at)}
                </Typography>
              </Box>
              <Stack direction="row" spacing={0.7} sx={{ flexShrink: 0 }}>
                <Chip size="small" color={Number(file.incidents_new || 0) > 0 ? 'warning' : 'default'} label={Number(file.incidents_new || 0)} />
                <Chip size="small" color={severityColor(file.top_severity)} label={file.top_severity} />
              </Stack>
            </Stack>
          </Paper>
        </Box>
      );
    }
    const incident = row.incident;
    const selected = String(incident?.id || '') === String(selectedInboxIncident?.id || '');
    return (
      <Box style={style} sx={{ pl: 5, pr: 1, py: 0.35 }}>
        <Paper
          variant="outlined"
          onClick={() => setSelectedInboxIncidentId(String(incident?.id || ''))}
          sx={{
            p: 0.8,
            borderRadius: 1,
            cursor: 'pointer',
            borderColor: selected ? 'primary.main' : ui.borderSoft,
            bgcolor: selected ? ui.selectedBg : 'transparent',
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
            <Typography variant="caption" sx={{ fontWeight: 700 }}>
              {incident?.severity || '-'} · {formatTs(incident?.created_at)}
            </Typography>
            <Chip size="small" color={fileStatusColor(incident?.status)} label={fileStatusLabel(incident?.status)} />
          </Stack>
        </Paper>
      </Box>
    );
  };

  const renderSummaryCard = (title, value, helper, color = 'text.primary') => (
    <Card variant="outlined" sx={{ ...getOfficeMetricBlockSx(ui, color === 'text.primary' ? theme.palette.primary.main : theme.palette[color?.split?.('.')?.[0]]?.main || theme.palette.primary.main, { height: '100%' }) }}>
      <CardContent>
        <Typography variant="body2" color="text.secondary">{title}</Typography>
        <Typography variant="h4" sx={{ fontWeight: 700, color }}>{value}</Typography>
        <Typography variant="caption" color="text.secondary">{helper}</Typography>
      </CardContent>
    </Card>
  );

  return (
    <MainLayout>
      <PageShell sx={{ width: '100%', pb: 2, minHeight: 'calc(100dvh - var(--app-shell-header-offset) - 32px)' }}>
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
          <Grid item xs={12} sm={6} md={3}>
            {renderSummaryCard(
              'PDF очередь',
              Number(totals.server_pdf_pending || 0),
              `ждёт: ${Number(totals.server_pdf_queued || 0)} · в работе: ${Number(totals.server_pdf_processing || 0)}`,
              'secondary.main',
            )}
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            {renderSummaryCard(
              'Обработано PDF',
              Number(totals.server_pdf_processed || 0),
              `чисто: ${Number(totals.server_pdf_done_clean || 0)} · инциденты: ${Number(totals.server_pdf_done_with_incident || 0)} · ошибки: ${Number(totals.server_pdf_failed || 0)}`,
              'success.main',
            )}
          </Grid>
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

        <Paper variant="outlined" sx={{ ...getOfficePanelSx(ui, { p: 0, mb: 2, overflow: 'hidden' }) }}>
          <Tabs
            value={activeSection}
            onChange={(_, nextValue) => setActiveSection(nextValue)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ px: 1, borderBottom: '1px solid', borderColor: ui.borderSoft }}
          >
            <Tab value="incidents" label={`Инциденты (${Number(incidentInbox.total || 0)})`} />
            <Tab value="agents" label={`Агенты (${agentTotal})`} />
            <Tab value="hosts" label={`Хосты (${hostTotal})`} />
          </Tabs>

          {activeSection === 'incidents' && (
            <Box sx={{ p: 2 }}>
              <Stack spacing={1.5}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1.5, flexWrap: 'wrap' }}>
                  <Box>
                    <Typography variant="h6" sx={{ fontWeight: 800 }}>Инциденты</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Загружено {Number(incidentInbox.loaded || 0)} из {Number(incidentInbox.total || 0)} · пачка {INCIDENT_BATCH_SIZE}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    <Button
                      type="button"
                      size="small"
                      variant="outlined"
                      startIcon={incidentInbox.loadingInitial ? <CircularProgress size={16} /> : <RefreshIcon />}
                      onClick={() => incidentInbox.reload({ silent: false })}
                      disabled={incidentInbox.loadingInitial || incidentInbox.loadingMore}
                      sx={getOfficeQuietActionSx(ui, theme, 'neutral')}
                    >
                      Обновить список
                    </Button>
                    <Button type="button" size="small" variant="outlined" onClick={resetIncidentFilters} sx={getOfficeQuietActionSx(ui, theme, 'neutral')}>
                      Сбросить фильтры
                    </Button>
                    <Button type="button" size="small" variant="outlined" onClick={expandAllIncidentRows} sx={getOfficeQuietActionSx(ui, theme, 'primary')}>
                      Показать все
                    </Button>
                    <Button type="button" size="small" variant="outlined" onClick={collapseAllIncidentRows} sx={getOfficeQuietActionSx(ui, theme, 'neutral')}>
                      Скрыть
                    </Button>
                    <Button
                      type="button"
                      size="small"
                      variant="contained"
                      onClick={handleAckInboxFiltered}
                      disabled={!canScanAck || busyAckInbox || incidentInbox.loadingInitial || incidentInbox.items.every((item) => String(item?.status || '').toLowerCase() !== 'new')}
                    >
                      Просмотрено по фильтру
                    </Button>
                  </Stack>
                </Box>

                {(incidentInbox.loadingInitial || incidentInbox.loadingMore) && (
                  <Box>
                    <LinearProgress
                      variant={incidentInbox.total > 0 ? 'determinate' : 'indeterminate'}
                      value={incidentInbox.total > 0 ? Math.min(100, (incidentInbox.loaded / incidentInbox.total) * 100) : 0}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {incidentInbox.loadingInitial ? 'Загрузка первой пачки' : 'Догружаются остальные инциденты'}
                    </Typography>
                  </Box>
                )}

                {incidentInbox.error && (
                  <Alert severity="error">Не удалось загрузить инциденты. Проверьте scan server и повторите обновление.</Alert>
                )}

                <Grid container spacing={1.2}>
                  <Grid item xs={12} md={4}>
                    <TextField
                      size="small"
                      fullWidth
                      label="Поиск по инцидентам"
                      value={incidentQ}
                      onChange={(event) => setIncidentQ(event.target.value)}
                      placeholder="Путь, фрагмент, паттерн, пользователь"
                    />
                  </Grid>
                  <Grid item xs={6} md={2}>
                    <FormControl size="small" fullWidth>
                      <InputLabel>Статус</InputLabel>
                      <Select value={incidentStatus} label="Статус" onChange={(event) => setIncidentStatus(event.target.value)}>
                        <MenuItem value="all">Все</MenuItem>
                        <MenuItem value="new">NEW</MenuItem>
                        <MenuItem value="ack">ACK</MenuItem>
                        <MenuItem value="resolved_deleted">Удалён</MenuItem>
                        <MenuItem value="resolved_clean">Очищен</MenuItem>
                        <MenuItem value="resolved_moved">Перемещён</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={6} md={2}>
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
                  <Grid item xs={6} md={2}>
                    <FormControl size="small" fullWidth>
                      <InputLabel>Источник</InputLabel>
                      <Select value={incidentSourceKind} label="Источник" onChange={(event) => setIncidentSourceKind(event.target.value)}>
                        <MenuItem value="all">Все</MenuItem>
                        {incidentSourceOptions.map((option) => <MenuItem key={option} value={option}>{option}</MenuItem>)}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={6} md={2}>
                    <TextField size="small" fullWidth label="Расширение" value={incidentFileExt} onChange={(event) => setIncidentFileExt(event.target.value)} placeholder="pdf/txt" />
                  </Grid>
                  <Grid item xs={6} md={2}>
                    <TextField size="small" fullWidth type="date" label="Дата с" value={incidentDateFrom} onChange={(event) => setIncidentDateFrom(event.target.value)} InputLabelProps={{ shrink: true }} />
                  </Grid>
                  <Grid item xs={6} md={2}>
                    <TextField size="small" fullWidth type="date" label="Дата по" value={incidentDateTo} onChange={(event) => setIncidentDateTo(event.target.value)} InputLabelProps={{ shrink: true }} />
                  </Grid>
                  <Grid item xs={12} md={3}>
                    <Button
                      type="button"
                      fullWidth
                      size="small"
                      variant={incidentHasFragment ? 'contained' : 'outlined'}
                      onClick={() => setIncidentHasFragment((prev) => !prev)}
                      sx={{ minHeight: 40 }}
                    >
                      Только с фрагментами
                    </Button>
                  </Grid>
                </Grid>

                <Grid container spacing={1.5}>
                  <Grid item xs={12} lg={7}>
                    <Paper
                      variant="outlined"
                      sx={{
                        height: incidentWorkAreaHeight,
                        minHeight: { xs: 520, lg: 640 },
                        overflow: 'hidden',
                        borderColor: ui.borderSoft,
                      }}
                    >
                      {incidentRows.length === 0 && !incidentInbox.loadingInitial ? (
                        <Box sx={{ p: 3 }}>
                          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Инциденты не найдены</Typography>
                          <Typography variant="body2" color="text.secondary">Измените фильтры или запустите новый скан агента.</Typography>
                        </Box>
                      ) : (
                        <VirtualList
                          height={typeof window !== 'undefined'
                            ? Math.max(640, window.innerHeight - 360)
                            : 640}
                          width="100%"
                          itemCount={incidentRows.length}
                          itemSize={74}
                        >
                          {renderIncidentVirtualRow}
                        </VirtualList>
                      )}
                    </Paper>
                  </Grid>
                  <Grid item xs={12} lg={5}>
                    <Paper
                      variant="outlined"
                      sx={{
                        ...getOfficePanelSx(ui, {
                          p: 2,
                          height: incidentWorkAreaHeight,
                          minHeight: { xs: 520, lg: 640 },
                          overflow: 'auto',
                          boxShadow: 'none',
                        }),
                      }}
                    >
                      {selectedInboxIncident ? (
                        <Stack spacing={1.2}>
                          <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="flex-start">
                            <Box sx={{ minWidth: 0 }}>
                              <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{selectedInboxIncident.hostname || 'HOST'}</Typography>
                              <Typography variant="body2" color="text.secondary">
                                {String(selectedInboxIncident.branch || '').trim() || 'Без филиала'} · {String(selectedInboxIncident.user_full_name || selectedInboxIncident.user_login || '').trim() || '-'}
                              </Typography>
                            </Box>
                            <Stack direction="row" spacing={0.8}>
                              <Chip size="small" color={severityColor(selectedInboxIncident.severity)} label={selectedInboxIncident.severity || '-'} />
                              <Chip size="small" color={fileStatusColor(selectedInboxIncident.status)} label={fileStatusLabel(selectedInboxIncident.status)} />
                            </Stack>
                          </Stack>
                          <Box>
                            <Typography variant="caption" color="text.secondary">Файл</Typography>
                            <Typography variant="body2" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{selectedInboxIncident.file_path || '-'}</Typography>
                          </Box>
                          <Typography variant="caption" color="text.secondary">
                            Тип: {getInboxIncidentFileExt(selectedInboxIncident) || '-'} · Источник: {getInboxIncidentSourceKind(selectedInboxIncident) || '-'} · {formatTs(selectedInboxIncident.created_at)}
                          </Typography>
                          {String(selectedInboxIncident.status || '').toLowerCase() === 'new' && (
                            <Button
                              type="button"
                              size="small"
                              variant="outlined"
                              disabled={!canScanAck || busyIncident === selectedInboxIncident.id}
                              onClick={() => handleAckIncident(selectedInboxIncident)}
                              sx={getOfficeQuietActionSx(ui, theme, 'warning', { alignSelf: 'flex-start' })}
                            >
                              ACK
                            </Button>
                          )}
                          <Box>
                            <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.8 }}>Совпадения</Typography>
                            {renderInboxFragments(selectedInboxIncident)}
                          </Box>
                        </Stack>
                      ) : (
                        <Typography color="text.secondary">Выберите инцидент слева.</Typography>
                      )}
                    </Paper>
                  </Grid>
                </Grid>
              </Stack>
            </Box>
          )}
        </Paper>

        <Paper variant="outlined" sx={{ p: 2, mb: 2, display: activeSection === 'agents' ? 'block' : 'none' }}>
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
                              label={String(agent.active_task.command || '').toLowerCase() === 'scan_now' ? commandLabel(agent.active_task.command, agent.active_task) : 'Проверка связи'}
                            />
                            <Chip size="small" color={taskStatusColor(agent.active_task.status)} label={renderTaskStatusLabel(agent.active_task)} />
                          </Stack>
                        ) : '-'}
                      </TableCell>
                      <TableCell>{Number(agent.queue_size || 0)}</TableCell>
                      <TableCell>
                        {agent.last_task ? (
                          <>
                            <Typography variant="body2">{renderTaskSummary(agent.last_task)}</Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              {`${commandLabel(agent.last_task.command, agent.last_task)} · ${taskStatusLabel(agent.last_task.status)}`}
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
                            disabled={!canScanTasks || busyTaskAgent === agent.agent_id || isActiveTask(agent.active_task)}
                            onClick={() => openScanLaunchDialog(agent.agent_id, false)}
                          >
                            Сканировать
                          </Button>
                          <Button
                            type="button"
                            size="small"
                            variant="outlined"
                            disabled={!canScanTasks || busyTaskAgent === agent.agent_id || isActiveTask(agent.active_task)}
                            onClick={() => openScanLaunchDialog(agent.agent_id, true)}
                          >
                            Скан с 0
                          </Button>
                          <Button
                            type="button"
                            size="small"
                            variant="outlined"
                            disabled={!canScanTasks || busyTaskAgent === agent.agent_id || isActiveTask(agent.active_task)}
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

        <Paper variant="outlined" sx={{ p: 2, display: activeSection === 'hosts' ? 'block' : 'none' }}>
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
                    <MenuItem value="resolved_deleted">Удалён</MenuItem>
                    <MenuItem value="resolved_clean">Очищен</MenuItem>
                    <MenuItem value="resolved_moved">Перемещён</MenuItem>
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
            <Paper variant="outlined" sx={{ p: 1.2, mb: 1.2, borderRadius: 1.5 }}>
              <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>Запуски скана</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Показано {hostScanRuns.length} из {hostScanRunsTotal}
                  </Typography>
                </Box>
                <Button type="button" size="small" variant="outlined" onClick={() => loadHostScanRuns({ silent: false })} disabled={hostScanRunsLoading}>
                  Обновить
                </Button>
              </Stack>
              {renderHostScanRuns()}
            </Paper>
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
                        <Chip size="small" color={fileStatusColor(incident.status)} label={fileStatusLabel(incident.status)} />
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

        <Dialog
          open={scanLaunchDialog.open}
          onClose={closeScanLaunchDialog}
          fullWidth
          maxWidth="md"
        >
          <DialogTitle sx={{ pb: 1 }}>
            {scanLaunchDialog.forceRescan ? 'Скан с 0' : 'Сканировать'}
          </DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              <Box>
                <Typography variant="body2" color="text.secondary">Агент</Typography>
                <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                  {scanLaunchDialog.agentId || '-'}
                </Typography>
              </Box>

              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
                <Stack spacing={1.3}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                        Паттерны PDF на сервере
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Выбрано {selectedScanPatternIds.length} из {scanPatterns.length}. Настройка действует только для этого запуска.
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={0.8} useFlexGap flexWrap="wrap">
                      <Button type="button" size="small" variant="outlined" onClick={selectAllScanPatterns}>
                        Выбрать все
                      </Button>
                      <Button type="button" size="small" variant="outlined" onClick={clearScanPatterns}>
                        Снять все
                      </Button>
                      {scanPatterns.some((item) => item.id === 'loan_keyword') && (
                        <Button type="button" size="small" variant="outlined" onClick={selectLoanScanPatterns}>
                          Только займы
                        </Button>
                      )}
                    </Stack>
                  </Box>

                  <TextField
                    size="small"
                    fullWidth
                    label="Поиск паттерна"
                    value={scanPatternQuery}
                    onChange={(event) => setScanPatternQuery(event.target.value)}
                    placeholder="Название, id или категория"
                  />

                  {scanPatternsLoading ? (
                    <Box sx={{ py: 3, display: 'flex', justifyContent: 'center' }}>
                      <CircularProgress size={24} />
                    </Box>
                  ) : scanPatterns.length === 0 ? (
                    <Alert severity="warning">
                      Сервер не вернул список паттернов. Запуск скана с выбором паттернов пока недоступен.
                    </Alert>
                  ) : selectedScanPatternIds.length === 0 ? (
                    <Alert severity="warning">
                      Выберите хотя бы один PDF-паттерн. Пустой список на сервере считается старым режимом “искать всё”.
                    </Alert>
                  ) : null}

                  <Box sx={{ maxHeight: 360, overflow: 'auto', pr: 0.5 }}>
                    <Stack spacing={1.2}>
                      {groupedScanPatterns.map((group) => (
                        <Box key={group.category}>
                          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800, textTransform: 'uppercase' }}>
                            {group.category}
                          </Typography>
                          <Stack spacing={0.4} sx={{ mt: 0.5 }}>
                            {group.items.map((pattern) => (
                              <Paper key={pattern.id} variant="outlined" sx={{ px: 1, py: 0.6, borderRadius: 1 }}>
                                <FormControlLabel
                                  sx={{ m: 0, width: '100%', alignItems: 'flex-start' }}
                                  control={(
                                    <Checkbox
                                      size="small"
                                      checked={selectedScanPatternSet.has(pattern.id)}
                                      onChange={() => toggleScanPattern(pattern.id)}
                                    />
                                  )}
                                  label={(
                                    <Box sx={{ minWidth: 0 }}>
                                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                        {pattern.name || pattern.id}
                                      </Typography>
                                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', wordBreak: 'break-all' }}>
                                        {pattern.id} · weight {pattern.weight || 0}
                                      </Typography>
                                    </Box>
                                  )}
                                />
                              </Paper>
                            ))}
                          </Stack>
                          <Divider sx={{ mt: 1.2 }} />
                        </Box>
                      ))}
                    </Stack>
                  </Box>
                </Stack>
              </Paper>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button type="button" onClick={closeScanLaunchDialog}>Отмена</Button>
            <Button
              type="button"
              variant="contained"
              onClick={submitScanLaunch}
              disabled={!canScanTasks || scanPatternsLoading || scanPatterns.length === 0 || selectedScanPatternIds.length === 0}
            >
              Запустить
            </Button>
          </DialogActions>
        </Dialog>
      </PageShell>
    </MainLayout>
  );
}

export default ScanCenter;
