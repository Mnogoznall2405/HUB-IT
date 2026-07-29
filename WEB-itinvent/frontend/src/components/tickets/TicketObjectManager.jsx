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
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    if (!name.trim()) {
      setError('Укажите название объекта.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await ticketsAPI.createObject({ name: name.trim() });
      setName('');
      onChanged?.();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
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
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>Справочник объектов</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {canWrite && isAdmin ? (
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
              <TextField
                size="small"
                label="Название"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void create();
                  }
                }}
                sx={{ flex: 1 }}
                helperText="Код присвоится автоматически"
              />
              <Button
                startIcon={<AddIcon />}
                variant="contained"
                onClick={create}
                disabled={saving}
              >
                Создать
              </Button>
            </Stack>
          ) : null}
          {!isAdmin ? <Alert severity="info">Управление объектами доступно только администратору.</Alert> : null}
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Код</TableCell>
                <TableCell>Название</TableCell>
                <TableCell>Статус</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {objects.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.code}</TableCell>
                  <TableCell>{item.name}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={item.is_active ? 'success' : 'default'}
                      label={item.is_active ? 'Активен' : 'Отключен'}
                    />
                  </TableCell>
                  <TableCell align="right">
                    {canWrite && isAdmin ? (
                      <Button size="small" onClick={() => toggle(item)}>
                        {item.is_active ? 'Отключить' : 'Включить'}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
}
