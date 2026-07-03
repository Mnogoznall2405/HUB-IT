import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Drawer,
  Grid,
  IconButton,
  InputAdornment,
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
import { alpha, useTheme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import FolderSharedOutlinedIcon from '@mui/icons-material/FolderSharedOutlined';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import ViewListOutlinedIcon from '@mui/icons-material/ViewListOutlined';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import FolderPathBreadcrumb from '../components/groupsAccess/FolderPathBreadcrumb';
import GroupsAccessFolderList from '../components/groupsAccess/GroupsAccessFolderList';
import GroupsAccessMatrixTable from '../components/groupsAccess/GroupsAccessMatrixTable';
import { groupsAccessAPI } from '../api/groupsAccess';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import { exportGroupsAccessWorkbook, getAccessLevelMeta } from '../lib/groupsAccessUtils';
import { hideScrollbarSx } from '../lib/hideScrollbarSx';
import { buildOfficeUiTokens, getOfficePanelSx } from '../theme/officeUiTokens';

const SEARCH_DEBOUNCE_MS = 300;
const BRANCH_TABS = [
  { value: 'all', label: 'Все' },
  { value: 'SPb', label: 'SPb' },
  { value: 'Tyumen', label: 'Tyumen' },
];

const useDebouncedValue = (value, delayMs = SEARCH_DEBOUNCE_MS) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debounced;
};

const formatDateTime = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString('ru-RU');
};

const normalizeText = (value) => String(value || '').trim();
const getGroupKey = (group) => String(group?.dn || group?.cn || '');

const AccessLevelChip = ({ level }) => {
  const meta = getAccessLevelMeta(level);
  return <Chip size="small" label={meta.label} color={meta.color} variant="outlined" />;
};

const MatrixLegend = () => (
  <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
    {Object.entries({
      R: 'Чтение',
      W: 'Запись',
      F: 'Полный',
      '+': 'Доступ',
      '·': 'Нет доступа',
    }).map(([code, label]) => (
      <Chip key={code} size="small" variant="outlined" label={`${code} — ${label}`} />
    ))}
  </Stack>
);

