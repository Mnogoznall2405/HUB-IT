import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import Groups2OutlinedIcon from '@mui/icons-material/Groups2Outlined';
import LocalShippingOutlinedIcon from '@mui/icons-material/LocalShippingOutlined';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import {
  ConstructionRequestCard,
  ConstructionRequestDetail,
  REQUEST_STAGES,
  formatConstructionDate,
} from '../components/construction/ConstructionRequestViews';
import { constructionAPI } from '../api/construction';


const AUTO_REFRESH_MS = 5 * 60 * 1000;
const SEARCH_DEBOUNCE_MS = 350;
const SCROLL_PANE_SX = {
  minHeight: 0,
  overflowY: 'auto',
  overscrollBehaviorY: 'contain',
  WebkitOverflowScrolling: 'touch',
  scrollbarGutter: { xs: 'auto', lg: 'stable' },
  '&:focus-visible': {
    outline: '3px solid',
    outlineColor: 'primary.main',
    outlineOffset: -3,
  },
};

const OBJECT_TABS = [
  ['overview', 'Обзор'],
  ['requests', 'Заявки'],
  ['supply', 'Снабжение'],
  ['structure', 'Структура'],
];

const ROLE_OPTIONS = [
  { key: 'project_lead', label: 'Руководитель проекта', hint: 'Отвечает за объект и итоговые решения' },
  { key: 'pto_manager', label: 'Менеджер ПТО', hint: 'Координирует техническую подготовку' },
  { key: 'umto_coordinator', label: 'Координатор УМТО', hint: 'Ведёт снабжение и движение заявок' },
];

const getErrorMessage = (error, fallback) => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (detail?.message) return String(detail.message);
  return error?.message || fallback;
};

const isCancelled = (error) => (
  error?.code === 'ERR_CANCELED'
  || error?.name === 'CanceledError'
  || error?.name === 'AbortError'
);

function Metric({ value, label, tone = 'primary' }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        minWidth: 0,
        p: 1.5,
        borderRadius: 3,
        bgcolor: (theme) => alpha(theme.palette[tone].main, theme.palette.mode === 'dark' ? 0.1 : 0.04),
      }}
    >
      <Typography variant="h5" component="p" fontWeight={900}>{Number(value) || 0}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.25 }}>{label}</Typography>
    </Paper>
  );
}

function TeamStructure({ team = [], history = [], detailed = false }) {
  const byRole = useMemo(() => new Map(team.map((member) => [member.role_key, member])), [team]);
  return (
    <Stack spacing={2}>
      <Box component="section" aria-labelledby="object-team-title">
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.25 }}>
          <Groups2OutlinedIcon color="primary" />
          <Box>
            <Typography id="object-team-title" component="h2" variant="h6" fontWeight={850}>Команда объекта</Typography>
            <Typography variant="body2" color="text.secondary">Постоянные роли из карточки HUB, сотрудники — из ЗУП</Typography>
          </Box>
        </Stack>
        <Box
          component="ol"
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(3, minmax(0, 1fr))' },
            gap: 1.25,
            m: 0,
            p: 0,
            listStyle: 'none',
          }}
        >
          {ROLE_OPTIONS.map((role, index) => {
            const member = byRole.get(role.key);
            return (
              <Paper
                component="li"
                key={role.key}
                variant="outlined"
                sx={{
                  position: 'relative',
                  minWidth: 0,
                  p: 1.5,
                  borderRadius: 3,
                  borderStyle: member ? 'solid' : 'dashed',
                  bgcolor: member ? 'background.paper' : 'action.hover',
                  '&::before': index ? {
                    content: '""',
                    position: 'absolute',
                    bgcolor: 'divider',
                    width: { xs: 2, md: 16 },
                    height: { xs: 13, md: 2 },
                    insetInlineStart: { xs: 22, md: -17 },
                    top: { xs: -14, md: 28 },
                  } : undefined,
                }}
              >
                <Typography variant="overline" color="primary.main" fontWeight={850}>{role.label}</Typography>
                <Typography variant="subtitle1" fontWeight={850} sx={{ overflowWrap: 'anywhere' }}>
                  {member?.full_name || 'Не назначен'}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                  {member ? [member.position, member.department].filter(Boolean).join(' · ') || role.hint : role.hint}
                </Typography>
                {detailed && member?.employee_code ? (
                  <Typography variant="caption" color="text.secondary">Код ЗУП: {member.employee_code}</Typography>
                ) : null}
              </Paper>
            );
          })}
        </Box>
      </Box>

      {detailed ? (
        <Paper component="section" variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 3 }}>
          <Typography component="h2" variant="h6" fontWeight={850}>История назначений</Typography>
          {history.length ? (
            <Box component="ol" sx={{ m: 0, mt: 1, pl: 2.5 }}>
              {history.map((member, index) => (
                <Box component="li" key={`${member.role_key}-${member.employee_code}-${member.valid_from}-${index}`} sx={{ mb: 1 }}>
                  <Typography variant="body2" fontWeight={750}>
                    {ROLE_OPTIONS.find((role) => role.key === member.role_key)?.label || member.role_key}: {member.full_name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatConstructionDate(member.valid_from)} — {member.valid_to ? formatConstructionDate(member.valid_to) : 'по настоящее время'}
                  </Typography>
                </Box>
              ))}
            </Box>
          ) : <Typography color="text.secondary" sx={{ mt: 1 }}>Изменений назначений пока нет.</Typography>}
        </Paper>
      ) : null}
    </Stack>
  );
}

