import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import { scanAgentsAPI } from '../../../api/scanAgents';
import { scanInstallPackagesAPI } from '../../../api/scanInstallPackages';
import { scanTasksAPI } from '../../../api/scanTasks';
import { computersSoftwareAPI } from '../../../api/computersSoftware';

const HUB_DESKTOP_QUERY = 'HUB Desktop';
// install_package exists on agents >= 1.4.15 (see scripts/scan/rollout_install_package.py).
const MIN_INSTALL_AGENT_VERSION = '1.4.15';
const ACTIVE_STATUSES = new Set(['queued', 'delivered', 'acknowledged']);
const POLL_MS = 20_000;
const EXPANDED_BRANCHES_KEY = 'hub_deploy_branches_expanded';
const UNASSIGNED_BRANCH = 'Без филиала';

const FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'current', label: 'Актуальные', color: 'success' },
  { id: 'outdated', label: 'Устаревшие', color: 'warning' },
  { id: 'not_installed', label: 'Не установлен' },
  { id: 'unknown', label: 'Нет данных' },
  { id: 'installing', label: 'Установка идёт', color: 'info' },
  { id: 'failed', label: 'Ошибка', color: 'error' },
  { id: 'unsupported', label: 'Старый агент' },
  { id: 'offline', label: 'Офлайн' },
];

function versionKey(value) {
  return String(value || '')
    .replace('-', '.')
    .split('.')
    .map((piece) => {
      const digits = piece.replace(/\D+/g, '');
      return digits ? parseInt(digits, 10) : 0;
    });
}

