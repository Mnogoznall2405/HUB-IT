import { useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, MenuItem, Paper, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { employeeHistoryAPI } from '../../api/employeeHistory';
import { LoadingSpinner } from '../../components/common';

const EMPTY_FILTERS = { date_from: '', date_to: '', direction: 'all', q: '' };
const value = (text) => String(text ?? '').trim() || '—';
const person = (name, id) => name || (id ? `ID ${id}` : 'Без владельца');
const eventDate = (date) => {
  if (!date) return 'Дата не указана';
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? value(date) : parsed.toLocaleString('ru-RU');
};

function EmployeeHistoryContent({ ownerNo, databaseId, active, isMobile, onOpenInvNo }) {
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [request, setRequest] = useState({ ...EMPTY_FILTERS, page: 1, retry: 0 });
  const [result, setResult] = useState({ rows: [], total: 0, loading: false, error: '' });
  const loadedRequest = useRef(null);
  const invalidDates = Boolean(draft.date_from && draft.date_to && draft.date_from > draft.date_to);

  useEffect(() => {
    if (!active || !ownerNo || loadedRequest.current === request) return undefined;
    const controller = new AbortController();
    setResult((prev) => ({
      rows: request.page === 1 ? [] : prev.rows,
      total: request.page === 1 ? 0 : prev.total,
      loading: true,
      error: '',
    }));
    const { retry: _retry, ...params } = request;
    employeeHistoryAPI.getHistory(ownerNo, {
      ...params,
      date_from: params.date_from || undefined,
      date_to: params.date_to || undefined,
      limit: 50,
      dbId: databaseId,
      signal: controller.signal,
    }).then((data) => {
      if (controller.signal.aborted) return;
      if (!Array.isArray(data?.history) || !Number.isInteger(data?.total)) {
        throw new Error('Invalid employee history response');
      }
      loadedRequest.current = request;
      setResult((prev) => ({
        rows: request.page === 1 ? data.history : [...prev.rows, ...data.history],
        total: data.total, loading: false, error: '',
      }));
    }).catch(() => {
      if (controller.signal.aborted) return;
      setResult((prev) => ({ ...prev, loading: false, error: 'Не удалось загрузить историю перемещений.' }));
    });
    return () => controller.abort();
  }, [active, ownerNo, databaseId, request]);

  if (!ownerNo) {
    return <Alert severity="info">Сотрудник не найден в справочнике ITinvent. История недоступна.</Alert>;
  }
  const filtered = Boolean(request.date_from || request.date_to || request.q || request.direction !== 'all');
  const patch = (key) => (event) => setDraft((prev) => ({ ...prev, [key]: event.target.value }));
  const equipment = (row) => (
    <>
      <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
        {[row.type_name, row.model_name].filter(Boolean).join(' / ') || 'Техника не указана'}
      </Typography>
      {row.current_inv_no && onOpenInvNo ? (
        <Button size="small" sx={{ p: 0, minWidth: 0, textAlign: 'left' }}
          aria-label={`Открыть технику ${value(row.inv_no)}`}
          onClick={() => onOpenInvNo(row.current_inv_no, { databaseId })}>
          Инв. № {value(row.inv_no)}
        </Button>
      ) : <Typography variant="body2">Инв. № {value(row.inv_no)}</Typography>}
      <Typography variant="caption" sx={{ display: 'block', overflowWrap: 'anywhere' }}>
        Сер. № {value(row.serial_no)}
      </Typography>
      {!row.current_inv_no && <Typography variant="caption" color="text.secondary">Карточка техники недоступна</Typography>}
    </>
  );
  const transition = (row) => `${person(row.old_employee_name, row.old_employee_no)} → ${person(row.new_employee_name, row.new_employee_no)}`;
  const direction = (row) => <Chip size="small" label={row.direction === 'incoming' ? 'Приход' : 'Уход'}
    color={row.direction === 'incoming' ? 'success' : 'warning'} variant="outlined" />;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 1.5 }}>
      <Box component="form" onSubmit={(event) => {
        event.preventDefault();
        if (!invalidDates) setRequest({ ...draft, q: draft.q.trim(), page: 1, retry: 0 });
      }}>
        <Stack direction="row" useFlexGap flexWrap="wrap" gap={1}>
          <TextField label="Дата с" type="date" size="small" value={draft.date_from} onChange={patch('date_from')}
            InputLabelProps={{ shrink: true }} sx={{ flex: '1 1 150px' }} />
          <TextField label="Дата по" type="date" size="small" value={draft.date_to} onChange={patch('date_to')}
            InputLabelProps={{ shrink: true }} error={invalidDates} sx={{ flex: '1 1 150px' }} />
          <TextField label="Направление" select size="small" value={draft.direction} onChange={patch('direction')}
            sx={{ flex: '1 1 145px' }}>
            <MenuItem value="all">Все</MenuItem><MenuItem value="incoming">Приход</MenuItem><MenuItem value="outgoing">Уход</MenuItem>
          </TextField>
          <TextField label="Модель или номер техники" size="small" value={draft.q} onChange={patch('q')}
            inputProps={{ maxLength: 200 }} sx={{ flex: '2 1 220px' }} />
          <Button type="submit" variant="outlined" disabled={invalidDates}>Применить</Button>
          <Button onClick={() => { setDraft(EMPTY_FILTERS); setRequest({ ...EMPTY_FILTERS, page: 1, retry: 0 }); }}>Сбросить</Button>
        </Stack>
        {invalidDates && <Typography color="error" variant="caption">Дата начала должна быть не позже даты окончания.</Typography>}
      </Box>
      <Box role="tabpanel" id="employee-history-panel" aria-labelledby="employee-history-tab"
        aria-busy={result.loading} sx={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
        {result.error && <Alert severity="error" action={<Button color="inherit" onClick={() => {
          setRequest((prev) => ({ ...prev, retry: prev.retry + 1 }));
        }}>Повторить</Button>}>{result.error}</Alert>}
        {result.loading && <LoadingSpinner message="Загрузка истории..." />}
        {!result.loading && !result.error && result.rows.length === 0 && (
          <Typography color="text.secondary">{filtered ? 'По выбранным фильтрам перемещений не найдено.' : 'История перемещений сотрудника пока пустая.'}</Typography>
        )}
        {result.rows.length > 0 && (isMobile ? (
          <Stack gap={1}>
            {result.rows.map((row) => <Paper key={row.hist_id} variant="outlined" sx={{ p: 1.5, overflowWrap: 'anywhere' }}>
              <Stack direction="row" justifyContent="space-between" gap={1} sx={{ mb: 1 }}>
                <Typography variant="body2">{eventDate(row.ch_date)}</Typography>{direction(row)}
              </Stack>
              {equipment(row)}
              <Typography variant="body2" sx={{ mt: 1 }}>{transition(row)}</Typography>
              <Typography variant="body2" color="text.secondary">{value(row.branch_name)} / {value(row.location_name)}</Typography>
              <Typography variant="caption">Пользователь: {value(row.ch_user)}</Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{value(row.ch_comment)}</Typography>
            </Paper>)}
          </Stack>
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small" aria-label="История перемещений сотрудника">
              <TableHead><TableRow>{['Дата', 'Направление', 'Техника', 'От кого → кому', 'Филиал / Локация', 'Пользователь', 'Комментарий'].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead>
              <TableBody>{result.rows.map((row) => <TableRow key={row.hist_id} hover>
                <TableCell>{eventDate(row.ch_date)}</TableCell><TableCell>{direction(row)}</TableCell>
                <TableCell>{equipment(row)}</TableCell><TableCell>{transition(row)}</TableCell>
                <TableCell>{value(row.branch_name)} / {value(row.location_name)}</TableCell>
                <TableCell>{value(row.ch_user)}</TableCell>
                <TableCell sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxWidth: 250 }}>{value(row.ch_comment)}</TableCell>
              </TableRow>)}</TableBody>
            </Table>
          </TableContainer>
        ))}
        {result.rows.length > 0 && <Stack direction="row" alignItems="center" gap={1} sx={{ mt: 1 }}>
          <Typography variant="caption">Показано {result.rows.length} из {result.total}</Typography>
          {result.rows.length < result.total && !result.error && <Button disabled={result.loading}
            onClick={() => setRequest((prev) => ({ ...prev, page: prev.page + 1 }))}>Показать ещё</Button>}
        </Stack>}
      </Box>
    </Box>
  );
}

export default function EmployeeHistoryPanel(props) {
  const [databaseId, setDatabaseId] = useState(() => localStorage.getItem('selected_database') || '');
  useEffect(() => {
    const changed = () => setDatabaseId(localStorage.getItem('selected_database') || '');
    window.addEventListener('database-changed', changed);
    return () => window.removeEventListener('database-changed', changed);
  }, []);
  return <EmployeeHistoryContent key={`${props.ownerNo}-${databaseId}`} {...props} databaseId={databaseId} />;
}
