import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Breadcrumbs,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
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
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CloseIcon from '@mui/icons-material/Close';
import CorporateFareOutlinedIcon from '@mui/icons-material/CorporateFareOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
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
import CompanyStructureChart from './company-structure/CompanyStructureChart';
import EmployeeDirectoryPanel from './company-structure/EmployeeDirectoryPanel';
import {
  NODE_TYPE_OPTIONS,
  findNodeById,
  findNodePath,
  nodeCardTitle,
} from './company-structure/companyStructureModel';

function nodeTypeLabel(node) {
  return NODE_TYPE_OPTIONS.find((option) => option.value === node?.node_type)?.label || 'Подразделение';
}

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

function ChildUnitCard({ node, onSelect, onPrefetch }) {
  const childCount = Array.isArray(node.children) ? node.children.length : 0;
  return (
    <Paper
      component="button"
      type="button"
      variant="outlined"
      onClick={() => onSelect(String(node.id))}
      onMouseEnter={() => onPrefetch?.(String(node.id))}
      onFocus={() => onPrefetch?.(String(node.id))}
      sx={{
        width: '100%',
        p: 1.75,
        borderRadius: 2,
        textAlign: 'left',
        color: 'text.primary',
        bgcolor: 'background.paper',
        cursor: 'pointer',
        transition: 'border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease',
        '&:hover': {
          borderColor: 'primary.main',
          boxShadow: 2,
          transform: 'translateY(-1px)',
        },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
      }}
    >
      <Stack direction="row" spacing={1.25} alignItems="flex-start">
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: 1.5,
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'action.hover',
            flexShrink: 0,
          }}
        >
          <CorporateFareOutlinedIcon fontSize="small" color="primary" />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle2" fontWeight={700}>{nodeCardTitle(node)}</Typography>
          {node.person_name ? (
            <Typography variant="body2" color="text.secondary">{node.person_name}</Typography>
          ) : null}
          <Typography variant="caption" color="text.secondary">
            {nodeTypeLabel(node)}{childCount ? ` · внутри ${childCount}` : ''}
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
}

