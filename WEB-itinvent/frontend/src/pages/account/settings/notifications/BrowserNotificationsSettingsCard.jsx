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
import { isNativeShellRuntime } from '../../../../lib/platform';
import { buildOfficeUiTokens, getOfficeSubtlePanelSx } from '../../../../theme/officeUiTokens';
import SectionCard from '../../shared/SectionCard';

export function BrowserNotificationsSettingsCard() {
  if (isNativeShellRuntime()) return null;

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
      title="Windows-уведомления"
      description="Системные уведомления браузера для hub-событий. Настройка хранится локально в текущем браузере на этой машине."
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
                checked={enabled}
                onChange={handleToggleEnabled}
                disabled={!supported}
              />
            )}
            label={enabled ? 'Показывать Windows-уведомления для hub-событий' : 'Windows-уведомления отключены'}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35, lineHeight: 1.45 }}>
            Используется Browser Notification API. Уведомления работают, пока сайт открыт в браузере и для сайта выдано разрешение.
          </Typography>
        </Paper>

        {!supported ? (
          <Alert severity="warning">
            В этом браузере системные уведомления не поддерживаются. Внутренние web-toast уведомления продолжат работать как раньше.
          </Alert>
        ) : null}

        {supported && permission === 'default' ? (
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

        {supported && permission === 'denied' ? (
          <Alert severity="warning">
            Браузер сейчас блокирует системные уведомления для этого сайта. Разрешите уведомления в настройках браузера, после чего вернитесь на эту страницу.
          </Alert>
        ) : null}

        {supported && permission === 'granted' ? (
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
