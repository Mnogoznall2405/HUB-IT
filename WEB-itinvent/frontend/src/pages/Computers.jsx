import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  CircularProgress,
  Drawer,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ExpandLess as ExpandLessIcon,
  ExpandMore as ExpandMoreIcon,
  Refresh as RefreshIcon,
  Lan as LanIcon,
  MailOutline as MailOutlineIcon,
  Storage as StorageIcon,
  WarningAmber as WarningAmberIcon,
} from '@mui/icons-material';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import { equipmentAPI } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '@mui/material/styles';
import { buildOfficeUiTokens, getOfficePanelSx } from '../theme/officeUiTokens';

const SEEN_CHANGES_STORAGE_KEY = 'computers_seen_changes_by_pc_v1';
const USER_PROFILE_HIDE_SYSTEM_FOLDERS_STORAGE_KEY = 'computers_hide_system_user_profile_folders_v1';
const AUTO_REFRESH_BASE_SEC = 60;
const AUTO_REFRESH_STEP_SEC = 30;
const AUTO_REFRESH_MAX_SEC = 120;
const SEARCH_DEBOUNCE_MS = 350;
const COMPUTERS_PAGE_SIZE = 50;
const OUTLOOK_ARCHIVE_LIMIT_BYTES = 50 * 1024 * 1024 * 1024;
const COMPUTER_SEARCH_FIELD_OPTIONS = [
  { key: 'identity', label: 'ПК' },
  { key: 'user', label: 'Пользователь' },
  { key: 'profiles', label: 'Профили' },
  { key: 'outlook', label: 'Outlook архивы' },
  { key: 'network', label: 'Сеть' },
  { key: 'location', label: 'Филиал' },
  { key: 'database', label: 'БД' },
];
const DEFAULT_COMPUTER_SEARCH_FIELDS = COMPUTER_SEARCH_FIELD_OPTIONS.map((item) => item.key);

function StatCard({ title, value, helper, color = 'inherit' }) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  return (
    <Paper variant="outlined" sx={{ ...getOfficePanelSx(ui, { p: 2, height: '100%' }) }}>
      <Typography variant="body2" color="text.secondary">{title}</Typography>
      <Typography variant="h4" sx={{ fontWeight: 700, color, lineHeight: 1.2 }}>{value}</Typography>
      <Typography variant="caption" color="text.secondary">{helper}</Typography>
    </Paper>
  );
}

function MiniBars({ title, rows, color }) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const list = Array.isArray(rows) ? rows.slice(0, 8) : [];
  const max = list.reduce((acc, row) => Math.max(acc, Number(row.value) || 0), 0) || 1;

  return (
    <Paper variant="outlined" sx={{ ...getOfficePanelSx(ui, { p: 2, height: '100%' }) }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.2 }}>{title}</Typography>
      {list.length === 0 ? (
        <Typography variant="body2" color="text.secondary">Нет данных</Typography>
      ) : (
        <Stack spacing={1}>
          {list.map((row) => {
            const value = Number(row.value) || 0;
            const width = Math.max(3, Math.round((value / max) * 100));
            return (
              <Box key={String(row.label)}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.2 }}>
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>{row.label}</Typography>
                  <Typography variant="caption" color="text.secondary">{value}</Typography>
                </Box>
                <Box sx={{ height: 7, borderRadius: 4, bgcolor: ui.actionBg, overflow: 'hidden' }}>
                  <Box sx={{ width: `${width}%`, height: '100%', bgcolor: color }} />
                </Box>
              </Box>
            );
          })}
        </Stack>
      )}
    </Paper>
  );
}

function formatTs(ts) {
  if (!ts) return '-';
  return new Date(Number(ts) * 1000).toLocaleString('ru-RU');
}

