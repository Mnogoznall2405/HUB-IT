import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  ListItemText,
  Menu,
  MenuItem,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import PersonOutlineRoundedIcon from '@mui/icons-material/PersonOutlineRounded';

import chatDirectoryAPI from '../../api/chatDirectory';
import { myFilesLibrariesAPI } from '../../api/myFilesLibraries';
import { myFilesOfficeAPI } from '../../api/myFilesOffice';

const GIB = 1024 ** 3;

// «Лимит, ГБ» хранится текстом: байты ↔ ГБ теряют точность, поэтому и базовое,
// и текущее значение сравниваются после одной и той же нормализации.
export const quotaBytesToGbInput = (bytes) => {
  const value = Number(bytes || 0);
  if (!(value > 0)) return '';
  const gb = value / GIB;
  // Малые лимиты — точной десятичной записью без e-нотации
  // (1 МиБ → «0.0009765625», а не «0»); больше — до 6 знаков после запятой.
  return gb < 0.001
    ? gb.toFixed(30).replace(/\.?0+$/, '')
    : String(Number(gb.toFixed(6)));
};

// Поле хранит ровно введённый текст; невалидные значения дают ошибку,
// а не вырезаются молча («-2» ≠ «2», «abc» ≠ «без лимита»).
const QUOTA_GB_PATTERN = /^\d+([.,]\d+)?$/;

export const parseQuotaGbInput = (raw) => {
  const text = String(raw ?? '').trim();
  // Пустая строка — осознанное снятие лимита (0 байт).
  if (!text) return { ok: true, gb: 0, bytes: 0 };
  if (/^-/.test(text)) return { ok: false, reason: 'negative', gb: NaN, bytes: 0 };
  if (!QUOTA_GB_PATTERN.test(text)) return { ok: false, reason: 'format', gb: NaN, bytes: 0 };
  const gb = Number(text.replace(',', '.'));
  const bytes = Math.round(gb * GIB);
  // Положительное значение, округляющееся до 0 байт, — ошибка, а не «без лимита».
  if (gb > 0 && bytes <= 0) return { ok: false, reason: 'too_small', gb, bytes: 0 };
  // Сервер хранит bigint; клиентский потолок — безопасные целые JS.
  if (!Number.isFinite(bytes) || bytes > Number.MAX_SAFE_INTEGER) {
    return { ok: false, reason: 'too_large', gb, bytes };
  }
  return { ok: true, gb, bytes };
};

const QUOTA_GB_ERROR_TEXT = {
  negative: 'Укажите число не меньше 0',
  format: 'Укажите число ГБ, например «10» или «1,5»',
  too_small: 'Лимит меньше 1 байта — увеличьте значение или очистите поле',
  too_large: 'Лимит больше поддерживаемого',
};

const normalizeQuotaGbText = (raw) => {
  const parsed = parseQuotaGbInput(raw);
  return parsed.ok ? String(parsed.gb) : `invalid:${String(raw ?? '')}`;
};

export const LIBRARY_ROLE_OPTIONS = [
  { value: 'manage', label: 'Управление', hint: 'Управление участниками и настройками, корзина, ссылки и журнал' },
  { value: 'edit', label: 'Правка', hint: 'Изменение и загрузка файлов, удаление в корзину' },
  { value: 'comment', label: 'Комментарии', hint: 'Просмотр и комментарии' },
  { value: 'view', label: 'Просмотр', hint: 'Просмотр и скачивание' },
];

const roleOption = (value) => LIBRARY_ROLE_OPTIONS.find((option) => option.value === value);
const roleLabel = (value) => roleOption(value)?.label || value;

const userLabel = (user) => {
  const fullName = String(user?.full_name || '').trim();
  const username = String(user?.username || '').trim();
  return fullName && fullName !== username ? `${fullName} (${username})` : username;
};

const errorMessage = (err, fallback) => String(err?.response?.data?.detail || err?.message || fallback);

const keyOf = (member) => `${member.principal_type}:${member.principal_id}`;

