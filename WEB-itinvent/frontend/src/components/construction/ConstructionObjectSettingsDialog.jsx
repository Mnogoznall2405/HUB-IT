import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
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
  Divider,
  FormControl,
  FormControlLabel,
  FormLabel,
  LinearProgress,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import { constructionAPI } from '../../api/construction';
import { OBJECT_TEAM_ROLES, roleLabel } from './constructionShared';
import { useConstructionWorkLeaveGuard } from './useConstructionWorkLeaveGuard';


const errorMessage = (error, fallback) => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  return error?.message || fallback;
};

const formatDate = (value) => {
  if (!value) return 'сейчас';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short' }).format(parsed);
};

const settingsPayload = (name, groups, roles) => ({
  name: name.trim(),
  groups: groups.map(({ group_ref, group_name }) => ({ group_ref, group_name: group_name || '' })),
  roles: OBJECT_TEAM_ROLES.map(({ key }) => ({ role_key: key, employee_code: roles[key]?.employee_code || null })),
});

function EmployeeSelect({ label, value, onChange, disabled }) {
  const [inputValue, setInputValue] = useState(value?.full_name || '');
  const [options, setOptions] = useState(value ? [value] : []);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState('');

  useEffect(() => {
    setInputValue(value?.full_name || '');
    setOptions(value ? [value] : []);
  }, [value?.employee_code, value?.full_name]);

  useEffect(() => {
    if (disabled) return undefined;
    setSearchError('');
    const normalizedQuery = inputValue.trim();
    if (normalizedQuery.length < 2 || normalizedQuery === value?.full_name) {
      setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await constructionAPI.searchEmployees(normalizedQuery, {
          limit: 30,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const loaded = Array.isArray(response?.items) ? response.items : [];
        setOptions(() => {
          const merged = new Map(value ? [[value.employee_code, value]] : []);
          loaded.forEach((item) => merged.set(item.employee_code, item));
          return [...merged.values()];
        });
      } catch (error) {
        if (!controller.signal.aborted && error?.code !== 'ERR_CANCELED' && error?.name !== 'AbortError') {
          setOptions(value ? [value] : []);
          setSearchError('Не удалось найти сотрудников. Измените запрос, чтобы повторить поиск.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [disabled, inputValue, value]);

  return (
    <Autocomplete
      value={value || null}
      options={options}
      loading={loading}
      loadingText="Поиск сотрудников…"
      disabled={disabled}
      inputValue={inputValue}
      onInputChange={(_event, nextValue, reason) => {
        if (reason !== 'reset') setInputValue(nextValue);
      }}
      onChange={(_event, nextValue) => onChange(nextValue)}
      isOptionEqualToValue={(option, selected) => option.employee_code === selected.employee_code}
      getOptionLabel={(option) => option.full_name || ''}
      noOptionsText={inputValue.trim().length < 2 ? 'Введите минимум 2 символа' : 'Сотрудники не найдены'}
      renderOption={(optionProps, option) => {
        const { key, ...rest } = optionProps;
        return (
          <Box component="li" key={key} {...rest} sx={{ minHeight: 48, alignItems: 'flex-start !important' }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" fontWeight={750} sx={{ overflowWrap: 'anywhere' }}>{option.full_name}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                {[option.position, option.department].filter(Boolean).join(' · ') || `Код ЗУП: ${option.employee_code}`}
              </Typography>
            </Box>
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder="Начните вводить ФИО"
          error={Boolean(searchError)}
          helperText={searchError || (value ? [value.position, value.department].filter(Boolean).join(' · ') || 'Сотрудник выбран' : 'Выберите сотрудника из справочника')}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {loading ? <CircularProgress color="inherit" size={18} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
          sx={{ '& .MuiInputBase-root': { minHeight: 48 } }}
        />
      )}
    />
  );
}

export default function ConstructionObjectSettingsDialog({ open, item, onClose, onSaved }) {
  const [context, setContext] = useState(null);
  const [name, setName] = useState('');
  const [groups, setGroups] = useState([]);
  const [objectMode, setObjectMode] = useState('standalone');
  const [roles, setRoles] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [baseline, setBaseline] = useState('');
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardAction, setDiscardAction] = useState('close');
  const [conflict, setConflict] = useState(false);
  const itemRef = useRef(item);
  itemRef.current = item;
  const targetKey = item?.managed_object_id || item?.object_ref || 'new';
  const dirty = Boolean(baseline) && JSON.stringify(settingsPayload(name, groups, roles)) !== baseline;
  const leaveGuard = useConstructionWorkLeaveGuard(open && (dirty || saving));

  useEffect(() => {
    if (!open && leaveGuard.pending) leaveGuard.cancel();
  }, [open, leaveGuard.pending]);

  useEffect(() => {
    if (!open) return undefined;
    const sourceItem = itemRef.current;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setConflict(false);
    setContext(null);
    setName('');
    setGroups([]);
    setRoles({});
    setBaseline('');
    setDiscardOpen(false);
    constructionAPI.getManagement({ signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        const managed = (response?.objects || []).find((entry) => entry.id === sourceItem?.managed_object_id);
        if (sourceItem?.managed_object_id && !managed) {
          setError('Объект не найден в настройках. Обновите карточку объекта и повторите попытку.');
          return;
        }
        const fallbackGroups = sourceItem?.kind === 'project'
          ? (sourceItem?.source_groups?.length
            ? sourceItem.source_groups
            : sourceItem.object_ref ? [{ group_ref: sourceItem.object_ref, group_name: sourceItem.name }] : [])
          : [];
        const selectedGroups = managed?.groups?.length ? managed.groups : fallbackGroups;
        const selectedRoles = {};
        (managed?.team || sourceItem?.team || []).forEach((member) => {
          selectedRoles[member.role_key] = member;
        });
        setContext(response || { objects: [], available_groups: [] });
        const selectedName = managed?.name || sourceItem?.name || '';
        setName(selectedName);
        setGroups(selectedGroups);
        setObjectMode(selectedGroups.length > 1 ? 'combined' : 'standalone');
        setRoles(selectedRoles);
        setBaseline(JSON.stringify(settingsPayload(selectedName, selectedGroups, selectedRoles)));
      })
      .catch((requestError) => {
        if (!controller.signal.aborted && requestError?.code !== 'ERR_CANCELED' && requestError?.name !== 'AbortError') {
          setError(errorMessage(requestError, 'Не удалось загрузить настройки объектов'));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [targetKey, open, reload]);

  useEffect(() => {
    if (!open || (!dirty && !saving)) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, open, saving]);

  const requestClose = () => {
    if (saving) return;
    if (dirty) { setDiscardAction('close'); setDiscardOpen(true); }
    else onClose();
  };
  const requestReload = () => {
    if (dirty) { setDiscardAction('reload'); setDiscardOpen(true); }
    else setReload((value) => value + 1);
  };

  const currentObject = useMemo(
    () => (context?.objects || []).find((entry) => entry.id === item?.managed_object_id),
    [context?.objects, item?.managed_object_id],
  );
  const groupOwners = useMemo(() => {
    const owners = new Map();
    (context?.objects || []).forEach((object) => {
      (object.groups || []).forEach((group) => owners.set(group.group_ref, object));
    });
    return owners;
  }, [context?.objects]);
  const groupOptions = useMemo(() => {
    const byRef = new Map((context?.available_groups || []).map((group) => [group.group_ref, group]));
    groups.forEach((group) => byRef.set(group.group_ref, group));
    return [...byRef.values()];
  }, [context?.available_groups, groups]);

  const handleSave = async () => {
    if (!context || loading || saving) return;
    const normalizedName = name.trim();
    if (!normalizedName) {
      setError('Укажите название объекта');
      return;
    }
    if (!groups.length) {
      setError('Выберите хотя бы одну номенклатурную группу 1С');
      return;
    }
    setSaving(true);
    setError('');
    setConflict(false);
    const payload = settingsPayload(normalizedName, groups, roles);
    if (item?.managed_object_id && currentObject?.updated_at) payload.expected_updated_at = currentObject.updated_at;
    try {
      const saved = item?.managed_object_id
        ? await constructionAPI.updateManagedObject(item.managed_object_id, payload)
        : await constructionAPI.createManagedObject(payload);
      // The parent may immediately navigate to a newly created object. Remove
      // the guard before that successful transition, without discarding errors.
      flushSync(() => {
        setBaseline(JSON.stringify(settingsPayload(name, groups, roles)));
        setSaving(false);
        leaveGuard.cancel();
      });
      onSaved(saved);
    } catch (requestError) {
      setError(errorMessage(requestError, 'Не удалось сохранить карточку объекта'));
      setConflict(requestError?.response?.status === 409);
    } finally {
      setSaving(false);
    }
  };

  return (
    <><Dialog open={open} onClose={requestClose} fullWidth maxWidth="md" aria-labelledby="construction-settings-title"
      PaperProps={{ sx: { borderRadius: 3, backgroundImage: 'none', '& .MuiButton-root': { textTransform: 'none' } } }}>
      <Box component="form" onSubmit={(event) => { event.preventDefault(); void handleSave(); }} sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <DialogTitle id="construction-settings-title" sx={{ fontWeight: 750 }}>
        {item?.managed_object_id ? 'Настройка объекта' : 'Новая карточка объекта'}
      </DialogTitle>
      {loading ? <LinearProgress aria-label="Загрузка настроек объекта" /> : null}
      <DialogContent dividers>
        <Stack spacing={2}>
          {error ? <Alert severity="error" action={!context && !loading ? <Button onClick={requestReload}>Повторить</Button> : conflict ? <Button onClick={requestReload}>Обновить настройки</Button> : undefined}>{error}</Alert> : null}
          {!item?.managed_object_id ? <FormControl disabled={loading || saving || !context}>
            <FormLabel id="construction-object-mode-label">Как вести проект</FormLabel>
            <RadioGroup row aria-labelledby="construction-object-mode-label" value={objectMode} onChange={(_, value) => {
              setObjectMode(value);
              if (value === 'standalone') setGroups((current) => current.slice(0, 1));
            }}>
              <FormControlLabel value="standalone" control={<Radio />} label="Отдельный проект" />
              <FormControlLabel value="combined" control={<Radio />} label="Объединённый объект" />
            </RadioGroup>
            <Typography variant="body2" color="text.secondary">
              {objectMode === 'standalone'
                ? 'Один проект из 1С со своей командой, ходом работ, заявками и диаграммами.'
                : 'Несколько проектов из 1С с общей командой и сводными показателями.'}
            </Typography>
          </FormControl> : null}
          <TextField
            autoFocus
            fullWidth
            label="Название объекта"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={loading || saving || !context}
            inputProps={{ maxLength: 255 }}
            sx={{ '& .MuiInputBase-root': { minHeight: 48 } }}
          />
          <Autocomplete
            multiple={Boolean(item?.managed_object_id) || objectMode === 'combined'}
            disableCloseOnSelect={Boolean(item?.managed_object_id) || objectMode === 'combined'}
            value={item?.managed_object_id || objectMode === 'combined' ? groups : groups[0] || null}
            options={groupOptions}
            disabled={loading || saving || !context}
            onChange={(_event, nextGroups) => setGroups(Array.isArray(nextGroups) ? nextGroups : nextGroups ? [nextGroups] : [])}
            isOptionEqualToValue={(option, selected) => option.group_ref === selected.group_ref}
            getOptionDisabled={(option) => {
              const owner = groupOwners.get(option.group_ref);
              return Boolean(owner && owner.id !== item?.managed_object_id);
            }}
            getOptionLabel={(option) => option.group_name || option.group_ref}
            noOptionsText="Группы 1С не найдены"
            renderOption={(optionProps, option) => {
              const { key, ...rest } = optionProps;
              const owner = groupOwners.get(option.group_ref);
              return (
                <Box component="li" key={key} {...rest} sx={{ minHeight: 48, overflowWrap: 'anywhere' }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2">{option.group_name || option.group_ref}</Typography>
                    {owner && owner.id !== item?.managed_object_id ? (
                      <Typography variant="caption" color="text.secondary">Уже входит в объект «{owner.name}»</Typography>
                    ) : null}
                  </Box>
                </Box>
              );
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Номенклатурные группы 1С"
                placeholder={objectMode === 'standalone' && !item?.managed_object_id ? 'Выберите один проект' : 'Выберите группы одного объекта'}
                helperText={objectMode === 'standalone' && !item?.managed_object_id
                  ? 'Проект будет самостоятельным. Присоединять другие проекты не требуется.'
                  : 'Можно вести одну группу отдельно или объединить несколько в общую карточку.'}
              />
            )}
          />

          <Divider />
          <Box>
            <Typography variant="subtitle1" fontWeight={850}>Постоянная команда объекта</Typography>
            <Typography variant="body2" color="text.secondary">
              Назначьте ответственных за объект. Изменения команды сохраняются в истории назначений.
            </Typography>
          </Box>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'repeat(2, minmax(0, 1fr))' },
              gap: 1.5,
            }}
          >
            {OBJECT_TEAM_ROLES.map((role) => (
              <EmployeeSelect
                key={role.key}
                label={role.label}
                value={roles[role.key] || null}
                onChange={(employee) => setRoles((current) => ({ ...current, [role.key]: employee }))}
                disabled={loading || saving || !context}
              />
            ))}
          </Box>

          {currentObject?.role_history?.length ? (
            <Box component="details" sx={{ '& summary': { cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' } }}>
              <Typography component="summary" variant="subtitle2" fontWeight={800}>
                История назначений ({currentObject.role_history.length})
              </Typography>
              <Stack spacing={0.75} sx={{ pt: 0.75 }}>
                {currentObject.role_history.map((entry, index) => (
                  <Box key={`${entry.role_key}-${entry.employee_code}-${entry.valid_from || index}`}>
                    <Typography variant="body2" fontWeight={750}>
                      {roleLabel(entry.role_key)} · {entry.full_name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatDate(entry.valid_from)} — {entry.valid_to ? formatDate(entry.valid_to) : 'по настоящее время'}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </Box>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, gap: 1, flexWrap: 'wrap' }}>
        <Button onClick={requestClose} disabled={saving} sx={{ minHeight: 44 }}>Отмена</Button>
        <Button
          variant="contained"
          type="submit"
          disabled={loading || saving || !context}
          startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveOutlinedIcon />}
          sx={{ minHeight: 44 }}
        >
          Сохранить объект
        </Button>
      </DialogActions>
      </Box>
    </Dialog>
    <Dialog open={open && discardOpen} onClose={() => setDiscardOpen(false)} aria-labelledby="discard-construction-settings-title" PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle id="discard-construction-settings-title">Отменить изменения настроек?</DialogTitle>
      <DialogContent>Название, направления и назначения ещё не сохранены.</DialogContent>
      <DialogActions sx={{ p: 2, flexWrap: 'wrap' }}><Button onClick={() => setDiscardOpen(false)}>Продолжить редактирование</Button><Button onClick={() => { setDiscardOpen(false); if (discardAction === 'reload') setReload((value) => value + 1); else onClose(); }}>Отменить изменения</Button></DialogActions>
    </Dialog>
    <Dialog open={open && leaveGuard.pending} onClose={leaveGuard.cancel} aria-labelledby="leave-construction-settings-title" PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle id="leave-construction-settings-title">В настройках остались несохранённые изменения</DialogTitle>
      <DialogContent>{saving ? 'Дождитесь завершения сохранения.' : 'При переходе изменения названия, направлений и команды будут потеряны.'}</DialogContent>
      <DialogActions sx={{ p: 2, flexWrap: 'wrap' }}>
        <Button onClick={leaveGuard.cancel}>Остаться в настройках</Button>
        <Button disabled={saving} onClick={() => { setBaseline(''); setDiscardOpen(false); onClose(); leaveGuard.leave(); }}>Уйти без сохранения</Button>
      </DialogActions>
    </Dialog></>
  );
}
