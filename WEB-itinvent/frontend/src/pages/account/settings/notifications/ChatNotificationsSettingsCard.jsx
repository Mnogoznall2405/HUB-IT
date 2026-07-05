import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import { useTheme } from '@mui/material/styles';
import { useAuth } from '../../../../contexts/AuthContext';
import { useNotification } from '../../../../contexts/NotificationContext';
import {
  getChatNotificationState,
  refreshChatNotificationState,
  requestChatNotificationPermission,
  setChatNotificationsEnabled,
  subscribeChatNotificationState,
  syncChatPushSubscription,
} from '../../../../lib/chatNotifications';
import { isNativeShellRuntime } from '../../../../lib/platform';
import { buildOfficeUiTokens, getOfficeSubtlePanelSx } from '../../../../theme/officeUiTokens';
import { CHAT_FOREGROUND_DIAGNOSTIC_LABELS, CHAT_FOREGROUND_ONLY_REASON_LABELS } from '../../accountConstants';
import { formatDateTime } from '../../accountUserModel';
import SectionCard from '../../shared/SectionCard';

export function ChatNotificationsSettingsCard() {
  if (isNativeShellRuntime()) return null;

  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const { user } = useAuth();
  const { notifyInfo, notifySuccess, notifyWarning } = useNotification();
  const [chatNotificationState, setChatNotificationState] = useState(() => getChatNotificationState());
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeChatNotificationState(setChatNotificationState), []);
  useEffect(() => {
    refreshChatNotificationState();
  }, []);

  const handleSyncSubscription = useCallback(async () => {
    if (!user) return;
    setBusy(true);
    try {
      const snapshot = await syncChatPushSubscription({ user, force: true });
      if (snapshot.pushSubscribed) {
        notifySuccess('Chat-уведомления подключены для этого браузера.', { source: 'settings', dedupeMode: 'none' });
      } else if (snapshot.yandexLimited && snapshot.foregroundCapable) {
        notifyInfo('В Яндекс.Браузере chat-уведомления работают только из открытой вкладки. Фоновый push для него не включается.', {
          source: 'settings',
          dedupeMode: 'none',
        });
      } else if (snapshot.foregroundOnlyReason === 'server_not_configured') {
        notifyWarning('Сервер chat push пока не настроен. Во вкладке уведомления могут работать, но фоновая доставка сейчас недоступна.', {
          source: 'settings',
          dedupeMode: 'none',
        });
      } else if (snapshot.foregroundCapable) {
        notifyInfo('Разрешение выдано, но фоновые push-уведомления пока недоступны. Вкладочные уведомления продолжат работать.', {
          source: 'settings',
          dedupeMode: 'none',
        });
      }
    } catch (error) {
      console.error('Chat notification subscription sync failed:', error);
      notifyWarning('Не удалось обновить push-подписку для chat. Проверьте HTTPS и разрешение браузера.', {
        source: 'settings',
        dedupeMode: 'none',
      });
      refreshChatNotificationState();
    } finally {
      setBusy(false);
    }
  }, [notifyInfo, notifySuccess, notifyWarning, user]);

  const handleToggleEnabled = useCallback(async (event) => {
    const enabled = setChatNotificationsEnabled(Boolean(event?.target?.checked));
    if (!enabled) {
      refreshChatNotificationState();
      return;
    }
    refreshChatNotificationState();
    if (chatNotificationState.permission === 'granted' && user) {
      await handleSyncSubscription();
    }
  }, [chatNotificationState.permission, handleSyncSubscription, user]);

  const handleRequestPermission = useCallback(async () => {
    setBusy(true);
    try {
      const permission = await requestChatNotificationPermission();
      if (permission === 'granted' && user) {
        await handleSyncSubscription();
      } else {
        refreshChatNotificationState();
      }
    } finally {
      setBusy(false);
    }
  }, [handleSyncSubscription, user]);

  const permission = String(chatNotificationState?.permission || 'unsupported');
  const enabled = Boolean(chatNotificationState?.enabled);
  const foregroundOnlyReason = String(chatNotificationState?.foregroundOnlyReason || '').trim();
  const foregroundDiagnostic = String(chatNotificationState?.foregroundDiagnostic || '').trim();
  const lastDeliveryMode = String(chatNotificationState?.lastDeliveryMode || '').trim();
  const lastPushReceivedAt = String(chatNotificationState?.lastPushReceivedAt || '').trim();
  const lastNotificationShownAt = String(chatNotificationState?.lastNotificationShownAt || '').trim();
  const lastBackgroundConfirmedAt = String(chatNotificationState?.lastBackgroundConfirmedAt || '').trim();
  const serviceWorkerVersion = String(chatNotificationState?.serviceWorkerVersion || '').trim();
  const pendingResubscribe = Boolean(chatNotificationState?.pendingResubscribe);
  const statusLabel = chatNotificationState.pushSubscribed
    ? 'Push подключен'
    : chatNotificationState.yandexLimited && chatNotificationState.foregroundCapable
      ? 'Только во вкладке'
      : chatNotificationState.foregroundCapable
        ? 'Только во вкладке'
        : foregroundOnlyReason === 'server_not_configured'
          ? 'Сервер push не настроен'
          : enabled
            ? 'Ожидание'
            : 'Выключено';

  return (
    <SectionCard
      title="Chat-уведомления"
      description="Новые сообщения чата: системные уведомления во вкладке и web-push в фоне, если браузер поддерживает этот режим."
      action={(
        <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap" justifyContent="flex-end">
          <Chip
            size="small"
            icon={<NotificationsActiveOutlinedIcon sx={{ fontSize: '14px !important' }} />}
            label={statusLabel}
            color={chatNotificationState.pushSubscribed ? 'success' : enabled ? 'primary' : 'default'}
            variant={chatNotificationState.pushSubscribed || enabled ? 'filled' : 'outlined'}
          />
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
                disabled={!chatNotificationState.supported || busy}
              />
            )}
            label={enabled ? 'Разрешать chat-уведомления в этом браузере' : 'Chat-уведомления отключены'}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35, lineHeight: 1.45 }}>
            На desktop Chromium и Android Chromium возможна фоновая web-push доставка. На iPhone нужен запуск из установленной PWA.
          </Typography>
        </Paper>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          <Button
            variant={permission === 'granted' ? 'outlined' : 'contained'}
            onClick={handleRequestPermission}
            disabled={!chatNotificationState.supported || busy || permission === 'granted'}
            startIcon={busy ? <CircularProgress color="inherit" size={14} /> : <NotificationsActiveOutlinedIcon fontSize="small" />}
          >
            {busy && permission !== 'granted' ? 'Запрос...' : permission === 'granted' ? 'Разрешение выдано' : 'Разрешить уведомления'}
          </Button>
          <Button
            variant="outlined"
            onClick={handleSyncSubscription}
            disabled={!enabled || permission !== 'granted' || busy || !user}
          >
            {busy && permission === 'granted'
              ? 'Обновление...'
              : chatNotificationState.yandexLimited
                ? 'Проверить состояние'
                : 'Обновить подписку'}
          </Button>
        </Stack>

        {!chatNotificationState.supported ? (
          <Alert severity="warning">
            В этом браузере системные chat-уведомления не поддерживаются. Внутренние unread-индикаторы продолжат работать.
          </Alert>
        ) : null}

        {permission === 'default' ? (
          <Alert severity="info">
            Браузер ещё не получил разрешение на chat-уведомления. Разрешение общее для сайта и используется и на Windows, и на мобильных устройствах.
          </Alert>
        ) : null}

        {permission === 'denied' ? (
          <Alert severity="warning">
            Браузер сейчас блокирует chat-уведомления для этого сайта. Разрешите уведомления в настройках браузера и затем обновите подписку.
          </Alert>
        ) : null}

        {chatNotificationState.requiresInstalledPwa ? (
          <Alert severity="info">
            На iPhone фоновые chat-уведомления работают только из установленной PWA. Установите HUB-IT на экран Домой и запускайте с иконки.
          </Alert>
        ) : null}

        {chatNotificationState.yandexLimited ? (
          <Alert severity="warning">
            В Яндекс.Браузере chat-уведомления поддерживаются только из открытой вкладки. Для гарантированного background push используйте Chrome, Edge или установленную iOS PWA.
          </Alert>
        ) : null}

        {enabled && permission === 'granted' && chatNotificationState.pushSubscribed ? (
          <Alert severity="success">
            Фоновая push-подписка активна. Новые сообщения чата будут приходить и вне открытой вкладки на поддерживаемых устройствах.
          </Alert>
        ) : null}

        {enabled && permission === 'granted' && !chatNotificationState.pushSubscribed ? (
          <Alert severity={chatNotificationState.pushConfigured ? 'info' : 'warning'}>
            {CHAT_FOREGROUND_ONLY_REASON_LABELS[foregroundOnlyReason]
              || (
                chatNotificationState.pushConfigured
                  ? 'Разрешение уже выдано. Если push всё ещё не подключён, обновите подписку или откройте приложение в поддерживаемом браузере.'
                  : 'Фоновый chat push пока недоступен на сервере или в этом браузере. Пока будут работать только уведомления в открытом приложении.'
              )}
          </Alert>
        ) : null}

        {enabled && permission === 'granted' && foregroundDiagnostic ? (
          <Alert severity={foregroundDiagnostic === 'chat_socket_unavailable' ? 'warning' : 'info'}>
            {CHAT_FOREGROUND_DIAGNOSTIC_LABELS[foregroundDiagnostic] || 'Состояние chat-уведомлений обновлено.'}
          </Alert>
        ) : null}

        {chatNotificationState.lastError ? (
          <Alert severity="warning">
            Последняя попытка синхронизации push-подписки завершилась ошибкой. Повторите обновление подписки после проверки HTTPS и разрешения браузера.
          </Alert>
        ) : null}

        <Paper
          variant="outlined"
          sx={getOfficeSubtlePanelSx(ui, {
            p: 1.2,
            borderRadius: '12px',
            bgcolor: ui.panelInset,
          })}
        >
          <Stack spacing={0.75}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
              Push-диагностика
            </Typography>
            <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
              <Chip
                size="small"
                color={lastBackgroundConfirmedAt ? 'success' : 'default'}
                label={lastBackgroundConfirmedAt ? 'Фон подтверждён' : 'Фон ещё не подтверждён'}
                variant={lastBackgroundConfirmedAt ? 'filled' : 'outlined'}
              />
              <Chip
                size="small"
                color={lastDeliveryMode === 'background' ? 'success' : 'default'}
                label={lastDeliveryMode === 'background' ? 'Последняя доставка: фон' : lastDeliveryMode === 'foreground_or_visible' ? 'Последняя доставка: видимое окно' : 'Режим доставки не зафиксирован'}
                variant={lastDeliveryMode ? 'filled' : 'outlined'}
              />
              <Chip
                size="small"
                color={pendingResubscribe ? 'warning' : 'default'}
                label={pendingResubscribe ? 'Есть resubscribe-очередь' : 'Resubscribe-очередь пуста'}
                variant={pendingResubscribe ? 'filled' : 'outlined'}
              />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Service worker: {serviceWorkerVersion || 'неизвестно'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Последний push получен: {lastPushReceivedAt ? formatDateTime(lastPushReceivedAt) : '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Последнее системное уведомление показано: {lastNotificationShownAt ? formatDateTime(lastNotificationShownAt) : '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Последнее подтверждение именно фоновой доставки: {lastBackgroundConfirmedAt ? formatDateTime(lastBackgroundConfirmedAt) : '—'}
            </Typography>
          </Stack>
        </Paper>
      </Stack>
    </SectionCard>
  );
}
