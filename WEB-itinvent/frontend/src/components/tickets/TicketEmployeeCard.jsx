import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  LinearProgress,
  Stack,
  TextField,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import { ticketsAPI } from '../../api/tickets';
import {
  getErrorMessage,
  isMaskedPersonalValue,
  toDateInputValue,
} from './ticketUi';

const EMPTY_FORM = {
  full_name: '',
  department: '',
  position: '',
  phone: '',
  email: '',
  date_of_birth: '',
  passport_series: '',
  passport_number: '',
  issued_by: '',
  issuer_code: '',
  issue_date: '',
  birth_place: '',
  registration_address: '',
};

const pickCurrentDocument = (documents = []) => (
  documents.find((item) => item.is_current) || documents[0] || null
);

const buildFormFromEmployee = (employee, canReadPersonal) => {
  if (!employee || !canReadPersonal) {
    return { ...EMPTY_FORM, full_name: employee?.full_name || '' };
  }
  const document = pickCurrentDocument(employee.documents);
  return {
    full_name: employee.full_name || '',
    department: employee.department || '',
    position: employee.position || '',
    phone: employee.phone || '',
    email: employee.email || '',
    date_of_birth: toDateInputValue(employee.date_of_birth),
    passport_series: isMaskedPersonalValue(document?.passport_series)
      ? ''
      : (document?.passport_series || ''),
    passport_number: isMaskedPersonalValue(document?.passport_number)
      ? ''
      : (document?.passport_number || ''),
    issued_by: isMaskedPersonalValue(document?.issued_by) ? '' : (document?.issued_by || ''),
    issuer_code: isMaskedPersonalValue(document?.issuer_code) ? '' : (document?.issuer_code || ''),
    issue_date: toDateInputValue(document?.issue_date),
    birth_place: isMaskedPersonalValue(document?.birth_place) ? '' : (document?.birth_place || ''),
    registration_address: isMaskedPersonalValue(document?.registration_address)
      ? ''
      : (document?.registration_address || ''),
  };
};

const hasPassportInput = (form) => (
  Boolean(
    form.passport_series.trim()
    || form.passport_number.trim()
    || form.issued_by.trim()
    || form.issue_date
    || form.registration_address.trim()
    || form.issuer_code.trim()
    || form.birth_place.trim(),
  )
);

