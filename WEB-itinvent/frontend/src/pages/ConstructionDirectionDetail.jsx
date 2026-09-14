import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Autocomplete,
  Box,
  Breadcrumbs,
  Button,
  ButtonBase,
  Collapse,
  FormControlLabel,
  IconButton,
  InputAdornment,
  LinearProgress,
  Link,
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
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import LocalShippingOutlinedIcon from '@mui/icons-material/LocalShippingOutlined';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import {
  ConstructionRequestCard,
  ConstructionRequestDetail,
  REQUEST_STAGES,
  formatConstructionDate,
} from '../components/construction/ConstructionRequestViews';
import { ConstructionDirectionOverviewCharts } from '../components/construction/ConstructionDirectionOverview';
import { ConstructionCompactTeam, ConstructionTeamStructure } from '../components/construction/ConstructionTeamPanels';
import { ConstructionMetric } from '../components/construction/ConstructionUiBits';
import ConstructionWorkPanel from '../components/construction/ConstructionWorkWorkspace';
import ConstructionWorkCharts from '../components/construction/ConstructionWorkCharts';
import {
  DIRECTION_PAGE_TABS,
  EMPTY_FILTER_VALUE,
  SCROLL_PANE_SX,
  constructionDirectionPath,
  constructionDirectionRequestPath,
  constructionObjectPath,
  getConstructionErrorMessage,
  isConstructionRequestCancelled,
} from '../components/construction/constructionShared';
import { constructionAPI } from '../api/construction';


const AUTO_REFRESH_MS = 5 * 60 * 1000;
const SEARCH_DEBOUNCE_MS = 350;


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
        <Typography variant="h6" fontWeight={850}>Заявки не найдены</Typography>
        <Typography color="text.secondary">Измените вкладку, поиск или фильтры.</Typography>
      </Paper>
    );
  }
  return (
    <>
      {groups.map((group) => (
        <Box component="section" key={group.ref} aria-labelledby={`direction-warehouse-${group.ref}`} sx={{ mb: 1.5 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={1} sx={{ px: 0.5, py: 0.5, mb: 0.75 }}>
            <Typography id={`direction-warehouse-${group.ref}`} component="h3" variant="subtitle2" fontWeight={850} sx={{ overflowWrap: 'anywhere' }}>
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


function SupplyOverview({ summary, facets, loading, error, onRetry, onOpenWarehouse }) {
  if (loading) return <Stack spacing={1.5} aria-label="Загрузка снабжения"><Skeleton variant="rounded" height={90} /><Skeleton variant="rounded" height={180} /></Stack>;
  if (error) return <Alert severity="warning" action={<Button onClick={onRetry}>Повторить</Button>}>{error}</Alert>;
  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: 1.25 }}>
        <ConstructionMetric value={summary.active} label="заявок в снабжении" tone="info" />
        <ConstructionMetric value={summary.overdue} label="требуют внимания" tone="warning" />
        <ConstructionMetric value={facets.length} label="складов назначения" tone="success" />
      </Box>
      <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 3.5 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <LocalShippingOutlinedIcon color="primary" />
          <Box>
            <Typography component="h2" variant="h6" fontWeight={850}>Снабжение направления</Typography>
            <Typography variant="body2" color="text.secondary">
              Закупщик, поставщик и документы показаны внутри каждой заявки.
            </Typography>
          </Box>
        </Stack>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 1, mt: 1.5 }}>
          {facets.map((warehouse) => (
            <Paper key={warehouse.ref} variant="outlined" sx={{ borderRadius: 2.5, minWidth: 0, overflow: 'hidden' }}>
            <ButtonBase onClick={() => onOpenWarehouse(warehouse.ref)} aria-label={`Открыть заявки склада ${warehouse.name}`} sx={{ display: 'block', width: '100%', p: 1.5, textAlign: 'left', '&:hover': { bgcolor: 'action.hover' }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 } }}>
              <Typography fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{warehouse.name}</Typography>
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
                Активно: {warehouse.active_count} · завершено: {warehouse.history_count}
                {warehouse.overdue_count ? ` · просрочено: ${warehouse.overdue_count}` : ''}
              </Typography>
              <Typography variant="body2" color="primary.main" fontWeight={600} sx={{ mt: 1 }}>Открыть заявки</Typography>
            </ButtonBase>
            </Paper>
          ))}
        </Box>
        {!facets.length ? <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>Склады назначения пока не указаны в заявках направления.</Typography> : null}
      </Paper>
    </Stack>
  );
}


