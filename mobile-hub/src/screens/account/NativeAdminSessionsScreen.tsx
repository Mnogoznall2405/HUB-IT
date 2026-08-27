import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { SESSION_STATUS_META } from '../../account/accountConstants';
import { formatDateTime } from '../../account/accountFormat';
import { canAccessAdminSection } from '../../account/accountNavigation';
import * as sessionsApi from '../../api/authSessionsApi';
import { formatApiError } from '../../api/formatError';
import { useAuth } from '../../auth/AuthContext';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import {
  AccountLoading,
  AccountScreenScaffold,
  AccountSecondaryButton,
  AccountSectionCard,
  AccountStatusText,
} from './AccountChrome';
import { goBackOrReplace } from './accountBack';

export function NativeAdminSessionsScreen() {
  const { user, hasPermission } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const allowed = canAccessAdminSection('sessions', { user, hasPermission });
  const [sessions, setSessions] = useState<sessionsApi.AuthSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [cleanup, setCleanup] = useState<sessionsApi.SessionCleanupResult>({});
  const [status, setStatus] = useState({ error: '', message: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSessions(await sessionsApi.listSessions());
    } catch (error) {
      setStatus({ error: formatApiError(error, 'Не удалось загрузить сессии.'), message: '' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const activeCount = useMemo(
    () => sessions.filter((item) => item.status === 'active').length,
    [sessions],
  );

  const runMaintenance = useCallback((
    title: string,
    action: () => Promise<sessionsApi.SessionCleanupResult>,
    success: (result: sessionsApi.SessionCleanupResult) => string,
    key: string,
  ) => {
    Alert.alert(title, 'Продолжить?', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Выполнить',
        onPress: () => {
          void (async () => {
            setBusy(key);
            try {
              const result = await action();
              setCleanup(result);
              setStatus({ error: '', message: success(result) });
              await load();
            } catch (error) {
              setStatus({ error: formatApiError(error, 'Не удалось выполнить действие.'), message: '' });
            } finally {
              setBusy('');
            }
          })();
        },
      },
    ]);
  }, [load]);

  const previewSessionLimit = useCallback(async () => {
    if (busy) return;
    setBusy('normalize-preview');
    setStatus({ error: '', message: '' });
    try {
      const preview = await sessionsApi.normalizeSessionLimit(false);
      setCleanup(preview);
      const sessionsToClose = Number(preview.sessions_to_close || 0);
      const usersAffected = Number(preview.users_affected || 0);
      if (sessionsToClose <= 0) {
        setStatus({ error: '', message: 'Лимит уже соблюдён. Закрывать сессии не требуется.' });
        return;
      }
      Alert.alert(
        'Применить нормализацию?',
        `Будет закрыто сессий: ${sessionsToClose}. Пользователей затронуто: ${usersAffected}.`,
        [
          { text: 'Отмена', style: 'cancel' },
          {
            text: 'Закрыть сессии',
            style: 'destructive',
            onPress: () => {
              setBusy('normalize');
              void sessionsApi.normalizeSessionLimit(true)
                .then(async (result) => {
                  setCleanup(result);
                  setStatus({ error: '', message: `Закрыто излишних сессий: ${result.sessions_closed ?? 0}.` });
                  await load();
                })
                .catch((error) => {
                  setStatus({ error: formatApiError(error, 'Не удалось нормализовать лимит.'), message: '' });
                })
                .finally(() => setBusy(''));
            },
          },
        ],
      );
    } catch (error) {
      setStatus({ error: formatApiError(error, 'Не удалось проверить лимит сессий.'), message: '' });
    } finally {
      setBusy((current) => current === 'normalize-preview' ? '' : current);
    }
  }, [busy, load]);

  if (!allowed) {
    return (
      <AccountScreenScaffold title="Сессии" tokens={tokens} onBack={() => goBackOrReplace('/(shell)/menu/admin')}>
        <AccountSectionCard tokens={tokens} title="Нет доступа" description="Нужно право settings.sessions.manage.">
          {null}
        </AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  return (
    <AccountScreenScaffold
      title="Сессии"
      tokens={tokens}
      onBack={() => goBackOrReplace('/(shell)/menu/admin')}
      onRefresh={() => { void load(); }}
      refreshing={loading}
    >
      <AccountStatusText tokens={tokens} error={status.error} message={status.message} />
      <AccountSectionCard tokens={tokens} title="Обслуживание">
        <Text style={{ color: tokens.textSecondary, marginBottom: 8 }}>
          Активных: {activeCount}. Cleanup: удалено {cleanup.deleted ?? 0}, деактивировано {cleanup.deactivated ?? 0}.
        </Text>
        <View style={styles.actions}>
          <AccountSecondaryButton
            tokens={tokens}
            disabled={Boolean(busy)}
            loading={busy === 'cleanup'}
            label="Очистить устаревшие"
            onPress={() => runMaintenance(
              'Очистить устаревшие сессии?',
              () => sessionsApi.cleanupSessions(),
              (result) => `Очистка: удалено ${result.deleted ?? 0}, деактивировано ${result.deactivated ?? 0}.`,
              'cleanup',
            )}
          />
          <AccountSecondaryButton
            tokens={tokens}
            danger
            disabled={Boolean(busy)}
            loading={busy === 'purge'}
            label="Удалить неактивные"
            onPress={() => runMaintenance(
              'Удалить неактивные сессии?',
              () => sessionsApi.purgeInactiveSessions(),
              (result) => `Удалены неактивные сессии: ${result.deleted ?? 0}.`,
              'purge',
            )}
          />
          <AccountSecondaryButton
            tokens={tokens}
            disabled={Boolean(busy)}
            loading={busy === 'normalize-preview' || busy === 'normalize'}
            label="Проверить лимит сессий"
            onPress={() => { void previewSessionLimit(); }}
          />
        </View>
      </AccountSectionCard>
      {loading && sessions.length === 0 ? <AccountLoading tokens={tokens} /> : sessions.map((item) => (
        <View key={item.session_id} style={[styles.row, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
          <Text style={{ color: tokens.textPrimary, fontWeight: '800' }}>{item.username}</Text>
          <Text style={{ color: tokens.textSecondary, fontSize: 12 }}>
            {item.device_label || 'Устройство'} · {SESSION_STATUS_META[item.status || 'terminated']?.label || item.status}
          </Text>
          <Text style={{ color: tokens.textSecondary, fontSize: 12 }}>IP: {item.ip_address || '—'}</Text>
          <Text style={{ color: tokens.textSecondary, fontSize: 12 }}>Создана: {formatDateTime(item.created_at)}</Text>
          <Text style={{ color: tokens.textSecondary, fontSize: 12 }}>Активность: {formatDateTime(item.last_seen_at)}</Text>
          {item.status === 'active' && item.is_active !== false ? <View style={{ marginTop: 8 }}>
            <AccountSecondaryButton
              tokens={tokens}
              danger
              disabled={Boolean(busy)}
              label="Завершить"
              onPress={() => {
                Alert.alert('Завершить сессию?', item.username, [
                  { text: 'Отмена', style: 'cancel' },
                  {
                    text: 'Завершить',
                    style: 'destructive',
                    onPress: () => {
                      void (async () => {
                        try {
                          await sessionsApi.terminateSession(item.session_id);
                          setStatus({ error: '', message: 'Сессия завершена.' });
                          await load();
                        } catch (error) {
                          setStatus({ error: formatApiError(error, 'Не удалось завершить сессию.'), message: '' });
                        }
                      })();
                    },
                  },
                ]);
              }}
            />
          </View> : null}
        </View>
      ))}
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 8 },
  row: { borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 8 },
});