function formatAge(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return '-';
  if (value < 60) return `${value}с`;
  const mins = Math.floor(value / 60);
  if (mins < 60) return `${mins}м`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}ч`;
  return `${Math.floor(hours / 24)}д`;
}

function toPercent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0) return 0;
  if (parsed > 100) return 100;
  return parsed;
}

function formatPercent(value) {
  const parsed = toPercent(value);
  if (parsed === null) return '-';
  return `${parsed.toFixed(1)}%`;
}

function resolveRuntimeMetrics(pc) {
  const health = pc?.health && typeof pc.health === 'object' ? pc.health : {};
  const cpu = toPercent(pc?.cpu_load_percent ?? health?.cpu_load_percent);
  const ram = toPercent(pc?.ram_used_percent ?? health?.ram_used_percent);

  const uptimeRaw = Number(pc?.uptime_seconds ?? health?.uptime_seconds);
  const uptimeSeconds = Number.isFinite(uptimeRaw) && uptimeRaw >= 0 ? Math.floor(uptimeRaw) : null;

  const rebootRaw = Number(pc?.last_reboot_at ?? health?.last_reboot_at ?? health?.boot_time);
  const lastRebootAt = Number.isFinite(rebootRaw) && rebootRaw > 0 ? Math.floor(rebootRaw) : null;

  return { cpu, ram, uptimeSeconds, lastRebootAt };
}

function smartHealthColor(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (!normalized) return 'default';
  if (normalized.includes('healthy') || normalized.includes('ok') || normalized.includes('good')) return 'success';
  if (normalized.includes('warning') || normalized.includes('degrad') || normalized.includes('pred')) return 'warning';
  if (normalized.includes('critical') || normalized.includes('unhealthy') || normalized.includes('fail')) return 'error';
  return 'default';
}

function getStorageHealthStats(pc) {
  const rows = Array.isArray(pc?.storage) ? pc.storage : [];
  let problemCount = 0;
  rows.forEach((disk) => {
    const color = smartHealthColor(disk?.health_status);
    if (color === 'warning' || color === 'error') {
      problemCount += 1;
    }
  });
  return { total: rows.length, problemCount };
}

function statusColor(status) {
  if (status === 'online') return 'success';
  if (status === 'stale') return 'warning';
  if (status === 'offline') return 'error';
  return 'default';
}

function statusLabel(status) {
  if (status === 'online') return 'В сети';
  if (status === 'stale') return 'Нет свежих';
  if (status === 'offline') return 'Оффлайн';
  return 'Неизвестно';
}

function firstIpv4(value) {
  const text = String(value || '');
  const match = text.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
  return match ? match[0] : '';
}

function resolvePcIp(pc) {
  const direct = String(pc?.ip_primary || '').trim();
  if (direct) return direct;
  if (Array.isArray(pc?.ip_list) && pc.ip_list.length > 0) {
    const candidate = firstIpv4(pc.ip_list[0]);
    if (candidate) return candidate;
  }
  return firstIpv4(pc?.network_link?.endpoint_ip_raw);
}

function toIntOrNull(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function formatDiskSizeFromBytes(value) {
  const sizeBytes = toIntOrNull(value);
  if (!sizeBytes) return '';
  const gib = sizeBytes / (1024 ** 3);
  if (gib >= 1024) return `${(gib / 1024).toFixed(1)} ТБ`;
  return `${Math.round(gib)} ГБ`;
}

function resolveDiskSizeLabel(disk) {
  return formatDiskSizeFromBytes(disk?.size_bytes) || formatDiskSizeFromBytes(disk?.extended_info?.Size);
}

function resolveDiskTitle(disk) {
  const title = String(disk?.display_name || disk?.model || disk?.serial_number || 'Без названия').trim();
  if (title) return title;
  return 'Без названия';
}

function formatBytesCompact(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '-';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let size = bytes;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  if (idx === 0) return `${Math.round(size)} ${units[idx]}`;
  return `${size.toFixed(1)} ${units[idx]}`;
}

const USER_PROFILE_PARTIAL_HINT = 'Агент остановил обход по лимиту времени или количеству файлов, чтобы не нагружать диск';
const USER_PROFILE_FOLDER_PREVIEW_LIMIT = 4;
const USER_PROFILE_FOLDER_LABELS = {
  Desktop: 'Рабочий стол',
  Documents: 'Документы',
  Downloads: 'Загрузки',
  Pictures: 'Изображения',
};
const USER_PROFILE_SYSTEM_FOLDER_NAMES = new Set([
  'appdata',
  'application data',
  'cookies',
  'intelgraphicsprofiles',
  'links',
  'local settings',
  'nethood',
  'printhood',
  'recent',
  'saved games',
  'searches',
  'sendto',
  'start menu',
  'templates',
]);

function formatUserProfileFolderName(name) {
  const raw = String(name || '').trim();
  return USER_PROFILE_FOLDER_LABELS[raw] || raw || '-';
}

function getUserProfileKey(profile, idx) {
  return String(profile?.profilePath || profile?.userName || `profile-${idx}`).trim() || `profile-${idx}`;
}

function isUserProfileSystemFolder(folder) {
  const name = String(folder?.name || '').trim();
  const normalized = name.toLowerCase();
  if (!normalized) return false;
  return normalized.startsWith('.') || USER_PROFILE_SYSTEM_FOLDER_NAMES.has(normalized);
}

function getUserProfileFolders(profile, hideSystemFolders = false) {
  const folders = Array.isArray(profile?.topLevelFolders) ? profile.topLevelFolders : [];
  if (!hideSystemFolders) return folders;
  return folders.filter((folder) => !isUserProfileSystemFolder(folder));
}

function formatUserProfileFolderSummary(profile, hideSystemFolders = false) {
  const folders = getUserProfileFolders(profile, hideSystemFolders);
  if (folders.length === 0) return '';
  const visible = folders
    .slice(0, USER_PROFILE_FOLDER_PREVIEW_LIMIT)
    .map((folder) => `${formatUserProfileFolderName(folder.name)} ${formatBytesCompact(folder.sizeBytes)}`);
  const hiddenCount = Math.max(0, folders.length - USER_PROFILE_FOLDER_PREVIEW_LIMIT);
  return hiddenCount > 0 ? `${visible.join(' · ')} · + еще ${hiddenCount}` : visible.join(' · ');
}

function getUserProfileFolderShare(folder, profile) {
  const sizeBytes = Number(folder?.sizeBytes || 0);
  const totalBytes = Number(profile?.totalSizeBytes || 0);
  if (!Number.isFinite(sizeBytes) || !Number.isFinite(totalBytes) || sizeBytes <= 0 || totalBytes <= 0) return 0;
  return Math.max(1, Math.min(100, Math.round((sizeBytes / totalBytes) * 100)));
}

function outlookStatusColor(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'ok') return 'success';
  if (normalized === 'warning') return 'warning';
  if (normalized === 'critical') return 'error';
  return 'default';
}

function outlookStatusLabel(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'ok') return 'OK';
  if (normalized === 'warning') return 'Предупреждение';
  if (normalized === 'critical') return 'Критично';
  return 'Неизвестно';
}

function resolveOutlookMeta(pc) {
  const raw = pc?.outlook && typeof pc.outlook === 'object' ? pc.outlook : {};
  const active = raw?.active_store && typeof raw.active_store === 'object' ? raw.active_store : null;
  const activeStoresRaw = Array.isArray(raw?.active_stores) ? raw.active_stores : [];
  const activeStores = activeStoresRaw
    .filter((row) => row && typeof row === 'object' && String(row.path || '').trim())
    .map((row) => row);
  if (active && !activeStores.some((row) => String(row.path || '').trim().toLowerCase() === String(active.path || '').trim().toLowerCase())) {
    activeStores.unshift(active);
  }
  const candidate = raw?.active_candidate && typeof raw.active_candidate === 'object' ? raw.active_candidate : null;
  const archives = Array.isArray(raw?.archives) ? raw.archives : [];
  const activePrimary = activeStores[0] || active || null;
  const activeSizeMax = activeStores.length > 0
    ? Math.max(...activeStores.map((row) => Number(row?.size_bytes || 0)))
    : Number(activePrimary?.size_bytes || 0);
  return {
    status: String(pc?.outlook_status || raw?.status || 'unknown').toLowerCase(),
    confidence: String(pc?.outlook_confidence || raw?.confidence || 'low').toLowerCase(),
    source: String(raw?.source || 'none').toLowerCase(),
    activeSizeBytes: Number(pc?.outlook_active_size_bytes || activeSizeMax || 0),
    activePath: String(pc?.outlook_active_path || activePrimary?.path || '').trim(),
    totalSizeBytes: Number(pc?.outlook_total_size_bytes || raw?.total_outlook_size_bytes || 0),
    archivesCount: Number(pc?.outlook_archives_count || archives.length || 0),
    activeStoresCount: Number(pc?.outlook_active_stores_count || activeStores.length || 0),
    activeStore: activePrimary,
    activeStores,
    activeCandidate: candidate,
    archives,
  };
}

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function resolveLogicalDiskUsage(disk) {
  if (!disk || typeof disk !== 'object') return null;
  const totalGb = toFiniteNumber(disk.total_gb);
  const freeGb = toFiniteNumber(disk.free_gb);
  const percentRaw = toFiniteNumber(disk.percent);
  const percent = toPercent(percentRaw);
  let usedPercent = percent;
  let usedGb = null;

  if (totalGb !== null && freeGb !== null) {
    const safeTotal = Math.max(0, totalGb);
    const safeFree = Math.max(0, Math.min(safeTotal, freeGb));
    usedGb = Math.max(0, safeTotal - safeFree);
    if (safeTotal > 0 && usedPercent === null) {
      usedPercent = toPercent((usedGb / safeTotal) * 100);
    }
  }

  return {
    mountpoint: String(disk.mountpoint || disk.device || '').trim() || '-',
    fstype: String(disk.fstype || '-'),
    totalGb,
    freeGb,
    usedGb,
    usedPercent,
  };
}

function resolveCardDriveUsage(pc) {
  const disks = Array.isArray(pc?.logical_disks) ? pc.logical_disks : [];
  if (disks.length === 0) return null;
  const cDisk = disks.find((disk) => String(disk?.mountpoint || disk?.device || '').trim().toUpperCase().startsWith('C:'));
  const selected = cDisk || disks[0];
  const usage = resolveLogicalDiskUsage(selected);
  if (!usage) return null;
  return {
    ...usage,
    isFallback: !cDisk,
  };
}

function resolveOutlookArchiveUsage(outlookMeta) {
  const usedBytes = Math.max(0, Number(outlookMeta?.activeSizeBytes || 0));
  const usedGb = usedBytes / (1024 ** 3);
  const limitGb = OUTLOOK_ARCHIVE_LIMIT_BYTES / (1024 ** 3);
  const percent = toPercent((usedBytes / OUTLOOK_ARCHIVE_LIMIT_BYTES) * 100) || 0;
  return {
    usedBytes,
    usedGb,
    limitGb,
    percent,
  };
}

function resolveOutlookFiles(outlookMeta) {
  const active = Array.isArray(outlookMeta?.activeStores) ? outlookMeta.activeStores : [];
  const archives = Array.isArray(outlookMeta?.archives) ? outlookMeta.archives : [];
  const rows = [];

  active.forEach((item) => {
    rows.push({
      kind: 'active',
      path: String(item?.path || '').trim(),
      sizeBytes: Number(item?.size_bytes || 0),
      lastModifiedAt: item?.last_modified_at || null,
      type: String(item?.type || ''),
    });
  });

  if (rows.length === 0 && outlookMeta?.activeCandidate?.path) {
    rows.push({
      kind: 'active',
      path: String(outlookMeta.activeCandidate.path || '').trim(),
      sizeBytes: Number(outlookMeta.activeCandidate.size_bytes || 0),
      lastModifiedAt: outlookMeta.activeCandidate.last_modified_at || null,
      type: String(outlookMeta.activeCandidate.type || ''),
    });
  }

  archives.forEach((item) => {
    rows.push({
      kind: 'archive',
      path: String(item?.path || '').trim(),
      sizeBytes: Number(item?.size_bytes || 0),
      lastModifiedAt: item?.last_modified_at || null,
      type: String(item?.type || ''),
    });
  });

  const unique = [];
  const seen = new Set();
  rows.forEach((row) => {
    if (!row.path) return;
    const key = `${row.kind}:${row.path.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(row);
  });
  return unique;
}

