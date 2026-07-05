import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material';
import { ticketsAPI } from '../../api/tickets';
import { getErrorMessage } from './ticketUi';

const todayInputValue = () => new Date().toISOString().slice(0, 10);

const EMPTY_FORM = {
  employee_id: null,
  object_id: '',
  submitted_at: todayInputValue(),
  arrival_date: '',
  route: '',
};

export default function TicketRequestCreateDialog({
  open,
  objects = [],
  onClose,
  onCreated,
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [employees, setEmployees] = useState([]);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    setForm({ ...EMPTY_FORM, submitted_at: todayInputValue() });
    setEmployeeSearch('');
    setError('');
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const data = await ticketsAPI.listEmployees({
          search: employeeSearch.trim(),
          page_size: 50,
        });
        if (!cancelled) {
          setEmployees(Array.isArray(data?.items) ? data.items : []);
        }
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, employeeSearch.trim() ? 300 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [employeeSearch, open]);

  const activeObjects = useMemo(
    () => objects.filter((item) => item.is_active !== false),
    [objects],
  );

  const selectedEmployee = useMemo(
    () => employees.find((item) => item.id === form.employee_id) || null,
    [employees, form.employee_id],
  );

  const update = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      if (!form.employee_id) {
        setError('Выберите сотрудника.');
        return;
      }
      if (!form.object_id) {
        setError('Выберите объект.');
        return;
      }
      const created = await ticketsAPI.createRequest({
        employee_id: Number(form.employee_id),
        object_id: Number(form.object_id),
        submitted_at: form.submitted_at || todayInputValue(),
        arrival_date: form.arrival_date || null,
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
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>Создать заявку</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {loading ? <LinearProgress /> : null}
          {error ? <Alert severity="error">{error}</Alert> : null}

          <Autocomplete
            options={employees}
            value={selectedEmployee}
            onChange={(_, value) => update('employee_id', value?.id || null)}
            onInputChange={(_, value) => setEmployeeSearch(value)}
            getOptionLabel={(option) => option.full_name || ''}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            renderInput={(params) => (
              <TextField {...params} label="Сотрудник" size="small" required />
            )}
          />

          <FormControl size="small" fullWidth>
            <InputLabel>Объект</InputLabel>
            <Select
              value={form.object_id}
              label="Объект"
              onChange={(event) => update('object_id', event.target.value)}
            >
              {activeObjects.map((item) => (
                <MenuItem key={item.id} value={String(item.id)}>
                  {item.code} — {item.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
            <TextField
              label="Дата подачи"
              type="date"
              value={form.submitted_at}
              onChange={(event) => update('submitted_at', event.target.value)}
              size="small"
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
            <TextField
              label="Дата прибытия"
              type="date"
              value={form.arrival_date}
              onChange={(event) => update('arrival_date', event.target.value)}
              size="small"
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
          </Stack>

          <TextField
            label="Город вылета / купить билет из города"
            value={form.route}
            onChange={(event) => update('route', event.target.value)}
            size="small"
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Отмена</Button>
        <Button variant="contained" onClick={save} disabled={saving}>Создать</Button>
      </DialogActions>
    </Dialog>
  );
}
