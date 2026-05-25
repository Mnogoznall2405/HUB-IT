import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, Grid, LinearProgress, Stack, Typography } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { ticketsAPI } from '../../api/tickets';
import { formatDate, formatMoney, getErrorMessage } from './ticketUi';

const Metric = ({ label, value }) => (
  <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5, minHeight: 86 }}>
    <Typography variant="caption" color="text.secondary">{label}</Typography>
    <Typography variant="h5" sx={{ mt: 0.5, fontWeight: 700 }}>{value}</Typography>
  </Box>
);

export default function TicketDashboard({ onFilterObject }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await ticketsAPI.getDashboard());
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const metrics = data?.metrics || {};

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Box>
          <Typography variant="h6">Сводка</Typography>
          <Typography variant="body2" color="text.secondary">Данные обновляются при открытии раздела</Typography>
        </Box>
        <Button startIcon={<RefreshIcon />} onClick={load}>Обновить</Button>
      </Stack>
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Grid container spacing={1.5}>
        <Grid item xs={6} md={3}><Metric label="Активные" value={metrics.total_active || 0} /></Grid>
        <Grid item xs={6} md={3}><Metric label="Новые" value={metrics.new || 0} /></Grid>
        <Grid item xs={6} md={3}><Metric label="В работе" value={metrics.in_progress || 0} /></Grid>
        <Grid item xs={6} md={3}><Metric label="Куплены" value={metrics.purchased || 0} /></Grid>
        <Grid item xs={6} md={3}><Metric label="Проблемные" value={metrics.problematic || 0} /></Grid>
        <Grid item xs={6} md={3}><Metric label="Вылет сегодня" value={metrics.departures_today || 0} /></Grid>
        <Grid item xs={6} md={3}><Metric label="Вылет завтра" value={metrics.departures_tomorrow || 0} /></Grid>
        <Grid item xs={6} md={3}><Metric label="Вылет 3 дня" value={metrics.departures_3_days || 0} /></Grid>
        <Grid item xs={6} md={3}><Metric label="Возвраты/обмены" value={metrics.refunds_exchanges || 0} /></Grid>
        <Grid item xs={6} md={3}><Metric label="Сумма билетов" value={formatMoney(metrics.ticket_sum)} /></Grid>
        <Grid item xs={6} md={3}><Metric label="Потери" value={formatMoney(metrics.loss_sum)} /></Grid>
      </Grid>

      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Объекты</Typography>
      <Grid container spacing={1.5}>
        {(data?.per_object || []).map((item) => (
          <Grid item xs={12} md={4} key={item.object_id}>
            <Box
              onClick={() => onFilterObject?.(item.object_id)}
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                p: 1.5,
                cursor: 'pointer',
                height: '100%',
              }}
            >
              <Stack direction="row" justifyContent="space-between" spacing={1}>
                <Box>
                  <Typography variant="subtitle2">{item.object_name}</Typography>
                  <Typography variant="caption" color="text.secondary">{item.object_code}</Typography>
                </Box>
                <Chip size="small" label={item.active} />
              </Stack>
              <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: 'wrap' }}>
                <Chip size="small" label={`Новые ${item.new}`} />
                <Chip size="small" label={`Работа ${item.in_progress}`} />
                <Chip size="small" label={`Проблемы ${item.problematic}`} color={item.problematic ? 'warning' : 'default'} />
              </Stack>
              <Typography variant="body2" sx={{ mt: 1 }}>Билеты: {formatMoney(item.ticket_sum)}</Typography>
              <Typography variant="body2">Потери: {formatMoney(item.loss_sum)}</Typography>
              <Typography variant="caption" color="text.secondary">Ближайший вылет: {formatDate(item.nearest_departure)}</Typography>
            </Box>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={1.5}>
        <Grid item xs={12} md={6}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>Топ проблем</Typography>
          {(data?.top_problems || []).map((item) => (
            <Stack key={item.object_id} direction="row" justifyContent="space-between" sx={{ py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography variant="body2">{item.object_name}</Typography>
              <Chip size="small" color="warning" label={item.problematic} />
            </Stack>
          ))}
        </Grid>
        <Grid item xs={12} md={6}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>Нагрузка</Typography>
          {(data?.top_assignees || []).map((item) => (
            <Stack key={item.assignee_id} direction="row" justifyContent="space-between" sx={{ py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography variant="body2">{item.assignee_name || `#${item.assignee_id}`}</Typography>
              <Chip size="small" label={item.active_count} />
            </Stack>
          ))}
        </Grid>
      </Grid>
    </Stack>
  );
}
