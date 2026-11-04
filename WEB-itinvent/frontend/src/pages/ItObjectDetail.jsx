import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import PageTopBar from '../components/layout/PageTopBar';
import ItObjectTeamPanel from '../components/itObjects/ItObjectTeamPanel';
import ItObjectUserPicker from '../components/itObjects/ItObjectUserPicker';
import ObjectAccessMatrix from '../components/itObjects/ObjectAccessMatrix';
import ObjectDeleteDialog from '../components/itObjects/ObjectDeleteDialog';
import ObjectMonitoringDevicesDialog from '../components/itObjects/ObjectMonitoringDevicesDialog';
import ObjectPasswordsPanel from '../components/itObjects/ObjectPasswordsPanel';
import MonitoringDeviceGrid from './monitoring/MonitoringDeviceGrid';
import { compareMonitoringTargets, targetStatus } from './monitoring/monitoringFormat';
import EquipmentTable from './database/EquipmentTable';
import { databaseAPI } from '../api/database';
import { itObjectsAPI } from '../api/itObjects';
import { passwordsAPI } from '../api/passwords';
import { settingsAPI } from '../api/settings';
import { useAuth } from '../contexts/AuthContext';
import { setBranchForDatabase } from './database/databaseBranchPreferences';
import {
  LEVEL_LABELS,
  SECTION_LABELS,
  getItObjectsErrorMessage,
  isItObjectsRequestCancelled,
} from '../components/itObjects/itObjectsShared';


const SUMMARY_PASSWORDS_LIMIT = 100;

// Сводка по разделам объекта: по одному запросу на раздел, к которому у пользователя есть доступ.
async function loadSectionSummary(section, objectRef, signal) {
  if (section === 'passwords') {
    const payload = await passwordsAPI.getEntries({ object_ref: objectRef, limit: SUMMARY_PASSWORDS_LIMIT });
    const count = Array.isArray(payload?.items) ? payload.items.length : 0;
    return { value: count >= SUMMARY_PASSWORDS_LIMIT ? `${count}+` : String(count), caption: 'записей' };
  }
  if (section === 'computers') {
    const payload = await itObjectsAPI.computers(objectRef, { signal });
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const online = items.filter((item) => item.status === 'online').length;
    return { value: String(items.length), caption: items.length ? `в сети: ${online}` : 'с агентом', warn: items.length > 0 && online === 0 };
  }
  if (section === 'inventory') {
    const payload = await itObjectsAPI.inventory(objectRef, { page: 1, limit: 1, signal });
    return { value: String(Number(payload?.total) || 0), caption: 'единиц оборудования' };
  }
  const payload = await itObjectsAPI.monitoring(objectRef, { signal });
  const items = Array.isArray(payload?.targets) ? payload.targets : [];
  const problems = items.filter((item) => !['online', 'paused'].includes(targetStatus(item).key)).length;
  return { value: String(items.length), caption: problems ? `проблемы: ${problems}` : (items.length ? 'все в сети' : 'устройств'), warn: problems > 0 };
}

