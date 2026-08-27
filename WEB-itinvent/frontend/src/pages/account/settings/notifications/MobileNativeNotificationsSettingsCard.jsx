import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Stack,
  Typography,
} from '@mui/material';
import { requestMobileAppCommand } from '../../../../lib/mobileAppBridge';
import SectionCard from '../../shared/SectionCard';

const STATUS_LABELS = {
  unsupported: 'Не поддерживаются',
  disabled: 'Не настроены на сервере',
  denied: 'Запрещены в Android',
  registered: 'Включены',
  error: 'Ошибка',
};

const STATUS_COLORS = {
  registered: 'success',
  denied: 'warning',
  disabled: 'default',
  unsupported: 'default',
  error: 'error',
};

const ANDROID_CHANNELS = [
  ['hubit_chat', 'Чат'],
  ['hubit_tasks', 'Задачи'],
  ['hubit_mail', 'Почта'],
  ['hubit_system', 'Системные'],
];

function requestActionHaptic(kind) {
  void requestMobileAppCommand('haptics.perform', { kind }).catch(() => undefined);
}

export function MobileNativeNotificationsSettingsCard({ embedded = false }) {
  const [pushState, setPushState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = useCallback(async (command, payload = null, { interactive = false } = {}) => {
    setBusy(true);
    setError('');
    try {
      const nextState = payload
        ? await requestMobileAppCommand(command, payload)
        : await requestMobileAppCommand(command);
      setPushState(nextState);
      if (interactive) {
        requestActionHaptic(
          command === 'notifications.requestPermission' && nextState?.status === 'registered'
            ? 'success'
            : 'selection',
        );
      }
      return nextState;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось изменить настройки Android');
      if (interactive) requestActionHaptic('error');
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void run('notifications.getState');
  }, [run]);

  const status = String(pushState?.status || '');

  return (
    <SectionCard
      title="Уведомления Android"
      description="Системные push-уведомления APK работают, даже когда HUB-IT закрыт. Разрешение выдаётся отдельно на этом телефоне."
      sx={embedded ? { border: 0, borderRadius: 0, bgcolor: 'transparent' } : undefined}
      contentSx={{ p: 1.5 }}
    >
      <Stack spacing={1.1}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Chip
            size="small"
            label={STATUS_LABELS[status] || (busy ? 'Проверяем…' : 'Не проверено')}
            color={STATUS_COLORS[status] || 'default'}
          />
          <Typography variant="body2" color="text.secondary" role="status" aria-live="polite">
            {pushState?.message || 'Проверяем разрешение и регистрацию устройства…'}
          </Typography>
        </Stack>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <Button
            variant="contained"
            disabled={busy}
            onClick={() => void run('notifications.requestPermission', null, { interactive: true })}
            sx={{ minHeight: 44 }}
          >
            {status === 'registered' ? 'Проверить регистрацию' : 'Разрешить уведомления'}
          </Button>
          <Button
            variant="outlined"
            disabled={busy}
            onClick={() => void run('notifications.openSettings', null, { interactive: true })}
            sx={{ minHeight: 44 }}
          >
            Открыть настройки Android
          </Button>
        </Stack>
        <Stack spacing={0.6}>
          <Typography variant="caption" color="text.secondary">
            Звук, вибрация и показ на экране блокировки настраиваются Android отдельно для каждого типа.
          </Typography>
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
            {ANDROID_CHANNELS.map(([channelId, label]) => (
              <Button
                key={channelId}
                size="small"
                variant="text"
                disabled={busy}
                onClick={() => void run('notifications.openChannelSettings', { channelId }, { interactive: true })}
                sx={{ minHeight: 44 }}
              >
                {label}
              </Button>
            ))}
          </Stack>
        </Stack>
      </Stack>
    </SectionCard>
  );
}
