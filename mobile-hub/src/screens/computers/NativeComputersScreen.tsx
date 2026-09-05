import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { ListRenderItemInfo } from 'react-native';
import {
  getComputersSummary,
  searchComputers,
  type ComputerRecord,
  type ComputerScope,
  type ComputerStatus,
  type ComputersSummary,
} from '../../api/computersApi';
import { formatApiError } from '../../api/formatError';
import { useAuth } from '../../auth/AuthContext';
import { NativeComputerCard } from '../../components/computers/NativeComputerCard';
import {
  COMPUTER_STATUS_OPTIONS,
  mergeComputerPage,
} from '../../computers/nativeComputersModel';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import { AccountScreenScaffold, AccountSectionCard } from '../account/AccountChrome';

const PAGE_SIZE = 50;
const AUTO_REFRESH_MS = 60_000;

function firstParam(value: string | string[] | undefined): string {
  return String(Array.isArray(value) ? value[0] : value || '').trim().slice(0, 200);
}

function FilterChip({
  label,
  selected,
  onPress,
  disabled,
  tokens,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  tokens: ReturnType<typeof useFluentTokens>;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      style={[
        styles.filterChip,
        {
          backgroundColor: selected ? tokens.primary : tokens.panelSolid,
          borderColor: selected ? tokens.primary : tokens.border,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text style={[styles.filterText, { color: selected ? '#fff' : tokens.textPrimary }]}>{label}</Text>
    </Pressable>
  );
}

function SummaryCard({ label, value, color, tokens }: { label: string; value: number; color: string; tokens: ReturnType<typeof useFluentTokens> }) {
  return (
    <View style={[styles.summaryCard, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
      <Text style={[styles.summaryLabel, { color: tokens.textSecondary }]}>{label}</Text>
    </View>
  );
}

export function NativeComputersScreen() {
  const params = useLocalSearchParams<{ q?: string | string[] }>();
  const initialQuery = firstParam(params.q);
  const { hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const canRead = hasPermission('computers.read');
  const canReadAll = hasPermission('computers.read_all');
  const [items, setItems] = useState<ComputerRecord[]>([]);
  const [summary, setSummary] = useState<ComputersSummary | null>(null);
  const [queryDraft, setQueryDraft] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [scope, setScope] = useState<ComputerScope>('selected');
  const [status, setStatus] = useState<'' | ComputerStatus>('');
  const [changedOnly, setChangedOnly] = useState(false);
  const [hideVm172, setHideVm172] = useState(true);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const mountedRef = useRef(true);
  const requestRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const focusedRef = useRef(false);
  const activeRef = useRef(AppState.currentState === 'active');
  const itemCountRef = useRef(0);
  itemCountRef.current = items.length;

  const load = useCallback(async ({ reset = true, refresh = false, silent = false } = {}) => {
    if (!canRead || offlineMode) {
      requestRef.current += 1;
      abortRef.current?.abort();
      busyRef.current = false;
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
      return;
    }
    if (busyRef.current && !reset) return;
    const requestId = ++requestRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    busyRef.current = true;
    const offset = reset ? 0 : itemCountRef.current;
    if (refresh) setRefreshing(true);
    else if (!silent && reset) setLoading(true);
    else if (!reset) setLoadingMore(true);
    if (!silent) setError('');
    const filters = { scope, q: query, status, changedOnly, hideVm172, signal: controller.signal };
    const results = await Promise.allSettled([
      searchComputers({ ...filters, limit: PAGE_SIZE, offset }),
      ...(reset ? [getComputersSummary(filters)] : []),
    ]);
    if (requestId !== requestRef.current || controller.signal.aborted || !mountedRef.current) return;
    const pageResult = results[0];
    const messages: string[] = [];
    if (pageResult.status === 'fulfilled') {
      setItems((current) => (reset ? pageResult.value.items : mergeComputerPage(current, pageResult.value.items)));
      setTotal(pageResult.value.total);
      setHasMore(pageResult.value.has_more && pageResult.value.items.length > 0);
    } else {
      messages.push(formatApiError(pageResult.reason, 'Не удалось загрузить список компьютеров.'));
    }
    const summaryResult = results[1];
    if (summaryResult) {
      if (summaryResult.status === 'fulfilled') setSummary(summaryResult.value);
      else messages.push(formatApiError(summaryResult.reason, 'Сводка компьютеров недоступна.'));
    }
    setError(messages.join(' '));
    setLoading(false);
    setRefreshing(false);
    setLoadingMore(false);
    busyRef.current = false;
  }, [canRead, changedOnly, hideVm172, offlineMode, query, scope, status]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
      busyRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(queryDraft.trim().slice(0, 200)), 250);
    return () => clearTimeout(timer);
  }, [queryDraft]);

  useEffect(() => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    void load({ reset: true });
  }, [canRead, load]);

  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    const timer = setInterval(() => {
      if (!focusedRef.current || !activeRef.current || busyRef.current || offlineMode) return;
      void load({ reset: true, silent: true });
    }, AUTO_REFRESH_MS);
    return () => {
      focusedRef.current = false;
      clearInterval(timer);
    };
  }, [load, offlineMode]));

  useEffect(() => {
    activeRef.current = AppState.currentState === 'active';
    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasActive = activeRef.current;
      activeRef.current = nextState === 'active';
      if (wasActive || !activeRef.current || !focusedRef.current || busyRef.current || offlineMode) return;
      void load({ reset: true, silent: true });
    });
    return () => subscription.remove();
  }, [load, offlineMode]);

  useEffect(() => {
    if (!canReadAll && scope === 'all') setScope('selected');
  }, [canReadAll, scope]);

  const openDetail = useCallback((computer: ComputerRecord) => {
    if (!computer.mac_address) {
      setError('Карточка недоступна: у компьютера не указан MAC-адрес.');
      return;
    }
    router.push({
      pathname: '/(shell)/computers/[macAddress]',
      params: { macAddress: computer.mac_address, scope, q: computer.hostname },
    } as never);
  }, [scope]);

  const refreshList = useCallback(() => {
    void load({ reset: true, refresh: true });
  }, [load]);

  const loadNextPage = useCallback(() => {
    if (hasMore && !busyRef.current) void load({ reset: false });
  }, [hasMore, load]);

  const renderComputer = useCallback(({ item }: ListRenderItemInfo<ComputerRecord>) => (
    <NativeComputerCard computer={item} tokens={tokens} onPress={openDetail} />
  ), [openDetail, tokens]);

  const summaryCards = useMemo(() => [
    { label: 'Всего', value: summary?.total || 0, color: tokens.primary },
    { label: 'В сети', value: summary?.statuses.online || 0, color: tokens.success },
    { label: 'Давно', value: summary?.statuses.stale || 0, color: tokens.warning },
    { label: 'Не в сети', value: summary?.statuses.offline || 0, color: tokens.error },
  ], [summary, tokens]);

  if (!canRead) {
    return (
      <AccountScreenScaffold title="Компьютеры" tokens={tokens}>
        <AccountSectionCard tokens={tokens} title="Нет доступа" description="Для раздела нужно право computers.read.">{null}</AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  const header = (
    <View style={styles.headerContent}>
      {offlineMode ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.warning }]}>Автономный режим: уже загруженный список остаётся на экране, обновление недоступно.</Text> : null}
      {error ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.error }]}>{error}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.summaryStrip}>
        {summaryCards.map((card) => <SummaryCard key={card.label} {...card} tokens={tokens} />)}
      </ScrollView>
      <View style={[styles.searchBox, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}>
        <MaterialCommunityIcons name="magnify" size={21} color={tokens.iconMuted} />
        <TextInput
          testID="native-computers-search"
          value={queryDraft}
          onChangeText={setQueryDraft}
          editable={!offlineMode}
          placeholder="Имя, IP, MAC или сотрудник"
          placeholderTextColor={tokens.textTertiary}
          accessibilityLabel="Поиск компьютеров"
          returnKeyType="search"
          onSubmitEditing={() => setQuery(queryDraft.trim().slice(0, 200))}
          style={[styles.searchInput, { color: tokens.textPrimary }]}
        />
        {queryDraft ? (
          <Pressable onPress={() => { setQueryDraft(''); setQuery(''); }} accessibilityRole="button" accessibilityLabel="Очистить поиск" style={styles.iconButton}>
            <MaterialCommunityIcons name="close" size={19} color={tokens.iconMuted} />
          </Pressable>
        ) : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters} accessibilityRole="tablist">
        {COMPUTER_STATUS_OPTIONS.map((option) => (
          <FilterChip
            key={option.id || 'all'}
            testID={`native-computers-status-${option.id || 'all'}`}
            label={option.label}
            selected={status === option.id}
            onPress={() => setStatus(option.id)}
            tokens={tokens}
          />
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        <FilterChip label="Моя база" selected={scope === 'selected'} onPress={() => setScope('selected')} tokens={tokens} />
        {canReadAll ? <FilterChip testID="native-computers-scope-all" label="Все базы" selected={scope === 'all'} onPress={() => setScope('all')} tokens={tokens} /> : null}
        <FilterChip label="С изменениями" selected={changedOnly} onPress={() => setChangedOnly((value) => !value)} tokens={tokens} />
        <FilterChip label="Скрыть VM 172" selected={hideVm172} onPress={() => setHideVm172((value) => !value)} tokens={tokens} />
      </ScrollView>
      <View style={styles.countRow}>
        <Text accessibilityLiveRegion="polite" style={[styles.count, { color: tokens.textSecondary }]}>Найдено: {total}</Text>
        <Pressable
          onPress={refreshList}
          disabled={offlineMode || loading}
          accessibilityRole="button"
          accessibilityLabel="Обновить список"
          accessibilityState={{ disabled: offlineMode || loading }}
          style={styles.iconButton}
        >
          <MaterialCommunityIcons name="refresh" size={20} color={tokens.primary} />
        </Pressable>
      </View>
      {loading && items.length === 0 ? <View style={styles.loading}><ActivityIndicator color={tokens.primary} /><Text style={[styles.emptyText, { color: tokens.textSecondary }]}>Загружаем компьютеры…</Text></View> : null}
      {!loading && error && items.length === 0 ? (
        <Pressable testID="native-computers-retry" onPress={() => { void load({ reset: true }); }} disabled={offlineMode} accessibilityRole="button" style={[styles.retry, { backgroundColor: tokens.primary, opacity: offlineMode ? 0.5 : 1 }]}>
          <Text style={styles.retryText}>Повторить</Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <AccountScreenScaffold
      title="Компьютеры"
      tokens={tokens}
      scroll={false}
    >
      <FlatList
        testID="native-computers-list"
        data={items}
        keyExtractor={(item) => item.mac_address || item.hostname}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={items.length ? styles.list : styles.emptyList}
        ListHeaderComponent={header}
        ListEmptyComponent={!loading && !error ? <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>{query ? 'По запросу ничего не найдено.' : 'В выбранной базе пока нет данных от агентов.'}</Text> : null}
        renderItem={renderComputer}
        refreshing={refreshing}
        onRefresh={refreshList}
        onEndReached={loadNextPage}
        onEndReachedThreshold={0.35}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={tokens.primary} style={styles.footerLoader} /> : null}
      />
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerContent: { gap: 9, paddingBottom: 10 },
  notice: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  summaryStrip: { gap: 8 },
  summaryCard: { width: 92, minHeight: 66, borderWidth: 1, borderRadius: 14, paddingHorizontal: 11, paddingVertical: 9 },
  summaryValue: { fontSize: 20, lineHeight: 25, fontWeight: '900' },
  summaryLabel: { marginTop: 2, fontSize: 11, lineHeight: 15, fontWeight: '700' },
  searchBox: { minHeight: 48, borderRadius: 13, borderWidth: 1, paddingLeft: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, minHeight: 46, fontSize: 15 },
  filters: { gap: 7 },
  filterChip: { minHeight: 40, borderRadius: 20, borderWidth: 1, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  filterText: { fontSize: 12, fontWeight: '800' },
  countRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { fontSize: 12, fontWeight: '700' },
  loading: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: 9 },
  retry: { alignSelf: 'flex-start', minHeight: 42, borderRadius: 12, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  retryText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  list: { gap: 9, paddingBottom: 8 },
  emptyList: { flexGrow: 1, paddingBottom: 60 },
  emptyText: { textAlign: 'center', fontSize: 14, lineHeight: 20 },
  footerLoader: { paddingVertical: 18 },
});