function facetLabel(name) {
  return name === EMPTY_FILTER_VALUE ? 'Не указан' : name;
}


function PersonFilterField({ label, value, options, onChange }) {
  const selected = value
    ? options.find((item) => item.name === value) || { name: value, count: null }
    : null;
  return (
    <Autocomplete
      value={selected}
      options={options}
      onChange={(_event, next) => onChange(next?.name || '')}
      isOptionEqualToValue={(option, current) => option.name === current.name}
      getOptionLabel={(option) => facetLabel(option.name)}
      renderOption={(props, option) => {
        const { key, ...rest } = props;
        return (
          <Box component="li" key={key} {...rest}>
            <Stack direction="row" justifyContent="space-between" spacing={1} sx={{ width: '100%' }}>
              <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{facetLabel(option.name)}</Typography>
              {option.count != null ? <Typography variant="caption" color="text.secondary">{option.count}</Typography> : null}
            </Stack>
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder="Все"
          size="small"
          sx={{ '& .MuiInputBase-root': { minHeight: { xs: 44, sm: 36 }, borderRadius: 1.5 }, '& .MuiInputBase-input': { py: { xs: 1, sm: 0.75 } } }}
        />
      )}
    />
  );
}


function readListParams(searchParams) {
  return {
    view: ['active', 'history', 'all'].includes(searchParams.get('view')) ? searchParams.get('view') : 'active',
    q: searchParams.get('q') || '',
    stage: searchParams.get('stage') || '',
    warehouse: searchParams.get('warehouse') || '',
    buyer: searchParams.get('buyer') || '',
    responsible: searchParams.get('responsible') || '',
    overdue: searchParams.get('overdue') === '1',
  };
}


export default function ConstructionDirectionDetail() {
  const theme = useTheme();
  const isWide = useMediaQuery(theme.breakpoints.up('lg'));
  const navigate = useNavigate();
  const { objectId = '', groupRef = '', requestRef = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = DIRECTION_PAGE_TABS.some(([value]) => value === searchParams.get('tab'))
    ? searchParams.get('tab')
    : (requestRef ? 'requests' : 'overview');
  const listParams = readListParams(searchParams);
  const advancedFilterCount = [listParams.warehouse, listParams.buyer, listParams.responsible, listParams.overdue].filter(Boolean).length;
  const [filtersOpen, setFiltersOpen] = useState(advancedFilterCount > 0);
  useEffect(() => { if (advancedFilterCount) setFiltersOpen(true); }, [listParams.warehouse, listParams.buyer, listParams.responsible, listParams.overdue]);
  const basePath = constructionDirectionPath(objectId, groupRef);

  const [direction, setDirection] = useState(null);
  const [searchInput, setSearchInput] = useState(listParams.q);
  const [items, setItems] = useState([]);
  const [listSummary, setListSummary] = useState({ total: 0, active: 0, history: 0, overdue: 0 });
  const [overviewSummary, setOverviewSummary] = useState({ total: 0, active: 0, history: 0, overdue: 0 });
  const [overview, setOverview] = useState({ departments: [], warehouses: [], stages: [] });
  const [warehouseFacets, setWarehouseFacets] = useState([]);
  const [buyerFacets, setBuyerFacets] = useState([]);
  const [responsibleFacets, setResponsibleFacets] = useState([]);
  const [supplyFacets, setSupplyFacets] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [asOf, setAsOf] = useState('');
  const [windowFrom, setWindowFrom] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [cache, setCache] = useState(null);
  const [directionLoading, setDirectionLoading] = useState(true);
  const [listLoading, setListLoading] = useState(true);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [directionError, setDirectionError] = useState('');
  const [listError, setListError] = useState('');
  const [overviewError, setOverviewError] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const directionAbortRef = useRef(null);
  const listAbortRef = useRef(null);
  const overviewAbortRef = useRef(null);
  const detailAbortRef = useRef(null);
  const listBusyRef = useRef(false);
  const detailBusyRef = useRef(false);
  const nextCursorRef = useRef('');
  const refreshRef = useRef(null);
  const lastSuccessAtRef = useRef(0);
  const requestContextRef = useRef({ objectId, groupRef });

  useEffect(() => {
    requestContextRef.current = { objectId, groupRef };
  }, [objectId, groupRef]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      const trimmed = searchInput.trim();
      if (trimmed) next.set('q', trimmed);
      else next.delete('q');
      if ((searchParams.get('q') || '') !== trimmed) {
        setSearchParams(next, { replace: true });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [searchInput, searchParams, setSearchParams]);

  useEffect(() => {
    setSearchInput(listParams.q);
  }, [listParams.q]);

  const patchParams = useCallback((patch, { replace = true } = {}) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(patch).forEach(([key, value]) => {
      if (value == null || value === '' || value === false) next.delete(key);
      else next.set(key, String(value === true ? '1' : value));
    });
    setSearchParams(next, { replace });
  }, [searchParams, setSearchParams]);

  const loadDirection = useCallback(async () => {
    directionAbortRef.current?.abort();
    const controller = new AbortController();
    directionAbortRef.current = controller;
    setDirectionLoading(true);
    setDirectionError('');
    try {
      const response = await constructionAPI.getDirection(objectId, groupRef, { signal: controller.signal });
      if (controller.signal.aborted || directionAbortRef.current !== controller) return null;
      if (requestContextRef.current.objectId !== objectId || requestContextRef.current.groupRef !== groupRef) {
        return null;
      }
      setDirection(response || null);
      return response;
    } catch (error) {
      if (!isConstructionRequestCancelled(error)) {
        setDirectionError(getConstructionErrorMessage(error, 'Не удалось загрузить направление'));
      }
      return null;
    } finally {
      if (directionAbortRef.current === controller) setDirectionLoading(false);
    }
  }, [groupRef, objectId]);

  const loadOverview = useCallback(async ({ silent = false, forceRefresh = false } = {}) => {
    overviewAbortRef.current?.abort();
    const controller = new AbortController();
    overviewAbortRef.current = controller;
    setOverviewError('');
    if (!silent) setOverviewLoading(true);
    try {
      const response = await constructionAPI.getDirectionRequests(objectId, groupRef, {
        view: 'active',
        limit: 1,
        refresh: forceRefresh,
        signal: controller.signal,
      });
      if (requestContextRef.current.objectId !== objectId || requestContextRef.current.groupRef !== groupRef) {
        return null;
      }
      setOverview(response?.overview || { departments: [], warehouses: [], stages: [] });
      setOverviewSummary(response?.summary || { total: 0, active: 0, history: 0, overdue: 0 });
      setSupplyFacets(Array.isArray(response?.warehouse_facets) ? response.warehouse_facets : []);
      setAsOf(String(response?.as_of || ''));
      setWindowFrom(String(response?.window_from || ''));
      setTruncated(Boolean(response?.truncated));
      setCache(response?.cache || null);
      lastSuccessAtRef.current = Date.now();
      return response;
    } catch (error) {
      if (!isConstructionRequestCancelled(error)) {
        setOverviewError(getConstructionErrorMessage(error, 'Не удалось загрузить обзор направления'));
      }
      return null;
    } finally {
      if (overviewAbortRef.current === controller) setOverviewLoading(false);
    }
  }, [groupRef, objectId]);

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
    const currentParams = readListParams(searchParams);
    try {
      const response = await constructionAPI.getDirectionRequests(objectId, groupRef, {
        view: currentParams.view,
        search: currentParams.q,
        stage: currentParams.stage,
        overdue: currentParams.overdue ? true : undefined,
        warehouseRef: currentParams.warehouse,
        buyer: currentParams.buyer,
        responsible: currentParams.responsible,
        limit: 25,
        cursor: append ? nextCursorRef.current : '',
        refresh: forceRefresh,
        signal: controller.signal,
      });
      if (requestContextRef.current.objectId !== objectId || requestContextRef.current.groupRef !== groupRef) {
        return null;
      }
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
      setListSummary(response?.summary || { total: 0, active: 0, history: 0, overdue: 0 });
      setWarehouseFacets(Array.isArray(response?.warehouse_facets) ? response.warehouse_facets : []);
      setBuyerFacets(Array.isArray(response?.buyer_facets) ? response.buyer_facets : []);
      setResponsibleFacets(Array.isArray(response?.responsible_facets) ? response.responsible_facets : []);
      setAsOf(String(response?.as_of || ''));
      setWindowFrom(String(response?.window_from || ''));
      setTruncated(Boolean(response?.truncated));
      setCache(response?.cache || null);
      lastSuccessAtRef.current = Date.now();
      return response;
    } catch (error) {
      if (!isConstructionRequestCancelled(error)) {
        setListError(getConstructionErrorMessage(error, 'Не удалось загрузить заявки направления'));
      }
      return null;
    } finally {
      if (listAbortRef.current === controller) {
        listBusyRef.current = false;
        setListLoading(false);
        setRefreshing(false);
      }
    }
  }, [groupRef, objectId, searchParams]);

  const loadDetail = useCallback(async (ref, { silent = false, cancelPrevious = false } = {}) => {
    if (!ref || (detailBusyRef.current && !cancelPrevious)) return null;
    if (cancelPrevious) detailAbortRef.current?.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;
    detailBusyRef.current = true;
    setDetailError('');
    if (!silent) setDetailLoading(true);
    try {
      const response = await constructionAPI.getDirectionRequest(objectId, groupRef, ref, { signal: controller.signal });
      if (requestContextRef.current.objectId !== objectId || requestContextRef.current.groupRef !== groupRef) {
        return null;
      }
      setDetail(response || null);
      return response;
    } catch (error) {
      if (!isConstructionRequestCancelled(error)) {
        setDetailError(getConstructionErrorMessage(error, 'Не удалось загрузить заявку'));
      }
      return null;
    } finally {
      if (detailAbortRef.current === controller) {
        detailBusyRef.current = false;
        setDetailLoading(false);
      }
    }
  }, [groupRef, objectId]);

  useEffect(() => {
    setDirection(null);
    setItems([]);
    setDetail(null);
    setOverview({ departments: [], warehouses: [], stages: [] });
    nextCursorRef.current = '';
    void loadDirection();
    void loadOverview();
  }, [loadDirection, loadOverview]);

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
    if (activeTab !== 'requests') patchParams({ tab: 'requests' });
    setDetail((current) => (current?.request_ref === requestRef ? current : null));
    void loadDetail(requestRef, { cancelPrevious: true });
  }, [activeTab, loadDetail, patchParams, requestRef]);

  useEffect(() => {
    if (isWide && activeTab === 'requests' && !requestRef && items.length) {
      const query = searchParams.toString();
      navigate(`${constructionDirectionRequestPath(objectId, groupRef, items[0].request_ref)}${query ? `?${query}` : ''}`, { replace: true });
    }
  }, [activeTab, groupRef, isWide, items, navigate, objectId, requestRef, searchParams]);

  const refreshAll = useCallback(async ({ forceRefresh = false } = {}) => {
    if (document.visibilityState !== 'visible') return;
    await loadDirection();
    await loadOverview({ silent: true, forceRefresh });
    const response = await loadRequests({ silent: true, forceRefresh, cancelPrevious: true });
    if (requestRef && response) await loadDetail(requestRef, { silent: true });
  }, [loadDetail, loadDirection, loadOverview, loadRequests, requestRef]);

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
      directionAbortRef.current?.abort();
      listAbortRef.current?.abort();
      overviewAbortRef.current?.abort();
      detailAbortRef.current?.abort();
    };
  }, []);

  const objectName = direction?.object_name || 'Объект строительства';
  const directionName = direction?.group_name || groupRef;
  const pageTitle = `${objectName} / ${directionName}`;
  const currentDetail = detail?.request_ref === requestRef ? detail : null;
  const selectedSummary = items.find((item) => item.request_ref === requestRef) || null;
  const showMobileDetail = !isWide && activeTab === 'requests' && Boolean(requestRef);

  const openRequest = useCallback((ref) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'requests');
    navigate(`${constructionDirectionRequestPath(objectId, groupRef, ref)}?${next.toString()}`);
  }, [groupRef, navigate, objectId, searchParams]);

  const openStageFromChart = useCallback((stageKey) => {
    const next = new URLSearchParams();
    next.set('tab', 'requests');
    next.set('view', 'active');
    next.set('stage', stageKey);
    navigate(`${basePath}?${next.toString()}`);
  }, [basePath, navigate]);

  const resetFilters = () => {
    const next = new URLSearchParams(searchParams);
    ['q', 'stage', 'warehouse', 'buyer', 'responsible', 'overdue'].forEach((key) => next.delete(key));
    next.set('view', 'active');
    setSearchInput('');
    setSearchParams(next, { replace: true });
  };

  return (
    <MainLayout pageTitle={pageTitle}>
      <PageShell
        fullHeight
        sx={{
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          px: { xs: 1, sm: 1.5 },
          py: 0.75,
          '& .MuiButton-root, & .MuiTab-root': { textTransform: 'none' },
        }}
      >
        <Stack spacing={0.75} sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {!showMobileDetail ? (
            <Box component="header" sx={{ flexShrink: 0 }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
                <Tooltip title="К объекту">
                  <IconButton
                    component={RouterLink}
                    to={constructionObjectPath(objectId)}
                    aria-label="К объекту"
                    sx={{ width: 44, height: 44, flexShrink: 0 }}
                  >
                    <ArrowBackRoundedIcon />
                  </IconButton>
                </Tooltip>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Breadcrumbs aria-label="Путь к направлению" sx={{ fontSize: 12, '& .MuiBreadcrumbs-ol': { rowGap: 0.25 }, '& .MuiBreadcrumbs-li': { minWidth: 0 } }}>
                    <Link component={RouterLink} to="/construction" color="inherit" underline="hover" sx={{ overflowWrap: 'anywhere' }}>Объекты строительства</Link>
                    <Link component={RouterLink} to={constructionObjectPath(objectId)} color="inherit" underline="hover" sx={{ overflowWrap: 'anywhere' }}>{objectName}</Link>
                  </Breadcrumbs>
                  {directionLoading && !direction ? <Skeleton width={220} height={30} /> : (
                    <Typography component="h1" variant="h6" fontWeight={750} sx={{ overflowWrap: 'anywhere', lineHeight: 1.25 }}>
                      {directionName}
                    </Typography>
                  )}
                </Box>
                <Tooltip title="Обновить">
                  <span>
                    <IconButton
                      aria-label="Обновить направление"
                      onClick={() => void refreshAll({ forceRefresh: true })}
                      disabled={listLoading || refreshing || overviewLoading || directionLoading}
                      sx={{ width: 44, height: 44 }}
                    >
                      <RefreshRoundedIcon />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
              <Tabs
                value={activeTab}
                onChange={(_, value) => {
                  const next = new URLSearchParams(searchParams);
                  if (value === 'overview') next.delete('tab');
                  else next.set('tab', value);
                  if (value !== 'requests' && requestRef) {
                    const query = next.toString();
                    navigate(`${basePath}${query ? `?${query}` : ''}`);
                  } else {
                    setSearchParams(next, { replace: true });
                  }
                }}
                aria-label="Разделы направления"
                variant="scrollable"
                allowScrollButtonsMobile
                sx={{ minHeight: { xs: 44, sm: 36 }, '& .MuiTab-root': { minHeight: { xs: 44, sm: 36 }, py: 0.5, px: 1.5 } }}
              >
                {DIRECTION_PAGE_TABS.map(([value, label]) => <Tab key={value} value={value} label={label} />)}
              </Tabs>
            </Box>
          ) : null}

          {directionError ? <Alert severity="warning" action={<Button disabled={directionLoading} onClick={() => void loadDirection()}>Повторить</Button>}>{directionError}</Alert> : null}
          {listLoading || refreshing || overviewLoading || directionLoading ? (
            <LinearProgress aria-label="Загрузка направления" />
          ) : null}
          {listError && !showMobileDetail && activeTab === 'requests' ? (
            <Alert severity="warning">{listError}</Alert>
          ) : null}
          {cache?.stale && !showMobileDetail ? (
            <Alert severity="warning">1С временно недоступна. Показан сохранённый снимок возрастом {cache.age_seconds || 0} сек.</Alert>
          ) : null}
          {truncated && !showMobileDetail ? (
            <Alert severity="info">Срез направления достиг защитного лимита. Используйте поиск и фильтры.</Alert>
          ) : null}

          {activeTab === 'overview' && !showMobileDetail ? (
            <Box component="section" aria-label="Обзор направления" tabIndex={0} sx={{ ...SCROLL_PANE_SX, pb: 1 }}>
              <Stack spacing={1.25}>
                <ConstructionDirectionOverviewCharts
                  overview={overview}
                  summary={overviewSummary}
                  asOf={asOf}
                  windowFrom={windowFrom}
                  loading={overviewLoading}
                  error={overviewError}
                  onSelectStage={openStageFromChart}
                />
                {direction?.managed ? <ConstructionWorkCharts objectId={objectId} groupRef={groupRef}
                  onOpenWork={(_, section) => setSearchParams({ tab: 'work', section }, { replace: true })} /> : null}
                <ConstructionCompactTeam objectTeam={direction?.object_team || []} />
              </Stack>
            </Box>
          ) : null}

          {direction?.managed ? (
            <Box hidden={activeTab !== 'work'} sx={{ ...SCROLL_PANE_SX, pb: 1, display: activeTab === 'work' ? 'block' : 'none' }}>
              <ConstructionWorkPanel key={`${objectId}:${groupRef}`} objectId={objectId} groupRef={groupRef} active={activeTab === 'work'} initialSection={searchParams.get('section') || ''} />
            </Box>
          ) : activeTab === 'work' && !directionLoading ? <Alert severity="info">Для ведения хода работ сначала настройте объект и привяжите направление.</Alert> : null}
          {activeTab === 'structure' && !showMobileDetail ? (
            <Box component="section" aria-label="Структура направления" tabIndex={0} sx={{ ...SCROLL_PANE_SX, pb: 1 }}>
              <ConstructionTeamStructure
                team={direction?.object_team || []}
                history={direction?.role_history || []}
                detailed
              />
            </Box>
          ) : null}

          {activeTab === 'supply' && !showMobileDetail ? (
            <Box component="section" aria-label="Снабжение направления" tabIndex={0} sx={{ ...SCROLL_PANE_SX, pb: 1 }}>
              <SupplyOverview summary={overviewSummary} facets={supplyFacets} loading={overviewLoading} error={overviewError}
                onRetry={() => void loadOverview({ forceRefresh: true })}
                onOpenWarehouse={(ref) => navigate(`${basePath}?${new URLSearchParams({ tab: 'requests', view: 'all', warehouse: ref }).toString()}`)} />
            </Box>
          ) : null}

          {activeTab === 'requests' ? (
            <Stack spacing={0.75} sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              {!showMobileDetail ? (
                <Box component="section" aria-label="Фильтры заявок направления" sx={{ flexShrink: 0 }}>
                  <Stack direction="row" alignItems="center" gap={0.5}>
                  <Tabs
                    value={listParams.view}
                    onChange={(_, value) => patchParams({ view: value === 'active' ? '' : value })}
                    aria-label="Состояние заявок"
                    variant="scrollable"
                    allowScrollButtonsMobile
                    sx={{ flex: 1, minWidth: 0, minHeight: { xs: 44, sm: 36 }, '& .MuiTab-root': { minHeight: { xs: 44, sm: 36 }, minWidth: 0, px: 1.5, py: 0.5 } }}
                  >
                    <Tab value="active" label={`Активные · ${listSummary.active}`} />
                    <Tab value="history" label={`История · ${listSummary.history}`} />
                    <Tab value="all" label={`Все · ${listSummary.total}`} />
                  </Tabs>
                  <Button size="small" startIcon={<TuneRoundedIcon />} onClick={() => setFiltersOpen((value) => !value)}
                    aria-expanded={filtersOpen} aria-controls="direction-extra-filters" sx={{ flexShrink: 0, minHeight: { xs: 44, sm: 36 }, px: 1 }}>
                    Фильтры{advancedFilterCount ? ` · ${advancedFilterCount}` : ''}
                  </Button>
                  </Stack>
                  <Paper
                    variant="outlined"
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: {
                        xs: 'minmax(0, 1fr)',
                        sm: 'minmax(0, 1.5fr) minmax(0, 1fr)',
                      },
                      gap: 1,
                      p: 1,
                      mt: 0.25,
                      borderRadius: 2,
                      '& .MuiInputBase-root': { minHeight: { xs: 44, sm: 36 }, borderRadius: 1.5 },
                      '& .MuiInputBase-input': { fontSize: { xs: 16, sm: 13 } },
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
                      sx={{ '& .MuiInputBase-root': { minHeight: { xs: 44, sm: 36 }, borderRadius: 1.5 }, '& .MuiInputBase-input': { py: { xs: 1, sm: 0.75 } } }}
                    />
                    <TextField
                      select
                      fullWidth
                      size="small"
                      label="Этап заявки"
                      value={listParams.stage}
                      onChange={(event) => patchParams({ stage: event.target.value })}
                      InputLabelProps={{ shrink: true }}
                      SelectProps={{
                        displayEmpty: true,
                        renderValue: (selected) => REQUEST_STAGES.find(([value]) => value === selected)?.[1] || 'Все этапы',
                      }}
                      sx={{ '& .MuiInputBase-root': { minHeight: { xs: 44, sm: 36 }, borderRadius: 1.5 }, '& .MuiInputBase-input': { py: { xs: 1, sm: 0.75 } } }}
                    >
                      <MenuItem value="">Все этапы</MenuItem>
                      {REQUEST_STAGES.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
                    </TextField>
                    <Collapse in={filtersOpen} unmountOnExit sx={{ gridColumn: '1 / -1' }}>
                    <Box id="direction-extra-filters" sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' }, gap: 1, pt: 0.25 }}>
                    <TextField
                      select
                      fullWidth
                      size="small"
                      label="Склад назначения"
                      value={listParams.warehouse}
                      onChange={(event) => patchParams({ warehouse: event.target.value })}
                      InputLabelProps={{ shrink: true }}
                      SelectProps={{
                        displayEmpty: true,
                        renderValue: (selected) => warehouseFacets.find((item) => item.ref === selected)?.name || 'Все склады',
                      }}
                      sx={{ '& .MuiInputBase-root': { minHeight: { xs: 44, sm: 36 }, borderRadius: 1.5 }, '& .MuiInputBase-input': { py: { xs: 1, sm: 0.75 } } }}
                    >
                      <MenuItem value="">Все склады</MenuItem>
                      {warehouseFacets.map((warehouse) => (
                        <MenuItem key={warehouse.ref} value={warehouse.ref}>{warehouse.name} · {warehouse.count}</MenuItem>
                      ))}
                    </TextField>
                    <PersonFilterField
                      label="Закупщик"
                      value={listParams.buyer}
                      options={buyerFacets}
                      onChange={(value) => patchParams({ buyer: value })}
                    />
                    <PersonFilterField
                      label="Ответственный за заявку"
                      value={listParams.responsible}
                      options={responsibleFacets}
                      onChange={(value) => patchParams({ responsible: value })}
                    />
                    <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
                      <FormControlLabel
                        control={(
                          <Switch
                            checked={listParams.overdue}
                            onChange={(event) => patchParams({ overdue: event.target.checked || '' })}
                          />
                        )}
                        label="Только просроченные"
                        sx={{
                          minHeight: 44,
                          m: 0,
                          px: 1,
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: 2,
                          flex: 1,
                        }}
                      />
                      <Button onClick={resetFilters} sx={{ minHeight: 44 }}>Сбросить</Button>
                    </Stack>
                    </Box>
                    </Collapse>
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
                    gap: 1,
                  }}
                >
                  <Box component="section" aria-label="Заявки направления" tabIndex={0} sx={{ ...SCROLL_PANE_SX, pr: 0.5 }}>
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
                  <Box component="section" aria-label="Карточка заявки" tabIndex={0} sx={{ ...SCROLL_PANE_SX, pr: 0.5 }}>
                    <ConstructionRequestDetail
                      request={currentDetail || (detailLoading ? null : selectedSummary)}
                      loading={detailLoading}
                      error={detailError}
                    />
                  </Box>
                </Box>
              ) : showMobileDetail ? (
                <Box component="section" aria-label="Карточка заявки" tabIndex={0} sx={{ ...SCROLL_PANE_SX, flex: 1 }}>
                  <ConstructionRequestDetail
                    request={currentDetail}
                    loading={detailLoading}
                    error={detailError}
                    showBack
                    onBack={() => navigate(`${basePath}${searchParams.toString() ? `?${searchParams.toString()}` : '?tab=requests'}`)}
                  />
                </Box>
              ) : (
                <Box component="section" aria-label="Заявки направления" tabIndex={0} sx={{ ...SCROLL_PANE_SX, flex: 1 }}>
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
              Данные заявок — из 1С только для чтения
              {windowFrom ? `, срез с ${formatConstructionDate(windowFrom)}` : ''}.
              Сопоставление закупщиков и ответственных — по точному имени из 1С.
            </Typography>
          ) : null}
        </Stack>
      </PageShell>

    </MainLayout>
  );
}
