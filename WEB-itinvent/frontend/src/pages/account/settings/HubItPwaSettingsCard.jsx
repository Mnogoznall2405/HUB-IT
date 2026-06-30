import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import ExpandMoreOutlinedIcon from '@mui/icons-material/ExpandMoreOutlined';
import GetAppOutlinedIcon from '@mui/icons-material/GetAppOutlined';
import PhoneIphoneOutlinedIcon from '@mui/icons-material/PhoneIphoneOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import { useNotification } from '../../../contexts/NotificationContext';
import { getChatNotificationState, subscribeChatNotificationState } from '../../../lib/chatNotifications';
import { isNativeShellRuntime } from '../../../lib/platform';
import {
  applyPwaUpdate,
  getPwaInstallState,
  promptPwaInstall,
  refreshPwaInstallState,
  subscribePwaInstallState,
} from '../../../lib/pwaInstall';
import { buildOfficeUiTokens, getOfficeSubtlePanelSx } from '../../../theme/officeUiTokens';
import { formatDateTime } from '../accountUserModel';
import SectionCard from '../shared/SectionCard';

export default function HubItPwaSettingsCard() {

  if (isNativeShellRuntime()) return null;

  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { notifyInfo, notifySuccess, notifyWarning } = useNotification();
  const [installState, setInstallState] = useState(() => getPwaInstallState());
  const [chatNotificationState, setChatNotificationState] = useState(() => getChatNotificationState());
  const [installing, setInstalling] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [showManualHint, setShowManualHint] = useState(false);

  useEffect(() => subscribePwaInstallState(setInstallState), []);
  useEffect(() => subscribeChatNotificationState(setChatNotificationState), []);
  useEffect(() => {
    refreshPwaInstallState();
  }, []);

  const handleInstall = useCallback(async () => {
    if (installState.installed) {
      notifyInfo('HUB-IT уже установлено. Запускайте приложение с ярлыка на рабочем столе или главном экране.', {
        source: 'settings',
        dedupeMode: 'none',
      });
      return;
    }

    if (installState.requiresManualInstall) {
      setShowManualHint(true);
      return;
    }

    if (!installState.secure) {
      notifyWarning('Для установки HUB-IT откройте сайт по HTTPS, а не по обычному HTTP.', {
        source: 'settings',
        dedupeMode: 'none',
      });
      return;
    }

    if (!installState.canPrompt) {
      notifyInfo('Браузер пока не подготовил системное окно установки. Оставьте страницу открытой ещё на несколько секунд и повторите попытку.', {
        source: 'settings',
        dedupeMode: 'none',
      });
      return;
    }

    setInstalling(true);
    try {
      const result = await promptPwaInstall();
      if (result.outcome === 'accepted') {
        notifySuccess('Установка HUB-IT запущена.', { source: 'settings', dedupeMode: 'none' });
      } else if (result.outcome === 'dismissed') {
        notifyInfo('Установка HUB-IT отменена.', { source: 'settings', dedupeMode: 'none' });
      }
    } finally {
      setInstalling(false);
    }
  }, [installState.canPrompt, installState.installed, installState.requiresManualInstall, installState.secure, notifyInfo, notifySuccess, notifyWarning]);

  const handleUpdate = useCallback(async () => {
    setUpdating(true);
    try {
      const applied = await applyPwaUpdate();
      if (!applied) {
        notifyWarning('Новая версия HUB-IT пока не готова к активации. Повторите попытку через несколько секунд.', {
          source: 'settings',
          dedupeMode: 'recent',
          dedupeKey: 'pwa:update-unavailable',
        });
        return;
      }
      notifyInfo('HUB-IT обновляется. После активации новой версии приложение перезагрузится автоматически.', {
        source: 'settings',
        dedupeMode: 'recent',
        dedupeKey: 'pwa:update-started',
      });
    } finally {
      setUpdating(false);
    }
  }, [notifyInfo, notifyWarning]);

  const actionLabel = installState.installed
    ? 'Уже установлено'
    : installState.requiresManualInstall
      ? 'Как установить'
      : 'Установить HUB-IT';

  const statusLabel = installState.installed
    ? 'Установлено'
    : installState.requiresManualInstall
      ? 'Ручная установка'
      : installState.canPrompt
        ? 'Готово к установке'
        : installState.secure
          ? 'Ожидание браузера'
          : 'Нужен HTTPS';

  const displayMode = String(installState.displayMode || 'browser').trim() || 'browser';
  const displayModeLabel = {
    browser: 'Во вкладке браузера',
    standalone: 'Установленное приложение',
    'window-controls-overlay': 'Установленное окно HUB-IT',
    'minimal-ui': 'Минимальный режим браузера',
    fullscreen: 'Полноэкранный режим',
  }[displayMode] || displayMode;
  const serviceWorkerVersion = String(installState.serviceWorkerVersion || '').trim();
  const lastRuntimeSyncAt = String(installState.lastRuntimeSyncAt || '').trim();
  const offlineReady = Boolean(installState.offlineReady);
  const updateAvailable = Boolean(installState.updateAvailable);
  const windowControlsOverlaySupported = Boolean(installState.windowControlsOverlaySupported);
  const windowControlsOverlayVisible = Boolean(installState.windowControlsOverlayVisible);
  const lastDeliveryMode = String(chatNotificationState?.lastDeliveryMode || '').trim();
  const lastPushReceivedAt = String(chatNotificationState?.lastPushReceivedAt || '').trim();
  const lastNotificationShownAt = String(chatNotificationState?.lastNotificationShownAt || '').trim();
  const lastBackgroundConfirmedAt = String(chatNotificationState?.lastBackgroundConfirmedAt || '').trim();
  const pendingResubscribe = Boolean(chatNotificationState?.pendingResubscribe);
  const pushSubscribed = Boolean(chatNotificationState?.pushSubscribed);

  return (
    <SectionCard
      title="Приложение HUB-IT"
      description="Установка, обновления и push-уведомления."
      contentSx={{ p: 1.5 }}
      action={<Chip size="small" label={statusLabel} color={installState.installed ? 'success' : 'default'} />}
    >
      <Stack spacing={1.1}>
        <Paper
          variant="outlined"
          sx={getOfficeSubtlePanelSx(ui, {
            p: 1.2,
            borderRadius: '12px',
            bgcolor: ui.panelInset,
            borderColor: ui.borderSoft,
          })}
        >
          <Stack direction="row" spacing={1.1} alignItems="flex-start">
            <Box
              sx={{
                width: 38,
                height: 38,
                borderRadius: '12px',
                display: 'grid',
                placeItems: 'center',
                bgcolor: alpha(theme.palette.primary.main, 0.12),
                color: theme.palette.primary.main,
                flexShrink: 0,
              }}
            >
              <PhoneIphoneOutlinedIcon fontSize="small" />
            </Box>
            <Stack spacing={0.45} sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                HUB-IT как приложение
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.4 }}>
                {installState.installed
                  ? 'Приложение установлено. Запускайте HUB-IT с ярлыка.'
                  : installState.requiresManualInstall
                    ? 'На iPhone установка выполняется вручную через меню «Поделиться» и пункт «На экран Домой».'
                    : installState.canPrompt
                      ? 'Браузер готов открыть системное окно установки HUB-IT.'
                      : installState.secure
                        ? 'Браузер ещё подготавливает установку. Повторите через несколько секунд.'
                        : 'Установка приложения работает только при открытии HUB-IT по HTTPS.'}
              </Typography>
            </Stack>
          </Stack>
        </Paper>

        {showManualHint && installState.requiresManualInstall ? (
          <Alert severity="info" onClose={() => setShowManualHint(false)}>
            В Safari нажмите <strong>Поделиться</strong>, затем выберите <strong>На экран Домой</strong>. После этого запускайте HUB-IT с иконки, а не из вкладки браузера.
          </Alert>
        ) : null}

        <Stack
          direction={isMobile ? 'column' : 'row'}
          spacing={1}
          alignItems={isMobile ? 'stretch' : 'center'}
          justifyContent="flex-end"
          flexWrap="wrap"
        >
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <Button
              variant={installState.installed ? 'outlined' : 'contained'}
              startIcon={<GetAppOutlinedIcon />}
              onClick={handleInstall}
              disabled={installing}
            >
              {installing ? 'Подготовка...' : actionLabel}
            </Button>
            <Button
              variant="outlined"
              startIcon={<RefreshOutlinedIcon />}
              onClick={() => {
                if (!updateAvailable) {
                  notifyInfo('Сейчас новая версия HUB-IT не ожидает активации. Когда service worker скачает обновление, кнопка начнёт применять его сразу.', {
                    source: 'settings',
                    dedupeMode: 'recent',
                    dedupeKey: 'pwa:update-idle',
                  });
                  return;
                }
                void handleUpdate();
              }}
              disabled={updating}
            >
              {updating ? 'Обновляем...' : 'Обновить HUB-IT'}
            </Button>
          </Stack>
        </Stack>

        <Accordion
          disableGutters
          elevation={0}
          sx={{
            border: '1px solid',
            borderColor: ui.borderSoft,
            borderRadius: '14px !important',
            bgcolor: ui.panelInset,
            '&::before': { display: 'none' },
          }}
        >
          <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                Диагностика HUB-IT
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Service worker, push и runtime
              </Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={0.75}>
            <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
              <Chip
                size="small"
                color={offlineReady ? 'success' : 'default'}
                label={offlineReady ? 'Offline shell готов' : 'Offline shell ещё не готов'}
                variant={offlineReady ? 'filled' : 'outlined'}
              />
              <Chip
                size="small"
                color={pushSubscribed ? 'success' : 'default'}
                label={pushSubscribed ? 'Push-подписка активна' : 'Push-подписка не активна'}
                variant={pushSubscribed ? 'filled' : 'outlined'}
              />
              <Chip
                size="small"
                color={updateAvailable ? 'warning' : 'default'}
                label={updateAvailable ? 'Доступно обновление' : 'Версия актуальна'}
                variant={updateAvailable ? 'filled' : 'outlined'}
              />
              <Chip
                size="small"
                color={lastBackgroundConfirmedAt ? 'success' : 'default'}
                label={lastBackgroundConfirmedAt ? 'Фоновый push подтверждён' : 'Фоновый push ещё не подтверждён'}
                variant={lastBackgroundConfirmedAt ? 'filled' : 'outlined'}
              />
              <Chip
                size="small"
                color={pendingResubscribe ? 'warning' : 'default'}
                label={pendingResubscribe ? 'Есть очередь resubscribe' : 'Очередь resubscribe пуста'}
                variant={pendingResubscribe ? 'filled' : 'outlined'}
              />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Режим запуска: {displayModeLabel}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Service worker: {serviceWorkerVersion || 'ещё не синхронизирован'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Последняя синхронизация runtime: {lastRuntimeSyncAt ? formatDateTime(lastRuntimeSyncAt) : '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Window controls overlay: {windowControlsOverlaySupported ? (windowControlsOverlayVisible ? 'активен' : 'поддерживается, но сейчас скрыт') : 'не поддерживается'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Последний принятый push: {lastPushReceivedAt ? formatDateTime(lastPushReceivedAt) : '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Последнее системное уведомление: {lastNotificationShownAt ? formatDateTime(lastNotificationShownAt) : '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Последнее подтверждение фоновой доставки: {lastBackgroundConfirmedAt ? formatDateTime(lastBackgroundConfirmedAt) : '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Последний режим доставки: {lastDeliveryMode === 'background' ? 'фон' : lastDeliveryMode === 'foreground_or_visible' ? 'видимое окно' : 'ещё не определён'}
            </Typography>
            </Stack>
          </AccordionDetails>
        </Accordion>
      </Stack>
    </SectionCard>
  );
}