function SectionSummary({ object, objectRef, onOpenTab }) {
  const granted = object.my_access?.sections || {};
  const sections = ['passwords', 'computers', 'inventory', 'monitoring']
    .filter((section) => granted[section] && (object.linked !== false || ['passwords', 'monitoring'].includes(section)));
  const sectionsKey = sections.join('|');
  const [state, setState] = useState({});

  useEffect(() => {
    const controller = new AbortController();
    setState({});
    sectionsKey.split('|').filter(Boolean).forEach((section) => {
      loadSectionSummary(section, objectRef, controller.signal)
        .then((summary) => setState((prev) => ({ ...prev, [section]: summary })))
        .catch((requestError) => {
          if (isItObjectsRequestCancelled(requestError)) return;
          setState((prev) => ({ ...prev, [section]: { error: true } }));
        });
    });
    return () => controller.abort();
  }, [objectRef, sectionsKey]);

  if (!sections.length) return null;
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>Сводка по объекту</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 1 }}>
        {sections.map((section) => {
          const summary = state[section];
          return (
            <Box
              key={section}
              component="button"
              type="button"
              onClick={() => onOpenTab(section)}
              aria-label={`Открыть раздел ${SECTION_LABELS[section] || section}`}
              sx={{
                textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit', bgcolor: 'transparent',
                border: 1, borderColor: summary?.warn ? 'warning.main' : 'divider', borderRadius: 2, p: 1.5, minHeight: 44,
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Typography variant="caption" color="text.secondary">{SECTION_LABELS[section] || section}</Typography>
              {!summary ? <Skeleton width={48} height={32} /> : summary.error ? (
                <Typography variant="body2" color="text.secondary">Нет данных</Typography>
              ) : (
                <>
                  <Typography variant="h5" fontWeight={800}>{summary.value}</Typography>
                  <Typography variant="caption" color={summary.warn ? 'warning.main' : 'text.secondary'}>{summary.caption}</Typography>
                </>
              )}
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
}

function OverviewTab({ object, objectRef, onOpenTab }) {
  const sections = Object.entries(object.my_access?.sections || {});
  return (
    <Stack spacing={1.5}>
      <SectionSummary object={object} objectRef={objectRef} onOpenTab={onOpenTab} />
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 0.75 }}>Айтишник объекта</Typography>
        {object.owner ? (
          <Typography fontWeight={700}>{object.owner.user_name}</Typography>
        ) : (
          <Typography color="warning.main" fontWeight={650}>Не назначен</Typography>
        )}
      </Paper>
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 0.75 }}>Ваш доступ к разделам</Typography>
        {object.my_access?.is_owner ? (
          <Chip color="primary" label="Вы — айтишник объекта: все разделы" sx={{ fontWeight: 700 }} />
        ) : sections.length ? (
          <Stack direction="row" useFlexGap flexWrap="wrap" spacing={0.75}>
            {sections.map(([section, level]) => (
              <Chip key={section} variant="outlined" label={`${SECTION_LABELS[section] || section}: ${LEVEL_LABELS[level] || level}`} />
            ))}
          </Stack>
        ) : (
          <Typography color="text.secondary">Разделы этого объекта вам не выданы.</Typography>
        )}
      </Paper>
      <Alert severity="info">
        Пароли, компьютеры, инвентарь и мониторинг объекта подключены; доступ к каждому разделу выдаётся отдельно.
      </Alert>
    </Stack>
  );
}

const AUDIT_ACTIONS = {
  create: 'создал(а)',
  update: 'изменил(а)',
  archive: 'архивировал(а)',
  'reveal.show': 'открыл(а) пароль',
  'reveal.copy': 'скопировал(а) пароль',
};

function PasswordsAudit({ objectRef, reloadKey = 0 }) {
  const [state, setState] = useState({ loading: true, items: [], error: '' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true, items: [], error: '' });
    itObjectsAPI.passwordsAudit(objectRef, { signal: controller.signal })
      .then((payload) => setState({ loading: false, items: Array.isArray(payload?.items) ? payload.items : [], error: '' }))
      .catch((requestError) => {
        if (isItObjectsRequestCancelled(requestError)) return;
        setState({ loading: false, items: [], error: getItObjectsErrorMessage(requestError, 'Не удалось загрузить журнал') });
      });
    return () => controller.abort();
  }, [objectRef, reloadKey]);

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>Журнал: кто работал с паролями объекта</Typography>
      {state.loading ? <LinearProgress aria-label="Загрузка журнала" /> : null}
      {state.error ? <Alert severity="warning">{state.error}</Alert> : null}
      {!state.loading && !state.error && !state.items.length ? (
        <Typography color="text.secondary">Событий пока нет.</Typography>
      ) : null}
      {state.items.map((row) => (
        <Typography key={row.id} variant="body2" sx={{ py: 0.25 }}>
          {row.created_at ? `${new Date(row.created_at).toLocaleString('ru-RU')} · ` : ''}
          <b>{row.actor_username}</b> {AUDIT_ACTIONS[row.action] || row.action} · {row.entry_login}
        </Typography>
      ))}
    </Paper>
  );
}

function PasswordsTab({ objectRef, level }) {
  const [journalKey, setJournalKey] = useState(0);
  const refreshJournal = useCallback(() => setJournalKey((key) => key + 1), []);
  return (
    <Stack spacing={1.5}>
      <ObjectPasswordsPanel objectRef={objectRef} level={level} onActivity={level === 'manage' ? refreshJournal : null} />
      {level === 'manage' ? <PasswordsAudit objectRef={objectRef} reloadKey={journalKey} /> : null}
    </Stack>
  );
}

