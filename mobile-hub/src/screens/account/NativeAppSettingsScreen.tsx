import { useCallback, useEffect, useState } from 'react';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { formatApiError } from '../../api/formatError';
import { useAuth } from '../../auth/AuthContext';
import { useNativeCommands } from '../../native/useNativeCommands';
import type { OfflinePreparationProgressEvent } from '../../offline/nativeOfflinePreparation';
import type { NativeOfflineCoverageEntry } from '../../offline/nativeOfflineCoverage';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import { hasPendingMobileUpdate } from '../../updates/useMobileUpdater';
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

type OfflinePreparationDisplayState = {
  completedModules: number;
  totalModules: number;
  items: OfflinePreparationProgressEvent[];
};

function formatPreparationMetric(item: OfflinePreparationProgressEvent): string {
  if (item.status === 'loading') return 'Загружается…';
  if (item.status === 'failed') return item.errorMessage || 'Не загружено';
  const loaded = Math.max(0, Number(item.loaded || 0));
  const total = item.total == null ? null : Math.max(0, Number(item.total || 0));
  if (total != null) return `${loaded} из ${total}${item.unit ? ` ${item.unit}` : ''}`;
  return `${loaded}${item.unit ? ` ${item.unit}` : ''}`;
}

const SNAPSHOT_SCOPE_LABELS: Record<string, string> = {
  dashboard: 'главная',
  'feed-inbox': 'лента',
  'feed-post-details': 'публикации',
  'tasks-inbox': 'список задач',
  'task-details': 'задачи',
  'mail-inbox': 'список писем',
  'mail-message-details': 'письма',
  'mail-conversation-details': 'переписки',
  notifications: 'уведомления',
  'chat-inbox': 'список чатов',
  'chat-folders': 'папки чатов',
  'chat-thread-details': 'сообщения чатов',
  'address-book': 'адресная книга',
  'docflow-inbox': 'задания 1С ДО',
  'docflow-task-details': 'карточки 1С ДО',
  'database-bootstrap': 'базы инвентаря',
  'database-inbox': 'список инвентаря',
  'database-catalog': 'полный каталог инвентаря',
  'database-item-details': 'карточки инвентаря',
  'my-files-inbox': 'список файлов',
  'my-file-details': 'предпросмотры файлов',
  'company-structure-tree': 'структура компании',
  'company-structure-people': 'сотрудники подразделений',
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

const OFFLINE_MODULE_LABELS: Record<string, string> = {
  dashboard: 'Главная',
  feed: 'Лента',
  tasks: 'Задачи',
  chat: 'Chat',
  notifications: 'Уведомления',
  mail: 'Почта',
  docflow: '1С ДО',
  addressBook: 'Адресная книга',
  database: 'Инвентарь',
  myFiles: 'Мои файлы',
  companyStructure: 'Структура компании',
};

function formatCoverageTime(value: string | null): string {
  const timestamp = Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp)) return 'нет данных';
  return new Date(timestamp).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatCoverageMetric(item: NativeOfflineCoverageEntry): string {
  const count = item.total == null
    ? `${item.loaded} ${item.unit}`
    : `${item.loaded} из ${item.total} ${item.unit}`;
  if (item.status === 'failed') {
    const previous = item.savedAt ? ` Сохранена копия от ${formatCoverageTime(item.savedAt)}.` : '';
    return `${item.errorMessage || 'Ошибка обновления.'}${previous}`;
  }
  return `${item.status === 'partial' ? 'Частично: ' : ''}${count} · ${formatCoverageTime(item.savedAt)}`;
}

