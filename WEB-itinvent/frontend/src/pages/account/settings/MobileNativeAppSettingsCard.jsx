import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import { requestMobileAppCommand } from '../../../lib/mobileAppBridge';
import { useAuth } from '../../../contexts/AuthContext';
import {
  clearMobileOfflineCache,
  getMobileOfflineCacheInventory,
  MOBILE_OFFLINE_CACHE_META_EVENT,
} from '../../../lib/mobileOfflineCache';
import { prepareMobileOfflineData } from '../../../lib/mobileOfflinePrefetch';
import SectionCard from '../shared/SectionCard';

const LOCK_TIMEOUTS = [
  [0, 'Сразу после сворачивания'],
  [30, 'Через 30 секунд'],
  [60, 'Через 1 минуту'],
  [300, 'Через 5 минут'],
  [900, 'Через 15 минут'],
];

const OFFLINE_MODULE_LABELS = {
  chat: 'Чат',
  mail: 'Почта',
  tasks: 'Задачи',
  tickets: 'Заявки',
  dashboard: 'Главная',
  equipment: 'Оборудование',
  other: 'Другие данные',
};

const SUCCESS_HAPTIC_COMMANDS = new Set([
  'update.install',
  'biometrics.enable',
  'diagnostics.clear',
  'offline.retryQueues',
]);

const SELECTION_HAPTIC_COMMANDS = new Set([
  'update.check',
  'update.openInstallerSettings',
  'appLock.update',
  'biometrics.disable',
  'diagnostics.share',
  'offline.clearFileCache',
  'network.getState',
  'system.openBackgroundSettings',
]);

function requestActionHaptic(kind) {
  void requestMobileAppCommand('haptics.perform', { kind }).catch(() => undefined);
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value || 0));
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function formatDateTime(value) {
  const timestamp = Number(value || 0);
  if (!timestamp) return 'ещё не выполнялась';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(timestamp);
}

function formatAndroidProcessHealth(state) {
  if (!state) return 'История завершений Android: загружается…';
  if (state.status === 'unsupported') {
    return 'Системная история завершений доступна начиная с Android 11.';
  }
  if (state.status !== 'available') {
    return 'Системная история завершений пока недоступна в этой сборке.';
  }
  const counts = state.counts || {};
  return `История Android: ANR ${counts.anr ?? 0} · Java-сбоев ${counts.crash ?? 0} · native-сбоев ${counts.nativeCrash ?? 0} · нехватка памяти ${counts.lowMemory ?? 0}`;
}

const CONNECTIVITY_TRANSPORT_LABELS = {
  none: 'без сети',
  wifi: 'Wi-Fi',
  cellular: 'мобильная сеть',
  ethernet: 'Ethernet',
  vpn: 'VPN',
  bluetooth: 'Bluetooth',
  other: 'другая сеть',
};

function getConnectivityPresentation(state) {
  if (!state) {
    return {
      color: 'default',
      label: 'Проверяем сеть',
      description: 'Android уточняет состояние подключения…',
    };
  }
  if (!state.available) {
    return {
      color: 'default',
      label: 'Состояние недоступно',
      description: 'Проверка сети Android пока недоступна в этой сборке.',
    };
  }
  const transport = CONNECTIVITY_TRANSPORT_LABELS[state.transport] || CONNECTIVITY_TRANSPORT_LABELS.other;
  if (state.online) {
    return {
      color: 'success',
      label: 'Интернет подтверждён',
      description: `Подключение: ${transport} · ${state.metered ? 'лимитный трафик' : 'обычный трафик'}.`,
    };
  }
  if (state.connected) {
    return {
      color: 'warning',
      label: 'Без доступа в интернет',
      description: `Android видит подключение «${transport}», но интернет пока не подтверждён.`,
    };
  }
  return {
    color: 'error',
    label: 'Нет подключения',
    description: 'Android не видит доступную сеть. Загруженные ранее данные остаются доступны для просмотра.',
  };
}

function NativeSettingsHeading({ title, description }) {
  return (
    <Stack spacing={0.25}>
      <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{title}</Typography>
      <Typography variant="body2" color="text.secondary">{description}</Typography>
    </Stack>
  );
}