function groupedByWarehouse(items) {
  const groups = new Map();
  items.forEach((item) => {
    const ref = item.warehouse_ref || '__unknown__';
    if (!groups.has(ref)) groups.set(ref, { ref, name: item.warehouse_name || 'Склад не указан', items: [] });
    groups.get(ref).items.push(item);
  });
  return [...groups.values()];
}

function RequestList({ items, selectedRef, loading, hasMore, onOpen, onLoadMore, facets }) {
  const groups = useMemo(() => groupedByWarehouse(items), [items]);
  const facetsByRef = useMemo(() => new Map(facets.map((item) => [item.ref, item])), [facets]);
  if (loading && !items.length) {
    return <Stack spacing={1}>{[0, 1, 2].map((item) => <Skeleton key={item} variant="rounded" height={190} />)}</Stack>;
  }
  if (!items.length) {
    return (
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, textAlign: 'center', borderRadius: 3 }}>
        <AssignmentOutlinedIcon color="disabled" sx={{ fontSize: 42 }} />
        <Typography variant="h6" fontWeight={850}>Заявки не найдены</Typography>
        <Typography color="text.secondary">Измените вкладку, поиск или фильтры.</Typography>
      </Paper>
    );
  }
  return (
    <>
      {groups.map((group) => (
        <Box component="section" key={group.ref} aria-labelledby={`object-warehouse-${group.ref}`} sx={{ mb: 1.5 }}>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="baseline"
            spacing={1}
            sx={{
              px: 0.5,
              py: 0.5,
              mb: 0.75,
              position: { lg: 'sticky' },
              top: { lg: 0 },
              zIndex: { lg: 2 },
              bgcolor: 'background.default',
            }}
          >
            <Typography id={`object-warehouse-${group.ref}`} component="h3" variant="subtitle2" fontWeight={850} sx={{ overflowWrap: 'anywhere' }}>
              {group.name}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
              {facetsByRef.get(group.ref)?.count ?? group.items.length}
            </Typography>
          </Stack>
          {group.items.map((item) => (
            <ConstructionRequestCard
              key={item.request_ref}
              item={item}
              selected={selectedRef === item.request_ref}
              onOpen={onOpen}
            />
          ))}
        </Box>
      ))}
      {hasMore ? (
        <Button fullWidth variant="outlined" onClick={onLoadMore} disabled={loading} sx={{ minHeight: 44 }}>
          {loading ? 'Загрузка…' : 'Показать ещё 25'}
        </Button>
      ) : null}
    </>
  );
}