export default function TicketEmployeeCard({
  open = false,
  onClose,
  canWrite = false,
  canReadPersonal = false,
  onChanged,
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const canEditPersonal = canWrite && canReadPersonal;

  const loadEmployees = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setError('');
    try {
      const data = await ticketsAPI.listEmployees({
        search: employeeSearch.trim(),
        page_size: 50,
      });
      setEmployees(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [employeeSearch, open]);

  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(loadEmployees, employeeSearch.trim() ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [employeeSearch, loadEmployees, open]);

  useEffect(() => {
    if (!open) {
      setForm(EMPTY_FORM);
      setSelectedId(null);
      setSelectedDocumentId(null);
      setError('');
      setSuccess('');
      setEmployeeSearch('');
    }
  }, [open]);

  const selectedEmployeeOption = useMemo(
    () => employees.find((item) => item.id === selectedId) || null,
    [employees, selectedId],
  );

  const openEmployee = async (id) => {
    setError('');
    setSuccess('');
    try {
      const employee = await ticketsAPI.getEmployee(id);
      setSelectedId(employee.id);
      const document = pickCurrentDocument(employee.documents);
      setSelectedDocumentId(document?.id || null);
      setForm(buildFormFromEmployee(employee, canReadPersonal));
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const save = async () => {
    if (!form.full_name.trim()) {
      setError('Укажите ФИО сотрудника.');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const payload = {
        full_name: form.full_name.trim(),
        department: form.department.trim() || null,
        position: form.position.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
      };
      if (canEditPersonal) {
        if (form.date_of_birth) {
          payload.date_of_birth = form.date_of_birth;
        }
        if (hasPassportInput(form)) {
          const documentPayload = {
            passport_series: form.passport_series.trim(),
            passport_number: form.passport_number.trim(),
            issued_by: form.issued_by.trim(),
            issuer_code: form.issuer_code.trim(),
            birth_place: form.birth_place.trim(),
            issue_date: form.issue_date,
            registration_address: form.registration_address.trim(),
          };
          if (selectedDocumentId) {
            documentPayload.id = selectedDocumentId;
          }
          payload.documents = [documentPayload];
        }
      }

      const employee = selectedId
        ? await ticketsAPI.updateEmployee(selectedId, payload)
        : await ticketsAPI.createEmployee(payload);

      const document = pickCurrentDocument(employee.documents);
      setSelectedId(employee.id);
      setSelectedDocumentId(document?.id || null);
      setForm(buildFormFromEmployee(employee, canReadPersonal));
      setSuccess(selectedId ? 'Данные сотрудника сохранены.' : 'Сотрудник создан.');
      onChanged?.();
      await loadEmployees();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>{selectedId ? 'Карточка сотрудника' : 'Добавить сотрудника'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {loading ? <LinearProgress /> : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
          {success ? <Alert severity="success">{success}</Alert> : null}

          <Autocomplete
            options={employees}
            value={selectedEmployeeOption}
            onChange={(_, value) => {
              if (value?.id) {
                void openEmployee(value.id);
              } else {
                setSelectedId(null);
                setSelectedDocumentId(null);
                setForm(EMPTY_FORM);
              }
            }}
            onInputChange={(_, value) => setEmployeeSearch(value)}
            getOptionLabel={(option) => option.full_name || ''}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            renderInput={(params) => (
              <TextField {...params} label="Найти существующего сотрудника" size="small" />
            )}
          />

          <Grid container spacing={1.5}>
            <Grid item xs={12} md={6}>
              <TextField
                size="small"
                fullWidth
                required
                label="ФИО"
                value={form.full_name}
                onChange={(event) => updateField('full_name', event.target.value)}
                disabled={!canWrite}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                size="small"
                fullWidth
                label="Подразделение"
                value={form.department}
                onChange={(event) => updateField('department', event.target.value)}
                disabled={!canWrite}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                size="small"
                fullWidth
                label="Должность"
                value={form.position}
                onChange={(event) => updateField('position', event.target.value)}
                disabled={!canWrite}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                size="small"
                fullWidth
                label="Телефон"
                value={form.phone}
                onChange={(event) => updateField('phone', event.target.value)}
                disabled={!canWrite}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                size="small"
                fullWidth
                label="Email"
                value={form.email}
                onChange={(event) => updateField('email', event.target.value)}
                disabled={!canWrite}
              />
            </Grid>
          </Grid>

          {canWrite && !canReadPersonal ? (
            <Alert severity="warning">
              Для ввода паспортных данных нужно право «Билеты: персональные данные».
            </Alert>
          ) : null}

          {canEditPersonal ? (
            <Grid container spacing={1.5}>
              <Grid item xs={12} md={3}>
                <TextField
                  size="small"
                  fullWidth
                  label="Дата рождения"
                  type="date"
                  value={form.date_of_birth}
                  onChange={(event) => updateField('date_of_birth', event.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} md={2}>
                <TextField
                  size="small"
                  fullWidth
                  label="Серия"
                  value={form.passport_series}
                  onChange={(event) => updateField('passport_series', event.target.value)}
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <TextField
                  size="small"
                  fullWidth
                  label="Номер"
                  value={form.passport_number}
                  onChange={(event) => updateField('passport_number', event.target.value)}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  size="small"
                  fullWidth
                  label="Дата выдачи"
                  type="date"
                  value={form.issue_date}
                  onChange={(event) => updateField('issue_date', event.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  size="small"
                  fullWidth
                  label="Кем выдан"
                  value={form.issued_by}
                  onChange={(event) => updateField('issued_by', event.target.value)}
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <TextField
                  size="small"
                  fullWidth
                  label="Код подразделения"
                  value={form.issuer_code}
                  onChange={(event) => updateField('issuer_code', event.target.value)}
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <TextField
                  size="small"
                  fullWidth
                  label="Место рождения"
                  value={form.birth_place}
                  onChange={(event) => updateField('birth_place', event.target.value)}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  size="small"
                  fullWidth
                  label="Прописка"
                  value={form.registration_address}
                  onChange={(event) => updateField('registration_address', event.target.value)}
                />
              </Grid>
            </Grid>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Закрыть</Button>
        {canWrite ? (
          <Button variant="contained" startIcon={<SaveIcon />} onClick={save} disabled={saving}>
            Сохранить
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}