export default function MobileNativeAppSettingsCard() {
  const { hasPermission } = useAuth();
  const [updateState, setUpdateState] = useState(null);
  const [lockState, setLockState] = useState(null);
  const [diagnosticsState, setDiagnosticsState] = useState(null);
  const [offlineState, setOfflineState] = useState(null);
  const [networkState, setNetworkState] = useState(null);
  const [offlineInventory, setOfflineInventory] = useState(null);
  const [offlinePrepareResult, setOfflinePrepareResult] = useState(null);
  const [busyCommand, setBusyCommand] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const busy = Boolean(busyCommand);
  const updateAvailable = updateState?.status === 'available' && Boolean(updateState?.feed);
  const updateProgress = Math.max(0, Math.min(100, Number(updateState?.progress || 0) * 100));
  const biometricEnabled = Boolean(lockState?.biometricEnabled);
  const lockEnabled = Boolean(lockState?.enabled);
  const timeoutSeconds = Number(lockState?.timeoutSeconds ?? 60);
  const releaseHealth = diagnosticsState?.releaseHealth || null;
  const processHealth = diagnosticsState?.processHealth || null;
  const releaseHealthCounters = releaseHealth?.counters || {};
  const crashFreeSessionPercent = releaseHealth?.crashFreeSessionPercent == null
    ? Number.NaN
    : Number(releaseHealth.crashFreeSessionPercent);
  const connectivity = getConnectivityPresentation(networkState);

  const run = useCallback(async (command, payload = {}, timeoutMs) => {
    setBusyCommand(command);
    setError('');
    try {
      const result = await requestMobileAppCommand(command, payload, { timeoutMs });
      if (command.startsWith('update.')) setUpdateState((current) => ({ ...current, ...result }));
      if (command.startsWith('appLock.') || command.startsWith('biometrics.')) setLockState(result);
      if (command.startsWith('diagnostics.')) setDiagnosticsState(result);
      if (command.startsWith('offline.')) setOfflineState(result);
      if (command.startsWith('network.')) setNetworkState(result);
      setStatusMessage('Настройки обновлены');
      if (SUCCESS_HAPTIC_COMMANDS.has(command)) requestActionHaptic('success');
      else if (SELECTION_HAPTIC_COMMANDS.has(command)) requestActionHaptic('selection');
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось выполнить действие Android');
      requestActionHaptic('error');
      return null;
    } finally {
      setBusyCommand('');
    }
  }, []);

  const refreshOfflineInventory = useCallback(async () => {
    setOfflineInventory(await getMobileOfflineCacheInventory());
  }, []);

  useEffect(() => {
    let active = true;
    setBusyCommand('initial');
    Promise.all([
      requestMobileAppCommand('update.getState'),
      requestMobileAppCommand('appLock.getState'),
      requestMobileAppCommand('diagnostics.getState'),
      requestMobileAppCommand('offline.getState'),
      requestMobileAppCommand('network.getState'),
    ]).then(([update, lock, diagnostics, offline, network]) => {
      if (!active) return;
      setUpdateState(update);
      setLockState(lock);
      setDiagnosticsState(diagnostics);
      setOfflineState(offline);
      setNetworkState(network);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Не удалось получить настройки Android');
    }).finally(() => {
      if (active) setBusyCommand('');
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void refreshOfflineInventory();
    const handleMeta = () => void refreshOfflineInventory();
    window.addEventListener(MOBILE_OFFLINE_CACHE_META_EVENT, handleMeta);
    return () => window.removeEventListener(MOBILE_OFFLINE_CACHE_META_EVENT, handleMeta);
  }, [refreshOfflineInventory]);

  const handleBiometricToggle = useCallback(async () => {
    const command = biometricEnabled ? 'biometrics.disable' : 'biometrics.enable';
    const result = await run(command);
    if (result && biometricEnabled) {
      await clearMobileOfflineCache();
      await refreshOfflineInventory();
    }
  }, [biometricEnabled, refreshOfflineInventory, run]);

  const handleClearOfflineCache = useCallback(async () => {
    setBusyCommand('offline.clearWebCache');
    setError('');
    try {
      await clearMobileOfflineCache();
      await refreshOfflineInventory();
      setStatusMessage('Автономные данные удалены с телефона');
      requestActionHaptic('success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось очистить автономные данные');
      requestActionHaptic('error');
    } finally {
      setBusyCommand('');
    }
  }, [refreshOfflineInventory]);

  const handlePrepareOfflineData = useCallback(async () => {
    setBusyCommand('offline.prepare');
    setError('');
    setOfflinePrepareResult(null);
    try {
      const result = await prepareMobileOfflineData({
        dashboard: hasPermission('dashboard.read'),
        tasks: hasPermission('tasks.read'),
        mail: hasPermission('mail.access'),
        tasksManageAll: hasPermission('tasks.manage_all'),
      });
      await refreshOfflineInventory();
      const prepared = result.preparedModules.map((item) => item.label).join(', ');
      const failed = result.failedModules.map((item) => item.label).join(', ');
      setOfflinePrepareResult({
        severity: failed ? 'warning' : 'success',
        message: failed
          ? `Подготовлены списки: ${prepared}. Не удалось подготовить: ${failed}. Проверьте доступ и повторите.`
          : `Для автономного просмотра подготовлены списки: ${prepared}.`,
      });
      requestActionHaptic(failed ? 'selection' : 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось подготовить автономные данные');
      requestActionHaptic('error');
    } finally {
      setBusyCommand('');
    }
  }, [hasPermission, refreshOfflineInventory]);

  return (
    <SectionCard
      title="HUB-IT для Android"
      description="Обновление APK, вход по отпечатку, автономные очереди и безопасная диагностика этого телефона."
    >
      <Stack spacing={1.5} divider={<Divider flexItem />}>
        <Stack spacing={1}>
          <NativeSettingsHeading
            title="Обновление приложения"
            description={`Установлена версия ${updateState?.currentVersion || '—'} (${updateState?.currentBuild || '—'}).`}
          />
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              color={updateAvailable ? 'primary' : updateState?.status === 'error' ? 'error' : 'success'}
              label={updateAvailable ? `Доступна ${updateState.feed.version}` : updateState?.status === 'error' ? 'Ошибка проверки' : 'Состояние версии'}
            />
            <Typography variant="body2" color="text.secondary">
              {updateState?.message || 'Нажмите «Проверить обновление».'}
            </Typography>
          </Stack>
          {['downloading', 'verifying', 'installing'].includes(updateState?.status) ? (
            <LinearProgress variant="determinate" value={updateProgress} aria-label="Ход установки обновления" />
          ) : null}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button disabled={busy} variant="outlined" onClick={() => void run('update.check')} sx={{ minHeight: 44 }}>
              Проверить обновление
            </Button>
            {updateAvailable ? (
              <Button
                disabled={busy}
                variant="contained"
                onClick={() => void run('update.install', {}, 15 * 60 * 1000)}
                sx={{ minHeight: 44 }}
              >
                Обновить до {updateState.feed.version}
              </Button>
            ) : null}
            {updateState?.canOpenInstallerSettings ? (
              <Button disabled={busy} onClick={() => void run('update.openInstallerSettings')} sx={{ minHeight: 44 }}>
                Разрешить установку APK
              </Button>
            ) : null}
          </Stack>
        </Stack>

        <Stack spacing={1}>
          <NativeSettingsHeading
            title="Отпечаток и блокировка"
            description="Отпечаток включается только после обычного входа и 2FA. Секрет защищён системным хранилищем Android."
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
            <Button
              disabled={busy}
              variant={biometricEnabled ? 'outlined' : 'contained'}
              color={biometricEnabled ? 'error' : 'primary'}
              onClick={() => void handleBiometricToggle()}
              sx={{ minHeight: 44 }}
            >
              {biometricEnabled ? 'Отключить отпечаток' : 'Включить вход по отпечатку'}
            </Button>
            <FormControlLabel
              sx={{ m: 0, minHeight: 44 }}
              control={(
                <Switch
                  checked={lockEnabled}
                  disabled={busy || !biometricEnabled}
                  onChange={(event) => void run('appLock.update', {
                    enabled: event.target.checked,
                    timeoutSeconds,
                  })}
                />
              )}
              label="Блокировать приложение после сворачивания"
            />
          </Stack>
          <FormControl size="small" sx={{ maxWidth: 320 }} disabled={busy || !biometricEnabled || !lockEnabled}>
            <InputLabel id="mobile-app-lock-timeout-label">Когда блокировать</InputLabel>
            <Select
              labelId="mobile-app-lock-timeout-label"
              label="Когда блокировать"
              value={timeoutSeconds}
              onChange={(event) => void run('appLock.update', {
                enabled: lockEnabled,
                timeoutSeconds: Number(event.target.value),
              })}
            >
              {LOCK_TIMEOUTS.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
            </Select>
          </FormControl>
        </Stack>

        <Stack spacing={1}>
          <NativeSettingsHeading
            title="Автономные данные"
            description="Очереди повторно отправляются после восстановления сети. Кэш файлов можно очистить отдельно."
          />
          <Typography variant="caption" color="text.secondary">
            Подготовка сохраняет Главную и списки. Чтобы открыть полное письмо или карточку задачи без сети, сначала откройте их при подключении.
          </Typography>
          <Typography variant="body2">
            Ответов в очереди: {offlineState?.pendingReplies ?? '—'} · команд: {offlineState?.pendingCommands ?? '—'} · файлов: {formatBytes(offlineState?.fileCacheBytes)}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip size="small" color={connectivity.color} label={connectivity.label} />
            <Typography variant="caption" color="text.secondary" role="status" aria-live="polite">
              {connectivity.description}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              color={offlineInventory?.ready ? 'success' : 'warning'}
              label={offlineInventory?.ready ? 'Автономный просмотр готов' : 'Автономный просмотр не готов'}
            />
            <Typography variant="caption" color="text.secondary">
              Последняя синхронизация: {formatDateTime(offlineInventory?.lastSyncAt)} · записей: {offlineInventory?.entryCount ?? 0}
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Доступные разделы: {(offlineInventory?.modules || []).map((item) => OFFLINE_MODULE_LABELS[item] || item).join(', ') || 'откройте нужные разделы при наличии сети'}.
          </Typography>
          {offlinePrepareResult ? (
            <Alert severity={offlinePrepareResult.severity} role="status" aria-live="polite">
              {offlinePrepareResult.message}
            </Alert>
          ) : null}
          <Typography variant="caption" color="text.secondary">
            Если уведомления задерживаются при закрытом приложении, проверьте системные ограничения батареи и фоновой работы для HUB-IT.
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button disabled={busy} variant="contained" onClick={() => void handlePrepareOfflineData()} sx={{ minHeight: 44 }}>
              Подготовить автономный режим
            </Button>
            <Button disabled={busy} variant="outlined" onClick={() => void run('network.getState')} sx={{ minHeight: 44 }}>
              Проверить сеть
            </Button>
            <Button disabled={busy} variant="outlined" onClick={() => void run('system.openBackgroundSettings')} sx={{ minHeight: 44 }}>
              Настройки батареи и фона
            </Button>
            <Button disabled={busy} variant="outlined" onClick={() => void run('offline.retryQueues')} sx={{ minHeight: 44 }}>
              Повторить отправку
            </Button>
            <Button disabled={busy} onClick={() => void run('offline.clearFileCache')} sx={{ minHeight: 44 }}>
              Очистить кэш файлов
            </Button>
            <Button disabled={busy} color="error" onClick={() => void handleClearOfflineCache()} sx={{ minHeight: 44 }}>
              Очистить автономные данные
            </Button>
          </Stack>
        </Stack>

        <Stack spacing={1}>
          <NativeSettingsHeading
            title="Диагностика"
            description="Отчёт не содержит переписку, пароли, токены и пользовательские файлы."
          />
          <Typography variant="body2">Служебных событий: {diagnosticsState?.eventCount ?? '—'}</Typography>
          <Typography variant="body2" role="status" aria-live="polite">
            {formatAndroidProcessHealth(processHealth)}
          </Typography>
          {releaseHealth ? (
            <Stack spacing={0.5}>
              <Typography variant="body2">
                Локальная стабильность: {Number.isFinite(crashFreeSessionPercent)
                  ? `${crashFreeSessionPercent.toLocaleString('ru-RU')}% сессий без UI-сбоя`
                  : 'недостаточно данных'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Сессий: {releaseHealthCounters.sessions_started ?? 0} · push получено: {releaseHealthCounters.push_received ?? 0} · восстановлений сети: {releaseHealthCounters.offline_recovered ?? 0}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Push-регистрация: {releaseHealthCounters.push_registration_succeeded ?? 0} успешно / {releaseHealthCounters.push_registration_failed ?? 0} ошибок · очередь сейчас: {releaseHealth.queueDepth?.total ?? 0}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Обновление: установщик открыт {releaseHealthCounters.update_installer_opened ?? 0} · завершено после перезапуска {releaseHealthCounters.update_completed ?? 0} · ошибок {releaseHealthCounters.update_flow_failed ?? 0}
              </Typography>
            </Stack>
          ) : null}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button disabled={busy} variant="outlined" onClick={() => void run('diagnostics.share')} sx={{ minHeight: 44 }}>
              Поделиться отчётом
            </Button>
            <Button disabled={busy} color="error" onClick={() => void run('diagnostics.clear')} sx={{ minHeight: 44 }}>
              Очистить диагностику
            </Button>
          </Stack>
        </Stack>

        <Stack spacing={0.75} role="status" aria-live="polite">
          {busy ? <LinearProgress aria-label="Выполняется действие Android" /> : null}
          {statusMessage && !error ? <Typography variant="caption" color="success.main">{statusMessage}</Typography> : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </Stack>
    </SectionCard>
  );
}