function ContactCard({ title, member, description, icon }) {
  return (
    <Paper variant="outlined" sx={{ minWidth: 0, p: 1.5, borderRadius: 3 }}>
      <Stack direction="row" spacing={1.25} alignItems="flex-start">
        <Box
          aria-hidden="true"
          sx={{
            width: 38,
            height: 38,
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 2.5,
            bgcolor: (currentTheme) => alpha(currentTheme.palette.primary.main, currentTheme.palette.mode === 'dark' ? 0.16 : 0.08),
            color: 'primary.main',
          }}
        >
          {icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="overline" color="text.secondary" fontWeight={800}>{title}</Typography>
          <Typography variant="subtitle1" fontWeight={850} sx={{ overflowWrap: 'anywhere' }}>
            {member?.full_name || 'Не назначен'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {member
              ? [member.position, member.department].filter(Boolean).join(' · ') || description
              : description}
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
}

function RequestContactRoster({ title, description, people = [] }) {
  return (
    <Paper variant="outlined" sx={{ minWidth: 0, p: 1.5, borderRadius: 3 }}>
      <Typography component="h3" variant="subtitle1" fontWeight={850}>{title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{description}</Typography>
      {people.length ? (
        <Stack spacing={0.75}>
          {people.map((person) => (
            <Box
              key={person.name}
              sx={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                gap: 1,
                alignItems: 'baseline',
              }}
            >
              <Typography variant="body2" fontWeight={800} sx={{ overflowWrap: 'anywhere' }}>{person.name}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                Активных: {person.active_requests}
              </Typography>
            </Box>
          ))}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">В активных заявках не указан.</Typography>
      )}
    </Paper>
  );
}

function ObjectOverview({ summary, object, overview }) {
  const teamByRole = useMemo(
    () => new Map((object?.team || []).map((member) => [member.role_key, member])),
    [object?.team],
  );
  const stages = Array.isArray(overview?.stages) ? overview.stages : [];
  const departments = Array.isArray(overview?.departments) ? overview.departments : [];
  const warehouses = Array.isArray(overview?.warehouses) ? overview.warehouses : [];
  return (
    <Stack spacing={2}>
      <Box
        component="section"
        aria-label="Сводка заявок объекта"
        sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 145px), 1fr))', gap: 1.25 }}
      >
        <Metric value={summary.total} label="всего заявок в срезе" />
        <Metric value={summary.active} label="сейчас в работе" tone="info" />
        <Metric value={summary.history} label="доставлено или отменено" tone="success" />
        <Metric value={summary.overdue} label="просрочено" tone="warning" />
      </Box>

      <Paper component="section" variant="outlined" aria-labelledby="object-state-title" sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 3.5 }}>
        <Typography id="object-state-title" component="h2" variant="h6" fontWeight={850}>Общее состояние</Typography>
        <Typography variant="body2" color="text.secondary">
          Этапы всех активных заявок объекта, без повторения отдельных карточек.
        </Typography>
        <Stack direction="row" useFlexGap flexWrap="wrap" spacing={0.75} sx={{ mt: 1.5 }}>
          {stages.length ? stages.map((item) => (
            <Chip key={item.key} variant="outlined" color={item.key === 'needs_review' ? 'warning' : 'primary'} label={`${item.label} · ${item.count}`} />
          )) : <Chip variant="outlined" color="success" label="Активных заявок нет" />}
        </Stack>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))',
            gap: 1.25,
            mt: 1.5,
          }}
        >
          <Box>
            <Typography variant="caption" color="text.secondary">Склады назначения активных заявок</Typography>
            <Typography variant="body2" fontWeight={800} sx={{ overflowWrap: 'anywhere' }}>
              {warehouses.map((item) => `${item.name} · ${item.active_requests}`).join(', ') || 'Не определены'}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Подразделения активных заявок</Typography>
            <Typography variant="body2" fontWeight={800} sx={{ overflowWrap: 'anywhere' }}>
              {departments.map((item) => item.name).join(', ') || 'Не указаны'}
            </Typography>
          </Box>
        </Box>
      </Paper>

      <Box component="section" aria-labelledby="object-contacts-title">
        <Typography id="object-contacts-title" component="h2" variant="h6" fontWeight={850}>К кому обращаться</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
          Постоянная команда берётся из карточки HUB, закупщики и ответственные — из активных заявок 1С.
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' },
            gap: 1.25,
          }}
        >
          <ContactCard
            title="Руководитель проекта"
            member={teamByRole.get('project_lead')}
            description="По приоритетам, срокам и решениям по объекту"
            icon={<Groups2OutlinedIcon fontSize="small" />}
          />
          <ContactCard
            title="Менеджер ПТО"
            member={teamByRole.get('pto_manager')}
            description="По технической подготовке и комплектности заявки"
            icon={<AssignmentOutlinedIcon fontSize="small" />}
          />
          <ContactCard
            title="Координатор УМТО"
            member={teamByRole.get('umto_coordinator')}
            description="По общему снабжению и движению заявок объекта"
            icon={<LocalShippingOutlinedIcon fontSize="small" />}
          />
          <RequestContactRoster
            title="Закупщики по активным заявкам"
            description="К ним обращаться по заказу, резерву и поставщику"
            people={overview?.buyers || []}
          />
          <RequestContactRoster
            title="Ответственные за заявки"
            description="К ним обращаться по составу, количеству и требуемой дате"
            people={overview?.request_responsibles || []}
          />
        </Box>
      </Box>
    </Stack>
  );
}