function StructureTab({ object, busy, onAssign, onClear, onDelete, onSaveTeam }) {
  const [candidate, setCandidate] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <Stack spacing={1.5}>
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>Структура объекта</Typography>
      <Stack spacing={0.25} sx={{ mb: object.can_manage_owner ? 2 : 0 }}>
        <Typography variant="caption" color="text.secondary">Айтишник объекта</Typography>
        <Typography fontWeight={700}>{object.owner ? object.owner.user_name : 'Не назначен'}</Typography>
      </Stack>
      {object.can_manage_owner ? (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
          <ItObjectUserPicker label="Назначить айтишника" value={candidate} onChange={setCandidate} disabled={busy} />
          <Button
            variant="contained"
            disabled={busy || !candidate}
            onClick={async () => {
              if (await onAssign(candidate.id)) setCandidate(null);
            }}
            sx={{ minHeight: 44, flexShrink: 0, textTransform: 'none' }}
          >
            Назначить
          </Button>
          {object.owner ? (
            <Button
              color="inherit"
              variant="outlined"
              disabled={busy}
              onClick={() => void onClear()}
              sx={{ minHeight: 44, flexShrink: 0, textTransform: 'none' }}
            >
              Снять
            </Button>
          ) : null}
        </Stack>
      ) : null}
    </Paper>
    <ItObjectTeamPanel object={object} busy={busy} onSave={onSaveTeam} />
    {object.can_manage_owner && !object.hidden ? (
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 0.5 }}>Удаление объекта</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Объект пропадёт из списка, а его разделы станут недоступны. Права и журнал сохранятся, объект можно вернуть.
        </Typography>
        <Button color="error" variant="outlined" disabled={busy} onClick={() => setConfirmDelete(true)} sx={{ minHeight: 44, textTransform: 'none' }}>
          Удалить объект
        </Button>
        <ObjectDeleteDialog
          name={object.name}
          open={confirmDelete}
          busy={busy}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            if (await onDelete()) setConfirmDelete(false);
          }}
        />
      </Paper>
    ) : null}
    </Stack>
  );
}

const COMPUTER_STATUS = {
  online: { label: 'В сети', color: 'success' },
  stale: { label: 'Давно не выходил', color: 'warning' },
  offline: { label: 'Не в сети', color: 'default' },
  unknown: { label: 'Нет данных', color: 'default' },
};

const MONITORING_REFRESH_MS = 15000;

function MonitoringTab({ objectRef, canManage }) {
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, items: [], error: '' });
  const [devicesOpen, setDevicesOpen] = useState(false);

  const requestSeqRef = useRef(0);
  const controllerRef = useRef(null);

  // `poll` ticks never overlap a request in flight; any other load supersedes the previous one,
  // so a late response of an older request cannot overwrite newer state (e.g. a removed link).
  const load = useCallback(async ({ silent = false, poll = false } = {}) => {
    if (poll && controllerRef.current) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const seq = ++requestSeqRef.current;
    if (!silent) setState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const payload = await itObjectsAPI.monitoring(objectRef, { signal: controller.signal });
      if (seq !== requestSeqRef.current) return;
      setState({ loading: false, items: Array.isArray(payload?.targets) ? payload.targets : [], error: '' });
    } catch (requestError) {
      if (isItObjectsRequestCancelled(requestError) || seq !== requestSeqRef.current) return;
      setState((prev) => ({ loading: false, items: silent ? prev.items : [], error: getItObjectsErrorMessage(requestError, 'Не удалось загрузить мониторинг объекта') }));
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [objectRef]);

  useEffect(() => {
    void load();
    const refresh = () => { if (document.visibilityState === 'visible') void load({ silent: true, poll: true }); };
    const timer = window.setInterval(refresh, MONITORING_REFRESH_MS);
    return () => {
      requestSeqRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
      window.clearInterval(timer);
    };
  }, [load]);

  const items = useMemo(() => [...state.items].sort(compareMonitoringTargets), [state.items]);

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2" fontWeight={800}>Устройства объекта · {items.length}</Typography>
        <Stack direction="row" spacing={1}>
          {canManage ? <Button size="small" variant="contained" onClick={() => setDevicesOpen(true)}>Устройства объекта</Button> : null}
          <Button size="small" variant="outlined" onClick={() => void load()} disabled={state.loading}>Обновить</Button>
        </Stack>
      </Stack>
      {state.loading ? <LinearProgress aria-label="Загрузка мониторинга" /> : null}
      {state.error ? <Alert severity="warning" sx={{ mb: 1 }}>{state.error}</Alert> : null}
      {!state.loading && !state.error && !items.length ? (
        <Typography color="text.secondary">К этому объекту пока не привязано ни одно устройство мониторинга. {canManage ? 'Добавьте устройства кнопкой «Устройства объекта».' : 'Привязку выполняет ответственный за объект.'}</Typography>
      ) : null}
      {items.length ? (
        <>
          <MonitoringDeviceGrid visible={items} onSelect={(deviceId) => navigate(`/monitoring?object=${encodeURIComponent(objectRef)}&device=${encodeURIComponent(deviceId)}`)} />
        </>
      ) : null}
      {canManage ? (
        <ObjectMonitoringDevicesDialog
          open={devicesOpen}
          objectRef={objectRef}
          attached={items}
          onChanged={() => load({ silent: true })}
          onClose={() => setDevicesOpen(false)}
        />
      ) : null}
    </Paper>
  );
}

