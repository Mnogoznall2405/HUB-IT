import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  LinearProgress,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import ConstructionObjectSettingsDialog from '../components/construction/ConstructionObjectSettingsDialog';
import { ConstructionDirectionCards } from '../components/construction/ConstructionDirectionCards';
import { ConstructionTeamStructure } from '../components/construction/ConstructionTeamPanels';
import ConstructionWorkCharts from '../components/construction/ConstructionWorkCharts';
import { formatConstructionDate } from '../components/construction/ConstructionRequestViews';
import {
  OBJECT_PAGE_TABS,
  SCROLL_PANE_SX,
  constructionDirectionPath,
  constructionDirectionRequestPath,
  getConstructionErrorMessage,
  isConstructionRequestCancelled,
} from '../components/construction/constructionShared';
import { constructionAPI } from '../api/construction';
import { useAuth } from '../contexts/AuthContext';


const AUTO_REFRESH_MS = 5 * 60 * 1000;


export default function ConstructionObjectDetail() {
  const navigate = useNavigate();
  const { objectId = '', requestRef = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('construction.write');
  const activeTab = OBJECT_PAGE_TABS.some(([value]) => value === searchParams.get('tab'))
    ? searchParams.get('tab')
    : 'directions';

  const [object, setObject] = useState(null);
  const [directionStats, setDirectionStats] = useState(null);
  const [statsUnavailable, setStatsUnavailable] = useState(false);
  const [asOf, setAsOf] = useState('');
  const [objectLoading, setObjectLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [objectError, setObjectError] = useState('');
  const [statsError, setStatsError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const objectAbortRef = useRef(null);
  const statsAbortRef = useRef(null);
  const lastSuccessAtRef = useRef(0);
  const refreshRef = useRef(null);

  const loadObject = useCallback(async () => {
    objectAbortRef.current?.abort();
    const controller = new AbortController();
    objectAbortRef.current = controller;
    setObjectLoading(true);
    setObjectError('');
    try {
      const response = await constructionAPI.getObject(objectId, { signal: controller.signal });
      if (controller.signal.aborted || objectAbortRef.current !== controller) return null;
      setObject(response || null);
      return response;
    } catch (error) {
      if (!controller.signal.aborted && objectAbortRef.current === controller && !isConstructionRequestCancelled(error)) {
        setObjectError(getConstructionErrorMessage(error, 'Не удалось загрузить карточку объекта'));
      }
      return null;
    } finally {
      if (objectAbortRef.current === controller) setObjectLoading(false);
    }
  }, [objectId]);

  const loadDirectionStats = useCallback(async ({ silent = false, forceRefresh = false } = {}) => {
    statsAbortRef.current?.abort();
    const controller = new AbortController();
    statsAbortRef.current = controller;
    setStatsError('');
    if (silent) setRefreshing(true);
    else setStatsLoading(true);
    try {
      const response = await constructionAPI.getObjectRequests(objectId, {
        view: 'all',
        limit: 1,
        refresh: forceRefresh,
        signal: controller.signal,
      });
      if (controller.signal.aborted || statsAbortRef.current !== controller) return null;
      setDirectionStats(Array.isArray(response?.direction_stats) ? response.direction_stats : []);
      setAsOf(String(response?.as_of || ''));
      setStatsUnavailable(false);
      lastSuccessAtRef.current = Date.now();
      return response;
    } catch (error) {
      if (!controller.signal.aborted && statsAbortRef.current === controller && !isConstructionRequestCancelled(error)) {
        setStatsError(getConstructionErrorMessage(error, 'Не удалось загрузить счётчики направлений'));
        setStatsUnavailable(true);
        setDirectionStats(null);
      }
      return null;
    } finally {
      if (statsAbortRef.current === controller) {
        setStatsLoading(false);
        setRefreshing(false);
      }
    }
  }, [objectId]);

  useEffect(() => {
    setObject(null);
    setSettingsOpen(false);
    void loadObject();
  }, [loadObject]);

  useEffect(() => {
    setDirectionStats(null);
    setAsOf('');
    void loadDirectionStats();
  }, [loadDirectionStats]);

  useEffect(() => {
    if (!requestRef) return undefined;
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        const detail = await constructionAPI.getObjectRequest(objectId, requestRef, { signal: controller.signal });
        const groupRef = String(detail?.group_ref || '').trim();
        if (!cancelled && groupRef) {
          navigate(constructionDirectionRequestPath(objectId, groupRef, requestRef), { replace: true });
        }
      } catch (error) {
        if (!cancelled && !isConstructionRequestCancelled(error)) {
          setObjectError(getConstructionErrorMessage(error, 'Не удалось определить направление заявки'));
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [navigate, objectId, requestRef]);

  const refreshAll = useCallback(async ({ forceRefresh = false } = {}) => {
    if (document.visibilityState !== 'visible') return;
    await loadObject();
    await loadDirectionStats({ silent: true, forceRefresh });
  }, [loadDirectionStats, loadObject]);

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
      statsAbortRef.current?.abort();
    };
  }, []);

  const objectName = object?.name
    || (object?.groups || []).map((group) => group.group_name).filter(Boolean).join(' + ')
    || 'Объект строительства';
  const groups = object?.groups || [];

  return (
    <MainLayout pageTitle={objectName}>
      <PageShell
        fullHeight
        sx={{
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          p: { xs: 1, sm: 2, lg: 2.5 },
          '& .MuiButton-root, & .MuiTab-root': { textTransform: 'none' },
        }}
      >
        <Stack spacing={{ xs: 1, sm: 1.25 }} sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <Box component="header" sx={{ flexShrink: 0 }}>
            <Stack
              data-testid="construction-object-header-row"
              direction="row"
              alignItems="center"
              useFlexGap
              flexWrap="wrap"
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
                    {object?.managed ? (
                      <Chip size="small" color="success" label="Карточка HUB" sx={{ height: 22 }} />
                    ) : null}
                  </Stack>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                    Объединённый объект и направления 1С
                  </Typography>
                </Box>
              </Stack>
              <Stack direction="row" alignItems="center" justifyContent="flex-end" spacing={0.5} sx={{ flexShrink: 0, width: { xs: '100%', sm: 'auto' } }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  role="status"
                  aria-live="polite"
                  sx={{ display: { xs: 'none', md: 'block' }, whiteSpace: 'nowrap' }}
                >
                  {asOf ? `Обновлено ${formatConstructionDate(asOf, true)}` : 'Данные ещё не загружены'}
                </Typography>
                {canWrite && object ? (
                  <Tooltip title={object.managed ? 'Настройки объекта' : 'Вести отдельно'}>
                    <IconButton
                      aria-label={object.managed ? 'Настройки объекта' : 'Вести отдельно'}
                      onClick={() => setSettingsOpen(true)}
                      sx={{ width: 44, height: 44 }}
                    >
                      <EditOutlinedIcon />
                    </IconButton>
                  </Tooltip>
                ) : null}
                <Tooltip title="Обновить">
                  <span>
                    <IconButton
                      aria-label="Обновить"
                      onClick={() => void refreshAll({ forceRefresh: true })}
                      disabled={objectLoading || statsLoading || refreshing}
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
              onChange={(_, value) => setSearchParams(value === 'directions' ? {} : { tab: value }, { replace: true })}
              aria-label="Разделы объекта"
              variant="scrollable"
              allowScrollButtonsMobile
              sx={{ mt: 0.5, minHeight: 44, '& .MuiTab-root': { minHeight: 44, py: 0.75 } }}
            >
              {OBJECT_PAGE_TABS.map(([value, label]) => <Tab key={value} value={value} label={label} />)}
            </Tabs>
          </Box>

          {objectError ? <Alert severity="warning" action={<Button disabled={objectLoading} onClick={() => void loadObject()}>Повторить</Button>}>{objectError}</Alert> : null}
          {statsError && activeTab === 'directions' ? (
            <Alert severity="warning">{statsError}. Карточки направлений доступны без счётчиков заявок.</Alert>
          ) : null}
          {objectLoading || statsLoading || refreshing ? (
            <LinearProgress aria-label={refreshing ? 'Обновление объекта' : 'Загрузка объекта'} />
          ) : null}

          {activeTab === 'overview' ? (
            <Box sx={{ ...SCROLL_PANE_SX, pb: 1 }}>
              {object?.managed ? <ConstructionWorkCharts objectId={objectId} onOpenWork={(ref) => navigate(`${constructionDirectionPath(objectId, ref)}?tab=work`)} />
                : <Alert severity="info" action={canWrite ? <Button onClick={() => setSettingsOpen(true)}>Вести отдельно</Button> : undefined}>Этот проект можно вести самостоятельно: со своей командой, планом работ и диаграммами.{!canWrite ? ' Настройку выполняет ответственный с правом управления объектами.' : ''}</Alert>}
            </Box>
          ) : null}
          {activeTab === 'directions' ? (
            <Box
              component="section"
              aria-label="Направления объекта"
              data-testid="construction-directions-scroll"
              tabIndex={0}
              sx={{ ...SCROLL_PANE_SX, pr: { lg: 0.5 }, pb: 0.5 }}
            >
              <ConstructionDirectionCards
                objectId={objectId}
                groups={groups}
                directionStats={directionStats}
                loading={objectLoading}
                statsUnavailable={statsUnavailable}
              />
              {!object?.managed && groups[0]?.group_ref ? (
                <Button
                  sx={{ mt: 1.5, minHeight: 44 }}
                  onClick={() => navigate(constructionDirectionPath(objectId, groups[0].group_ref))}
                >
                  Открыть направление
                </Button>
              ) : null}
            </Box>
          ) : null}

          {activeTab === 'structure' ? (
            <Box
              component="section"
              aria-label="Структура объекта"
              data-testid="construction-structure-scroll"
              tabIndex={0}
              sx={{ ...SCROLL_PANE_SX, pr: { lg: 0.5 }, pb: 0.5 }}
            >
              <ConstructionTeamStructure
                team={object?.team || []}
                history={object?.role_history || []}
                detailed
              />
            </Box>
          ) : null}
        </Stack>
      </PageShell>

      {canWrite ? (
        <ConstructionObjectSettingsDialog
          open={settingsOpen}
          item={object ? {
            managed_object_id: object.managed ? object.id : undefined,
            object_ref: object.groups?.[0]?.group_ref || object.id,
            name: object.name,
            kind: 'project',
            managed: object.managed,
            source_groups: object.groups,
            team: object.team,
          } : null}
          onClose={() => setSettingsOpen(false)}
          onSaved={async (saved) => {
            setSettingsOpen(false);
            if (!object?.managed && saved?.id) {
              navigate(`/construction/objects/${encodeURIComponent(saved.id)}`, { replace: true });
              return;
            }
            await refreshAll({ forceRefresh: false });
          }}
        />
      ) : null}
    </MainLayout>
  );
}