function SupplyOverview({ summary, facets }) {
  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: 1.25 }}>
        <Metric value={summary.active} label="заявок в снабжении" tone="info" />
        <Metric value={summary.overdue} label="требуют внимания" tone="warning" />
        <Metric value={facets.length} label="складов назначения" tone="success" />
      </Box>
      <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 3.5 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <LocalShippingOutlinedIcon color="primary" />
          <Box>
            <Typography component="h2" variant="h6" fontWeight={850}>Снабжение объекта</Typography>
            <Typography variant="body2" color="text.secondary">
              Закупщик, поставщик и документы показаны внутри каждой заявки без повторения по строкам.
            </Typography>
          </Box>
        </Stack>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 1, mt: 1.5 }}>
          {facets.map((warehouse) => (
            <Paper key={warehouse.ref} variant="outlined" sx={{ p: 1.25, borderRadius: 2.5 }}>
              <Typography fontWeight={800} sx={{ overflowWrap: 'anywhere' }}>{warehouse.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                Активно: {warehouse.active_count} · завершено: {warehouse.history_count}
                {warehouse.overdue_count ? ` · просрочено: ${warehouse.overdue_count}` : ''}
              </Typography>
            </Paper>
          ))}
        </Box>
      </Paper>
    </Stack>
  );
}

