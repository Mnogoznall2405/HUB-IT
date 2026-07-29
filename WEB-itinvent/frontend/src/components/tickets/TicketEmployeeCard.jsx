import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Button,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  LinearProgress,
  Stack,
  TextField,
  Typography,
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
    return {
      ...EMPTY_FORM,
      full_name: employee?.full_name || '',
      department: employee?.department || '',
      position: employee?.position || '',
      phone: employee?.phone || '',
      email: employee?.email || '',
    };
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

const zupOptionLabel = (option) => {
  if (!option) return '';
  const parts = [option.full_name];
  if (option.position) parts.push(option.position);
  if (option.department) parts.push(option.department);
  return parts.filter(Boolean).join(' — ');
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
  const [zupOptions, setZupOptions] = useState([]);
  const [zupSearch, setZupSearch] = useState('');
  const [zupSelected, setZupSelected] = useState(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [zupLoading, setZupLoading] = useState(false);
  const [importing, setImporting] = useState(false);
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
    if (!open || !canWrite) {
      setZupOptions([]);
      return undefined;
    }
    const query = zupSearch.trim();
    if (query.length < 2) {
      setZupOptions([]);
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setZupLoading(true);
      ticketsAPI.searchZupEmployees({ q: query, limit: 20 })
        .then((data) => {
          if (cancelled) return;
          setZupOptions(Array.isArray(data?.items) ? data.items : []);
        })
        .catch((err) => {
          if (cancelled) return;
          setZupOptions([]);
          setError(getErrorMessage(err) || 'Не удалось загрузить сотрудников из ЗУП.');
        })
        .finally(() => {
          if (!cancelled) setZupLoading(false);
        });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [canWrite, open, zupSearch]);

  useEffect(() => {
    if (!open) {
      setForm(EMPTY_FORM);
      setSelectedId(null);
      setSelectedDocumentId(null);
      setError('');
      setSuccess('');
      setEmployeeSearch('');
      setZupSearch('');
      setZupSelected(null);
      setZupOptions([]);
      setManualOpen(false);
    }
  }, [open]);

  const selectedEmployeeOption = useMemo(
    () => employees.find((item) => item.id === selectedId) || null,
    [employees, selectedId],
  );

  const applyEmployee = (employee, message) => {
    const document = pickCurrentDocument(employee.documents);
    setSelectedId(employee.id);
    setSelectedDocumentId(document?.id || null);
    setForm(buildFormFromEmployee(employee, canReadPersonal));
    setManualOpen(true);
    setSuccess(message);
  };

  const openEmployee = async (id) => {
    setError('');
    setSuccess('');
    setZupSelected(null);
    setZupSearch('');
    try {
      const employee = await ticketsAPI.getEmployee(id);
      applyEmployee(employee, '');
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const importFromZup = async (person) => {
    if (!person?.employee_code) {
      setError('У выбранного сотрудника ЗУП нет кода.');
      return;
    }
    setImporting(true);
    setError('');
    setSuccess('');
    try {
      const employee = await ticketsAPI.ensureEmployeeFromZup(person.employee_code);
      setZupSelected(person);
      applyEmployee(
        employee,
        canReadPersonal
          ? 'Сотрудник взят из ЗУП вместе с паспортными данными. Проверьте и при необходимости сохраните правки.'
          : 'Сотрудник взят из ЗУП. Паспортные данные доступны только с правом на персональные данные.',
      );
      onChanged?.();
      await loadEmployees();
    } catch (err) {
      setError(getErrorMessage(err) || 'Не удалось импортировать сотрудника из ЗУП.');
    } finally {
      setImporting(false);
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

      applyEmployee(
        employee,
        selectedId ? 'Данные сотрудника сохранены.' : 'Сотрудник создан вручную.',
      );
      onChanged?.();
      await loadEmployees();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving || importing ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>Сотрудники</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {loading || zupLoading || importing ? <LinearProgress /> : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
          {success ? <Alert severity="success">{success}</Alert> : null}

          {canWrite ? (
            <Autocomplete
              options={zupOptions}
              value={zupSelected}
              filterOptions={(options) => options}
              onChange={(_, value) => {
                if (value) {
                  void importFromZup(value);
                } else {
                  setZupSelected(null);
                }
              }}
              onInputChange={(_, value, reason) => {
                if (reason === 'input' || reason === 'clear') {
                  setZupSearch(value);
                }
              }}
              getOptionLabel={zupOptionLabel}
              isOptionEqualToValue={(option, value) => (
                (option.employee_code && option.employee_code === value.employee_code)
                || option.full_name === value.full_name
              )}
              renderOption={(props, option) => (
                <li {...props} key={option.employee_code || option.full_name}>
                  <Stack spacing={0.25}>
                    <Typography variant="body2">{option.full_name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {[option.position, option.department].filter(Boolean).join(' · ') || 'ЗУП'}
                    </Typography>
                  </Stack>
                </li>
              )}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Взять из ЗУП"
                  size="small"
                  helperText="Если сотрудник есть в ЗУП — выбирайте здесь. Он сразу попадёт в базу билетов с данными из ЗУП."
                />
              )}
              noOptionsText={zupSearch.trim().length < 2 ? 'Введите минимум 2 символа' : 'Никого не найдено в ЗУП'}
            />
          ) : null}

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
              <TextField {...params} label="Уже добавленные в билеты" size="small" />
            )}
          />

          {canWrite ? (
            <Button
              size="small"
              onClick={() => {
                setManualOpen((prev) => !prev);
                if (!manualOpen) {
                  setSelectedId(null);
                  setSelectedDocumentId(null);
                  setZupSelected(null);
                  setForm(EMPTY_FORM);
                  setSuccess('');
                }
              }}
            >
              {manualOpen ? 'Скрыть ручное добавление' : 'Добавить вручную (если нет в ЗУП)'}
            </Button>
          ) : null}

          <Collapse in={manualOpen || Boolean(selectedId)}>
            <Stack spacing={2}>
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
                  Для паспортных данных нужно право «Билеты: персональные данные».
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
          </Collapse>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving || importing}>Закрыть</Button>
        {canWrite && (manualOpen || selectedId) ? (
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={save}
            disabled={saving || importing}
          >
            Сохранить
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}
