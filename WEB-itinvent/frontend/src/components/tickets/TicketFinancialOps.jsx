import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, FormControl, InputLabel, LinearProgress, MenuItem, Select, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { ticketsAPI } from '../../api/tickets';
import { FIN_OP_TYPES, formatDate, formatMoney, getErrorMessage } from './ticketUi';

export default function TicketFinancialOps({ objects = [], canWrite = false }) {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ op_type: 'loss', amount: '', object_id: '', reason: '', refund_status: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await ticketsAPI.listFinancialOps({ page_size: 50 });
      setRows(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!canWrite) return;
    try {
      await ticketsAPI.createFinancialOp({
        ...form,
        object_id: form.object_id || null,
        amount: form.amount || '0.00',
      });
      setForm({ op_type: 'loss', amount: '', object_id: '', reason: '', refund_status: '' });
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const remove = async (id) => {
    await ticketsAPI.deleteFinancialOp(id);
    await load();
  };

  return (
    <Stack spacing={2}>
      {canWrite ? (
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Тип</InputLabel>
            <Select value={form.op_type} label="Тип" onChange={(event) => setForm((prev) => ({ ...prev, op_type: event.target.value }))}>
              {FIN_OP_TYPES.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField size="small" label="Сумма" value={form.amount} onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))} />
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel>Объект</InputLabel>
            <Select value={form.object_id} label="Объект" onChange={(event) => setForm((prev) => ({ ...prev, object_id: event.target.value }))}>
              <MenuItem value="">Не указан</MenuItem>
              {objects.map((item) => <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField size="small" label="Причина" value={form.reason} onChange={(event) => setForm((prev) => ({ ...prev, reason: event.target.value }))} sx={{ flex: 1 }} />
          <Button startIcon={<AddIcon />} variant="contained" onClick={create}>Добавить</Button>
        </Stack>
      ) : null}
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Дата</TableCell>
            <TableCell>Тип</TableCell>
            <TableCell>Объект</TableCell>
            <TableCell align="right">Сумма</TableCell>
            <TableCell>Причина</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{formatDate(row.op_date || row.created_at)}</TableCell>
              <TableCell>{row.op_type}</TableCell>
              <TableCell>{row.object_id || '-'}</TableCell>
              <TableCell align="right">{formatMoney(row.amount)}</TableCell>
              <TableCell>{row.reason || '-'}</TableCell>
              <TableCell align="right">{canWrite ? <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={() => remove(row.id)}>Удалить</Button> : null}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Stack>
  );
}