function resolveUserProfileSizes(pc) {
  const raw = pc?.user_profile_sizes && typeof pc.user_profile_sizes === 'object' ? pc.user_profile_sizes : {};
  const profiles = Array.isArray(raw?.profiles)
    ? raw.profiles
      .filter((row) => row && typeof row === 'object')
      .map((row) => ({
        userName: String(row.user_name || '').trim(),
        profilePath: String(row.profile_path || '').trim(),
        totalSizeBytes: Number(row.total_size_bytes || 0),
        filesCount: Number(row.files_count || 0),
        dirsCount: Number(row.dirs_count || 0),
        errorsCount: Number(row.errors_count || 0),
        partial: Boolean(row.partial),
        partialReasons: Array.isArray(row.partial_reasons) ? row.partial_reasons.map((item) => String(item || '').trim()).filter(Boolean) : [],
        topLevelFolders: Array.isArray(row.top_level_folders)
          ? row.top_level_folders
            .filter((folder) => folder && typeof folder === 'object')
            .map((folder) => ({
              name: String(folder.name || '').trim(),
              path: String(folder.path || '').trim(),
              sizeBytes: Number(folder.size_bytes || 0),
              filesCount: Number(folder.files_count || 0),
              dirsCount: Number(folder.dirs_count || 0),
              errorsCount: Number(folder.errors_count || 0),
              partial: Boolean(folder.partial),
              partialReasons: Array.isArray(folder.partial_reasons) ? folder.partial_reasons.map((item) => String(item || '').trim()).filter(Boolean) : [],
            }))
          : [],
      }))
    : [];
  profiles.sort((left, right) => right.totalSizeBytes - left.totalSizeBytes);
  const totalSizeBytes = Number(raw?.total_size_bytes || profiles.reduce((sum, row) => sum + row.totalSizeBytes, 0));
  return {
    collectedAt: Number(raw?.collected_at || 0),
    profilesCount: Number(raw?.profiles_count || profiles.length),
    totalSizeBytes,
    profiles,
    partial: Boolean(raw?.partial) || profiles.some((row) => row.partial),
    partialReasons: Array.isArray(raw?.partial_reasons) ? raw.partial_reasons.map((item) => String(item || '').trim()).filter(Boolean) : [],
  };
}

