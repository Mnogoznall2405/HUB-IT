import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Chip, LinearProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import { ticketsAPI } from '../../api/tickets';
import { formatDate, getErrorMessage } from './ticketUi';

export default function TicketEmployeeCard({ canWrite = false }) {
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ full_name: '', phone: '', email: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await ticketsAPI.listEmployees({ search, page_size: 25 });
      setRows(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const timer = window.setTimeout(load, search.trim() ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  const openEmployee = async (id) => {
    setSelected(await ticketsAPI.getEmployee(id));
  };

  const create = async () => {
    try {
      const employee = await ticketsAPI.createEmployee(form);
      setForm({ full_name: '', phone: '', email: '' });
      setSelected(employee);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
        <TextField size="small" label="Поиск сотрудника" value={search} onChange={(event) => setSearch(event.target.value)} InputProps={{ endAdornment: <SearchIcon fontSize="small" /> }} />
        {canWrite ? (
          <>
            <TextField size="small" label="ФИО" value={form.full_name} onChange={(event) => setForm((prev) => ({ ...prev, full_name: event.target.value }))} sx={{ flex: 1 }} />
            <TextField size="small" label="Телефон" value={form.phone} onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} />
            <TextField size="small" label="Email" value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} />
            <Button startIcon={<AddIcon />} variant="contained" onClick={create}>Создать</Button>
          </>
        ) : null}
      </Stack>
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>ФИО</TableCell>
            <TableCell>Телефон</TableCell>
            <TableCell>Email</TableCell>
            <TableCell>Статус</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((item) => (
            <TableRow key={item.id} hover onClick={() => openEmployee(item.id)} sx={{ cursor: 'pointer' }}>
              <TableCell>{item.full_name}</TableCell>
              <TableCell>{item.phone || '-'}</TableCell>
              <TableCell>{item.email || '-'}</TableCell>
              <TableCell><Chip size="small" label={item.status} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {selected ? (
        <Alert severity="info">
          {selected.full_name}. Документы: {(selected.documents || []).map((doc) => `${doc.doc_type || 'документ'} ${formatDate(doc.issue_date)}`).join(', ') || 'нет'}
        </Alert>
      ) : null}
    </Stack>
  );
}
