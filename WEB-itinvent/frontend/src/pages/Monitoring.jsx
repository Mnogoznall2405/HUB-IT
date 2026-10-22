import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, IconButton, LinearProgress, List, ListItemButton, MenuItem, Paper, Skeleton, Stack, Tab, Tabs, TextField, Tooltip, Typography } from '@mui/material';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import PushPinRoundedIcon from '@mui/icons-material/PushPinRounded';
import { useTheme } from '@mui/material/styles';
import MonitoringDeviceGrid from './monitoring/MonitoringDeviceGrid';
import MonitoringHeader from './monitoring/MonitoringHeader';
import MonitoringConnectionState from './monitoring/MonitoringConnectionState';
import useMonitoringHistory from './monitoring/useMonitoringHistory';
import RouterOutlinedIcon from '@mui/icons-material/RouterOutlined';
import NetworkCheckOutlinedIcon from '@mui/icons-material/NetworkCheckOutlined';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import { useConfirmDialog } from '../components/feedback/ConfirmDialogProvider';
import { useAuth } from '../contexts/AuthContext';
import { monitoringAPI } from '../api/monitoring';
import { buildOfficeUiTokens } from '../theme/officeUiTokens';
import MonitoringChart from './monitoring/MonitoringChart';
import MonitoringEvents from './monitoring/MonitoringEvents';
import MonitoringInterfaces from './monitoring/MonitoringInterfaces';
import { MonitoringInterfaceDialog, MonitoringTargetDialog } from './monitoring/MonitoringDialogs';
import { compareMonitoringTargets, displayTargetName, errorMessage, formatBytes, formatNumber, formatTime, isNumber, isStale, targetStatus } from './monitoring/monitoringFormat';

const TRAFFIC = [{ key: 'rx_bps', label: 'Приём' }, { key: 'tx_bps', label: 'Передача' }];
const UTILIZATION = [{ key: 'rx_util_pct', label: 'Приём' }, { key: 'tx_util_pct', label: 'Передача' }];
const RESOURCES = [{ key: 'cpu_pct', label: 'CPU' }, { key: 'memory_pct', label: 'Память' }];
const LATENCY = [{ key: 'latency_ms', label: 'Задержка' }];
const AVAILABILITY = [{ key: 'snmp_up', label: 'SNMP' }, { key: 'ping_up', label: 'ICMP' }];
const DISCARDS = [{ key: 'rx_discards_pps', label: 'Приём' }, { key: 'tx_discards_pps', label: 'Передача' }];
const LOSS = [{ key: 'loss_pct', label: 'Потери' }];
const EMPTY_POINTS = [];
const STORAGE = [{ key: 'storage_pct', label: 'Хранилище' }];
const TEMPERATURE = [{ key: 'temperature_c', label: 'Плата' }];
const SPEED = [{ key: 'speed_bps', label: 'Скорость соединения' }];
const ERRORS = [{ key: 'rx_errors_pps', label: 'Входящие ошибки' }, { key: 'tx_errors_pps', label: 'Исходящие ошибки' }];
const PERIODS = [[1, 'Последний час'], [6, '6 часов'], [24, 'Сутки'], [168, '7 дней'], [720, '30 дней'], [2160, '90 дней'], [8760, 'Год'], [0, 'Свой период']];
const TABS = [['overview', 'Обзор'], ['interfaces', 'Интерфейсы'], ['graphs', 'Графики'], ['events', 'События']];
const defaultInterfaceId = (items) => items.find((row) => row.settings?.pinned)?.id || items.find((row) => row.settings?.role === 'wan' || row.settings?.critical)?.id || items.find((row) => row.current?.oper === 1 && row.current?.type === 6)?.id || items[0]?.id || '';