const GroupsAccess = () => {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { user } = useAuth();
  const { notifySuccess, notifyApiError } = useNotification();
  const isAdmin = String(user?.role || '').trim().toLowerCase() === 'admin';

  const [branchTab, setBranchTab] = useState('all');
  const [viewMode, setViewMode] = useState('list');
  const [folderQuery, setFolderQuery] = useState('');
  const [userQuery, setUserQuery] = useState('');
  const debouncedUserQuery = useDebouncedValue(userQuery);
  const debouncedFolderQuery = useDebouncedValue(folderQuery);

  const [status, setStatus] = useState(null);
  const [groups, setGroups] = useState([]);
  const [users, setUsers] = useState([]);
  const [matrixCells, setMatrixCells] = useState([]);
  const [datasetSummary, setDatasetSummary] = useState(null);
  const [selectedGroupDn, setSelectedGroupDn] = useState('');
  const [groupDetail, setGroupDetail] = useState(null);
  const [loadingDataset, setLoadingDataset] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  const activeBranch = branchTab === 'all' ? '' : branchTab;
  const selectedGroup = useMemo(
    () => groups.find((item) => getGroupKey(item) === selectedGroupDn) || groupDetail?.group || null,
    [groupDetail?.group, groups, selectedGroupDn],
  );

  const loadStatus = useCallback(async () => {
    try {
      const payload = await groupsAccessAPI.getStatus();
      setStatus(payload);
    } catch (requestError) {
      notifyApiError(requestError, 'Не удалось загрузить статус матрицы доступа');
    }
  }, [notifyApiError]);

  const loadListGroups = useCallback(async () => {
    setLoadingDataset(true);
    setError('');
    try {
      const payload = await groupsAccessAPI.getMatrix({
        branch: activeBranch,
        q: debouncedFolderQuery,
        page: 1,
        limit: 5000,
      });
      const nextGroups = Array.isArray(payload?.items) ? payload.items : [];
      setGroups(nextGroups);
      setMatrixCells([]);
      setDatasetSummary({
        group_count: payload?.total ?? nextGroups.length,
        user_count: status?.summary?.user_count ?? 0,
      });

      setSelectedGroupDn((current) => {
        if (current && nextGroups.some((item) => getGroupKey(item) === current)) {
          return current;
        }
        if (nextGroups.length > 0 && !debouncedUserQuery) {
          return getGroupKey(nextGroups[0]);
        }
        return '';
      });
    } catch (requestError) {
      setError('Не удалось загрузить список папок');
      notifyApiError(requestError, 'Не удалось загрузить список папок');
    } finally {
      setLoadingDataset(false);
    }
  }, [activeBranch, debouncedFolderQuery, debouncedUserQuery, notifyApiError, status?.summary?.user_count]);

  const loadUserSearch = useCallback(async () => {
    setLoadingDataset(true);
    setError('');
    try {
      const payload = await groupsAccessAPI.searchUser({
        q: debouncedUserQuery,
        branch: activeBranch,
        limit: 200,
      });
      const nextUsers = Array.isArray(payload?.items) ? payload.items : [];
      setUsers(nextUsers);
      setMatrixCells([]);
      setDatasetSummary({
        group_count: groups.length,
        user_count: payload?.total ?? nextUsers.length,
      });
      setSelectedGroupDn('');
      setGroupDetail(null);
    } catch (requestError) {
      setError('Не удалось найти учётки');
      notifyApiError(requestError, 'Не удалось найти учётки');
    } finally {
      setLoadingDataset(false);
    }
  }, [activeBranch, debouncedUserQuery, groups.length, notifyApiError]);

  const loadMatrixGrid = useCallback(async () => {
    setLoadingDataset(true);
    setError('');
    try {
      const payload = await groupsAccessAPI.getMatrixGrid({
        branch: activeBranch,
        folderQ: debouncedFolderQuery,
        userQ: debouncedUserQuery,
      });
      const nextGroups = Array.isArray(payload?.groups) ? payload.groups : [];
      const nextUsers = Array.isArray(payload?.users) ? payload.users : [];
      const nextCells = Array.isArray(payload?.cells) ? payload.cells : [];
      setGroups(nextGroups);
      setUsers(nextUsers);
      setMatrixCells(nextCells);
      setDatasetSummary(payload?.summary || {
        group_count: nextGroups.length,
        user_count: nextUsers.length,
        cell_count: nextCells.length,
      });

      setSelectedGroupDn((current) => {
        if (current && nextGroups.some((item) => getGroupKey(item) === current)) {
          return current;
        }
        return '';
      });
    } catch (requestError) {
      setError('Не удалось загрузить матрицу доступа');
      notifyApiError(requestError, 'Не удалось загрузить матрицу доступа');
    } finally {
      setLoadingDataset(false);
    }
  }, [activeBranch, debouncedFolderQuery, debouncedUserQuery, notifyApiError]);

  const loadGroupDetail = useCallback(async (groupDn) => {
    const normalized = normalizeText(groupDn);
    if (!normalized) {
      setGroupDetail(null);
      return;
    }
    setLoadingDetail(true);
    try {
      const payload = await groupsAccessAPI.getGroup(normalized);
      setGroupDetail(payload);
    } catch (requestError) {
      notifyApiError(requestError, 'Не удалось загрузить участников группы');
      setGroupDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }, [notifyApiError]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (viewMode === 'matrix') {
      loadMatrixGrid();
      return;
    }
    if (debouncedUserQuery) {
      loadUserSearch();
      return;
    }
    setUsers([]);
    loadListGroups();
  }, [debouncedUserQuery, loadListGroups, loadMatrixGrid, loadUserSearch, viewMode]);

  useEffect(() => {
    if (viewMode !== 'list' || debouncedUserQuery) return;
    if (!selectedGroupDn) return;
    loadGroupDetail(selectedGroupDn);
  }, [debouncedUserQuery, loadGroupDetail, selectedGroupDn, viewMode]);

  const handleSelectGroup = (group) => {
    const groupDn = getGroupKey(group);
    setSelectedGroupDn(groupDn);
    setUserQuery('');
    if (isMobile && viewMode === 'list') {
      setMobileSheetOpen(true);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await groupsAccessAPI.refresh();
      notifySuccess('Снимок матрицы доступа обновлён');
      await Promise.all([loadStatus(), viewMode === 'matrix' ? loadMatrixGrid() : loadListGroups()]);
      if (selectedGroupDn && viewMode === 'list') {
        await loadGroupDetail(selectedGroupDn);
      }
    } catch (requestError) {
      notifyApiError(requestError, 'Не удалось обновить матрицу доступа');
    } finally {
      setRefreshing(false);
    }
  };

  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const payload = await groupsAccessAPI.getExport({
        branch: activeBranch,
        folderQ: debouncedFolderQuery,
        userQ: debouncedUserQuery,
      });
      const exportGroups = Array.isArray(payload?.groups) ? payload.groups : [];
      const exportUsers = Array.isArray(payload?.users) ? payload.users : [];
      if (!exportGroups.length) {
        notifyApiError(null, 'Нет данных для выгрузки');
        return;
      }
      exportGroupsAccessWorkbook({
        groups: exportGroups,
        users: exportUsers,
        branch: activeBranch,
        syncedAt: payload?.synced_at || status?.last_sync_at,
      });
      notifySuccess('Excel-файл сформирован');
    } catch (requestError) {
      notifyApiError(requestError, 'Не удалось выгрузить Excel');
    } finally {
      setExporting(false);
    }
  };

  const renderGroupList = () => (
    <Paper
      variant="outlined"
      sx={{
        ...getOfficePanelSx(ui),
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderColor: alpha(theme.palette.primary.main, 0.18),
      }}
    >
      <Box sx={{ p: 1.5, borderBottom: `1px solid ${alpha(theme.palette.divider, 0.8)}` }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Папки и группы
        </Typography>
        <TextField
          fullWidth
          size="small"
          placeholder="Поиск папки или группы"
          value={folderQuery}
          onChange={(event) => setFolderQuery(event.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchOutlinedIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
      </Box>
      <Box sx={{ flex: 1, overflow: 'auto', ...hideScrollbarSx }}>
        {loadingDataset ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={28} />
          </Box>
        ) : groups.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            Группы не найдены. Измените фильтр или обновите снимок.
          </Typography>
        ) : (
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <GroupsAccessFolderList
              groups={groups}
              selectedGroupDn={selectedGroupDn}
              branchTab={branchTab}
              onSelectGroup={handleSelectGroup}
              renderAccessLevelChip={(level) => <AccessLevelChip level={level} />}
              getGroupKey={getGroupKey}
            />
          </Box>
        )}
      </Box>
      <Box sx={{ px: 1.5, py: 1, borderTop: `1px solid ${alpha(theme.palette.divider, 0.8)}` }}>
        <Typography variant="caption" color="text.secondary">
          {groups.length} папок
          {viewMode === 'matrix' || debouncedUserQuery
            ? ` · ${users.length} учёток в выборке`
            : ''}
        </Typography>
      </Box>
    </Paper>
  );

  const renderUserSearchResults = () => (
    <Stack spacing={1.5}>
      {loadingDataset ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={28} />
        </Box>
      ) : users.length === 0 ? (
        <Alert severity="info">По учётке ничего не найдено.</Alert>
      ) : (
        users.map((item) => (
          <Paper key={item.login} variant="outlined" sx={{ p: 1.5, ...getOfficePanelSx(ui) }}>
            <Stack spacing={1}>
              <Box>
                <Typography variant="subtitle2">{item.display_name || item.login}</Typography>
                <Typography variant="caption" color="text.secondary">{item.login}</Typography>
              </Box>
              <Stack spacing={1}>
                {(item.access || []).map((accessRow) => (
                  <Box
                    key={`${item.login}-${accessRow.group_dn}`}
                    sx={{
                      p: 1,
                      borderRadius: 1.5,
                      border: `1px solid ${alpha(theme.palette.divider, 0.75)}`,
                      bgcolor: alpha(theme.palette.background.default, 0.45),
                    }}
                  >
                    <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap" sx={{ mb: 0.5 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {accessRow.folder_label}
                      </Typography>
                      <Chip size="small" label={accessRow.branch} variant="outlined" />
                      <AccessLevelChip level={accessRow.access_level} />
                    </Stack>
                    <FolderPathBreadcrumb
                      path={accessRow.folder_path || accessRow.folder_label}
                      branch={accessRow.branch}
                      compact
                    />
                  </Box>
                ))}
              </Stack>
            </Stack>
          </Paper>
        ))
      )}
    </Stack>
  );

  const renderGroupDetail = () => {
    if (debouncedUserQuery) {
      return renderUserSearchResults();
    }

    if (!selectedGroup) {
      return (
        <Alert severity="info" sx={{ m: 0 }}>
          Выберите папку слева, чтобы увидеть список пользователей с доступом.
        </Alert>
      );
    }

    const members = Array.isArray(groupDetail?.members) ? groupDetail.members : [];

    return (
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 1.5, md: 2 },
          ...getOfficePanelSx(ui),
          height: '100%',
          borderColor: alpha(theme.palette.primary.main, 0.24),
          boxShadow: `inset 4px 0 0 ${theme.palette.primary.main}`,
        }}
      >
        <Stack spacing={1.5}>
          <Box>
            <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
              <Typography variant="h6" sx={{ fontSize: { xs: '1.05rem', md: '1.2rem' } }}>
                {selectedGroup.folder_label || selectedGroup.cn}
              </Typography>
              <Chip size="small" label={selectedGroup.branch} color="primary" variant="outlined" />
              <AccessLevelChip level={selectedGroup.access_level} />
            </Stack>
            <Box sx={{ mt: 1 }}>
              <FolderPathBreadcrumb
                path={selectedGroup.folder_path || selectedGroup.folder_label || selectedGroup.cn}
                branch={selectedGroup.branch}
                emphasize
              />
            </Box>
            {selectedGroup.description ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {selectedGroup.description}
              </Typography>
            ) : null}
          </Box>

          {loadingDetail ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress size={28} />
            </Box>
          ) : members.length === 0 ? (
            <Alert severity="warning">В снимке нет пользователей с доступом к этой папке.</Alert>
          ) : (
            <Box sx={{ overflow: 'auto', ...hideScrollbarSx, maxHeight: { xs: 'none', md: 'calc(100vh - 340px)' } }}>
              <Stack spacing={0.75}>
                {members.map((member) => (
                  <Box
                    key={member.login}
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 1,
                      py: 0.85,
                      px: 1,
                      borderRadius: 1,
                      borderBottom: `1px solid ${alpha(theme.palette.divider, 0.55)}`,
                      bgcolor: alpha(theme.palette.background.default, 0.35),
                    }}
                  >
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {member.display_name || member.login}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">{member.login}</Typography>
                    </Box>
                  </Box>
                ))}
              </Stack>
            </Box>
          )}
        </Stack>
      </Paper>
    );
  };

  const renderMatrixView = () => (
    <Stack spacing={1.25}>
      {selectedGroup ? (
        <Paper
          variant="outlined"
          sx={{
            p: 1.25,
            ...getOfficePanelSx(ui),
            borderColor: alpha(theme.palette.primary.main, 0.28),
            boxShadow: `inset 4px 0 0 ${theme.palette.primary.main}`,
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
            <Typography variant="subtitle2">
              Выбрана: {selectedGroup.folder_label || selectedGroup.cn}
            </Typography>
            <Chip size="small" label={selectedGroup.branch} variant="outlined" />
            <AccessLevelChip level={selectedGroup.access_level} />
            {selectedGroup.member_count != null ? (
              <Chip size="small" variant="outlined" label={`${selectedGroup.member_count} пользователей`} />
            ) : null}
          </Stack>
          <Box sx={{ mt: 0.75 }}>
            <FolderPathBreadcrumb
              path={selectedGroup.folder_path || selectedGroup.folder_label || selectedGroup.cn}
              branch={selectedGroup.branch}
              emphasize
            />
          </Box>
        </Paper>
      ) : (
        <Alert severity="info" sx={{ py: 0.75 }}>
          Кликните по заголовку колонки в матрице, чтобы выделить папку и увидеть её путь.
        </Alert>
      )}
      <Paper variant="outlined" sx={{ p: 1.25, ...getOfficePanelSx(ui) }}>
        <MatrixLegend />
      </Paper>
      {isMobile ? (
        <Alert severity="info">
          Для удобного просмотра большой матрицы поверните телефон горизонтально или выгрузите Excel.
        </Alert>
      ) : null}
      {loadingDataset ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
          <CircularProgress size={30} />
        </Box>
      ) : (
        <GroupsAccessMatrixTable
          groups={groups}
          users={users}
          cells={matrixCells}
          selectedGroupDn={selectedGroupDn}
          onSelectGroup={handleSelectGroup}
          ui={ui}
          maxHeight={isMobile ? '58vh' : 'calc(100vh - 320px)'}
        />
      )}
    </Stack>
  );

  return (
    <MainLayout>
      <PageShell
        title="Доступ к папкам"
        subtitle="Матрица доступа по AD security groups (SPb / Tyumen)"
        icon={<FolderSharedOutlinedIcon />}
        fullHeight
        actions={(
          <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
            <Chip
              size="small"
              variant="outlined"
              label={`Обновлено: ${formatDateTime(status?.last_sync_at)}`}
            />
            <Chip
              size="small"
              label={`${datasetSummary?.group_count ?? groups.length} групп · ${datasetSummary?.user_count ?? users.length} учёток`}
              variant="outlined"
            />
            <Button
              size="small"
              variant="outlined"
              startIcon={exporting ? <CircularProgress size={16} /> : <DownloadOutlinedIcon />}
              onClick={handleExportExcel}
              disabled={exporting || loadingDataset}
            >
              Excel
            </Button>
            {isAdmin ? (
              <Button
                size="small"
                variant="outlined"
                startIcon={refreshing ? <CircularProgress size={16} /> : <RefreshOutlinedIcon />}
                onClick={handleRefresh}
                disabled={refreshing}
              >
                Обновить
              </Button>
            ) : null}
          </Stack>
        )}
      >
        <Stack spacing={1.5} sx={{ height: '100%' }}>
          <Paper variant="outlined" sx={{ px: { xs: 1, sm: 1.5 }, py: 1, ...getOfficePanelSx(ui) }}>
            <Stack spacing={1}>
              <Stack
                direction={{ xs: 'column', lg: 'row' }}
                spacing={1}
                alignItems={{ xs: 'stretch', lg: 'center' }}
                justifyContent="space-between"
              >
                <Tabs
                  value={branchTab}
                  onChange={(_event, value) => {
                    setBranchTab(value);
                    setSelectedGroupDn('');
                    setGroupDetail(null);
                  }}
                  variant={isMobile ? 'fullWidth' : 'standard'}
                  sx={{ minHeight: 40 }}
                >
                  {BRANCH_TABS.map((tab) => (
                    <Tab key={tab.value} value={tab.value} label={tab.label} sx={{ minHeight: 40 }} />
                  ))}
                </Tabs>

                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={viewMode}
                  onChange={(_event, value) => {
                    if (!value) return;
                    setViewMode(value);
                    if (value === 'matrix') {
                      setMobileSheetOpen(false);
                    }
                  }}
                >
                  <ToggleButton value="list">
                    <ViewListOutlinedIcon fontSize="small" sx={{ mr: 0.75 }} />
                    Список
                  </ToggleButton>
                  <ToggleButton value="matrix">
                    <GridViewOutlinedIcon fontSize="small" sx={{ mr: 0.75 }} />
                    Матрица
                  </ToggleButton>
                </ToggleButtonGroup>
              </Stack>

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                <TextField
                  size="small"
                  placeholder="Поиск по учётке"
                  value={userQuery}
                  onChange={(event) => setUserQuery(event.target.value)}
                  sx={{ flex: 1 }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchOutlinedIcon fontSize="small" />
                      </InputAdornment>
                    ),
                  }}
                />
                {viewMode === 'list' ? (
                  <TextField
                    size="small"
                    placeholder="Фильтр папок"
                    value={folderQuery}
                    onChange={(event) => setFolderQuery(event.target.value)}
                    sx={{ flex: 1 }}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchOutlinedIcon fontSize="small" />
                        </InputAdornment>
                      ),
                    }}
                  />
                ) : null}
              </Stack>
            </Stack>
          </Paper>

          {error ? <Alert severity="error">{error}</Alert> : null}
          {status?.error ? (
            <Alert severity="warning">
              Последняя синхронизация завершилась с ошибкой: {status.error}
            </Alert>
          ) : null}

          {viewMode === 'matrix' ? (
            renderMatrixView()
          ) : debouncedUserQuery ? (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Результаты по учётке «{debouncedUserQuery}» ({users.length})
              </Typography>
              {renderUserSearchResults()}
            </Box>
          ) : isMobile ? (
            <Box sx={{ flex: 1, minHeight: 0 }}>{renderGroupList()}</Box>
          ) : (
            <Grid container spacing={1.5} sx={{ flex: 1, minHeight: 0 }}>
              <Grid item xs={12} md={5} lg={4} sx={{ height: { md: 'calc(100vh - 300px)' } }}>
                {renderGroupList()}
              </Grid>
              <Grid item xs={12} md={7} lg={8}>
                {renderGroupDetail()}
              </Grid>
            </Grid>
          )}
        </Stack>

        <Drawer
          anchor="bottom"
          open={isMobile && mobileSheetOpen && viewMode === 'list'}
          onClose={() => setMobileSheetOpen(false)}
          PaperProps={{
            sx: {
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              maxHeight: '82vh',
              pb: 'calc(var(--app-shell-mobile-bottom-nav-height, 64px) + 8px)',
            },
          }}
        >
          <Box sx={{ p: 1.5 }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
              <Typography variant="subtitle1">Доступ к папке</Typography>
              <IconButton onClick={() => setMobileSheetOpen(false)} aria-label="Закрыть">
                <CloseIcon />
              </IconButton>
            </Stack>
            {renderGroupDetail()}
          </Box>
        </Drawer>
      </PageShell>
    </MainLayout>
  );
};

export default GroupsAccess;
