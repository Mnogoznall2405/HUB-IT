import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  FormControl,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SaveIcon from '@mui/icons-material/Save';
import { ticketsAPI } from '../../api/tickets';
import {
  STATUS_CHANGE_HINTS,
  STATUS_COLORS,
  STATUS_LABELS,
  TICKET_STATUS_OPTIONS,
  formatArrivalRoute,
  formatDate,
  formatMoney,
  getErrorMessage,
} from './ticketUi';

const Info = ({ label, value }) => (
  <Box>
    <Typography variant="caption" color="text.secondary">{label}</Typography>
    <Typography variant="body2" sx={{ fontWeight: 600 }}>{value || '-'}</Typography>
  </Box>
);

export default function TicketRequestCard({
  requestId,
  canWrite = false,
  onClose,
  onChanged,
}) {
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [nextStatus, setNextStatus] = useState('');
  const [statusComment, setStatusComment] = useState('');
  const [form, setForm] = useState({
    note: '',
    total_cost: '',
    refund_loss: '',
    arrival_date: '',
    departure_date: '',
    route: '',
    submitted_at: '',
  });

  const load = useCallback(async () => {
    if (!requestId) return;
    setLoading(true);
    setError('');
    try {
      const requestData = await ticketsAPI.getRequest(requestId);
      setRequest(requestData);
      setNextStatus(requestData.status || '');
      setForm({
        note: requestData.note || '',
        total_cost: requestData.total_cost ?? '',
        refund_loss: requestData.refund_loss ?? '',
        arrival_date: requestData.arrival_date ? String(requestData.arrival_date).slice(0, 10) : '',
        departure_date: requestData.departure_date ? String(requestData.departure_date).slice(0, 10) : '',
        route: requestData.route || '',
        submitted_at: requestData.submitted_at ? String(requestData.submitted_at).slice(0, 10) : '',
      });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    if (!requestId) {
      setRequest(null);
      return;
    }
    void load();
  }, [load, requestId]);

  const saveFields = async () => {
    if (!request) return;
    setSaving(true);
    setError('');
    try {
      await ticketsAPI.updateRequest(request.id, {
        note: form.note,
        total_cost: String(form.total_cost || '0'),
        refund_loss: String(form.refund_loss || '0'),
        arrival_date: form.arrival_date || null,
        departure_date: form.departure_date || null,
        route: form.route.trim() || null,
        submitted_at: form.submitted_at || null,
      });
      if (nextStatus && nextStatus !== request.status) {
        await ticketsAPI.changeStatus(request.id, {
          new_status: nextStatus,
          expected_version: request.version,
          comment: statusComment,
        });
      }
      await load();
      onChanged?.();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      anchor="right"
      open={Boolean(requestId)}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: 420, md: 480 }, p: 2 } }}
    >
      <Stack spacing={2} sx={{ height: '100%' }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            {request ? `Заявка #${request.id}` : 'Заявка'}
          </Typography>
          <IconButton onClick={onClose} aria-label="Закрыть">
            <CloseIcon />
          </IconButton>
        </Stack>

        {loading ? <LinearProgress /> : null}
        {error ? <Alert severity="error">{error}</Alert> : null}

        {request ? (
          <>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
              <Chip
                color={STATUS_COLORS[request.status] || 'default'}
                label={STATUS_LABELS[request.status] || request.status}
              />
              <Typography variant="body2" color="text.secondary">
                {request.employee_name || '-'}
              </Typography>
            </Stack>

            <Stack spacing={1}>
              <Info label="Объект" value={`${request.object_code || ''} ${request.object_name || ''}`.trim()} />
              <Info label="Прибытие / город" value={formatArrivalRoute(request.arrival_date, request.route)} />
            </Stack>

            <Divider />

            {canWrite ? (
              <Stack spacing={2}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Статус</InputLabel>
                  <Select
                    value={nextStatus}
                    label="Статус"
                    onChange={(event) => setNextStatus(event.target.value)}
                  >
                    {TICKET_STATUS_OPTIONS.map((item) => (
                      <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                {STATUS_CHANGE_HINTS[nextStatus] ? (
                  <Typography variant="caption" color="text.secondary">
                    {STATUS_CHANGE_HINTS[nextStatus]}
                  </Typography>
                ) : null}
                <TextField
                  label="Комментарий к смене статуса"
                  value={statusComment}
                  onChange={(event) => setStatusComment(event.target.value)}
                  size="small"
                  multiline
                  minRows={2}
                />
                <TextField
                  label="Дата подачи"
                  type="date"
                  value={form.submitted_at}
                  onChange={(event) => setForm((prev) => ({ ...prev, submitted_at: event.target.value }))}
                  size="small"
                  InputLabelProps={{ shrink: true }}
                  fullWidth
                />
                <TextField
                  label="Дата прибытия"
                  type="date"
                  value={form.arrival_date}
                  onChange={(event) => setForm((prev) => ({ ...prev, arrival_date: event.target.value }))}
                  size="small"
                  InputLabelProps={{ shrink: true }}
                  fullWidth
                />
                <TextField
                  label="Город вылета / маршрут"
                  value={form.route}
                  onChange={(event) => setForm((prev) => ({ ...prev, route: event.target.value }))}
                  size="small"
                  fullWidth
                />
                <TextField
                  label="Примечание"
                  value={form.note}
                  onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
                  size="small"
                  multiline
                  minRows={2}
                  fullWidth
                />
                <TextField
                  label="Стоимость билета"
                  type="number"
                  value={form.total_cost}
                  onChange={(event) => setForm((prev) => ({ ...prev, total_cost: event.target.value }))}
                  size="small"
                  fullWidth
                />
                <TextField
                  label="Возврат (сумма потерь)"
                  type="number"
                  value={form.refund_loss}
                  onChange={(event) => setForm((prev) => ({ ...prev, refund_loss: event.target.value }))}
                  size="small"
                  fullWidth
                />
                <Button
                  variant="contained"
                  startIcon={<SaveIcon />}
                  onClick={saveFields}
                  disabled={saving}
                >
                  Сохранить
                </Button>
              </Stack>
            ) : (
              <Stack spacing={1}>
                <Info label="Дата подачи" value={formatDate(request.submitted_at)} />
                <Info label="Дата прибытия" value={formatDate(request.arrival_date)} />
                <Info label="Маршрут" value={request.route} />
                <Info label="Примечание" value={request.note} />
                <Info label="Стоимость" value={formatMoney(request.total_cost)} />
                <Info label="Возврат" value={formatMoney(request.refund_loss)} />
              </Stack>
            )}
          </>
        ) : null}
      </Stack>
    </Drawer>
  );
}