const formatDuration = (seconds) => {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total < 0) return '';
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  return days ? `${days} д ${hours} ч` : `${hours} ч ${Math.floor((total % 3600) / 60)} мин`;
};
const formatEpoch = (value) => {
  const ts = Number(value);
  return Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toLocaleString('ru-RU') : '';
};
const percent = (value) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? `${Math.round(Number(value))}%` : '');

function computerDetailRows(item) {
  const disks = (Array.isArray(item.logical_disks) ? item.logical_disks : [])
    .map((disk) => {
      const total = Number(disk.total_gb);
      const free = Number(disk.free_gb);
      const name = disk.mountpoint || disk.display_name || disk.name || '';
      return name && Number.isFinite(total) ? `${name} — свободно ${Number.isFinite(free) ? Math.round(free) : '?'} из ${Math.round(total)} ГБ` : '';
    })
    .filter(Boolean);
  const adapters = (Array.isArray(item.network?.devices) ? item.network.devices : [])
    .map((device) => [device.name, (device.ipv4 || []).join(', '), device.connection_status].filter(Boolean).join(' · '))
    .filter(Boolean);
  const ips = Array.isArray(item.ip_list) && item.ip_list.length ? item.ip_list.join(', ') : item.ip_primary;
  return [
    ['Сотрудник', item.user_full_name || item.current_user],
    ['Логин', item.user_login],
    ['Филиал', item.branch_name],
    ['Расположение', item.location_name],
    ['IP-адреса', ips],
    ['MAC', item.mac_address],
    ['Инв. №', item.inventory_inv_no],
    ['Модель', item.inventory_model_name],
    ['Серийный №', item.system_serial],
    ['Процессор', item.cpu_model],
    ['Память', item.ram_gb ? `${item.ram_gb} ГБ` : ''],
    ['Загрузка CPU / ОЗУ', [percent(item.cpu_load_percent) && `CPU ${percent(item.cpu_load_percent)}`, percent(item.ram_used_percent) && `ОЗУ ${percent(item.ram_used_percent)}`].filter(Boolean).join(' · ')],
    ['Работает', formatDuration(item.uptime_seconds)],
    ['Последняя перезагрузка', formatEpoch(item.last_reboot_at)],
    ['Последний выход на связь', formatEpoch(item.last_seen_at)],
    ['Диски', disks.join('\n')],
    ['Сетевые адаптеры', adapters.join('\n')],
  ].filter(([, value]) => String(value || '').trim());
}

function ComputerDetailDialog({ objectRef, item, onClose }) {
  const [state, setState] = useState({ loading: false, detail: null, error: '' });
  const mac = item?.mac_address || '';

  useEffect(() => {
    if (!mac) return undefined;
    const controller = new AbortController();
    setState({ loading: true, detail: null, error: '' });
    itObjectsAPI.computer(objectRef, mac, { signal: controller.signal })
      .then((detail) => setState({ loading: false, detail, error: '' }))
      .catch((requestError) => {
        if (isItObjectsRequestCancelled(requestError)) return;
        setState({ loading: false, detail: null, error: getItObjectsErrorMessage(requestError, 'Не удалось загрузить данные компьютера') });
      });
    return () => controller.abort();
  }, [objectRef, mac]);

  const shown = item ? { ...item, ...(state.detail || {}) } : null;
  const status = COMPUTER_STATUS[shown?.status] || COMPUTER_STATUS.unknown;
  return (
    <Dialog open={Boolean(item)} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 800 }}>
        <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
          <span>{shown?.hostname || '—'}</span>
          <Chip size="small" color={status.color} variant={status.color === 'default' ? 'outlined' : 'filled'} label={status.label} />
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {state.loading ? <LinearProgress aria-label="Загрузка данных компьютера" sx={{ mb: 1 }} /> : null}
        {state.error ? <Alert severity="warning" sx={{ mb: 1 }}>{state.error}</Alert> : null}
        {shown ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '190px 1fr' }, columnGap: 2, rowGap: 0.75 }}>
            {computerDetailRows(shown).map(([label, value]) => (
              <Fragment key={label}>
                <Typography variant="body2" color="text.secondary">{label}</Typography>
                <Typography variant="body2" sx={{ overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}>{String(value).trim()}</Typography>
              </Fragment>
            ))}
          </Box>
        ) : null}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Закрыть</Button></DialogActions>
    </Dialog>
  );
}

