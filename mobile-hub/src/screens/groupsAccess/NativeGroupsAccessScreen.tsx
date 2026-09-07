import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  getGroupsAccessStatus,
  listGroupsAccessGroups,
  type GroupsAccessGroup,
  type GroupsAccessStatus,
} from '../../api/groupsAccessApi';
import { formatApiError } from '../../api/formatError';
import { useAuth } from '../../auth/AuthContext';
import { NativeGroupsAccessGroupCard } from '../../components/groupsAccess/NativeGroupsAccessCards';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import { AccountScreenScaffold, AccountSectionCard } from '../account/AccountChrome';

const PAGE_SIZE = 40;

function formatDateTime(value: string): string {
  if (!value) return 'Нет данных';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU');
}

function FilterChip({
  label,
  selected,
  onPress,
  tokens,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  tokens: ReturnType<typeof useFluentTokens>;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        styles.chip,
        { backgroundColor: selected ? tokens.primary : tokens.panelSolid, borderColor: selected ? tokens.primary : tokens.border },
      ]}
    >
      <Text style={[styles.chipText, { color: selected ? '#fff' : tokens.textPrimary }]}>{label}</Text>
    </Pressable>
  );
}

export function NativeGroupsAccessScreen() {
  const { hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const canRead = hasPermission('groups_access.read');
  const [branch, setBranch] = useState('');
  const [queryDraft, setQueryDraft] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<GroupsAccessStatus | null>(null);
  const [groups, setGroups] = useState<GroupsAccessGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [refreshRevision, setRefreshRevision] = useState(0);
  const requestRef = useRef(0);
  const loadMoreBusyRef = useRef(false);
  const mainAbortRef = useRef<AbortController | null>(null);
  const statusAbortRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const focusedRef = useRef(false);
  const firstFocusRef = useRef(true);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(queryDraft.replace(/\s+/g, ' ').trim().slice(0, 200)), 300);
    return () => clearTimeout(timer);
  }, [queryDraft]);

  useEffect(() => {
    if (!canRead || offlineMode) return;
    statusAbortRef.current?.abort();
    const controller = new AbortController();
    statusAbortRef.current = controller;
    setStatusError('');
    void getGroupsAccessStatus({ signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setStatus(result);
    }).catch((cause) => {
      if (!controller.signal.aborted) setStatusError(formatApiError(cause, 'Не удалось получить состояние снимка AD.'));
    });
    return () => controller.abort();
  }, [canRead, offlineMode, refreshRevision]);

  useEffect(() => {
    if (!canRead || offlineMode) {
      requestRef.current += 1;
      mainAbortRef.current?.abort();
      loadMoreAbortRef.current?.abort();
      loadMoreBusyRef.current = false;
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
      return;
    }
    const requestId = ++requestRef.current;
    mainAbortRef.current?.abort();
    loadMoreAbortRef.current?.abort();
    loadMoreBusyRef.current = false;
    setLoadingMore(false);
    const controller = new AbortController();
    mainAbortRef.current = controller;
    setLoading(true);
    setError('');
    setPage(1);
    setHasMore(false);
    void listGroupsAccessGroups({ branch, q: query, page: 1, limit: PAGE_SIZE, signal: controller.signal }).then((result) => {
      if (requestId !== requestRef.current || controller.signal.aborted) return;
      setGroups(result.items);
      setTotal(result.total);
      setHasMore(result.has_more);
    }).catch((cause) => {
      if (requestId === requestRef.current && !controller.signal.aborted) {
        setError(formatApiError(cause, 'Не удалось загрузить список папок и групп.'));
      }
    }).finally(() => {
      if (requestId === requestRef.current && !controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    });
    return () => controller.abort();
  }, [branch, canRead, offlineMode, query, refreshRevision]);

  const branches = useMemo(() => {
    const values = status?.branches || [];
    return [...new Set(values.filter(Boolean))];
  }, [status?.branches]);

  const refresh = useCallback(() => {
    if (offlineMode) return;
    setRefreshing(true);
    setRefreshRevision((value) => value + 1);
  }, [offlineMode]);

  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    if (firstFocusRef.current) firstFocusRef.current = false;
    else refresh();
    return () => {
      focusedRef.current = false;
      requestRef.current += 1;
      mainAbortRef.current?.abort();
      statusAbortRef.current?.abort();
      loadMoreAbortRef.current?.abort();
    };
  }, [refresh]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        requestRef.current += 1;
        mainAbortRef.current?.abort();
        statusAbortRef.current?.abort();
        loadMoreAbortRef.current?.abort();
        return;
      }
      if (focusedRef.current) refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !hasMore || offlineMode || loadMoreBusyRef.current) return;
    loadMoreBusyRef.current = true;
    setLoadingMore(true);
    const nextPage = page + 1;
    const baseRequestId = requestRef.current;
    loadMoreAbortRef.current?.abort();
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;
    try {
      const result = await listGroupsAccessGroups({ branch, q: query, page: nextPage, limit: PAGE_SIZE, signal: controller.signal });
      if (controller.signal.aborted || baseRequestId !== requestRef.current) return;
      setGroups((current) => {
        const byDn = new Map(current.map((item) => [item.dn, item]));
        result.items.forEach((item) => byDn.set(item.dn, item));
        return [...byDn.values()];
      });
      setTotal(result.total);
      setPage(nextPage);
      setHasMore(result.has_more);
    } catch (cause) {
      if (!controller.signal.aborted && baseRequestId === requestRef.current) {
        setError(formatApiError(cause, 'Не удалось загрузить следующую страницу.'));
      }
    } finally {
      if (baseRequestId === requestRef.current) {
        loadMoreBusyRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [branch, hasMore, loading, loadingMore, offlineMode, page, query]);

  if (!canRead) {
    return (
      <AccountScreenScaffold title="Доступ к папкам" tokens={tokens}>
        <AccountSectionCard tokens={tokens} title="Нет доступа" description="Для раздела нужно право groups_access.read.">{null}</AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  const header = (
    <View style={styles.header}>
      {offlineMode ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.warning }]}>Автономный режим: снимок AD не сохраняется на устройстве.</Text> : null}
      {error ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.error }]}>{error}</Text> : null}
      {statusError ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.error }]}>{statusError}</Text> : null}
      {status?.error ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.warning }]}>Последняя синхронизация: {status.error}</Text> : null}
      <View style={[styles.search, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}>
        <MaterialCommunityIcons name="magnify" size={21} color={tokens.iconMuted} />
        <TextInput
          testID="native-groups-access-search"
          value={queryDraft}
          onChangeText={setQueryDraft}
          editable={!offlineMode}
          placeholder="Папка, путь или группа"
          placeholderTextColor={tokens.textTertiary}
          accessibilityLabel="Поиск папки или группы доступа"
          returnKeyType="search"
          style={[styles.searchInput, { color: tokens.textPrimary }]}
        />
        {queryDraft ? <Pressable onPress={() => { setQueryDraft(''); setQuery(''); }} accessibilityRole="button" accessibilityLabel="Очистить поиск" style={styles.iconButton}><MaterialCommunityIcons name="close" size={19} color={tokens.iconMuted} /></Pressable> : null}
      </View>
      <Text style={{ color: tokens.textSecondary, fontSize: 12 }}>Снимок AD: {formatDateTime(status?.last_sync_at || '')}</Text>
      <AccountSectionCard tokens={tokens} title={`Филиал: ${branch || 'все'}`} collapsible>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        <FilterChip label="Все филиалы" selected={!branch} onPress={() => setBranch('')} tokens={tokens} />
        {branches.map((item) => <FilterChip key={item} label={item} selected={branch === item} onPress={() => setBranch(item)} tokens={tokens} />)}
      </ScrollView>
      </AccountSectionCard>
      <AccountSectionCard tokens={tokens} title="О данных доступа" collapsible>
      <View style={[styles.boundaryBanner, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
        <MaterialCommunityIcons name="shield-check-outline" size={23} color={tokens.primary} />
        <View style={styles.flex}>
          <Text style={[styles.boundaryTitle, { color: tokens.textPrimary }]}>Безопасный просмотр снимка AD</Text>
          <Text style={[styles.boundaryText, { color: tokens.textSecondary }]}>Доступны постраничный поиск папок и уровни доступа. Сотрудники, состав групп, Excel и синхронизация пока не поддерживаются на мобильном устройстве.</Text>
        </View>
      </View>
      <View style={[styles.summary, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}>
        <View style={styles.summaryCounts}>
          <View style={styles.summaryCell}><Text style={[styles.summaryValue, { color: tokens.textPrimary }]}>{status?.summary.group_count ?? '—'}</Text><Text style={[styles.summaryLabel, { color: tokens.textSecondary }]}>групп</Text></View>
          <View style={styles.summaryCell}><Text style={[styles.summaryValue, { color: tokens.textPrimary }]}>{status?.summary.user_count ?? '—'}</Text><Text style={[styles.summaryLabel, { color: tokens.textSecondary }]}>сотрудников</Text></View>
        </View>
        <View style={[styles.summaryTimestamp, { borderTopColor: tokens.borderSoft }]}>
          <Text style={[styles.summaryLabel, { color: tokens.textSecondary }]}>Обновление снимка AD</Text>
          <Text selectable style={[styles.summaryDate, { color: tokens.textPrimary }]}>{formatDateTime(status?.last_sync_at || '')}</Text>
        </View>
      </View>
      </AccountSectionCard>
      <View style={styles.countRow}>
        <Text accessibilityLiveRegion="polite" style={[styles.count, { color: tokens.textSecondary }]}>Найдено: {total}</Text>
      </View>
      {loading && groups.length === 0 ? <View style={styles.loading}><ActivityIndicator color={tokens.primary} /></View> : null}
      {!loading && error && groups.length === 0 ? <Pressable testID="native-groups-access-retry" onPress={refresh} disabled={offlineMode} accessibilityRole="button" style={[styles.primaryAction, { backgroundColor: tokens.primary, opacity: offlineMode ? 0.5 : 1 }]}><Text style={styles.primaryActionText}>Повторить</Text></Pressable> : null}
    </View>
  );

  return (
    <AccountScreenScaffold title="Доступ к папкам" tokens={tokens} scroll={false}>
      <FlatList
        testID="native-groups-access-groups-list"
        data={groups}
        keyExtractor={(item) => item.dn}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={groups.length ? styles.list : styles.emptyList}
        ListHeaderComponent={header}
        ListEmptyComponent={!loading && !error && !offlineMode ? <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>По выбранным фильтрам ничего не найдено.</Text> : null}
        ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footer} color={tokens.primary} /> : null}
        renderItem={({ item }) => <NativeGroupsAccessGroupCard group={item} tokens={tokens} />}
        onEndReached={() => { void loadMore(); }}
        onEndReachedThreshold={0.45}
        refreshing={refreshing}
        onRefresh={refresh}
      />
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { gap: 9, paddingBottom: 10 },
  notice: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  boundaryBanner: { minHeight: 82, borderWidth: 1, borderRadius: 15, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  boundaryTitle: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  boundaryText: { marginTop: 2, fontSize: 11, lineHeight: 16 },
  summary: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 12 },
  summaryCounts: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  summaryTimestamp: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, gap: 4 },
  summaryCell: { flexGrow: 1, flexBasis: 120, minWidth: 0, alignItems: 'center', justifyContent: 'center' },
  summaryValue: { fontSize: 18, lineHeight: 23, fontWeight: '900' },
  summaryDate: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  summaryLabel: { fontSize: 13, lineHeight: 19 },
  filters: { gap: 7 },
  chip: { minHeight: 42, borderRadius: 21, borderWidth: 1, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 12, fontWeight: '800' },
  search: { minHeight: 48, borderWidth: 1, borderRadius: 13, paddingLeft: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, minHeight: 46, fontSize: 15 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  countRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  count: { flex: 1, fontSize: 12, fontWeight: '700' },
  webAction: { minHeight: 44, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', gap: 5 },
  webActionText: { fontSize: 11, fontWeight: '800' },
  loading: { minHeight: 86, alignItems: 'center', justifyContent: 'center' },
  list: { gap: 9, paddingBottom: 8 },
  emptyList: { flexGrow: 1, paddingBottom: 60 },
  emptyText: { paddingVertical: 22, textAlign: 'center', fontSize: 13, lineHeight: 19 },
  footer: { paddingVertical: 18 },
  primaryAction: { minHeight: 44, borderRadius: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  primaryActionText: { color: '#fff', fontSize: 13, fontWeight: '800' },
});
