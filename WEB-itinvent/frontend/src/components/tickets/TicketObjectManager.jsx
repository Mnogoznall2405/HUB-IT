import { useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { ticketsAPI } from '../../api/tickets';
import { getErrorMessage } from './ticketUi';

export default function TicketObjectManager({
  open = false,
  onClose,
  objects = [],
  canWrite = false,
  isAdmin = false,
  onChanged,
}) {
  const [form, setForm] = useState({ code: '', name: '', region: '' });
  const [error, setError] = useState('');

  const create = async () => {
    setError('');
    try {
      await ticketsAPI.createObject(form);
      setForm({ code: '', name: '', region: '' });
      onChanged?.();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const toggle = async (item) => {
    setError('');
    try {
      await ticketsAPI.updateObject(item.id, { is_active: !item.is_active });
      onChanged?.();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Справочник объектов</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {canWrite && isAdmin ? (
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
              <TextField size="small" label="Код" value={form.code} onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))} />
              <TextField size="small" label="Название" value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} sx={{ flex: 1 }} />
              <TextField size="small" label="Регион" value={form.region} onChange={(event) => setForm((prev) => ({ ...prev, region: event.target.value }))} />
              <Button startIcon={<AddIcon />} variant="contained" onClick={create}>Создать</Button>
            </Stack>
          ) : null}
          {!isAdmin ? <Alert severity="info">Управление объектами доступно только администратору.</Alert> : null}
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Код</TableCell>
                <TableCell>Название</TableCell>
                <TableCell>Регион</TableCell>
                <TableCell>Статус</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {objects.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.code}</TableCell>
                  <TableCell>{item.name}</TableCell>
                  <TableCell>{item.region}</TableCell>
                  <TableCell><Chip size="small" color={item.is_active ? 'success' : 'default'} label={item.is_active ? 'Активен' : 'Отключен'} /></TableCell>
                  <TableCell align="right">
                    {canWrite && isAdmin ? <Button size="small" onClick={() => toggle(item)}>{item.is_active ? 'Отключить' : 'Включить'}</Button> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
}
