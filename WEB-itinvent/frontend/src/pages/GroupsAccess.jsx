import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { getAccessLevelMeta } from '../lib/groupsAccessUtils';
import { hideScrollbarSx } from '../lib/hideScrollbarSx';
import { buildOfficeUiTokens, getOfficePanelSx } from '../theme/officeUiTokens';

const SEARCH_DEBOUNCE_MS = 300;
const MATRIX_GROUP_LIMIT = 250;
const MATRIX_USER_LIMIT = 500;
const MEMBER_PREVIEW_LIMIT = 250;
const BRANCH_TABS = [
  { value: 'all', label: 'Все' },
  { value: 'SPb', label: 'SPb' },
  { value: 'Tyumen', label: 'Tyumen' },
];
const VIEW_MODES = {
  FOLDERS: 'folders',
  USER: 'user',
  MATRIX: 'matrix',
  EXPORT: 'export',
};

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
  const groupDetailRequestIdRef = useRef(0);

  const [branchTab, setBranchTab] = useState('all');
  const [viewMode, setViewMode] = useState(VIEW_MODES.FOLDERS);
  const [folderQuery, setFolderQuery] = useState('');
  const [userQuery, setUserQuery] = useState('');
  const [memberQuery, setMemberQuery] = useState('');
  const debouncedUserQuery = useDebouncedValue(userQuery);
  const debouncedFolderQuery = useDebouncedValue(folderQuery);

  const [status, setStatus] = useState(null);
  const [groups, setGroups] = useState([]);
  const [users, setUsers] = useState([]);
  const [matrixCells, setMatrixCells] = useState([]);
  const [datasetSummary, setDatasetSummary] = useState(null);
  const [selectedGroupDn, setSelectedGroupDn] = useState('');
  const [groupDetail, setGroupDetail] = useState(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingUserSearch, setLoadingUserSearch] = useState(false);
  const [loadingMatrix, setLoadingMatrix] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingFolder, setExportingFolder] = useState(false);
  const [error, setError] = useState('');
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  const activeBranch = branchTab === 'all' ? '' : branchTab;
  const loadingDataset = loadingList || loadingUserSearch || loadingMatrix;
  const groupsByKey = useMemo(() => {
    const nextMap = new Map();
    groups.forEach((item) => {
      const key = getGroupKey(item);
      if (key) nextMap.set(key, item);
    });
    return nextMap;
  }, [groups]);
  const selectedGroup = useMemo(
    () => groupsByKey.get(selectedGroupDn) || groupDetail?.group || null,
    [groupDetail?.group, groupsByKey, selectedGroupDn],
  );
  const groupMembers = useMemo(
    () => (Array.isArray(groupDetail?.members) ? groupDetail.members : []),
    [groupDetail?.members],
  );
  const visibleGroupMembers = useMemo(() => {
    const query = String(memberQuery || '').trim().toLowerCase();
    if (!query) return groupMembers;
    return groupMembers.filter((member) => (
      String(member?.login || '').toLowerCase().includes(query)
      || String(member?.display_name || '').toLowerCase().includes(query)
    ));
  }, [groupMembers, memberQuery]);
  const foundAccessCount = useMemo(
    () => users.reduce((total, item) => total + (Array.isArray(item?.access) ? item.access.length : 0), 0),
    [users],
  );
  const exportPreviewMembers = useMemo(
    () => groupMembers.slice(0, MEMBER_PREVIEW_LIMIT),
    [groupMembers],
  );
  const hasHiddenExportMembers = groupMembers.length > exportPreviewMembers.length;
  const summaryGroupCount = datasetSummary?.group_count ?? status?.summary?.group_count ?? groups.length;
  const summaryUserCount = datasetSummary?.user_count ?? status?.summary?.user_count ?? users.length;
  const matrixTruncated = viewMode === VIEW_MODES.MATRIX && Boolean(datasetSummary?.truncated);
  const matrixReturnedGroupCount = datasetSummary?.returned_group_count ?? groups.length;
  const matrixReturnedUserCount = datasetSummary?.returned_user_count ?? users.length;
  const viewModeToggleSx = useMemo(() => {
    const idleText = ui.isDark
      ? alpha(theme.palette.common.white, 0.76)
      : theme.palette.text.secondary;
    const hoverText = ui.isDark
      ? theme.palette.common.white
      : theme.palette.text.primary;
    const selectedText = ui.isDark
      ? theme.palette.common.white
      : theme.palette.text.primary;
    const selectedBg = ui.isDark
      ? alpha(theme.palette.common.white, 0.14)
      : theme.palette.background.paper;

    return {
      width: { xs: '100%', lg: 'auto' },
      alignSelf: { xs: 'stretch', lg: 'center' },
      gap: 0.25,
      flexWrap: 'wrap',
      p: 0.25,
      bgcolor: ui.isDark
        ? alpha(theme.palette.common.white, 0.035)
        : alpha(theme.palette.common.black, 0.035),
      border: '1px solid',
      borderColor: ui.borderStrong,
      borderRadius: 1.5,
      '& .MuiToggleButtonGroup-grouped': {
        mx: 0,
        border: 0,
        borderRadius: '8px !important',
      },
      '& .MuiToggleButton-root': {
        minHeight: 36,
        flex: { xs: '1 1 calc(50% - 4px)', sm: '0 0 auto' },
        minWidth: { xs: 0, sm: 132 },
        justifyContent: 'center',
        px: { xs: 1, sm: 1.25 },
        color: idleText,
        fontWeight: 800,
        lineHeight: 1.15,
        whiteSpace: 'nowrap',
        opacity: 1,
        textTransform: 'none',
        '& .MuiSvgIcon-root': {
          color: 'inherit',
        },
        '&:hover': {
          color: hoverText,
          bgcolor: ui.actionHover,
        },
        '&.Mui-selected': {
          color: selectedText,
          bgcolor: selectedBg,
          boxShadow: `0 1px 3px ${alpha(theme.palette.common.black, ui.isDark ? 0.26 : 0.12)}`,
          '&:hover': {
            color: selectedText,
            bgcolor: selectedBg,
          },
        },
      },
    };
  }, [theme, ui]);

  const loadStatus = useCallback(async () => {
    try {
      const payload = await groupsAccessAPI.getStatus();
      setStatus(payload);
    } catch (requestError) {
      notifyApiError(requestError, 'Не удалось загрузить статус матрицы доступа');
    }
  }, [notifyApiError]);

  const loadListGroups = useCallback(async () => {
    setLoadingList(true);
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
      setUsers([]);
      setMatrixCells([]);
      setDatasetSummary({
        group_count: payload?.total ?? nextGroups.length,
      });

      setSelectedGroupDn((current) => {
        if (current && nextGroups.some((item) => getGroupKey(item) === current)) {
          return current;
        }
        if (nextGroups.length > 0) {
          return getGroupKey(nextGroups[0]);
        }
        return '';
      });
    } catch (requestError) {
      setError('Не удалось загрузить список папок');
      notifyApiError(requestError, 'Не удалось загрузить список папок');
    } finally {
      setLoadingList(false);
    }
  }, [activeBranch, debouncedFolderQuery, notifyApiError]);

  const loadUserSearch = useCallback(async () => {
    setLoadingUserSearch(true);
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
        user_count: payload?.total ?? nextUsers.length,
      });
      setSelectedGroupDn('');
      setGroupDetail(null);
    } catch (requestError) {
      setError('Не удалось найти учётки');
      notifyApiError(requestError, 'Не удалось найти учётки');
    } finally {
      setLoadingUserSearch(false);
    }
  }, [activeBranch, debouncedUserQuery, notifyApiError]);

  const loadMatrixGrid = useCallback(async () => {
    setLoadingMatrix(true);
    setError('');
    try {
      const payload = await groupsAccessAPI.getMatrixGrid({
        branch: activeBranch,
        folderQ: debouncedFolderQuery,
        userQ: debouncedUserQuery,
        groupLimit: MATRIX_GROUP_LIMIT,
        userLimit: MATRIX_USER_LIMIT,
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
      setLoadingMatrix(false);
    }
  }, [activeBranch, debouncedFolderQuery, debouncedUserQuery, notifyApiError]);

  const loadGroupDetail = useCallback(async (groupDn) => {
    const normalized = normalizeText(groupDn);
    const requestId = groupDetailRequestIdRef.current + 1;
    groupDetailRequestIdRef.current = requestId;
    if (!normalized) {
      setGroupDetail(null);
      return;
    }
    setLoadingDetail(true);
    try {
      const payload = await groupsAccessAPI.getGroup(normalized);
      if (groupDetailRequestIdRef.current !== requestId) return;
      setGroupDetail(payload);
    } catch (requestError) {
      if (groupDetailRequestIdRef.current !== requestId) return;
      notifyApiError(requestError, 'Не удалось загрузить участников группы');
      setGroupDetail(null);
    } finally {
      if (groupDetailRequestIdRef.current === requestId) {
        setLoadingDetail(false);
      }
    }
  }, [notifyApiError]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (viewMode === VIEW_MODES.MATRIX) {
      loadMatrixGrid();
      return;
    }
    if (viewMode === VIEW_MODES.USER) {
      setGroups([]);
      setMatrixCells([]);
      setSelectedGroupDn('');
      setGroupDetail(null);
      if (debouncedUserQuery) {
        loadUserSearch();
      } else {
        setUsers([]);
        setDatasetSummary(null);
        setLoadingUserSearch(false);
      }
      return;
    }
    loadListGroups();
  }, [debouncedUserQuery, loadListGroups, loadMatrixGrid, loadUserSearch, viewMode]);

  useEffect(() => {
    if (viewMode !== VIEW_MODES.FOLDERS && viewMode !== VIEW_MODES.EXPORT) return;
    if (!selectedGroupDn) {
      loadGroupDetail('');
      return;
    }
    loadGroupDetail(selectedGroupDn);
  }, [loadGroupDetail, selectedGroupDn, viewMode]);

  const handleSelectGroup = (group) => {
    const groupDn = getGroupKey(group);
    setSelectedGroupDn(groupDn);
    setMemberQuery('');
    if (isMobile && viewMode === VIEW_MODES.FOLDERS) {
      setMobileSheetOpen(true);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await groupsAccessAPI.refresh();
      notifySuccess('Снимок матрицы доступа обновлён');
      let reloadCurrentView = Promise.resolve();
      if (viewMode === VIEW_MODES.MATRIX) {
        reloadCurrentView = loadMatrixGrid();
      } else if (viewMode === VIEW_MODES.USER) {
        reloadCurrentView = debouncedUserQuery ? loadUserSearch() : Promise.resolve();
      } else {
        reloadCurrentView = loadListGroups();
      }
      await Promise.all([loadStatus(), reloadCurrentView]);
      if (selectedGroupDn && (viewMode === VIEW_MODES.FOLDERS || viewMode === VIEW_MODES.EXPORT)) {
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
      const exportFolderQuery = viewMode === VIEW_MODES.USER ? '' : debouncedFolderQuery;
      const exportUserQuery = viewMode === VIEW_MODES.FOLDERS ? '' : debouncedUserQuery;
      const payload = await groupsAccessAPI.getExport({
        branch: activeBranch,
        folderQ: exportFolderQuery,
        userQ: exportUserQuery,
      });
      const exportGroups = Array.isArray(payload?.groups) ? payload.groups : [];
      const exportUsers = Array.isArray(payload?.users) ? payload.users : [];
      if (!exportGroups.length) {
        notifyApiError(null, 'Нет данных для выгрузки');
        return;
      }
      const { exportGroupsAccessWorkbook } = await import('../lib/groupsAccessExport');
      await exportGroupsAccessWorkbook({
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

  const handleExportSelectedGroup = async () => {
    if (!selectedGroupDn) {
      notifyApiError(null, 'Выберите папку для выгрузки');
      return;
    }

    setExportingFolder(true);
    try {
      const currentDetailDn = getGroupKey(groupDetail?.group);
      const payload = currentDetailDn === selectedGroupDn
        ? groupDetail
        : await groupsAccessAPI.getGroup(selectedGroupDn);
      const exportGroup = payload?.group || selectedGroup;
      const exportMembers = Array.isArray(payload?.members) ? payload.members : [];
      if (!exportGroup) {
        notifyApiError(null, 'Не удалось определить выбранную папку');
        return;
      }
      const { exportGroupMembersWorkbook } = await import('../lib/groupsAccessExport');
      await exportGroupMembersWorkbook({
        group: exportGroup,
        members: exportMembers,
        syncedAt: payload?.synced_at || status?.last_sync_at,
      });
      notifySuccess('Excel по папке сформирован');
    } catch (requestError) {
      notifyApiError(requestError, 'Не удалось выгрузить выбранную папку');
    } finally {
      setExportingFolder(false);
    }
  };

  const renderGroupList = () => (
    <Paper
      variant="outlined"
      sx={{
        ...getOfficePanelSx(ui),
        height: '100%',
        minHeight: { xs: 320, md: 0 },
        display: 'flex',
        flexDirection: 'column',
        contain: 'layout style',
        borderColor: alpha(theme.palette.primary.main, 0.18),
      }}
    >
      <Box sx={{ p: 1.5, borderBottom: `1px solid ${alpha(theme.palette.divider, 0.8)}` }}>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
          <Typography variant="subtitle2">Папки и группы AD</Typography>
          <Chip size="small" variant="outlined" label={`${groups.length} в списке`} />
        </Stack>
      </Box>
      <Box sx={{ flex: '1 1 auto', minHeight: 220, overflow: 'hidden', ...hideScrollbarSx }}>
        {loadingList ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={28} />
          </Box>
        ) : groups.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            Группы не найдены. Измените фильтр или обновите снимок.
          </Typography>
        ) : (
          <GroupsAccessFolderList
            groups={groups}
            selectedGroupDn={selectedGroupDn}
            branchTab={branchTab}
            onSelectGroup={handleSelectGroup}
            renderAccessLevelChip={(level) => <AccessLevelChip level={level} />}
            getGroupKey={getGroupKey}
          />
        )}
      </Box>
      <Box sx={{ px: 1.5, py: 1, borderTop: `1px solid ${alpha(theme.palette.divider, 0.8)}` }}>
        <Typography variant="caption" color="text.secondary">
          {groups.length} папок
          {viewMode === VIEW_MODES.MATRIX
            ? ` · ${users.length} учёток в выборке`
            : ''}
        </Typography>
      </Box>
    </Paper>
  );

  const renderUserSearchResults = () => (
    <Stack spacing={1.25} sx={{ height: '100%', minHeight: 0 }}>
      {!debouncedUserQuery ? (
        <Alert severity="info">
          Введите логин или ФИО, чтобы увидеть все папки, к которым у сотрудника есть доступ.
        </Alert>
      ) : loadingUserSearch ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={28} />
        </Box>
      ) : users.length === 0 ? (
        <Alert severity="info">По учётке ничего не найдено.</Alert>
      ) : (
        <>
          <Paper variant="outlined" sx={{ p: 1.25, ...getOfficePanelSx(ui) }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent="space-between">
              <Typography variant="subtitle2">
                Найдено: {users.length} учёток · {foundAccessCount} доступов
              </Typography>
              <Chip size="small" variant="outlined" label={branchTab === 'all' ? 'Все филиалы' : branchTab} />
            </Stack>
          </Paper>
          <Box
            data-testid="groups-access-user-results-scroll"
            sx={{ flex: 1, minHeight: 0, overflow: 'auto', pr: { xs: 0, md: 0.5 }, ...hideScrollbarSx }}
          >
            <Stack spacing={1}>
              {users.map((item) => (
                <Paper key={item.login} variant="outlined" sx={{ p: 1.25, ...getOfficePanelSx(ui) }}>
                  <Stack spacing={1}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.75} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between">
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{item.display_name || item.login}</Typography>
                        <Typography variant="caption" color="text.secondary">{item.login}</Typography>
                      </Box>
                      <Chip size="small" variant="outlined" label={`${item.access_count ?? item.access?.length ?? 0} папок`} />
                    </Stack>
                    <Stack spacing={0.65}>
                      {(item.access || []).map((accessRow) => (
                        <Box
                          key={`${item.login}-${accessRow.group_dn}`}
                          sx={{
                            py: 0.75,
                            px: 1,
                            borderRadius: 1,
                            border: `1px solid ${alpha(theme.palette.divider, 0.65)}`,
                            bgcolor: alpha(theme.palette.background.default, 0.4),
                          }}
                        >
                          <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap" sx={{ mb: 0.35 }}>
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>
                              {accessRow.folder_label}
                            </Typography>
                            <AccessLevelChip level={accessRow.access_level} />
                            <Chip size="small" label={accessRow.branch} variant="outlined" />
                          </Stack>
                          <FolderPathBreadcrumb
                            path={accessRow.folder_path || accessRow.folder_label}
                            branch=""
                            compact
                          />
                        </Box>
                      ))}
                    </Stack>
                  </Stack>
                </Paper>
              ))}
            </Stack>
          </Box>
        </>
      )}
    </Stack>
  );

  const renderGroupDetail = () => {
    if (!selectedGroup) {
      return (
        <Alert severity="info" sx={{ m: 0 }}>
          Выберите папку слева, чтобы увидеть список пользователей с доступом.
        </Alert>
      );
    }

    return (
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 1.5, md: 2 },
          ...getOfficePanelSx(ui),
          height: '100%',
          minHeight: 0,
          overflow: 'hidden',
          borderColor: alpha(theme.palette.primary.main, 0.24),
          boxShadow: `inset 4px 0 0 ${theme.palette.primary.main}`,
        }}
      >
        <Stack spacing={1.5} sx={{ height: '100%', minHeight: 0 }}>
          <Box>
            <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
              <Typography variant="h6" sx={{ fontSize: { xs: '1.05rem', md: '1.2rem' } }}>
                {selectedGroup.folder_label || selectedGroup.cn}
              </Typography>
              <Chip size="small" label={selectedGroup.branch} color="primary" variant="outlined" />
              <AccessLevelChip level={selectedGroup.access_level} />
              <Chip size="small" variant="outlined" label={`${groupMembers.length} пользователей`} />
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
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75, overflowWrap: 'anywhere' }}>
              AD-группа: {selectedGroup.cn || 'не указана'}
            </Typography>
          </Box>

          {loadingDetail ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress size={28} />
            </Box>
          ) : groupMembers.length === 0 ? (
            <Alert severity="warning">В снимке нет пользователей с доступом к этой папке.</Alert>
          ) : (
            <Stack spacing={1} sx={{ flex: 1, minHeight: 0 }}>
              <TextField
                size="small"
                placeholder="Фильтр участников"
                value={memberQuery}
                onChange={(event) => setMemberQuery(event.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchOutlinedIcon fontSize="small" />
                    </InputAdornment>
                  ),
                }}
              />
              <Box sx={{ flex: 1, minHeight: { xs: 180, md: 0 }, overflow: 'auto', ...hideScrollbarSx, maxHeight: { xs: 'none', md: 'calc(100vh - 390px)' } }}>
                {visibleGroupMembers.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                    По фильтру участников ничего не найдено.
                  </Typography>
                ) : (
                  <Stack spacing={0.5}>
                    {visibleGroupMembers.map((member) => (
                      <Box
                        key={member.login}
                        sx={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 1,
                          py: 0.75,
                          px: 1,
                          borderRadius: 1,
                          borderBottom: `1px solid ${alpha(theme.palette.divider, 0.55)}`,
                          bgcolor: alpha(theme.palette.background.default, 0.35),
                        }}
                      >
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>
                            {member.display_name || member.login}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" noWrap>{member.login}</Typography>
                        </Box>
                      </Box>
                    ))}
                  </Stack>
                )}
              </Box>
            </Stack>
          )}
        </Stack>
      </Paper>
    );
  };

  const renderExportView = () => (
    <Grid container spacing={1.5} sx={{ flex: 1, minHeight: 0 }}>
      <Grid item xs={12} md={5} lg={4} sx={{ height: { xs: 380, md: 'calc(100vh - 300px)' }, minHeight: 0 }}>
        {renderGroupList()}
      </Grid>
      <Grid item xs={12} md={7} lg={8} sx={{ height: { md: 'calc(100vh - 300px)' }, minHeight: 0 }}>
        <Paper
          variant="outlined"
          sx={{
            ...getOfficePanelSx(ui),
            height: { xs: 'auto', md: '100%' },
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <Box sx={{ p: 1.5, borderBottom: `1px solid ${alpha(theme.palette.divider, 0.8)}` }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent="space-between">
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                  Экспорт доступов
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {branchTab === 'all' ? 'Все филиалы' : branchTab}
                </Typography>
              </Box>
              <Button
                size="small"
                variant="contained"
                startIcon={exporting ? <CircularProgress size={16} color="inherit" /> : <DownloadOutlinedIcon />}
                onClick={handleExportExcel}
                disabled={exporting || loadingDataset}
              >
                Выгрузить выборку
              </Button>
            </Stack>
          </Box>

          <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 1.5, ...hideScrollbarSx }}>
            <Stack spacing={1.25}>
              <Box
                sx={{
                  p: 1.25,
                  borderRadius: 1,
                  border: `1px solid ${alpha(theme.palette.divider, 0.65)}`,
                  bgcolor: alpha(theme.palette.background.default, 0.35),
                }}
              >
                <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                  <Chip size="small" variant="outlined" label={`${summaryGroupCount} папок`} />
                  <Chip size="small" variant="outlined" label={`${summaryUserCount} учёток`} />
                  {debouncedFolderQuery ? <Chip size="small" variant="outlined" label={`Папка: ${debouncedFolderQuery}`} /> : null}
                  {debouncedUserQuery ? <Chip size="small" variant="outlined" label={`Учётка: ${debouncedUserQuery}`} /> : null}
                </Stack>
              </Box>

              <Box
                sx={{
                  p: 1.25,
                  borderRadius: 1,
                  border: `1px solid ${alpha(theme.palette.divider, 0.65)}`,
                }}
              >
                <Stack spacing={1}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent="space-between">
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                        Выбранная папка
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {selectedGroup ? `${groupMembers.length} участников` : 'Папка не выбрана'}
                      </Typography>
                    </Box>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={exportingFolder ? <CircularProgress size={16} /> : <DownloadOutlinedIcon />}
                      onClick={handleExportSelectedGroup}
                      disabled={!selectedGroupDn || exportingFolder || loadingDetail}
                    >
                      Папку с участниками
                    </Button>
                  </Stack>

                  {selectedGroup ? (
                    <>
                      <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
                        <Typography variant="body2" sx={{ fontWeight: 800 }}>
                          {selectedGroup.folder_label || selectedGroup.cn}
                        </Typography>
                        <Chip size="small" label={selectedGroup.branch} variant="outlined" />
                        <AccessLevelChip level={selectedGroup.access_level} />
                      </Stack>
                      <FolderPathBreadcrumb
                        path={selectedGroup.folder_path || selectedGroup.folder_label || selectedGroup.cn}
                        branch={selectedGroup.branch}
                        compact
                        emphasize
                      />
                      {loadingDetail ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                          <CircularProgress size={24} />
                        </Box>
                      ) : groupMembers.length ? (
                        <Box sx={{ maxHeight: 260, overflow: 'auto', ...hideScrollbarSx }}>
                          <Stack spacing={0.5}>
                            {exportPreviewMembers.map((member) => (
                              <Box
                                key={member.login}
                                sx={{
                                  px: 1,
                                  py: 0.65,
                                  borderRadius: 1,
                                  bgcolor: alpha(theme.palette.background.default, 0.38),
                                  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.48)}`,
                                }}
                              >
                                <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
                                  {member.display_name || member.login}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" noWrap>
                                  {member.login}
                                </Typography>
                              </Box>
                            ))}
                            {hasHiddenExportMembers ? (
                              <Typography variant="caption" color="text.secondary" sx={{ px: 1, py: 0.5 }}>
                                В preview показаны первые {MEMBER_PREVIEW_LIMIT} участников. В Excel попадёт полный список: {groupMembers.length}.
                              </Typography>
                            ) : null}
                          </Stack>
                        </Box>
                      ) : (
                        <Alert severity="warning">В снимке нет участников для выбранной папки.</Alert>
                      )}
                    </>
                  ) : (
                    <Alert severity="info">Выберите папку слева, чтобы выгрузить список участников.</Alert>
                  )}
                </Stack>
              </Box>
            </Stack>
          </Box>
        </Paper>
      </Grid>
    </Grid>
  );

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
      {matrixTruncated ? (
        <Alert severity="warning">
          Матрица ограничена для быстрого рендера: показано {matrixReturnedGroupCount} из {summaryGroupCount} папок и {matrixReturnedUserCount} из {summaryUserCount} учёток. Сузьте фильтр или выгрузите Excel для полного списка.
        </Alert>
      ) : null}
      {loadingMatrix ? (
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
          compact={isMobile}
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
              label={`${summaryGroupCount} групп · ${summaryUserCount} учёток`}
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
        <Stack spacing={1.5} sx={{ height: '100%', minHeight: 0 }}>
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
                    setMemberQuery('');
                  }}
                  variant={isMobile ? 'fullWidth' : 'standard'}
                  sx={{ minHeight: 40, width: { xs: '100%', lg: 'auto' } }}
                >
                  {BRANCH_TABS.map((tab) => (
                    <Tab key={tab.value} value={tab.value} label={tab.label} sx={{ minHeight: 40 }} />
                  ))}
                </Tabs>

                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={viewMode}
                  sx={viewModeToggleSx}
                  onChange={(_event, value) => {
                    if (!value) return;
                    setViewMode(value);
                    setError('');
                    if (value !== VIEW_MODES.FOLDERS) {
                      setMobileSheetOpen(false);
                    }
                  }}
                >
                  <ToggleButton value={VIEW_MODES.FOLDERS}>
                    <ViewListOutlinedIcon fontSize="small" sx={{ mr: 0.75 }} />
                    По папкам
                  </ToggleButton>
                  <ToggleButton value={VIEW_MODES.USER}>
                    <SearchOutlinedIcon fontSize="small" sx={{ mr: 0.75 }} />
                    По сотруднику
                  </ToggleButton>
                  <ToggleButton value={VIEW_MODES.MATRIX}>
                    <GridViewOutlinedIcon fontSize="small" sx={{ mr: 0.75 }} />
                    Матрица
                  </ToggleButton>
                  <ToggleButton value={VIEW_MODES.EXPORT}>
                    <DownloadOutlinedIcon fontSize="small" sx={{ mr: 0.75 }} />
                    Экспорт
                  </ToggleButton>
                </ToggleButtonGroup>
              </Stack>

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                {viewMode !== VIEW_MODES.USER ? (
                  <TextField
                    size="small"
                    placeholder="Папка, путь или AD-группа"
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
                {viewMode !== VIEW_MODES.FOLDERS ? (
                  <TextField
                    size="small"
                    placeholder={viewMode === VIEW_MODES.MATRIX ? 'Фильтр учёток в матрице' : 'Логин или ФИО сотрудника'}
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

          {viewMode === VIEW_MODES.MATRIX ? (
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', ...hideScrollbarSx }}>
              {renderMatrixView()}
            </Box>
          ) : viewMode === VIEW_MODES.EXPORT ? (
            <Box sx={{ flex: 1, minHeight: 0, overflow: { xs: 'auto', md: 'hidden' }, ...hideScrollbarSx }}>
              {renderExportView()}
            </Box>
          ) : viewMode === VIEW_MODES.USER ? (
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden', pb: 1, display: 'flex', flexDirection: 'column' }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {debouncedUserQuery ? `Результаты по сотруднику «${debouncedUserQuery}»` : 'Поиск сотрудника'}
              </Typography>
              {renderUserSearchResults()}
            </Box>
          ) : isMobile ? (
            <Box sx={{ flex: 1, minHeight: 320 }}>{renderGroupList()}</Box>
          ) : (
            <Grid container spacing={1.5} sx={{ flex: 1, minHeight: 0 }}>
              <Grid item xs={12} md={5} lg={4} sx={{ height: { md: 'calc(100vh - 300px)' } }}>
                {renderGroupList()}
              </Grid>
              <Grid item xs={12} md={7} lg={8} sx={{ height: { md: 'calc(100vh - 300px)' }, minHeight: 0 }}>
                {renderGroupDetail()}
              </Grid>
            </Grid>
          )}
        </Stack>

        <Drawer
          anchor="bottom"
          open={isMobile && mobileSheetOpen && viewMode === VIEW_MODES.FOLDERS}
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
