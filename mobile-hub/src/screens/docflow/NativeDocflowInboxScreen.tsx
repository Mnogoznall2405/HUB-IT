import { NativeModal as Modal } from '../../components/ui/NativeModal';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  type ListRenderItemInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  deleteDocflowCredentials,
  getDocflowProfile,
  listDocflowTasks,
  saveDocflowCredentials,
  testDocflowCredentials,
  type DocflowCredentialProfile,
  type DocflowScope,
  type DocflowTaskList,
  type DocflowTaskSummary,
} from '../../api/docflowApi';
import { useAuth } from '../../auth/AuthContext';
import {
  readNativeCollectionSnapshot,
  writeNativeCollectionSnapshot,
} from '../../cache/nativeSnapshotCache';
import { NativeDocflowTaskCard } from '../../components/docflow/NativeDocflowTaskCard';
import { HubTextField } from '../../components/ui/HubTextField';
import { resolveNativeDocflowError } from '../../docflow/docflowError';
import {
  DOCFLOW_SCOPE_OPTIONS,
  formatDocflowDate,
} from '../../docflow/nativeDocflowModel';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import { hubRealtimeSocket } from '../../realtime/hubRealtimeSocket';
import {
  AccountPrimaryButton,
  AccountScreenScaffold,
  AccountSecondaryButton,
  AccountSectionCard,
} from '../account/AccountChrome';

const TASK_LIMIT = 50;

type DocflowInboxSnapshot = {
  signature: string;
  profile: DocflowCredentialProfile;
  result: DocflowTaskList;
};

function first(value: string | string[] | undefined): string {
  return String(Array.isArray(value) ? value[0] : value || '').trim();
}

function initialScope(value: string): DocflowScope {
  return ['inbox', 'completed', 'all'].includes(value) ? value as DocflowScope : 'inbox';
}

function profileStatus(profile: DocflowCredentialProfile | null): string {
  if (!profile?.configured) return 'Не подключено';
  return {
    configured: 'Настроено',
    valid: 'Подключено',
    invalid: 'Нужно войти заново',
    unavailable: '1С временно недоступна',
    not_configured: 'Не подключено',
  }[profile.status];
}