const formatSize = (bytes) => {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let current = value;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current >= 10 || index === 0 ? current.toFixed(0) : current.toFixed(1)} ${units[index]}`;
};

const membersCountLabel = (count) => {
  const n = Math.max(0, Number(count) || 0);
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11
    ? 'участник'
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)
      ? 'участника'
      : 'участников';
  return `${n} ${word}`;
};

// Every role line explains itself under the name, so nobody guesses what "Комментарии" allows.
function RoleSelect({ value, onChange, label, minWidth = 160, open, onOpen, onClose }) {
  const controlledProps = open === undefined ? {} : { open, onOpen, onClose };
  return (
    <Select
      size="small"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      inputProps={{ 'aria-label': label }}
      renderValue={roleLabel}
      MenuProps={{ PaperProps: { sx: { minWidth: 300 } } }}
      sx={{ minWidth }}
      {...controlledProps}
    >
      {LIBRARY_ROLE_OPTIONS.map((option) => (
        <MenuItem key={option.value} value={option.value}>
          <ListItemText primary={option.label} secondary={option.hint} />
        </MenuItem>
      ))}
    </Select>
  );
}

/**
 * Создание и настройка общей папки: название и лимит на вкладке «Основные»,
 * доступ для людей и подразделений — на вкладке «Доступ».
 * Новая папка сначала создаётся, затем в том же окне открывается «Доступ».
 */
export default function MyFilesLibraryDialog({ open, library, membersOnly = false, onClose }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [current, setCurrent] = useState(null);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [quotaGb, setQuotaGb] = useState('');
  const [baseline, setBaseline] = useState({ name: '', quotaGb: '' });
  const [members, setMembers] = useState([]);
  const [initialMembers, setInitialMembers] = useState([]);
  const [tab, setTab] = useState('main');
  const [newRole, setNewRole] = useState('edit');
  const [userOptions, setUserOptions] = useState([]);
  const [userQuery, setUserQuery] = useState('');
  const [departments, setDepartments] = useState([]);
  const [department, setDepartment] = useState(null);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [memberMenu, setMemberMenu] = useState(null);
  const [roleEditKey, setRoleEditKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [nameError, setNameError] = useState('');
  const [quotaError, setQuotaError] = useState('');
  const [changed, setChanged] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCurrent(library || null);
    setName(String(library?.name || ''));
    const quotaInput = quotaBytesToGbInput(library?.quota_bytes);
    setQuotaGb(quotaInput);
    setBaseline({ name: String(library?.name || '').trim(), quotaGb: quotaInput });
    setMembers([]);
    setInitialMembers([]);
    setTab('main');
    setNewRole('edit');
    setError('');
    setNameError('');
    setQuotaError('');
    setNameTouched(false);
    setChanged(false);
    setConfirmDelete(false);
    setConfirmDiscard(false);
    setMemberMenu(null);
    setRoleEditKey('');
    setDepartment(null);
    setUserQuery('');
    setExpandedGroups({});
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
        const items = Array.isArray(membersPayload?.items) ? membersPayload.items : [];
        setMembers(items);
        setInitialMembers(items);
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

  const isNew = !current?.id;

  // Пустое поле — «без лимита» (0); невалидное значение блокирует сохранение,
  // а не превращается молча в 0.
  const quotaParsed = useMemo(() => parseQuotaGbInput(quotaGb), [quotaGb]);
  const quotaFieldVisible = isNew || !membersOnly;
  const quotaInvalid = quotaFieldVisible && !quotaParsed.ok;

  // Unsaved work: renamed/re-quotaed fields plus every added, removed or re-roled member.
  const memberDiff = useMemo(() => {
    const before = new Map(initialMembers.map((item) => [keyOf(item), item.role]));
    const now = new Map(members.map((item) => [keyOf(item), item.role]));
    let diff = 0;
    now.forEach((role, key) => {
      if (!before.has(key) || before.get(key) !== role) diff += 1;
    });
    before.forEach((_role, key) => {
      if (!now.has(key)) diff += 1;
    });
    return diff;
  }, [initialMembers, members]);

  const nameDirty = isNew ? Boolean(name.trim()) : name.trim() !== baseline.name;
  const quotaDirty = isNew
    ? quotaGb !== ''
    : normalizeQuotaGbText(quotaGb) !== normalizeQuotaGbText(baseline.quotaGb);
  // Настройки (название/лимит) и список участников сохраняются разными запросами.
  const settingsDirty = (isNew || !membersOnly) && (nameDirty || quotaDirty);
  const membersDirty = memberDiff > 0;
  const dirtyCount = (settingsDirty ? 1 : 0) + memberDiff;

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

  const removeMember = (member) => setMembers((list) => list.filter((entry) => keyOf(entry) !== keyOf(member)));

  const setMemberRole = (member, role) => setMembers((list) => (
    list.map((entry) => (keyOf(entry) === keyOf(member) ? { ...entry, role } : entry))
  ));

  const toggleGroup = (item) => {
    const id = String(item.principal_id);
    const entry = expandedGroups[id] || {};
    setExpandedGroups((map) => ({ ...map, [id]: { ...entry, open: !entry.open } }));
    if (entry.open || entry.items || entry.loading) return;
    setExpandedGroups((map) => ({ ...map, [id]: { ...(map[id] || {}), open: true, loading: true } }));
    myFilesOfficeAPI.listGroupMembers(id)
      .then((data) => setExpandedGroups((map) => ({
        ...map,
        [id]: { ...(map[id] || {}), loading: false, items: Array.isArray(data?.items) ? data.items : [] },
      })))
      .catch(() => setExpandedGroups((map) => ({ ...map, [id]: { ...(map[id] || {}), loading: false, error: true } })));
  };

  // Server validation errors land under the field they belong to, not only in a toast.
  const applySaveError = (err, fallback) => {
    const detail = errorMessage(err, fallback);
    if (!membersOnly && /quota|лимит/i.test(detail)) {
      setQuotaError(detail);
      setTab('main');
    } else if (!membersOnly && /name|назван/i.test(detail)) {
      setNameError(detail);
      setTab('main');
    } else {
      setError(detail);
    }
  };

  const create = async () => {
    if (saving || quotaInvalid) return;
    if (!name.trim()) {
      setNameError('Укажите название папки');
      return;
    }
    setSaving(true);
    setError('');
    setNameError('');
    setQuotaError('');
    try {
      const created = await myFilesLibrariesAPI.create({ name: name.trim(), quotaBytes: quotaParsed.bytes });
      setCurrent(created);
      setBaseline({ name: String(created?.name || name).trim(), quotaGb: quotaBytesToGbInput(created?.quota_bytes) });
      setInitialMembers([]);
      setChanged(true);
      setTab('access');
    } catch (err) {
      applySaveError(err, 'Не удалось создать общую папку');
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (saving || loading || (!membersOnly && quotaInvalid)) return;
    if (!membersOnly && !name.trim()) {
      setNameError('Укажите название папки');
      setTab('main');
      return;
    }
    // Нечего сохранять: ни настройки, ни участники не менялись — просто закрываем.
    if (!settingsDirty && !membersDirty) {
      onClose?.(changed);
      return;
    }
    setSaving(true);
    setError('');
    setNameError('');
    setQuotaError('');
    // PATCH содержит только фактически изменённые поля: переименование
    // не перезаписывает quota_bytes (включая округление ввода в ГБ).
    const patch = {};
    if (!membersOnly && nameDirty) patch.name = name.trim();
    if (!membersOnly && quotaDirty) patch.quotaBytes = quotaParsed.bytes;
    let settingsFailed = null;
    let membersFailed = null;
    if (Object.keys(patch).length) {
      try {
        const updated = await myFilesLibrariesAPI.update(current.id, patch);
        // Подтверждённый сервером результат становится новым базисом:
        // повторное «Сохранить» не отправит эти поля ещё раз.
        const confirmedName = String(updated?.name ?? patch.name ?? baseline.name).trim();
        const confirmedQuota = quotaDirty
          ? quotaBytesToGbInput(updated?.quota_bytes ?? quotaParsed.bytes)
          : baseline.quotaGb;
        setCurrent((prev) => ({ ...(prev || {}), ...(updated || {}), name: confirmedName }));
        setBaseline((prev) => ({
          name: patch.name !== undefined ? confirmedName : prev.name,
          quotaGb: quotaDirty ? confirmedQuota : prev.quotaGb,
        }));
        if (patch.name !== undefined) setName(confirmedName);
        if (quotaDirty) setQuotaGb(confirmedQuota);
        setChanged(true);
      } catch (err) {
        settingsFailed = err;
      }
    }
    if (membersDirty) {
      try {
        await myFilesLibrariesAPI.setMembers(current.id, members);
        setInitialMembers(members);
        setChanged(true);
      } catch (err) {
        membersFailed = err;
      }
    }
    setSaving(false);
    if (!settingsFailed && !membersFailed) {
      onClose?.(true);
      return;
    }
    if (settingsFailed && membersFailed) {
      applySaveError(settingsFailed, 'Не удалось сохранить');
      return;
    }
    const failed = settingsFailed || membersFailed;
    const savedPart = settingsFailed ? 'Список участников обновлён' : 'Настройки сохранены';
    const pendingPart = settingsFailed ? 'настройки' : 'список участников';
    setError(`${savedPart}, но не удалось обновить ${pendingPart}: ${errorMessage(failed, 'ошибка сервера')}. Нажмите «Сохранить» ещё раз — отправятся только оставшиеся изменения.`);
  };

  const remove = async () => {
    if (saving) return;
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

  const requestClose = () => {
    if (saving) return;
    if (dirtyCount > 0) {
      setConfirmDiscard(true);
      return;
    }
    onClose?.(changed);
  };

  const usedBytes = Number(current?.used_bytes);
  // Сервер остаётся источником истины, но лимит ниже уже занятого объёма
  // честно предупреждаем ещё до отправки.
  const quotaUnderUsed = quotaParsed.ok && quotaParsed.bytes > 0
    && Number.isFinite(usedBytes) && quotaParsed.bytes < usedBytes;
  const savedQuotaBytes = Number(current?.quota_bytes || 0);
  const departmentMembers = members.filter((item) => item.principal_type === 'department');
  const userMembers = members.filter((item) => item.principal_type === 'user');
  const showUsage = !isNew && Number.isFinite(usedBytes);
  const usagePercent = showUsage && savedQuotaBytes > 0 ? Math.min(100, (usedBytes / savedQuotaBytes) * 100) : 0;

  const renderDepartmentRow = (item) => {
    const key = keyOf(item);
    const group = expandedGroups[String(item.principal_id)] || {};
    return (
      <Box key={key}>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{ px: 0.5, py: 0.5, borderRadius: 1, '&:hover': { bgcolor: alpha(theme.palette.text.primary, 0.04) } }}
        >
          <IconButton
            size="small"
            sx={{ p: 0.25 }}
            aria-label={`Состав подразделения ${item.name}`}
            data-testid={`my-files-library-expand-${item.principal_id}`}
            onClick={() => toggleGroup(item)}
          >
            {group.open
              ? <ExpandMoreRoundedIcon fontSize="small" />
              : <ChevronRightRoundedIcon fontSize="small" />}
          </IconButton>
          <GroupsOutlinedIcon fontSize="small" color="action" />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" noWrap title={item.name} sx={{ fontWeight: 600 }}>
              {item.name}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap component="div">
              {membersCountLabel(item.members_count)}
            </Typography>
          </Box>
          <RoleSelect
            value={item.role}
            label={`Роль: ${item.name}`}
            open={roleEditKey === key}
            onOpen={() => setRoleEditKey(key)}
            onClose={() => setRoleEditKey((keyNow) => (keyNow === key ? '' : keyNow))}
            onChange={(role) => setMemberRole(item, role)}
          />
          <IconButton
            size="small"
            aria-label={`Действия: ${item.name}`}
            data-testid={`my-files-library-member-menu-${item.principal_id}`}
            onClick={(event) => setMemberMenu({ anchorEl: event.currentTarget, member: item })}
          >
            <MoreVertRoundedIcon fontSize="small" />
          </IconButton>
        </Stack>
        {group.open ? (
          <Stack sx={{ pl: 6.5, pb: 0.5 }} spacing={0.25} data-testid={`my-files-library-group-users-${item.principal_id}`}>
            {group.loading ? <CircularProgress size={14} /> : null}
            {!group.loading && group.error ? (
              <Typography variant="caption" color="error">Не удалось загрузить состав</Typography>
            ) : null}
            {!group.loading && !group.error && Array.isArray(group.items)
              ? (group.items.length
                ? group.items.map((user) => (
                  <Typography key={user.user_id} variant="caption" color="text.secondary" noWrap>
                    {userLabel(user)}
                  </Typography>
                ))
                : <Typography variant="caption" color="text.secondary">В подразделении никого нет</Typography>)
              : null}
          </Stack>
        ) : null}
      </Box>
    );
  };

  const renderUserRow = (item) => (
    <Stack
      key={keyOf(item)}
      direction="row"
      spacing={1}
      alignItems="center"
      sx={{ px: 0.5, py: 0.5, borderRadius: 1, '&:hover': { bgcolor: alpha(theme.palette.text.primary, 0.04) } }}
    >
      <Box sx={{ width: 25 }} />
      <PersonOutlineRoundedIcon fontSize="small" color="action" />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" noWrap title={item.name}>{item.name}</Typography>
      </Box>
      <RoleSelect
        value={item.role}
        label={`Роль: ${item.name}`}
        onChange={(role) => setMemberRole(item, role)}
      />
      <IconButton
        size="small"
        aria-label={`Действия: ${item.name}`}
        data-testid={`my-files-library-member-menu-${item.principal_id}`}
        onClick={(event) => setMemberMenu({ anchorEl: event.currentTarget, member: item })}
      >
        <MoreVertRoundedIcon fontSize="small" />
      </IconButton>
    </Stack>
  );

  const mainContent = (
    <Stack spacing={2.5}>
      <TextField
        label="Название"
        required
        value={name}
        onChange={(event) => { setName(event.target.value); setNameError(''); }}
        onBlur={() => setNameTouched(true)}
        error={Boolean(nameError) || (nameTouched && !name.trim())}
        helperText={nameError || (nameTouched && !name.trim() ? 'Укажите название папки' : ' ')}
        size="small"
        fullWidth
        inputProps={{ maxLength: 255, 'data-testid': 'my-files-library-name' }}
      />
      <Box>
        <TextField
          label="Лимит хранения, ГБ"
          value={quotaGb}
          onChange={(event) => { setQuotaGb(event.target.value); setQuotaError(''); }}
          error={Boolean(quotaError) || quotaInvalid}
          helperText={quotaError || (quotaParsed.ok ? 'Пусто — без отдельного лимита. Файлы общей папки хранятся бессрочно и занимают место в лимите папки, а не в личных квотах участников.' : QUOTA_GB_ERROR_TEXT[quotaParsed.reason] || QUOTA_GB_ERROR_TEXT.format)}
          size="small"
          fullWidth
          placeholder="Без лимита"
          inputProps={{ inputMode: 'decimal', 'data-testid': 'my-files-library-quota' }}
        />
        {quotaUnderUsed ? (
          <Typography
            variant="caption"
            color="warning.main"
            sx={{ display: 'block', mt: 0.75 }}
            data-testid="my-files-library-quota-warn"
          >
            Новый лимит меньше уже занятого объёма ({formatSize(usedBytes)}) — сервер может отклонить сохранение.
          </Typography>
        ) : null}
        {showUsage ? (
          <Box sx={{ mt: 1.5 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="baseline">
              <Typography variant="caption" color="text.secondary">Занято</Typography>
              <Typography variant="caption" color="text.secondary" data-testid="my-files-library-usage">
                {savedQuotaBytes > 0
                  ? `Занято ${formatSize(usedBytes)} из ${formatSize(savedQuotaBytes)}`
                  : `Занято ${formatSize(usedBytes)} · лимит не задан`}
              </Typography>
            </Stack>
            {savedQuotaBytes > 0 ? (
              <LinearProgress
                variant="determinate"
                value={usagePercent}
                color={usagePercent >= 100 ? 'error' : usagePercent >= 90 ? 'warning' : 'primary'}
                sx={{ mt: 0.5, height: 6, borderRadius: 1 }}
              />
            ) : null}
          </Box>
        ) : null}
      </Box>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {!isNew && !membersOnly ? (
        <Box
          sx={{
            border: 1,
            borderColor: alpha(theme.palette.error.main, 0.45),
            borderRadius: 2,
            p: 2,
          }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'error.main' }}>
            Удалить общую папку
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5 }}>
            Папку можно удалить только пустой; файлы и корзина должны быть очищены.
          </Typography>
          {confirmDelete ? (
            <Alert
              severity="warning"
              action={(
                <Stack direction="row" spacing={1}>
                  <Button size="small" onClick={() => setConfirmDelete(false)} disabled={saving}>
                    Отмена
                  </Button>
                  <Button
                    color="error"
                    size="small"
                    variant="contained"
                    onClick={remove}
                    disabled={saving}
                    data-testid="my-files-library-delete-confirm"
                  >
                    Удалить
                  </Button>
                </Stack>
              )}
            >
              Удалить общую папку «{name}»? Это возможно, только когда в ней и в её корзине ничего не осталось.
            </Alert>
          ) : (
            <Button
              color="error"
              variant="outlined"
              startIcon={<DeleteOutlineRoundedIcon />}
              onClick={() => setConfirmDelete(true)}
              data-testid="my-files-library-delete"
            >
              Удалить…
            </Button>
          )}
        </Box>
      ) : null}
    </Stack>
  );

  const accessContent = loading ? (
    <Stack alignItems="center" sx={{ py: 3 }}><CircularProgress size={26} /></Stack>
  ) : (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Добавить людей и подразделения</Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'flex-start' }}>
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
          <Box sx={{ flexShrink: 0 }}>
            <RoleSelect value={newRole} onChange={setNewRole} label="Роль для новых участников" />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, maxWidth: 220 }}>
              {roleOption(newRole)?.hint}
            </Typography>
          </Box>
        </Stack>
        {departments.length > 0 ? (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.5 }}>
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
            <Button
              variant="outlined"
              onClick={addDepartment}
              disabled={!department}
              data-testid="my-files-library-add-department"
              sx={{ flexShrink: 0 }}
            >
              Добавить
            </Button>
          </Stack>
        ) : null}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          Подразделение подключается целиком: кто в него придёт или уйдёт, тот сразу получит или потеряет доступ.
        </Typography>
      </Box>
      <Box data-testid="my-files-library-members">
        {departmentMembers.length > 0 ? (
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>Подразделения</Typography>
            <Stack spacing={0.25}>{departmentMembers.map(renderDepartmentRow)}</Stack>
          </Box>
        ) : null}
        {userMembers.length > 0 ? (
          <Box sx={{ mt: departmentMembers.length > 0 ? 2 : 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>Сотрудники</Typography>
            <Stack spacing={0.25}>{userMembers.map(renderUserRow)}</Stack>
          </Box>
        ) : null}
        {members.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Пока никто не добавлен — найдите сотрудника или подразделение выше.
          </Typography>
        ) : null}
      </Box>
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Menu
        anchorEl={memberMenu?.anchorEl}
        open={Boolean(memberMenu?.anchorEl)}
        onClose={() => setMemberMenu(null)}
      >
        {memberMenu?.member?.principal_type === 'department' ? (
          <MenuItem
            onClick={() => {
              setRoleEditKey(keyOf(memberMenu.member));
              setMemberMenu(null);
            }}
          >
            Изменить роль
          </MenuItem>
        ) : null}
        <MenuItem
          sx={{ color: 'error.main' }}
          data-testid={memberMenu?.member ? `my-files-library-remove-${memberMenu.member.principal_id}` : undefined}
          onClick={() => {
            if (memberMenu?.member) removeMember(memberMenu.member);
            setMemberMenu(null);
          }}
        >
          Убрать доступ
        </MenuItem>
      </Menu>
    </Stack>
  );

  return (
    <>
      <Dialog
        open={Boolean(open)}
        onClose={requestClose}
        maxWidth="md"
        fullWidth
        fullScreen={isMobile}
        PaperProps={{
          sx: {
            display: 'flex',
            flexDirection: 'column',
            ...(isMobile ? {} : { maxHeight: 'calc(100dvh - 64px)' }),
          },
        }}
      >
        <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ px: 3, pt: 2.5, pb: 1 }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography component="h2" variant="h6" sx={{ fontWeight: 700, lineHeight: 1.25 }}>
              {isNew ? 'Новая общая папка' : membersOnly ? 'Управление доступом' : 'Настройки общей папки'}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap title={name}>
              {isNew
                ? 'Файлы общей папки не занимают место сотрудников и хранятся, пока их не удалят.'
                : membersOnly
                  ? `Папка «${name}»: выберите, кто с ней работает.`
                  : `«${name}»`}
            </Typography>
          </Box>
          <IconButton aria-label="Закрыть" onClick={requestClose} sx={{ mt: -0.5 }}>
            <CloseRoundedIcon />
          </IconButton>
        </Stack>
        {membersOnly || isNew ? null : (
          <Tabs
            value={tab}
            onChange={(_event, value) => {
              setTab(value);
              setMemberMenu(null);
              setRoleEditKey('');
            }}
            aria-label="Разделы настроек общей папки"
            sx={{ px: 3, borderBottom: 1, borderColor: 'divider', minHeight: 44, '& .MuiTab-root': { minHeight: 44 } }}
          >
            <Tab value="main" label="Основные" data-testid="my-files-library-tab-main" />
            <Tab value="access" label="Доступ" data-testid="my-files-library-tab-access" />
          </Tabs>
        )}
        <DialogContent sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 3, py: 2 }}>
          {membersOnly || (!isNew && tab === 'access') ? accessContent : mainContent}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 1.5, borderTop: 1, borderColor: 'divider' }}>
          {dirtyCount > 0 ? (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mr: 'auto' }}
              data-testid="my-files-library-unsaved"
            >
              Несохранённые изменения: {dirtyCount}
            </Typography>
          ) : <Box sx={{ mr: 'auto' }} />}
          <Button onClick={requestClose}>Отмена</Button>
          {isNew ? (
            <Button
              variant="contained"
              onClick={create}
              disabled={saving || !name.trim() || quotaInvalid}
              data-testid="my-files-library-create"
            >
              {saving ? 'Создаём…' : 'Создать'}
            </Button>
          ) : (
            <Button
              variant="contained"
              onClick={save}
              disabled={loading || saving || dirtyCount === 0 || (!membersOnly && (!name.trim() || quotaInvalid))}
              data-testid="my-files-library-save"
            >
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </Button>
          )}
        </DialogActions>
      </Dialog>
      <Dialog open={confirmDiscard} onClose={() => setConfirmDiscard(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>Закрыть без сохранения?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {`Несохранённые изменения (${dirtyCount}) будут потеряны.`}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDiscard(false)}>Отменить</Button>
          <Button
            color="error"
            variant="contained"
            data-testid="my-files-library-discard"
            onClick={() => {
              setConfirmDiscard(false);
              onClose?.(changed);
            }}
          >
            Не сохранять
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
