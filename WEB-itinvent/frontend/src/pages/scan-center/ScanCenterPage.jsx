import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import MainLayout from '../../components/layout/MainLayout';
import MobileShellPageHeader from '../../components/layout/MobileShellPageHeader';
import PageShell from '../../components/layout/PageShell';
import { scanAPI } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useScanIncidentInbox, INCIDENT_BATCH_SIZE } from '../../hooks/useScanIncidentInbox';
import { buildOfficeUiTokens, getOfficePanelSx, getOfficeQuietActionSx } from '../../theme/officeUiTokens';
import {
  flattenIncidentGroups,
  getIncidentFileExt as getInboxIncidentFileExt,
  getIncidentSourceKind as getInboxIncidentSourceKind,
  groupIncidentsByHostFile,
} from '../../lib/scanIncidentInbox';
import HostDrawer from './HostDrawer';
import AgentsSection from './AgentsSection';
import HostsSection from './HostsSection';
import IncidentsInboxSection from './IncidentsInboxSection';
import ReviewItemsSection from './ReviewItemsSection';
import ScanCenterOverview from './ScanCenterOverview';
import ScanCenterHeader from './ScanCenterHeader';
import ScanCenterNavigation from './ScanCenterNavigation';

const AUTO_REFRESH_MS = 30_000;
const TASK_POLL_MS = 3_000;
const DEFAULT_ROWS_PER_PAGE = 25;
const ROWS_PER_PAGE_OPTIONS = [25, 50, 100];
const SCAN_RUN_OBSERVATION_LIMIT = 200;
const HOST_SCAN_RUNS_PAGE_SIZE = 30;
const HOST_INCIDENTS_PAGE_SIZE = 200;
const ACTIVE_TASK_STATUSES = new Set(['queued', 'delivered', 'acknowledged']);
const SCAN_FILE_GROUPS = [
  { id: 'pdf', label: 'PDF', helper: 'OCR первых 3 страниц и текстовый слой до 10 страниц', extensions: ['.pdf'], enabledByDefault: true },
  { id: 'images', label: 'Изображения', helper: 'JPG, PNG, TIFF, BMP и WEBP', extensions: ['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.bmp', '.webp'], enabledByDefault: true },
  { id: 'text', label: 'Текстовые файлы', helper: 'TXT, CSV, RTF, логи и конфигурационные файлы', extensions: ['.txt', '.csv', '.rtf', '.log', '.md', '.ini', '.cfg', '.conf', '.xml', '.json'], enabledByDefault: true },
  { id: 'office', label: 'Office и ODF', helper: 'Медленная конвертация LibreOffice; по умолчанию выключена', extensions: ['.doc', '.docx', '.odt', '.xls', '.xlsx', '.ods', '.ppt', '.pptx', '.odp'], enabledByDefault: false },
];
const DEFAULT_SCAN_EXTENSIONS = SCAN_FILE_GROUPS
  .filter((group) => group.enabledByDefault)
  .flatMap((group) => group.extensions);

function normalizePatternRows(value) {
  const items = Array.isArray(value?.items) ? value.items : Array.isArray(value) ? value : [];
  return items
    .map((item) => ({
      id: String(item?.id || '').trim(),
      name: String(item?.name || item?.id || '').trim(),
      category: String(item?.category || 'Общие').trim() || 'Общие',
      weight: Number(item?.weight || 0),
      enabled_by_default: item?.enabled_by_default !== false,
      incident_filter_id: String(item?.incident_filter_id || item?.id || '').trim(),
      incident_filter_name: String(item?.incident_filter_name || item?.name || item?.id || '').trim(),
    }))
    .filter((item) => item.id);
}

function buildIncidentPatternOptions(rows) {
  const options = new Map();
  normalizePatternRows(rows).forEach((item) => {
    const fallbackIsDsp = item.id.startsWith('dsp_');
    const id = fallbackIsDsp ? 'dsp' : (item.incident_filter_id || item.id);
    if (!id || options.has(id)) return;
    options.set(id, {
      id,
      name: fallbackIsDsp ? 'ДСП' : (item.incident_filter_name || item.name || id),
    });
  });
  return Array.from(options.values());
}

function selectedPatternIdsFromRows(rows) {
  return normalizePatternRows(rows)
    .filter((item) => item.enabled_by_default)
    .map((item) => item.id);
}

function buildScanPatternOptions(rows) {
  const options = new Map();
  normalizePatternRows(rows).forEach((item) => {
    const fallbackIsDsp = item.id.startsWith('dsp_');
    const optionId = fallbackIsDsp ? 'dsp' : (item.incident_filter_id || item.id);
    const existing = options.get(optionId);
    if (existing) {
      existing.member_ids.push(item.id);
      existing.search_text += ` ${item.id} ${item.name}`;
      return;
    }
    options.set(optionId, {
      id: optionId,
      name: fallbackIsDsp ? 'ДСП' : (item.incident_filter_name || item.name || optionId),
      category: item.category,
      weight: item.weight,
      member_ids: [item.id],
      search_text: `${optionId} ${item.id} ${item.name} ${item.incident_filter_name} ${item.category}`,
    });
  });
  return Array.from(options.values());
}

