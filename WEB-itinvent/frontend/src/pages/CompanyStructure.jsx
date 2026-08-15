import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Drawer,
  IconButton,
  InputAdornment,
  ListItemText,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import CloseIcon from '@mui/icons-material/Close';
import CorporateFareOutlinedIcon from '@mui/icons-material/CorporateFareOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import { companyStructureAPI } from '../api/companyStructure';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import { buildOfficeUiTokens, getOfficePanelSx } from '../theme/officeUiTokens';
import CompanyStructureAdmin from './company-structure/CompanyStructureAdmin';
import CompanyStructureFocus from './company-structure/CompanyStructureFocus';
import EmployeeDirectoryPanel from './company-structure/EmployeeDirectoryPanel';
import {
  findNodeById,
  findNodePath,
  getCompanyRootAndBlocks,
  nodeCardTitle,
} from './company-structure/companyStructureModel';

const CompanyStructureOverview = lazy(() => import('./company-structure/CompanyStructureOverview'));

const rememberCacheValue = (cache, key, value, maxEntries = 24) => {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
};

const viewToggleSx = {
  color: 'text.secondary',
  opacity: 1,
  '&.Mui-selected': { color: 'text.primary', bgcolor: 'action.selected' },
};

function searchPersonToDirectoryPerson(item) {
  return {
    full_name: item?.title || '',
    position: item?.subtitle || '',
    department: item?.department || '',
    department_location: item?.department_location || '',
    work_phones: Array.isArray(item?.work_phones) ? item.work_phones : [],
    work_emails: Array.isArray(item?.work_emails) ? item.work_emails : [],
  };
}

function readStructureUrlState() {
  if (typeof window === 'undefined') return { nodeId: '', blockId: '', view: 'focus' };
  const params = new URLSearchParams(window.location.search);
  const rawView = params.get('view');
  return {
    nodeId: params.get('node') || '',
    blockId: params.get('block') || '',
    view: rawView === 'overview' || rawView === 'chart' ? 'overview' : 'focus',
  };
}

