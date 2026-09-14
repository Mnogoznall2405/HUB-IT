import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import BusinessRoundedIcon from '@mui/icons-material/BusinessRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import Groups2OutlinedIcon from '@mui/icons-material/Groups2Outlined';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import ConstructionObjectSettingsDialog from '../components/construction/ConstructionObjectSettingsDialog';
import ConstructionPersonLink from '../components/construction/ConstructionPersonLink';
import { OBJECT_TEAM_ROLES } from '../components/construction/constructionShared';
import { useAuth } from '../contexts/AuthContext';
import { constructionAPI } from '../api/construction';
import { CONSTRUCTION_PORTFOLIO_FRESH_MS, portfolioSelection, rememberPortfolioSelection, readPortfolioCache, writePortfolioCache, clearConstructionPortfolioCache, portfolioCacheGeneration } from '../lib/constructionPortfolioCache';


const AUTO_REFRESH_MS = 5 * 60 * 1000;
const SEARCH_DEBOUNCE_MS = 350;

const KIND_OPTIONS = [
  { value: 'all', label: 'Все карточки' },
  { value: 'project', label: 'Объекты' },
  { value: 'general', label: 'Общие заявки' },
  { value: 'unassigned', label: 'Без группы' },
];

const formatDate = (value, withTime = false) => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat('ru-RU', withTime
    ? { dateStyle: 'short', timeStyle: 'short' }
    : { day: '2-digit', month: '2-digit', year: 'numeric' }).format(parsed);
};

const formatNumber = (value) => new Intl.NumberFormat('ru-RU').format(Number(value) || 0);

const requestCountLabel = (value) => {
  const count = Number(value) || 0;
  const mod100 = count % 100;
  const mod10 = count % 10;
  const noun = mod100 >= 11 && mod100 <= 14
    ? 'заявок'
    : mod10 === 1
      ? 'заявка'
      : mod10 >= 2 && mod10 <= 4
        ? 'заявки'
        : 'заявок';
  return `${formatNumber(count)} ${noun}`;
};

const getErrorMessage = (error) => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (detail?.message) return String(detail.message);
  return error?.message || 'Не удалось загрузить портфель объектов из 1С';
};

const isCancelled = (error) => (
  error?.code === 'ERR_CANCELED'
  || error?.name === 'CanceledError'
  || error?.name === 'AbortError'
);

function Metric({ label, value, hint }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="h6" component="p" fontWeight={850} sx={{ lineHeight: 1.1 }}>
        {formatNumber(value)}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.25 }}>
        {label}
      </Typography>
      {hint ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
          {hint}
        </Typography>
      ) : null}
    </Box>
  );
}

