import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import { useTheme } from '@mui/material/styles';
import {
  getWindowsNotificationState,
  requestBrowserNotificationPermission,
  setWindowsNotificationsEnabled,
  WINDOWS_NOTIFICATIONS_CHANGED_EVENT,
} from '../../../../lib/windowsNotifications';
import { refreshChatNotificationState } from '../../../../lib/chatNotifications';
import { isNativeShellRuntime } from '../../../../lib/platform';
import { buildOfficeUiTokens, getOfficeSubtlePanelSx } from '../../../../theme/officeUiTokens';
import SectionCard from '../../shared/SectionCard';

export function BrowserNotificationsSettingsCard({ embedded = false }) {
  const nativeShell = isNativeShellRuntime();
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const [notificationState, setNotificationState] = useState(() => getWindowsNotificationState());
  const [requestingPermission, setRequestingPermission] = useState(false);

  const syncNotificationState = useCallback(() => {
    setNotificationState(getWindowsNotificationState());
  }, []);

  useEffect(() => {
    syncNotificationState();
    window.addEventListener(WINDOWS_NOTIFICATIONS_CHANGED_EVENT, syncNotificationState);
    window.addEventListener('focus', syncNotificationState);
    document.addEventListener('visibilitychange', syncNotificationState);
    return () => {
      window.removeEventListener(WINDOWS_NOTIFICATIONS_CHANGED_EVENT, syncNotificationState);
      window.removeEventListener('focus', syncNotificationState);
      document.removeEventListener('visibilitychange', syncNotificationState);
    };
  }, [syncNotificationState]);

  const handleToggleEnabled = useCallback((event) => {
    setWindowsNotificationsEnabled(Boolean(event?.target?.checked));
    syncNotificationState();
  }, [syncNotificationState]);

  const handleRequestPermission = useCallback(async () => {
    setRequestingPermission(true);
    try {
      const permission = await requestBrowserNotificationPermission();
      if (permission === 'granted') {
        setWindowsNotificationsEnabled(true);
      } else if (permission === 'denied') {
        setWindowsNotificationsEnabled(false);
      }
      refreshChatNotificationState();
      syncNotificationState();
    } finally {
      setRequestingPermission(false);
    }
  }, [syncNotificationState]);

  const permission = String(notificationState?.permission || 'unsupported');
  const supported = Boolean(notificationState?.supported);
  const enabled = Boolean(notificationState?.enabled);

  const permissionChip = supported
    ? (
      permission === 'granted'
        ? { label: 'Разрешено', color: 'success' }
        : permission === 'denied'
          ? { label: 'Запрещено', color: 'warning' }
          : { label: 'Не запрошено', color: 'default' }
    )
    : { label: 'Не поддерживается', color: 'default' };

  return (
    <SectionCard
      title={embedded ? 'На этом устройстве' : 'Системные уведомления на этом устройстве'}
      description={nativeShell
        ? 'Разрешите HUB Desktop показывать системные уведомления. Какие события получать, определяется настройками выше.'
        : 'Разрешите этому браузеру показывать системные уведомления. Какие события получать, определяется настройками выше.'}
      action={(
        <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap" justifyContent="flex-end">
          <Chip
            size="small"
            icon={<NotificationsActiveOutlinedIcon sx={{ fontSize: '14px !important' }} />}
            label={enabled ? 'Включены' : 'Выключены'}
            color={enabled ? 'primary' : 'default'}
            variant={enabled ? 'filled' : 'outlined'}
          />
          <Chip size="small" label={permissionChip.label} color={permissionChip.color} variant="outlined" />
        </Stack>
      )}
      sx={embedded ? { border: 0, borderRadius: 0, bgcolor: 'transparent' } : undefined}
      contentSx={{ p: 1.5 }}
    >
      <Stack spacing={1.2}>
        <Paper
          variant="outlined"
          sx={getOfficeSubtlePanelSx(ui, {
            p: 1.2,
            borderRadius: '12px',
            bgcolor: ui.panelInset,
          })}
        >
          <FormControlLabel
            control={(
              <Switch
                name="system_notifications"
                checked={enabled}
                onChange={handleToggleEnabled}
                disabled={!supported}
              />
            )}
            label="Показывать системные уведомления"
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35, lineHeight: 1.45 }}>
            {nativeShell
              ? 'Desktop продолжает доставку, когда окно открыто, свёрнуто или скрыто в tray. Серверные переключатели каналов остаются общими с web.'
              : 'Используется Browser Notification API. Уведомления работают, пока сайт открыт в браузере и для сайта выдано разрешение.'}
          </Typography>
        </Paper>

        {!supported ? (
          <Alert severity="warning">
            {nativeShell
              ? 'Desktop-канал сейчас недоступен. Внутренние web-toast уведомления продолжат работать в открытом окне.'
              : 'В этом браузере системные уведомления не поддерживаются. Внутренние web-toast уведомления продолжат работать как раньше.'}
          </Alert>
        ) : null}

        {!nativeShell && supported && permission === 'default' ? (
          <Alert
            severity="info"
            action={(
              <Button
                color="inherit"
                size="small"
                onClick={handleRequestPermission}
                disabled={requestingPermission}
              >
                {requestingPermission ? 'Запрос...' : 'Разрешить уведомления'}
              </Button>
            )}
          >
            Браузер ещё не получил разрешение на системные уведомления. Включите разрешение, чтобы новые hub-события приходили в Windows Notification Center.
          </Alert>
        ) : null}

        {!nativeShell && supported && permission === 'denied' ? (
          <Alert severity="warning">
            Браузер сейчас блокирует системные уведомления для этого сайта. Разрешите уведомления в настройках браузера, после чего вернитесь на эту страницу.
          </Alert>
        ) : null}

        {nativeShell && supported ? (
          <Alert severity={enabled ? 'success' : 'info'}>
            {enabled
              ? 'Desktop-канал включён. Если обычный Windows toast недоступен, HUB показывает закреплённую плашку до открытия или закрытия пользователем.'
              : 'Desktop-канал доступен, но общий локальный переключатель сейчас выключен.'}
          </Alert>
        ) : null}

        {!nativeShell && supported && permission === 'granted' ? (
          <Alert severity={enabled ? 'success' : 'info'}>
            {enabled
              ? 'Системные уведомления разрешены и будут дублировать новые hub-события в Windows.'
              : 'Разрешение уже выдано, но локальный переключатель сейчас выключен.'}
          </Alert>
        ) : null}
      </Stack>
    </SectionCard>
  );
}