export default function ConstructionObjectDetail() {
  const theme = useTheme();
  const isWide = useMediaQuery(theme.breakpoints.up('lg'));
  const navigate = useNavigate();
  const { objectId = '', requestRef = '' } = useParams();
  const basePath = `/construction/objects/${encodeURIComponent(objectId)}`;
  const [activeTab, setActiveTab] = useState(requestRef ? 'requests' : 'overview');
  const [object, setObject] = useState(null);
  const [view, setView] = useState('active');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('');
  const [warehouseRef, setWarehouseRef] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({ total: 0, active: 0, history: 0, overdue: 0 });
  const [overview, setOverview] = useState({ buyers: [], request_responsibles: [], departments: [], warehouses: [], stages: [] });
  const [sourceGroups, setSourceGroups] = useState([]);
  const [warehouseFacets, setWarehouseFacets] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [asOf, setAsOf] = useState('');
  const [windowFrom, setWindowFrom] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [cache, setCache] = useState(null);
  const [objectLoading, setObjectLoading] = useState(true);
  const [listLoading, setListLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [objectError, setObjectError] = useState('');
  const [listError, setListError] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const objectAbortRef = useRef(null);
  const listAbortRef = useRef(null);
  const detailAbortRef = useRef(null);
  const listBusyRef = useRef(false);
  const detailBusyRef = useRef(false);
  const nextCursorRef = useRef('');
  const refreshRef = useRef(null);
  const lastSuccessAtRef = useRef(0);

  useEffect(() => {
    const timeout = window.setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  const loadObject = useCallback(async () => {
    objectAbortRef.current?.abort();
    const controller = new AbortController();
    objectAbortRef.current = controller;
    setObjectLoading(true);
    setObjectError('');
    try {
      const response = await constructionAPI.getObject(objectId, { signal: controller.signal });
      setObject(response || null);
      return response;
    } catch (error) {
      if (!isCancelled(error)) setObjectError(getErrorMessage(error, 'Не удалось загрузить карточку объекта'));
      return null;
    } finally {
      if (objectAbortRef.current === controller) setObjectLoading(false);
    }
  }, [objectId]);

  const loadRequests = useCallback(async ({
    append = false,
    silent = false,
    forceRefresh = false,
    cancelPrevious = false,
  } = {}) => {
    if (listBusyRef.current && !cancelPrevious) return null;
    if (cancelPrevious) listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;
    listBusyRef.current = true;
    setListError('');
    if (silent) setRefreshing(true);
    else setListLoading(true);
    try {
      const response = await constructionAPI.getObjectRequests(objectId, {
        view,
        search,
        stage,
        overdue: overdueOnly ? true : undefined,
        warehouseRef,
        limit: 25,
        cursor: append ? nextCursorRef.current : '',
        refresh: forceRefresh,
        signal: controller.signal,
      });
      const nextItems = Array.isArray(response?.items) ? response.items : [];
      const canAppend = append && !response?.snapshot_changed;
      setItems((current) => {
        if (!canAppend) return nextItems;
        const byRef = new Map(current.map((item) => [item.request_ref, item]));
        nextItems.forEach((item) => byRef.set(item.request_ref, item));
        return [...byRef.values()];
      });
      nextCursorRef.current = String(response?.next_cursor || '');
      setHasMore(Boolean(response?.has_more));
      setSummary(response?.summary || { total: 0, active: 0, history: 0, overdue: 0 });
      setOverview(response?.overview || { buyers: [], request_responsibles: [], departments: [], warehouses: [], stages: [] });
      setSourceGroups(Array.isArray(response?.source_groups) ? response.source_groups : []);
      setWarehouseFacets(Array.isArray(response?.warehouse_facets) ? response.warehouse_facets : []);
      setAsOf(String(response?.as_of || ''));
      setWindowFrom(String(response?.window_from || ''));
      setTruncated(Boolean(response?.truncated));
      setCache(response?.cache || null);
      lastSuccessAtRef.current = Date.now();
      return response;
    } catch (error) {
      if (!isCancelled(error)) setListError(getErrorMessage(error, 'Не удалось загрузить заявки объекта'));
      return null;
    } finally {
      if (listAbortRef.current === controller) {
        listBusyRef.current = false;
        setListLoading(false);
        setRefreshing(false);
      }
    }
  }, [objectId, overdueOnly, search, stage, view, warehouseRef]);

  const loadDetail = useCallback(async (ref, { silent = false, cancelPrevious = false } = {}) => {
    if (!ref || (detailBusyRef.current && !cancelPrevious)) return null;
    if (cancelPrevious) detailAbortRef.current?.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;
    detailBusyRef.current = true;
    setDetailError('');
    if (!silent) setDetailLoading(true);
    try {
      const response = await constructionAPI.getObjectRequest(objectId, ref, { signal: controller.signal });
      setDetail(response || null);
      return response;
    } catch (error) {
      if (!isCancelled(error)) setDetailError(getErrorMessage(error, 'Не удалось загрузить заявку'));
      return null;
    } finally {
      if (detailAbortRef.current === controller) {
        detailBusyRef.current = false;
        setDetailLoading(false);
      }
    }
  }, [objectId]);

  useEffect(() => {
    void loadObject();
  }, [loadObject]);

  useEffect(() => {
    nextCursorRef.current = '';
    void loadRequests({ cancelPrevious: true });
  }, [loadRequests]);

  useEffect(() => {
    if (!requestRef) {
      detailAbortRef.current?.abort();
      setDetail(null);
      setDetailError('');
      return;
    }
    setActiveTab('requests');
    setDetail((current) => (current?.request_ref === requestRef ? current : null));
    void loadDetail(requestRef, { cancelPrevious: true });
  }, [loadDetail, requestRef]);

  useEffect(() => {
    if (isWide && activeTab === 'requests' && !requestRef && items.length) {
      navigate(`${basePath}/requests/${items[0].request_ref}`, { replace: true });
    }
  }, [activeTab, basePath, isWide, items, navigate, requestRef]);

  const refreshAll = useCallback(async ({ forceRefresh = false } = {}) => {
    if (document.visibilityState !== 'visible') return;
    const response = await loadRequests({ silent: true, forceRefresh });
    if (requestRef && response) await loadDetail(requestRef, { silent: true });
  }, [loadDetail, loadRequests, requestRef]);

  useEffect(() => {
    refreshRef.current = refreshAll;
  }, [refreshAll]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (
        document.visibilityState === 'visible'
        && Date.now() - lastSuccessAtRef.current >= AUTO_REFRESH_MS
      ) void refreshRef.current?.();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshRef.current?.();
    }, AUTO_REFRESH_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(interval);
      objectAbortRef.current?.abort();
      listAbortRef.current?.abort();
      detailAbortRef.current?.abort();
    };
  }, []);

  const effectiveGroups = object?.groups?.some((group) => group.group_name)
    ? object.groups
    : sourceGroups;
  const objectName = object?.name
    || effectiveGroups.map((group) => group.group_name).filter(Boolean).join(' + ')
    || 'Объект строительства';
  const currentDetail = detail?.request_ref === requestRef ? detail : null;
  const selectedSummary = items.find((item) => item.request_ref === requestRef) || null;
  const showMobileDetail = !isWide && activeTab === 'requests' && Boolean(requestRef);
  const openRequest = useCallback((ref) => {
    setActiveTab('requests');
    navigate(`${basePath}/requests/${ref}`);
  }, [basePath, navigate]);

  return (
    <MainLayout pageTitle={objectName}>
      <PageShell
        fullHeight
        sx={{
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          p: { xs: 1, sm: 2, lg: 2.5 },
        }}
      >
        <Stack spacing={{ xs: 1, sm: 1.25 }} sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {!showMobileDetail ? (
            <Box component="header" sx={{ flexShrink: 0 }}>
              <Stack
                data-testid="construction-object-header-row"
                direction="row"
                alignItems="center"
                spacing={{ xs: 0.75, sm: 1 }}
                sx={{ minWidth: 0 }}
              >
                <Tooltip title="К объектам">
                  <IconButton
                    component={RouterLink}
                    to="/construction"
                    aria-label="К объектам"
                    sx={{ width: 44, height: 44, flexShrink: 0 }}
                  >
                    <ArrowBackRoundedIcon />
                  </IconButton>
                </Tooltip>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
                  <Box
                    aria-hidden="true"
                    sx={{
                      width: 38,
                      height: 38,
                      borderRadius: 2.5,
                      display: 'grid',
                      placeItems: 'center',
                      bgcolor: 'primary.main',
                      color: 'primary.contrastText',
                      flexShrink: 0,
                      '& .MuiSvgIcon-root': { fontSize: 21 },
                    }}
                  >
                    <ApartmentRoundedIcon />
                  </Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Stack direction="row" alignItems="center" useFlexGap flexWrap="wrap" spacing={0.65}>
                      {objectLoading && !object ? <Skeleton width={190} height={30} /> : (
                        <Typography component="h1" variant="h5" fontWeight={900} sx={{ lineHeight: 1.1, overflowWrap: 'anywhere' }}>
                          {objectName}
                        </Typography>
                      )}
                      <Stack direction="row" useFlexGap flexWrap="wrap" spacing={0.5}>
                        {effectiveGroups.map((group) => (
                          <Chip
                            key={group.group_ref}
                            size="small"
                            variant="outlined"
                            label={group.group_name || group.group_ref}
                            sx={{ height: 22, '& .MuiChip-label': { px: 0.8, fontSize: '0.7rem' } }}
                          />
                        ))}
                        {object?.managed ? (
                          <Chip
                            size="small"
                            color="success"
                            label="Карточка HUB"
                            sx={{ height: 22, '& .MuiChip-label': { px: 0.8, fontSize: '0.7rem' } }}
                          />
                        ) : null}
                      </Stack>
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, lineHeight: 1.2 }}>
                      Команда и заявки на МПЗ из 1С
                    </Typography>
                  </Box>
                </Stack>
                <Stack direction="row" alignItems="center" spacing={0.5} sx={{ flexShrink: 0 }}>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    role="status"
                    aria-live="polite"
                    sx={{ display: { xs: 'none', md: 'block' }, whiteSpace: 'nowrap' }}
                  >
                    {asOf ? `Обновлено ${formatConstructionDate(asOf, true)}` : 'Данные ещё не загружены'}
                  </Typography>
                  <Tooltip title="Обновить заявки и открытую карточку">
                    <span>
                      <IconButton
                        aria-label="Обновить заявки и открытую карточку"
                        onClick={() => void refreshAll({ forceRefresh: true })}
                        disabled={listLoading || refreshing}
                        sx={{ width: 44, height: 44 }}
                      >
                        <RefreshRoundedIcon />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Stack>
              </Stack>
              <Tabs
                value={activeTab}
                onChange={(_, value) => setActiveTab(value)}
                aria-label="Разделы карточки объекта"
                variant="scrollable"
                allowScrollButtonsMobile
                sx={{ mt: 0.5, minHeight: 44, '& .MuiTab-root': { minHeight: 44, py: 0.75 } }}
              >
                {OBJECT_TABS.map(([value, label]) => <Tab key={value} value={value} label={label} />)}
              </Tabs>
            </Box>
          ) : null}

          {objectError ? <Alert severity="warning">{objectError}</Alert> : null}
          {listLoading || refreshing ? <LinearProgress aria-label={refreshing ? 'Обновление заявок объекта' : 'Загрузка заявок объекта'} /> : null}
          {listError && !showMobileDetail ? (
            <Alert severity="warning">{listError}. {items.length ? 'Показаны ранее загруженные данные.' : 'Повторите попытку позже.'}</Alert>
          ) : null}
          {cache?.stale && !showMobileDetail ? (
            <Alert severity="warning">1С временно недоступна. Показан сохранённый снимок возрастом {cache.age_seconds || 0} сек.</Alert>
          ) : null}
          {truncated && !showMobileDetail ? (
            <Alert severity="info">Срез объекта достиг защитного лимита 500 заявок. Используйте поиск и фильтры.</Alert>
          ) : null}

          {activeTab === 'overview' && !showMobileDetail ? (
            <Box
              component="section"
              aria-label="Обзор объекта"
              data-testid="construction-overview-scroll"
              tabIndex={0}
              sx={{ ...SCROLL_PANE_SX, pr: { lg: 0.5 }, pb: 0.5 }}
            >
              <ObjectOverview
                summary={summary}
                object={object}
                overview={overview}
              />
            </Box>
          ) : null}

          {activeTab === 'structure' && !showMobileDetail ? (
            <Box
              component="section"
              aria-label="Структура объекта"
              data-testid="construction-structure-scroll"
              tabIndex={0}
              sx={{ ...SCROLL_PANE_SX, pr: { lg: 0.5 }, pb: 0.5 }}
            >
              <TeamStructure team={object?.team || []} history={object?.role_history || []} detailed />
            </Box>
          ) : null}

          {activeTab === 'supply' && !showMobileDetail ? (
            <Box
              component="section"
              aria-label="Снабжение объекта"
              data-testid="construction-supply-scroll"
              tabIndex={0}
              sx={{ ...SCROLL_PANE_SX, pr: { lg: 0.5 }, pb: 0.5 }}
            >
              <SupplyOverview summary={summary} facets={warehouseFacets} />
            </Box>
          ) : null}

          {activeTab === 'requests' ? (
            <Stack spacing={1.5} sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              {!showMobileDetail ? (
                <Box component="section" aria-label="Фильтры заявок объекта" sx={{ flexShrink: 0 }}>
                  <Tabs
                    value={view}
                    onChange={(_, value) => setView(value)}
                    aria-label="Состояние заявок"
                    variant="scrollable"
                    allowScrollButtonsMobile
                    sx={{ minHeight: 44, '& .MuiTab-root': { minHeight: 44 } }}
                  >
                    <Tab value="active" label={`Активные · ${summary.active}`} />
                    <Tab value="history" label={`История · ${summary.history}`} />
                    <Tab value="all" label={`Все · ${summary.total}`} />
                  </Tabs>
                  <Paper
                    variant="outlined"
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: {
                        xs: 'minmax(0, 1fr)',
                        sm: 'minmax(0, 1.25fr) minmax(180px, 0.75fr)',
                        lg: 'minmax(240px, 1fr) minmax(180px, 0.6fr) minmax(190px, 0.65fr) minmax(200px, auto)',
                      },
                      gap: 1.25,
                      p: 1.25,
                      mt: 1,
                      borderRadius: 3,
                    }}
                  >
                    <TextField
                      fullWidth
                      size="small"
                      label="Поиск"
                      placeholder="Номер, номенклатура, подразделение"
                      value={searchInput}
                      onChange={(event) => setSearchInput(event.target.value)}
                      InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon /></InputAdornment> }}
                      sx={{ '& .MuiInputBase-root': { minHeight: 44, borderRadius: 2 } }}
                    />
                    <TextField
                      select
                      fullWidth
                      size="small"
                      label="Этап заявки"
                      value={stage}
                      onChange={(event) => setStage(event.target.value)}
                      InputLabelProps={{ shrink: true }}
                      SelectProps={{
                        displayEmpty: true,
                        renderValue: (selected) => REQUEST_STAGES.find(([value]) => value === selected)?.[1] || 'Все этапы',
                      }}
                      sx={{ '& .MuiInputBase-root': { minHeight: 44, borderRadius: 2 } }}
                    >
                      <MenuItem value="">Все этапы</MenuItem>
                      {REQUEST_STAGES.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
                    </TextField>
                    <TextField
                      select
                      fullWidth
                      size="small"
                      label="Склад назначения"
                      value={warehouseRef}
                      onChange={(event) => setWarehouseRef(event.target.value)}
                      InputLabelProps={{ shrink: true }}
                      SelectProps={{
                        displayEmpty: true,
                        renderValue: (selected) => warehouseFacets.find((item) => item.ref === selected)?.name || 'Все склады',
                      }}
                      sx={{ '& .MuiInputBase-root': { minHeight: 44, borderRadius: 2 } }}
                    >
                      <MenuItem value="">Все склады</MenuItem>
                      {warehouseFacets.map((warehouse) => (
                        <MenuItem key={warehouse.ref} value={warehouse.ref}>{warehouse.name} · {warehouse.count}</MenuItem>
                      ))}
                    </TextField>
                    <FormControlLabel
                      control={<Switch checked={overdueOnly} onChange={(event) => setOverdueOnly(event.target.checked)} />}
                      label="Только просроченные"
                      sx={{
                        minHeight: 44,
                        m: 0,
                        px: 1,
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 2,
                        gridColumn: { xs: '1', sm: '1 / -1', lg: 'auto' },
                      }}
                    />
                  </Paper>
                </Box>
              ) : null}

              {isWide ? (
                <Box
                  sx={{
                    flex: 1,
                    minHeight: 0,
                    display: 'grid',
                    gridTemplateColumns: 'minmax(320px, 0.88fr) minmax(470px, 1.35fr)',
                    gridTemplateRows: 'minmax(0, 1fr)',
                    gap: 2,
                  }}
                >
                  <Box
                    component="section"
                    aria-label="Заявки объекта"
                    data-testid="construction-request-list-scroll"
                    tabIndex={0}
                    sx={{ ...SCROLL_PANE_SX, pr: 0.5 }}
                  >
                    <RequestList
                      items={items}
                      selectedRef={requestRef}
                      loading={listLoading}
                      hasMore={hasMore}
                      onOpen={openRequest}
                      onLoadMore={() => void loadRequests({ append: true })}
                      facets={warehouseFacets}
                    />
                  </Box>
                  <Box
                    component="section"
                    aria-label="Карточка заявки"
                    data-testid="construction-request-detail-scroll"
                    tabIndex={0}
                    sx={{ ...SCROLL_PANE_SX, pr: 0.5 }}
                  >
                    <ConstructionRequestDetail
                      request={currentDetail || (detailLoading ? null : selectedSummary)}
                      loading={detailLoading}
                      error={detailError}
                    />
                  </Box>
                </Box>
              ) : showMobileDetail ? (
                <Box
                  component="section"
                  aria-label="Карточка заявки"
                  data-testid="construction-request-detail-scroll"
                  tabIndex={0}
                  sx={{ ...SCROLL_PANE_SX, flex: 1, minWidth: 0 }}
                >
                  <ConstructionRequestDetail
                    request={currentDetail}
                    loading={detailLoading}
                    error={detailError}
                    showBack
                    onBack={() => navigate(basePath)}
                  />
                </Box>
              ) : (
                <Box
                  component="section"
                  aria-label="Заявки объекта"
                  data-testid="construction-request-list-scroll"
                  tabIndex={0}
                  sx={{ ...SCROLL_PANE_SX, flex: 1, minWidth: 0 }}
                >
                  <RequestList
                    items={items}
                    selectedRef={requestRef}
                    loading={listLoading}
                    hasMore={hasMore}
                    onOpen={openRequest}
                    onLoadMore={() => void loadRequests({ append: true })}
                    facets={warehouseFacets}
                  />
                </Box>
              )}
            </Stack>
          ) : null}

          {!showMobileDetail ? (
            <Typography variant="caption" color="text.secondary" textAlign="center" sx={{ flexShrink: 0 }}>
              Данные 1С доступны только для чтения; показан срез
              {windowFrom ? ` с ${formatConstructionDate(windowFrom)}` : ' за последние 12 месяцев'}.
              {' '}Фильтрация выполняется по снимку объекта без запросов на каждую строку.
            </Typography>
          ) : null}
        </Stack>
      </PageShell>
    </MainLayout>
  );
}
