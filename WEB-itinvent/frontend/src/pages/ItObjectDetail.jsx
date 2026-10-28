import { useCallback, useEffect, useRef, useState } from 'react';
import { Link as RouterLink, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
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
} from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import PageTopBar from '../components/layout/PageTopBar';
import ItObjectUserPicker from '../components/itObjects/ItObjectUserPicker';
import { itObjectsAPI } from '../api/itObjects';
import { passwordsAPI } from '../api/passwords';
import {
  LEVEL_LABELS,
  SECTION_KEYS,
  SECTION_LABELS,
  getItObjectsErrorMessage,
  isItObjectsRequestCancelled,
} from '../components/itObjects/itObjectsShared';


function OverviewTab({ object }) {
  const sections = Object.entries(object.my_access?.sections || {});
  return (
    <Stack spacing={1.5}>
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
        Пароли, компьютеры и инвентарь объекта подключены; доступ к каждому разделу выдаётся отдельно.
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

function PasswordsAudit({ objectRef }) {
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
  }, [objectRef]);

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
  const [state, setState] = useState({ loading: true, items: [], error: '' });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, items: [], error: '' });
    passwordsAPI.getEntries({ object_ref: objectRef, limit: 100 })
      .then((payload) => {
        if (!cancelled) setState({ loading: false, items: Array.isArray(payload?.items) ? payload.items : [], error: '' });
      })
      .catch((requestError) => {
        if (!cancelled) {
          setState({ loading: false, items: [], error: getItObjectsErrorMessage(requestError, 'Не удалось загрузить пароли объекта') });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [objectRef]);

  return (
    <Stack spacing={1.5}>
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1 }}>
          <Typography variant="subtitle2" fontWeight={800}>
            Пароли объекта · {level === 'manage' ? 'управление' : 'просмотр'}
          </Typography>
          <Button
            component={RouterLink}
            to={`/passwords?object=${encodeURIComponent(objectRef)}`}
            size="small"
            variant="outlined"
          >
            Открыть в разделе «Пароли»
          </Button>
        </Stack>
        {state.loading ? <LinearProgress aria-label="Загрузка паролей" /> : null}
        {state.error ? <Alert severity="warning">{state.error}</Alert> : null}
        {!state.loading && !state.error && !state.items.length ? (
          <Typography color="text.secondary">Паролей у этого объекта пока нет.</Typography>
        ) : null}
        {state.items.map((entry) => (
          <Stack key={entry.id} direction="row" spacing={1} alignItems="baseline" useFlexGap flexWrap="wrap" sx={{ py: 0.5 }}>
            <Typography fontWeight={700}>{entry.login}</Typography>
            <Chip size="small" variant="outlined" label={entry.group} />
            {entry.description ? <Typography variant="body2" color="text.secondary">{entry.description}</Typography> : null}
          </Stack>
        ))}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Сами пароли открываются в разделе «Пароли» после подтверждения вторым фактором.
        </Typography>
      </Paper>
      {level === 'manage' ? <PasswordsAudit objectRef={objectRef} /> : null}
    </Stack>
  );
}

function StructureTab({ object, busy, onAssign, onClear }) {
  const [candidate, setCandidate] = useState(null);
  return (
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
  );
}

function AccessTab({ object, busy, onGrant, onRevoke }) {
  const [candidate, setCandidate] = useState(null);
  const [section, setSection] = useState(SECTION_KEYS[0]);
  const [level, setLevel] = useState('view');
  return (
    <Stack spacing={1.5}>
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>Выдать доступ</Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'center' }}>
          <ItObjectUserPicker label="Сотрудник" value={candidate} onChange={setCandidate} disabled={busy} />
          <TextField select size="small" label="Раздел" value={section} onChange={(event) => setSection(event.target.value)} sx={{ minWidth: 160, '& .MuiInputBase-root': { minHeight: 44 } }}>
            {SECTION_KEYS.map((key) => <MenuItem key={key} value={key}>{SECTION_LABELS[key]}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Уровень" value={level} onChange={(event) => setLevel(event.target.value)} sx={{ minWidth: 160, '& .MuiInputBase-root': { minHeight: 44 } }}>
            {Object.entries(LEVEL_LABELS).map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
          </TextField>
          <Button
            variant="contained"
            disabled={busy || !candidate}
            onClick={async () => {
              if (await onGrant({ userId: candidate.id, section, level })) setCandidate(null);
            }}
            sx={{ minHeight: 44, flexShrink: 0, textTransform: 'none' }}
          >
            Выдать
          </Button>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>Выданный доступ</Typography>
        {object.grants?.length ? (
          <Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />} spacing={1}>
            {object.grants.map((grant) => (
              <Stack key={`${grant.user_id}:${grant.section}`} direction="row" alignItems="center" spacing={1} sx={{ pt: 1 }}>
                <Typography sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }} fontWeight={650}>{grant.user_name}</Typography>
                <Chip size="small" variant="outlined" label={`${SECTION_LABELS[grant.section] || grant.section}: ${LEVEL_LABELS[grant.level] || grant.level}`} />
                <Tooltip title="Отозвать доступ">
                  <span>
                    <IconButton
                      size="small"
                      disabled={busy}
                      aria-label={`Отозвать доступ: ${grant.user_name}, ${SECTION_LABELS[grant.section] || grant.section}`}
                      onClick={() => void onRevoke(grant)}
                      sx={{ width: 36, height: 36 }}
                    >
                      <DeleteOutlineRoundedIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            ))}
          </Stack>
        ) : (
          <Typography color="text.secondary">Доступ пока никому не выдан.</Typography>
        )}
      </Paper>
    </Stack>
  );
}

