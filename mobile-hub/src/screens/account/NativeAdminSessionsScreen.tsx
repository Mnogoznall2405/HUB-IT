import { useNativeAdminData } from './useNativeAdminData';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
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

const adminScreenReady = async () => true;
export function NativeAdminSessionsScreen() {
  const access = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const lifecycle = useNativeAdminData('sessions', adminScreenReady);
  if (!lifecycle.ready) return <AccountScreenScaffold title="Администрирование" tokens={tokens} onBack={() => goBackOrReplace('/(shell)/menu/admin')}><Text style={{ color: tokens.textSecondary }}>Раздел доступен при наличии прав и подключения к сети.</Text></AccountScreenScaffold>;
  return <NativeAdminSessionsScreenContent key={`${access.user?.id}:${access.user?.role}`} />;
}
function NativeAdminSessionsScreenContent() {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

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
    if (!mounted.current) return;
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
            if (!mounted.current) return;
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
      if (!mounted.current) return;
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
            if (!mounted.current) return;
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
      scroll={false}
    >
      <FlatList data={sessions} keyExtractor={item => item.session_id} initialNumToRender={12} maxToRenderPerBatch={10} windowSize={7}
        refreshing={loading} onRefresh={() => { void load(); }}
        ListHeaderComponent={<View>
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
      </View>} ListEmptyComponent={loading ? <AccountLoading tokens={tokens} /> : null}
        renderItem={({ item }) => (
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
            if (!mounted.current) return;
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
        )} />
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 8 },
  row: { borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 8 },
});