function TeamPreview({ team = [] }) {
  const byRole = new Map(team.map((member) => [member.role_key, member]));
  return (
    <Box component="section" aria-label="Команда объекта">
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.5 }}>
        <Groups2OutlinedIcon fontSize="small" color="action" />
        <Typography variant="subtitle2" fontWeight={800}>Команда объекта</Typography>
      </Stack>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          gap: 0.5,
        }}
      >
        {OBJECT_TEAM_ROLES.map((role) => {
          const member = byRole.get(role.key);
          return (
          <Box
            key={role.key}
            sx={{
              minWidth: 0,
              overflowWrap: 'anywhere',
            }}
          >
            <Box sx={{ lineHeight: 1.35 }}>
            <Typography component="span" variant="caption" color="text.secondary" sx={{ mr: 0.75 }}>
              {role.label}:
            </Typography>
            <Typography component="span" variant="body2" fontWeight={700} sx={{ overflowWrap: 'anywhere', lineHeight: 1.35 }}>
              <ConstructionPersonLink member={member} />
            </Typography>
            </Box>
            {member?.position || member?.department ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere', lineHeight: 1.3 }}>
                {[member.position, member.department].filter(Boolean).join(' · ')}
              </Typography>
            ) : null}
          </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function ObjectCard({ item, prefersReducedMotion = false, canWrite = false, onConfigure }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const isProject = item.kind === 'project';
  const isGeneral = item.kind === 'general';
  const accent = isProject
    ? theme.palette.primary.main
    : isGeneral
      ? theme.palette.info.main
      : theme.palette.warning.main;
  const kindLabel = isProject ? 'Объект' : isGeneral ? 'Общий контур' : 'Требует разбора';
  const detailsId = `construction-object-${String(item.object_ref || '').replace(/[^a-zA-Z0-9_-]/g, '')}-details`;

  return (
    <Paper
      component="article"
      variant="outlined"
      sx={{
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRadius: 2,
        borderColor: alpha(accent, theme.palette.mode === 'dark' ? 0.44 : 0.28),
        boxShadow: `0 10px 28px ${alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.18 : 0.055)}`,
      }}
    >
      <Box sx={{ height: 3, bgcolor: accent }} />
      <Stack spacing={1} sx={{ p: 1.25 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
          <Box sx={{ minWidth: 0 }}>
            <Chip
              size="small"
              icon={isProject ? <BusinessRoundedIcon /> : isGeneral ? <Inventory2OutlinedIcon /> : <WarningAmberRoundedIcon />}
              label={kindLabel}
              color={isProject ? 'primary' : isGeneral ? 'info' : 'warning'}
              variant="outlined"
              sx={{ mb: 0.5, fontWeight: 750, height: 22 }}
            />
            <Typography component="h2" variant="h6" fontWeight={750} sx={{ overflowWrap: 'anywhere', lineHeight: 1.3, fontSize: 18 }}>
              {item.name}
            </Typography>
          </Box>
          <ApartmentRoundedIcon sx={{ color: accent, flexShrink: 0 }} aria-hidden="true" />
        </Stack>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 1,
            px: 1,
            py: 0.75,
            borderRadius: 1.5,
            bgcolor: alpha(accent, theme.palette.mode === 'dark' ? 0.12 : 0.055),
          }}
        >
          <Metric label="за 12 месяцев" value={item.request_count} />
          <Metric label="за 30 дней" value={item.requests_last_30_days} />
          <Metric label="проведено" value={item.posted_count} />
        </Box>

        {item.latest_request_number ? (
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <AssignmentOutlinedIcon fontSize="small" color="action" sx={{ mt: 0.15, flexShrink: 0 }} />
            <Box sx={{ minWidth: 0 }}>
              <Typography component="span" variant="caption" color="text.secondary" sx={{ mr: 0.75 }}>Последняя заявка</Typography>
              <Typography component="span" variant="body2" fontWeight={750} sx={{ overflowWrap: 'anywhere' }}>
                {item.latest_request_number} · {formatDate(item.latest_request_at)}
              </Typography>
            </Box>
          </Stack>
        ) : null}

        {item.department_names?.length ? (
          <Stack direction="row" useFlexGap flexWrap="wrap" spacing={0.65} aria-label="Подразделения">
            {item.department_names.slice(0, 2).map((name) => (
              <Chip key={name} size="small" label={name} sx={{ maxWidth: '100%', height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal', py: 0.25, lineHeight: 1.3 } }} />
            ))}
            {item.department_names.length > 2 ? (
              <Chip size="small" variant="outlined" label={`ещё ${item.department_names.length - 2}`} />
            ) : null}
          </Stack>
        ) : null}

        {isProject ? <TeamPreview team={item.team} /> : (
          <Alert severity={isGeneral ? 'info' : 'warning'} icon={false} sx={{ py: 0.4 }}>
            {isGeneral
              ? 'Заявки общего назначения не входят в карточку строительного объекта.'
              : 'Для этих заявок в 1С не заполнена номенклатурная группа.'}
          </Alert>
        )}

        <Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: isProject && canWrite ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)', gap: 0.75 }}>
          {isProject ? (
            <Button
              component={RouterLink}
              to={`/construction/objects/${encodeURIComponent(item.managed_object_id || item.object_ref)}`}
              fullWidth
              variant="contained"
              aria-label="Открыть карточку объекта"
              startIcon={<ApartmentRoundedIcon />}
              sx={{ minHeight: { xs: 44, sm: 36 }, px: 1, borderRadius: 1.5 }}
            >
              Открыть
            </Button>
          ) : null}
          {isProject && canWrite ? (
            <Button
              fullWidth
              variant={item.managed ? 'outlined' : 'contained'}
              aria-label={item.managed ? 'Настроить объект' : 'Вести отдельно'}
              startIcon={item.managed ? <EditOutlinedIcon /> : <AddRoundedIcon />}
              onClick={() => onConfigure(item)}
              sx={{ minHeight: { xs: 44, sm: 36 }, px: 1, borderRadius: 1.5 }}
            >
              {item.managed ? 'Настроить' : 'Вести отдельно'}
            </Button>
          ) : null}
          </Box>
          <Button
            fullWidth
            variant="text"
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
            aria-controls={detailsId}
            endIcon={(
              <ExpandMoreRoundedIcon
                sx={{
                  transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: prefersReducedMotion
                    ? 'none'
                    : theme.transitions.create('transform', { duration: theme.transitions.duration.shorter }),
                }}
              />
            )}
            sx={{ minHeight: { xs: 44, sm: 36 }, justifyContent: 'space-between', mt: 0.25, px: 0.5 }}
          >
            {expanded ? 'Скрыть данные' : 'Последние заявки и склады'}
          </Button>
          <Collapse id={detailsId} in={expanded} timeout={prefersReducedMotion ? 0 : 'auto'} unmountOnExit>
            <Stack spacing={1.25} sx={{ pt: 1.25 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">Склады из заявок</Typography>
                <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                  {item.warehouse_names?.join(', ') || 'Не указаны'}
                </Typography>
              </Box>
              {item.source_groups?.length ? (
                <Box>
                  <Typography variant="caption" color="text.secondary">Номенклатурные группы 1С</Typography>
                  <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                    {item.source_groups.map((group) => group.group_name || group.group_ref).join(', ')}
                  </Typography>
                </Box>
              ) : null}
              <Box component="ol" sx={{ m: 0, pl: 2.5 }} aria-label="Последние заявки объекта">
                {(item.recent_requests || []).map((request) => (
                  <Box component="li" key={request.request_ref} sx={{ mb: 0.8, pl: 0.25 }}>
                    <Typography variant="body2" fontWeight={750} sx={{ overflowWrap: 'anywhere' }}>
                      {request.number || 'Без входящего номера'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                      {[formatDate(request.date), request.warehouse_name, request.responsible_name]
                        .filter((value) => value && value !== '—').join(' · ')}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Stack>
          </Collapse>
        </Box>
      </Stack>
    </Paper>
  );
}

function PortfolioSkeleton() {
  return (
    <Box
      aria-label="Загрузка карточек объектов"
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))',
        gap: 1.5,
      }}
    >
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} variant="rounded" height={330} sx={{ borderRadius: 3.5 }} />
      ))}
    </Box>
  );
}

export default function ConstructionObjects() {
  const { hasPermission, user } = useAuth();
  const initialSelection = portfolioSelection(user);
  const initialCache = readPortfolioCache(user, initialSelection.search, initialSelection.kind);
  const initialResponse = initialCache?.response;
  const canWrite = hasPermission('construction.write');
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)', { defaultMatches: false });
  const [searchInput, setSearchInput] = useState(initialSelection.search);
  const [search, setSearch] = useState(initialSelection.search);
  const [kind, setKind] = useState(initialSelection.kind);
  const [items, setItems] = useState(initialResponse?.items || []);
  const itemsRef = useRef(items);
  const [summary, setSummary] = useState(initialResponse?.summary || null);
  const [asOf, setAsOf] = useState(initialResponse?.as_of || '');
  const [windowFrom, setWindowFrom] = useState(initialResponse?.window_from || '');
  const [scanTruncated, setScanTruncated] = useState(Boolean(initialResponse?.scan_truncated));
  const [cache, setCache] = useState(initialResponse?.cache || null);
  const [managementAvailable, setManagementAvailable] = useState(initialResponse?.management_available !== false);
  const [hasMore, setHasMore] = useState(Boolean(initialResponse?.has_more));
  const [loading, setLoading] = useState(!initialResponse);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [settingsItem, setSettingsItem] = useState(undefined);
  const nextCursorRef = useRef(initialResponse?.next_cursor || '');
  const abortRef = useRef(null);
  const requestIdRef = useRef(0);
  const busyRef = useRef(false);
  const refreshRef = useRef(null);
  const lastSuccessAtRef = useRef(initialCache?.savedAt || 0);
  const applySnapshot = useCallback((response) => {
    itemsRef.current = response?.items || [];
    setItems(itemsRef.current);
    nextCursorRef.current = String(response?.next_cursor || '');
    setHasMore(Boolean(response?.has_more));
    setSummary(response?.summary || null);
    setAsOf(String(response?.as_of || ''));
    setWindowFrom(String(response?.window_from || ''));
    setScanTruncated(Boolean(response?.scan_truncated));
    setCache(response?.cache || null);
    setManagementAvailable(response?.management_available !== false);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  const loadObjects = useCallback(async ({
    append = false,
    silent = false,
    forceRefresh = false,
    cancelPrevious = false,
  } = {}) => {
    if (busyRef.current && !cancelPrevious) return null;
    if (cancelPrevious) abortRef.current?.abort();
    const controller = new AbortController();
    const cacheGeneration = portfolioCacheGeneration();
    abortRef.current = controller;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    busyRef.current = true;
    setError('');
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await constructionAPI.getObjects({
        search,
        kind,
        limit: 24,
        cursor: append ? nextCursorRef.current : '',
        refresh: forceRefresh,
        signal: controller.signal,
      });
      if (requestId !== requestIdRef.current) return null;
      const nextItems = Array.isArray(response?.items) ? response.items : [];
      const canAppend = append && !response?.snapshot_changed;
      const merged = new Map((canAppend ? itemsRef.current : []).map((item) => [item.object_ref, item]));
      nextItems.forEach((item) => merged.set(item.object_ref, item));
      const snapshot = { ...response, items: [...merged.values()] };
      applySnapshot(snapshot);
      writePortfolioCache(user, search, kind, snapshot, cacheGeneration);
      lastSuccessAtRef.current = Date.now();
      return response;
    } catch (requestError) {
      if (!isCancelled(requestError) && requestId === requestIdRef.current) {
        if ([401, 403].includes(requestError?.response?.status)) {
          clearConstructionPortfolioCache();
          applySnapshot(null);
        }
        setError(getErrorMessage(requestError));
      }
      return null;
    } finally {
      if (requestId === requestIdRef.current) {
        busyRef.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [kind, search, user, applySnapshot]);

  useEffect(() => {
    rememberPortfolioSelection(user, search, kind);
    const cached = readPortfolioCache(user, search, kind);
    abortRef.current?.abort();
    requestIdRef.current += 1;
    busyRef.current = false;
    setError('');
    setRefreshing(false);
    applySnapshot(cached?.response || null);
    setLoading(!cached);
    if (cached) lastSuccessAtRef.current = cached.savedAt;
    if (!cached || Date.now() - cached.savedAt >= CONSTRUCTION_PORTFOLIO_FRESH_MS) {
      void loadObjects({ cancelPrevious: true, silent: Boolean(cached) });
    }
  }, [loadObjects, user, search, kind, applySnapshot]);

  useEffect(() => {
    refreshRef.current = () => loadObjects({ silent: true });
  }, [loadObjects]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (
        document.visibilityState === 'visible'
        && Date.now() - lastSuccessAtRef.current >= AUTO_REFRESH_MS
      ) {
        void refreshRef.current?.();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshRef.current?.();
    }, AUTO_REFRESH_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(interval);
      abortRef.current?.abort();
    };
  }, []);

  const shownPeriod = useMemo(() => (
    windowFrom ? `Данные с ${formatDate(windowFrom)}` : 'Последние 12 месяцев'
  ), [windowFrom]);

  return (
    <MainLayout pageTitle="Объекты строительства">
      <PageShell sx={{ minWidth: 0, p: { xs: 1, sm: 2, lg: 2.5 }, '& .MuiButton-root': { textTransform: 'none', fontWeight: 600 }, '& input': { fontSize: { xs: 16, sm: 14 } } }}>
        <Stack spacing={{ xs: 1.5, sm: 2 }}>
          <Stack component="header" direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1.5}>
            <Box sx={{ minWidth: 0 }}>
              <Typography component="h1" variant="h4" fontWeight={900} sx={{ overflowWrap: 'anywhere' }}>
                Объекты строительства
              </Typography>
              <Typography color="text.secondary">
              Команды, направления, ход работ и снабжение объектов
              </Typography>
            </Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'stretch', sm: 'center' }} spacing={1}>
              <Typography variant="caption" color="text.secondary" role="status" aria-live="polite">
                {asOf ? `Обновлено ${formatDate(asOf, true)} · ${shownPeriod}` : 'Данные ещё не загружены'}
              </Typography>
              <Button
                variant="outlined"
                startIcon={<RefreshRoundedIcon />}
                onClick={() => void loadObjects({ silent: true, forceRefresh: true })}
                disabled={loading || refreshing}
                sx={{ minHeight: 44, flexShrink: 0 }}
              >
                Обновить
              </Button>
              {canWrite ? (
                <Button
                  variant="contained"
                  startIcon={<AddRoundedIcon />}
                  onClick={() => setSettingsItem(null)}
                  disabled={!managementAvailable}
                  sx={{ minHeight: 44, flexShrink: 0 }}
                >
                  Создать объект
                </Button>
              ) : null}
            </Stack>
          </Stack>

          <Paper
            component="section"
            aria-label="Сводка портфеля"
            variant="outlined"
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))',
              gap: 1.5,
              p: { xs: 1.5, sm: 2 },
              borderRadius: 3.5,
            }}
          >
            <Metric label="строительных объектов" value={summary?.project_count} />
            <Metric label="заявок за 12 месяцев" value={summary?.request_count} />
            <Metric label="заявок за 30 дней" value={summary?.requests_last_30_days} />
            <Metric label="общехозяйственных" value={summary?.general_request_count} />
            <Metric label="без группы" value={summary?.unassigned_request_count} />
          </Paper>

          <Paper
            component="section"
            aria-label="Поиск и фильтр объектов"
            variant="outlined"
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 1fr) minmax(190px, 0.35fr)' },
              gap: 1.25,
              p: 1.25,
              borderRadius: 3,
            }}
          >
            <TextField
              fullWidth
              size="small"
              label="Поиск"
              placeholder="Объект, номер заявки, подразделение, ответственный"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              InputProps={{
                startAdornment: <InputAdornment position="start"><SearchRoundedIcon /></InputAdornment>,
              }}
              sx={{ '& .MuiInputBase-root': { minHeight: 44, borderRadius: 2 } }}
            />
            <TextField
              select
              fullWidth
              size="small"
              label="Тип карточки"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
              sx={{ '& .MuiInputBase-root': { minHeight: 44, borderRadius: 2 } }}
            >
              {KIND_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
              ))}
            </TextField>
          </Paper>

          {loading || refreshing ? <LinearProgress aria-label={refreshing ? 'Обновление портфеля' : 'Загрузка портфеля'} /> : null}
          {error ? (
            <Alert severity="warning" action={<Button disabled={loading || refreshing} onClick={() => void loadObjects({ silent: true, forceRefresh: true })}>Повторить</Button>}>
              {error}. {items.length ? 'Показаны данные предыдущей успешной загрузки.' : 'Повторите попытку позже.'}
            </Alert>
          ) : null}
          {cache?.state === 'stale' ? (
            <Alert severity="warning">
              1С временно недоступна. Показан сохранённый снимок возрастом {formatNumber(cache.age_seconds)} сек.
            </Alert>
          ) : null}
          {canWrite && !managementAvailable ? (
            <Alert severity="warning">
              Заявки из 1С доступны, но база карточек объектов сейчас недоступна. Настройка команды временно отключена.
            </Alert>
          ) : null}
          {scanTruncated ? (
            <Alert severity="info">
              За год найдено не меньше 6000 заявок. Сводка достигла защитного предела и может быть неполной.
            </Alert>
          ) : null}

          {loading && !items.length ? <PortfolioSkeleton /> : items.length ? (
            <Box
              component="section"
              aria-label="Карточки объектов"
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))',
                gap: { xs: 1.25, sm: 1.75 },
                alignItems: 'start',
              }}
            >
              {items.map((item) => (
                <ObjectCard
                  key={item.object_ref}
                  item={item}
                  prefersReducedMotion={prefersReducedMotion}
                  canWrite={canWrite && managementAvailable}
                  onConfigure={setSettingsItem}
                />
              ))}
            </Box>
          ) : !loading ? (
            <Paper variant="outlined" sx={{ p: { xs: 2, sm: 4 }, borderRadius: 3.5, textAlign: 'center' }}>
              <BusinessRoundedIcon color="disabled" sx={{ fontSize: 44 }} />
              <Typography variant="h6" fontWeight={800} sx={{ mt: 1 }}>Объекты не найдены</Typography>
              <Typography color="text.secondary">
                Измените поиск или тип карточки.
              </Typography>
            </Paper>
          ) : null}

          {hasMore ? (
            <Button
              variant="outlined"
              onClick={() => void loadObjects({ append: true })}
              disabled={loading || refreshing}
              sx={{ minHeight: 44, alignSelf: 'center', minWidth: 180 }}
            >
              Показать ещё
            </Button>
          ) : null}

          <Typography variant="caption" color="text.secondary" textAlign="center">
            {summary ? `${requestCountLabel(summary.request_count)} · ${shownPeriod}` : 'Заявки и снабжение — по данным 1С'}
          </Typography>
        </Stack>
      </PageShell>
      <ConstructionObjectSettingsDialog
        open={settingsItem !== undefined}
        item={settingsItem || null}
        onClose={() => setSettingsItem(undefined)}
        onSaved={() => {
          setSettingsItem(undefined);
          void loadObjects({ silent: true, cancelPrevious: true });
        }}
      />
    </MainLayout>
  );
}