export function NativeDocflowInboxScreen() {
  const params = useLocalSearchParams<{ scope?: string | string[]; q?: string | string[] }>();
  const { user, hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const canRead = hasPermission('docflow.read');
  const canCreate = hasPermission('docflow.create');
  const [profile, setProfile] = useState<DocflowCredentialProfile | null>(null);
  const [scope, setScope] = useState<DocflowScope>(() => initialScope(first(params.scope)));
  const [queryDraft, setQueryDraft] = useState(() => first(params.q).slice(0, 200));
  const [query, setQuery] = useState(() => first(params.q).slice(0, 200));
  const [tasks, setTasks] = useState<DocflowTaskSummary[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [asOf, setAsOf] = useState('');
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [correlationId, setCorrelationId] = useState('');
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [credentialLogin, setCredentialLogin] = useState('');
  const [credentialPassword, setCredentialPassword] = useState('');
  const [credentialBusy, setCredentialBusy] = useState<'test' | 'save' | 'delete' | ''>('');
  const [credentialError, setCredentialError] = useState('');
  const [credentialNotice, setCredentialNotice] = useState('');
  const profileRequestRef = useRef(0);
  const taskRequestRef = useRef(0);
  const appStateRef = useRef(AppState.currentState);
  const snapshotSignature = useMemo(() => JSON.stringify({ scope, query }), [query, scope]);

  const loadTasks = useCallback(async (nextProfile: DocflowCredentialProfile | null, refresh = false) => {
    if (!canRead || !nextProfile?.configured) {
      setLoadingTasks(false);
      setRefreshing(false);
      return;
    }
    const requestId = ++taskRequestRef.current;
    if (refresh) setRefreshing(true); else setLoadingTasks(true);
    setError('');
    setCorrelationId('');
    const userId = Number(user?.id || 0);
    let cached = false;
    if (!refresh && userId) {
      const snapshot = await readNativeCollectionSnapshot<DocflowInboxSnapshot>(
        'docflow-inbox',
        userId,
        snapshotSignature,
      );
      if (requestId !== taskRequestRef.current) return;
      if (snapshot) {
        cached = true;
        setProfile(snapshot.data.profile);
        setTasks(snapshot.data.result.items);
        setTruncated(snapshot.data.result.truncated);
        setAsOf(snapshot.data.result.as_of);
        setLoadingTasks(false);
      }
    }
    if (offlineMode) {
      if (!cached) setError('Нет подключения и сохранённых заданий 1С ДО.');
      setLoadingTasks(false);
      setRefreshing(false);
      return;
    }
    try {
      const result = await listDocflowTasks({ scope, q: query, limit: TASK_LIMIT });
      if (requestId !== taskRequestRef.current) return;
      setTasks(result.items);
      setTruncated(result.truncated);
      setAsOf(result.as_of);
      if (userId) {
        void writeNativeCollectionSnapshot('docflow-inbox', userId, snapshotSignature, {
          signature: snapshotSignature,
          profile: nextProfile,
          result,
        });
      }
    } catch (cause) {
      if (requestId !== taskRequestRef.current) return;
      const resolved = resolveNativeDocflowError(cause, 'Не удалось загрузить задания из 1С.');
      setError(cached ? 'Нет подключения. Показаны сохранённые задания 1С ДО.' : resolved.message);
      setCorrelationId(resolved.correlationId);
    } finally {
      if (requestId === taskRequestRef.current) {
        setLoadingTasks(false);
        setRefreshing(false);
      }
    }
  }, [canRead, offlineMode, query, scope, snapshotSignature, user?.id]);

  const loadProfile = useCallback(async () => {
    if (!canRead) {
      setLoadingProfile(false);
      return;
    }
    if (offlineMode) {
      const userId = Number(user?.id || 0);
      const snapshot = userId
        ? await readNativeCollectionSnapshot<DocflowInboxSnapshot>('docflow-inbox', userId, snapshotSignature)
        : null;
      if (snapshot) {
        setProfile(snapshot.data.profile);
        setTasks(snapshot.data.result.items);
        setTruncated(snapshot.data.result.truncated);
        setAsOf(snapshot.data.result.as_of);
      } else {
        setError('Нет подключения и сохранённых заданий 1С ДО.');
      }
      setLoadingProfile(false);
      return;
    }
    const requestId = ++profileRequestRef.current;
    setLoadingProfile(true);
    setError('');
    try {
      const next = await getDocflowProfile();
      if (requestId !== profileRequestRef.current) return;
      setProfile(next);
      if (!next.configured) {
        setTasks([]);
        setTruncated(false);
        setAsOf('');
      }
    } catch (cause) {
      if (requestId !== profileRequestRef.current) return;
      const resolved = resolveNativeDocflowError(cause, 'Не удалось проверить подключение к 1С.');
      setError(resolved.message);
      setCorrelationId(resolved.correlationId);
    } finally {
      if (requestId === profileRequestRef.current) {
        setLoadingProfile(false);
      }
    }
  }, [canRead, offlineMode, snapshotSignature, user?.id]);

  const refreshAll = useCallback(async () => {
    if (!canRead || offlineMode) return;
    setRefreshing(true);
    setError('');
    try {
      const next = await getDocflowProfile();
      setProfile(next);
      if (next.configured) await loadTasks(next, true);
      else {
        setTasks([]);
        setTruncated(false);
        setAsOf('');
      }
    } catch (cause) {
      const resolved = resolveNativeDocflowError(cause, 'Не удалось обновить данные 1С.');
      setError(resolved.message);
      setCorrelationId(resolved.correlationId);
    } finally {
      setRefreshing(false);
    }
  }, [canRead, loadTasks, offlineMode]);

  useEffect(() => { void loadProfile(); }, [loadProfile]);
  useEffect(() => {
    if (profile?.configured) void loadTasks(profile);
  }, [loadTasks, profile?.configured, profile?.login]);
  useEffect(() => {
    if (!profile?.configured || offlineMode) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void loadTasks(profile, true);
      }, 180);
    };
    const releases = [
      hubRealtimeSocket.onDocflowChanged(refresh),
      hubRealtimeSocket.on('hub.realtime.connected', refresh),
    ];
    return () => {
      if (timer) clearTimeout(timer);
      releases.forEach((release) => release());
    };
  }, [loadTasks, offlineMode, profile]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const becameActive = nextState === 'active' && appStateRef.current !== 'active';
      appStateRef.current = nextState;
      if (nextState !== 'active') {
        setCredentialPassword('');
        setCredentialNotice('');
        if (!credentialBusy) setCredentialsOpen(false);
      }
      if (becameActive && scope === 'inbox' && profile?.configured && !offlineMode) {
        void loadTasks(profile, true);
      }
    });
    return () => subscription.remove();
  }, [credentialBusy, loadTasks, offlineMode, profile, scope]);

  const status = useMemo(() => profileStatus(profile), [profile]);

  const openCredentials = useCallback(() => {
    if (offlineMode) return;
    setCredentialLogin(profile?.login || '');
    setCredentialPassword('');
    setCredentialError('');
    setCredentialNotice('');
    setCredentialsOpen(true);
  }, [offlineMode, profile?.login]);

  const closeCredentials = useCallback(() => {
    if (credentialBusy) return;
    setCredentialPassword('');
    setCredentialError('');
    setCredentialNotice('');
    setCredentialsOpen(false);
  }, [credentialBusy]);

  const validateCredentials = useCallback(() => {
    if (!credentialLogin.trim()) {
      setCredentialError('Введите логин 1С.');
      return false;
    }
    if (!credentialPassword) {
      setCredentialError('Введите пароль 1С.');
      return false;
    }
    return true;
  }, [credentialLogin, credentialPassword]);

  const testCredentials = useCallback(async () => {
    if (!validateCredentials() || credentialBusy || offlineMode) return;
    setCredentialBusy('test');
    setCredentialError('');
    setCredentialNotice('');
    try {
      await testDocflowCredentials(credentialLogin.trim(), credentialPassword);
      setCredentialNotice('Подключение к 1С работает. Теперь можно сохранить учётную запись.');
    } catch (cause) {
      const resolved = resolveNativeDocflowError(cause, 'Не удалось проверить учётную запись 1С.');
      setCredentialError(resolved.message);
    } finally {
      setCredentialBusy('');
    }
  }, [credentialBusy, credentialLogin, credentialPassword, offlineMode, validateCredentials]);

  const saveCredentials = useCallback(async () => {
    if (!validateCredentials() || credentialBusy || offlineMode) return;
    setCredentialBusy('save');
    setCredentialError('');
    setCredentialNotice('');
    try {
      const next = await saveDocflowCredentials(credentialLogin.trim(), credentialPassword);
      setProfile(next);
      setCredentialPassword('');
      setCredentialsOpen(false);
    } catch (cause) {
      const resolved = resolveNativeDocflowError(cause, 'Не удалось сохранить учётную запись 1С.');
      setCredentialError(resolved.message);
    } finally {
      setCredentialBusy('');
    }
  }, [credentialBusy, credentialLogin, credentialPassword, offlineMode, validateCredentials]);

  const confirmDeleteCredentials = useCallback(() => {
    if (!profile?.configured || credentialBusy || offlineMode) return;
    Alert.alert(
      'Отключить учётную запись 1С?',
      'Сохранённый пароль будет удалён. Задания снова появятся после нового подключения.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Отключить',
          style: 'destructive',
          onPress: () => {
            setCredentialBusy('delete');
            setCredentialError('');
            void deleteDocflowCredentials().then(() => {
              setProfile({
                configured: false,
                login: null,
                status: 'not_configured',
                last_error_code: null,
                last_verified_at: null,
                updated_at: null,
              });
              setTasks([]);
              setTruncated(false);
              setAsOf('');
              setCredentialPassword('');
              setCredentialsOpen(false);
            }).catch((cause) => {
              setCredentialError(resolveNativeDocflowError(cause, 'Не удалось отключить учётную запись 1С.').message);
            }).finally(() => setCredentialBusy(''));
          },
        },
      ],
    );
  }, [credentialBusy, offlineMode, profile?.configured]);

  const openTask = useCallback((taskRef: string) => {
    router.push({
      pathname: '/(shell)/docflow/[taskRef]',
      params: { taskRef },
    } as never);
  }, []);

  const renderTask = useCallback(({ item }: ListRenderItemInfo<DocflowTaskSummary>) => (
    <NativeDocflowTaskCard
      task={item}
      tokens={tokens}
      onPress={openTask}
    />
  ), [openTask, tokens]);

  if (!canRead) {
    return (
      <AccountScreenScaffold title="1С ДО" tokens={tokens}>
        <AccountSectionCard tokens={tokens} title="Нет доступа" description="Для раздела нужно право docflow.read.">{null}</AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  return (
    <AccountScreenScaffold
      title="1С ДО"
      rightAction={canCreate && profile?.configured ? <Pressable testID="native-docflow-create-assignment" accessibilityRole="button" accessibilityLabel="Создать поручение" onPress={() => router.push('/(shell)/docflow/create' as never)} style={styles.searchAction}><MaterialCommunityIcons name="plus" size={24} color={tokens.primary} /></Pressable> : undefined}
      tokens={tokens}
      scroll={false}
    >
      {error ? (
        <View style={[styles.errorBox, { borderColor: tokens.error }]}>
          <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{error}</Text>
          {correlationId ? <Text selectable style={[styles.correlation, { color: tokens.textSecondary }]}>Код обращения: {correlationId}</Text> : null}
        </View>
      ) : null}

      {profile?.configured ? <Pressable testID="native-docflow-credentials-open" accessibilityRole="button" accessibilityLabel="Настроить подключение 1С" onPress={openCredentials} disabled={offlineMode} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}><MaterialCommunityIcons name="account-check-outline" size={20} color={tokens.primary} /><Text numberOfLines={1} style={{ flex: 1, color: tokens.textSecondary }}>{status} · {profile.login}</Text><MaterialCommunityIcons name="chevron-right" size={20} color={tokens.iconMuted} /></Pressable> : <>
      <View style={[styles.connection, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
        <View style={[styles.connectionIcon, { backgroundColor: profile?.configured ? tokens.accentSoft : tokens.actionBg }]}>
          <MaterialCommunityIcons name="account-key-outline" size={22} color={profile?.configured ? tokens.primary : tokens.iconMuted} />
        </View>
        <View style={styles.connectionBody}>
          <Text style={[styles.connectionTitle, { color: tokens.textPrimary }]}>{loadingProfile ? 'Проверяем подключение…' : status}</Text>
          <Text numberOfLines={1} style={[styles.connectionMeta, { color: tokens.textSecondary }]}>{profile?.configured ? profile.login || 'Пользователь 1С' : 'Личная учётная запись 1С'}</Text>
        </View>
        <Pressable testID="native-docflow-credentials-open" onPress={openCredentials} disabled={offlineMode} accessibilityRole="button" accessibilityState={{ disabled: offlineMode }} style={[styles.connectionAction, { borderColor: tokens.border, opacity: offlineMode ? 0.5 : 1 }]}>
          <Text style={[styles.connectionActionText, { color: tokens.primary }]}>{profile?.configured ? 'Настроить' : 'Подключить'}</Text>
        </Pressable>
      </View>

      </>}
      {profile?.configured ? (
        <>
          <ScrollView
            testID="native-docflow-scope-tabs"
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.scopeTabsViewport}
            contentContainerStyle={styles.scopeTabs}
            accessibilityRole="tablist"
          >
            {DOCFLOW_SCOPE_OPTIONS.map((option) => {
              const selected = option.value === scope;
              return (
                <Pressable
                  key={option.value}
                  testID={`native-docflow-scope-${option.value}`}
                  onPress={() => setScope(option.value)}
                  disabled={loadingTasks}
                  accessibilityRole="tab"
                  accessibilityState={{ selected, disabled: loadingTasks }}
                  style={[styles.scopeTab, { backgroundColor: selected ? tokens.primary : tokens.panelSolid, borderColor: selected ? tokens.primary : tokens.border }]}
                >
                  <Text style={[styles.scopeText, { color: selected ? '#fff' : tokens.textPrimary }]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={[styles.search, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
            <MaterialCommunityIcons name="magnify" size={20} color={tokens.iconMuted} />
            <TextInput
              testID="native-docflow-search"
              value={queryDraft}
              onChangeText={(value) => setQueryDraft(value.slice(0, 200))}
              onSubmitEditing={() => setQuery(queryDraft.trim())}
              placeholder="Поиск по заданиям"
              placeholderTextColor={tokens.textTertiary}
              accessibilityLabel="Поиск по моим заданиям 1С"
              returnKeyType="search"
              style={[styles.searchInput, { color: tokens.textPrimary }]}
            />
            {queryDraft ? (
              <Pressable onPress={() => { setQueryDraft(''); setQuery(''); }} accessibilityRole="button" accessibilityLabel="Очистить поиск" style={styles.searchAction}>
                <MaterialCommunityIcons name="close" size={19} color={tokens.iconMuted} />
              </Pressable>
            ) : null}
            <Pressable testID="native-docflow-search-submit" onPress={() => setQuery(queryDraft.trim())} disabled={loadingTasks} accessibilityRole="button" accessibilityLabel="Найти задания" style={[styles.searchAction, { backgroundColor: tokens.primary }]}>
              <MaterialCommunityIcons name="arrow-right" size={19} color="#fff" />
            </Pressable>
          </View>
          <View style={styles.listMeta}>
            <Text style={[styles.metaText, { color: tokens.textSecondary }]}>Найдено: {tasks.length}{truncated ? '+' : ''}</Text>
            {asOf ? <Text style={[styles.metaText, { color: tokens.textSecondary }]}>Обновлено: {formatDocflowDate(asOf)}</Text> : null}
          </View>
          <FlatList
            testID="native-docflow-list"
            style={styles.taskList}
            data={tasks}
            keyExtractor={(item) => item.ref}
            refreshing={refreshing}
            onRefresh={() => { void refreshAll(); }}
            contentContainerStyle={tasks.length ? styles.list : styles.emptyList}
            renderItem={renderTask}
            ListEmptyComponent={loadingTasks ? (
              <View style={styles.empty}><ActivityIndicator color={tokens.primary} /><Text style={[styles.emptyText, { color: tokens.textSecondary }]}>Первое подключение к 1С может занять до минуты…</Text></View>
            ) : (
              <View style={styles.empty}>
                <MaterialCommunityIcons name="file-check-outline" size={42} color={tokens.iconMuted} />
                <Text style={[styles.emptyTitle, { color: tokens.textPrimary }]}>{query ? 'Ничего не найдено' : 'Заданий нет'}</Text>
                <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>{query ? 'Измените запрос или очистите поиск.' : 'В этом разделе сейчас пусто.'}</Text>
              </View>
            )}
            ListFooterComponent={(
              <View style={styles.footerActions}>
                {truncated ? <Text style={[styles.truncated, { color: tokens.textSecondary }]}>Показаны первые {TASK_LIMIT} заданий. Уточните поиск.</Text> : null}

              </View>
            )}
          />
        </>
      ) : loadingProfile ? (
        <View style={styles.loading}><ActivityIndicator color={tokens.primary} /></View>
      ) : (
        <View style={styles.empty}>
          <MaterialCommunityIcons name="account-lock-outline" size={44} color={tokens.iconMuted} />
          <Text style={[styles.emptyTitle, { color: tokens.textPrimary }]}>Подключите личную учётную запись 1С</Text>
          <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>После подключения здесь появятся только назначенные вам задания.</Text>
        </View>
      )}

      <Modal visible={credentialsOpen} animationType="slide" onRequestClose={closeCredentials}>
        <AccountScreenScaffold title="Учётная запись 1С" tokens={tokens} onBack={closeCredentials}>
          <AccountSectionCard
            tokens={tokens}
            title={profile?.configured ? 'Обновить подключение' : 'Подключить документооборот'}
            description="Логин и пароль передаются только backend HUB-IT и хранятся в защищённом виде. Пароль после закрытия формы очищается."
          >
            <HubTextField
              testID="native-docflow-credential-login"
              label="Логин 1С"
              value={credentialLogin}
              onChangeText={(value) => { setCredentialLogin(value.slice(0, 128)); setCredentialError(''); setCredentialNotice(''); }}
              autoCapitalize="none"
              autoCorrect={false}
              disabled={Boolean(credentialBusy)}
            />
            <View style={styles.credentialGap} />
            <HubTextField
              testID="native-docflow-credential-password"
              label="Пароль 1С"
              value={credentialPassword}
              onChangeText={(value) => { setCredentialPassword(value); setCredentialError(''); setCredentialNotice(''); }}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              disabled={Boolean(credentialBusy)}
            />
            {credentialError ? <Text accessibilityRole="alert" style={[styles.credentialStatus, { color: tokens.error }]}>{credentialError}</Text> : null}
            {credentialNotice ? <Text accessibilityRole="alert" style={[styles.credentialStatus, { color: tokens.success }]}>{credentialNotice}</Text> : null}
            <View style={styles.credentialActions}>
              <AccountSecondaryButton
                tokens={tokens}
                testID="native-docflow-credentials-test"
                label={credentialBusy === 'test' ? 'Проверяем…' : 'Проверить подключение'}
                onPress={() => { void testCredentials(); }}
                disabled={Boolean(credentialBusy) || offlineMode}
              />
              <AccountPrimaryButton
                tokens={tokens}
                testID="native-docflow-credentials-save"
                label={credentialBusy === 'save' ? 'Сохраняем…' : 'Сохранить'}
                onPress={() => { void saveCredentials(); }}
                disabled={Boolean(credentialBusy) || offlineMode}
              />
              {profile?.configured ? (
                <AccountSecondaryButton
                  tokens={tokens}
                  testID="native-docflow-credentials-delete"
                  label={credentialBusy === 'delete' ? 'Отключаем…' : 'Отключить учётную запись'}
                  onPress={confirmDeleteCredentials}
                  disabled={Boolean(credentialBusy) || offlineMode}
                  danger
                />
              ) : null}
            </View>
          </AccountSectionCard>
        </AccountScreenScaffold>
      </Modal>
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  headerAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  warning: { marginBottom: 7, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  errorBox: { borderWidth: 1, borderRadius: 12, padding: 10, marginBottom: 8 },
  error: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  correlation: { marginTop: 4, fontSize: 10 },
  connection: { minHeight: 68, borderRadius: 15, borderWidth: 1, padding: 10, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 9 },
  connectionIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  connectionBody: { flex: 1, minWidth: 0 },
  connectionTitle: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  connectionMeta: { marginTop: 2, fontSize: 11, lineHeight: 15 },
  connectionAction: { minHeight: 44, borderRadius: 12, borderWidth: 1, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  connectionActionText: { fontSize: 11, fontWeight: '800' },
  scopeTabsViewport: { flexGrow: 0, flexShrink: 0, maxHeight: 52 },
  scopeTabs: { gap: 7, paddingBottom: 8 },
  scopeTab: { minHeight: 44, borderRadius: 22, borderWidth: 1, paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center' },
  scopeText: { fontSize: 12, fontWeight: '800' },
  search: { minHeight: 48, borderRadius: 14, borderWidth: 1, paddingLeft: 12, flexDirection: 'row', alignItems: 'center', gap: 7 },
  searchInput: { flex: 1, minWidth: 0, fontSize: 14, paddingVertical: 8 },
  searchAction: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  listMeta: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  metaText: { fontSize: 10 },
  taskList: { flex: 1 },
  list: { paddingBottom: 12 },
  emptyList: { flexGrow: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { minHeight: 220, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { marginTop: 10, fontSize: 16, fontWeight: '800', textAlign: 'center' },
  emptyText: { marginTop: 5, fontSize: 12, lineHeight: 17, textAlign: 'center' },
  footerActions: { paddingBottom: 12 },
  truncated: { marginBottom: 9, fontSize: 11, lineHeight: 16 },
  webCreate: { minHeight: 78, borderRadius: 14, borderWidth: 1, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10 },
  credentialGap: { height: 10 },
  credentialStatus: { marginTop: 10, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  credentialActions: { marginTop: 12, gap: 9 },
});
