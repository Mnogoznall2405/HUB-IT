import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  IconButton,
  InputAdornment,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import GroupAddOutlinedIcon from '@mui/icons-material/GroupAddOutlined';
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined';
import LinkOutlinedIcon from '@mui/icons-material/LinkOutlined';
import PersonAddAltOutlinedIcon from '@mui/icons-material/PersonAddAltOutlined';

import chatDirectoryAPI from '../../api/chatDirectory';
import { myFilesOfficeAPI } from '../../api/myFilesOffice';
import PersonAvatar from './PersonAvatar';

export const ROLE_OPTIONS = [
  { value: 'edit', label: 'Правка', hint: 'Меняет файл и комментирует' },
  { value: 'comment', label: 'Комментарии', hint: 'Только комментирует' },
  { value: 'view', label: 'Просмотр', hint: 'Только читает' },
];

const roleLabel = (value) => ROLE_OPTIONS.find((option) => option.value === value)?.label || value;

const userLabel = (user) => {
  const fullName = String(user?.full_name || '').trim();
  const username = String(user?.username || '').trim();
  return fullName && fullName !== username ? `${fullName} (${username})` : username;
};

const errorMessage = (err, fallback) => String(err?.response?.data?.detail || err?.message || fallback);

const toMember = (item, role) => ({
  id: item.user_id ?? item.id,
  username: item.username,
  full_name: item.full_name,
  role: role || item.role || 'edit',
});

// The role menu explains every role in a line, so nobody has to guess what "Комментарии" allows.
function RoleSelect({ value, onChange, label, minWidth = 150, flat = false }) {
  return (
    <Select
      size="small"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      inputProps={{ 'aria-label': label }}
      renderValue={roleLabel}
      MenuProps={{ PaperProps: { sx: { minWidth: 240 } } }}
      sx={{
        minWidth,
        ...(flat ? {
          borderRadius: '999px',
          fontWeight: 600,
          '& fieldset': { borderColor: 'transparent' },
          '&:hover fieldset': { borderColor: 'divider' },
        } : {}),
      }}
    >
      {ROLE_OPTIONS.map((option) => (
        <MenuItem key={option.value} value={option.value}>
          <ListItemText primary={option.label} secondary={option.hint} />
        </MenuItem>
      ))}
    </Select>
  );
}

