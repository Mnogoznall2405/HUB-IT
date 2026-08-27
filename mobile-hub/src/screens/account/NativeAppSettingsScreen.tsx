import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatApiError } from '../../api/formatError';
import { useAuth } from '../../auth/AuthContext';
import { useNativeCommands } from '../../native/useNativeCommands';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import {
  AccountPrimaryButton,
  AccountScreenScaffold,
  AccountSecondaryButton,
  AccountSectionCard,
  AccountStatusText,
} from './AccountChrome';
import { goBackOrReplace } from './accountBack';

function formatBytes(value: unknown): string {
  const bytes = Math.max(0, Number(value || 0));
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

type CommandState = Record<string, unknown>;

const SNAPSHOT_SCOPE_LABELS: Record<string, string> = {
  dashboard: 'главная',
  'tasks-inbox': 'список задач',
  'task-details': 'задачи',
  'mail-inbox': 'список писем',
  'mail-message-details': 'письма',
  'mail-conversation-details': 'переписки',
  notifications: 'уведомления',
  'chat-inbox': 'список чатов',
  'chat-folders': 'папки чатов',
};

function formatSnapshotTime(value: unknown): string {
  const timestamp = Number(value || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'ещё не выполнялась';
  return new Date(timestamp).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function NativeAppSettingsScreen() {
  const { user, hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const { execute } = useNativeCommands();
  const [updateState, setUpdateState] = useState<CommandState | null>(null);
  const [offlineState, setOfflineState] = useState<CommandState | null>(null);
  const [diagnosticsState, setDiagnosticsState] = useState<CommandState | null>(null);
  const [networkState, setNetworkState] = useState<CommandState | null>(null);
  const [busyCommands, setBusyCommands] = useState<string[]>([]);
  const [status, setStatus] = useState({ error: '', message: '' });

  const setCommandBusy = useCallback((command: string, active: boolean) => {
    setBusyCommands((current) => {
      if (active) return current.includes(command) ? current : [...current, command];
      return current.filter((item) => item !== command);
    });
  }, []);

  const run = useCallback(async (command: Parameters<typeof execute>[0], payload: Record<string, unknown> = {}) => {
    setCommandBusy(command, true);
    setStatus({ error: '', message: '' });
    try {
      const result = await execute(command, payload) as CommandState;
      if (command.startsWith('update.')) setUpdateState((current) => ({ ...(current || {}), ...result }));
      if (command.startsWith('offline.')) setOfflineState(result);
      if (command.startsWith('diagnostics.')) setDiagnosticsState(result);
      if (command.startsWith('network.')) setNetworkState(result);
      setStatus({ error: '', message: 'Готово.' });
      return result;
    } catch (error) {
      setStatus({ error: formatApiError(error, 'Не удалось выполнить действие Android.'), message: '' });
      return null;
    } finally {
      setCommandBusy(command, false);
    }
  }, [execute, setCommandBusy]);

  useEffect(() => {
    void (async () => {
      setCommandBusy('initial', true);
      try {
        const [update, offline, diagnostics, network] = await Promise.all([
          execute('update.getState'),
          execute('offline.getState'),
          execute('diagnostics.getState'),
          execute('network.getState'),
        ]);
        setUpdateState(update as CommandState);
        setOfflineState(offline as CommandState);
        setDiagnosticsState(diagnostics as CommandState);
        setNetworkState(network as CommandState);
      } catch (error) {
        setStatus({ error: formatApiError(error, 'Не удалось получить настройки Android.'), message: '' });
      } finally {
        setCommandBusy('initial', false);
      }
    })();
  }, [execute, setCommandBusy]);

  const updateAvailable = updateState?.status === 'available' && Boolean(updateState?.feed);
  const feed = updateState?.feed as { version?: string } | undefined;
  const releaseHealth = diagnosticsState?.releaseHealth as {
    crashFreeSessionPercent?: number;
    counters?: Record<string, number>;
    queueDepth?: { total?: number };
  } | undefined;
  const snapshotScopes = Array.isArray(offlineState?.snapshotScopes)
    ? offlineState.snapshotScopes.map(String)
    : [];
  const snapshotLabels = snapshotScopes.map((scope) => SNAPSHOT_SCOPE_LABELS[scope] || scope);
  const canPrepareDashboard = hasPermission('dashboard.read');
  const canPrepareTasks = hasPermission('tasks.read');
  const canPrepareMail = hasPermission('mail.access');
  const canPrepareAnything = canPrepareDashboard || canPrepareTasks || canPrepareMail;
  const initializing = busyCommands.includes('initial');
  const commandBusy = (command: string) => busyCommands.includes(command);

  const prepareOffline = useCallback(async () => {
    const result = await run('offline.prepareNative', {
      dashboard: canPrepareDashboard,
      tasks: canPrepareTasks,
      mail: canPrepareMail,
      tasksManageAll: String(user?.role || '').trim().toLowerCase() === 'admin' || hasPermission('tasks.manage_all'),
    });
    if (!result) return;
    const prepared = Array.isArray(result.preparedModules) ? result.preparedModules.map(String) : [];
    const failed = Array.isArray(result.failedModules) ? result.failedModules.map(String) : [];
    setStatus({
      error: failed.length
        ? `Сохранено: ${prepared.join(', ') || 'ничего'}. Не удалось: ${failed.join(', ')}.`
        : '',
      message: failed.length ? '' : `Автономные данные подготовлены: ${prepared.join(', ')}.`,
    });
  }, [canPrepareDashboard, canPrepareMail, canPrepareTasks, hasPermission, run, user?.role]);

  return (
    <AccountScreenScaffold
      title="Приложение"
      tokens={tokens}
      onBack={() => goBackOrReplace('/(shell)/menu/settings')}
    >
      <AccountStatusText tokens={tokens} error={status.error} message={status.message} />
      <AccountSectionCard
        tokens={tokens}
        title="Обновление APK"
        description={`Установлена версия ${String(updateState?.currentVersion || '—')} (${String(updateState?.currentBuild || '—')}).`}
      >
        <Text style={{ color: tokens.textSecondary, marginBottom: 10 }}>
          {String(updateState?.message || 'Нажмите «Проверить обновление».')}
        </Text>
        <View style={styles.actions}>
          <AccountSecondaryButton
            tokens={tokens}
            testID="native-app-check-update"
            disabled={initializing}
            loading={commandBusy('update.check')}
            label="Проверить обновление"
            onPress={() => { void run('update.check'); }}
          />
          {updateAvailable ? (
            <AccountPrimaryButton
              tokens={tokens}
              disabled={initializing}
              loading={commandBusy('update.install')}
              label={`Обновить до ${feed?.version || ''}`}
              onPress={() => { void run('update.install'); }}
            />
          ) : null}
          {updateState?.canOpenInstallerSettings ? (
            <AccountSecondaryButton
              tokens={tokens}
              disabled={initializing}
              loading={commandBusy('update.openInstallerSettings')}
              label="Разрешить установку APK"
              onPress={() => { void run('update.openInstallerSettings'); }}
            />
          ) : null}
        </View>
      </AccountSectionCard>

      <AccountSectionCard tokens={tokens} title="Офлайн-данные" description="Сохранённые экраны доступны без сети, очереди отправляются после её восстановления.">
        <Text style={{ color: tokens.textPrimary, marginBottom: 8 }}>
          Ответов в очереди: {String(offlineState?.pendingReplies ?? '—')} · команд: {String(offlineState?.pendingCommands ?? '—')} · файлов: {formatBytes(offlineState?.fileCacheBytes)}
        </Text>
        <Text
          testID="native-offline-readiness"
          accessibilityLiveRegion="polite"
          style={{ color: offlineState?.snapshotReady ? tokens.success : tokens.warning, marginBottom: 6 }}
        >
          {snapshotLabels.length
            ? `Сохранено для офлайн-просмотра: ${snapshotLabels.join(', ')}.`
            : 'Для офлайн-просмотра пока ничего не сохранено.'}
        </Text>
        <Text style={{ color: tokens.textSecondary, marginBottom: 6 }}>
          Последняя синхронизация: {formatSnapshotTime(offlineState?.snapshotLastSyncAt)}.
        </Text>
        <Text style={{ color: tokens.textSecondary, marginBottom: 10 }}>
          Кнопка сохраняет стандартные списки. Отдельное письмо или задачу откройте при наличии интернета, чтобы сохранить их карточку.
        </Text>
        <Text style={{ color: tokens.textSecondary, marginBottom: 10 }}>
          Сеть: {networkState?.online ? 'интернет есть' : networkState?.connected ? 'без интернета' : 'нет подключения'}
        </Text>
        <View style={styles.actions}>
          <AccountPrimaryButton
            tokens={tokens}
            disabled={initializing || offlineMode || !canPrepareAnything}
            loading={commandBusy('offline.prepareNative')}
            label="Подготовить автономный режим"
            onPress={() => { void prepareOffline(); }}
          />
          <AccountSecondaryButton testID="native-app-check-network" tokens={tokens} disabled={initializing} loading={commandBusy('network.getState')} label="Проверить сеть" onPress={() => { void run('network.getState'); }} />
          <AccountSecondaryButton tokens={tokens} disabled={initializing} loading={commandBusy('system.openBackgroundSettings')} label="Настройки батареи и фона" onPress={() => { void run('system.openBackgroundSettings'); }} />
          <AccountSecondaryButton tokens={tokens} disabled={initializing} loading={commandBusy('offline.retryQueues')} label="Повторить отправку" onPress={() => { void run('offline.retryQueues'); }} />
          <AccountSecondaryButton tokens={tokens} disabled={initializing} loading={commandBusy('offline.clearFileCache')} label="Очистить кэш файлов" onPress={() => { void run('offline.clearFileCache'); }} />
        </View>
      </AccountSectionCard>

      <AccountSectionCard tokens={tokens} title="Диагностика" description="Отчёт не содержит переписку, пароли и токены.">
        <Text style={{ color: tokens.textPrimary, marginBottom: 6 }}>
          Служебных событий: {String(diagnosticsState?.eventCount ?? '—')}
        </Text>
        {releaseHealth ? (
          <Text style={{ color: tokens.textSecondary, marginBottom: 10 }}>
            Стабильность: {releaseHealth.crashFreeSessionPercent == null
              ? 'недостаточно данных'
              : `${releaseHealth.crashFreeSessionPercent}% сессий без UI-сбоя`}
            {' · '}очередь: {releaseHealth.queueDepth?.total ?? 0}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <AccountSecondaryButton tokens={tokens} disabled={initializing} loading={commandBusy('diagnostics.share')} label="Поделиться отчётом" onPress={() => { void run('diagnostics.share'); }} />
          <AccountSecondaryButton tokens={tokens} danger disabled={initializing} loading={commandBusy('diagnostics.clear')} label="Очистить диагностику" onPress={() => { void run('diagnostics.clear'); }} />
        </View>
      </AccountSectionCard>
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 8 },
});