function ComputersTab({ objectRef }) {
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const canOpenFull = String(user?.role || '').toLowerCase() === 'admin' || hasPermission('computers.read');
  const [state, setState] = useState({ loading: true, items: [], error: '' });
  const [selected, setSelected] = useState(null);

  // Полная карточка ПК (как на странице «Компьютеры») — тем, у кого есть право; остальным окно с основными данными.
  const openComputer = useCallback((item) => {
    if (canOpenFull && item.mac_address) {
      const back = `/it/objects/${encodeURIComponent(objectRef)}?tab=computers`;
      const params = new URLSearchParams({ open: item.mac_address, q: item.hostname || '', back });
      navigate(`/computers?${params.toString()}`);
      return;
    }
    setSelected(item);
  }, [canOpenFull, navigate, objectRef]);

  const load = useCallback(async (signal) => {
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const payload = await itObjectsAPI.computers(objectRef, { signal });
      setState({ loading: false, items: Array.isArray(payload?.items) ? payload.items : [], error: '' });
    } catch (requestError) {
      if (isItObjectsRequestCancelled(requestError)) return;
      setState({ loading: false, items: [], error: getItObjectsErrorMessage(requestError, 'Не удалось загрузить компьютеры объекта') });
    }
  }, [objectRef]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 1 }}>
        <Typography variant="subtitle2" fontWeight={800}>Компьютеры объекта · {state.items.length}</Typography>
        <Button size="small" variant="outlined" onClick={() => void load()} disabled={state.loading}>Обновить</Button>
      </Stack>
      {state.loading ? <LinearProgress aria-label="Загрузка компьютеров" /> : null}
      {state.error ? <Alert severity="warning">{state.error}</Alert> : null}
      {!state.loading && !state.error && !state.items.length ? (
        <Typography color="text.secondary">К этому объекту пока не привязан ни один компьютер с агентом.</Typography>
      ) : null}
      {state.items.map((item) => {
        const status = COMPUTER_STATUS[item.status] || COMPUTER_STATUS.unknown;
        return (
          <Stack
            key={item.mac_address || item.hostname}
            direction="row"
            spacing={1}
            alignItems="center"
            useFlexGap
            flexWrap="wrap"
            role="button"
            tabIndex={0}
            aria-label={`Открыть компьютер ${item.hostname || ''}`.trim()}
            onClick={() => openComputer(item)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openComputer(item);
              }
            }}
            sx={{ py: 0.75, px: 0.75, mx: -0.75, borderRadius: 1, cursor: 'pointer', '&:hover, &:focus-visible': { bgcolor: 'action.hover', outline: 'none' } }}
          >
            <Typography fontWeight={700} sx={{ minWidth: 140 }}>{item.hostname || '—'}</Typography>
            <Chip size="small" color={status.color} variant={status.color === 'default' ? 'outlined' : 'filled'} label={status.label} />
            {item.user_full_name ? <Typography variant="body2">{item.user_full_name}</Typography> : null}
            {item.ip_primary ? <Typography variant="body2" color="text.secondary">{item.ip_primary}</Typography> : null}
            {item.inventory_inv_no ? <Chip size="small" variant="outlined" label={`Инв. ${item.inventory_inv_no}`} /> : null}
            {item.inventory_model_name ? <Typography variant="body2" color="text.secondary">{item.inventory_model_name}</Typography> : null}
          </Stack>
        );
      })}
      <ComputerDetailDialog objectRef={objectRef} item={selected} onClose={() => setSelected(null)} />
    </Paper>
  );
}

const INVENTORY_PAGE_SIZE = 500;
const INVENTORY_MAX_PAGES = 20;
const INVENTORY_SEARCH_FIELDS = ['inv_no', 'serial_no', 'part_no', 'ip_address', 'type_name', 'model_name', 'employee_name', 'location'];
const INVENTORY_DETAIL_FIELDS = [
  ['inv_no', 'Инв. №'],
  ['type_name', 'Тип'],
  ['model_name', 'Модель'],
  ['vendor_name', 'Производитель'],
  ['serial_no', 'Серийный №'],
  ['part_no', 'Парт-номер'],
  ['ip_address', 'IP-адрес'],
  ['status', 'Статус'],
  ['employee_name', 'Сотрудник'],
  ['employee_dept', 'Отдел'],
  ['location', 'Расположение'],
  ['description', 'Описание'],
];

