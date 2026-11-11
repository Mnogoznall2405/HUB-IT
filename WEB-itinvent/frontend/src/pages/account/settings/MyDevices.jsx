import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, Paper, Stack, Typography } from '@mui/material';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import { authDevicesAPI } from '../../../api/authDevices';
import { useAuth } from '../../../contexts/AuthContext';
import { formatDateTime } from '../accountUserModel';
import SectionCard from '../shared/SectionCard';

export default function MyDevices() {
  const { user, logout } = useAuth();
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [action, setAction] = useState(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const items = await authDevicesAPI.list();
      if (request === generation.current) setDevices(items);
    } catch {
      if (request === generation.current) setError('Не удалось загрузить устройства. Повторите попытку.');
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    setDevices([]);
    setAction(null);
    setMessage('');
    void load();
    return () => { generation.current += 1; };
  }, [user?.id, load]);

  const confirm = async () => {
    if (busy || !action) return;
    const request = generation.current;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = action.kind === 'others' ? await authDevicesAPI.terminateOthers()
        : action.kind === 'session' ? await authDevicesAPI.terminateSession(action.id)
          : await authDevicesAPI.remove(action.id);
      if (request !== generation.current) return;
      setAction(null);
      if (result.current_session_closed) {
        await logout();
        return;
      }
      setMessage(action.kind === 'others' ? 'Остальные устройства отключены.'
        : action.kind === 'session' ? 'Сеанс завершён.' : 'Устройство удалено.');
      await load();
    } catch {
      if (request === generation.current) setError('Не удалось выполнить действие. Обновите список и повторите попытку.');
    } finally {
      setBusy(false);
    }
  };
  const description = action?.kind === 'others'
    ? 'Будут завершены сеансы остальных устройств и отозвано их биометрическое восстановление. Это устройство продолжит работу. Ключи passkey отзываются отдельно.'
    : action?.kind === 'session'
      ? 'Будет завершён выбранный вход. Сохранённая биометрия Android останется доступна. Для её отзыва используйте «Удалить устройство».'
      : 'Будут завершены связанные сеансы и отозвано биометрическое восстановление Android. Для доступа потребуется новый вход. Ключи passkey отзываются отдельно.';

  return (
    <SectionCard title="Мои устройства" description="Браузеры и приложения, в которых выполнен вход в ваш аккаунт."
      action={<Button size="small" aria-label="Обновить устройства" startIcon={<RefreshOutlinedIcon />} onClick={load} disabled={loading || busy}>Обновить</Button>}
      headerSx={{ flexWrap: 'wrap' }}>
      <Stack spacing={1.5}>
        {error ? <Alert severity="error" role="alert">{error}</Alert> : null}
        {message ? <Alert severity="success" role="status">{message}</Alert> : null}
        {loading ? <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={18} /><Typography>Загружаю устройства…</Typography></Stack> : null}
        {!loading && !error && devices.length === 0 ? <Alert severity="info">Активных устройств нет.</Alert> : null}
        {!loading && devices.map(device => (
          <Paper key={device.id} variant="outlined" sx={{ p: 1.25, borderRadius: '6px', minWidth: 0 }} data-testid="my-device-card">
            <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.25} alignItems={{ lg: 'center' }}>
            <Stack spacing={0.75} sx={{ minWidth: 0, flex: 1 }}>
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
                <Typography sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{device.label}</Typography>
                {device.is_current ? <Chip size="small" color="primary" label="Это устройство" /> : null}
                {device.biometric_enabled ? <Chip size="small" label="Биометрия Android" /> : null}
              </Stack>
              <Typography variant="body2" color="text.secondary">Последняя активность: {formatDateTime(device.last_seen_at)}</Typography>
              {!device.sessions.length ? <Typography variant="body2">Активного сеанса нет. Сохранён вход по биометрии.</Typography> : null}
              {device.sessions.map(session => (
                <Stack key={session.session_id} direction={{ xs: 'column', sm: 'row' }} spacing={0.5} alignItems={{ sm: 'center' }}>
                  <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>IP: {session.ip_address || 'неизвестен'} · Вход: {formatDateTime(session.created_at)}</Typography>
                  <Button color="error" size="small" sx={{ alignSelf: 'flex-start' }} disabled={busy || loading || Boolean(error)}
                    onClick={() => setAction({ kind: 'session', id: session.session_id, current: session.is_current })}>Завершить сеанс</Button>
                </Stack>
              ))}
            </Stack>
              <Button color="error" variant="outlined" sx={{ alignSelf: { xs: 'flex-start', lg: 'center' }, flexShrink: 0 }} disabled={busy || loading || Boolean(error)}
                onClick={() => setAction({ kind: 'device', id: device.id, current: device.is_current })}>Удалить устройство</Button>
            </Stack>
          </Paper>
        ))}
        <Button color="error" variant="outlined" sx={{ alignSelf: 'flex-start' }}
          disabled={loading || busy || Boolean(error) || !devices.some(device => !device.is_current)}
          onClick={() => setAction({ kind: 'others' })}>Завершить все остальные</Button>
      </Stack>
      <Dialog open={Boolean(action)} onClose={() => { if (!busy) setAction(null); }} fullWidth maxWidth="sm">
        <DialogTitle>{action?.kind === 'others' ? 'Завершить остальные входы?' : action?.kind === 'session' ? 'Завершить сеанс?' : 'Удалить устройство?'}</DialogTitle>
        <DialogContent>
          <DialogContentText>{description}</DialogContentText>
          {action?.current ? <Alert severity="warning" sx={{ mt: 1 }}>Вы выйдете из аккаунта на этом устройстве.</Alert> : null}
          {error ? <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert> : null}
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setAction(null)}>Отмена</Button>
          <Button color="error" disabled={busy} onClick={confirm}>{busy ? 'Выполняется…' : 'Подтвердить'}</Button>
        </DialogActions>
      </Dialog>
    </SectionCard>
  );
}
