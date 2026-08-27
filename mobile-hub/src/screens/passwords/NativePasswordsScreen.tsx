import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from 'expo-router';
import * as ScreenCapture from 'expo-screen-capture';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { listPasswordVaultEntries, type PasswordVaultEntry } from '../../api/passwordsApi';
import { formatApiError } from '../../api/formatError';
import { useAuth } from '../../auth/AuthContext';
import { NativePasswordEntryCard } from '../../components/passwords/NativePasswordEntryCard';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import { AccountField, AccountScreenScaffold, AccountSectionCard } from '../account/AccountChrome';

const PASSWORD_SCREEN_CAPTURE_KEY = 'hubit-password-vault-metadata';

function FilterChip({ label, selected, onPress, tokens }: { label: string; selected: boolean; onPress: () => void; tokens: ReturnType<typeof useFluentTokens> }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.filterChip, { backgroundColor: selected ? tokens.primary : tokens.panelSolid, borderColor: selected ? tokens.primary : tokens.border }]}
    >
      <Text style={[styles.filterText, { color: selected ? '#fff' : tokens.textPrimary }]}>{label}</Text>
    </Pressable>
  );
}

export function NativePasswordsScreen() {
  const { hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const canRead = hasPermission('passwords.read');
  const [entries, setEntries] = useState<PasswordVaultEntry[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [queryDraft, setQueryDraft] = useState('');
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [tag, setTag] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [selected, setSelected] = useState<PasswordVaultEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [captureReady, setCaptureReady] = useState(false);
  const [captureError, setCaptureError] = useState('');
  const mountedRef = useRef(true);
  const focusedRef = useRef(false);
  const requestRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const clearVaultState = useCallback(() => {
    requestRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setEntries([]);
    setGroups([]);
    setTags([]);
    setSelected(null);
    setLoading(false);
    setRefreshing(false);
  }, []);

  const protectScreen = useCallback(async () => {
    setCaptureReady(false);
    setCaptureError('');
    clearVaultState();
    try {
      await ScreenCapture.preventScreenCaptureAsync(PASSWORD_SCREEN_CAPTURE_KEY);
      if (mountedRef.current && focusedRef.current) setCaptureReady(true);
    } catch {
      if (mountedRef.current && focusedRef.current) {
        setCaptureError('Не удалось включить защиту экрана. Хранилище заблокировано.');
      }
    }
  }, [clearVaultState]);

  const load = useCallback(async ({ refresh = false } = {}) => {
    if (!canRead || offlineMode || !captureReady || !focusedRef.current) {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
      return;
    }
    const requestId = ++requestRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const result = await listPasswordVaultEntries({ q: query, group, tag, includeArchived, signal: controller.signal });
      if (requestId !== requestRef.current || controller.signal.aborted || !mountedRef.current) return;
      setEntries(result.items);
      setGroups(result.groups);
      setTags(result.tags);
      setSelected((current) => current ? result.items.find((item) => item.id === current.id) || null : null);
      if (group && !result.groups.includes(group)) setGroup('');
      if (tag && !result.tags.includes(tag)) setTag('');
    } catch (cause) {
      if (requestId === requestRef.current && !controller.signal.aborted && mountedRef.current) {
        setError(formatApiError(cause, 'Не удалось загрузить хранилище паролей.'));
      }
    } finally {
      if (requestId === requestRef.current && mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [canRead, captureReady, group, includeArchived, offlineMode, query, tag]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(queryDraft.trim().slice(0, 200)), 250);
    return () => clearTimeout(timer);
  }, [queryDraft]);

  useEffect(() => {
    if (!canRead || offlineMode) {
      clearVaultState();
      return;
    }
    if (captureReady) void load();
  }, [canRead, captureReady, clearVaultState, load, offlineMode]);

  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    void protectScreen();
    return () => {
      focusedRef.current = false;
      setCaptureReady(false);
      clearVaultState();
      void ScreenCapture.allowScreenCaptureAsync(PASSWORD_SCREEN_CAPTURE_KEY).catch(() => undefined);
    };
  }, [clearVaultState, protectScreen]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        setCaptureReady(false);
        clearVaultState();
        return;
      }
      if (focusedRef.current) void protectScreen();
    });
    return () => subscription.remove();
  }, [clearVaultState, protectScreen]);

  if (!canRead) {
    return (
      <AccountScreenScaffold title="Пароли" tokens={tokens}>
        <AccountSectionCard tokens={tokens} title="Нет доступа" description="Для раздела нужно право passwords.read.">{null}</AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  if (!captureReady) {
    return (
      <AccountScreenScaffold title="Пароли" tokens={tokens}>
        <AccountSectionCard
          tokens={tokens}
          title={captureError ? 'Хранилище заблокировано' : 'Защищаем экран'}
          description={captureError || 'Включаем защиту от скриншотов и записи экрана.'}
        >
          {captureError ? (
            <Pressable
              testID="native-passwords-security-retry"
              onPress={() => { void protectScreen(); }}
              accessibilityRole="button"
              style={[styles.primaryAction, { backgroundColor: tokens.primary }]}
            >
              <Text style={styles.primaryActionText}>Повторить защиту</Text>
            </Pressable>
          ) : <ActivityIndicator color={tokens.primary} />}
        </AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  const header = (
    <View style={styles.headerContent}>
      {offlineMode ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.warning }]}>Автономный режим: хранилище не кэшируется и требует сеть.</Text> : null}
      {error ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.error }]}>{error}</Text> : null}
      <View style={[styles.securityBanner, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
        <MaterialCommunityIcons name="shield-lock-outline" size={23} color={tokens.primary} />
        <View style={styles.flex}>
          <Text style={[styles.securityTitle, { color: tokens.textPrimary }]}>Без раскрытия секретов</Text>
          <Text style={[styles.securityDescription, { color: tokens.textSecondary }]}>Приложение получает только логин, группу, теги и описание. Секреты, 2FA и passkey не передаются на этот экран.</Text>
        </View>
      </View>
      <View style={[styles.searchBox, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}>
        <MaterialCommunityIcons name="magnify" size={21} color={tokens.iconMuted} />
        <TextInput
          testID="native-passwords-search"
          value={queryDraft}
          onChangeText={setQueryDraft}
          editable={!offlineMode}
          placeholder="Логин, описание или тег"
          placeholderTextColor={tokens.textTertiary}
          accessibilityLabel="Поиск в хранилище паролей"
          returnKeyType="search"
          style={[styles.searchInput, { color: tokens.textPrimary }]}
        />
        {queryDraft ? <Pressable onPress={() => { setQueryDraft(''); setQuery(''); }} accessibilityRole="button" accessibilityLabel="Очистить поиск" style={styles.iconButton}><MaterialCommunityIcons name="close" size={19} color={tokens.iconMuted} /></Pressable> : null}
      </View>
      {groups.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          <FilterChip label="Все группы" selected={!group} onPress={() => setGroup('')} tokens={tokens} />
          {groups.map((item) => <FilterChip key={item} label={item} selected={group === item} onPress={() => setGroup(item)} tokens={tokens} />)}
        </ScrollView>
      ) : null}
      {tags.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          <FilterChip label="Все теги" selected={!tag} onPress={() => setTag('')} tokens={tokens} />
          {tags.map((item) => <FilterChip key={item} label={`#${item}`} selected={tag === item} onPress={() => setTag(item)} tokens={tokens} />)}
        </ScrollView>
      ) : null}
      <View style={styles.countRow}>
        <Text accessibilityLiveRegion="polite" style={[styles.count, { color: tokens.textSecondary }]}>Записей: {entries.length}</Text>
        <FilterChip label="Показывать архив" selected={includeArchived} onPress={() => setIncludeArchived((value) => !value)} tokens={tokens} />
      </View>
      {loading && entries.length === 0 ? <View style={styles.loading}><ActivityIndicator color={tokens.primary} /><Text style={[styles.emptyText, { color: tokens.textSecondary }]}>Загружаем метаданные…</Text></View> : null}
      {!loading && error && entries.length === 0 ? <Pressable testID="native-passwords-retry" onPress={() => { void load(); }} disabled={offlineMode} accessibilityRole="button" style={[styles.primaryAction, { backgroundColor: tokens.primary, opacity: offlineMode ? 0.5 : 1 }]}><Text style={styles.primaryActionText}>Повторить</Text></Pressable> : null}
    </View>
  );

  return (
    <AccountScreenScaffold
      title="Пароли"
      tokens={tokens}
      scroll={false}
    >
      <FlatList
        testID="native-passwords-list"
        data={entries}
        keyExtractor={(entry) => entry.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={entries.length ? styles.list : styles.emptyList}
        ListHeaderComponent={header}
        ListEmptyComponent={!loading && !error ? <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>{query || group || tag ? 'По фильтрам ничего не найдено.' : 'В хранилище пока нет записей.'}</Text> : null}
        renderItem={({ item }) => <NativePasswordEntryCard entry={item} tokens={tokens} onPress={() => setSelected(item)} />}
        refreshing={refreshing}
        onRefresh={() => { void load({ refresh: true }); }}
      />

      <Modal visible={Boolean(selected)} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <View style={styles.modalRoot}>
          <Pressable accessibilityRole="button" accessibilityLabel="Закрыть карточку" style={styles.scrim} onPress={() => setSelected(null)} />
          {selected ? (
            <View style={[styles.sheet, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderStrong }]}>
              <View style={styles.sheetHeader}>
                <View style={styles.flex}><Text style={[styles.sheetTitle, { color: tokens.textPrimary }]}>{selected.login}</Text><Text style={[styles.sheetSubtitle, { color: tokens.textSecondary }]}>{selected.group || 'Без группы'}</Text></View>
                <Pressable onPress={() => setSelected(null)} accessibilityRole="button" accessibilityLabel="Закрыть" style={styles.iconButton}><MaterialCommunityIcons name="close" size={22} color={tokens.iconMuted} /></Pressable>
              </View>
              <AccountField tokens={tokens} label="Логин" value={selected.login} />
              <AccountField tokens={tokens} label="Группа" value={selected.group} />
              <AccountField tokens={tokens} label="Теги" value={selected.tags.map((item) => `#${item}`).join(', ')} />
              <AccountField tokens={tokens} label="Описание" value={selected.description} />
              <AccountField tokens={tokens} label="Обновлено" value={selected.updated_at} />
              <AccountField tokens={tokens} label="Состояние" value={selected.is_archived ? 'Архив' : 'Активна'} />
              <View style={[styles.passwordPlaceholder, { backgroundColor: tokens.panelInset, borderColor: tokens.borderSoft }]}>
                <MaterialCommunityIcons name="lock-outline" size={21} color={tokens.iconMuted} />
                <Text style={[styles.passwordPlaceholderText, { color: tokens.textSecondary }]}>Пароль не загружается в APK</Text>
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerContent: { gap: 9, paddingBottom: 10 },
  notice: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  securityBanner: { minHeight: 82, borderWidth: 1, borderRadius: 15, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  securityTitle: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  securityDescription: { marginTop: 2, fontSize: 11, lineHeight: 16 },
  searchBox: { minHeight: 48, borderRadius: 13, borderWidth: 1, paddingLeft: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, minHeight: 46, fontSize: 15 },
  filters: { gap: 7 },
  filterChip: { minHeight: 40, borderRadius: 20, borderWidth: 1, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  filterText: { fontSize: 12, fontWeight: '800' },
  countRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  count: { fontSize: 12, fontWeight: '700' },
  loading: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: 9 },
  list: { gap: 9, paddingBottom: 8 },
  emptyList: { flexGrow: 1, paddingBottom: 60 },
  emptyText: { textAlign: 'center', fontSize: 14, lineHeight: 20 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.48)' },
  sheet: { maxHeight: '88%', borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, padding: 18, gap: 12 },
  sheetHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  sheetTitle: { fontSize: 18, lineHeight: 24, fontWeight: '900' },
  sheetSubtitle: { marginTop: 2, fontSize: 12, lineHeight: 17 },
  passwordPlaceholder: { minHeight: 58, borderWidth: 1, borderRadius: 14, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 9 },
  passwordPlaceholderText: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  primaryAction: { minHeight: 44, borderRadius: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  primaryActionText: { color: '#fff', fontSize: 13, fontWeight: '800' },
});
