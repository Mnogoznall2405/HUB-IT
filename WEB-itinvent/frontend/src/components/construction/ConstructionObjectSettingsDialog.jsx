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
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { constructionAPI } from '../../api/construction';


const ROLE_OPTIONS = [
  { key: 'project_lead', label: 'Руководитель проекта' },
  { key: 'pto_manager', label: 'Менеджер ПТО' },
  { key: 'umto_coordinator', label: 'Координатор УМТО' },
];

const roleLabel = (roleKey) => ROLE_OPTIONS.find((item) => item.key === roleKey)?.label || roleKey;

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

function EmployeeSelect({ label, value, onChange, disabled }) {
  const [inputValue, setInputValue] = useState(value?.full_name || '');
  const [options, setOptions] = useState(value ? [value] : []);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setInputValue(value?.full_name || '');
    setOptions(value ? [value] : []);
  }, [value?.employee_code, value?.full_name]);

  useEffect(() => {
    if (disabled) return undefined;
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
        const loaded = Array.isArray(response?.items) ? response.items : [];
        setOptions((current) => {
          const merged = new Map(current.map((item) => [item.employee_code, item]));
          loaded.forEach((item) => merged.set(item.employee_code, item));
          return [...merged.values()];
        });
      } catch (error) {
        if (error?.code !== 'ERR_CANCELED' && error?.name !== 'AbortError') setOptions(value ? [value] : []);
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
              <Typography variant="body2" fontWeight={750}>{option.full_name}</Typography>
              <Typography variant="caption" color="text.secondary">
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
          helperText={value ? `Код ЗУП: ${value.employee_code}` : 'Постоянная роль объекта, не ответственный заявки'}
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
  const [roles, setRoles] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    constructionAPI.getManagement({ signal: controller.signal })
      .then((response) => {
        const managed = (response?.objects || []).find((entry) => entry.id === item?.managed_object_id);
        const fallbackGroups = item?.kind === 'project'
          ? (item?.source_groups?.length
            ? item.source_groups
            : [{ group_ref: item.object_ref, group_name: item.name }])
          : [];
        const selectedGroups = managed?.groups?.length ? managed.groups : fallbackGroups;
        const selectedRoles = {};
        (managed?.team || item?.team || []).forEach((member) => {
          selectedRoles[member.role_key] = member;
        });
        setContext(response || { objects: [], available_groups: [] });
        setName(managed?.name || item?.name || '');
        setGroups(selectedGroups);
        setRoles(selectedRoles);
      })
      .catch((requestError) => {
        if (requestError?.code !== 'ERR_CANCELED' && requestError?.name !== 'AbortError') {
          setError(errorMessage(requestError, 'Не удалось загрузить настройки объектов'));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [item, open]);

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
    const payload = {
      name: normalizedName,
      groups: groups.map(({ group_ref: groupRef, group_name: groupName }) => ({
        group_ref: groupRef,
        group_name: groupName || '',
      })),
      roles: ROLE_OPTIONS
        .filter(({ key }) => roles[key]?.employee_code)
        .map(({ key }) => ({ role_key: key, employee_code: roles[key].employee_code })),
    };
    try {
      const saved = item?.managed_object_id
        ? await constructionAPI.updateManagedObject(item.managed_object_id, payload)
        : await constructionAPI.createManagedObject(payload);
      onSaved(saved);
    } catch (requestError) {
      setError(errorMessage(requestError, 'Не удалось сохранить карточку объекта'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="md" aria-labelledby="construction-settings-title">
      <DialogTitle id="construction-settings-title">
        {item?.managed_object_id ? 'Настройка объекта' : 'Новая карточка объекта'}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField
            autoFocus
            fullWidth
            label="Название объекта"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={loading || saving}
            inputProps={{ maxLength: 255 }}
            sx={{ '& .MuiInputBase-root': { minHeight: 48 } }}
          />
          <Autocomplete
            multiple
            disableCloseOnSelect
            value={groups}
            options={groupOptions}
            disabled={loading || saving}
            onChange={(_event, nextGroups) => setGroups(nextGroups)}
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
                <Box component="li" key={key} {...rest} sx={{ minHeight: 48 }}>
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
                placeholder="Выберите группы одного объекта"
                helperText="Заявки выбранных групп будут собраны в одну карточку"
              />
            )}
          />

          <Divider />
          <Box>
            <Typography variant="subtitle1" fontWeight={850}>Постоянная команда объекта</Typography>
            <Typography variant="body2" color="text.secondary">
              Сотрудники проверяются по стабильному коду ЗУП. Изменение роли сохраняется в истории.
            </Typography>
          </Box>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'repeat(3, minmax(0, 1fr))' },
              gap: 1.5,
            }}
          >
            {ROLE_OPTIONS.map((role) => (
              <EmployeeSelect
                key={role.key}
                label={role.label}
                value={roles[role.key] || null}
                onChange={(employee) => setRoles((current) => ({ ...current, [role.key]: employee }))}
                disabled={loading || saving}
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
        <Button onClick={onClose} disabled={saving} sx={{ minHeight: 44 }}>Отмена</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={loading || saving}
          startIcon={saving ? <CircularProgress size={18} color="inherit" /> : null}
          sx={{ minHeight: 44 }}
        >
          Сохранить объект
        </Button>
      </DialogActions>
    </Dialog>
  );
}
