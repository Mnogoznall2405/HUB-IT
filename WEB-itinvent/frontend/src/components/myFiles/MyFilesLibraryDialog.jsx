import { useEffect, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import PersonOutlineRoundedIcon from '@mui/icons-material/PersonOutlineRounded';
import { useTheme } from '@mui/material/styles';

import chatDirectoryAPI from '../../api/chatDirectory';
import { myFilesLibrariesAPI } from '../../api/myFilesLibraries';
import { myFilesOfficeAPI } from '../../api/myFilesOffice';

const GIB = 1024 ** 3;

export const LIBRARY_ROLE_OPTIONS = [
  { value: 'manage', label: 'Управление', hint: 'Всё, что и правка, плюс корзина, ссылки и журнал папки' },
  { value: 'edit', label: 'Правка', hint: 'Загружает, меняет и удаляет в корзину' },
  { value: 'comment', label: 'Комментарии', hint: 'Читает и комментирует документы' },
  { value: 'view', label: 'Просмотр', hint: 'Только читает и скачивает' },
];

const userLabel = (user) => {
  const fullName = String(user?.full_name || '').trim();
  const username = String(user?.username || '').trim();
  return fullName && fullName !== username ? `${fullName} (${username})` : username;
};

const errorMessage = (err, fallback) => String(err?.response?.data?.detail || err?.message || fallback);

const keyOf = (member) => `${member.principal_type}:${member.principal_id}`;

function RoleSelect({ value, onChange, label }) {
  return (
    <Select
      size="small"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      inputProps={{ 'aria-label': label }}
      sx={{ minWidth: 150 }}
    >
      {LIBRARY_ROLE_OPTIONS.map((option) => (
        <MenuItem key={option.value} value={option.value}>
          <Tooltip title={option.hint} placement="left"><span>{option.label}</span></Tooltip>
        </MenuItem>
      ))}
    </Select>
  );
}

/**
 * Создание и настройка общей папки: название, лимит и доступ для людей и подразделений.
 * Новая папка сначала создаётся, затем в том же окне выбирается, кто с ней работает.
 */
export default function MyFilesLibraryDialog({ open, library, onClose }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [current, setCurrent] = useState(null);
  const [name, setName] = useState('');
  const [quotaGb, setQuotaGb] = useState('');
  const [members, setMembers] = useState([]);
  const [newRole, setNewRole] = useState('edit');
  const [userOptions, setUserOptions] = useState([]);
  const [userQuery, setUserQuery] = useState('');
  const [departments, setDepartments] = useState([]);
  const [department, setDepartment] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [changed, setChanged] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCurrent(library || null);
    setName(String(library?.name || ''));
    const quota = Number(library?.quota_bytes || 0);
    setQuotaGb(quota > 0 ? String(Math.round((quota / GIB) * 100) / 100) : '');
    setMembers([]);
    setNewRole('edit');
    setError('');
    setChanged(false);
    setConfirmDelete(false);
    setDepartment(null);
    setUserQuery('');
  }, [library, open]);

  useEffect(() => {
    if (!open || !current?.id) return undefined;
    const controller = new AbortController();
    setLoading(true);
    Promise.all([
      myFilesLibrariesAPI.listMembers(current.id, { signal: controller.signal }),
      myFilesOfficeAPI.listGroups({ signal: controller.signal }).catch(() => ({ items: [] })),
    ])
      .then(([membersPayload, groupsPayload]) => {
        if (controller.signal.aborted) return;
        setMembers(Array.isArray(membersPayload?.items) ? membersPayload.items : []);
        setDepartments(Array.isArray(groupsPayload?.items) ? groupsPayload.items : []);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(errorMessage(err, 'Не удалось загрузить участников'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [current?.id, open]);

  useEffect(() => {
    if (!open) return undefined;
    const text = userQuery.trim();
    if (text.length < 2) {
      setUserOptions([]);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      chatDirectoryAPI.getUsers({ q: text, limit: 20 })
        .then((data) => { if (!cancelled) setUserOptions(Array.isArray(data?.items) ? data.items : []); })
        .catch(() => { if (!cancelled) setUserOptions([]); });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, userQuery]);

  const quotaBytes = () => {
    const gb = Number(String(quotaGb).replace(',', '.'));
    return Number.isFinite(gb) && gb > 0 ? Math.round(gb * GIB) : 0;
  };

  const addMember = (member) => setMembers((list) => (
    list.some((item) => keyOf(item) === keyOf(member)) ? list : [...list, member]
  ));

  const addUser = (user) => {
    if (!user) return;
    addMember({ principal_type: 'user', principal_id: String(user.id), name: userLabel(user), role: newRole, members_count: 0 });
    setUserQuery('');
  };

  const addDepartment = () => {
    if (!department) return;
    addMember({
      principal_type: 'department',
      principal_id: String(department.id),
      name: department.name,
      role: newRole,
      members_count: Number(department.members_count || 0),
    });
    setDepartment(null);
  };

  const create = async () => {
    setSaving(true);
    setError('');
    try {
      const created = await myFilesLibrariesAPI.create({ name, quotaBytes: quotaBytes() });
      setCurrent(created);
      setChanged(true);
    } catch (err) {
      setError(errorMessage(err, 'Не удалось создать общую папку'));
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await myFilesLibrariesAPI.update(current.id, { name, quotaBytes: quotaBytes() });
      await myFilesLibrariesAPI.setMembers(current.id, members);
      onClose?.(true);
    } catch (err) {
      setError(errorMessage(err, 'Не удалось сохранить'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    setError('');
    try {
      await myFilesLibrariesAPI.remove(current.id);
      onClose?.(true, { removedId: current.id });
    } catch (err) {
      setError(errorMessage(err, 'Не удалось удалить общую папку'));
      setConfirmDelete(false);
    } finally {
      setSaving(false);
    }
  };

  const isNew = !current?.id;

  return (
    <Dialog open={Boolean(open)} onClose={() => onClose?.(changed)} maxWidth="sm" fullWidth fullScreen={isMobile}>
      <DialogTitle sx={{ pb: 1 }}>
        <Typography component="div" variant="h6" sx={{ fontWeight: 700 }}>
          {isNew ? 'Новая общая папка' : 'Общая папка'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Файлы общей папки не занимают место сотрудников и хранятся, пока их не удалят.
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField
            label="Название"
            value={name}
            onChange={(event) => setName(event.target.value)}
            size="small"
            fullWidth
            inputProps={{ maxLength: 255, 'data-testid': 'my-files-library-name' }}
          />
          <TextField
            label="Лимит, ГБ"
            value={quotaGb}
            onChange={(event) => setQuotaGb(event.target.value.replace(/[^\d.,]/g, ''))}
            size="small"
            fullWidth
            placeholder="Без лимита"
            helperText="Пусто — без отдельного лимита."
            inputProps={{ inputMode: 'decimal', 'data-testid': 'my-files-library-quota' }}
          />
          {isNew ? null : loading ? (
            <Stack alignItems="center" sx={{ py: 2 }}><CircularProgress size={26} /></Stack>
          ) : (
            <>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Кто работает с папкой</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Autocomplete
                  fullWidth
                  size="small"
                  options={userOptions}
                  value={null}
                  inputValue={userQuery}
                  onInputChange={(_event, value, reason) => { if (reason !== 'reset') setUserQuery(value); }}
                  onChange={(_event, user) => addUser(user)}
                  getOptionLabel={userLabel}
                  isOptionEqualToValue={(option, value) => option.id === value.id}
                  filterOptions={(items) => items.filter((user) => !members.some((item) => keyOf(item) === `user:${user.id}`))}
                  noOptionsText={userQuery.trim().length < 2 ? 'Введите минимум 2 символа' : 'Никого не найдено'}
                  renderInput={(params) => <TextField {...params} label="Добавить сотрудника" placeholder="Имя или логин" />}
                />
                <RoleSelect value={newRole} onChange={setNewRole} label="Роль для новых" />
              </Stack>
              {departments.length > 0 ? (
                <Stack direction="row" spacing={1} alignItems="center">
                  <Autocomplete
                    fullWidth
                    size="small"
                    options={departments}
                    value={department}
                    onChange={(_event, value) => setDepartment(value)}
                    getOptionLabel={(item) => `${item.name} (${item.members_count})`}
                    isOptionEqualToValue={(option, value) => option.id === value.id}
                    noOptionsText="Подразделений нет"
                    renderInput={(params) => <TextField {...params} label="Добавить подразделение" placeholder="Подразделение" />}
                  />
                  <Button onClick={addDepartment} disabled={!department} data-testid="my-files-library-add-department">
                    Добавить
                  </Button>
                </Stack>
              ) : null}
              <Typography variant="caption" color="text.secondary">
                Подразделение подключается целиком: кто в него придёт или уйдёт, тот сразу получит или потеряет доступ.
              </Typography>
              <Stack spacing={0.5} data-testid="my-files-library-members">
                {members.map((item) => (
                  <Stack key={keyOf(item)} direction="row" spacing={1} alignItems="center">
                    {item.principal_type === 'department'
                      ? <GroupsOutlinedIcon fontSize="small" color="action" />
                      : <PersonOutlineRoundedIcon fontSize="small" color="action" />}
                    <Typography variant="body2" noWrap title={item.name} sx={{ minWidth: 0, flex: 1 }}>
                      {item.name}
                      {item.principal_type === 'department' ? ` · ${item.members_count} чел.` : ''}
                    </Typography>
                    <RoleSelect
                      value={item.role}
                      label={`Роль: ${item.name}`}
                      onChange={(role) => setMembers((list) => list.map((entry) => (keyOf(entry) === keyOf(item) ? { ...entry, role } : entry)))}
                    />
                    <IconButton
                      size="small"
                      aria-label={`Убрать ${item.name}`}
                      onClick={() => setMembers((list) => list.filter((entry) => keyOf(entry) !== keyOf(item)))}
                    >
                      <CloseRoundedIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ))}
              </Stack>
              {confirmDelete ? (
                <Alert
                  severity="warning"
                  action={(
                    <Button color="error" size="small" onClick={remove} disabled={saving} data-testid="my-files-library-delete-confirm">
                      Удалить
                    </Button>
                  )}
                >
                  Удалить общую папку? Это возможно, только когда в ней и в её корзине ничего не осталось.
                </Alert>
              ) : null}
            </>
          )}
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        {!isNew && !confirmDelete ? (
          <Button color="error" onClick={() => setConfirmDelete(true)} sx={{ mr: 'auto' }} data-testid="my-files-library-delete">
            Удалить папку
          </Button>
        ) : null}
        <Button onClick={() => onClose?.(changed)}>{isNew ? 'Отмена' : 'Закрыть'}</Button>
        {isNew ? (
          <Button variant="contained" onClick={create} disabled={saving || !name.trim()} data-testid="my-files-library-create">
            Создать
          </Button>
        ) : (
          <Button variant="contained" onClick={save} disabled={loading || saving || !name.trim()} data-testid="my-files-library-save">
            Сохранить
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