function uniqueSorted(items, field) {
  return [...new Set(items.map((item) => String(item[field] || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
}

function InventoryItemDialog({ item, onClose }) {
  return (
    <Dialog open={Boolean(item)} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 800 }}>
        {item ? [item.type_name, item.model_name].filter(Boolean).join(' · ') || `Инв. ${item.inv_no || '—'}` : ''}
      </DialogTitle>
      <DialogContent dividers>
        {item ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '160px 1fr' }, columnGap: 2, rowGap: 0.75 }}>
            {INVENTORY_DETAIL_FIELDS.filter(([field]) => String(item[field] || '').trim()).map(([field, label]) => (
              <Fragment key={field}>
                <Typography variant="body2" color="text.secondary">{label}</Typography>
                <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{String(item[field]).trim()}</Typography>
              </Fragment>
            ))}
          </Box>
        ) : null}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Закрыть</Button></DialogActions>
    </Dialog>
  );
}

function InventoryTab({ objectRef }) {
  const theme = useTheme();
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const canOpenInventory = String(user?.role || '').toLowerCase() === 'admin' || hasPermission('database.read');
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState('');

  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [state, setState] = useState({ loading: true, items: [], total: 0, databaseId: '', branchName: '', error: '' });
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [tableSort, setTableSort] = useState({ field: 'inv', direction: 'asc' });
  const [selected, setSelected] = useState(null);
  const tableBoxRef = useRef(null);
  const [fillHeight, setFillHeight] = useState(0);

  // Таблица занимает всё место от своего верха до низа окна.
  const measureFill = useCallback(() => {
    const node = tableBoxRef.current;
    if (!node || isMobile) {
      setFillHeight(0);
      return;
    }
    const top = node.getBoundingClientRect().top;
    setFillHeight(Math.max(320, Math.floor(window.innerHeight - top - 16)));
  }, [isMobile]);

  const load = useCallback(async (signal) => {
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      let items = [];
      let total = 0;
      let databaseId = '';
      let branchName = '';
      for (let page = 1; page <= INVENTORY_MAX_PAGES; page += 1) {
        const payload = await itObjectsAPI.inventory(objectRef, { page, limit: INVENTORY_PAGE_SIZE, signal });
        const chunk = Array.isArray(payload?.items) ? payload.items : [];
        total = Number(payload?.total) || 0;
        databaseId = String(payload?.database_id || databaseId);
        branchName = String(payload?.branch_name || branchName);
        items = items.concat(chunk);
        if (!chunk.length || items.length >= total) break;
      }
      setState({ loading: false, items, total, databaseId, branchName, error: '' });
    } catch (requestError) {
      if (isItObjectsRequestCancelled(requestError)) return;
      setState((prev) => ({
        ...prev,
        loading: false,
        error: getItObjectsErrorMessage(requestError, 'Не удалось загрузить инвентарь объекта'),
      }));
    }
  }, [objectRef]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const types = useMemo(() => uniqueSorted(state.items, 'type_name'), [state.items]);
  const statuses = useMemo(() => uniqueSorted(state.items, 'status'), [state.items]);
  const visibleItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return state.items.filter((item) => {
      if (typeFilter && item.type_name !== typeFilter) return false;
      if (statusFilter && item.status !== statusFilter) return false;
      if (!needle) return true;
      return INVENTORY_SEARCH_FIELDS.some((field) => String(item[field] || '').toLowerCase().includes(needle));
    });
  }, [state.items, search, typeFilter, statusFilter]);

  const handleTableSort = useCallback((field) => {
    setTableSort((prev) => ({ field, direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc' }));
  }, []);
  const handleAction = useCallback((action, item) => {
    if (action === 'view') setSelected(item);
  }, []);
  const noSelection = useMemo(() => new Set(), []);

  // Полный «Инвентарь» открывается уже на базе и филиале этого объекта (тот же выбор, что делается руками).
  const openInInventory = useCallback(async () => {
    setOpening(true);
    setOpenError('');
    try {
      await databaseAPI.switchDatabase(state.databaseId);
      localStorage.setItem('selected_database', state.databaseId);
      setBranchForDatabase(state.databaseId, state.branchName);
      await settingsAPI.updateMySettings({ database_branch_filters: { [state.databaseId]: state.branchName } }).catch(() => {});
      window.dispatchEvent(new CustomEvent('database-changed', { detail: { databaseId: state.databaseId } }));
      navigate('/database');
    } catch (requestError) {
      setOpenError(getItObjectsErrorMessage(requestError, 'Не удалось открыть Инвентарь'));
      setOpening(false);
    }
  }, [navigate, state.branchName, state.databaseId]);
  const filtered = Boolean(search.trim() || typeFilter || statusFilter);
  const hasTable = visibleItems.length > 0;

  useLayoutEffect(() => {
    measureFill();
    window.addEventListener('resize', measureFill);
    return () => window.removeEventListener('resize', measureFill);
  }, [measureFill, hasTable, state.loading, state.error, openError]);

  return (
    <Stack spacing={1.5}>
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} useFlexGap flexWrap={{ md: 'wrap' }} alignItems={{ md: 'center' }}>
          <TextField
            size="small"
            label="Поиск"
            placeholder="Инв. №, серийный, модель, сотрудник, расположение"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            sx={{ flex: { md: '1 1 240px' }, minWidth: { md: 240 }, '& .MuiInputBase-root': { minHeight: 44 } }}
          />
          <TextField select size="small" label="Тип" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} sx={{ minWidth: 200, '& .MuiInputBase-root': { minHeight: 44 } }}>
            <MenuItem value="">Все типы</MenuItem>
            {types.map((name) => <MenuItem key={name} value={name}>{name}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Статус" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} sx={{ minWidth: 180, '& .MuiInputBase-root': { minHeight: 44 } }}>
            <MenuItem value="">Все статусы</MenuItem>
            {statuses.map((name) => <MenuItem key={name} value={name}>{name}</MenuItem>)}
          </TextField>
          {canOpenInventory ? (
            <Button variant="contained" onClick={() => void openInInventory()} disabled={opening || !state.databaseId || !state.branchName} sx={{ minHeight: 44, whiteSpace: 'nowrap' }}>
              Открыть в Инвентаре
            </Button>
          ) : null}
          <Tooltip title="Обновить">
            <span>
              <IconButton aria-label="Обновить инвентарь" onClick={() => void load()} disabled={state.loading} sx={{ width: 44, height: 44 }}>
                <RefreshRoundedIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
          {filtered ? `Найдено ${visibleItems.length} из ${state.items.length}` : `Всего оборудования: ${state.total}`}
          {state.items.length < state.total ? ` · показаны первые ${state.items.length}` : ''}
        </Typography>
      </Paper>
      <Alert severity="info" icon={false}>
        Здесь только просмотр оборудования. Изменять его нужно в разделе «Инвентарь».
      </Alert>
      {state.loading ? <LinearProgress aria-label="Загрузка инвентаря" /> : null}
      {openError ? <Alert severity="warning">{openError}</Alert> : null}
      {state.error ? <Alert severity="warning">{state.error}</Alert> : null}
      {!state.loading && !state.error && !state.items.length ? (
        <Typography color="text.secondary">На этом объекте пока нет оборудования.</Typography>
      ) : null}
      {!state.loading && state.items.length && !visibleItems.length ? (
        <Typography color="text.secondary">По запросу ничего не найдено.</Typography>
      ) : null}
      {visibleItems.length ? (
        <Box ref={tableBoxRef}>
        <EquipmentTable
          fillHeight={fillHeight}
          items={visibleItems}
          isMobile={isMobile}
          theme={theme}
          selectedItemsSet={noSelection}
          tableSort={tableSort}
          onTableSort={handleTableSort}
          onSelectAll={() => {}}
          isAllSelected={false}
          isSomeSelected={false}
          onSelect={() => {}}
          onAction={handleAction}
          allowSelection={false}
          canWrite={false}
          showExtraColumns={false}
        />
        </Box>
      ) : null}
      <InventoryItemDialog item={selected} onClose={() => setSelected(null)} />
    </Stack>
  );
}

const UNLINKED_SECTIONS = ['passwords', 'monitoring'];

export default function ItObjectDetail() {
  const navigate = useNavigate();
  const { objectRef = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [object, setObject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const abortRef = useRef(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError('');
    try {
      const response = await itObjectsAPI.get(objectRef, { signal: controller.signal });
      if (abortRef.current === controller) setObject(response || null);
    } catch (requestError) {
      if (abortRef.current === controller && !isItObjectsRequestCancelled(requestError)) {
        setError(getItObjectsErrorMessage(requestError, 'Не удалось загрузить объект'));
      }
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  }, [objectRef]);

  useEffect(() => {
    setObject(null);
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const runAction = useCallback(async (action, fallback) => {
    setBusy(true);
    setActionError('');
    try {
      await action();
      await load();
      return true;
    } catch (requestError) {
      setActionError(getItObjectsErrorMessage(requestError, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }, [load]);

  const passwordsLevel = object?.my_access?.sections?.passwords || '';
  const tabs = [
    ['overview', 'Обзор'],
    ...(passwordsLevel ? [['passwords', 'Пароли']] : []),
    ...(object?.linked !== false && object?.my_access?.sections?.computers ? [['computers', 'Компьютеры']] : []),
    ...(object?.linked !== false && object?.my_access?.sections?.inventory ? [['inventory', 'Инвентарь']] : []),
    ...(object?.my_access?.sections?.monitoring ? [['monitoring', 'Мониторинг']] : []),
    ['structure', 'Структура'],
    ...(object?.can_manage_grants ? [['access', 'Доступ']] : []),
  ];
  const requestedTab = searchParams.get('tab');
  const activeTab = tabs.some(([value]) => value === requestedTab) ? requestedTab : 'overview';

  return (
    <MainLayout headerMode="integrated" pageTitle={object?.name || 'Объект ИТ'}>
      <PageShell sx={{ minWidth: 0, p: { xs: 1, sm: 2, lg: 2.5 } }}>
        <Stack spacing={{ xs: 1, sm: 1.25 }}>
          <PageTopBar
            sx={{ mb: 0 }}
            title={loading && !object ? <Skeleton width={190} height={30} component="span" sx={{ display: 'inline-block' }} /> : (object?.name || 'Объект ИТ')}
            tabs={(
              <Tabs
                value={activeTab}
                onChange={(_, value) => setSearchParams(value === 'overview' ? {} : { tab: value }, { replace: true })}
                aria-label="Разделы объекта"
                variant="scrollable"
                allowScrollButtonsMobile
                sx={{ minWidth: 0, maxWidth: '100%', minHeight: 40, '& .MuiTab-root': { minHeight: 40, py: 0.5, textTransform: 'none' } }}
              >
                {tabs.map(([value, label]) => <Tab key={value} value={value} label={label} />)}
              </Tabs>
            )}
            actions={(
              <>
                <Tooltip title="Обновить">
                  <span>
                    <IconButton size="small" aria-label="Обновить" onClick={() => void load()} disabled={loading || busy} sx={{ width: 36, height: 36 }}>
                      <RefreshRoundedIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="К объектам">
                  <IconButton component={RouterLink} to="/it/objects" size="small" aria-label="К объектам" sx={{ width: 36, height: 36 }}>
                    <ArrowBackRoundedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </>
            )}
          />

          {loading || busy ? <LinearProgress aria-label="Загрузка" /> : null}
          {error ? <Alert severity="warning" action={<Button disabled={loading} onClick={() => void load()}>Повторить</Button>}>{error}</Alert> : null}
          {actionError ? <Alert severity="error" onClose={() => setActionError('')}>{actionError}</Alert> : null}
          {object?.hidden ? (
            <Alert
              severity="warning"
              action={object.can_manage_owner ? (
                <Button color="inherit" disabled={busy} onClick={() => void runAction(() => itObjectsAPI.restore(objectRef), 'Не удалось вернуть объект')}>
                  Вернуть
                </Button>
              ) : null}
            >
              Объект удалён: он скрыт из списка, его разделы недоступны.
            </Alert>
          ) : null}
          {object && object.linked === false ? (
            <Alert severity="info">Объект не привязан к филиалу ITINVENT, поэтому компьютеров и инвентаря у него нет.</Alert>
          ) : null}

          {object ? (
            <Box>
              {activeTab === 'overview' ? <OverviewTab object={object} objectRef={objectRef} onOpenTab={(tab) => setSearchParams({ tab }, { replace: true })} /> : null}
              {activeTab === 'passwords' ? <PasswordsTab objectRef={objectRef} level={passwordsLevel} /> : null}
              {activeTab === 'computers' ? <ComputersTab objectRef={objectRef} /> : null}
              {activeTab === 'inventory' ? <InventoryTab objectRef={objectRef} /> : null}
              {activeTab === 'monitoring' ? <MonitoringTab objectRef={objectRef} canManage={object?.my_access?.sections?.monitoring === 'manage'} /> : null}
              {activeTab === 'structure' ? (
                <StructureTab
                  object={object}
                  busy={busy}
                  onAssign={(userId) => runAction(() => itObjectsAPI.assignOwner(objectRef, userId), 'Не удалось назначить айтишника')}
                  onClear={() => runAction(() => itObjectsAPI.clearOwner(objectRef), 'Не удалось снять айтишника')}
                  onSaveTeam={(roles) => runAction(() => itObjectsAPI.setTeam(objectRef, roles), 'Не удалось сохранить команду объекта')}
                  onDelete={async () => {
                    const done = await runAction(() => itObjectsAPI.hide(objectRef), 'Не удалось удалить объект');
                    if (done) navigate('/it/objects');
                    return done;
                  }}
                />
              ) : null}
              {activeTab === 'access' ? (
                <ObjectAccessMatrix
                  object={object}
                  busy={busy}
                  sectionKeys={object.linked === false ? UNLINKED_SECTIONS : undefined}
                  onSave={(userId, sections) => runAction(() => itObjectsAPI.setAccess(objectRef, userId, sections), 'Не удалось сохранить доступ')}
                />
              ) : null}
            </Box>
          ) : null}
        </Stack>
      </PageShell>
    </MainLayout>
  );
}
