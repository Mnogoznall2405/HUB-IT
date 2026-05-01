import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import SyncIcon from '@mui/icons-material/Sync';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import { adUsersAPI } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

const NO_DEPARTMENT_LABEL = 'Без отдела';

const STATUS_META = {
  new: { label: 'Новый', color: 'primary' },
  exists_ldap: { label: 'Уже в web', color: 'success' },
  local_conflict: { label: 'Конфликт local', color: 'warning' },
};

const WARNING_LABELS = {
  missing_mail: 'Нет почты',
  missing_department: 'Нет отдела',
};

const normalizeLogin = (value) => String(value || '').trim().toLowerCase();
const normalizeSearchText = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
const SEARCH_DEBOUNCE_MS = 350;

const getStatusMeta = (status) => STATUS_META[status] || { label: 'Неизвестно', color: 'default' };

const getWarnings = (user) => (
  Array.isArray(user?.warnings)
    ? user.warnings.map((item) => String(item || '').trim()).filter(Boolean)
    : []
);

const isImportSelectable = (user) => normalizeLogin(user?.login) && user?.import_status !== 'local_conflict';

const matchesAdUserSearch = (user, query) => {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  const tokens = normalizedQuery.split(' ').filter(Boolean);
  const haystack = user?._search_text || buildAdUserSearchText(user);
  return tokens.every((token) => haystack.includes(token));
};

const buildAdUserSearchText = (user) => normalizeSearchText([
  user?.display_name,
  user?.login,
  user?.department,
  user?.title,
  user?.mail,
  user?.mailbox_login,
].filter(Boolean).join(' '));

const useDebouncedValue = (value, delayMs = SEARCH_DEBOUNCE_MS) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debounced;
};

const formatImportSummary = (result) => {
  if (!result) return '';
  return [
    `создано: ${Number(result.created || 0)}`,
    `обновлено: ${Number(result.updated || 0)}`,
    `конфликтов: ${Number(result.skipped_conflicts || 0)}`,
    `не найдено: ${Number(result.not_found || 0)}`,
    `без почты: ${Number(result.missing_mail || 0)}`,
    `без отдела: ${Number(result.missing_department || 0)}`,
  ].join(', ');
};

