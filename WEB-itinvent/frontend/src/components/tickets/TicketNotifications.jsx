import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  LinearProgress,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { ticketsAPI } from '../../api/tickets';
import { getErrorMessage } from './ticketUi';

export default function TicketNotifications({
  canWrite = false,
  isAdmin = false,
  showPending = true,
  showRules = false,
}) {
  const [items, setItems] = useState([]);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (showPending) {
        const pending = await ticketsAPI.getPendingNotifications();
        setItems(Array.isArray(pending?.items) ? pending.items : []);
      }
      if (canWrite && showRules) {
        const ruleData = await ticketsAPI.getNotificationRules();
        setRules(Array.isArray(ruleData?.items) ? ruleData.items : []);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [canWrite, showPending, showRules]);

  useEffect(() => {
    void load();
  }, [load]);

  const dismiss = async (id) => {
    await ticketsAPI.dismissNotification(id);
    await load();
  };

  const updateRule = async (rule, patch) => {
    await ticketsAPI.updateNotificationRule(rule.id, patch);
    await load();
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {showRules ? 'Правила SLA' : 'SLA уведомления'}
        </Typography>
        <Button startIcon={<RefreshIcon />} onClick={load}>Обновить</Button>
      </Stack>
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}

      {showPending && items.length === 0 ? <Alert severity="success">Активных уведомлений нет</Alert> : null}
      {showPending ? items.map((item) => (
        <Alert
          key={item.id}
          severity={item.severity === 'critical' ? 'error' : 'warning'}
          action={<Button size="small" onClick={() => dismiss(item.id)}>Скрыть</Button>}
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip size="small" label={item.rule_type} />
            <span>{item.title}: {item.message}</span>
          </Stack>
        </Alert>
      )) : null}

      {canWrite && showRules ? (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Правило</TableCell>
              <TableCell>Включено</TableCell>
              <TableCell>Порог, дней</TableCell>
              <TableCell>Роли</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rules.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell>{rule.rule_type}</TableCell>
                <TableCell>
                  <Switch
                    checked={Boolean(rule.is_enabled)}
                    disabled={!isAdmin}
                    onChange={(event) => updateRule(rule, { is_enabled: event.target.checked })}
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    type="number"
                    value={rule.threshold_days ?? ''}
                    disabled={!isAdmin}
                    onChange={(event) => updateRule(rule, { threshold_days: Number(event.target.value) })}
                    sx={{ width: 120 }}
                  />
                </TableCell>
                <TableCell>{rule.notify_roles || '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </Stack>
  );
}
