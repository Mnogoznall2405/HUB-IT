import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Drawer,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import CheckCircleOutlineOutlinedIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import ExpandMoreOutlinedIcon from '@mui/icons-material/ExpandMoreOutlined';
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import SyncOutlinedIcon from '@mui/icons-material/SyncOutlined';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import OverflowMenu from '../../../components/common/OverflowMenu';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';
import {
  DEFAULT_USER_ROWS_PER_PAGE,
  USER_ROWS_PER_PAGE_OPTIONS,
  roleOptions,
} from '../accountConstants';
import {
  buildDefaultExchangeLoginPreview,
  createEmptyUserDraft,
  createUserDraftFromItem,
  getDbName,
  matchesUserSearch,
  normalizePermissions,
} from '../accountUserModel';
import MetricTile from '../shared/MetricTile';
import SectionCard from '../shared/SectionCard';
import UserDraftFields from './UserDraftFields';

export default function UsersTab({
  currentUserId,
  isAdmin,
  users,
  sessions,
  dbOptions,
  loading,
  savingUser,
  onCreateUser,
  onUpdateUser,
  onDeleteUser,
  isVeryWide,
}) {

  const navigate = useNavigate();
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [dbFilter, setDbFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_USER_ROWS_PER_PAGE);
  const [editorMode, setEditorMode] = useState('edit');
  const [draft, setDraft] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const activeSessionCounts = useMemo(() => {
    const counts = new Map();
    sessions
      .filter((item) => item.status === 'active')
      .forEach((session) => {
        counts.set(session.user_id, Number(counts.get(session.user_id) || 0) + 1);
      });
    return counts;
  }, [sessions]);

  const metrics = useMemo(() => ({
    total: users.length,
    active: users.filter((item) => item.is_active).length,
    ldap: users.filter((item) => item.auth_source === 'ldap').length,
    custom: users.filter((item) => item.use_custom_permissions).length,
  }), [users]);

  const activeFilterCount = useMemo(() => (
    [
      search.trim() ? 'search' : null,
      statusFilter !== 'all' ? 'status' : null,
      roleFilter !== 'all' ? 'role' : null,
      sourceFilter !== 'all' ? 'source' : null,
      dbFilter !== 'all' ? 'db' : null,
    ].filter(Boolean).length
  ), [dbFilter, roleFilter, search, sourceFilter, statusFilter]);

  const filteredUsers = useMemo(() => {
    const rolePriority = { admin: 0, operator: 1, viewer: 2 };
    return users
      .filter((item) => matchesUserSearch(item, search))
      .filter((item) => statusFilter === 'all' ? true : statusFilter === 'active' ? item.is_active : !item.is_active)
      .filter((item) => roleFilter === 'all' ? true : item.role === roleFilter)
      .filter((item) => sourceFilter === 'all' ? true : item.auth_source === sourceFilter)
      .filter((item) => dbFilter === 'all' ? true : String(item.assigned_database || '') === dbFilter)
      .sort((left, right) => {
        if (left.is_active !== right.is_active) return left.is_active ? -1 : 1;
        const leftRole = rolePriority[left.role] ?? 9;
        const rightRole = rolePriority[right.role] ?? 9;
        if (leftRole !== rightRole) return leftRole - rightRole;
        return String(left.full_name || left.username || '').localeCompare(String(right.full_name || right.username || ''), 'ru');
      });
  }, [users, search, statusFilter, roleFilter, sourceFilter, dbFilter]);

  const pagedUsers = useMemo(() => {
    const start = page * rowsPerPage;
    return filteredUsers.slice(start, start + rowsPerPage);
  }, [filteredUsers, page, rowsPerPage]);

  useEffect(() => {
    setPage(0);
  }, [search, statusFilter, roleFilter, sourceFilter, dbFilter]);

  useEffect(() => {
    if (!draft?.id) return;
    const exists = users.some((item) => Number(item.id) === Number(draft.id));
    if (!exists) {
      setDraft(null);
      setDrawerOpen(false);
    }
  }, [users, draft?.id]);

  const linkedSessions = useMemo(() => {
    if (!draft?.id) return [];
    return sessions.filter((item) => Number(item.user_id) === Number(draft.id) && item.status === 'active');
  }, [draft?.id, sessions]);

  const openCreate = useCallback(() => {
    setEditorMode('create');
    setDraft(createEmptyUserDraft());
    if (!isVeryWide) {
      setDrawerOpen(true);
    }
  }, [isVeryWide]);

  const openEdit = useCallback((item) => {
    setEditorMode('edit');
    setDraft(createUserDraftFromItem(item));
    if (!isVeryWide) {
      setDrawerOpen(true);
    }
  }, [isVeryWide]);

  const closeEditor = useCallback(() => {
    if (savingUser) return;
    setDrawerOpen(false);
    if (!isVeryWide) {
      setDraft(null);
    }
  }, [isVeryWide, savingUser]);

  const handleDraftChange = useCallback((field, value) => {
    setDraft((prev) => ({ ...(prev || {}), [field]: value }));
  }, []);

  const handleSaveDraft = useCallback(async () => {
    if (!draft) return;
    const payload = {
      ...draft,
      username: String(draft.username || '').trim(),
      full_name: String(draft.full_name || '').trim(),
      department: String(draft.department || '').trim(),
      job_title: String(draft.job_title || '').trim(),
      email: String(draft.email || '').trim(),
      mailbox_email: String(draft.mailbox_email || '').trim(),
      mailbox_login: String(draft.mailbox_login || '').trim(),
      telegram_id: String(draft.telegram_id || '').trim(),
      assigned_database: draft.assigned_database || '',
      custom_permissions: normalizePermissions(draft.custom_permissions),
    };

    if (payload.username.length < 3) return;
    if (payload.telegram_id && !Number.isInteger(Number(payload.telegram_id))) return;

    const result = editorMode === 'create'
      ? await onCreateUser(payload)
      : await onUpdateUser(payload);

    if (!result?.ok) return;
    if (!isVeryWide) {
      setDrawerOpen(false);
      setDraft(null);
    } else if (result.user) {
      setDraft(createUserDraftFromItem(result.user));
    }
  }, [draft, editorMode, isVeryWide, onCreateUser, onUpdateUser]);

  const tableRows = pagedUsers.map((item) => {
    const roleMeta = roleOptions.find((option) => option.value === item.role);
    const activeSessions = Number(activeSessionCounts.get(item.id) || 0);
    return (
      <TableRow
        hover
        key={item.id}
        onClick={() => openEdit(item)}
        selected={Number(draft?.id) === Number(item.id)}
        sx={{
          cursor: 'pointer',
          '&.Mui-selected': {
            backgroundColor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.08),
          },
          '& .MuiTableCell-body': {
            py: 0.58,
            verticalAlign: 'middle',
            borderBottomColor: theme.customAdmin?.border || 'divider',
          },
        }}
      >
        <TableCell sx={{ minWidth: 220 }}>
          <Typography variant="body2" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
            {item.full_name || item.username}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.15, lineHeight: 1.2 }}>
            {[item.job_title, item.department].filter(Boolean).join(' · ') || 'Должность и отдел не указаны'}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.15 }}>
            @{item.username}
          </Typography>
        </TableCell>
        <TableCell sx={{ minWidth: 150 }}>
          <Chip size="small" color={roleMeta?.color || 'default'} label={roleMeta?.label || item.role} sx={{ mb: 0.3, height: 22 }} />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2 }}>
            {item.use_custom_permissions ? `${normalizePermissions(item.custom_permissions).length} прав` : 'По роли'}
          </Typography>
        </TableCell>
        <TableCell sx={{ minWidth: 210 }}>
          <Stack direction="row" spacing={0.55} flexWrap="wrap" useFlexGap sx={{ mb: 0.3 }}>
            <Chip size="small" variant="outlined" label={item.auth_source === 'ldap' ? 'AD / LDAP' : 'Локальная'} sx={{ height: 22 }} />
            <Chip size="small" variant="outlined" label={item.telegram_id ? 'TG' : 'Без TG'} sx={{ height: 22 }} />
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2, overflowWrap: 'anywhere' }}>
            {getDbName(dbOptions, item.assigned_database)}
          </Typography>
        </TableCell>
        <TableCell sx={{ minWidth: 210 }}>
          <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.2, overflowWrap: 'anywhere' }}>
            {item.mailbox_email || 'Профиль не задан'}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.15, lineHeight: 1.2, overflowWrap: 'anywhere' }}>
            {item.mailbox_login || buildDefaultExchangeLoginPreview(item.username)}
          </Typography>
        </TableCell>
        <TableCell sx={{ minWidth: 120 }}>
          <Chip size="small" color={item.is_active ? 'success' : 'default'} label={item.is_active ? 'Активен' : 'Отключён'} sx={{ mb: 0.3, height: 22 }} />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2 }}>
            {activeSessions} сесс.
          </Typography>
        </TableCell>
        <TableCell align="right" sx={{ width: 52 }}>
          <OverflowMenu
            label="Действия с пользователем"
            items={[
              { key: 'open', label: 'Открыть' },
              {
                key: 'delete',
                label: 'Удалить',
                tone: 'danger',
                disabled: Number(item.id) === 1 || Number(item.id) === Number(currentUserId),
                icon: <DeleteOutlineOutlinedIcon fontSize="small" />,
              },
            ]}
            onSelect={(key) => {
              if (key === 'open') openEdit(item);
              if (key === 'delete') setDeleteTarget(item);
            }}
          />
        </TableCell>
      </TableRow>
    );
  });

  const editorContent = draft ? (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <Box sx={{ px: 1.6, py: 1.25, display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'flex-start' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
            {editorMode === 'create' ? 'Новый пользователь' : (draft.full_name || draft.username || 'Редактор пользователя')}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25, display: 'block', lineHeight: 1.35 }}>
            {editorMode === 'create' ? 'Создание новой учётной записи.' : `@${draft.username || 'new'} • ${roleOptions.find((item) => item.value === draft.role)?.label || draft.role}`}
          </Typography>
        </Box>
        {!isVeryWide ? (
          <IconButton onClick={closeEditor} disabled={savingUser} size="small">
            <VisibilityOffOutlinedIcon fontSize="small" />
          </IconButton>
        ) : null}
      </Box>
      <Divider />
      <Box sx={{ p: 1.5, flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <UserDraftFields draft={draft} onChange={handleDraftChange} dbOptions={dbOptions} linkedSessions={linkedSessions} users={users} />
      </Box>
      <Divider />
      <Box sx={{ px: 1.6, py: 1.15, display: 'flex', justifyContent: 'space-between', gap: 1.5, alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.35 }}>
          Изменения применяются сразу после сохранения.
        </Typography>
        <Stack direction="row" spacing={1}>
          {!isVeryWide ? <Button variant="outlined" onClick={closeEditor} disabled={savingUser}>Закрыть</Button> : null}
          <Button variant="contained" onClick={handleSaveDraft} disabled={savingUser || !draft}>
            {savingUser ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </Stack>
      </Box>
    </Box>
  ) : (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', px: 3 }}>
      <Stack spacing={0.75} sx={{ maxWidth: 260 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>Редактор</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.45 }}>
          Выберите строку в таблице или создайте нового пользователя.
        </Typography>
      </Stack>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, minHeight: 0, height: '100%' }}>
      <SectionCard sx={{ flexShrink: 0 }} contentSx={{ p: 1.1 }}>
        <Stack spacing={1}>
          <Stack
            direction={{ xs: 'column', xl: 'row' }}
            spacing={1}
            alignItems={{ xs: 'stretch', xl: 'center' }}
          >
            <TextField
              fullWidth
              size="small"
              type="search"
              label="Поиск пользователя"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              autoComplete="off"
              inputProps={{ autoComplete: 'off', spellCheck: 'false' }}
              InputProps={{ startAdornment: <SearchOutlinedIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> }}
              sx={{ flex: 1, minWidth: 0 }}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ flexShrink: 0 }}>
              <Button
                variant={filtersExpanded || activeFilterCount ? 'contained' : 'outlined'}
                onClick={() => setFiltersExpanded((prev) => !prev)}
                endIcon={
                  <ExpandMoreOutlinedIcon
                    sx={{
                      transition: 'transform 0.2s ease',
                      transform: filtersExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                    }}
                  />
                }
              >
                {activeFilterCount ? `Фильтры (${activeFilterCount})` : 'Фильтры'}
              </Button>
              <Button size="small" variant="outlined" startIcon={<AddOutlinedIcon />} onClick={openCreate}>
                Новый пользователь
              </Button>
              {isAdmin ? (
                <Button
                  size="small"
                  variant="outlined"
                  color="secondary"
                  startIcon={<SyncOutlinedIcon />}
                  onClick={() => navigate('/ad-users')}
                >
                  Импорт из AD
                </Button>
              ) : null}
            </Stack>
          </Stack>

          <Collapse in={filtersExpanded} timeout="auto" unmountOnExit>
            <Stack spacing={1.25} sx={{ pt: 0.25 }}>
              <Grid container spacing={1.25}>
                <Grid item xs={6} md={3}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Статус</InputLabel>
                    <Select label="Статус" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                      <MenuItem value="all">Все</MenuItem>
                      <MenuItem value="active">Активные</MenuItem>
                      <MenuItem value="inactive">Отключённые</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={6} md={3}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Роль</InputLabel>
                    <Select label="Роль" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
                      <MenuItem value="all">Все</MenuItem>
                      {roleOptions.map((option) => (
                        <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={6} md={3}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Источник</InputLabel>
                    <Select label="Источник" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
                      <MenuItem value="all">Все</MenuItem>
                      <MenuItem value="local">Локальная</MenuItem>
                      <MenuItem value="ldap">AD / LDAP</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={6} md={3}>
                  <FormControl fullWidth size="small">
                    <InputLabel>База</InputLabel>
                    <Select label="База" value={dbFilter} onChange={(event) => setDbFilter(event.target.value)}>
                      <MenuItem value="all">Все</MenuItem>
                      <MenuItem value="">Не ограничивать</MenuItem>
                      {dbOptions.map((db) => (
                        <MenuItem key={db.id} value={db.id}>{db.name}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }}>
                <Typography variant="caption" color="text.secondary">
                  Показаны только отфильтрованные записи. Поиск работает по логину, имени, должности, отделу, email и Telegram ID.
                </Typography>
                <Button
                  size="small"
                  variant="text"
                  startIcon={<RefreshOutlinedIcon fontSize="small" />}
                  onClick={() => {
                    setSearch('');
                    setStatusFilter('all');
                    setRoleFilter('all');
                    setSourceFilter('all');
                    setDbFilter('all');
                  }}
                >
                  Сбросить
                </Button>
              </Stack>
            </Stack>
          </Collapse>

          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.35 }}>
            {activeFilterCount > 0
              ? `Активных фильтров: ${activeFilterCount}. Найдено записей: ${filteredUsers.length}.`
              : 'Клик по строке открывает редактор. Таблица остаётся плотной, детали вынесены в правую панель.'}
          </Typography>
        </Stack>
      </SectionCard>

      <Grid container spacing={0.85} sx={{ flexShrink: 0 }}>
        <Grid item xs={12} sm={6} lg={3}>
          <MetricTile compact icon={<GroupOutlinedIcon fontSize="small" />} label="Всего" value={metrics.total} caption="Учётные записи" />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <MetricTile compact icon={<CheckCircleOutlineOutlinedIcon fontSize="small" />} label="Активные" value={metrics.active} caption="Могут войти" />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <MetricTile compact icon={<ShieldOutlinedIcon fontSize="small" />} label="LDAP / AD" value={metrics.ldap} caption="Через AD" />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <MetricTile compact icon={<TuneOutlinedIcon fontSize="small" />} label="Свои права" value={metrics.custom} caption="Custom permissions" />
        </Grid>
      </Grid>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: isVeryWide ? 'minmax(0, 1fr) 620px' : 'minmax(0, 1fr)',
          gap: 1.25,
          minHeight: 0,
          flex: 1,
        }}
      >
        <SectionCard
          title="Список"
          action={<Chip size="small" label={`${filteredUsers.length} записей`} />}
          sx={{ minHeight: 0 }}
          contentSx={{ p: 0 }}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
            <TableContainer sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              <Table
                stickyHeader
                size="small"
                sx={{
                  minWidth: 900,
                  '& .MuiTableCell-head': {
                    py: 0.55,
                    backgroundColor: ui.headerBandBg,
                    fontSize: '0.76rem',
                    borderBottomColor: ui.headerBandBorder,
                  },
                }}
              >
                <TableHead>
                  <TableRow>
                    <TableCell>Пользователь</TableCell>
                    <TableCell>Доступ</TableCell>
                    <TableCell>Интеграции</TableCell>
                    <TableCell>Почта</TableCell>
                    <TableCell>Статус</TableCell>
                    <TableCell align="right">...</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={6} sx={{ py: 4, textAlign: 'center' }}>
                        <CircularProgress size={24} />
                      </TableCell>
                    </TableRow>
                  ) : tableRows.length > 0 ? tableRows : (
                    <TableRow>
                      <TableCell colSpan={6} sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
                        Пользователи не найдены.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div"
              count={filteredUsers.length}
              page={page}
              onPageChange={(_, nextPage) => setPage(nextPage)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(event) => {
                setRowsPerPage(Number(event.target.value));
                setPage(0);
              }}
              rowsPerPageOptions={USER_ROWS_PER_PAGE_OPTIONS}
              labelRowsPerPage="Строк на странице"
              labelDisplayedRows={({ from, to, count }) => `${from}-${to} из ${count}`}
            />
          </Box>
        </SectionCard>

        {isVeryWide ? (
          <Paper variant="outlined" sx={{ borderRadius: '14px', minHeight: 0, overflow: 'hidden' }}>
            {editorContent}
          </Paper>
        ) : (
          <Drawer
            anchor="right"
            open={drawerOpen}
            onClose={closeEditor}
            PaperProps={{ sx: { width: { xs: '100vw', sm: 620 }, maxWidth: '100vw' } }}
          >
            {editorContent}
          </Drawer>
        )}
      </Box>

      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Удаление пользователя</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Удалить пользователя <strong>{deleteTarget?.username}</strong>? Это действие необратимо.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Отмена</Button>
          <Button
            color="error"
            variant="contained"
            onClick={async () => {
              if (!deleteTarget) return;
              const result = await onDeleteUser(deleteTarget);
              if (result?.ok && Number(draft?.id) === Number(deleteTarget.id)) {
                setDraft(null);
                setDrawerOpen(false);
              }
              if (result?.ok) {
                setDeleteTarget(null);
              }
            }}
          >
            Удалить
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