export function NativeAppSettingsScreen() {
  const { user, hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const { execute, updater } = useNativeCommands();
  const [updateState, setUpdateState] = useState<CommandState | null>(null);
  const [offlineState, setOfflineState] = useState<CommandState | null>(null);
  const [diagnosticsState, setDiagnosticsState] = useState<CommandState | null>(null);
  const [networkState, setNetworkState] = useState<CommandState | null>(null);
  const [offlinePreparation, setOfflinePreparation] = useState<OfflinePreparationDisplayState | null>(null);
  const [busyCommands, setBusyCommands] = useState<string[]>([]);
  const [status, setStatus] = useState({ error: '', message: '' });

  const setCommandBusy = useCallback((command: string, active: boolean) => {
    setBusyCommands((current) => {
      if (active) return current.includes(command) ? current : [...current, command];
      return current.filter((item) => item !== command);
    });
  }, []);

  const run = useCallback(async (
    command: Parameters<typeof execute>[0],
    payload: Record<string, unknown> = {},
    executionOptions: Parameters<typeof execute>[2] = {},
  ) => {
    setCommandBusy(command, true);
    setStatus({ error: '', message: '' });
    try {
      const result = await execute(command, payload, executionOptions) as CommandState;
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

  useEffect(() => {
    if (updater?.state) setUpdateState(updater.state as unknown as CommandState);
  }, [updater?.state]);

  const updateAvailable = Boolean(updater?.state && hasPendingMobileUpdate(updater.state))
    && ['available', 'paused', 'ready', 'error'].includes(String(updateState?.status || ''));
  const updateBusy = ['downloading', 'verifying', 'installing'].includes(String(updateState?.status || ''));
  const feed = updateState?.feed as { version?: string } | undefined;
  const updateActionLabel = updateState?.status === 'paused'
    ? 'Продолжить'
    : updateState?.status === 'ready' ? 'Установить' : `Обновить до ${feed?.version || ''}`;
  const releaseHealth = diagnosticsState?.releaseHealth as {
    crashFreeSessionPercent?: number;
    counters?: Record<string, number>;
    queueDepth?: { total?: number };
  } | undefined;
  const snapshotScopes = Array.isArray(offlineState?.snapshotScopes)
    ? offlineState.snapshotScopes.map(String)
    : [];
  const snapshotLabels = snapshotScopes.map((scope) => SNAPSHOT_SCOPE_LABELS[scope] || scope);
  const snapshotMissingScopes = Array.isArray(offlineState?.snapshotMissingScopes)
    ? offlineState.snapshotMissingScopes.map(String)
    : [];
  const snapshotMissingLabels = snapshotMissingScopes.map((scope) => SNAPSHOT_SCOPE_LABELS[scope] || scope);
  const offlineCoverageEntries = Array.isArray(offlineState?.offlineCoverage)
    ? (offlineState.offlineCoverage as NativeOfflineCoverageEntry[])
      .filter((item) => Boolean(item?.moduleId))
      .sort((left, right) => Object.keys(OFFLINE_MODULE_LABELS).indexOf(left.moduleId)
        - Object.keys(OFFLINE_MODULE_LABELS).indexOf(right.moduleId))
    : [];
  const canPrepareDashboard = hasPermission('dashboard.read');
  const canPrepareTasks = hasPermission('tasks.read');
  const canPrepareChat = hasPermission('chat.read');
  const canPrepareMail = hasPermission('mail.access');
  const canPrepareDocflow = hasPermission('docflow.read');
  const canPrepareAddressBook = hasPermission('address_book.read');
  const canPrepareDatabase = hasPermission('database.read');
  const canPrepareMyFiles = hasPermission('my_files.read');
  const canPrepareCompanyStructure = hasPermission('company_structure.read');
  const canPrepareNotifications = canPrepareDashboard || canPrepareTasks || canPrepareChat || canPrepareMail;
  const canPrepareAnything = canPrepareDashboard || canPrepareTasks || canPrepareChat || canPrepareMail || canPrepareDocflow || canPrepareAddressBook || canPrepareDatabase || canPrepareMyFiles || canPrepareCompanyStructure;
  const initializing = busyCommands.includes('initial');
  const commandBusy = (command: string) => busyCommands.includes(command);
  const offlinePreparationPercent = offlinePreparation?.totalModules
    ? Math.round((offlinePreparation.completedModules / offlinePreparation.totalModules) * 100)
    : 0;

  const handleOfflinePreparationProgress = useCallback((event: OfflinePreparationProgressEvent) => {
    setOfflinePreparation((current) => {
      const items = current?.items ? [...current.items] : [];
      const existingIndex = items.findIndex((item) => item.key === event.key);
      if (existingIndex >= 0) items[existingIndex] = event;
      else items.push(event);
      return {
        completedModules: event.completedModules,
        totalModules: event.totalModules,
        items,
      };
    });
  }, []);

  const prepareOffline = useCallback(async () => {
    setOfflinePreparation({ completedModules: 0, totalModules: 0, items: [] });
    const result = await run('offline.prepareNative', {
      dashboard: canPrepareDashboard,
      feed: canPrepareDashboard,
      tasks: canPrepareTasks,
      chat: canPrepareChat,
      notifications: canPrepareNotifications,
      mail: canPrepareMail,
      docflow: canPrepareDocflow,
      addressBook: canPrepareAddressBook,
      database: canPrepareDatabase,
      myFiles: canPrepareMyFiles,
      companyStructure: canPrepareCompanyStructure,
      tasksManageAll: String(user?.role || '').trim().toLowerCase() === 'admin' || hasPermission('tasks.manage_all'),
    }, {
      onOfflinePreparationProgress: handleOfflinePreparationProgress,
    });
    if (!result) return;
    const prepared = Array.isArray(result.preparedModules) ? result.preparedModules.map(String) : [];
    const failed = Array.isArray(result.failedModules) ? result.failedModules.map(String) : [];
    const missing = Array.isArray(result.snapshotMissingScopes)
      ? result.snapshotMissingScopes.map((scope) => SNAPSHOT_SCOPE_LABELS[String(scope)] || String(scope))
      : [];
    const verificationFailed = result.snapshotReady === false;
    const notReady = [...new Set([...failed, ...missing])];
    setStatus({
      error: failed.length || verificationFailed
        ? `Сохранено: ${prepared.join(', ') || 'ничего'}. Не готово: ${notReady.join(', ') || 'проверьте целостность кэша'}.`
        : '',
      message: failed.length || verificationFailed ? '' : `Автономные данные подготовлены: ${prepared.join(', ')}.`,
    });
  }, [canPrepareAddressBook, canPrepareChat, canPrepareCompanyStructure, canPrepareDashboard, canPrepareDatabase, canPrepareDocflow, canPrepareMail, canPrepareMyFiles, canPrepareNotifications, canPrepareTasks, handleOfflinePreparationProgress, hasPermission, run, user?.role]);

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
        {updateState?.status === 'downloading' || updateState?.status === 'paused' ? (
          <View
            testID="native-app-update-progress"
            accessible
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(Number(updateState.progress || 0) * 100) }}
            style={styles.updateProgress}
          >
            <View style={[styles.updateTrack, { backgroundColor: tokens.actionBg }]}>
              <View style={[
                styles.updateValue,
                { backgroundColor: tokens.primary, width: `${Math.round(Number(updateState.progress || 0) * 100)}%` },
              ]}
              />
            </View>
            <Text style={{ color: tokens.textSecondary, fontSize: 12, textAlign: 'right' }}>
              {Math.round(Number(updateState.progress || 0) * 100)}% · {formatBytes(updateState.bytesWritten)} из {formatBytes(updateState.totalBytes)}
            </Text>
          </View>
        ) : null}
        <View style={styles.actions}>
          <AccountSecondaryButton
            tokens={tokens}
            testID="native-app-check-update"
            disabled={initializing || updateBusy}
            loading={commandBusy('update.check')}
            label="Проверить обновление"
            onPress={() => { void run('update.check'); }}
          />
          {updateAvailable ? (
            <AccountPrimaryButton
              tokens={tokens}
              disabled={initializing || updateBusy}
              loading={commandBusy('update.install')}
              label={updateActionLabel}
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
          {offlineState?.snapshotReady
            ? `Сохранено для офлайн-просмотра: ${snapshotLabels.join(', ')}.`
            : snapshotLabels.length
              ? `Сохранено частично: ${snapshotLabels.join(', ')}. Не хватает: ${snapshotMissingLabels.join(', ') || 'обязательных данных'}.`
              : `Офлайн-данные не готовы. Не хватает: ${snapshotMissingLabels.join(', ') || 'сохранённых разделов'}.`}
        </Text>
        <Text style={{ color: tokens.textSecondary, marginBottom: 6 }}>
          Последняя синхронизация: {formatSnapshotTime(offlineState?.snapshotLastSyncAt)}.
        </Text>
        {offlineCoverageEntries.length > 0 ? (
          <View testID="native-offline-coverage" style={[styles.offlineCoverageCard, { backgroundColor: tokens.panelInset, borderColor: tokens.borderSoft }]}>
            <Text style={[styles.offlineProgressTitle, { color: tokens.textPrimary }]}>Состояние разделов</Text>
            {offlineCoverageEntries.map((item) => {
              const failed = item.status === 'failed';
              const partial = item.status === 'partial';
              const stateColor = failed ? tokens.error : partial ? tokens.warning : tokens.success;
              return (
                <View key={item.moduleId} testID={`native-offline-coverage-${item.moduleId}`} style={[styles.offlineCoverageRow, { borderTopColor: tokens.borderSoft }]}>
                  <MaterialCommunityIcons
                    name={failed ? 'alert-circle-outline' : partial ? 'progress-clock' : 'check-circle'}
                    size={19}
                    color={stateColor}
                  />
                  <View style={styles.offlineCoverageText}>
                    <Text style={[styles.offlineCoverageModule, { color: tokens.textPrimary }]}>
                      {OFFLINE_MODULE_LABELS[item.moduleId] || item.moduleId}
                    </Text>
                    <Text accessibilityLiveRegion="polite" style={[styles.offlineCoverageMetric, { color: stateColor }]}>
                      {formatCoverageMetric(item)}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}
        <Text style={{ color: tokens.textSecondary, marginBottom: 10 }}>
          Кнопка сохраняет стандартные списки. Отдельное письмо, задачу или карточку инвентаря откройте при наличии интернета, чтобы сохранить подробности.
        </Text>
        <Text style={{ color: tokens.textSecondary, marginBottom: 10 }}>
          Сеть: {!offlineMode && user
            ? 'HUB доступен'
            : networkState?.connected ? 'подключение есть, HUB недоступен' : 'нет подключения'}
        </Text>
        {offlinePreparation?.totalModules ? (
          <View
            testID="native-offline-preparation-progress"
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel="Подготовка автономных данных"
            accessibilityValue={{ min: 0, max: 100, now: offlinePreparationPercent }}
            style={[styles.offlineProgressCard, { backgroundColor: tokens.panelInset, borderColor: tokens.borderSoft }]}
          >
            <View style={styles.offlineProgressHeader}>
              <View style={styles.offlineProgressHeading}>
                <Text style={[styles.offlineProgressTitle, { color: tokens.textPrimary }]}>Подготовка данных</Text>
                <Text accessibilityLiveRegion="polite" style={[styles.offlineProgressCaption, { color: tokens.textSecondary }]}>
                  {offlinePreparation.completedModules} из {offlinePreparation.totalModules} разделов
                </Text>
              </View>
              <Text style={[styles.offlineProgressPercent, { color: tokens.primary }]}>{offlinePreparationPercent}%</Text>
            </View>
            <View style={[styles.offlineProgressTrack, { backgroundColor: tokens.actionBg }]}>
              <View style={[styles.offlineProgressValue, { backgroundColor: tokens.primary, width: `${offlinePreparationPercent}%` }]} />
            </View>
            <View style={styles.offlineProgressItems}>
              {offlinePreparation.items.map((item) => {
                const completed = item.status === 'completed';
                const failed = item.status === 'failed';
                const stateColor = completed ? tokens.success : failed ? tokens.error : tokens.primary;
                return (
                  <View
                    key={item.key}
                    testID={`native-offline-progress-${item.key}`}
                    style={[styles.offlineProgressRow, { backgroundColor: tokens.panelSolid }]}
                  >
                    <View style={[styles.offlineProgressIcon, { backgroundColor: completed ? tokens.accentSoft : tokens.actionBg }]}>
                      {item.status === 'loading' ? (
                        <ActivityIndicator size="small" color={tokens.primary} />
                      ) : (
                        <MaterialCommunityIcons name={completed ? 'check-circle' : 'alert-circle-outline'} size={20} color={stateColor} />
                      )}
                    </View>
                    <Text numberOfLines={1} style={[styles.offlineProgressModule, { color: tokens.textPrimary }]}>{item.label}</Text>
                    <Text numberOfLines={2} style={[styles.offlineProgressMetric, { color: stateColor }]}>{formatPreparationMetric(item)}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}
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
  updateProgress: { gap: 6, marginBottom: 12 },
  updateTrack: { height: 5, borderRadius: 3, overflow: 'hidden' },
  updateValue: { height: 5, borderRadius: 3 },
  offlineProgressCard: { marginBottom: 12, borderWidth: 1, borderRadius: 18, padding: 8, gap: 8 },
  offlineProgressHeader: { minHeight: 42, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', gap: 12 },
  offlineProgressHeading: { flex: 1, minWidth: 0 },
  offlineProgressTitle: { fontSize: 15, lineHeight: 20, fontWeight: '900' },
  offlineProgressCaption: { marginTop: 1, fontSize: 12, lineHeight: 16, fontVariant: ['tabular-nums'] },
  offlineProgressPercent: { fontSize: 16, lineHeight: 21, fontWeight: '900', fontVariant: ['tabular-nums'] },
  offlineProgressTrack: { height: 6, marginHorizontal: 6, borderRadius: 3, overflow: 'hidden' },
  offlineProgressValue: { height: 6, borderRadius: 3 },
  offlineProgressItems: { gap: 6 },
  offlineProgressRow: { minHeight: 48, borderRadius: 10, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 9 },
  offlineProgressIcon: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  offlineProgressModule: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  offlineProgressMetric: { maxWidth: '52%', flexShrink: 1, textAlign: 'right', fontSize: 11, lineHeight: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  offlineCoverageCard: { marginBottom: 10, borderWidth: 1, borderRadius: 14, padding: 10, gap: 6 },
  offlineCoverageRow: { minHeight: 46, paddingTop: 7, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  offlineCoverageText: { flex: 1, minWidth: 0 },
  offlineCoverageModule: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  offlineCoverageMetric: { marginTop: 1, fontSize: 11, lineHeight: 15, fontWeight: '700' },
});