const COMPUTER_STATUS = {
  online: { label: 'В сети', color: 'success' },
  stale: { label: 'Давно не выходил', color: 'warning' },
  offline: { label: 'Не в сети', color: 'default' },
  unknown: { label: 'Нет данных', color: 'default' },
};

function ComputersTab({ objectRef }) {
  const [state, setState] = useState({ loading: true, items: [], error: '' });

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
          <Stack key={item.mac_address || item.hostname} direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap" sx={{ py: 0.75 }}>
            <Typography fontWeight={700} sx={{ minWidth: 140 }}>{item.hostname || '—'}</Typography>
            <Chip size="small" color={status.color} variant={status.color === 'default' ? 'outlined' : 'filled'} label={status.label} />
            {item.user_full_name ? <Typography variant="body2">{item.user_full_name}</Typography> : null}
            {item.ip_primary ? <Typography variant="body2" color="text.secondary">{item.ip_primary}</Typography> : null}
            {item.inventory_inv_no ? <Chip size="small" variant="outlined" label={`Инв. ${item.inventory_inv_no}`} /> : null}
            {item.inventory_model_name ? <Typography variant="body2" color="text.secondary">{item.inventory_model_name}</Typography> : null}
          </Stack>
        );
      })}
    </Paper>
  );
}

function InventoryTab({ objectRef }) {
  const [state, setState] = useState({ loading: true, items: [], total: 0, page: 0, error: '' });

  const loadPage = useCallback(async (page, { append = false, signal } = {}) => {
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const payload = await itObjectsAPI.inventory(objectRef, { page, signal });
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setState((prev) => ({
        loading: false,
        items: append ? [...prev.items, ...items] : items,
        total: Number(payload?.total) || 0,
        page,
        error: '',
      }));
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
    void loadPage(1, { signal: controller.signal });
    return () => controller.abort();
  }, [loadPage]);

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 1 }}>
        <Typography variant="subtitle2" fontWeight={800}>Инвентарь объекта · {state.total}</Typography>
        <Button size="small" variant="outlined" onClick={() => void loadPage(1)} disabled={state.loading}>Обновить</Button>
      </Stack>
      {state.loading ? <LinearProgress aria-label="Загрузка инвентаря" /> : null}
      {state.error ? <Alert severity="warning">{state.error}</Alert> : null}
      {!state.loading && !state.error && !state.items.length ? (
        <Typography color="text.secondary">На этом объекте пока нет оборудования.</Typography>
      ) : null}
      {state.items.map((item) => (
        <Stack key={item.id || item.inv_no} direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap" sx={{ py: 0.75 }}>
          <Chip size="small" variant="outlined" label={`Инв. ${item.inv_no || '—'}`} />
          <Typography fontWeight={700}>{[item.type_name, item.model_name].filter(Boolean).join(' · ') || '—'}</Typography>
          {item.status ? <Chip size="small" label={item.status} /> : null}
          {item.employee_name ? <Typography variant="body2">{item.employee_name}</Typography> : null}
          {item.location ? <Typography variant="body2" color="text.secondary">{item.location}</Typography> : null}
          {item.serial_no ? <Typography variant="body2" color="text.secondary">S/N {item.serial_no}</Typography> : null}
        </Stack>
      ))}
      {state.items.length < state.total ? (
        <Button size="small" sx={{ mt: 1 }} disabled={state.loading} onClick={() => void loadPage(state.page + 1, { append: true })}>
          Показать ещё
        </Button>
      ) : null}
    </Paper>
  );
}

export default function ItObjectDetail() {
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
    ...(object?.my_access?.sections?.computers ? [['computers', 'Компьютеры']] : []),
    ...(object?.my_access?.sections?.inventory ? [['inventory', 'Инвентарь']] : []),
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

          {object ? (
            <Box>
              {activeTab === 'overview' ? <OverviewTab object={object} /> : null}
              {activeTab === 'passwords' ? <PasswordsTab objectRef={objectRef} level={passwordsLevel} /> : null}
              {activeTab === 'computers' ? <ComputersTab objectRef={objectRef} /> : null}
              {activeTab === 'inventory' ? <InventoryTab objectRef={objectRef} /> : null}
              {activeTab === 'structure' ? (
                <StructureTab
                  object={object}
                  busy={busy}
                  onAssign={(userId) => runAction(() => itObjectsAPI.assignOwner(objectRef, userId), 'Не удалось назначить айтишника')}
                  onClear={() => runAction(() => itObjectsAPI.clearOwner(objectRef), 'Не удалось снять айтишника')}
                />
              ) : null}
              {activeTab === 'access' ? (
                <AccessTab
                  object={object}
                  busy={busy}
                  onGrant={(grant) => runAction(() => itObjectsAPI.grant(objectRef, grant), 'Не удалось выдать доступ')}
                  onRevoke={(grant) => runAction(() => itObjectsAPI.revoke(objectRef, { userId: grant.user_id, section: grant.section }), 'Не удалось отозвать доступ')}
                />
              ) : null}
            </Box>
          ) : null}
        </Stack>
      </PageShell>
    </MainLayout>
  );
}
