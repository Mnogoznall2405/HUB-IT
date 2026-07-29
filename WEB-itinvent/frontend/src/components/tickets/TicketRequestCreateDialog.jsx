import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  TextField,
  Typography,
  createFilterOptions,
} from '@mui/material';
import { ticketsAPI } from '../../api/tickets';
import {
  formatSettlementRoute,
  settlementOptionLabel,
  settlementOptionSecondary,
} from '../../data/russianCities';
import { getErrorMessage } from './ticketUi';

const todayInputValue = () => new Date().toISOString().slice(0, 10);

const EMPTY_FORM = {
  employee_id: null,
  object_id: '',
  route: '',
};

const zupOptionLabel = (option) => {
  if (!option) return '';
  const parts = [option.full_name];
  if (option.position) parts.push(option.position);
  if (option.department) parts.push(option.department);
  return parts.filter(Boolean).join(' — ');
};

const objectOptionLabel = (option) => {
  if (!option) return '';
  if (option.code && option.name) return `${option.name} (${option.code})`;
  return option.name || option.code || '';
};

const filterObjects = createFilterOptions({
  stringify: (option) => `${option.name || ''} ${option.code || ''}`,
});

export default function TicketRequestCreateDialog({
  open,
  objects = [],
  onClose,
  onCreated,
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [selectedObject, setSelectedObject] = useState(null);
  const [zupOptions, setZupOptions] = useState([]);
  const [localEmployees, setLocalEmployees] = useState([]);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [settlementOptions, setSettlementOptions] = useState([]);
  const [settlementSearch, setSettlementSearch] = useState('');
  const [settlementLoading, setSettlementLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    setForm({ ...EMPTY_FORM });
    setSelectedEmployee(null);
    setSelectedObject(null);
    setEmployeeSearch('');
    setZupOptions([]);
    setLocalEmployees([]);
    setSettlementOptions([]);
    setSettlementSearch('');
    setError('');
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const query = employeeSearch.trim();
    if (query.length < 2) {
      setZupOptions([]);
      setLocalEmployees([]);
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const [zupData, localData] = await Promise.all([
          ticketsAPI.searchZupEmployees({ q: query, limit: 20 }),
          ticketsAPI.listEmployees({ search: query, page_size: 20 }),
        ]);
        if (cancelled) return;
        setZupOptions(Array.isArray(zupData?.items) ? zupData.items : []);
        setLocalEmployees(Array.isArray(localData?.items) ? localData.items : []);
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [employeeSearch, open]);

  useEffect(() => {
    if (!open) return undefined;
    const query = settlementSearch.trim();
    if (query.length < 2) {
      setSettlementOptions([]);
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSettlementLoading(true);
      ticketsAPI.searchSettlements({ q: query, limit: 40 })
        .then((data) => {
          if (cancelled) return;
          setSettlementOptions(Array.isArray(data?.items) ? data.items : []);
        })
        .catch(() => {
          if (!cancelled) setSettlementOptions([]);
        })
        .finally(() => {
          if (!cancelled) setSettlementLoading(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, settlementSearch]);

  const employeeOptions = useMemo(() => {
    const localCodes = new Set(
      localEmployees
        .map((item) => String(item.zup_employee_code || '').trim())
        .filter(Boolean),
    );
    const localNames = new Set(
      localEmployees.map((item) => String(item.full_name || '').trim().toLowerCase()).filter(Boolean),
    );
    const zupOnly = zupOptions
      .filter((item) => {
        const code = String(item.employee_code || '').trim();
        const name = String(item.full_name || '').trim().toLowerCase();
        if (code && localCodes.has(code)) return false;
        if (name && localNames.has(name)) return false;
        return Boolean(item.full_name);
      })
      .map((item) => ({ ...item, _source: 'zup' }));

    return [
      ...localEmployees.map((item) => ({ ...item, _source: 'local' })),
      ...zupOnly,
    ];
  }, [localEmployees, zupOptions]);

  const activeObjects = useMemo(
    () => objects.filter((item) => item.is_active !== false),
    [objects],
  );

  const update = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const selectEmployee = async (value) => {
    if (!value) {
      setSelectedEmployee(null);
      update('employee_id', null);
      return;
    }
    if (value._source === 'local' && value.id) {
      setSelectedEmployee(value);
      update('employee_id', value.id);
      return;
    }
    if (!value.employee_code) {
      setError('У выбранного сотрудника ЗУП нет кода.');
      return;
    }
    setImporting(true);
    setError('');
    try {
      const employee = await ticketsAPI.ensureEmployeeFromZup(value.employee_code);
      setSelectedEmployee({ ...employee, _source: 'local' });
      update('employee_id', employee.id);
    } catch (err) {
      setError(getErrorMessage(err) || 'Не удалось импортировать сотрудника из ЗУП.');
      setSelectedEmployee(null);
      update('employee_id', null);
    } finally {
      setImporting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      if (!form.employee_id) {
        setError('Выберите сотрудника из ЗУП или уже добавленного.');
        return;
      }
      if (!form.object_id) {
        setError('Выберите объект.');
        return;
      }
      const created = await ticketsAPI.createRequest({
        employee_id: Number(form.employee_id),
        object_id: Number(form.object_id),
        submitted_at: todayInputValue(),
        route: form.route.trim() || null,
        status: 'not_started',
        source: 'manual',
      });
      onCreated?.(created);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving || importing ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>Создать заявку</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {loading || importing ? <LinearProgress /> : null}
          {error ? <Alert severity="error">{error}</Alert> : null}

          <Autocomplete
            options={employeeOptions}
            value={selectedEmployee}
            filterOptions={(options) => options}
            onChange={(_, value) => {
              void selectEmployee(value);
            }}
            onInputChange={(_, value, reason) => {
              if (reason === 'input' || reason === 'clear') {
                setEmployeeSearch(value);
              }
            }}
            getOptionLabel={(option) => (
              option._source === 'zup' ? zupOptionLabel(option) : (option.full_name || '')
            )}
            isOptionEqualToValue={(option, value) => {
              if (option._source === 'zup' || value._source === 'zup') {
                return option.employee_code === value.employee_code
                  || option.zup_employee_code === value.employee_code
                  || option.employee_code === value.zup_employee_code;
              }
              return option.id === value.id;
            }}
            renderOption={(props, option) => (
              <li {...props} key={`${option._source}-${option.id || option.employee_code || option.full_name}`}>
                <Stack spacing={0.25}>
                  <Typography variant="body2">{option.full_name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {option._source === 'zup'
                      ? ['ЗУП', option.position, option.department].filter(Boolean).join(' · ')
                      : ['В билетах', option.position, option.department].filter(Boolean).join(' · ')}
                  </Typography>
                </Stack>
              </li>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Сотрудник"
                size="small"
                required
                helperText="Сначала ищите в ЗУП — сотрудник подтянется сам. Вручную добавляйте только тех, кого нет в ЗУП."
              />
            )}
            noOptionsText={employeeSearch.trim().length < 2 ? 'Введите минимум 2 символа' : 'Никого не найдено'}
          />

          <Autocomplete
            options={activeObjects}
            value={selectedObject}
            filterOptions={filterObjects}
            onChange={(_, value) => {
              setSelectedObject(value);
              update('object_id', value?.id ? String(value.id) : '');
            }}
            getOptionLabel={objectOptionLabel}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            renderOption={(props, option) => (
              <li {...props} key={option.id}>
                <Stack spacing={0.25}>
                  <Typography variant="body2">{option.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Код: {option.code || '—'}
                  </Typography>
                </Stack>
              </li>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Объект"
                size="small"
                required
                helperText="Начните вводить название или код объекта"
              />
            )}
            noOptionsText="Объект не найден"
          />

          <Autocomplete
            freeSolo
            options={settlementOptions}
            value={form.route}
            filterOptions={(options) => options}
            loading={settlementLoading}
            getOptionLabel={settlementOptionLabel}
            isOptionEqualToValue={(option, value) => {
              const left = typeof option === 'string' ? option : option?.name;
              const right = typeof value === 'string' ? value : value?.name;
              return left === right;
            }}
            onChange={(_, value) => {
              const route = formatSettlementRoute(value);
              update('route', route);
              setSettlementSearch(typeof value === 'string' ? value : (value?.name || ''));
            }}
            onInputChange={(_, value, reason) => {
              if (reason === 'input' || reason === 'clear') {
                update('route', value || '');
                setSettlementSearch(value || '');
              }
            }}
            renderOption={(props, option) => (
              <li {...props} key={`${option.name}-${option.type}-${option.region}`}>
                <Stack spacing={0.25}>
                  <Typography variant="body2">{option.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {settlementOptionSecondary(option) || 'Россия'}
                  </Typography>
                </Stack>
              </li>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Город / населённый пункт вылета"
                size="small"
                helperText="Поиск по городам, посёлкам, сёлам и деревням России"
              />
            )}
            noOptionsText={
              settlementSearch.trim().length < 2
                ? 'Введите минимум 2 символа'
                : 'Не найдено — можно ввести свой вариант'
            }
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving || importing}>Отмена</Button>
        <Button variant="contained" onClick={save} disabled={saving || importing}>Создать</Button>
      </DialogActions>
    </Dialog>
  );
}