function versionCmp(a, b) {
  const ka = versionKey(a);
  const kb = versionKey(b);
  const len = Math.max(ka.length, kb.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (ka[i] || 0) - (kb[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

function formatAgo(tsSec) {
  const ts = Number(tsSec) || 0;
  if (!ts) return '—';
  const diffMin = Math.max(0, Math.floor(Date.now() / 1000 - ts) / 60);
  if (diffMin < 1) return 'только что';
  if (diffMin < 60) return `${Math.floor(diffMin)} мин назад`;
  if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)} ч назад`;
  return new Date(ts * 1000).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatSize(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return '';
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(0)} МБ`;
  return `${(value / 1024).toFixed(0)} КБ`;
}

function taskPhaseLabel(task) {
  const status = String(task?.status || '').toLowerCase();
  if (status === 'queued' || status === 'delivered') return 'В очереди';
  if (status === 'acknowledged') return 'Устанавливается';
  if (status === 'expired') return 'Не выполнено (срок истёк)';
  if (status === 'failed') return 'Ошибка';
  if (status === 'completed') {
    const phase = String(task?.result?.phase || '');
    if (phase === 'already_installed') return 'Уже установлен';
    if (phase === 'installed') return 'Установлен';
    return 'Завершено';
  }
  return status || '—';
}

function taskErrorText(task) {
  const parts = [task?.error_text, task?.result?.exit_code != null && task?.status === 'failed' ? `код ${task.result.exit_code}` : '']
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  return parts.join(' · ');
}

function readExpandedBranches() {
  try {
    const raw = localStorage.getItem(EXPANDED_BRANCHES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map((item) => String(item)) : []);
  } catch {
    return new Set();
  }
}

function writeExpandedBranches(groups) {
  try {
    localStorage.setItem(EXPANDED_BRANCHES_KEY, JSON.stringify([...groups]));
  } catch {
    // localStorage may be unavailable (private mode) — expansion still works for the session.
  }
}

function resolveRow(agent, pkg, installed, task) {
  const agentVersion = String(agent?.version || agent?.last_heartbeat?.metadata?.agent_version || '').trim();
  const online = Boolean(agent?.is_online);
  const taskActive = Boolean(task && (task.is_active || ACTIVE_STATUSES.has(String(task.status || '').toLowerCase())));
  const installedVersion = String(installed?.version || task?.result?.installed_version || '').trim();
  const taskOk = task && String(task.status) === 'completed'
    && ['installed', 'already_installed'].includes(String(task?.result?.phase || ''));
  const taskFailed = task && ['failed', 'expired'].includes(String(task.status));
  const supported = !agentVersion || versionCmp(agentVersion, MIN_INSTALL_AGENT_VERSION) >= 0;

  let status = 'not_installed';
  if (taskActive) status = 'installing';
  else if (taskOk || (installedVersion && pkg.version && versionCmp(installedVersion, pkg.version) >= 0)) status = 'current';
  else if (installedVersion) status = 'outdated';
  else if (taskFailed) status = 'failed';
  else if (!supported) status = 'unsupported';
  // No software inventory at all → "нет данных", not a confident "не установлен".
  else if (!installed?.has_inventory) status = 'unknown';
  return {
    agentId: String(agent?.agent_id || '').trim(),
    hostname: String(agent?.hostname || agent?.agent_id || '').trim(),
    // Scan agents don't report a branch (scan.scan_agents.branch is empty for the whole fleet);
    // the resolved one lives in the inventory presence payload.
    branch: String(agent?.branch || agent?.resolved_branch || installed?.branch_name || '').trim() || UNASSIGNED_BRANCH,
    agentVersion,
    online,
    lastSeen: Number(agent?.last_seen_at) || 0,
    installedVersion,
    installedAt: installed?.collected_at || '',
    task,
    taskActive,
    supported,
    status,
  };
}

export default function HubDesktopDeploySection({ canScanTasks }) {
  const theme = useTheme();
  const [pkg, setPkg] = useState(null);
  const [configured, setConfigured] = useState(true);
  const [configError, setConfigError] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [softwareNotice, setSoftwareNotice] = useState('');
  const [notice, setNotice] = useState(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [bulk, setBulk] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [expandedBranches, setExpandedBranches] = useState(readExpandedBranches);
  const mountedRef = useRef(true);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const [packData, agentsData, deploymentData] = await Promise.all([
        scanInstallPackagesAPI.getPackages(),
        scanAgentsAPI.getAgents(),
        // Latest install_package task per agent; package resolved below.
        scanInstallPackagesAPI.getDeployment('hub-desktop').catch(() => null),
      ]);
      const softwareData = await computersSoftwareAPI
        .getSoftwarePresence({ q: HUB_DESKTOP_QUERY, scope: 'all', match: 'exact' })
        .catch(() => null);
      if (!mountedRef.current) return;

      const packages = Array.isArray(packData?.packages) ? packData.packages : [];
      const pack = packages.find((item) => item.package_id === 'hub-desktop' && item.ok)
        || packages.find((item) => item.ok)
        || null;
      setConfigured(Boolean(packData?.configured));
      setConfigError(String(packData?.error || ''));
      setPkg(pack || null);
      setSoftwareNotice(
        softwareData === null
          ? 'Не удалось получить данные инвентаризации — колонка версии может быть неполной.'
          : '',
      );

      const installedMap = new Map();
      for (const item of softwareData?.items || []) {
        const key = String(item?.hostname || '').trim().toUpperCase();
        if (!key) continue;
        installedMap.set(key, {
          version: String(item?.installed_version || '').trim(),
          collected_at: item?.collected_at || '',
          has_inventory: Boolean(item?.has_software_inventory),
          branch_name: String(item?.branch_name || '').trim(),
        });
      }
      const tasks = deploymentData?.tasks && typeof deploymentData.tasks === 'object'
        ? deploymentData.tasks
        : {};

      const list = (Array.isArray(agentsData) ? agentsData : [])
        .map((agent) => {
          const agentId = String(agent?.agent_id || '').trim();
          const hostKey = String(agent?.hostname || agentId || '').trim().toUpperCase();
          return resolveRow(agent, pack || {}, installedMap.get(hostKey) || null, tasks[agentId] || null);
        })
        .filter((row) => row.agentId);
      list.sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1;
        return a.hostname.localeCompare(b.hostname, 'ru');
      });
      setRows(list);
    } catch (err) {
      if (mountedRef.current) setError('Не удалось загрузить данные развёртывания');
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => { mountedRef.current = false; };
  }, [load]);

  const hasActive = useMemo(() => rows.some((row) => row.taskActive), [rows]);
  useEffect(() => {
    if (!hasActive) return undefined;
    const timer = setInterval(() => load({ silent: true }), POLL_MS);
    return () => clearInterval(timer);
  }, [hasActive, load]);

  const counts = useMemo(() => {
    const acc = { all: rows.length };
    for (const row of rows) {
      acc[row.status] = (acc[row.status] || 0) + 1;
      if (!row.online) acc.offline = (acc.offline || 0) + 1;
    }
    return acc;
  }, [rows]);

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === 'offline') {
        if (row.online) return false;
      } else if (filter !== 'all' && row.status !== filter) {
        return false;
      }
      if (!needle) return true;
      return row.hostname.toLowerCase().includes(needle)
        || row.branch.toLowerCase().includes(needle)
        || row.agentId.toLowerCase().includes(needle);
    });
  }, [rows, query, filter]);

  const branchGroups = useMemo(() => {
    const map = new Map();
    for (const row of visibleRows) {
      if (!map.has(row.branch)) map.set(row.branch, []);
      map.get(row.branch).push(row);
    }
    const unassigned = new Set([UNASSIGNED_BRANCH, 'Неотсортированные']);
    return [...map.entries()]
      .map(([name, items]) => ({
        name,
        items,
        online: items.filter((row) => row.online).length,
        installing: items.filter((row) => row.status === 'installing').length,
        failed: items.filter((row) => row.status === 'failed').length,
      }))
      .sort((a, b) => {
        const ua = unassigned.has(a.name);
        const ub = unassigned.has(b.name);
        if (ua !== ub) return ua ? 1 : -1;
        return a.name.localeCompare(b.name, 'ru');
      });
  }, [visibleRows]);

  // Search or a status filter means "show me the matches" — expand everything found.
  const forceExpand = query.trim() !== '' || filter !== 'all';
  const allExpanded = branchGroups.length > 0 && branchGroups.every((group) => expandedBranches.has(group.name));

  const toggleBranch = (name) => {
    setExpandedBranches((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      writeExpandedBranches(next);
      return next;
    });
  };

  const setAllExpanded = (expanded) => {
    setExpandedBranches(() => {
      const next = expanded ? new Set(branchGroups.map((group) => group.name)) : new Set();
      writeExpandedBranches(next);
      return next;
    });
  };

  const deploy = useCallback(async (agentIds, label) => {
    const ids = agentIds.filter(Boolean);
    if (!ids.length || !pkg) return;
    let ok = 0;
    let skipped = 0;
    let failed = 0;
    setBusyIds((prev) => new Set([...prev, ...ids]));
    for (const agentId of ids) {
      try {
        const response = await scanTasksAPI.createTask({
          agent_id: agentId,
          command: 'install_package',
          payload: { package_id: pkg.package_id },
          dedupe_key: `install_package:${pkg.package_id}:${agentId}`,
        });
        if (response?.task?.blocked || response?.task?.id === undefined && response?.task?.status === 'blocked') {
          skipped += 1;
        } else {
          ok += 1;
        }
      } catch (err) {
        failed += 1;
      }
    }
    if (mountedRef.current) {
      setBusyIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      setNotice({
        severity: failed ? 'warning' : 'success',
        text: `${label}: отправлено ${ok}${skipped ? `, пропущено (занято) ${skipped}` : ''}${failed ? `, ошибок ${failed}` : ''}`,
      });
      load({ silent: true });
    }
  }, [pkg, load]);

  const deployOne = (row) => deploy([row.agentId], `Установка на ${row.hostname}`);

  const bulkTargets = useMemo(() => {
    if (!bulk) return [];
    return visibleRows.filter((row) => bulk.statuses.has(row.status) && row.supported && !row.taskActive);
  }, [bulk, visibleRows]);

  const openBulk = (kind) => {
    if (kind === 'install') {
      // "Нет данных" goes too: the agent re-checks the installed version before installing,
      // so queueing a covered host is harmless and cheaper than waiting for inventory.
      setBulk({ kind, statuses: new Set(['not_installed', 'unknown']), title: 'Установка HUB Desktop' });
    } else {
      setBulk({ kind, statuses: new Set(['outdated', 'failed']), title: 'Обновление HUB Desktop' });
    }
  };

  const statusChip = (row) => {
    const map = {
      installing: { label: 'Установка идёт', color: 'info' },
      current: { label: 'Актуальная', color: 'success' },
      outdated: { label: 'Устарела', color: 'warning' },
      failed: { label: 'Ошибка', color: 'error' },
      unsupported: { label: 'Старый агент' },
      unknown: { label: 'Нет данных' },
      not_installed: { label: 'Не установлен' },
    };
    const item = map[row.status] || map.not_installed;
    return <Chip size="small" color={item.color || 'default'} variant={row.status === 'not_installed' ? 'outlined' : 'filled'} label={item.label} />;
  };

  const actionFor = (row) => {
    if (!canScanTasks || !pkg) return null;
    if (row.taskActive || busyIds.has(row.agentId)) {
      return <Chip size="small" variant="outlined" icon={<CircularProgress size={12} />} label="В работе" />;
    }
    if (!row.supported) {
      return (
        <Tooltip title={`Агент ${row.agentVersion || '?'} старше ${MIN_INSTALL_AGENT_VERSION} не умеет ставить пакеты — сначала обновите агент`}>
          <span><Button size="small" disabled>Установить</Button></span>
        </Tooltip>
      );
    }
    const label = row.status === 'outdated' ? 'Обновить'
      : row.status === 'failed' ? 'Повторить'
        : row.status === 'current' ? 'Переустановить'
          : 'Установить';
    return (
      <Tooltip title={row.online ? '' : 'Агент офлайн — задание выполнится, когда он выйдет на связь'}>
        <span>
          <Button size="small" variant={row.status === 'current' ? 'text' : 'contained'} onClick={() => deployOne(row)}>
            {label}
          </Button>
        </span>
      </Tooltip>
    );
  };

  const rowFor = (row) => (
    <TableRow key={row.agentId} hover>
      <TableCell>
        <Typography fontWeight={600}>{row.hostname}</Typography>
        <Typography variant="caption" color="text.secondary">
          {row.online ? 'в сети' : `офлайн · ${formatAgo(row.lastSeen)}`}
        </Typography>
      </TableCell>
      <TableCell>
        <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {row.agentVersion || '—'}
        </Typography>
      </TableCell>
      <TableCell>
        {row.installedVersion ? (
          <Tooltip title={row.installedAt ? `Инвентаризация: ${row.installedAt}` : ''}>
            <Chip
              size="small"
              variant="outlined"
              color={pkg && versionCmp(row.installedVersion, pkg.version) >= 0 ? 'success' : 'warning'}
              label={row.installedVersion}
            />
          </Tooltip>
        ) : (
          <Typography variant="body2" color="text.secondary">—</Typography>
        )}
      </TableCell>
      <TableCell>{statusChip(row)}</TableCell>
      <TableCell>
        {row.task ? (
          <Tooltip title={taskErrorText(row.task) || ''}>
            <Typography variant="body2" color={row.task.status === 'failed' ? 'error' : 'text.secondary'}>
              {taskPhaseLabel(row.task)} · {formatAgo(row.task.updated_at || row.task.created_at)}
            </Typography>
          </Tooltip>
        ) : (
          <Typography variant="body2" color="text.secondary">—</Typography>
        )}
      </TableCell>
      <TableCell align="right">{actionFor(row)}</TableCell>
    </TableRow>
  );

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>HUB Desktop</Typography>
            <Typography variant="body2" color="text.secondary">
              {pkg
                ? `Пакет ${pkg.package_id} · версия ${pkg.version || '?'} · ${formatSize(pkg.size_bytes)} · обновляется из канала stable`
                : configured ? 'Пакет hub-desktop не найден в реестре' : 'Реестр пакетов не настроен на сервере'}
            </Typography>
            {configError ? (
              <Typography variant="caption" color="error">{configError}</Typography>
            ) : null}
          </Box>
          <Button
            size="small"
            variant="outlined"
            startIcon={refreshing ? <CircularProgress size={14} /> : <RefreshIcon />}
            onClick={() => load({ silent: true })}
            disabled={refreshing}
          >
            Обновить
          </Button>
        </Stack>

        {error ? <Alert severity="error">{error}</Alert> : null}
        {softwareNotice ? <Alert severity="warning">{softwareNotice}</Alert> : null}
        {notice ? <Alert severity={notice.severity} onClose={() => setNotice(null)}>{notice.text}</Alert> : null}

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
          {FILTERS.map((item) => (
            <Chip
              key={item.id}
              size="small"
              color={item.color || 'default'}
              variant={filter === item.id ? 'filled' : 'outlined'}
              label={`${item.label}: ${counts[item.id] || 0}`}
              onClick={() => setFilter(filter === item.id ? 'all' : item.id)}
            />
          ))}
          <TextField
            size="small"
            placeholder="Поиск по имени ПК или филиалу"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
              ),
            }}
            sx={{ ml: 'auto', minWidth: 220 }}
          />
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

        {canScanTasks && pkg ? (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button size="small" variant="contained" onClick={() => openBulk('install')}>
              Установить, где нет
            </Button>
            <Button size="small" variant="outlined" onClick={() => openBulk('update')}>
              Обновить устаревшие и повторить ошибки
            </Button>
          </Stack>
        ) : null}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
        ) : (
          <Stack spacing={1.5}>
            {branchGroups.map((group, groupIndex) => {
              const expanded = forceExpand || expandedBranches.has(group.name);
              const contentId = `hub-deploy-branch-${groupIndex}`;
              return (
                <Box
                  key={group.name}
                  sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}
                >
                  <Box
                    component="button"
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={contentId}
                    onClick={() => toggleBranch(group.name)}
                    sx={{
                      p: 1.2,
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
                      <Typography variant="subtitle1" fontWeight={700} noWrap>{group.name}</Typography>
                    </Box>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap justifyContent="flex-end" sx={{ minWidth: 0 }}>
                      <Chip size="small" variant="outlined" label={`${group.items.length} ПК`} />
                      {group.online ? (
                        <Chip size="small" color="success" variant="outlined" label={`в сети: ${group.online}`} />
                      ) : null}
                      {group.installing ? (
                        <Chip size="small" color="info" variant="outlined" label={`ставится: ${group.installing}`} />
                      ) : null}
                      {group.failed ? (
                        <Chip size="small" color="error" variant="outlined" label={`ошибок: ${group.failed}`} />
                      ) : null}
                    </Stack>
                  </Box>
                  <Collapse in={expanded} timeout="auto" unmountOnExit id={contentId}>
                    <Box sx={{ overflow: 'auto', borderTop: '1px solid', borderColor: 'divider' }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Компьютер</TableCell>
                            <TableCell>Агент</TableCell>
                            <TableCell>HUB Desktop</TableCell>
                            <TableCell>Статус</TableCell>
                            <TableCell>Развёртывание</TableCell>
                            <TableCell align="right" />
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {group.items.map(rowFor)}
                        </TableBody>
                      </Table>
                    </Box>
                  </Collapse>
                </Box>
              );
            })}
            {!branchGroups.length ? (
              <Typography color="text.secondary" sx={{ py: 2 }}>
                {rows.length ? 'По фильтру ничего не найдено' : 'Агенты не найдены'}
              </Typography>
            ) : null}
          </Stack>
        )}
      </Stack>

      <Dialog open={Boolean(bulk)} onClose={() => (bulkBusy ? null : setBulk(null))} maxWidth="xs" fullWidth>
        <DialogTitle>{bulk?.title}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {pkg ? `Будет поставлена установка ${pkg.display_name || 'HUB Desktop'} ${pkg.version || ''} на ${bulkTargets.length} компьютера(ов) из списка ниже.` : ''}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Задание выполняется агентом при следующем выходе на связь: он скачает установщик с сервера (докачивается при обрывах), проверит хеш и запустит тихую установку.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxHeight: 160, overflow: 'auto' }}>
            {bulkTargets.slice(0, 30).map((row) => row.hostname).join(', ')}{bulkTargets.length > 30 ? ` и ещё ${bulkTargets.length - 30}` : ''}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulk(null)} disabled={bulkBusy}>Отмена</Button>
          <Button
            variant="contained"
            disabled={bulkBusy || !bulkTargets.length}
            onClick={async () => {
              setBulkBusy(true);
              await deploy(bulkTargets.map((row) => row.agentId), bulk?.title || 'Раскатка');
              setBulkBusy(false);
              setBulk(null);
            }}
          >
            {bulkBusy ? 'Отправляю…' : `Развернуть (${bulkTargets.length})`}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
