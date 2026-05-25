import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material';
import { ticketsAPI } from '../../api/tickets';
import { getErrorMessage } from './ticketUi';

const EMPTY_FORM = {
  employee_id: '',
  employee_name: '',
  object_id: '',
  departure_date: '',
  arrival_date: '',
  route: '',
  total_cost: '',
  is_urgent: false,
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
    setForm(EMPTY_FORM);
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

  const update = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      let employeeId = form.employee_id;
      if (!employeeId && form.employee_name.trim()) {
        const employee = await ticketsAPI.createEmployee({
          full_name: form.employee_name.trim(),
        });
        employeeId = employee.id;
      }
      if (!employeeId) {
        setError('Выберите сотрудника или укажите ФИО нового сотрудника.');
        return;
      }
      if (!form.object_id) {
        setError('Выберите объект.');
        return;
      }
      const created = await ticketsAPI.createRequest({
        employee_id: Number(employeeId),
        object_id: Number(form.object_id),
        departure_date: form.departure_date || null,
        arrival_date: form.arrival_date || null,
        route: form.route.trim() || null,
        total_cost: form.total_cost ? String(form.total_cost) : '0',
        is_urgent: Boolean(form.is_urgent),
        status: 'new',
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
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
            <TextField
              label="Поиск сотрудника"
              value={employeeSearch}
              onChange={(event) => setEmployeeSearch(event.target.value)}
              size="small"
              fullWidth
            />
            <FormControl size="small" fullWidth>
              <InputLabel>Сотрудник</InputLabel>
              <Select
                value={form.employee_id}
                label="Сотрудник"
                onChange={(event) => {
                  update('employee_id', event.target.value);
                  update('employee_name', '');
                }}
              >
                <MenuItem value="">Не выбран</MenuItem>
                {employees.map((item) => (
                  <MenuItem key={item.id} value={String(item.id)}>
                    {item.full_name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
          <TextField
            label="ФИО нового сотрудника"
            value={form.employee_name}
            onChange={(event) => {
              update('employee_name', event.target.value);
              update('employee_id', '');
            }}
            size="small"
            disabled={Boolean(form.employee_id)}
            fullWidth
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
                  {item.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
            <TextField
              label="Дата вылета"
              type="date"
              value={form.departure_date}
              onChange={(event) => update('departure_date', event.target.value)}
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
            <TextField
              label="Стоимость"
              type="number"
              value={form.total_cost}
              onChange={(event) => update('total_cost', event.target.value)}
              size="small"
              fullWidth
            />
          </Stack>
          <TextField
            label="Маршрут"
            value={form.route}
            onChange={(event) => update('route', event.target.value)}
            size="small"
            fullWidth
          />
          <FormControlLabel
            control={(
              <Checkbox
                checked={form.is_urgent}
                onChange={(event) => update('is_urgent', event.target.checked)}
              />
            )}
            label="Срочная заявка"
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