const AdUsers = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [importing, setImporting] = useState({});
  const [selectedLogins, setSelectedLogins] = useState(() => new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState('');
  const [syncResult, setSyncResult] = useState(null);
  const [expandedDepartments, setExpandedDepartments] = useState(new Set());
  const debouncedSearchQuery = useDebouncedValue(searchQuery);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { hasPermission } = useAuth();
  const canManageAdUsers = hasPermission('ad_users.manage');

  const fetchInitialData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const usersData = await adUsersAPI.getImportCandidates();
      const nextUsers = Array.isArray(usersData) ? usersData : [];
      setUsers(nextUsers);
      setSelectedLogins((prev) => {
        const selectable = new Set(nextUsers.filter(isImportSelectable).map((item) => normalizeLogin(item.login)));
        return new Set(Array.from(prev).filter((login) => selectable.has(login)));
      });
    } catch (err) {
      console.error('Failed to fetch AD import candidates:', err);
      setError('Ошибка загрузки пользователей AD. Пожалуйста, попробуйте позже.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchInitialData();
  }, [fetchInitialData]);

  const metrics = useMemo(() => ({
    total: users.length,
    newUsers: users.filter((item) => item.import_status === 'new').length,
    ldapExisting: users.filter((item) => item.import_status === 'exists_ldap').length,
    conflicts: users.filter((item) => item.import_status === 'local_conflict').length,
    missingMail: users.filter((item) => getWarnings(item).includes('missing_mail')).length,
    missingDepartment: users.filter((item) => getWarnings(item).includes('missing_department')).length,
  }), [users]);

  const indexedUsers = useMemo(
    () => users.map((user) => ({ ...user, _search_text: buildAdUserSearchText(user) })),
    [users],
  );
  const filteredUsers = useMemo(
    () => {
      if (!normalizeSearchText(debouncedSearchQuery)) return indexedUsers;
      return indexedUsers.filter((user) => matchesAdUserSearch(user, debouncedSearchQuery));
    },
    [debouncedSearchQuery, indexedUsers],
  );
  const isSearchActive = Boolean(normalizeSearchText(debouncedSearchQuery));
  const filteredNewCount = useMemo(
    () => filteredUsers.filter((item) => item.import_status === 'new').length,
    [filteredUsers],
  );

  const groupedUsers = useMemo(() => filteredUsers.reduce((acc, user) => {
    const department = String(user?.department || '').trim() || NO_DEPARTMENT_LABEL;
    if (!acc[department]) acc[department] = [];
    acc[department].push(user);
    return acc;
  }, {}), [filteredUsers]);

  const sortedDepartments = useMemo(() => Object.keys(groupedUsers).sort((a, b) => {
    if (a === NO_DEPARTMENT_LABEL) return -1;
    if (b === NO_DEPARTMENT_LABEL) return 1;
    return a.localeCompare(b, 'ru');
  }), [groupedUsers]);

  const selectedCount = selectedLogins.size;
  const selectedNewCount = useMemo(() => users.filter((item) => selectedLogins.has(normalizeLogin(item.login)) && item.import_status === 'new').length, [selectedLogins, users]);
  const selectedExistingCount = useMemo(() => users.filter((item) => selectedLogins.has(normalizeLogin(item.login)) && item.import_status === 'exists_ldap').length, [selectedLogins, users]);

  const toggleDepartment = useCallback((departmentName) => {
    setExpandedDepartments((prev) => {
      const next = new Set(prev);
      if (next.has(departmentName)) next.delete(departmentName);
      else next.add(departmentName);
      return next;
    });
  }, []);

  const openPasswordPortal = useCallback(() => {
    window.open('https://tmn-srv-rgw-01/RDWeb/Pages/en-US/password.aspx', '_blank', 'noopener,noreferrer');
  }, []);

  const toggleLogin = useCallback((login) => {
    const normalizedLogin = normalizeLogin(login);
    if (!normalizedLogin) return;
    setSelectedLogins((prev) => {
      const next = new Set(prev);
      if (next.has(normalizedLogin)) next.delete(normalizedLogin);
      else next.add(normalizedLogin);
      return next;
    });
  }, []);

  const setDepartmentSelected = useCallback((departmentUsers, checked) => {
    const logins = (departmentUsers || [])
      .filter(isImportSelectable)
      .map((item) => normalizeLogin(item.login))
      .filter(Boolean);
    if (logins.length === 0) return;
    setSelectedLogins((prev) => {
      const next = new Set(prev);
      logins.forEach((login) => {
        if (checked) next.add(login);
        else next.delete(login);
      });
      return next;
    });
  }, []);

  const selectNewUsers = useCallback(() => {
    setSelectedLogins(new Set(
      filteredUsers
        .filter((item) => item.import_status === 'new' && isImportSelectable(item))
        .map((item) => normalizeLogin(item.login)),
    ));
  }, [filteredUsers]);

  const clearSelection = useCallback(() => {
    setSelectedLogins(new Set());
  }, []);

  const importLogins = useCallback(async (logins) => {
    const normalizedLogins = Array.from(new Set((logins || []).map(normalizeLogin).filter(Boolean)));
    if (normalizedLogins.length === 0) return;
    setError('');
    setSyncResult(null);
    const result = await adUsersAPI.syncToApp(normalizedLogins);
    setSyncResult(result);
    setSelectedLogins(new Set());
    await fetchInitialData();
  }, [fetchInitialData]);

  const handleBulkImport = useCallback(async () => {
    setBulkImporting(true);
    try {
      await importLogins(Array.from(selectedLogins));
    } catch (err) {
      console.error('Failed to import selected AD users:', err);
      setError('Не удалось импортировать выбранных пользователей AD в web-пользователи.');
    } finally {
      setBulkImporting(false);
    }
  }, [importLogins, selectedLogins]);

  const handleImportToApp = useCallback(async (login) => {
    const normalizedLogin = normalizeLogin(login);
    if (!normalizedLogin) return;
    setImporting((prev) => ({ ...prev, [normalizedLogin]: true }));
    try {
      await importLogins([normalizedLogin]);
    } catch (err) {
      console.error('Failed to import AD user:', err);
      setError('Не удалось импортировать пользователя AD в web-пользователи.');
    } finally {
      setImporting((prev) => ({ ...prev, [normalizedLogin]: false }));
    }
  }, [importLogins]);

  return (
    <MainLayout>
      <PageShell>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, gap: 2, flexWrap: 'wrap' }}>
          <Typography variant="h4" component="h1" gutterBottom={false}>
            Пользователи AD
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              color="primary"
              startIcon={<RefreshIcon />}
              onClick={() => void fetchInitialData()}
              disabled={loading || bulkImporting}
            >
              Обновить
            </Button>
            <Button
              variant="contained"
              color="secondary"
              startIcon={<OpenInNewIcon />}
              onClick={openPasswordPortal}
            >
              Портал смены пароля
            </Button>
          </Box>
        </Box>

        <Alert severity="info" sx={{ mb: 2 }}>
          Импорт создаёт web-пользователей из AD по логину sAMAccountName. Существующие LDAP-пользователи обновляются, local-конфликты не изменяются.
        </Alert>

        <Paper variant="outlined" sx={{ p: 1.25, mb: 2 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2} alignItems={{ xs: 'stretch', md: 'center' }} justifyContent="space-between">
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              <Chip size="small" label={`Всего: ${metrics.total}`} />
              <Chip size="small" color="primary" variant="outlined" label={`Новых: ${metrics.newUsers}`} />
              <Chip size="small" color="success" variant="outlined" label={`Уже LDAP: ${metrics.ldapExisting}`} />
              <Chip size="small" color="warning" variant="outlined" label={`Конфликтов: ${metrics.conflicts}`} />
              <Chip size="small" variant="outlined" label={`Без почты: ${metrics.missingMail}`} />
              <Chip size="small" variant="outlined" label={`Без отдела: ${metrics.missingDepartment}`} />
              {isSearchActive ? <Chip size="small" color="info" variant="outlined" label={`Найдено: ${filteredUsers.length}`} /> : null}
            </Stack>
            {canManageAdUsers ? (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Button size="small" variant="outlined" onClick={selectNewUsers} disabled={loading || bulkImporting || filteredNewCount === 0}>
                  Выбрать новых
                </Button>
                <Button size="small" variant="outlined" onClick={clearSelection} disabled={selectedCount === 0 || bulkImporting}>
                  Снять выбор
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={bulkImporting ? <CircularProgress size={16} color="inherit" /> : <SyncIcon />}
                  onClick={() => void handleBulkImport()}
                  disabled={selectedCount === 0 || bulkImporting}
                >
                  {bulkImporting ? 'Импорт...' : `Импортировать выбранных (${selectedCount})`}
                </Button>
              </Stack>
            ) : null}
          </Stack>
          <TextField
            fullWidth
            size="small"
            label="Поиск по фамилии"
            placeholder="Фамилия, ФИО, логин, отдел, должность или почта"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            sx={{ mt: 1.25 }}
            InputProps={{
              startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />,
            }}
          />
          {selectedCount > 0 ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.8 }}>
              В выборе: новых {selectedNewCount}, существующих LDAP для обновления {selectedExistingCount}.
            </Typography>
          ) : null}
        </Paper>

        {syncResult ? (
          <Alert severity={Number(syncResult.skipped_conflicts || 0) > 0 || Number(syncResult.not_found || 0) > 0 ? 'warning' : 'success'} sx={{ mb: 2 }}>
            Импорт завершён: {formatImportSummary(syncResult)}.
          </Alert>
        ) : null}

        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 5 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box>
            {sortedDepartments.length === 0 ? (
              <Paper elevation={3} sx={{ p: 4, textAlign: 'center' }}>
                <Typography color="text.secondary">Пользователи не найдены.</Typography>
              </Paper>
            ) : (
              sortedDepartments.map((departmentName) => {
                const isExpanded = isSearchActive || expandedDepartments.has(departmentName);
                const departmentUsers = groupedUsers[departmentName] || [];
                const isNoDepartment = departmentName === NO_DEPARTMENT_LABEL;
                const departmentSelectableLogins = departmentUsers
                  .filter(isImportSelectable)
                  .map((item) => normalizeLogin(item.login))
                  .filter(Boolean);
                const selectedDepartmentCount = departmentSelectableLogins.filter((login) => selectedLogins.has(login)).length;
                const departmentSelectionChecked = departmentSelectableLogins.length > 0 && selectedDepartmentCount === departmentSelectableLogins.length;
                const departmentSelectionIndeterminate = selectedDepartmentCount > 0 && selectedDepartmentCount < departmentSelectableLogins.length;

                return (
                  <Box
                    key={departmentName}
                    sx={{
                      mb: 1.5,
                      border: `1px solid ${theme.palette.divider}`,
                      borderRadius: 1,
                      overflow: 'hidden',
                    }}
                  >
                    <Box
                      onClick={() => toggleDepartment(departmentName)}
                      sx={{
                        p: isMobile ? 1 : 1.2,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        backgroundColor: isNoDepartment
                          ? (theme.palette.mode === 'dark' ? '#422006' : theme.palette.warning.light)
                          : (theme.palette.mode === 'dark' ? '#0f172a' : theme.palette.grey[100]),
                        '&:hover': {
                          backgroundColor: isNoDepartment
                            ? (theme.palette.mode === 'dark' ? '#78350f' : theme.palette.warning.main)
                            : (theme.palette.mode === 'dark' ? '#1e293b' : theme.palette.grey[200]),
                        },
                        color: isNoDepartment
                          ? (theme.palette.mode === 'dark' ? '#fcd34d' : theme.palette.warning.contrastText)
                          : (theme.palette.mode === 'dark' ? '#ffffff' : 'inherit'),
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                        {isExpanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
                        {canManageAdUsers ? (
                          <Checkbox
                            size="small"
                            checked={departmentSelectionChecked}
                            indeterminate={departmentSelectionIndeterminate}
                            disabled={departmentSelectableLogins.length === 0 || bulkImporting}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => setDepartmentSelected(departmentUsers, event.target.checked)}
                            inputProps={{ 'aria-label': `Выбрать отдел ${departmentName}` }}
                            sx={{
                              p: 0.25,
                              color: 'inherit',
                              '&.Mui-checked': { color: 'inherit' },
                              '&.MuiCheckbox-indeterminate': { color: 'inherit' },
                            }}
                          />
                        ) : null}
                        <Typography variant={isMobile ? 'subtitle1' : 'h6'} sx={{ fontSize: isMobile ? '0.85rem' : undefined, fontWeight: 'bold', overflowWrap: 'anywhere' }}>
                          {departmentName}
                        </Typography>
                      </Box>
                      <Typography variant="body2" color="inherit" sx={{ fontSize: isMobile ? '0.75rem' : undefined, opacity: 0.8, flexShrink: 0 }}>
                        ({departmentUsers.length.toLocaleString()})
                      </Typography>
                    </Box>

                    <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                      <TableContainer component={Paper} elevation={0} sx={{ borderTop: `1px solid ${theme.palette.divider}`, borderRadius: 0 }}>
                        <Table size="small" aria-label="AD import candidates table">
                          <TableHead>
                            <TableRow sx={{ backgroundColor: 'action.hover' }}>
                              {canManageAdUsers ? <TableCell padding="checkbox" /> : null}
                              <TableCell sx={{ fontWeight: 'bold' }}>ФИО</TableCell>
                              <TableCell sx={{ fontWeight: 'bold' }}>Логин</TableCell>
                              <TableCell sx={{ fontWeight: 'bold' }}>Должность</TableCell>
                              <TableCell sx={{ fontWeight: 'bold' }}>Почта / Exchange</TableCell>
                              <TableCell sx={{ fontWeight: 'bold' }}>Статус</TableCell>
                              <TableCell sx={{ fontWeight: 'bold' }}>Проверки</TableCell>
                              {canManageAdUsers ? <TableCell sx={{ fontWeight: 'bold', width: 180 }}>Действие</TableCell> : null}
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {departmentUsers.map((adUser, index) => {
                              const login = normalizeLogin(adUser.login);
                              const selectable = isImportSelectable(adUser);
                              const statusMeta = getStatusMeta(adUser.import_status);
                              const warnings = getWarnings(adUser);
                              const isBusy = Boolean(importing[login]) || bulkImporting;
                              const actionLabel = adUser.import_status === 'exists_ldap' ? 'Обновить web' : 'Добавить в web';

                              return (
                                <TableRow key={login || index} hover sx={{ '&:last-child td, &:last-child th': { border: 0 } }}>
                                  {canManageAdUsers ? (
                                    <TableCell padding="checkbox">
                                      <Checkbox
                                        size="small"
                                        checked={selectedLogins.has(login)}
                                        disabled={!selectable || isBusy}
                                        onChange={() => toggleLogin(login)}
                                        inputProps={{ 'aria-label': `Выбрать ${login}` }}
                                      />
                                    </TableCell>
                                  ) : null}
                                  <TableCell component="th" scope="row">
                                    <Typography variant="body2" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
                                      {adUser.display_name || '-'}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>
                                      {adUser.department || NO_DEPARTMENT_LABEL}
                                    </Typography>
                                  </TableCell>
                                  <TableCell>{adUser.login || '-'}</TableCell>
                                  <TableCell>{adUser.title || '-'}</TableCell>
                                  <TableCell>
                                    <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                                      {adUser.mail || 'Почта не указана'}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>
                                      {adUser.mailbox_login || '-'}
                                    </Typography>
                                  </TableCell>
                                  <TableCell>
                                    <Chip size="small" color={statusMeta.color} variant="outlined" label={statusMeta.label} />
                                  </TableCell>
                                  <TableCell>
                                    {warnings.length > 0 ? (
                                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                        {warnings.map((warning) => (
                                          <Chip key={warning} size="small" color="warning" variant="outlined" label={WARNING_LABELS[warning] || warning} />
                                        ))}
                                      </Stack>
                                    ) : (
                                      <Typography variant="caption" color="text.secondary">OK</Typography>
                                    )}
                                  </TableCell>
                                  {canManageAdUsers ? (
                                    <TableCell>
                                      <Button
                                        size="small"
                                        variant="outlined"
                                        disabled={!selectable || isBusy}
                                        onClick={() => void handleImportToApp(login)}
                                      >
                                        {importing[login] ? 'Импорт...' : actionLabel}
                                      </Button>
                                    </TableCell>
                                  ) : null}
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </Collapse>
                  </Box>
                );
              })
            )}
          </Box>
        )}
      </PageShell>
    </MainLayout>
  );
};

export default AdUsers;