function MemberRow({ member, isNew, onRole, onRemove }) {
  const theme = useTheme();
  const fullName = String(member.full_name || '').trim();
  const username = String(member.username || '').trim();
  const title = fullName || username;
  return (
    <Stack
      direction="row"
      spacing={1.25}
      alignItems="center"
      data-testid={`my-files-collaborator-${member.id}`}
      sx={{
        px: 1.5,
        py: 0.75,
        borderRadius: 2,
        bgcolor: isNew ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.07) : 'transparent',
        '&:hover': { bgcolor: alpha(theme.palette.text.primary, 0.05) },
      }}
    >
      <PersonAvatar name={title} size={34} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap title={userLabel(member)}>{title}</Typography>
          {isNew ? <Chip size="small" color="primary" label="новый" sx={{ height: 18, fontSize: '0.68rem' }} /> : null}
        </Stack>
        {fullName && username && fullName !== username ? (
          <Typography variant="caption" color="text.secondary" noWrap component="div">{username}</Typography>
        ) : null}
      </Box>
      <RoleSelect
        flat
        minWidth={140}
        value={member.role}
        onChange={onRole}
        label={`Роль: ${userLabel(member)}`}
      />
      <Tooltip title="Убрать доступ">
        <IconButton size="small" aria-label={`Убрать ${userLabel(member)}`} onClick={onRemove}>
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

export default function MyFilesCollaboratorsDialog({ open, file, folder, onClose, onShareLink, onSaved }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isFolder = Boolean(folder);
  const fileId = String((isFolder ? folder : file)?.id || '');
  const fileName = String(isFolder ? (folder?.name || 'папка') : (file?.original_file_name || 'файл'));
  const [members, setMembers] = useState([]);
  const [initialIds, setInitialIds] = useState(() => new Set());
  const [newRole, setNewRole] = useState('edit');
  const [options, setOptions] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [accessInfo, setAccessInfo] = useState({});
  const generation = useRef(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [groups, setGroups] = useState([]);
  const [group, setGroup] = useState(null);
  const [addingGroup, setAddingGroup] = useState(false);

  useEffect(() => {
    generation.current += 1;
    if (!open || !fileId) return undefined;
    const controller = new AbortController();
    setLoaded(false);
    setAccessInfo({});
    setSaving(false);
    setAddingGroup(false);
    setMembers([]);
    setInitialIds(new Set());
    setLoading(true);
    setError('');
    setNewRole('edit');
    const request = isFolder
      ? myFilesOfficeAPI.listFolderCollaborators(fileId, { signal: controller.signal })
      : myFilesOfficeAPI.listCollaborators(fileId, { signal: controller.signal });
    request
      .then((data) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(data?.items)) throw new Error('HUB не подтвердил текущий список доступа.');
        const items = data.items.map((item) => toMember(item));
        setMembers(items);
        setAccessInfo(data);
        setInitialIds(new Set(items.map((item) => item.id)));
        setLoaded(true);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(errorMessage(err, 'Не удалось загрузить список'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => { generation.current += 1; controller.abort(); };
  }, [fileId, isFolder, open]);

  useEffect(() => {
    if (!open) return undefined;
    setInfo('');
    setGroup(null);
    const controller = new AbortController();
    myFilesOfficeAPI.listGroups({ signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setGroups(Array.isArray(data?.items) ? data.items : []); })
      .catch(() => { if (!controller.signal.aborted) setGroups([]); });
    return () => controller.abort();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const text = query.trim();
    if (text.length < 2) {
      setOptions([]);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      chatDirectoryAPI.getUsers({ q: text, limit: 20 })
        .then((data) => { if (!cancelled) setOptions(Array.isArray(data?.items) ? data.items : []); })
        .catch(() => { if (!cancelled) setOptions([]); });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  const setRole = (id, role) => setMembers((current) => current.map((item) => (item.id === id ? { ...item, role } : item)));
  const removeMember = (id) => setMembers((current) => current.filter((item) => item.id !== id));

  const addUser = (user) => {
    if (!user) return;
    setInfo('');
    setMembers((current) => (current.some((item) => item.id === user.id) ? current : [...current, toMember(user, newRole)]));
    setQuery('');
  };

  const addGroup = async () => {
    if (!group) return;
    const current = generation.current;
    setAddingGroup(true);
    setError('');
    setInfo('');
    try {
      const data = await myFilesOfficeAPI.listGroupMembers(group.id);
      if (current !== generation.current) return;
      const known = new Set(members.map((item) => item.id));
      const fresh = (data?.items || []).map((item) => toMember(item, newRole)).filter((item) => !known.has(item.id));
      setMembers([...members, ...fresh]);
      setInfo(fresh.length ? `Добавлено из «${group.name}»: ${fresh.length}. Нажмите «Сохранить».` : `В «${group.name}» нет новых сотрудников.`);
      setGroup(null);
    } catch (err) {
      if (current === generation.current) setError(errorMessage(err, 'Не удалось получить состав группы'));
    } finally {
      if (current === generation.current) setAddingGroup(false);
    }
  };

  const save = async () => {
    if (!loaded || loading || saving) return;
    const current = generation.current;
    setSaving(true);
    setError('');
    try {
      const payload = members.map((item) => ({ user_id: item.id, role: item.role }));
      const result = isFolder ? await myFilesOfficeAPI.setFolderCollaborators(fileId, payload)
        : await myFilesOfficeAPI.setCollaborators(fileId, payload);
      if (current === generation.current) {
        if (Array.isArray(result?.items)) onSaved?.({ ...accessInfo, items: result.items });
        onClose?.(true);
      }
    } catch (err) {
      if (current === generation.current) setError(errorMessage(err, 'Не удалось сохранить доступ'));
    } finally {
      if (current === generation.current) setSaving(false);
    }
  };

  const addedCount = useMemo(() => members.filter((item) => !initialIds.has(item.id)).length, [initialIds, members]);
  const removedCount = useMemo(
    () => [...initialIds].filter((id) => !members.some((item) => item.id === id)).length,
    [initialIds, members],
  );
  const dirty = addedCount > 0 || removedCount > 0;

  return (
    <Dialog
      open={Boolean(open)}
      onClose={() => onClose?.(false)}
      maxWidth="sm"
      fullWidth
      fullScreen={isMobile}
      PaperProps={{ sx: { borderRadius: isMobile ? 0 : 3 } }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 3, pt: 2.5, pb: 1.5 }}>
        <Box
          sx={{
            width: 44,
            height: 44,
            borderRadius: 2,
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
            color: 'primary.main',
            bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.2 : 0.1),
          }}
        >
          <GroupOutlinedIcon />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography component="h2" variant="h6" sx={{ fontWeight: 700, lineHeight: 1.25 }}>Совместный доступ</Typography>
          <Typography variant="body2" color="text.secondary" noWrap title={fileName}>
            {isFolder ? 'Папка' : 'Файл'} «{fileName}»
          </Typography>
        </Box>
        <IconButton aria-label="Закрыть" onClick={() => onClose?.(false)}>
          <CloseRoundedIcon />
        </IconButton>
      </Stack>
      <DialogContent sx={{ pt: 1 }}>
        {loading ? (
          <Stack alignItems="center" sx={{ py: 3 }}><CircularProgress size={28} /></Stack>
        ) : (
          <Stack spacing={2.5}>
            <Typography variant="body2" color="text.secondary">
              {isFolder
                ? 'Выбранные пользователи увидят папку в разделе «Доступно мне»: все файлы в ней и в подпапках, в том числе добавленные позже, откроются с их ролью. Загружать файлы и менять папки может только владелец.'
                : 'Выбранные пользователи увидят файл в разделе «Доступно мне». У каждого своя роль; предыдущие версии сохраняются.'}
            </Typography>

            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Добавить людей</Typography>
              <Stack spacing={1.25}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
                  <Autocomplete
                    fullWidth
                    size="small"
                    options={options}
                    value={null}
                    inputValue={query}
                    onInputChange={(_event, value, reason) => { if (reason !== 'reset') setQuery(value); }}
                    onChange={(_event, user) => addUser(user)}
                    getOptionLabel={userLabel}
                    isOptionEqualToValue={(option, value) => option.id === value.id}
                    filterOptions={(items) => items.filter((user) => !members.some((item) => item.id === user.id))}
                    noOptionsText={query.trim().length < 2 ? 'Введите минимум 2 символа' : 'Никого не найдено'}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Добавить пользователя"
                        placeholder="Имя или логин"
                        InputProps={{
                          ...params.InputProps,
                          startAdornment: (
                            <>
                              <InputAdornment position="start"><PersonAddAltOutlinedIcon fontSize="small" /></InputAdornment>
                              {params.InputProps.startAdornment}
                            </>
                          ),
                        }}
                      />
                    )}
                  />
                  <RoleSelect value={newRole} onChange={setNewRole} label="Роль для новых" minWidth={150} />
                </Stack>
                {groups.length > 0 ? (
                  <Box>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Autocomplete
                        fullWidth
                        size="small"
                        options={groups}
                        value={group}
                        onChange={(_event, value) => setGroup(value)}
                        getOptionLabel={(item) => `${item.name} (${item.members_count})`}
                        isOptionEqualToValue={(option, value) => option.id === value.id}
                        noOptionsText="Групп нет"
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            label="Добавить группу целиком"
                            placeholder="Подразделение"
                            InputProps={{
                              ...params.InputProps,
                              startAdornment: (
                                <>
                                  <InputAdornment position="start"><GroupAddOutlinedIcon fontSize="small" /></InputAdornment>
                                  {params.InputProps.startAdornment}
                                </>
                              ),
                            }}
                          />
                        )}
                      />
                      <Button
                        variant="outlined"
                        onClick={addGroup}
                        disabled={!group || addingGroup}
                        data-testid="my-files-collaborators-add-group"
                        sx={{ flexShrink: 0, borderRadius: 2 }}
                      >
                        {addingGroup ? <CircularProgress size={18} /> : 'Добавить'}
                      </Button>
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                      Состав группы копируется в список сейчас; новые сотрудники подразделения позже сами не добавятся.
                    </Typography>
                  </Box>
                ) : null}
              </Stack>
            </Box>

            <Box>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Кому открыт доступ</Typography>
                <Chip size="small" label={`Прямых приглашений: ${members.length}`} />
              </Stack>
              <Stack
                spacing={0.25}
                data-testid="my-files-collaborators-list"
                sx={{ maxHeight: 300, overflowY: 'auto', mx: -0.5 }}
              >
                <Stack direction="row" spacing={1.25} alignItems="center" sx={{ px: 1.5, py: 0.75 }}>
                  <PersonAvatar name={accessInfo.owner ? userLabel(accessInfo.owner) : 'Владелец'} size={34} />
                  <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>
                    {accessInfo.owner ? userLabel(accessInfo.owner) : accessInfo.owner_kind === 'author' ? 'Автор не указан' : 'Владелец'}
                  </Typography>
                  <Chip size="small" variant="outlined" label={accessInfo.owner_kind === 'author' ? 'Автор файла' : 'Владелец'} />
                </Stack>
                {members.map((item) => (
                  <MemberRow
                    key={item.id}
                    member={item}
                    isNew={!initialIds.has(item.id)}
                    onRole={(role) => setRole(item.id, role)}
                    onRemove={() => removeMember(item.id)}
                  />
                ))}
              </Stack>
              {loaded && members.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, pt: 1 }}>
                  Прямые приглашения не добавлены.
                </Typography>
              ) : null}
            </Box>

            {info ? <Alert severity="info">{info}</Alert> : null}
            {accessInfo.inherited_access ? <Alert severity="info">
              Доступ также предоставлен через {accessInfo.library_name ? `общую папку «${accessInfo.library_name}»` : 'родительскую папку'}.
              Здесь изменяются только прямые приглашения к файлу. Удаление приглашения не отменяет доступ через папку.
            </Alert> : null}
            {error ? <Alert severity="error">{error}</Alert> : null}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, gap: 1, flexWrap: 'wrap' }}>
        <Stack alignItems="flex-start" sx={{ mr: 'auto', minWidth: 0 }}>
          {onShareLink && !isFolder ? (
            <Tooltip title="Одна ссылка для всех: гость скачает файл, участник после входа откроет его в редакторе по своей роли">
              <Button
                startIcon={<LinkOutlinedIcon />}
                onClick={() => onShareLink(file)}
                data-testid="my-files-collaborators-copy-link"
              >
                Ссылка для участников
              </Button>
            </Tooltip>
          ) : null}
          {dirty ? (
            <Typography variant="caption" color="text.secondary" sx={{ px: 1 }} data-testid="my-files-collaborators-changes">
              Не сохранено: {[addedCount ? `добавлено ${addedCount}` : '', removedCount ? `убрано ${removedCount}` : ''].filter(Boolean).join(', ')}
            </Typography>
          ) : null}
        </Stack>
        <Button onClick={() => onClose?.(false)}>Отмена</Button>
        <Button
          variant="contained"
          onClick={save}
          disabled={!loaded || loading || saving}
          data-testid="my-files-collaborators-save"
          sx={{ borderRadius: 2, px: 3 }}
        >
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