function pcChangeKey(pc) {
  const mac = String(pc?.mac_address || '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (mac) return `mac:${mac}`;
  const host = String(pc?.hostname || '').trim().toLowerCase();
  return `host:${host}`;
}

function readSeenChangesMap() {
  try {
    const raw = localStorage.getItem(SEEN_CHANGES_STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return {};
    return data;
  } catch {
    return {};
  }
}

function summarizeChangeEvent(event) {
  const diff = event?.diff && typeof event.diff === 'object' ? event.diff : {};
  const lines = [];

  if (diff.system && typeof diff.system === 'object') {
    const before = diff.system.before || {};
    const after = diff.system.after || {};
    if ((before.cpu_model || '') !== (after.cpu_model || '')) {
      lines.push(`CPU: "${before.cpu_model || '-'}" -> "${after.cpu_model || '-'}"`);
    }
    if (Number(before.ram_gb || 0) !== Number(after.ram_gb || 0)) {
      lines.push(`RAM: ${before.ram_gb || '-'} -> ${after.ram_gb || '-'}`);
    }
    if ((before.system_serial || '') !== (after.system_serial || '')) {
      lines.push(`S/N BIOS: "${before.system_serial || '-'}" -> "${after.system_serial || '-'}"`);
    }
  }

  const summarizeSet = (name, beforeRaw, afterRaw) => {
    const before = Array.isArray(beforeRaw) ? beforeRaw : [];
    const after = Array.isArray(afterRaw) ? afterRaw : [];
    const added = after.filter((item) => !before.includes(item));
    const removed = before.filter((item) => !after.includes(item));
    if (added.length === 0 && removed.length === 0) {
      if (before.length !== after.length) {
        lines.push(`${name}: ${before.length} -> ${after.length}`);
      }
      return;
    }
    if (added.length > 0) lines.push(`${name}: добавлено ${added.length}`);
    if (removed.length > 0) lines.push(`${name}: убрано ${removed.length}`);
  };

  if (diff.monitors && typeof diff.monitors === 'object') {
    summarizeSet('Мониторы', diff.monitors.before, diff.monitors.after);
  }
  if (diff.storage && typeof diff.storage === 'object') {
    summarizeSet('Накопители', diff.storage.before, diff.storage.after);
  }

  if (lines.length === 0) {
    const types = Array.isArray(event?.change_types) ? event.change_types.join(', ') : '-';
    return [`Изменения: ${types}`];
  }
  return lines;
}

function Computers() {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const { hasPermission } = useAuth();
  const canViewAllComputers = hasPermission('computers.read_all');

  const [computers, setComputers] = useState([]);
  const [changes, setChanges] = useState({ totals: {}, daily: [] });
  const [loading, setLoading] = useState(true);
  const [autoLoadingMore, setAutoLoadingMore] = useState(false);
  const [selected, setSelected] = useState(null);
  const [open, setOpen] = useState(false);

  const [q, setQ] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchFields, setSearchFields] = useState(DEFAULT_COMPUTER_SEARCH_FIELDS);
  const [searchMeta, setSearchMeta] = useState({ total: 0, limit: COMPUTERS_PAGE_SIZE, offset: 0, has_more: false, next_offset: null });
  const [searchSummary, setSearchSummary] = useState(null);
  const [status, setStatus] = useState('all');
  const [outlookStatus, setOutlookStatus] = useState('all');
  const [branch, setBranch] = useState('all');
  const [changedOnly, setChangedOnly] = useState(false);
  const [showAllComputers, setShowAllComputers] = useState(false);
  const [showDashboard, setShowDashboard] = useState(() => localStorage.getItem('computers_show_dashboard') !== '0');
  const [showLocation, setShowLocation] = useState(() => localStorage.getItem('computers_show_location') !== '0');
  const [hideSystemUserProfileFolders, setHideSystemUserProfileFolders] = useState(() => localStorage.getItem(USER_PROFILE_HIDE_SYSTEM_FOLDERS_STORAGE_KEY) === '1');
  const [expandedLocations, setExpandedLocations] = useState({});
  const [expandedUserProfiles, setExpandedUserProfiles] = useState({});
  const [seenChangesByPc, setSeenChangesByPc] = useState(() => readSeenChangesMap());

  const inFlightRef = useRef(false);
  const pollTimerRef = useRef(null);
  const autoLoadTimerRef = useRef(null);
  const loadedCountRef = useRef(0);
  const retryDelaySecRef = useRef(AUTO_REFRESH_BASE_SEC);
  const hasInitializedRef = useRef(false);

  const scope = canViewAllComputers && showAllComputers ? 'all' : 'selected';

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const clearAutoLoadTimer = useCallback(() => {
    if (autoLoadTimerRef.current) {
      clearTimeout(autoLoadTimerRef.current);
      autoLoadTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(String(q || '').trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);

  const getBackgroundRefreshLimit = useCallback(() => {
    const loadedCount = Number(loadedCountRef.current || 0);
    return Math.min(500, loadedCount || COMPUTERS_PAGE_SIZE);
  }, []);

  const load = useCallback(async ({ withLoader = false, append = false, offset = 0, limit = COMPUTERS_PAGE_SIZE } = {}) => {
    if (inFlightRef.current) return false;
    inFlightRef.current = true;
    try {
      if (withLoader) setLoading(true);
      if (append) setAutoLoadingMore(true);
      const [pcPayload, changeData] = await Promise.all([
        equipmentAPI.searchAgentComputers({
          scope,
          branch: branch !== 'all' ? branch : undefined,
          status: status !== 'all' ? status : undefined,
          outlookStatus: outlookStatus !== 'all' ? outlookStatus : undefined,
          q: debouncedQuery || undefined,
          searchFields,
          changedOnly,
          sortBy: 'hostname',
          sortDir: 'asc',
          limit,
          offset,
          includeSummary: !append,
        }),
        append ? Promise.resolve(null) : equipmentAPI.getAgentComputerChanges(50),
      ]);
      const items = Array.isArray(pcPayload?.items) ? pcPayload.items : (Array.isArray(pcPayload) ? pcPayload : []);
      setComputers((prev) => {
        const next = append ? [...prev, ...items] : items;
        loadedCountRef.current = next.length;
        return next;
      });
      setSearchMeta({
        total: Number(pcPayload?.total ?? items.length) || 0,
        limit: Number(pcPayload?.limit ?? limit) || limit,
        offset: Number(pcPayload?.offset ?? offset) || 0,
        has_more: Boolean(pcPayload?.has_more),
        next_offset: pcPayload?.next_offset ?? null,
      });
      setSearchSummary((prev) => (pcPayload?.summary && typeof pcPayload.summary === 'object' ? pcPayload.summary : (append ? prev : null)));
      setChanges((prev) => (changeData && typeof changeData === 'object' ? changeData : (append ? prev : { totals: {}, daily: [] })));
      retryDelaySecRef.current = AUTO_REFRESH_BASE_SEC;
      return true;
    } catch (err) {
      console.error('Computers load failed', err);
      retryDelaySecRef.current = Math.min(retryDelaySecRef.current + AUTO_REFRESH_STEP_SEC, AUTO_REFRESH_MAX_SEC);
      return false;
    } finally {
      if (withLoader) setLoading(false);
      if (append) setAutoLoadingMore(false);
      inFlightRef.current = false;
    }
  }, [branch, changedOnly, debouncedQuery, outlookStatus, scope, searchFields, status]);

  const scheduleNextPoll = useCallback((delaySec) => {
    clearPollTimer();
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const nextDelaySec = Number.isFinite(Number(delaySec)) ? Number(delaySec) : retryDelaySecRef.current;
    pollTimerRef.current = setTimeout(async () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        clearPollTimer();
        return;
      }
      await load({ withLoader: false, append: false, offset: 0, limit: getBackgroundRefreshLimit() });
      scheduleNextPoll(retryDelaySecRef.current);
    }, Math.max(1, nextDelaySec) * 1000);
  }, [clearPollTimer, getBackgroundRefreshLimit, load]);

  const handleManualRefresh = useCallback(async () => {
    await load({ withLoader: true, append: false, offset: 0, limit: getBackgroundRefreshLimit() });
    scheduleNextPoll(retryDelaySecRef.current);
  }, [getBackgroundRefreshLimit, load, scheduleNextPoll]);

  useEffect(() => {
    clearAutoLoadTimer();
    if (loading || autoLoadingMore || !searchMeta.has_more) return undefined;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return undefined;
    const nextOffset = Number(searchMeta.next_offset ?? computers.length);
    if (!Number.isFinite(nextOffset) || nextOffset < 0 || nextOffset <= 0) return undefined;
    autoLoadTimerRef.current = setTimeout(() => {
      load({ withLoader: false, append: true, offset: nextOffset });
    }, 250);
    return clearAutoLoadTimer;
  }, [autoLoadingMore, clearAutoLoadTimer, computers.length, load, loading, searchMeta.has_more, searchMeta.next_offset]);

  const toggleSearchField = useCallback((fieldKey) => {
    setSearchFields((prev) => {
      const current = Array.isArray(prev) ? prev : DEFAULT_COMPUTER_SEARCH_FIELDS;
      if (current.includes(fieldKey)) {
        const next = current.filter((item) => item !== fieldKey);
        return next.length > 0 ? next : current;
      }
      return [...current, fieldKey];
    });
  }, []);

  useEffect(() => {
    let isActive = true;
    const init = async () => {
      await load({ withLoader: !hasInitializedRef.current });
      if (!isActive) return;
      hasInitializedRef.current = true;
      scheduleNextPoll(AUTO_REFRESH_BASE_SEC);
    };
    init();
    return () => {
      isActive = false;
      clearPollTimer();
      clearAutoLoadTimer();
    };
  }, [clearAutoLoadTimer, clearPollTimer, load, scheduleNextPoll]);

  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'visible') {
        clearPollTimer();
        return;
      }
      await load({ withLoader: false, append: false, offset: 0, limit: getBackgroundRefreshLimit() });
      scheduleNextPoll(retryDelaySecRef.current);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [clearPollTimer, getBackgroundRefreshLimit, load, scheduleNextPoll]);

  useEffect(() => {
    const reloadAfterDbSwitch = async () => {
      // If auto-refresh request is in-flight, wait briefly and then reload for the new DB.
      let guard = 0;
      while (inFlightRef.current && guard < 30) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 150));
        guard += 1;
      }
      setSelected(null);
      setOpen(false);
      loadedCountRef.current = 0;
      await load({ withLoader: true, append: false, offset: 0, limit: COMPUTERS_PAGE_SIZE });
      scheduleNextPoll(AUTO_REFRESH_BASE_SEC);
    };

    const handleDatabaseChanged = async () => {
      await reloadAfterDbSwitch();
    };

    const handleStorage = async (event) => {
      if (event.key !== 'selected_database') return;
      await reloadAfterDbSwitch();
    };

    window.addEventListener('database-changed', handleDatabaseChanged);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('database-changed', handleDatabaseChanged);
      window.removeEventListener('storage', handleStorage);
    };
  }, [load, scheduleNextPoll]);

  useEffect(() => {
    localStorage.setItem('computers_show_dashboard', showDashboard ? '1' : '0');
  }, [showDashboard]);

  useEffect(() => {
    localStorage.setItem('computers_show_location', showLocation ? '1' : '0');
  }, [showLocation]);

  useEffect(() => {
    localStorage.setItem(USER_PROFILE_HIDE_SYSTEM_FOLDERS_STORAGE_KEY, hideSystemUserProfileFolders ? '1' : '0');
  }, [hideSystemUserProfileFolders]);

  useEffect(() => {
    if (canViewAllComputers) return;
    setShowAllComputers(false);
  }, [canViewAllComputers]);

  useEffect(() => {
    if (!selected) return;
    const currentKey = pcChangeKey(selected);
    const nextSelected = computers.find((pc) => pcChangeKey(pc) === currentKey);
    if (nextSelected) {
      if (nextSelected !== selected) {
        setSelected(nextSelected);
      }
      return;
    }
    setSelected(null);
    setOpen(false);
  }, [computers, selected]);

  useEffect(() => {
    if (!open) {
      setExpandedUserProfiles({});
    }
  }, [open]);

  useEffect(() => {
    localStorage.setItem(SEEN_CHANGES_STORAGE_KEY, JSON.stringify(seenChangesByPc));
  }, [seenChangesByPc]);

  const hasUnseenChanges = (pc) => {
    const lastTs = Number(pc?.last_change_at || 0);
    if (!lastTs) return false;
    const seenTs = Number(seenChangesByPc?.[pcChangeKey(pc)] || 0);
    return lastTs > seenTs;
  };

  const markPcChangesSeen = (pc) => {
    const ts = Number(pc?.last_change_at || 0);
    if (!ts) return;
    const key = pcChangeKey(pc);
    setSeenChangesByPc((prev) => {
      const current = Number(prev?.[key] || 0);
      if (current >= ts) return prev;
      return { ...(prev || {}), [key]: ts };
    });
  };

  const markAllChangesSeen = () => {
    const next = { ...(seenChangesByPc || {}) };
    computers.forEach((pc) => {
      const ts = Number(pc?.last_change_at || 0);
      if (!pc?.has_hardware_changes || !ts) return;
      next[pcChangeKey(pc)] = Math.max(Number(next[pcChangeKey(pc)] || 0), ts);
    });
    setSeenChangesByPc(next);
  };

  const branches = useMemo(() => {
    const summaryBranches = searchSummary?.branches && typeof searchSummary.branches === 'object'
      ? Object.keys(searchSummary.branches)
      : [];
    const uniq = new Set([
      ...summaryBranches,
      ...computers.map((pc) => String(pc.branch_name || 'Без филиала').trim() || 'Без филиала'),
    ]);
    if (branch !== 'all') {
      uniq.add(branch);
    }
    return Array.from(uniq).sort((a, b) => a.localeCompare(b, 'ru'));
  }, [branch, computers, searchSummary]);

  const filtered = computers;

  const grouped = useMemo(() => {
    const branchBuckets = {};
    filtered.forEach((pc) => {
      const branchName = String(pc.branch_name || 'Без филиала').trim() || 'Без филиала';
      const locationName = showLocation
        ? (String(pc.location_name || pc.network_link?.site_name || 'Без местоположения').trim() || 'Без местоположения')
        : 'Все компьютеры';

      if (!branchBuckets[branchName]) {
        branchBuckets[branchName] = { branchName, locations: {} };
      }
      if (!branchBuckets[branchName].locations[locationName]) {
        branchBuckets[branchName].locations[locationName] = { locationName, items: [] };
      }
      branchBuckets[branchName].locations[locationName].items.push(pc);
    });

    return Object.values(branchBuckets)
      .sort((a, b) => a.branchName.localeCompare(b.branchName, 'ru'))
      .map((branchGroup) => ({
        ...branchGroup,
        locations: Object.values(branchGroup.locations).sort((a, b) => a.locationName.localeCompare(b.locationName, 'ru')),
      }));
  }, [filtered, showLocation]);

  const statusRows = useMemo(() => {
    const summaryStatuses = searchSummary?.statuses && typeof searchSummary.statuses === 'object' ? searchSummary.statuses : null;
    const map = summaryStatuses ? { ...summaryStatuses } : { online: 0, stale: 0, offline: 0, unknown: 0 };
    if (!summaryStatuses) {
      filtered.forEach((pc) => {
        const key = String(pc.status || 'unknown').toLowerCase();
        map[key] = (map[key] || 0) + 1;
      });
    }
    return [
      { label: 'В сети', value: map.online || 0 },
      { label: 'Нет свежих', value: map.stale || 0 },
      { label: 'Оффлайн', value: map.offline || 0 },
      { label: 'Неизвестно', value: map.unknown || 0 },
    ];
  }, [filtered, searchSummary]);

  const branchRows = useMemo(() => {
    const counters = searchSummary?.branches && typeof searchSummary.branches === 'object' ? searchSummary.branches : {};
    const nextCounters = Object.keys(counters).length > 0 ? { ...counters } : {};
    if (Object.keys(nextCounters).length === 0) {
      filtered.forEach((pc) => {
        const name = String(pc.branch_name || 'Без филиала').trim() || 'Без филиала';
        nextCounters[name] = (nextCounters[name] || 0) + 1;
      });
    }
    return Object.entries(nextCounters)
      .sort((a, b) => a[0].localeCompare(b[0], 'ru'))
      .map(([label, value]) => ({ label, value }));
  }, [filtered, searchSummary]);

  const changeRows = useMemo(() => {
    const daily = Array.isArray(changes.daily) ? changes.daily : [];
    return daily.map((row) => ({ label: String(row.date || '').slice(5), value: Number(row.count || 0) }));
  }, [changes.daily]);

  const totals = changes.totals || {};
  const unseenChangedPcs = useMemo(() => {
    return computers.filter((pc) => {
      if (!pc?.has_hardware_changes) return false;
      return hasUnseenChanges(pc);
    });
  }, [computers, seenChangesByPc]);
  const selectedRuntime = useMemo(() => resolveRuntimeMetrics(selected), [selected]);
  const selectedStorageStats = useMemo(() => getStorageHealthStats(selected), [selected]);
  const selectedOutlook = useMemo(() => resolveOutlookMeta(selected), [selected]);
  const selectedDriveUsage = useMemo(() => resolveCardDriveUsage(selected), [selected]);
  const selectedOutlookUsage = useMemo(() => resolveOutlookArchiveUsage(selectedOutlook), [selectedOutlook]);
  const selectedOutlookFiles = useMemo(() => resolveOutlookFiles(selectedOutlook), [selectedOutlook]);
  const selectedUserProfileSizes = useMemo(() => resolveUserProfileSizes(selected), [selected]);
  const toggleLocationGroup = useCallback((branchName, locationName) => {
    const key = `${branchName}__${locationName}`;
    setExpandedLocations((prev) => ({ ...(prev || {}), [key]: !Boolean(prev?.[key]) }));
  }, []);
  const toggleUserProfileFolders = useCallback((profileKey) => {
    setExpandedUserProfiles((prev) => ({ ...(prev || {}), [profileKey]: !Boolean(prev?.[profileKey]) }));
  }, []);

  return (
    <MainLayout title="Компьютеры (Агенты)">
      <PageShell sx={{ width: '100%', pb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>Дашборд компьютеров</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {canViewAllComputers && (
              <FormControlLabel
                sx={{ m: 0 }}
                control={<Switch checked={showAllComputers} onChange={(e) => setShowAllComputers(e.target.checked)} />}
                label={showAllComputers ? 'Все БД' : 'Текущая БД'}
              />
            )}
            <FormControlLabel
              sx={{ m: 0 }}
              control={<Switch checked={showLocation} onChange={(e) => setShowLocation(e.target.checked)} />}
              label={showLocation ? 'Скрыть местоположение' : 'Показать местоположение'}
            />
            <FormControlLabel
              sx={{ m: 0 }}
              control={<Switch checked={showDashboard} onChange={(e) => setShowDashboard(e.target.checked)} />}
              label={showDashboard ? 'Скрыть дашборд' : 'Показать дашборд'}
            />
            <Tooltip title="Обновить данные">
              <span>
                <IconButton aria-label="Обновить данные" onClick={handleManualRefresh} disabled={loading} color="primary">
                  <RefreshIcon />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        </Box>

        {!loading && unseenChangedPcs.length > 0 && (
          <Alert severity="warning" icon={<WarningAmberIcon fontSize="inherit" />} sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.8 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Новые изменения оборудования на ПК: {unseenChangedPcs.length}
              </Typography>
              <Typography variant="body2">
                {unseenChangedPcs.slice(0, 8).map((pc) => pc.hostname || 'Неизвестный ПК').join(', ')}
                {unseenChangedPcs.length > 8 ? ` и еще ${unseenChangedPcs.length - 8}` : ''}
              </Typography>
              <Box>
                <Button size="small" variant="outlined" color="warning" onClick={markAllChangesSeen}>
                  Отметить все как просмотренные
                </Button>
              </Box>
              <Typography variant="caption" color="text.secondary">
                24ч: {Number(totals.changed_24h || 0)} · 7д: {Number(totals.changed_7d || 0)} · 30д: {Number(totals.changed_30d || 0)}
              </Typography>
            </Box>
          </Alert>
        )}

        {showDashboard && (
          <>
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={12} sm={6} md={3}>
                <StatCard title="Всего ПК" value={Number(searchSummary?.total ?? searchMeta.total ?? filtered.length)} helper="по текущим фильтрам" />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <StatCard title="В сети" value={statusRows[0]?.value || 0} helper="heartbeat до 12 минут" color="success.main" />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <StatCard title="Оффлайн" value={statusRows[2]?.value || 0} helper="более 60 минут" color="error.main" />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <StatCard title="С изменениями" value={Number(totals.changed_30d || 0)} helper="уникальные ПК за 30 дней" color="warning.main" />
              </Grid>
            </Grid>

            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={12} md={4}><MiniBars title="Статусы" rows={statusRows} color="#2e7d32" /></Grid>
              <Grid item xs={12} md={4}><MiniBars title="Филиалы" rows={branchRows} color="#1565c0" /></Grid>
              <Grid item xs={12} md={4}><MiniBars title="Изменения по дням" rows={changeRows} color="#ed6c02" /></Grid>
            </Grid>
          </>
        )}

        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Grid container spacing={2}>
            <Grid item xs={12} md={4}>
              <TextField
                size="small"
                fullWidth
                label="Поиск"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ПК, ФИО, профиль, PST/OST, IP, MAC"
              />
            </Grid>
            <Grid item xs={12} md={8}>
              <Stack direction="row" spacing={0.8} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                  Искать в
                </Typography>
                {COMPUTER_SEARCH_FIELD_OPTIONS.map((option) => {
                  const active = searchFields.includes(option.key);
                  return (
                    <Chip
                      key={option.key}
                      size="small"
                      clickable
                      color={active ? 'primary' : 'default'}
                      variant={active ? 'filled' : 'outlined'}
                      label={option.label}
                      onClick={() => toggleSearchField(option.key)}
                      sx={{ height: 26 }}
                    />
                  );
                })}
              </Stack>
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Статус</InputLabel>
                <Select value={status} label="Статус" onChange={(e) => setStatus(e.target.value)}>
                  <MenuItem value="all">Все</MenuItem>
                  <MenuItem value="online">В сети</MenuItem>
                  <MenuItem value="stale">Нет свежих</MenuItem>
                  <MenuItem value="offline">Оффлайн</MenuItem>
                  <MenuItem value="unknown">Неизвестно</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Outlook</InputLabel>
                <Select value={outlookStatus} label="Outlook" onChange={(e) => setOutlookStatus(e.target.value)}>
                  <MenuItem value="all">Все</MenuItem>
                  <MenuItem value="ok">OK</MenuItem>
                  <MenuItem value="warning">Предупреждение</MenuItem>
                  <MenuItem value="critical">Критично</MenuItem>
                  <MenuItem value="unknown">Неизвестно</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel>Филиал</InputLabel>
                <Select value={branch} label="Филиал" onChange={(e) => setBranch(e.target.value)}>
                  <MenuItem value="all">Все</MenuItem>
                  {branches.map((branchName) => (
                    <MenuItem key={branchName} value={branchName}>{branchName}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={1}>
              <FormControlLabel
                control={<Switch checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} />}
                label="Изменения"
              />
            </Grid>
          </Grid>
        </Paper>

        {loading ? (
          <Box sx={{ py: 8, display: 'flex', justifyContent: 'center' }}><CircularProgress /></Box>
        ) : grouped.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}><Typography color="text.secondary">Нет данных по выбранным фильтрам.</Typography></Paper>
        ) : (
          <Stack spacing={1.5}>
            {grouped.map((branchGroup) => (
              <Paper key={branchGroup.branchName} variant="outlined" sx={{ p: 1.2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{branchGroup.branchName}</Typography>
                  <Chip
                    size="small"
                    label={`${branchGroup.locations.reduce((acc, location) => acc + location.items.length, 0)} ПК`}
                  />
                </Box>

                <Stack spacing={1}>
                  {branchGroup.locations.map((locationGroup) => {
                    const locationKey = `${branchGroup.branchName}__${locationGroup.locationName}`;
                    const isExpanded = Boolean(expandedLocations[locationKey]);
                    return (
                      <Paper key={locationKey} variant="outlined" sx={{ p: 1 }}>
                        <Box
                          onClick={() => toggleLocationGroup(branchGroup.branchName, locationGroup.locationName)}
                          sx={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            cursor: 'pointer',
                            userSelect: 'none',
                          }}
                        >
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {locationGroup.locationName}
                          </Typography>
                          <Chip size="small" label={isExpanded ? `Скрыть (${locationGroup.items.length})` : `Показать (${locationGroup.items.length})`} />
                        </Box>

                        <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                          <Grid container spacing={1.2} sx={{ mt: 0.5 }}>
                            {locationGroup.items.map((pc, idx) => {
                              const net = pc.network_link || {};
                              const storageStats = getStorageHealthStats(pc);
                              const outlookMeta = resolveOutlookMeta(pc);
                              const driveUsage = resolveCardDriveUsage(pc);
                              const outlookUsage = resolveOutlookArchiveUsage(outlookMeta);
                              return (
                                <Grid item xs={12} sm={6} md={4} lg={3} xl={2} key={`${pc.mac_address || pc.hostname || idx}`}>
                                  <Paper
                                    variant="outlined"
                                    onClick={() => {
                                      markPcChangesSeen(pc);
                                      setExpandedUserProfiles({});
                                      setSelected(pc);
                                      setOpen(true);
                                    }}
                                    sx={{
                                      ...getOfficePanelSx(ui, {
                                        p: 1.1,
                                        height: '100%',
                                        cursor: 'pointer',
                                        boxShadow: 'none',
                                        '&:hover': {
                                          borderColor: ui.borderStrong,
                                          bgcolor: ui.panelBg,
                                          boxShadow: 'none',
                                        },
                                      }),
                                    }}
                                  >
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.7 }}>
                                      <Typography variant="subtitle2" sx={{ fontWeight: 700, pr: 1, lineHeight: 1.25, wordBreak: 'break-word' }}>
                                        {pc.hostname || 'Неизвестный ПК'}
                                      </Typography>
                                      <Chip size="small" color={statusColor(pc.status)} label={statusLabel(pc.status)} />
                                    </Box>

                                    <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', wordBreak: 'break-word' }}>
                                      {pc.user_full_name || 'ФИО не определено'}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.7, wordBreak: 'break-word' }}>
                                      {pc.user_login || pc.current_user || '-'}
                                    </Typography>

                                    <Stack spacing={0.35} sx={{ mb: 0.75 }}>
                                      <Typography variant="caption" sx={{ display: 'block', wordBreak: 'break-word' }}>IP: <b>{resolvePcIp(pc) || '-'}</b></Typography>
                                      <Typography variant="caption" sx={{ display: 'block', wordBreak: 'break-word' }}>MAC: <b>{pc.mac_address || '-'}</b></Typography>
                                      <Typography variant="caption" sx={{ display: 'block', wordBreak: 'break-word' }}>БД: <b>{pc.database_name || pc.database_id || '-'}</b></Typography>
                                      <Typography variant="caption" sx={{ display: 'block' }}>Возраст: <b>{formatAge(pc.age_seconds)}</b></Typography>
                                    </Stack>

                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mb: 0.7 }}>
                                      <LanIcon fontSize="small" color="action" />
                                      <Typography variant="caption" color="text.secondary">
                                        {net.device_code ? `${net.device_code} / ${net.port_name || 'порт ?'} / ${net.socket_code || 'розетка ?'}` : 'Сетевое подключение не определено'}
                                      </Typography>
                                    </Box>

                                    <Box sx={{ mb: 0.8 }}>
                                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>
                                        {driveUsage
                                          ? `Хранилище ${driveUsage.mountpoint}: ${driveUsage.usedGb !== null ? `${driveUsage.usedGb.toFixed(1)} / ${driveUsage.totalGb?.toFixed(1) || '-'} ГБ` : `${driveUsage.usedPercent ?? 0}%`}${driveUsage.isFallback ? ' (по первому диску)' : ''}`
                                          : 'Хранилище C: нет данных'}
                                      </Typography>
                                      <LinearProgress
                                        variant="determinate"
                                        value={driveUsage?.usedPercent ?? 0}
                                        color={(driveUsage?.usedPercent ?? 0) >= 90 ? 'error' : ((driveUsage?.usedPercent ?? 0) >= 75 ? 'warning' : 'primary')}
                                        sx={{ height: 6, borderRadius: 4 }}
                                      />
                                    </Box>

                                    {storageStats.total > 0 && (
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mb: 0.7 }}>
                                        <StorageIcon fontSize="small" color="action" />
                                        <Typography variant="caption" color="text.secondary">
                                          SMART: дисков {storageStats.total}, проблемных {storageStats.problemCount}
                                        </Typography>
                                      </Box>
                                    )}

                                    <Box sx={{ mb: 0.8 }}>
                                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.8, mb: 0.25 }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, minWidth: 0 }}>
                                          <MailOutlineIcon fontSize="small" color="action" />
                                          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.25 }}>
                                            {`Макс. архив Outlook: ${outlookUsage.usedGb.toFixed(1)} / ${outlookUsage.limitGb.toFixed(0)} ГБ`}
                                          </Typography>
                                        </Box>
                                        <Chip size="small" color={outlookStatusColor(outlookMeta.status)} label={outlookStatusLabel(outlookMeta.status)} />
                                      </Box>
                                      <LinearProgress
                                        variant="determinate"
                                        value={outlookUsage.percent}
                                        color={outlookUsage.percent >= 100 ? 'error' : (outlookUsage.percent >= 85 ? 'warning' : 'success')}
                                        sx={{ height: 6, borderRadius: 4 }}
                                      />
                                    </Box>

                                    {pc.has_hardware_changes && (
                                      <Chip
                                        size="small"
                                        color={hasUnseenChanges(pc) ? 'warning' : 'default'}
                                        label={`Изменения: ${pc.changes_count_30d || 0}`}
                                      />
                                    )}
                                  </Paper>
                                </Grid>
                              );
                            })}
                          </Grid>
                        </Collapse>
                      </Paper>
                    );
                  })}
                </Stack>
              </Paper>
            ))}
            {searchMeta.has_more ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.8, py: 1 }}>
                <LinearProgress sx={{ width: { xs: '100%', sm: 360 }, maxWidth: '100%' }} />
                <Typography variant="caption" color="text.secondary">
                  Подгружаю остальные ПК: {computers.length} из {searchMeta.total}
                </Typography>
              </Box>
            ) : searchMeta.total > computers.length ? (
              <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center', py: 1 }}>
                Показано {computers.length} из {searchMeta.total}
              </Typography>
            ) : null}
          </Stack>
        )}

        <Drawer anchor="right" open={open} onClose={() => setOpen(false)}>
          <Box sx={{ width: { xs: '100vw', sm: 560 }, maxWidth: '100vw', p: { xs: 2, sm: 2.5 }, bgcolor: 'background.default', height: '100%', overflowY: 'auto' }}>
            {!selected ? null : (
              <Stack spacing={1.4}>
                <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
                  <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.6 }}>
                    {selected.hostname || 'Неизвестный ПК'}
                  </Typography>
                  <Stack direction="row" spacing={0.8} flexWrap="wrap" useFlexGap sx={{ mb: 0.7 }}>
                    <Chip size="small" color={statusColor(selected.status)} label={statusLabel(selected.status)} />
                    <Chip size="small" color={outlookStatusColor(selectedOutlook.status)} label={`Outlook: ${outlookStatusLabel(selectedOutlook.status)}`} />
                    {selected.has_hardware_changes && hasUnseenChanges(selected) ? (
                      <Chip size="small" color="warning" label="Есть изменения" />
                    ) : null}
                  </Stack>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.8 }}>
                    Последняя активность: {formatTs(selected.last_seen_at || selected.timestamp)} · Возраст: {formatAge(selected.age_seconds)}
                  </Typography>
                  <Stack spacing={0.65}>
                    <Box>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.2 }}>
                        {selectedDriveUsage
                          ? `Хранилище ${selectedDriveUsage.mountpoint}: ${selectedDriveUsage.usedGb !== null ? `${selectedDriveUsage.usedGb.toFixed(1)} / ${selectedDriveUsage.totalGb?.toFixed(1) || '-'} ГБ` : `${selectedDriveUsage.usedPercent ?? 0}%`}${selectedDriveUsage.isFallback ? ' (по первому диску)' : ''}`
                          : 'Хранилище C: нет данных'}
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        value={selectedDriveUsage?.usedPercent ?? 0}
                        color={(selectedDriveUsage?.usedPercent ?? 0) >= 90 ? 'error' : ((selectedDriveUsage?.usedPercent ?? 0) >= 75 ? 'warning' : 'primary')}
                        sx={{ height: 6, borderRadius: 3 }}
                      />
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.2 }}>
                        {`Макс. архив Outlook: ${selectedOutlookUsage.usedGb.toFixed(1)} / ${selectedOutlookUsage.limitGb.toFixed(0)} ГБ`}
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        value={selectedOutlookUsage.percent}
                        color={selectedOutlookUsage.percent >= 100 ? 'error' : (selectedOutlookUsage.percent >= 85 ? 'warning' : 'success')}
                        sx={{ height: 6, borderRadius: 3 }}
                      />
                    </Box>
                  </Stack>
                </Paper>

                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Пользователь и сеть</Typography>
                <Paper variant="outlined" sx={{ p: 1.4 }}>
                  <Typography variant="body2">ФИО: {selected.user_full_name || '-'}</Typography>
                  <Typography variant="body2">Логин: {selected.user_login || selected.current_user || '-'}</Typography>
                  <Typography variant="body2">IP: {resolvePcIp(selected) || '-'}</Typography>
                  <Typography variant="body2">MAC: {selected.mac_address || '-'}</Typography>
                  <Typography variant="body2">Филиал: {selected.branch_name || '-'}</Typography>
                  <Typography variant="body2">Местоположение: {selected.location_name || selected.network_link?.site_name || '-'}</Typography>
                  <Typography variant="body2">База: {selected.database_name || selected.database_id || '-'}</Typography>
                  <Typography variant="body2">
                    Подключение: {selected.network_link?.device_code ? `${selected.network_link.device_code} / ${selected.network_link.port_name || 'порт ?'} / ${selected.network_link.socket_code || 'розетка ?'}` : 'не определено'}
                  </Typography>
                </Paper>

                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Профили пользователей</Typography>
                <Paper variant="outlined" sx={{ p: 1.4 }}>
                  <Stack spacing={0.9}>
                    <Stack direction="row" spacing={0.8} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Chip size="small" label={`Всего: ${formatBytesCompact(selectedUserProfileSizes.totalSizeBytes)}`} />
                      <Chip size="small" variant="outlined" label={`Профилей: ${selectedUserProfileSizes.profilesCount}`} />
                      {selectedUserProfileSizes.partial && (
                        <Tooltip title={USER_PROFILE_PARTIAL_HINT}>
                          <Chip size="small" color="warning" label="Расчет не полный" />
                        </Tooltip>
                      )}
                      <Typography variant="caption" color="text.secondary">
                        Обновлено: {selectedUserProfileSizes.collectedAt ? formatTs(selectedUserProfileSizes.collectedAt) : '-'}
                      </Typography>
                      <FormControlLabel
                        control={(
                          <Switch
                            size="small"
                            checked={hideSystemUserProfileFolders}
                            onChange={(event) => setHideSystemUserProfileFolders(event.target.checked)}
                          />
                        )}
                        label={(
                          <Tooltip describeChild title="Скрывает AppData, dot-папки и служебные каталоги профиля только в интерфейсе">
                            <Typography variant="caption" component="span">Скрыть системные</Typography>
                          </Tooltip>
                        )}
                        sx={{ ml: 0, mr: 0 }}
                      />
                    </Stack>
                    {selectedUserProfileSizes.profiles.length > 0 ? (
                      <Stack spacing={0.7}>
                        {selectedUserProfileSizes.profiles.slice(0, 8).map((profile, idx) => {
                          const profileKey = getUserProfileKey(profile, idx);
                          const foldersExpanded = Boolean(expandedUserProfiles[profileKey]);
                          const visibleFolders = getUserProfileFolders(profile, hideSystemUserProfileFolders);
                          const folderSummary = formatUserProfileFolderSummary(profile, hideSystemUserProfileFolders);
                          const allFolderCount = profile.topLevelFolders.length;
                          const folderCount = visibleFolders.length;
                          const hiddenSystemFolderCount = Math.max(0, allFolderCount - folderCount);
                          const folderButtonCount = hiddenSystemFolderCount > 0 ? `${folderCount} из ${allFolderCount}` : String(allFolderCount);
                          return (
                            <Paper key={profileKey} variant="outlined" sx={{ p: 0.85 }}>
                              <Stack spacing={0.8}>
                                <Stack direction="row" spacing={0.9} justifyContent="space-between" alignItems="flex-start">
                                  <Box sx={{ minWidth: 0, flex: 1 }}>
                                    <Tooltip title={profile.profilePath || '-'}>
                                      <Typography variant="caption" sx={{ display: 'block', fontWeight: 700 }} noWrap>
                                        {profile.userName || profile.profilePath || '-'}
                                      </Typography>
                                    </Tooltip>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.1 }}>
                                      {profile.filesCount} файлов · {profile.dirsCount} папок{profile.errorsCount > 0 ? ` · ошибок: ${profile.errorsCount}` : ''}
                                    </Typography>
                                    {!!folderSummary && (
                                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.1 }} noWrap>
                                        {folderSummary}
                                      </Typography>
                                    )}
                                  </Box>
                                  <Stack alignItems="flex-end" spacing={0.3} sx={{ flexShrink: 0 }}>
                                    <Typography variant="caption" sx={{ fontWeight: 700 }}>{formatBytesCompact(profile.totalSizeBytes)}</Typography>
                                    {profile.partial && (
                                      <Tooltip title={USER_PROFILE_PARTIAL_HINT}>
                                        <Chip size="small" color="warning" label="Частично" sx={{ height: 22 }} />
                                      </Tooltip>
                                    )}
                                  </Stack>
                                </Stack>

                                {allFolderCount > 0 && (
                                  <Box>
                                    <Button
                                      type="button"
                                      size="small"
                                      variant="text"
                                      onClick={() => toggleUserProfileFolders(profileKey)}
                                      endIcon={foldersExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                                      aria-expanded={foldersExpanded}
                                      aria-controls={`profile-folders-${idx}`}
                                      sx={{ px: 0.2, py: 0.1, minHeight: 24, fontSize: '0.75rem' }}
                                    >
                                      {foldersExpanded ? 'Скрыть папки' : `${hideSystemUserProfileFolders ? 'Показать папки' : 'Показать все папки'} (${folderButtonCount})`}
                                    </Button>
                                    <Collapse in={foldersExpanded} timeout="auto" unmountOnExit>
                                      <Box id={`profile-folders-${idx}`} sx={{ mt: 0.7, borderTop: 1, borderColor: 'divider' }}>
                                        {hiddenSystemFolderCount > 0 && (
                                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', py: 0.7 }}>
                                            Скрыто системных: {hiddenSystemFolderCount}
                                          </Typography>
                                        )}
                                        {folderCount === 0 ? (
                                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', py: 0.7 }}>
                                            Все папки скрыты фильтром.
                                          </Typography>
                                        ) : visibleFolders.map((folder, folderIdx) => {
                                          const share = getUserProfileFolderShare(folder, profile);
                                          return (
                                            <Box
                                              key={`${folder.path || folder.name || folderIdx}`}
                                              sx={{
                                                py: 0.75,
                                                borderBottom: folderIdx === visibleFolders.length - 1 ? 0 : 1,
                                                borderColor: 'divider',
                                              }}
                                            >
                                              <Stack direction="row" spacing={0.9} justifyContent="space-between" alignItems="flex-start">
                                                <Box sx={{ minWidth: 0, flex: 1 }}>
                                                  <Tooltip title={folder.path || folder.name || '-'}>
                                                    <Typography variant="caption" sx={{ display: 'block', fontWeight: 700 }} noWrap>
                                                      {formatUserProfileFolderName(folder.name)}
                                                    </Typography>
                                                  </Tooltip>
                                                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                                    {folder.filesCount || 0} файлов · {folder.dirsCount || 0} папок{folder.errorsCount > 0 ? ` · ошибок: ${folder.errorsCount}` : ''}
                                                  </Typography>
                                                </Box>
                                                <Stack alignItems="flex-end" spacing={0.3} sx={{ flexShrink: 0, minWidth: 86 }}>
                                                  <Typography variant="caption" sx={{ fontWeight: 700 }}>{formatBytesCompact(folder.sizeBytes)}</Typography>
                                                  {folder.partial && (
                                                    <Tooltip title={USER_PROFILE_PARTIAL_HINT}>
                                                      <Chip size="small" color="warning" label="Частично" sx={{ height: 20 }} />
                                                    </Tooltip>
                                                  )}
                                                </Stack>
                                              </Stack>
                                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7, mt: 0.45 }}>
                                                <LinearProgress
                                                  variant="determinate"
                                                  value={share}
                                                  sx={{ flex: 1, height: 5, borderRadius: 4 }}
                                                />
                                                <Typography variant="caption" color="text.secondary" sx={{ minWidth: 34, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                                  {share}%
                                                </Typography>
                                              </Box>
                                            </Box>
                                          );
                                        })}
                                      </Box>
                                    </Collapse>
                                  </Box>
                                )}
                              </Stack>
                            </Paper>
                          );
                        })}
                      </Stack>
                    ) : (
                      <Typography variant="body2" color="text.secondary">Размеры профилей еще не собраны.</Typography>
                    )}
                  </Stack>
                </Paper>

                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Система</Typography>
                <Paper variant="outlined" sx={{ p: 1.4 }}>
                  <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>Модель ITinvent: {selected.inventory_model_name || '-'}</Typography>
                  <Typography variant="body2">CPU: {selected.cpu_model || '-'}</Typography>
                  <Typography variant="body2">RAM: {selected.ram_gb ? `${selected.ram_gb} ГБ` : '-'}</Typography>
                  <Typography variant="body2">Серийный номер BIOS: {selected.system_serial || '-'}</Typography>
                  <Typography variant="body2">Последняя перезагрузка: {selectedRuntime.lastRebootAt ? formatTs(selectedRuntime.lastRebootAt) : '-'}</Typography>
                  <Typography variant="body2">Время работы: {selectedRuntime.uptimeSeconds !== null ? formatAge(selectedRuntime.uptimeSeconds) : '-'}</Typography>
                  <Typography variant="body2">Загрузка CPU: {formatPercent(selectedRuntime.cpu)}</Typography>
                  <Typography variant="body2">Загрузка RAM: {formatPercent(selectedRuntime.ram)}</Typography>
                </Paper>

                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Outlook</Typography>
                <Paper variant="outlined" sx={{ p: 1.4 }}>
                  <Stack spacing={0.9}>
                    <Stack direction="row" spacing={0.8} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Chip size="small" color={outlookStatusColor(selectedOutlook.status)} label={outlookStatusLabel(selectedOutlook.status)} />
                      <Typography variant="caption" color="text.secondary">
                        Всего: {formatBytesCompact(selectedOutlook.totalSizeBytes)} · Активных: {selectedOutlook.activeStoresCount || selectedOutlook.activeStores.length} · Архивов: {selectedOutlook.archivesCount}
                      </Typography>
                    </Stack>
                    {selectedOutlookFiles.length > 0 ? (
                      <Stack spacing={0.7}>
                        {selectedOutlookFiles.map((file, idx) => (
                          <Paper
                            key={`${file.kind}_${file.path || idx}`}
                            variant="outlined"
                            sx={{ p: 0.85, borderColor: file.kind === 'active' ? 'primary.main' : 'divider' }}
                          >
                            <Stack direction="row" spacing={0.9} justifyContent="space-between" alignItems="flex-start">
                              <Box sx={{ minWidth: 0, flex: 1 }}>
                                <Tooltip title={file.path || '-'}>
                                  <Typography variant="caption" sx={{ display: 'block', fontWeight: 600 }} noWrap>
                                    {file.path || '-'}
                                  </Typography>
                                </Tooltip>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.1 }}>
                                  {file.lastModifiedAt ? `Обновлено: ${formatTs(file.lastModifiedAt)}` : 'Дата изменения: -'}
                                </Typography>
                              </Box>
                              <Stack alignItems="flex-end" spacing={0.3} sx={{ flexShrink: 0 }}>
                                <Chip
                                  size="small"
                                  label={file.kind === 'active' ? 'Активный' : 'Архив'}
                                  color={file.kind === 'active' ? 'primary' : 'default'}
                                  sx={{ height: 22 }}
                                />
                                <Typography variant="caption" color="text.secondary">
                                  {formatBytesCompact(file.sizeBytes)}
                                </Typography>
                              </Stack>
                            </Stack>
                          </Paper>
                        ))}
                      </Stack>
                    ) : (
                      <Typography variant="body2" color="text.secondary">Файлы Outlook не обнаружены.</Typography>
                    )}
                  </Stack>
                </Paper>

                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Мониторы</Typography>
                {Array.isArray(selected.monitors) && selected.monitors.length > 0 ? (
                  selected.monitors.map((mon, i) => (
                    <Paper key={i} variant="outlined" sx={{ p: 1.2 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {mon.manufacturer || 'Неизвестно'} {mon.product_code || ''}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        S/N: {mon.serial_number || '-'} {mon.serial_source ? `(${mon.serial_source})` : ''}
                      </Typography>
                    </Paper>
                  ))
                ) : (
                  <Paper variant="outlined" sx={{ p: 1.2 }}>
                    <Typography variant="body2" color="text.secondary">Мониторы не обнаружены.</Typography>
                  </Paper>
                )}

                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Диски</Typography>
                <Paper variant="outlined" sx={{ p: 1.4 }}>
                  <Stack spacing={1.1}>
                    <Box>
                      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>Логические диски</Typography>
                      {Array.isArray(selected.logical_disks) && selected.logical_disks.length > 0 ? (
                        <Stack spacing={0.9} sx={{ mt: 0.6 }}>
                          {selected.logical_disks.map((disk, i) => {
                            const usage = resolveLogicalDiskUsage(disk);
                            return (
                              <Box key={`${disk.mountpoint || 'disk'}_${i}`}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.2, gap: 1 }}>
                                  <Typography variant="caption" sx={{ fontWeight: 600 }}>
                                    {usage?.mountpoint || '-'} ({usage?.fstype || '-'})
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    {usage?.usedGb !== null ? `${usage.usedGb.toFixed(1)} / ${usage.totalGb?.toFixed(1) || '-'} ГБ` : '-'}
                                  </Typography>
                                </Box>
                                <LinearProgress variant="determinate" value={usage?.usedPercent ?? 0} sx={{ height: 6, borderRadius: 3 }} />
                              </Box>
                            );
                          })}
                        </Stack>
                      ) : (
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.6 }}>Логические диски не обнаружены.</Typography>
                      )}
                    </Box>

                    <Box>
                      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>Физические диски (SMART)</Typography>
                      {Array.isArray(selected.storage) && selected.storage.length > 0 ? (
                        <Stack spacing={0.8} sx={{ mt: 0.6 }}>
                          {selected.storage.map((disk, i) => {
                            const healthStatus = String(disk?.health_status || 'Неизвестно');
                            const wearRaw = Number(disk?.wear_out_percentage);
                            const tempRaw = Number(disk?.temperature);
                            const diskTitle = resolveDiskTitle(disk);
                            const sizeLabel = resolveDiskSizeLabel(disk) || '-';
                            return (
                              <Paper key={`${disk.serial_number || disk.display_name || disk.model || 'disk'}-${i}`} variant="outlined" sx={{ p: 1.1 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{diskTitle}</Typography>
                                  <Chip size="small" color={smartHealthColor(healthStatus)} label={healthStatus} />
                                </Box>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                  S/N: {disk.serial_number || '-'} · Media: {disk.media_type || '-'} · Bus: {disk.bus_type || '-'} · Size: {sizeLabel}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                  Износ: {Number.isFinite(wearRaw) ? `${wearRaw}%` : '-'} · Температура: {Number.isFinite(tempRaw) ? `${tempRaw}C` : '-'}
                                </Typography>
                              </Paper>
                            );
                          })}
                          <Typography variant="caption" color="text.secondary">
                            Дисков: {selectedStorageStats.total} · Проблемных: {selectedStorageStats.problemCount}
                          </Typography>
                        </Stack>
                      ) : (
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.6 }}>
                          SMART/физические диски не обнаружены.
                        </Typography>
                      )}
                    </Box>
                  </Stack>
                </Paper>

                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Изменения</Typography>
                {Array.isArray(selected.recent_changes) && selected.recent_changes.length > 0 ? (
                  selected.recent_changes.map((event, idx) => (
                    <Paper key={event.event_id || idx} variant="outlined" sx={{ p: 1.2 }}>
                      <Typography variant="caption" sx={{ display: 'block', fontWeight: 700, mb: 0.4 }}>
                        {formatTs(event.detected_at)}
                      </Typography>
                      <Stack spacing={0.3}>
                        {summarizeChangeEvent(event).map((line, lineIdx) => (
                          <Typography key={`${event.event_id || idx}-${lineIdx}`} variant="caption" color="text.secondary">
                            {line}
                          </Typography>
                        ))}
                      </Stack>
                    </Paper>
                  ))
                ) : (
                  <Paper variant="outlined" sx={{ p: 1.2 }}>
                    <Typography variant="body2" color="text.secondary">Подробных изменений за период нет.</Typography>
                  </Paper>
                )}
              </Stack>
            )}
          </Box>
        </Drawer>
      </PageShell>
    </MainLayout>
  );
}

export default Computers;