function groupPatternsByCategory(options, query) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  const groups = new Map();
  (Array.isArray(options) ? options : []).forEach((item) => {
    const haystack = String(item.search_text || `${item.id} ${item.name} ${item.category}`).toLowerCase();
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
    if (phase === 'agent_outbox') return 'Локальная очередь отправки';
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
  const jobsIncomplete = Number(result.jobs_incomplete || 0);

  if (status === 'acknowledged' && phase === 'local_scan') {
    return `${scanLabel}: проверено ${scanned} · отправлено: ${queued} · пропущено: ${skipped}${extraText}`;
  }
  if (status === 'acknowledged' && phase === 'server_processing') {
    return `OCR: осталось ${jobsPending} · без инцидентов ${jobsDoneClean} · с инцидентами ${jobsDoneWithIncident} · не проверено ${jobsIncomplete} · ошибок ${jobsFailed}${extraText}`;
  }
  if (status === 'acknowledged' && phase === 'agent_outbox') {
    return `${scanLabel}: в локальной очереди ${Number(result.outbox_pending || deferred || 0)}${extraText}`;
  }
  if (status === 'failed') {
    if (deferred > 0) {
      return `${scanLabel}: проверено ${scanned} · отправлено: ${queued} · в локальной очереди: ${deferred}${extraText}`;
    }
    if (jobsFailed > 0 || jobsIncomplete > 0) {
      return `OCR: ошибок ${jobsFailed} · не проверено ${jobsIncomplete} · без инцидентов ${jobsDoneClean} · с инцидентами ${jobsDoneWithIncident}${extraText}`;
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

function ScanCenterPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'), { defaultMatches: true });
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const incidentWorkAreaHeight = 'calc(100dvh - var(--app-shell-top-offset, var(--app-shell-header-offset)) - 360px)';
  const { hasPermission } = useAuth();
  const canScanRead = hasPermission('scan.read');
  const canScanAck = hasPermission('scan.ack');
  const canScanTasks = hasPermission('scan.tasks');

  const [activeSection, setActiveSection] = useState('overview');
  const [dashboard, setDashboard] = useState({ totals: {}, daily: [], by_severity: [], by_branch: [], new_hosts: [] });
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [reviewItems, setReviewItems] = useState({ items: [], total: 0 });
  const [reviewLoading, setReviewLoading] = useState(true);
  const [reviewPage, setReviewPage] = useState(0);
  const [reviewRowsPerPage, setReviewRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);

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
  const [selectedScanExtensions, setSelectedScanExtensions] = useState(DEFAULT_SCAN_EXTENSIONS);

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
  const [hostDrawerTab, setHostDrawerTab] = useState('runs');
  const [selectedHost, setSelectedHost] = useState('');
  const [hostIncidents, setHostIncidents] = useState([]);
  const [hostIncidentsTotal, setHostIncidentsTotal] = useState(0);
  const [hostNewCount, setHostNewCount] = useState(0);
  const [hostLoading, setHostLoading] = useState(false);
  const [hostLoadingMore, setHostLoadingMore] = useState(false);
  const [hostScanRuns, setHostScanRuns] = useState([]);
  const [hostScanRunsTotal, setHostScanRunsTotal] = useState(0);
  const [hostScanRunsLoading, setHostScanRunsLoading] = useState(false);
  const [hostScanRunsLoadingMore, setHostScanRunsLoadingMore] = useState(false);
  const [selectedScanRunId, setSelectedScanRunId] = useState('');
  const [expandedScanRunId, setExpandedScanRunId] = useState('');
  const [scanRunObservations, setScanRunObservations] = useState({});
  const [scanRunObservationsLoading, setScanRunObservationsLoading] = useState('');
  const [exportingScanRunId, setExportingScanRunId] = useState('');
  const [incidentQ, setIncidentQ] = useState('');
  const [incidentStatus, setIncidentStatus] = useState('all');
  const [incidentSeverity, setIncidentSeverity] = useState('all');
  const [incidentSourceKind, setIncidentSourceKind] = useState('all');
  const [incidentPatternId, setIncidentPatternId] = useState('all');
  const [incidentFileExt, setIncidentFileExt] = useState('');
  const [incidentDateFrom, setIncidentDateFrom] = useState('');
  const [incidentDateTo, setIncidentDateTo] = useState('');
  const [incidentHasFragment, setIncidentHasFragment] = useState(false);
  const [busyIncident, setBusyIncident] = useState('');
  const [busyAckAllHost, setBusyAckAllHost] = useState(false);
  const [busyAckInbox, setBusyAckInbox] = useState(false);
  const [bulkAckDialog, setBulkAckDialog] = useState({ open: false, scope: 'inbox', count: 0 });
  const [selectedInboxIncidentId, setSelectedInboxIncidentId] = useState('');
  const [expandedIncidentRows, setExpandedIncidentRows] = useState({});
  const [hostOverviewOpen, setHostOverviewOpen] = useState(false);
  const [hostOverviewData, setHostOverviewData] = useState(null);
  const [hostOverviewLoading, setHostOverviewLoading] = useState(false);
  const [hostOverviewError, setHostOverviewError] = useState(false);
  const [hostOverviewExpandedHosts, setHostOverviewExpandedHosts] = useState({});

  const agentsRequestIdRef = useRef(0);
  const hostsRequestIdRef = useRef(0);
  const reviewRequestIdRef = useRef(0);
  const hostIncidentRequestIdRef = useRef(0);
  const hostNewCountRequestIdRef = useRef(0);
  const hostScanRunsRequestIdRef = useRef(0);
  const refreshAllInFlightRef = useRef(false);
  const skipInitialAgentsEffectRef = useRef(true);
  const skipInitialHostsEffectRef = useRef(true);
  const skipInitialReviewEffectRef = useRef(true);

  const debouncedBranch = useDebouncedValue(branchFilter);
  const debouncedAgentQ = useDebouncedValue(agentQ);
  const debouncedHostQ = useDebouncedValue(hostQ);
  const debouncedIncidentQ = useDebouncedValue(incidentQ);

  const totals = dashboard.totals || {};
  const selectedScanPatternSet = useMemo(() => new Set(selectedScanPatternIds), [selectedScanPatternIds]);
  const scanPatternOptions = useMemo(() => buildScanPatternOptions(scanPatterns), [scanPatterns]);
  const groupedScanPatterns = useMemo(
    () => groupPatternsByCategory(scanPatternOptions, scanPatternQuery),
    [scanPatternOptions, scanPatternQuery],
  );
  const selectedScanPatternOptionCount = useMemo(
    () => scanPatternOptions.filter((option) => option.member_ids.every((id) => selectedScanPatternSet.has(id))).length,
    [scanPatternOptions, selectedScanPatternSet],
  );
  const incidentPatternOptions = useMemo(
    () => buildIncidentPatternOptions(scanPatterns),
    [scanPatterns],
  );

  const incidentInboxFilters = useMemo(() => ({
    branch: debouncedBranch || undefined,
    q: debouncedIncidentQ || undefined,
    status: incidentStatus === 'all' ? undefined : incidentStatus,
    severity: incidentSeverity === 'all' ? undefined : incidentSeverity,
    source_kind: incidentSourceKind === 'all' ? undefined : incidentSourceKind,
    pattern_id: incidentPatternId === 'all' ? undefined : incidentPatternId,
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
    incidentPatternId,
    incidentFileExt,
    incidentDateFrom,
    incidentDateTo,
    incidentHasFragment,
  ]);

  const incidentInbox = useScanIncidentInbox(incidentInboxFilters, { batchSize: INCIDENT_BATCH_SIZE });
  // Lightweight server-side count of "new" incidents matching the current filters
  // (independent of the status tab and of how many rows are actually loaded on the page),
  // used to correctly enable/disable bulk-ack actions and their pending counters.
  const incidentNewCountFilters = useMemo(() => ({
    ...incidentInboxFilters,
    status: 'new',
  }), [incidentInboxFilters]);
  const incidentNewCount = useScanIncidentInbox(incidentNewCountFilters, { batchSize: 1 });
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

  const loadReviewItems = async ({ silent = false } = {}) => {
    if (typeof scanAPI.getReviewItems !== 'function') return;
    const requestId = reviewRequestIdRef.current + 1;
    reviewRequestIdRef.current = requestId;
    if (!silent) setReviewLoading(true);
    try {
      const data = await scanAPI.getReviewItems({
        limit: reviewRowsPerPage,
        offset: reviewPage * reviewRowsPerPage,
      });
      if (requestId !== reviewRequestIdRef.current) return;
      setReviewItems(data && typeof data === 'object' ? data : { items: [], total: 0 });
    } catch (error) {
      console.error('Scan review items load failed', error);
      if (requestId === reviewRequestIdRef.current) setReviewItems({ items: [], total: 0 });
    } finally {
      if (requestId === reviewRequestIdRef.current && !silent) setReviewLoading(false);
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

  const loadHostIncidents = async ({ silent = false, append = false } = {}) => {
    const host = String(selectedHost || '').trim();
    if (!host) return;
    if (hostDrawerTab === 'runs' && !selectedScanRunId) {
      setHostIncidents([]);
      setHostIncidentsTotal(0);
      return;
    }
    const requestId = hostIncidentRequestIdRef.current + 1;
    hostIncidentRequestIdRef.current = requestId;
    const offset = append ? hostIncidents.length : 0;
    const limit = append
      ? HOST_INCIDENTS_PAGE_SIZE
      : Math.min(5000, silent ? Math.max(HOST_INCIDENTS_PAGE_SIZE, hostIncidents.length) : HOST_INCIDENTS_PAGE_SIZE);
    if (append) {
      setHostLoadingMore(true);
    } else if (!silent) {
      setHostLoading(true);
    }
    try {
      const runFilters = hostDrawerTab === 'runs'
        ? { task_id: selectedScanRunId || undefined }
        : {
          q: debouncedIncidentQ || undefined,
          status: incidentStatus === 'all' ? undefined : incidentStatus,
          severity: incidentSeverity === 'all' ? undefined : incidentSeverity,
          source_kind: incidentSourceKind === 'all' ? undefined : incidentSourceKind,
          pattern_id: incidentPatternId === 'all' ? undefined : incidentPatternId,
          file_ext: incidentFileExt || undefined,
          date_from: incidentDateFrom || undefined,
          date_to: incidentDateTo || undefined,
          has_fragment: incidentHasFragment ? true : undefined,
        };
      const response = await scanAPI.getIncidents({
        hostname: host,
        ...runFilters,
        limit,
        offset,
      });
      if (requestId !== hostIncidentRequestIdRef.current) return;
      const items = Array.isArray(response?.items) ? response.items : [];
      setHostIncidents((prev) => (append ? [...prev, ...items] : items));
      setHostIncidentsTotal(Number(response?.total || 0));
    } catch (error) {
      console.error('Host incidents load failed', error);
      if (requestId === hostIncidentRequestIdRef.current) {
        if (!silent && !append) {
          setHostIncidents([]);
          setHostIncidentsTotal(0);
        }
      }
    } finally {
      if (requestId === hostIncidentRequestIdRef.current && !silent) {
        setHostLoading(false);
      }
      if (requestId === hostIncidentRequestIdRef.current) {
        setHostLoadingMore(false);
      }
    }
  };

  const loadHostNewCount = async () => {
    const host = String(selectedHost || '').trim();
    if (!host || hostDrawerTab !== 'findings') return;
    const requestId = hostNewCountRequestIdRef.current + 1;
    hostNewCountRequestIdRef.current = requestId;
    try {
      const response = await scanAPI.getIncidents({
        hostname: host,
        q: debouncedIncidentQ || undefined,
        status: 'new',
        severity: incidentSeverity === 'all' ? undefined : incidentSeverity,
        source_kind: incidentSourceKind === 'all' ? undefined : incidentSourceKind,
        pattern_id: incidentPatternId === 'all' ? undefined : incidentPatternId,
        file_ext: incidentFileExt || undefined,
        date_from: incidentDateFrom || undefined,
        date_to: incidentDateTo || undefined,
        has_fragment: incidentHasFragment ? true : undefined,
        limit: 1,
        offset: 0,
      });
      if (requestId === hostNewCountRequestIdRef.current) {
        setHostNewCount(Number(response?.total || 0));
      }
    } catch (error) {
      console.error('Host new incidents count failed', error);
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

  const loadHostScanRuns = async ({ silent = false, append = false } = {}) => {
    const host = String(selectedHost || '').trim();
    if (!host) return;
    const requestId = hostScanRunsRequestIdRef.current + 1;
    hostScanRunsRequestIdRef.current = requestId;
    const limit = append
      ? HOST_SCAN_RUNS_PAGE_SIZE
      : Math.min(100, silent ? Math.max(HOST_SCAN_RUNS_PAGE_SIZE, hostScanRuns.length) : HOST_SCAN_RUNS_PAGE_SIZE);
    if (append) {
      setHostScanRunsLoadingMore(true);
    } else if (!silent) {
      setHostScanRunsLoading(true);
    }
    try {
      const response = await scanAPI.getHostScanRuns(host, {
        limit,
        offset: append ? hostScanRuns.length : 0,
      });
      if (requestId !== hostScanRunsRequestIdRef.current) return;
      const items = Array.isArray(response?.items) ? response.items : [];
      setHostScanRuns((prev) => (append ? [...prev, ...items] : items));
      setHostScanRunsTotal(Number(response?.total || 0));
      if (!append && !selectedScanRunId && items[0]?.id) {
        const firstRunId = String(items[0].id);
        setSelectedScanRunId(firstRunId);
        setExpandedScanRunId(firstRunId);
      }
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
      if (requestId === hostScanRunsRequestIdRef.current) {
        setHostScanRunsLoadingMore(false);
      }
    }
  };

  const loadScanRunObservations = async (taskId, { append = false } = {}) => {
    const normalizedTaskId = String(taskId || '').trim();
    const currentBucket = scanRunObservations[normalizedTaskId];
    if (!normalizedTaskId || (!append && currentBucket)) return;
    if (append && !currentBucket?.hasMore) return;
    setScanRunObservationsLoading(normalizedTaskId);
    try {
      const response = await scanAPI.getTaskObservations(normalizedTaskId, {
        limit: SCAN_RUN_OBSERVATION_LIMIT,
        offset: append ? Number(currentBucket?.nextOffset ?? currentBucket?.items?.length ?? 0) : 0,
      });
      const items = Array.isArray(response?.items) ? response.items : [];
      setScanRunObservations((prev) => ({
        ...prev,
        [normalizedTaskId]: {
          total: Number(response?.total || 0),
          items: append ? [...(prev[normalizedTaskId]?.items || []), ...items] : items,
          hasMore: Boolean(response?.has_more),
          nextOffset: response?.next_offset ?? null,
        },
      }));
    } catch (error) {
      console.error('Scan run observations load failed', error);
      setScanRunObservations((prev) => ({
        ...prev,
        [normalizedTaskId]: append
          ? prev[normalizedTaskId]
          : { total: 0, items: [], hasMore: false, nextOffset: null },
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
    if (refreshAllInFlightRef.current) return;
    refreshAllInFlightRef.current = true;
    if (!silent) setRefreshing(true);
    try {
      await Promise.all([
        loadDashboard({ silent }),
        loadReviewItems({ silent }),
        loadAgents({ silent }),
        loadHosts({ silent }),
        incidentInbox.loaded > 0 ? incidentInbox.refreshFirstPage({ silent: true }) : Promise.resolve(),
        incidentNewCount.refreshFirstPage({ silent: true }),
        hostDrawerOpen && selectedHost ? loadHostIncidents({ silent }) : Promise.resolve(),
        hostDrawerOpen && selectedHost && hostDrawerTab === 'findings' ? loadHostNewCount() : Promise.resolve(),
        hostDrawerOpen && selectedHost ? loadHostScanRuns({ silent }) : Promise.resolve(),
      ]);
    } finally {
      refreshAllInFlightRef.current = false;
      if (!silent) setRefreshing(false);
    }
  };

  // Auto-refresh interval always calls the *latest* refreshAll via this ref,
  // so it never operates on a stale closure (e.g. incidentInbox.loaded === 0
  // captured before the inbox finished its first load).
  const refreshAllRef = useRef(refreshAll);
  useEffect(() => {
    refreshAllRef.current = refreshAll;
  });

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
    if (skipInitialReviewEffectRef.current) {
      skipInitialReviewEffectRef.current = false;
      return;
    }
    loadReviewItems({ silent: reviewItems.items.length > 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewPage, reviewRowsPerPage]);

  useEffect(() => {
    if (!hostDrawerOpen || !selectedHost) return;
    if (hostDrawerTab === 'runs' && !selectedScanRunId) {
      setHostIncidents([]);
      setHostIncidentsTotal(0);
      return;
    }
    loadHostIncidents({ silent: hostIncidents.length > 0 || hostIncidentsTotal > 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hostDrawerOpen,
    hostDrawerTab,
    selectedHost,
    selectedScanRunId,
    debouncedIncidentQ,
    incidentStatus,
    incidentSeverity,
    incidentSourceKind,
    incidentPatternId,
    incidentFileExt,
    incidentDateFrom,
    incidentDateTo,
    incidentHasFragment,
  ]);

  useEffect(() => {
    if (!hostDrawerOpen || !selectedHost || hostDrawerTab !== 'findings') return;
    loadHostNewCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hostDrawerOpen,
    hostDrawerTab,
    selectedHost,
    debouncedIncidentQ,
    incidentSeverity,
    incidentSourceKind,
    incidentPatternId,
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
      refreshAllRef.current({ silent: true });
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [autoRefreshPaused]);

  const monitoredAgentIds = useMemo(() => {
    const ids = new Set(trackedTaskAgentIds);
    agentRows.forEach((row) => {
      if (isActiveTask(row.active_task)) ids.add(String(row.agent_id || '').trim());
    });
    return Array.from(ids).filter(Boolean);
  }, [trackedTaskAgentIds, agentRows]);
  // `monitoredAgentIds` is a brand-new array on every render (agentRows/trackedTaskAgentIds
  // are themselves replaced with new arrays on every poll tick), so using it directly as an
  // effect dependency would restart the effect - and immediately re-fire `tick()` - on every
  // single tick, turning the intended TASK_POLL_MS interval into a tight infinite polling loop.
  // A stable, value-based key keeps the effect from restarting unless the actual set of
  // monitored agent ids changes.
  const monitoredAgentIdsKey = monitoredAgentIds.join(',');

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monitoredAgentIdsKey]);

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
      await scanAPI.ackIncident(incidentId);
      if (String(incident?.status || '').toLowerCase() === 'new') {
        patchHostNewCount(incident?.hostname || selectedHost, -1);
      }
      await loadHostIncidents({ silent: true });
      await loadHostNewCount();
      await Promise.all([
        incidentInbox.refreshFirstPage({ silent: true }),
        incidentNewCount.refreshFirstPage({ silent: true }),
      ]);
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
    pattern_id: incidentPatternId === 'all' ? undefined : incidentPatternId,
    file_ext: incidentFileExt || undefined,
    date_from: incidentDateFrom || undefined,
    date_to: incidentDateTo || undefined,
    has_fragment: incidentHasFragment ? true : undefined,
    ...overrides,
  });

  const executeAckAllHostIncidents = async () => {
    if (!canScanAck) return;
    if (hostNewCount === 0) return;
    setBusyAckAllHost(true);
    try {
      const response = await scanAPI.ackIncidentsBatch({
        filters: buildIncidentFilters({ hostname: selectedHost, status: 'new' }),
      });
      const acked = Number(response?.acked_count || 0);
      if (acked > 0) patchHostNewCount(selectedHost, -acked);
      await loadHostIncidents({ silent: true });
      await loadHostNewCount();
      await Promise.all([
        incidentInbox.reload({ silent: true }),
        incidentNewCount.refreshFirstPage({ silent: true }),
      ]);
    } catch (error) {
      console.error('Ack all host incidents failed', error);
    } finally {
      setBusyAckAllHost(false);
    }
  };

  const executeAckInboxFiltered = async () => {
    if (!canScanAck) return;
    if (incidentNewCount.total <= 0) return;
    setBusyAckInbox(true);
    try {
      const filters = buildIncidentFilters();
      const hasFilter = Object.values(filters).some((value) => value !== undefined && value !== null && value !== '');
      await scanAPI.ackIncidentsBatch({ filters, confirm_all: !hasFilter });
      await Promise.all([
        incidentInbox.reload({ silent: true }),
        incidentNewCount.reload({ silent: true }),
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

  const handleAckAllHostIncidents = () => {
    if (!canScanAck || hostNewCount <= 0) return;
    setBulkAckDialog({ open: true, scope: 'host', count: Number(hostNewCount || 0) });
  };

  const handleAckInboxFiltered = () => {
    if (!canScanAck || incidentNewCount.total <= 0) return;
    setBulkAckDialog({ open: true, scope: 'inbox', count: Number(incidentNewCount.total || 0) });
  };

  // Server-side host/file overview: reflects the *entire* filtered incident set
  // (not just the currently loaded inbox page), useful for navigating very large
  // inboxes where loading every incident client-side would be wasteful.
  const loadHostOverview = async (hostOffset = 0) => {
    setHostOverviewLoading(true);
    setHostOverviewError(false);
    try {
      const response = await scanAPI.getIncidentInboxGroups({
        ...buildIncidentFilters(),
        host_limit: 25,
        host_offset: hostOffset,
        files_per_host: 10,
      });
      setHostOverviewData(response);
    } catch (error) {
      console.error('Host overview load failed', error);
      setHostOverviewError(true);
      if (hostOffset === 0) setHostOverviewData(null);
    } finally {
      setHostOverviewLoading(false);
    }
  };

  const handleOpenHostOverview = () => {
    setHostOverviewOpen(true);
    setHostOverviewExpandedHosts({});
    loadHostOverview(0);
  };

  const toggleHostOverviewHost = (hostId) => {
    setHostOverviewExpandedHosts((prev) => ({ ...prev, [hostId]: !prev[hostId] }));
  };

  const handleHostOverviewDrillDown = (searchValue) => {
    const value = String(searchValue || '').trim();
    if (!value) return;
    setIncidentQ(value);
    setHostOverviewOpen(false);
  };

  const resetIncidentFilters = () => {
    setIncidentQ('');
    setIncidentStatus('all');
    setIncidentSeverity('all');
    setIncidentSourceKind('all');
    setIncidentPatternId('all');
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
    setHostDrawerTab('runs');
    setIncidentQ('');
    setIncidentStatus('all');
    setIncidentSeverity('all');
    setIncidentSourceKind('all');
    setIncidentPatternId('all');
    setIncidentFileExt('');
    setIncidentDateFrom('');
    setIncidentDateTo('');
    setIncidentHasFragment(false);
    setHostScanRuns([]);
    setHostScanRunsTotal(0);
    setHostNewCount(0);
    setSelectedScanRunId('');
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
      if (task?.blocked) {
        setTaskNotice({
          severity: 'warning',
          text: `Новый скан для ${normalizedAgentId} не поставлен: ещё обрабатывается предыдущее задание (${task.blocking_job_status || 'active'}).`,
        });
        return;
      }
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

  const toggleScanPattern = (patternIds) => {
    const normalizedIds = Array.from(new Set(
      (Array.isArray(patternIds) ? patternIds : [patternIds])
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ));
    if (normalizedIds.length === 0) return;
    setSelectedScanPatternIds((prev) => {
      const set = new Set(Array.isArray(prev) ? prev : []);
      const groupSelected = normalizedIds.every((id) => set.has(id));
      normalizedIds.forEach((id) => {
        if (groupSelected) set.delete(id);
        else set.add(id);
      });
      return Array.from(set);
    });
  };

  const selectAllScanPatterns = () => {
    setSelectedScanPatternIds(scanPatterns.map((item) => item.id));
  };

  const clearScanPatterns = () => {
    setSelectedScanPatternIds([]);
  };

  const toggleScanFileGroup = (extensions) => {
    const normalizedExtensions = Array.isArray(extensions) ? extensions : [];
    setSelectedScanExtensions((previous) => {
      const selected = new Set(Array.isArray(previous) ? previous : []);
      const groupSelected = normalizedExtensions.every((extension) => selected.has(extension));
      normalizedExtensions.forEach((extension) => {
        if (groupSelected) selected.delete(extension);
        else selected.add(extension);
      });
      return Array.from(selected).sort();
    });
  };

  const selectLoanScanPatterns = () => {
    const loanIds = scanPatterns
      .filter((item) => item.id === 'loan_keyword' || item.name.toLowerCase().includes('займ'))
      .map((item) => item.id);
    if (loanIds.length > 0) setSelectedScanPatternIds(loanIds);
  };

  const submitScanLaunch = () => {
    const agentId = String(scanLaunchDialog.agentId || '').trim();
    if (!agentId || selectedScanPatternIds.length === 0 || selectedScanExtensions.length === 0) return;
    const payload = {
      ...(scanLaunchDialog.forceRescan ? { force_rescan: true } : {}),
      agent_pattern_ids: selectedScanPatternIds,
      scan_extensions: selectedScanExtensions,
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

  return (
    <MainLayout showDatabaseSelector>
      <PageShell sx={{ width: '100%', pb: isMobile ? 'calc(var(--app-shell-mobile-bottom-nav-height, 64px) + 8px)' : 2, minHeight: isMobile ? undefined : 'calc(100dvh - var(--app-shell-top-offset, var(--app-shell-header-offset)) - 32px)' }}>
        {isMobile ? <MobileShellPageHeader title="Scan Center" showDatabaseSelector /> : null}
        <ScanCenterHeader
          dashboard={dashboard}
          taskNotice={taskNotice}
          autoRefreshPaused={autoRefreshPaused}
          refreshing={refreshing}
          branchOptions={branchOptions}
          branchOptionsLoading={branchOptionsLoading}
          branchFilter={branchFilter}
          onDismissNotice={() => setTaskNotice(null)}
          onAutoRefreshChange={(enabled) => setAutoRefreshPaused(!enabled)}
          onRefresh={() => refreshAll({ silent: false })}
          onOpenAgents={() => setActiveSection('agents')}
          onBranchChange={(branch) => {
            setBranchFilter(branch);
            setAgentPage(0);
            setHostPage(0);
          }}
        />

        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', lg: 'row' }, gap: 2, alignItems: 'flex-start' }}>
          <ScanCenterNavigation
            active={activeSection}
            compact={isMobile}
            counts={{
              overview: null,
              incidents: Number(incidentInbox.total || 0),
              review: Number(reviewItems.total || 0),
              agents: Number(agentTotal || 0),
              hosts: Number(hostTotal || 0),
            }}
            onChange={setActiveSection}
          />

          <Box component="section" sx={{ flex: 1, width: '100%', minWidth: 0 }}>

        {activeSection === 'overview' && (
          <ScanCenterOverview
            dashboard={dashboard}
            dashboardLoading={dashboardLoading}
            reviewItems={reviewItems}
            onNavigate={setActiveSection}
          />
        )}

        {activeSection === 'incidents' && (
          <Paper variant="outlined" sx={{ ...getOfficePanelSx(ui, { p: 0, mb: 2, overflow: 'hidden' }) }}>
            <IncidentsInboxSection
              inbox={{ ...incidentInbox, batchSize: INCIDENT_BATCH_SIZE }}
              newCount={incidentNewCount}
              rows={incidentRows}
              selectedIncident={selectedInboxIncident}
              sourceOptions={incidentSourceOptions}
              patternOptions={incidentPatternOptions}
              filters={{
                q: incidentQ,
                status: incidentStatus,
                severity: incidentSeverity,
                sourceKind: incidentSourceKind,
                patternId: incidentPatternId,
                fileExt: incidentFileExt,
                dateFrom: incidentDateFrom,
                dateTo: incidentDateTo,
                hasFragment: incidentHasFragment,
              }}
              workAreaHeight={incidentWorkAreaHeight}
              canScanAck={canScanAck}
              busyAckInbox={busyAckInbox}
              busyIncident={busyIncident}
              ui={ui}
              quietActionSx={{
                neutral: getOfficeQuietActionSx(ui, theme, 'neutral'),
                primary: getOfficeQuietActionSx(ui, theme, 'primary'),
                warning: getOfficeQuietActionSx(ui, theme, 'warning', { alignSelf: 'flex-start' }),
              }}
              panelSx={getOfficePanelSx(ui, {
                p: 2,
                height: incidentWorkAreaHeight,
                minHeight: { xs: 520, lg: 640 },
                overflow: 'auto',
                boxShadow: 'none',
              })}
              formatters={{
                fileStatusColor,
                fileStatusLabel,
                formatTs,
                getFileExt: getInboxIncidentFileExt,
                getSourceKind: getInboxIncidentSourceKind,
                severityColor,
              }}
              renderVirtualRow={renderIncidentVirtualRow}
              renderFragments={renderInboxFragments}
              onReload={() => incidentInbox.reload({ silent: false })}
              onResetFilters={resetIncidentFilters}
              onOpenHostOverview={handleOpenHostOverview}
              onExpandAll={expandAllIncidentRows}
              onCollapseAll={collapseAllIncidentRows}
              onAckFiltered={handleAckInboxFiltered}
              onFilterChange={(name, value) => {
                const setters = {
                  q: setIncidentQ,
                  status: setIncidentStatus,
                  severity: setIncidentSeverity,
                  sourceKind: setIncidentSourceKind,
                  patternId: setIncidentPatternId,
                  fileExt: setIncidentFileExt,
                  dateFrom: setIncidentDateFrom,
                  dateTo: setIncidentDateTo,
                };
                setters[name]?.(value);
              }}
              onToggleFragments={() => setIncidentHasFragment((previous) => !previous)}
              onAckIncident={handleAckIncident}
              onLoadMore={incidentInbox.loadMore}
            />
          </Paper>
        )}

        {activeSection === 'review' && <ReviewItemsSection
          visible
          items={Array.isArray(reviewItems.items) ? reviewItems.items : []}
          total={reviewItems.total}
          loading={reviewLoading}
          page={reviewPage}
          rowsPerPage={reviewRowsPerPage}
          rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
          canScanTasks={canScanTasks}
          formatTs={formatTs}
          onPageChange={setReviewPage}
          onRowsPerPageChange={(value) => { setReviewRowsPerPage(value); setReviewPage(0); }}
          onRetryAgent={(agentId) => openScanLaunchDialog(agentId, true)}
        />}

        {activeSection === 'agents' && <AgentsSection
          visible
          rows={agentRows}
          total={agentTotal}
          loading={agentsLoading}
          page={agentPage}
          rowsPerPage={agentRowsPerPage}
          rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
          query={agentQ}
          online={agentOnline}
          taskStatus={agentTaskStatus}
          sortBy={agentSortBy}
          sortDir={agentSortDir}
          canScanTasks={canScanTasks}
          busyTaskAgent={busyTaskAgent}
          expectedAgentVersion={dashboard?.expected_agent_version}
          formatters={{
            commandLabel,
            formatLastSeen,
            formatTaskTimestamp,
            formatTs,
            isActiveTask,
            renderTaskStatusLabel,
            renderTaskSummary,
            taskStatusColor,
            taskStatusLabel,
            taskTimestampLabel,
          }}
          onQueryChange={(value) => { setAgentQ(value); setAgentPage(0); }}
          onOnlineChange={(value) => { setAgentOnline(value); setAgentPage(0); }}
          onTaskStatusChange={(value) => { setAgentTaskStatus(value); setAgentPage(0); }}
          onSort={(key) => {
            setAgentSortDir(sortToggle(agentSortBy, agentSortDir, key));
            setAgentSortBy(key);
          }}
          onPageChange={setAgentPage}
          onRowsPerPageChange={(value) => { setAgentRowsPerPage(value); setAgentPage(0); }}
          onOpenScan={openScanLaunchDialog}
          onPing={(agentId) => enqueueTask(agentId, 'ping')}
          onOpenHost={openHostDetails}
        />}

        {activeSection === 'hosts' && <HostsSection
          visible
          rows={hostRows}
          total={hostTotal}
          loading={hostsLoading}
          page={hostPage}
          rowsPerPage={hostRowsPerPage}
          rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
          query={hostQ}
          status={hostStatus}
          severity={hostSeverity}
          sortBy={hostSortBy}
          sortDir={hostSortDir}
          formatTs={formatTs}
          severityColor={severityColor}
          onQueryChange={(value) => { setHostQ(value); setHostPage(0); }}
          onStatusChange={(value) => { setHostStatus(value); setHostPage(0); }}
          onSeverityChange={(value) => { setHostSeverity(value); setHostPage(0); }}
          onSort={(key) => {
            setHostSortDir(sortToggle(hostSortBy, hostSortDir, key));
            setHostSortBy(key);
          }}
          onPageChange={setHostPage}
          onRowsPerPageChange={(value) => { setHostRowsPerPage(value); setHostPage(0); }}
          onOpenHost={openHostDetails}
        />}
          </Box>
        </Box>

        <HostDrawer
          open={hostDrawerOpen}
          host={selectedHost}
          activeTab={hostDrawerTab}
          onClose={() => setHostDrawerOpen(false)}
          onTabChange={(nextTab) => {
            setHostDrawerTab(nextTab);
            setHostIncidents([]);
            setHostIncidentsTotal(0);
          }}
          scanRuns={hostScanRuns}
          scanRunsTotal={hostScanRunsTotal}
          scanRunsLoading={hostScanRunsLoading}
          scanRunsLoadingMore={hostScanRunsLoadingMore}
          selectedRunId={selectedScanRunId}
          expandedRunId={expandedScanRunId}
          observations={scanRunObservations}
          observationsLoadingId={scanRunObservationsLoading}
          exportingRunId={exportingScanRunId}
          scanPatterns={scanPatterns}
          incidentPatternOptions={incidentPatternOptions}
          incidents={hostIncidents}
          incidentsTotal={hostIncidentsTotal}
          incidentsLoading={hostLoading}
          incidentsLoadingMore={hostLoadingMore}
          newCount={hostNewCount}
          canScanRead={canScanRead}
          canScanAck={canScanAck}
          busyIncident={busyIncident}
          busyAckAll={busyAckAllHost}
          filters={{
            q: incidentQ,
            status: incidentStatus,
            severity: incidentSeverity,
            sourceKind: incidentSourceKind,
            patternId: incidentPatternId,
            fileExt: incidentFileExt,
            dateFrom: incidentDateFrom,
            dateTo: incidentDateTo,
            hasFragment: incidentHasFragment,
          }}
          sourceOptions={incidentSourceOptions}
          onRefreshRuns={() => loadHostScanRuns({ silent: false })}
          onLoadMoreRuns={() => loadHostScanRuns({ silent: true, append: true })}
          onSelectRun={(runId) => {
            setSelectedScanRunId(runId);
            setHostIncidents([]);
            setHostIncidentsTotal(0);
          }}
          onToggleRun={(runId) => setExpandedScanRunId((previous) => (previous === runId ? '' : runId))}
          onLoadMoreObservations={(runId) => loadScanRunObservations(runId, { append: true })}
          onExportRun={handleExportScanRunIncidents}
          onFilterChange={(name, value) => {
            const setters = {
              q: setIncidentQ,
              status: setIncidentStatus,
              severity: setIncidentSeverity,
              sourceKind: setIncidentSourceKind,
              patternId: setIncidentPatternId,
              fileExt: setIncidentFileExt,
              dateFrom: setIncidentDateFrom,
              dateTo: setIncidentDateTo,
            };
            setters[name]?.(value);
          }}
          onToggleFragments={() => setIncidentHasFragment((previous) => !previous)}
          onAckAll={handleAckAllHostIncidents}
          onAckIncident={handleAckIncident}
          onLoadMoreIncidents={() => loadHostIncidents({ silent: true, append: true })}
          resolveIncidentMeta={(incident) => {
            const meta = hostMetaByName[normalizeHost(incident?.hostname || selectedHost)] || {};
            return {
              branch: String(incident?.branch || meta.branch || '').trim(),
              user: String(incident?.user_full_name || incident?.user_login || meta.user || '').trim(),
              ip: resolveIncidentIp(incident),
            };
          }}
        />

        <Dialog
          open={bulkAckDialog.open}
          onClose={() => setBulkAckDialog((previous) => ({ ...previous, open: false }))}
          fullWidth
          maxWidth="xs"
        >
          <DialogTitle>Подтвердить массовую отметку</DialogTitle>
          <DialogContent dividers>
            <Alert severity="warning" sx={{ mb: 1.5 }}>
              Будут отмечены просмотренными {bulkAckDialog.count} инцидентов, включая ещё не загруженные строки списка.
            </Alert>
            <Typography variant="body2" color="text.secondary">
              Область: {bulkAckDialog.scope === 'host' ? `компьютер ${selectedHost}` : 'текущий фильтр входящих инцидентов'}.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button type="button" onClick={() => setBulkAckDialog((previous) => ({ ...previous, open: false }))}>Отмена</Button>
            <Button
              type="button"
              variant="contained"
              color="warning"
              onClick={() => {
                const scope = bulkAckDialog.scope;
                setBulkAckDialog((previous) => ({ ...previous, open: false }));
                if (scope === 'host') executeAckAllHostIncidents();
                else executeAckInboxFiltered();
              }}
            >
              Отметить просмотренными
            </Button>
          </DialogActions>
        </Dialog>

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
                <Stack spacing={1}>
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>Какие файлы проверять</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Office выключен по умолчанию: его конвертация заметно тяжелее PDF и нужна только для целевого запуска.
                    </Typography>
                  </Box>
                  <Grid container spacing={1}>
                    {SCAN_FILE_GROUPS.map((group) => {
                      const selected = group.extensions.every((extension) => selectedScanExtensions.includes(extension));
                      return (
                        <Grid item xs={12} sm={6} key={group.id}>
                          <Paper
                            variant="outlined"
                            sx={{
                              px: 1,
                              py: 0.7,
                              height: '100%',
                              borderColor: selected ? 'primary.main' : 'divider',
                              bgcolor: selected ? 'action.selected' : 'background.paper',
                            }}
                          >
                            <FormControlLabel
                              sx={{ m: 0, alignItems: 'flex-start', width: '100%' }}
                              control={<Checkbox checked={selected} onChange={() => toggleScanFileGroup(group.extensions)} />}
                              label={(
                                <Box sx={{ pt: 0.25 }}>
                                  <Typography variant="body2" sx={{ fontWeight: 750 }}>{group.label}</Typography>
                                  <Typography variant="caption" color="text.secondary">{group.helper}</Typography>
                                </Box>
                              )}
                            />
                          </Paper>
                        </Grid>
                      );
                    })}
                  </Grid>
                  {selectedScanExtensions.length === 0 ? (
                    <Alert severity="warning">Выберите хотя бы один тип файлов.</Alert>
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      Выбрано расширений: {selectedScanExtensions.length}
                    </Typography>
                  )}
                </Stack>
              </Paper>

              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
                <Stack spacing={1.3}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                        Правила поиска на агенте и сервере
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Выбрано {selectedScanPatternOptionCount} из {scanPatternOptions.length}. Агент применит их к тексту и text layer PDF, сервер — к OCR.
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
                                      checked={pattern.member_ids.every((id) => selectedScanPatternSet.has(id))}
                                      indeterminate={pattern.member_ids.some((id) => selectedScanPatternSet.has(id)) && !pattern.member_ids.every((id) => selectedScanPatternSet.has(id))}
                                      onChange={() => toggleScanPattern(pattern.member_ids)}
                                    />
                                  )}
                                  label={(
                                    <Box sx={{ minWidth: 0 }}>
                                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                        {pattern.name || pattern.id}
                                      </Typography>
                                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', wordBreak: 'break-all' }}>
                                        {pattern.member_ids.length > 1
                                          ? `Используются ${pattern.member_ids.length} внутренних правила: точная фраза, OCR-варианты и сокращение`
                                          : `${pattern.id} · weight ${pattern.weight || 0}`}
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
              disabled={!canScanTasks || scanPatternsLoading || scanPatterns.length === 0 || selectedScanPatternIds.length === 0 || selectedScanExtensions.length === 0}
            >
              Запустить
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={hostOverviewOpen}
          onClose={() => setHostOverviewOpen(false)}
          fullWidth
          maxWidth="sm"
        >
          <DialogTitle sx={{ pb: 1 }}>
            Обзор по хостам
            {hostOverviewData && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 400 }}>
                {hostOverviewData.total_hosts} хостов · {hostOverviewData.total_incidents} инцидентов по текущему фильтру
              </Typography>
            )}
          </DialogTitle>
          <DialogContent dividers>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Сводка считается на сервере по всему фильтру, а не только по загруженной странице инбокса. Клик по хосту или файлу подставит его в поиск инбокса.
            </Typography>
            {hostOverviewLoading && !hostOverviewData ? (
              <Box sx={{ py: 3, display: 'flex', justifyContent: 'center' }}>
                <CircularProgress size={24} />
              </Box>
            ) : hostOverviewError && !hostOverviewData ? (
              <Alert severity="error">Не удалось загрузить обзор по хостам.</Alert>
            ) : !hostOverviewData || hostOverviewData.items.length === 0 ? (
              <Alert severity="info">По текущему фильтру нет инцидентов.</Alert>
            ) : (
              <Stack spacing={1}>
                {hostOverviewData.items.map((host) => {
                  const hostExpanded = Boolean(hostOverviewExpandedHosts[host.id]);
                  return (
                    <Paper key={host.id} variant="outlined" sx={{ p: 1.2, borderRadius: 1.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                        <Box
                          sx={{ cursor: 'pointer', minWidth: 0 }}
                          onClick={() => handleHostOverviewDrillDown(host.hostname)}
                        >
                          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                            {host.hostname}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            {[host.branch, host.user].filter(Boolean).join(' · ') || '-'}
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={0.6} alignItems="center" sx={{ flexShrink: 0 }}>
                          <Chip size="small" color={host.incidents_new > 0 ? 'warning' : 'default'} label={`Новых: ${host.incidents_new}`} />
                          <Chip size="small" variant="outlined" label={`Всего: ${host.incidents_total}`} />
                          <Button
                            type="button"
                            size="small"
                            onClick={() => toggleHostOverviewHost(host.id)}
                            sx={{ minWidth: 0, px: 1 }}
                          >
                            {hostExpanded ? 'Скрыть' : 'Файлы'}
                          </Button>
                        </Stack>
                      </Box>
                      {hostExpanded && (
                        <Stack spacing={0.8} sx={{ mt: 1, pl: 1, borderLeft: '2px solid', borderColor: 'divider' }}>
                          {(host.files || []).map((file) => (
                            <Box
                              key={file.id}
                              sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, cursor: 'pointer' }}
                              onClick={() => handleHostOverviewDrillDown(file.file_path || file.file_name)}
                            >
                              <Box sx={{ minWidth: 0 }}>
                                <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                                  {file.file_path || file.file_name || '-'}
                                </Typography>
                                {file.fragments && file.fragments.length > 0 && (
                                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                    {file.fragments[0]?.snippet || file.fragments[0]?.pattern_name || ''}
                                  </Typography>
                                )}
                              </Box>
                              <Stack direction="row" spacing={0.6} sx={{ flexShrink: 0 }}>
                                <Chip size="small" color={file.incidents_new > 0 ? 'warning' : 'default'} label={file.incidents_new} />
                                <Chip size="small" variant="outlined" label={file.incidents_total} />
                              </Stack>
                            </Box>
                          ))}
                        </Stack>
                      )}
                    </Paper>
                  );
                })}
                {hostOverviewData.has_more && (
                  <Button
                    type="button"
                    size="small"
                    variant="outlined"
                    disabled={hostOverviewLoading}
                    onClick={() => loadHostOverview(Number(hostOverviewData.host_offset || 0) + Number(hostOverviewData.host_limit || 25))}
                  >
                    {hostOverviewLoading ? 'Загрузка…' : 'Показать ещё хосты'}
                  </Button>
                )}
              </Stack>
            )}
          </DialogContent>
          <DialogActions>
            <Button type="button" onClick={() => setHostOverviewOpen(false)}>Закрыть</Button>
          </DialogActions>
        </Dialog>
      </PageShell>
    </MainLayout>
  );
}

export default ScanCenterPage;