const CompanyStructure = () => {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { hasPermission } = useAuth();
  const { notifySuccess, notifyApiError } = useNotification();
  const canWrite = hasPermission('company_structure.write');
  const initialUrlState = useMemo(readStructureUrlState, []);
  const selectedIdRef = useRef(initialUrlState.nodeId);
  const peopleCacheRef = useRef(new Map());
  const peopleRequestsRef = useRef(new Map());

  const [mode, setMode] = useState('explore');
  const [tree, setTree] = useState([]);
  const [selectedId, setSelectedId] = useState(selectedIdRef.current);
  const [blockId, setBlockId] = useState(initialUrlState.blockId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [people, setPeople] = useState([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [focusedPerson, setFocusedPerson] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOptions, setSearchOptions] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [explorerView, setExplorerView] = useState(initialUrlState.view);
  const [directoryDrawerOpen, setDirectoryDrawerOpen] = useState(false);

  const updateUrlState = useCallback(({ nodeId, nextBlockId, view }, { replace = false } = {}) => {
    if (typeof window === 'undefined') return;
    const nextUrl = new URL(window.location.href);
    if (nodeId) nextUrl.searchParams.set('node', nodeId); else nextUrl.searchParams.delete('node');
    if (nextBlockId) nextUrl.searchParams.set('block', nextBlockId); else nextUrl.searchParams.delete('block');
    nextUrl.searchParams.set('view', view === 'overview' ? 'overview' : 'focus');
    const method = replace ? 'replaceState' : 'pushState';
    window.history[method](window.history.state, '', nextUrl);
  }, []);

  const selectNode = useCallback((nodeId, person = null, options = {}) => {
    const normalized = String(nodeId || '');
    const path = findNodePath(tree, normalized);
    const pathBlock = path.find((node) => node?.node_type === 'block');
    const nextBlockId = String(pathBlock?.id || options.blockId || blockId || '');
    const nextView = options.view || explorerView;
    selectedIdRef.current = normalized;
    setSelectedId(normalized);
    if (nextBlockId) setBlockId(nextBlockId);
    if (options.view) setExplorerView(options.view);
    setFocusedPerson(person);
    updateUrlState(
      { nodeId: normalized, nextBlockId, view: nextView },
      { replace: Boolean(options.replace) },
    );
  }, [blockId, explorerView, tree, updateUrlState]);

  const loadTree = useCallback(async (preferredId = '', { background = false } = {}) => {
    if (!background) setLoading(true);
    setError('');
    try {
      const payload = await companyStructureAPI.getTree();
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setTree(items);
      const urlState = readStructureUrlState();
      const { blocks } = getCompanyRootAndBlocks(items);
      const requested = String(preferredId || selectedIdRef.current || '');
      const requestedPath = requested ? findNodePath(items, requested) : [];
      const pathBlock = requestedPath.find((node) => node?.node_type === 'block');
      const requestedBlock = blocks.find((node) => String(node.id) === String(urlState.blockId || ''));
      const nextBlock = pathBlock || requestedBlock || blocks[0] || null;
      const fallback = nextBlock?.id ? String(nextBlock.id) : (items[0]?.id ? String(items[0].id) : '');
      const nextId = requested && findNodeById(items, requested) ? requested : fallback;
      const nextView = isMobile ? 'focus' : urlState.view;
      selectedIdRef.current = nextId;
      setSelectedId(nextId);
      setBlockId(String(nextBlock?.id || ''));
      setExplorerView(nextView);
      updateUrlState(
        { nodeId: nextId, nextBlockId: String(nextBlock?.id || ''), view: nextView },
        { replace: true },
      );
      return items;
    } catch (requestError) {
      console.error(requestError);
      setError('Не удалось загрузить структуру компании.');
      notifyApiError?.(requestError, 'Не удалось загрузить структуру компании.');
      return [];
    } finally {
      if (!background) setLoading(false);
    }
  }, [isMobile, notifyApiError, updateUrlState]);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handlePopState = () => {
      const urlState = readStructureUrlState();
      if (urlState.nodeId && findNodeById(tree, urlState.nodeId)) {
        selectedIdRef.current = urlState.nodeId;
        setSelectedId(urlState.nodeId);
        const pathBlock = findNodePath(tree, urlState.nodeId).find((node) => node?.node_type === 'block');
        setBlockId(String(pathBlock?.id || urlState.blockId || ''));
      } else if (urlState.blockId) {
        setBlockId(urlState.blockId);
      }
      setExplorerView(isMobile ? 'focus' : urlState.view);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isMobile, tree]);

  useEffect(() => {
    if (!selectedId) {
      setPeople([]);
      return undefined;
    }
    const key = String(selectedId);
    const cached = peopleCacheRef.current.get(key);
    if (cached) {
      setPeople(cached);
      setPeopleLoading(false);
      return undefined;
    }
    let cancelled = false;
    setPeople([]);
    setPeopleLoading(true);
    const existingRequest = peopleRequestsRef.current.get(key);
    const request = existingRequest || companyStructureAPI.getNodePeople(selectedId).then((payload) => {
      const items = Array.isArray(payload?.items) ? payload.items : [];
      rememberCacheValue(peopleCacheRef.current, key, items);
      return items;
    });
    if (!existingRequest) peopleRequestsRef.current.set(key, request);
    request
      .then((items) => {
        if (!cancelled) setPeople(items);
      })
      .catch((requestError) => {
        console.error(requestError);
        if (!cancelled) setPeople([]);
      })
      .finally(() => {
        peopleRequestsRef.current.delete(key);
        if (!cancelled) setPeopleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchOptions([]);
      setSearchLoading(false);
      return undefined;
    }
    let cancelled = false;
    setSearchLoading(true);
    const timer = window.setTimeout(() => {
      companyStructureAPI.search({ q: query, limit: 30 })
        .then((payload) => {
          if (!cancelled) setSearchOptions(Array.isArray(payload?.items) ? payload.items : []);
        })
        .catch((requestError) => {
          console.error(requestError);
          if (!cancelled) setSearchOptions([]);
        })
        .finally(() => {
          if (!cancelled) setSearchLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery]);

  const selectedNode = useMemo(() => findNodeById(tree, selectedId), [selectedId, tree]);
  const selectedPath = useMemo(() => findNodePath(tree, selectedId), [selectedId, tree]);
  const { blocks } = useMemo(() => getCompanyRootAndBlocks(tree), [tree]);
  const activeBlockId = String(
    blocks.find((node) => String(node.id) === String(blockId))?.id || blocks[0]?.id || '',
  );

  const changeExplorerView = (view) => {
    if (!view || (isMobile && view === 'overview')) return;
    setExplorerView(view);
    updateUrlState({ nodeId: selectedId, nextBlockId: activeBlockId, view });
  };

  const changeBlock = (_, nextBlockId) => {
    if (!nextBlockId) return;
    setBlockId(String(nextBlockId));
    selectNode(String(nextBlockId), null, { blockId: String(nextBlockId), view: explorerView });
  };

  const openPeople = useCallback((nodeId, person = null) => {
    if (nodeId) selectNode(nodeId, person);
    if (person && !nodeId) {
      setFocusedPerson(person);
      setPeople([person]);
    }
    setDirectoryDrawerOpen(true);
  }, [selectNode]);

  const handleSearchChoice = (_, item) => {
    if (!item) return;
    const person = item.kind === 'person' ? searchPersonToDirectoryPerson(item) : null;
    if (item.node_id) {
      selectNode(item.node_id, person, { view: 'focus' });
      if (person) setDirectoryDrawerOpen(true);
    }
    else if (person) {
      openPeople('', person);
    }
  };

  return (
    <MainLayout>
      <PageShell sx={{ pb: isMobile ? 'calc(var(--app-shell-mobile-bottom-nav-height, 64px) + 12px)' : 2 }}>
        <Stack spacing={1.25}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            alignItems={{ xs: 'stretch', sm: 'center' }}
            justifyContent="space-between"
          >
            <Typography variant="h6" fontWeight={750}>Структура компании</Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              {canWrite ? (
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={mode}
                  onChange={(_, nextMode) => nextMode && setMode(nextMode)}
                  aria-label="Режим страницы"
                >
                  <ToggleButton value="explore" sx={viewToggleSx}>
                    <VisibilityOutlinedIcon fontSize="small" sx={{ mr: 0.75 }} />
                    Сотрудник
                  </ToggleButton>
                  <ToggleButton value="admin" sx={viewToggleSx}>
                    <EditOutlinedIcon fontSize="small" sx={{ mr: 0.75 }} />
                    Администратор
                  </ToggleButton>
                </ToggleButtonGroup>
              ) : null}
              <Button
                aria-label="Обновить структуру"
                startIcon={<RefreshIcon />}
                onClick={() => void loadTree()}
                disabled={loading}
                sx={{ minWidth: { xs: 40, sm: 'auto' } }}
              >
                <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Обновить</Box>
              </Button>
            </Stack>
          </Stack>

          {error ? <Alert severity="error">{error}</Alert> : null}
          {loading ? (
            <Stack alignItems="center" justifyContent="center" spacing={1.5} sx={{ py: 10 }}>
              <CircularProgress />
              <Typography color="text.secondary">Загружаем структуру…</Typography>
            </Stack>
          ) : null}

          {!loading && mode === 'explore' ? (
            <>
              <Paper
                data-testid="company-structure-toolbar"
                sx={{
                  ...getOfficePanelSx(ui),
                  p: 1,
                  borderRadius: 2.5,
                  background: theme.palette.background.paper,
                }}
              >
                <Stack
                  direction={{ xs: 'column', lg: 'row' }}
                  spacing={1}
                  alignItems={{ xs: 'stretch', lg: 'center' }}
                >
                  <Autocomplete
                    size="small"
                    options={searchOptions}
                    inputValue={searchQuery}
                    loading={searchLoading}
                    filterOptions={(options) => options}
                    getOptionLabel={(option) => (typeof option === 'string' ? option : option?.title || '')}
                    isOptionEqualToValue={(option, value) => option.kind === value.kind && option.title === value.title}
                    onInputChange={(_, value) => setSearchQuery(value)}
                    onChange={handleSearchChoice}
                    noOptionsText={searchQuery.trim().length < 2 ? 'Введите минимум 2 символа' : 'Ничего не найдено'}
                    sx={{ minWidth: 0, width: '100%', flex: { lg: '1 1 420px' } }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        placeholder="Найти сотрудника или подразделение"
                        inputProps={{ ...params.inputProps, 'aria-label': 'Поиск по структуре компании' }}
                        InputProps={{
                          ...params.InputProps,
                          startAdornment: (
                            <>
                              <InputAdornment position="start"><SearchIcon color="action" /></InputAdornment>
                              {params.InputProps.startAdornment}
                            </>
                          ),
                        }}
                      />
                    )}
                    renderOption={(props, option) => (
                      <li {...props} key={`${option.kind}-${option.title}-${option.node_id || ''}`}>
                        <ListItemText
                          primary={option.title}
                          secondary={[
                            option.kind === 'person' ? option.subtitle : 'Подразделение',
                            option.department_location,
                            option.path?.map((part) => part.title).join(' / '),
                          ].filter(Boolean).join(' · ')}
                        />
                      </li>
                    )}
                  />
                  {blocks.length ? (
                    <Box sx={{ width: { xs: '100%', lg: 'auto' }, minWidth: 0, maxWidth: { lg: '42vw' }, overflow: 'hidden' }}>
                      <Tabs
                        value={activeBlockId}
                        onChange={changeBlock}
                        variant="scrollable"
                        scrollButtons="auto"
                        aria-label="Блок компании"
                        sx={{
                          minHeight: 40,
                          '& .MuiTab-root': { minHeight: 40, px: 1.5, py: 0.5 },
                        }}
                      >
                        {blocks.map((block) => (
                          <Tab key={block.id} value={String(block.id)} label={nodeCardTitle(block)} />
                        ))}
                      </Tabs>
                    </Box>
                  ) : null}
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    value={isMobile ? 'focus' : explorerView}
                    onChange={(_, value) => changeExplorerView(value)}
                    aria-label="Вид структуры"
                    sx={{ flexShrink: 0, alignSelf: { xs: 'stretch', lg: 'center' } }}
                  >
                    <ToggleButton value="focus" sx={{ ...viewToggleSx, minHeight: 40, flex: { xs: 1, lg: 'initial' } }}>
                      <CorporateFareOutlinedIcon fontSize="small" sx={{ mr: 0.75 }} />
                      Фокус
                    </ToggleButton>
                    {!isMobile ? (
                      <ToggleButton value="overview" sx={{ ...viewToggleSx, minHeight: 40, flex: { xs: 1, lg: 'initial' } }}>
                        <AccountTreeOutlinedIcon fontSize="small" sx={{ mr: 0.75 }} />
                        Обзор
                      </ToggleButton>
                    ) : null}
                  </ToggleButtonGroup>
                </Stack>
              </Paper>

              <Box component="section" data-testid="company-structure-stage" sx={{ minHeight: 0, pt: 0.5 }}>
                {selectedNode ? (
                  explorerView === 'overview' && !isMobile ? (
                    <Suspense fallback={<Box role="status" sx={{ minHeight: 420, display: 'grid', placeItems: 'center' }}><CircularProgress size={28} /></Box>}>
                      <CompanyStructureOverview
                        tree={tree}
                        blockId={activeBlockId}
                        selectedId={selectedId}
                        onFocus={(nodeId) => selectNode(nodeId, null, { view: 'focus' })}
                        onRoot={(nodeId) => selectNode(nodeId, null, { view: 'overview' })}
                        onPeople={(nodeId) => openPeople(nodeId)}
                      />
                    </Suspense>
                  ) : (
                    <CompanyStructureFocus
                      tree={tree}
                      selectedNode={selectedNode}
                      selectedPath={selectedPath}
                      people={people}
                      peopleLoading={peopleLoading}
                      focusedPerson={focusedPerson}
                      onSelect={(nodeId) => selectNode(nodeId, null, { view: 'focus' })}
                      onPeople={(nodeId) => openPeople(nodeId)}
                    />
                  )
                ) : (
                  <Alert severity="info">Структура пока пуста. Администратор может добавить корневой узел.</Alert>
                )}
              </Box>
            </>
          ) : null}

          {!loading && mode === 'admin' && canWrite ? (
            <CompanyStructureAdmin
              tree={tree}
              selectedId={selectedId}
              selectedNode={selectedNode}
              peopleCount={people.length}
              onSelect={(nodeId) => selectNode(nodeId)}
              onChanged={async (preferredId) => {
                await loadTree(preferredId, { background: true });
              }}
              notifySuccess={notifySuccess}
              notifyApiError={notifyApiError}
            />
          ) : null}
        </Stack>
      </PageShell>

      <Drawer
        anchor="right"
        open={directoryDrawerOpen && mode === 'explore'}
        onClose={() => setDirectoryDrawerOpen(false)}
        PaperProps={{
          sx: {
            width: { xs: '100%', sm: 480 },
            maxWidth: '100vw',
            overscrollBehavior: 'contain',
          },
        }}
      >
        <Stack sx={{ height: '100%' }}>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            spacing={1}
            sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" fontWeight={700} noWrap>
                {selectedNode ? nodeCardTitle(selectedNode) : 'Сотрудники'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Сотрудники выбранного подразделения
              </Typography>
            </Box>
            <IconButton onClick={() => setDirectoryDrawerOpen(false)} aria-label="Закрыть список сотрудников">
              <CloseIcon />
            </IconButton>
          </Stack>
          <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 2 }}>
          <EmployeeDirectoryPanel
            people={people}
            loading={peopleLoading}
            focusedPerson={focusedPerson}
          />
          </Box>
        </Stack>
      </Drawer>
    </MainLayout>
  );
};

export default CompanyStructure;