export default function Monitoring() {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const { user, hasPermission } = useAuth();
  const { confirm } = useConfirmDialog();
  const canRead = hasPermission('monitoring.read');
  const canManage = canRead && hasPermission('monitoring.manage');
  const currentAccess = useRef(null);
  currentAccess.current = { userId: user?.id, canManage };
  const overviewRequest = useRef(null);
  const detailRequest = useRef(null);
  const [pinningId, setPinningId] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [interfaceId, setInterfaceId] = useState('');
  const [loading, setLoading] = useState(true);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [probing, setProbing] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [deletedName, setDeletedName] = useState('');
  const deletedIds = useRef(new Set());
  const searchInputRef = useRef(null);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const probeContext = useMemo(() => ({}), [selectedId, user?.id, canRead, canManage]);
  const currentProbeContext = useRef(probeContext);
  currentProbeContext.current = probeContext;
  const probeRequest = useRef(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [hours, setHours] = useState(24);
  const [customPeriod, setCustomPeriod] = useState(() => { const local = (at) => new Date(at - new Date(at).getTimezoneOffset() * 60000).toISOString().slice(0, 16); return { start: local(Date.now() - 86400000), end: local(Date.now()) }; });
  const customStart = new Date(customPeriod.start); const customEnd = new Date(customPeriod.end);
  const customValid = customStart < customEnd && customEnd <= new Date(Date.now() + 60000) && customEnd - customStart <= 365 * 86400000;
  const periodHours = hours || (customEnd - customStart) / 3600000;
  const [tab, setTab] = useState('overview');
  const [revision, setRevision] = useState(0);
  const [targetDialog, setTargetDialog] = useState({ open: false, target: null });
  const [interfaceDialog, setInterfaceDialog] = useState(null);
  const targets = data?.targets || [];
  const selected = detail?.id === selectedId ? detail : targets.find((row) => row.id === selectedId);
  const interfaces = detail?.id === selectedId ? detail.interfaces || [] : [];
  const selectedInterface = interfaces.find((row) => row.id === interfaceId);
  const current = selected?.current || {};
  const device = current.device || {};
  const accessKey = JSON.stringify([user?.id, user?.role, user?.permissions, user?.use_custom_permissions, user?.custom_permissions, canRead]);
  const historyVersion = `${String(current.history_revision || current.sample_at || current.checked_at || '').slice(0, 16)}:${historyRefresh}`;
  const historyEnabled = canRead && Boolean(selectedId) && (tab === 'overview' || tab === 'graphs') && Boolean(hours || customValid);
  const historyParams = { accessKey, targetId: selectedId, hours, enabled: historyEnabled, version: historyVersion,
    start: !hours && customValid ? customStart.toISOString() : undefined, end: !hours && customValid ? customEnd.toISOString() : undefined };
  const systemHistory = useMonitoringHistory(historyParams);
  const portHistory = useMonitoringHistory({ ...historyParams, interfaceId, enabled: historyEnabled && detail?.id === selectedId && Boolean(interfaceId) });
  const latencyHistory = useMonitoringHistory({ ...historyParams, latency: true,
    version: `${periodHours <= 24 ? current.icmp_checked_at || current.checked_at || '' : historyVersion}:${historyRefresh}:${periodHours <= 24 && current.icmp_history_since ? revision : ''}` });
  const deviceHistory = systemHistory.data;
  const interfaceHistory = portHistory.data;
  const stale = isStale(current.last_success_at);
  const visible = targets.filter((row) => `${displayTargetName(row)} ${row.name} ${row.address} ${row.current?.device?.sys_name || ''}`.toLowerCase().includes(search.toLowerCase()) && (filter === 'all' || (filter === 'issues' ? !['online', 'paused'].includes(targetStatus(row).key) : targetStatus(row).key === filter))).sort(compareMonitoringTargets);
  const issues = targets.filter((row) => !['online', 'paused'].includes(targetStatus(row).key)).length;
  const patchTarget = useCallback((target) => {
    if (deletedIds.current.has(target.id)) return;
    setData((old) => ({ ...(old || {}), targets: old?.targets?.some((row) => row.id === target.id) ? old.targets.map((row) => row.id === target.id ? { ...row, ...target } : row) : [...(old?.targets || []), target] }));
  }, []);

  useLayoutEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }, [selectedId, user?.id]);
  useLayoutEffect(() => {
    probeRequest.current = null;
    setProbing(false);
    return () => { probeRequest.current = null; };
  }, [probeContext]);

  useEffect(() => {
    if (!selectedId || !canRead) return undefined;
    const onEscape = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.repeat || event.isComposing
        || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (targetDialog.open || interfaceDialog || deletingId
        || document.querySelector('.MuiModal-root:not([aria-hidden="true"])')) return;
      event.preventDefault();
      setSelectedId('');
      window.requestAnimationFrame(() => searchInputRef.current?.focus({ preventScroll: true }));
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [selectedId, canRead, targetDialog.open, interfaceDialog, deletingId]);

  useEffect(() => {
    if (!canRead) { setData(null); setDetail(null); return undefined; }
    const controller = new AbortController();
    overviewRequest.current = controller;
    monitoringAPI.overview(controller.signal).then((result) => { if (controller.signal.aborted) return; const next = { ...result, targets: result.targets.filter((row) => !deletedIds.current.has(row.id)) }; setData(next); setError(''); setSelectedId((id) => next.targets.some((row) => row.id === id) ? id : ''); }).catch((err) => { if (!controller.signal.aborted) setError(errorMessage(err)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [canRead, user?.id, revision]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') setRevision((value) => value + 1); };
    const timer = window.setInterval(refresh, 10000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  useEffect(() => {
    setDetail(null); setInterfaceId(''); setDetailError('');
  }, [selectedId]);
  useEffect(() => {
    if (!selectedId || !canRead) return undefined;
    const controller = new AbortController();
    detailRequest.current = controller;
    monitoringAPI.detail(selectedId, controller.signal).then((result) => {
      if (controller.signal.aborted || deletedIds.current.has(result.id)) return;
      setDetail(result); setDetailError('');
      setInterfaceId((id) => result.interfaces.some((row) => row.id === id) ? id : defaultInterfaceId(result.interfaces));
    }).catch((err) => { if (!controller.signal.aborted) setDetailError(errorMessage(err)); });
    return () => controller.abort();
  }, [selectedId, canRead, revision]);

  const probe = async () => {
    if (!selectedId || !canManage || probeRequest.current) return;
    const targetId = selectedId;
    const request = {};
    const isCurrent = () => probeRequest.current === request
      && currentProbeContext.current === probeContext && !deletedIds.current.has(targetId);
    probeRequest.current = request;
    setProbing(true); setDetailError('');
    try {
      const result = await monitoringAPI.probe(targetId);
      if (!isCurrent()) return;
      if (result.id !== targetId) throw new Error('Ответ опроса относится к другому устройству');
      // Earlier snapshots must not overwrite the completed manual collection.
      detailRequest.current?.abort();
      overviewRequest.current?.abort();
      setDetail(result); patchTarget(result); setDetailError(''); setHistoryRefresh((value) => value + 1);
      setInterfaceId((id) => result.interfaces.some((row) => row.id === id) ? id : defaultInterfaceId(result.interfaces));
    } catch (err) {
      if (isCurrent()) setDetailError(errorMessage(err));
    } finally {
      if (isCurrent()) { probeRequest.current = null; setProbing(false); }
    }
  };
  const applyInterfaceSaved = (item, targetId) => {
    if (!currentAccess.current.canManage || deletedIds.current.has(targetId)) return;
    overviewRequest.current?.abort();
    patchTarget({ id: targetId, summary: item.target_summary });
    if (selectedIdRef.current !== targetId) return;
    detailRequest.current?.abort();
    setDetail((old) => old?.id === targetId ? { ...old, interfaces: old.interfaces.map((row) => row.id === item.id ? item : item.settings?.pinned ? { ...row, settings: { ...row.settings, pinned: false } } : row) } : old);
    if (item.settings?.pinned) setInterfaceId(item.id);
  };
  const togglePin = async () => {
    if (!canManage || !selectedInterface || pinningId) return;
    const targetId = selectedId; const userId = user?.id;
    setPinningId(selectedInterface.id); setDetailError('');
    try {
      const item = await monitoringAPI.saveInterface(targetId, selectedInterface.id, { ...selectedInterface.settings, pinned: !selectedInterface.settings?.pinned });
      if (currentAccess.current.userId === userId) applyInterfaceSaved(item, targetId);
    } catch (err) { if (currentAccess.current.userId === userId && selectedIdRef.current === targetId) setDetailError(errorMessage(err)); }
    finally { setPinningId(''); }
  };
  const removeTarget = async () => {
    const target = selected;
    if (!canManage || !target || deletingId) return;
    const accepted = await confirm({
      title: 'Удалить устройство из мониторинга?',
      message: `«${displayTargetName(target)}» (${target.address})\n\nОпрос прекратится. Все измерения, графики и события этого устройства будут удалены без возможности восстановления через интерфейс. Карточка в разделе «Сети» и профиль SNMP сохранятся.`,
      confirmLabel: 'Удалить устройство и историю', destructive: true,
    });
    if (!accepted) return;
    setDeletingId(target.id); setError(''); setDeletedName('');
    try {
      try { await monitoringAPI.deleteTarget(target.id); }
      catch (err) { if (err.response?.status !== 404) throw err; }
      deletedIds.current.add(target.id);
      systemHistory.clearTarget(target.id); portHistory.clearTarget(target.id); latencyHistory.clearTarget(target.id);
      setData((old) => old ? { ...old, targets: old.targets.filter((row) => row.id !== target.id) } : old);
      const returnToList = selectedIdRef.current === target.id;
      setSelectedId((id) => id === target.id ? '' : id);
      setDetail((old) => old?.id === target.id ? null : old);
      setDeletedName(displayTargetName(target));
      if (returnToList) window.requestAnimationFrame(() => searchInputRef.current?.focus({ preventScroll: true }));
    } catch (err) { setError(`Не удалось удалить устройство: ${errorMessage(err)}`); }
    finally { setDeletingId(''); }
  };
  const selectInterface = (id) => { setInterfaceId(id); setTab('graphs'); };
  const systemPoints = deviceHistory?.points || EMPTY_POINTS;
  const latencyPoints = latencyHistory.data?.points || EMPTY_POINTS;
  const latencyLegacy = useMemo(() => latencyPoints.some((point) => point.source_resolution_seconds === 60), [latencyPoints]);
  const latencySubtitle = `ICMP с сервера HUB · ${latencyHistory.data?.resolution_seconds > 10 ? `шаг графика ${latencyHistory.data.resolution_seconds} с` : 'измерения каждые 10 с'}${latencyLegacy ? ' · ранняя история поминутно' : ''}`;
  const portPoints = interfaceHistory?.points || EMPTY_POINTS;
  const availabilityPoints = useMemo(() => systemPoints.map((p) => ({ ...p, ...Object.fromEntries(Object.entries(p).filter(([key]) => key.startsWith('snmp_up') || key.startsWith('ping_up')).map(([key, value]) => [key, isNumber(value) ? value * 100 : null])) })), [systemPoints]);

  return <MainLayout headerMode="integrated" contentMode="edge-to-edge">
    <MonitoringHeader search={search} filter={filter} onSearch={setSearch} onFilter={setFilter} count={targets.length} issues={issues} selected={selected} canManage={canManage} probing={probing} deleting={deletingId === selectedId && Boolean(deletingId)} searchInputRef={searchInputRef} onDelete={removeTarget}
      onBack={() => setSelectedId('')} onRefresh={() => { setRevision((v) => v + 1); setHistoryRefresh((v) => v + 1); }} onConnect={() => setTargetDialog({ open: true, target: null })} onProbe={probe}
      onSettings={() => setTargetDialog({ open: true, target: selected })} onPortControl={selectedInterface && canManage ? () => setInterfaceDialog(selectedInterface) : undefined} />
    <PageShell sx={{ p: { xs: 1.5, sm: 2, lg: 2 }, minWidth: 0, '& .MuiButton-root': { textTransform: 'none', fontWeight: 600 }, '& .MuiPaper-outlined:not(.monitoring-device-card)': { boxShadow: 'none', border: '1px solid', borderColor: 'divider' }, '& input': { fontSize: { xs: 16, sm: 14 } } }}>
    <Stack spacing={2.5} sx={{ maxWidth: 1680, mx: 'auto' }}>
      {error && <Alert severity="error">{error}</Alert>}
      {data?.worker?.enabled && isStale(data.worker.heartbeat_at, 30) && <Alert severity="warning">Сборщик мониторинга не обновляет данные. Состояние связи в пропущенных интервалах неизвестно.</Alert>}
      {deletedName && <Alert severity="success" role="status" onClose={() => setDeletedName('')}>Устройство «{deletedName}» и его история мониторинга удалены.</Alert>}
      {data?.worker && !data.worker.enabled && <Alert severity="info" icon={<NetworkCheckOutlinedIcon />}>Автоматический сбор пока не включён. {canManage ? 'Для проверки выбранного устройства доступен ручной опрос.' : 'Новые данные появятся после включения сбора.'}</Alert>}
      {data?.worker?.enabled && isStale(data.worker.heartbeat_at, 120) && <Alert severity="warning">Сбор данных задерживается. Последний цикл: {formatTime(data.worker.heartbeat_at)}. Состояние сборщика проверяется отдельно от доступности устройств.</Alert>}
      {loading ? <Stack direction={{ xs: 'column', md: 'row' }} gap={2}><Skeleton variant="rounded" height={420} sx={{ width: { xs: '100%', md: 280 } }} /><Skeleton variant="rounded" height={420} sx={{ flex: 1 }} /></Stack> : !targets.length ? <Paper variant="outlined" sx={{ p: { xs: 3, md: 7 }, borderRadius: '16px', textAlign: 'center' }}><RouterOutlinedIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} aria-hidden="true" /><Typography component="h2" variant="h6" fontWeight={700}>{data ? 'Подключите первое устройство' : 'Данные мониторинга недоступны'}</Typography><Typography color="text.secondary" sx={{ mt: 1, maxWidth: 520, mx: 'auto' }}>{data ? 'Выберите устройство сетевого реестра, укажите адрес и профиль SNMP. История начнёт собираться после первого опроса.' : 'Повторите загрузку после восстановления доступа к хранилищу.'}</Typography></Paper> : !selectedId ? <MonitoringDeviceGrid visible={visible} onSelect={setSelectedId} /> : <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: '270px minmax(0, 1fr)' }, gap: 2.5, alignItems: 'start' }}>
        <Paper component="aside" aria-label="Список устройств" variant="outlined" sx={{ borderRadius: '16px', overflow: 'hidden', position: { lg: 'sticky' }, top: { lg: 'calc(var(--app-shell-top-offset, 0px) + 72px)' } }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ px: 2, pt: 2 }}>Устройства · {targets.length}</Typography>
          <List disablePadding sx={{ px: 1, pb: 1, maxHeight: { xs: 260, lg: '65vh' }, overflow: 'auto' }} aria-label="Выбор устройства">{visible.map((target) => { const status = targetStatus(target); return <ListItemButton key={target.id} selected={target.id === selectedId} onClick={() => setSelectedId(target.id)} aria-label={`Открыть ${displayTargetName(target)}`} aria-current={target.id === selectedId ? 'true' : undefined} sx={{ borderRadius: '10px', mb: 0.5, alignItems: 'flex-start', py: 1.5, borderInlineStart: '3px solid', borderInlineStartColor: target.id === selectedId ? ui.brand : 'transparent', '&.Mui-selected': { bgcolor: ui.selectedBg } }}><Box sx={{ minWidth: 0, flex: 1 }}><Typography variant="body2" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{displayTargetName(target)}</Typography><Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>{target.address}</Typography><Stack direction="row" alignItems="center" gap={0.75} sx={{ mt: 0.8 }}><Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: status.color === 'default' ? 'text.disabled' : `${status.color}.main` }} /><Typography variant="caption" color="text.secondary">{status.label}</Typography></Stack></Box></ListItemButton>; })}{!visible.length && <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>По этому фильтру устройств нет.</Typography>}</List>
        </Paper>
        <Stack spacing={2} sx={{ minWidth: 0 }}>
          {detailError && <Alert severity="error">{detailError}</Alert>}
          {selected && <Paper component="section" variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: '16px', minWidth: 0 }}>
            <Typography component="h2" variant="h6" fontWeight={750} sx={{ overflowWrap: 'anywhere' }}>{displayTargetName(selected)}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5, overflowWrap: 'anywhere' }}>{selected.address}:{selected.port} · {device.description || 'SNMPv2c'}</Typography>
            <MonitoringConnectionState target={selected} />
            <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center" sx={{ mt: 2 }}><Chip size="small" label={`ICMP: ${isStale(current.icmp_checked_at || current.checked_at, 20) ? 'данные устарели' : current.ping?.status === 'online' ? 'отвечает' : current.ping?.status === 'offline' ? 'нет ответа' : 'не проверен'}`} variant="outlined" color={current.ping?.status === 'online' && !isStale(current.icmp_checked_at || current.checked_at, 20) ? 'success' : 'default'} /><Chip size="small" label={`SNMP: ${current.snmp_status === 'ok' ? stale ? 'данные устарели' : 'отвечает' : current.snmp_status === 'error' ? 'ошибка' : 'не проверен'}`} variant="outlined" color={current.snmp_status === 'ok' && !stale ? 'success' : current.snmp_status === 'error' ? 'warning' : 'default'} /><Typography variant="caption" color="text.secondary" sx={{ marginInlineStart: { md: 'auto' } }}>Последний успех SNMP: {formatTime(current.last_success_at)}</Typography></Stack>
            {current.snmp_error && <Typography variant="caption" color="warning.main" display="block" sx={{ mt: 1 }}>{current.snmp_error}. Последние известные значения сохранены.</Typography>}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,minmax(0,1fr))', sm: 'repeat(4,minmax(0,1fr))' }, gap: 2.5, mt: 2.5 }}>{[['CPU', device.cpu_pct, '%'], ['Память', device.memory_pct, '%'], ['Температура платы', device.temperature_c, '°C'], ['Задержка HUB', current.ping?.latency_ms, 'мс']].map(([label, value, unit]) => <Box key={label}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="h6" sx={{ fontVariantNumeric: 'tabular-nums', color: stale ? 'text.secondary' : 'text.primary' }}>{formatNumber(value)}{isNumber(value) ? ` ${unit}` : ''}</Typography>{unit === '%' && isNumber(value) && <LinearProgress variant="determinate" value={Math.max(0, Math.min(100, value))} sx={{ height: 3, borderRadius: '10px', mt: 0.5 }} />}</Box>)}</Box>
            {device.resources_at && isStale(device.resources_at) && <Typography variant="caption" color="warning.main" display="block" sx={{ mt: 1.5 }}>Измерения ресурсов устарели: {formatTime(device.resources_at)}.</Typography>}
            {stale && current.last_success_at && <Typography variant="caption" color="warning.main" display="block" sx={{ mt: 1.5 }}>Показаны последние известные данные. Новых успешных измерений пока нет.</Typography>}
          </Paper>}
          <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" scrollButtons="auto" aria-label="Данные устройства" sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 44 }}>{TABS.map(([value, label]) => <Tab key={value} id={`monitoring-tab-${value}`} aria-controls={`monitoring-panel-${value}`} value={value} label={label} sx={{ textTransform: 'none', minHeight: 44 }} />)}</Tabs>
          <Box role="tabpanel" id={`monitoring-panel-${tab}`} aria-labelledby={`monitoring-tab-${tab}`} sx={{ minWidth: 0 }}>
            {(tab === 'overview' || tab === 'graphs') && <Stack spacing={2.5}>
              <Stack direction={{ xs: 'column', sm: 'row' }} gap={2} alignItems={{ sm: 'center' }}><Stack direction="row" gap={1} alignItems="center" sx={{ flex: 1, minWidth: 0 }}><TextField select label="Интерфейс для графиков" value={interfaceId} onChange={(e) => { setInterfaceId(e.target.value); }} sx={{ minWidth: 0, flex: 1 }} size="small">{interfaces.map((item) => <MenuItem value={item.id} key={item.id}>{item.name}{item.settings?.pinned ? ' · закреплён' : ''}{item.settings?.critical ? ' · важный' : ''}</MenuItem>)}</TextField>{canManage && selectedInterface && <Tooltip title={selectedInterface.settings?.pinned ? 'Открепить интерфейс: автоматический выбор для карточки' : 'Закрепить интерфейс для карточки и начальных графиков'}><span><IconButton onClick={togglePin} disabled={Boolean(pinningId) || probing || Boolean(deletingId)} aria-label={`${selectedInterface.settings?.pinned ? 'Открепить' : 'Закрепить'} ${selectedInterface.name}`} aria-pressed={Boolean(selectedInterface.settings?.pinned)} color={selectedInterface.settings?.pinned ? 'primary' : 'default'} sx={{ width: 40, height: 40 }}>{pinningId ? <CircularProgress size={18} /> : selectedInterface.settings?.pinned ? <PushPinRoundedIcon /> : <PushPinOutlinedIcon />}</IconButton></span></Tooltip>}</Stack><TextField select size="small" label="Период" value={hours} onChange={(e) => { setHours(Number(e.target.value)); }} sx={{ minWidth: 170 }}>{PERIODS.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField></Stack>
              {interfaces.some((row) => row.settings?.pinned) && <Typography variant="caption" color="text.secondary">Закреплён для карточки: {interfaces.find((row) => row.settings?.pinned).name}. Оповещения о потере линка настраиваются через «Важный интерфейс».</Typography>}
              {!hours && <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>{[['start', 'С начала'], ['end', 'До']].map(([key, label]) => <TextField key={key} type="datetime-local" label={label} size="small" InputLabelProps={{ shrink: true }} value={customPeriod[key]} onChange={(e) => { setCustomPeriod((old) => ({ ...old, [key]: e.target.value })); }} error={!customValid} helperText={!customValid ? 'Нужен прошедший период до года' : ''} />)}</Stack>}
              {systemHistory.error && <Alert severity="warning" action={<Button onClick={systemHistory.reload}>Повторить</Button>}>Графики устройства: {systemHistory.error}</Alert>}
              {portHistory.error && <Alert severity="warning" action={<Button onClick={portHistory.reload}>Повторить</Button>}>Графики интерфейса: {portHistory.error}</Alert>}
              {selectedInterface && selectedInterface.settings?.history_enabled === false && <Alert severity="info">История этого интерфейса отключена. Ранее собранные данные доступны в выбранном периоде.</Alert>}
              <Paper variant="outlined" sx={{ px: 2.5, py: 1.5, borderRadius: '16px' }}><Stack direction="row" gap={3} flexWrap="wrap"><Typography variant="body2">Принято за измеренные интервалы: <b>{formatBytes(interfaceHistory?.totals?.rx_bytes)}</b></Typography><Typography variant="body2">Передано: <b>{formatBytes(interfaceHistory?.totals?.tx_bytes)}</b></Typography><Typography variant="caption" color="text.secondary">Покрытие: {formatNumber((interfaceHistory?.totals?.rx_seconds ?? 0) / 60, 0)} мин. из {formatNumber(periodHours * 60, 0)}. Пропущенные интервалы не включаются.</Typography></Stack></Paper>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', lg: 'minmax(0,1.4fr) minmax(0,1fr)' }, gap: 2.5 }}><MonitoringChart title={`Трафик${selectedInterface ? ` · ${selectedInterface.name}` : ''}`} subtitle="Мбит/с · фактический приём и передача" points={portPoints} series={TRAFFIC} unit="bps" tall loading={portHistory.loading} /><MonitoringChart title="Загрузка канала" subtitle="Относительно заданной ёмкости или скорости порта" points={portPoints} series={UTILIZATION} unit="%" threshold={selectedInterface?.settings?.utilization_warn ?? 85} tall loading={portHistory.loading} /></Box>
              {latencyHistory.error && <Alert severity="error" action={<Button color="inherit" onClick={latencyHistory.reload}>Повторить</Button>}>График задержки: {latencyHistory.error}</Alert>}
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'repeat(2,minmax(0,1fr))' }, gap: 2.5 }}><MonitoringChart title="Ресурсы устройства" subtitle="CPU и использование памяти" points={systemPoints} series={RESOURCES} unit="%" loading={systemHistory.loading} /><MonitoringChart title="Задержка до устройства" subtitle={latencySubtitle} points={latencyPoints} series={LATENCY} unit="мс" quality={latencyHistory.data?.resolution_seconds === 10} loading={latencyHistory.loading} /></Box>
              {tab === 'graphs' && <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'repeat(2,minmax(0,1fr))' }, gap: 2.5 }}><MonitoringChart title="Скорость соединения" subtitle="Согласованная скорость линка · Мбит/с" points={portPoints} series={SPEED} unit="bps" stepped loading={portHistory.loading} /><MonitoringChart title="Ошибки пакетов" subtitle="Прирост счётчиков, пакетов/с" points={portPoints} series={ERRORS} loading={portHistory.loading} /><MonitoringChart title="Доступность ICMP и SNMP" subtitle="Доля успешных измерений · %" points={availabilityPoints} series={AVAILABILITY} unit="%" stepped loading={systemHistory.loading} /><MonitoringChart title="Отбрасывания пакетов" subtitle="Пакетов/с по направлениям" points={portPoints} series={DISCARDS} loading={portHistory.loading} /><MonitoringChart title="Потери ICMP" subtitle="Группа из трёх запросов от HUB" points={systemPoints} series={LOSS} unit="%" loading={systemHistory.loading} /><MonitoringChart title="Использование хранилища" subtitle="При поддержке HOST-RESOURCES-MIB" points={systemPoints} series={STORAGE} unit="%" loading={systemHistory.loading} /><MonitoringChart title="Температура" subtitle="Поддерживаемый датчик платы" points={systemPoints} series={TEMPERATURE} unit="°C" loading={systemHistory.loading} /></Box>}
              <Typography variant="caption" color="text.secondary">Провалы данных отображаются разрывами. Низкий трафик не означает снижение доступной скорости интернета. История начинается с включения сбора HUB.</Typography>
            </Stack>}
            {tab === 'interfaces' && <MonitoringInterfaces items={interfaces} canManage={canManage} onConfigure={setInterfaceDialog} onSelect={selectInterface} />}
            {tab === 'events' && <MonitoringEvents events={detail?.events || []} />}
          </Box>
        </Stack>
      </Box>}
      <Typography variant="caption" color="text.secondary" role="status" aria-live="polite">{data?.checked_at ? `Сводка обновлена: ${formatTime(data.checked_at)}` : ''}</Typography>
    </Stack>
    {canManage && <MonitoringTargetDialog open={targetDialog.open} target={targetDialog.target} onClose={() => setTargetDialog({ open: false, target: null })} onSaved={(target) => { patchTarget(target); if (target.id === selectedId) setDetail((old) => ({ ...old, ...target })); setSelectedId(target.id); }} />}
    {canManage && <MonitoringInterfaceDialog targetId={selectedId} item={interfaceDialog} onClose={() => setInterfaceDialog(null)} onSaved={(item) => applyInterfaceSaved(item, selectedId)} />}
  </PageShell></MainLayout>;
}