const CompanyStructure = () => {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { hasPermission } = useAuth();
  const { notifySuccess, notifyApiError } = useNotification();
  const canWrite = hasPermission('company_structure.write');
  const selectedIdRef = useRef(
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('node') || ''
      : '',
  );
  const peopleCacheRef = useRef(new Map());
  const peopleRequestsRef = useRef(new Map());

  const [mode, setMode] = useState('explore');
  const [tree, setTree] = useState([]);
  const [selectedId, setSelectedId] = useState(selectedIdRef.current);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [people, setPeople] = useState([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [focusedPerson, setFocusedPerson] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOptions, setSearchOptions] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [mobileTab, setMobileTab] = useState('units');
  const [explorerView, setExplorerView] = useState('guide');
  const [directoryDialogOpen, setDirectoryDialogOpen] = useState(false);

  const updateNodeParam = useCallback((nodeId) => {
    if (typeof window === 'undefined') return;
    const nextUrl = new URL(window.location.href);
    if (nodeId) nextUrl.searchParams.set('node', nodeId); else nextUrl.searchParams.delete('node');
    window.history.replaceState(window.history.state, '', nextUrl);
  }, []);

  const prefetchPeople = useCallback((nodeId) => {
    const normalized = String(nodeId || '');
    if (!normalized || peopleCacheRef.current.has(normalized) || peopleRequestsRef.current.has(normalized)) return;
    const request = companyStructureAPI.getNodePeople(normalized)
      .then((payload) => {
        const items = Array.isArray(payload?.items) ? payload.items : [];
        peopleCacheRef.current.set(normalized, items);
        return items;
      })
      .catch(() => [])
      .finally(() => peopleRequestsRef.current.delete(normalized));
    peopleRequestsRef.current.set(normalized, request);
  }, []);

  const selectNode = useCallback((nodeId, person = null) => {
    const normalized = String(nodeId || '');
    selectedIdRef.current = normalized;
    setSelectedId(normalized);
    setFocusedPerson(person);
    updateNodeParam(normalized);
    if (person && isMobile) setMobileTab('people');
  }, [isMobile, updateNodeParam]);

  const loadTree = useCallback(async (preferredId = '') => {
    setLoading(true);
    setError('');
    try {
      const payload = await companyStructureAPI.getTree();
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setTree(items);
      const requested = String(preferredId || selectedIdRef.current || '');
      const fallback = items[0]?.id ? String(items[0].id) : '';
      const nextId = requested && findNodeById(items, requested) ? requested : fallback;
      selectedIdRef.current = nextId;
      setSelectedId(nextId);
      updateNodeParam(nextId);
      return items;
    } catch (requestError) {
      console.error(requestError);
      setError('Не удалось загрузить структуру компании.');
      notifyApiError?.(requestError, 'Не удалось загрузить структуру компании.');
      return [];
    } finally {
      setLoading(false);
    }
  }, [notifyApiError, updateNodeParam]);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

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
      peopleCacheRef.current.set(key, items);
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
  const parentNode = selectedPath.length > 1 ? selectedPath[selectedPath.length - 2] : null;
  const childNodes = Array.isArray(selectedNode?.children) ? selectedNode.children : [];

  const handleSearchChoice = (_, item) => {
    if (!item) return;
    const person = item.kind === 'person' ? searchPersonToDirectoryPerson(item) : null;
    if (item.node_id) {
      selectNode(item.node_id, person);
      if (person) setDirectoryDialogOpen(true);
    }
    else if (person) {
      setFocusedPerson(person);
      if (isMobile) setMobileTab('people');
    }
  };

  return (
    <MainLayout>
      <PageShell sx={{ pb: isMobile ? 'calc(var(--app-shell-mobile-bottom-nav-height, 64px) + 12px)' : 2 }}>
        <Stack spacing={2.25}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            alignItems={{ xs: 'stretch', sm: 'center' }}
            justifyContent="space-between"
          >
            <Box>
              <Typography variant="h5" fontWeight={750}>Структура компании</Typography>
              <Typography variant="body2" color="text.secondary">
                Найдите коллегу, поймите подчинённость и перейдите к нужному подразделению.
              </Typography>
            </Box>
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
                sx={{
                  ...getOfficePanelSx(ui),
                  p: { xs: 2, md: 2.5 },
                  borderRadius: 2.5,
                  background: `linear-gradient(135deg, ${theme.palette.background.paper} 0%, ${theme.palette.action.hover} 100%)`,
                }}
              >
                <Stack spacing={1.25}>
                  <Typography variant="subtitle1" fontWeight={700}>Найти сотрудника или подразделение</Typography>
                  <Autocomplete
                    options={searchOptions}
                    inputValue={searchQuery}
                    loading={searchLoading}
                    filterOptions={(options) => options}
                    getOptionLabel={(option) => (typeof option === 'string' ? option : option?.title || '')}
                    isOptionEqualToValue={(option, value) => option.kind === value.kind && option.title === value.title}
                    onInputChange={(_, value) => setSearchQuery(value)}
                    onChange={handleSearchChoice}
                    noOptionsText={searchQuery.trim().length < 2 ? 'Введите минимум 2 символа' : 'Ничего не найдено'}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        placeholder="ФИО, подразделение, рабочая почта или телефон"
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
                </Stack>
              </Paper>

              <ToggleButtonGroup
                exclusive
                size="small"
                value={explorerView}
                onChange={(_, value) => value && setExplorerView(value)}
                aria-label="Вид структуры"
                sx={{ alignSelf: { xs: 'stretch', sm: 'flex-start' } }}
              >
                <ToggleButton value="guide" sx={{ ...viewToggleSx, flex: { xs: 1, sm: 'initial' } }}>
                  <CorporateFareOutlinedIcon fontSize="small" sx={{ mr: 0.75 }} />
                  Навигатор
                </ToggleButton>
                <ToggleButton value="chart" sx={{ ...viewToggleSx, flex: { xs: 1, sm: 'initial' } }}>
                  <AccountTreeOutlinedIcon fontSize="small" sx={{ mr: 0.75 }} />
                  Схема
                </ToggleButton>
              </ToggleButtonGroup>

              {selectedNode && explorerView === 'chart' ? (
                <Stack spacing={2}>
                  <CompanyStructureChart
                    tree={tree}
                    selectedId={selectedId}
                    onSelect={(nodeId) => {
                      selectNode(nodeId);
                      setDirectoryDialogOpen(true);
                    }}
                    isMobile={isMobile}
                    toolbarAction={(
                      <Button
                        size="small"
                        startIcon={<GroupsOutlinedIcon />}
                        onClick={() => setDirectoryDialogOpen(true)}
                      >
                        Сотрудники
                      </Button>
                    )}
                  />
                </Stack>
              ) : selectedNode ? (
                <>
                  <Breadcrumbs separator="›" aria-label="Путь в структуре" sx={{ px: 0.5 }}>
                    {selectedPath.map((node, index) => (
                      index === selectedPath.length - 1 ? (
                        <Typography key={node.id} variant="body2" color="text.primary" fontWeight={600}>
                          {nodeCardTitle(node)}
                        </Typography>
                      ) : (
                        <Button
                          key={node.id}
                          size="small"
                          color="inherit"
                          onClick={() => selectNode(node.id)}
                          sx={{ minWidth: 0, px: 0.5, textTransform: 'none' }}
                        >
                          {nodeCardTitle(node)}
                        </Button>
                      )
                    ))}
                  </Breadcrumbs>

                  <Paper sx={{ ...getOfficePanelSx(ui), p: { xs: 2, md: 2.5 }, borderRadius: 2.5 }}>
                    <Stack spacing={1.25}>
                      {parentNode ? (
                        <Button
                          size="small"
                          color="inherit"
                          startIcon={<ArrowBackIcon />}
                          onClick={() => selectNode(parentNode.id)}
                          sx={{ alignSelf: 'flex-start' }}
                        >
                          Назад: {nodeCardTitle(parentNode)}
                        </Button>
                      ) : null}
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="space-between">
                        <Box>
                          <Chip size="small" icon={<AccountTreeOutlinedIcon />} label={nodeTypeLabel(selectedNode)} sx={{ mb: 1 }} />
                          <Typography variant="h5" fontWeight={750}>{nodeCardTitle(selectedNode)}</Typography>
                          {selectedNode.person_name ? (
                            <Typography variant="body1" sx={{ mt: 0.5 }}>{selectedNode.person_name}</Typography>
                          ) : null}
                          {selectedNode.person_position && selectedNode.person_position !== selectedNode.title ? (
                            <Typography variant="body2" color="text.secondary">{selectedNode.person_position}</Typography>
                          ) : null}
                        </Box>
                        <Stack direction="row" spacing={1} alignItems="flex-start">
                          {childNodes.length ? (
                            <Chip icon={<CorporateFareOutlinedIcon />} label={`Внутри: ${childNodes.length}`} variant="outlined" />
                          ) : null}
                          <Chip icon={<GroupsOutlinedIcon />} label={`Сотрудники: ${people.length}`} variant="outlined" />
                        </Stack>
                      </Stack>
                    </Stack>
                  </Paper>

                  {isMobile && childNodes.length ? (
                    <Tabs
                      value={mobileTab}
                      onChange={(_, value) => setMobileTab(value)}
                      variant="fullWidth"
                      aria-label="Содержимое подразделения"
                    >
                      <Tab value="units" label={`Подразделения (${childNodes.length})`} />
                      <Tab value="people" label={`Сотрудники (${people.length})`} />
                    </Tabs>
                  ) : null}

                  <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} alignItems="flex-start">
                    {childNodes.length ? (
                      <Paper
                        sx={{
                          ...getOfficePanelSx(ui),
                          display: isMobile && mobileTab !== 'units' ? 'none' : 'block',
                          flex: 1,
                          width: { xs: '100%', lg: 'auto' },
                          p: { xs: 2, md: 2.5 },
                          borderRadius: 2.5,
                        }}
                      >
                        <Stack spacing={1.5}>
                          <Box>
                            <Typography variant="subtitle1" fontWeight={700}>Подразделения</Typography>
                          </Box>
                          <Divider />
                          <Box
                            sx={{
                              display: 'grid',
                              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                              gap: 1.25,
                            }}
                          >
                            {childNodes.map((node) => (
                              <ChildUnitCard
                                key={node.id}
                                node={node}
                                onSelect={selectNode}
                                onPrefetch={prefetchPeople}
                              />
                            ))}
                          </Box>
                        </Stack>
                      </Paper>
                    ) : null}

                    <Paper
                      sx={{
                        ...getOfficePanelSx(ui),
                        display: isMobile && childNodes.length && mobileTab !== 'people' ? 'none' : 'block',
                        width: { xs: '100%', lg: 'auto' },
                        flex: 1,
                        p: { xs: 2, md: 2.5 },
                        borderRadius: 2.5,
                      }}
                    >
                      <EmployeeDirectoryPanel
                        people={people}
                        loading={peopleLoading}
                        focusedPerson={focusedPerson}
                      />
                    </Paper>
                  </Stack>
                </>
              ) : (
                <Alert severity="info">Структура пока пуста. Администратор может добавить корневой узел.</Alert>
              )}
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
                await loadTree(preferredId);
              }}
              notifySuccess={notifySuccess}
              notifyApiError={notifyApiError}
            />
          ) : null}
        </Stack>
      </PageShell>

      <Dialog
        open={directoryDialogOpen && mode === 'explore' && explorerView === 'chart'}
        onClose={() => setDirectoryDialogOpen(false)}
        fullWidth
        maxWidth="sm"
        fullScreen={isMobile}
      >
        <DialogTitle>
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
            <Typography variant="h6" fontWeight={700} noWrap>
              {selectedNode ? nodeCardTitle(selectedNode) : 'Сотрудники'}
            </Typography>
            <IconButton onClick={() => setDirectoryDialogOpen(false)} aria-label="Закрыть список сотрудников">
              <CloseIcon />
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          <EmployeeDirectoryPanel
            people={people}
            loading={peopleLoading}
            focusedPerson={focusedPerson}
          />
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default CompanyStructure;
