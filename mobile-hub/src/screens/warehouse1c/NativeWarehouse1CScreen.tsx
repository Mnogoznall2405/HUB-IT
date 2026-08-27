import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  getWarehouse1CCatalogStatus,
  searchWarehouse1CCatalog,
  type Warehouse1CCatalogItem,
  type Warehouse1CCatalogKind,
  type Warehouse1CCatalogStatus,
} from '../../api/warehouse1cApi';
import { formatApiError } from '../../api/formatError';
import { useAuth } from '../../auth/AuthContext';
import { NativeWarehouse1CCatalogCard } from '../../components/warehouse1c/NativeWarehouse1CCards';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import { AccountScreenScaffold, AccountSectionCard } from '../account/AccountChrome';

const SEARCH_LIMIT = 30;

function formatDateTime(value: string): string {
  if (!value) return 'Нет подтверждённого снимка';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU');
}

function statusCopy(status: Warehouse1CCatalogStatus | null): { title: string; detail: string; tone: 'normal' | 'warning' | 'error' } {
  if (!status) return { title: 'Статус не загружен', detail: 'Полнота каталога пока не подтверждена.', tone: 'warning' };
  const detail = `Снимок: ${formatDateTime(status.updated_at)}`;
  if (status.status === 'ok') return { title: 'Каталог актуален', detail, tone: 'normal' };
  if (status.status === 'stale') return { title: 'Каталог давно не обновлялся', detail, tone: 'warning' };
  if (status.status === 'incomplete') return { title: 'Каталог загружен не полностью', detail, tone: 'warning' };
  if (status.status === 'error') return { title: 'Последнее обновление завершилось с ошибкой', detail, tone: 'error' };
  return { title: 'Полнота каталога не подтверждена', detail, tone: 'warning' };
}

function ModeButton({
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
        styles.modeButton,
        { backgroundColor: selected ? tokens.primary : tokens.panelSolid, borderColor: selected ? tokens.primary : tokens.border },
      ]}
    >
      <Text style={[styles.modeText, { color: selected ? '#fff' : tokens.textPrimary }]}>{label}</Text>
    </Pressable>
  );
}

export function NativeWarehouse1CScreen() {
  const { hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const canRead = hasPermission('warehouse_1c.read');
  const [kind, setKind] = useState<Warehouse1CCatalogKind>('nomenclature');
  const [queryDraft, setQueryDraft] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Warehouse1CCatalogItem[]>([]);
  const [status, setStatus] = useState<Warehouse1CCatalogStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [revision, setRevision] = useState(0);
  const [statusRevision, setStatusRevision] = useState(0);
  const searchGenerationRef = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);
  const statusAbortRef = useRef<AbortController | null>(null);
  const focusedRef = useRef(false);
  const firstFocusRef = useRef(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(queryDraft.replace(/\s+/g, ' ').trim().slice(0, 200));
    }, 300);
    return () => clearTimeout(timer);
  }, [queryDraft]);

  useEffect(() => {
    if (!canRead || offlineMode) {
      statusAbortRef.current?.abort();
      setStatus(null);
      return;
    }
    statusAbortRef.current?.abort();
    const controller = new AbortController();
    statusAbortRef.current = controller;
    setStatusError('');
    void getWarehouse1CCatalogStatus({ signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setStatus(result);
    }).catch((cause) => {
      if (!controller.signal.aborted) setStatusError(formatApiError(cause, 'Не удалось получить состояние каталога 1С.'));
    });
    return () => controller.abort();
  }, [canRead, offlineMode, statusRevision]);

  useEffect(() => {
    const normalized = query.trim();
    searchGenerationRef.current += 1;
    const requestId = searchGenerationRef.current;
    searchAbortRef.current?.abort();
    if (!canRead || offlineMode || normalized.length < 2) {
      setItems([]);
      setLoading(false);
      setRefreshing(false);
      setError('');
      return;
    }
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setLoading(true);
    setError('');
    void searchWarehouse1CCatalog({ kind, query: normalized, limit: SEARCH_LIMIT, signal: controller.signal }).then((result) => {
      if (requestId === searchGenerationRef.current && !controller.signal.aborted) setItems(result);
    }).catch((cause) => {
      if (requestId === searchGenerationRef.current && !controller.signal.aborted) {
        setItems([]);
        setError(formatApiError(cause, 'Не удалось выполнить поиск в каталоге 1С.'));
      }
    }).finally(() => {
      if (requestId === searchGenerationRef.current && !controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    });
    return () => controller.abort();
  }, [canRead, kind, offlineMode, query, revision]);

  const cancelRequests = useCallback(() => {
    searchGenerationRef.current += 1;
    searchAbortRef.current?.abort();
    statusAbortRef.current?.abort();
    setLoading(false);
    setRefreshing(false);
  }, []);

  const refresh = useCallback(() => {
    if (offlineMode || !canRead) return;
    setRefreshing(query.length >= 2);
    setRevision((value) => value + 1);
    setStatusRevision((value) => value + 1);
  }, [canRead, offlineMode, query.length]);

  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    if (firstFocusRef.current) firstFocusRef.current = false;
    else {
      setRevision((value) => value + 1);
      setStatusRevision((value) => value + 1);
    }
    return () => {
      focusedRef.current = false;
      cancelRequests();
    };
  }, [cancelRequests]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (stateValue) => {
      if (stateValue !== 'active') {
        cancelRequests();
        return;
      }
      if (focusedRef.current) {
        setRevision((value) => value + 1);
        setStatusRevision((value) => value + 1);
      }
    });
    return () => subscription.remove();
  }, [cancelRequests]);

  useEffect(() => {
    if (canRead) return;
    cancelRequests();
    setItems([]);
    setQueryDraft('');
    setQuery('');
  }, [canRead, cancelRequests]);

  if (!canRead) {
    return (
      <AccountScreenScaffold title="Склад 1С" tokens={tokens}>
        <AccountSectionCard tokens={tokens} title="Нет доступа" description="Для раздела нужно право warehouse_1c.read.">{null}</AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  const statusMessage = statusCopy(status);
  const statusColor = statusMessage.tone === 'error'
    ? tokens.error
    : (statusMessage.tone === 'warning' ? tokens.warning : tokens.primary);

  const header = (
    <View style={styles.header}>
      {offlineMode ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.warning }]}>Требуется сеть: каталог 1С не сохраняется на устройстве.</Text> : null}
      {error ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.error }]}>{error}</Text> : null}
      {statusError ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.error }]}>{statusError}</Text> : null}
      <View style={[styles.boundary, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
        <MaterialCommunityIcons name="database-search-outline" size={23} color={tokens.primary} />
        <View style={styles.flex}>
          <Text style={[styles.boundaryTitle, { color: tokens.textPrimary }]}>Без live-запросов к 1С</Text>
          <Text style={[styles.boundaryText, { color: tokens.textSecondary }]}>Доступен безопасный поиск по снимку справочников. Остатки, движения, сотрудники, вложения и сверка пока не поддерживаются на мобильном устройстве.</Text>
        </View>
      </View>
      <View style={[styles.statusCard, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}>
        <View style={[styles.statusIcon, { backgroundColor: tokens.panelInset }]}><MaterialCommunityIcons name="database-clock-outline" size={22} color={statusColor} /></View>
        <View style={styles.flex}>
          <Text accessibilityLiveRegion="polite" style={[styles.statusTitle, { color: statusColor }]}>{statusMessage.title}</Text>
          <Text style={[styles.statusDetail, { color: tokens.textSecondary }]}>{statusMessage.detail}</Text>
          {status && status.status !== 'unknown' ? (
            <Text style={[styles.statusCounts, { color: tokens.textSecondary }]}>Номенклатура: {status.nomenclature_count} · Склады: {status.warehouses_count}</Text>
          ) : null}
        </View>
      </View>
      <View accessibilityRole="tablist" style={styles.modes}>
        <ModeButton label="Номенклатура" selected={kind === 'nomenclature'} onPress={() => { setKind('nomenclature'); setQueryDraft(''); setQuery(''); }} tokens={tokens} />
        <ModeButton label="Склады" selected={kind === 'warehouses'} onPress={() => { setKind('warehouses'); setQueryDraft(''); setQuery(''); }} tokens={tokens} />
      </View>
      <View style={[styles.search, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}>
        <MaterialCommunityIcons name="magnify" size={21} color={tokens.iconMuted} />
        <TextInput
          testID="native-warehouse-1c-search"
          value={queryDraft}
          onChangeText={setQueryDraft}
          editable={!offlineMode}
          placeholder={kind === 'warehouses' ? 'Название склада' : 'Код или название'}
          placeholderTextColor={tokens.textTertiary}
          accessibilityLabel={kind === 'warehouses' ? 'Поиск склада 1С' : 'Поиск номенклатуры 1С'}
          returnKeyType="search"
          style={[styles.searchInput, { color: tokens.textPrimary }]}
        />
        {queryDraft ? <Pressable onPress={() => { setQueryDraft(''); setQuery(''); }} accessibilityRole="button" accessibilityLabel="Очистить поиск" style={styles.iconButton}><MaterialCommunityIcons name="close" size={20} color={tokens.iconMuted} /></Pressable> : null}
      </View>
      {query.length < 2 ? <Text style={[styles.hint, { color: tokens.textSecondary }]}>Введите минимум 2 символа.</Text> : null}
      {query.length >= 2 ? <Text accessibilityLiveRegion="polite" style={[styles.count, { color: tokens.textSecondary }]}>Найдено: {items.length}</Text> : null}
      {items.length >= SEARCH_LIMIT ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.warning }]}>Показаны первые {SEARCH_LIMIT} совпадений. Уточните запрос, если нужной записи нет.</Text> : null}
      {loading && items.length === 0 ? <View style={styles.loading}><ActivityIndicator color={tokens.primary} /><Text style={[styles.hint, { color: tokens.textSecondary }]}>Ищем в снимке каталога…</Text></View> : null}
      {!loading && error && items.length === 0 ? <Pressable testID="native-warehouse-1c-retry" disabled={offlineMode} onPress={refresh} accessibilityRole="button" style={[styles.primaryAction, { backgroundColor: tokens.primary, opacity: offlineMode ? 0.5 : 1 }]}><Text style={styles.primaryActionText}>Повторить</Text></Pressable> : null}
    </View>
  );

  return (
    <AccountScreenScaffold
      title="Склад 1С"
      tokens={tokens}
      scroll={false}
    >
      <FlatList
        testID="native-warehouse-1c-list"
        data={items}
        keyExtractor={(item) => item.ref}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={items.length ? styles.list : styles.emptyList}
        ListHeaderComponent={header}
        ListEmptyComponent={!loading && !error && query.length >= 2 && !offlineMode ? <Text style={[styles.empty, { color: tokens.textSecondary }]}>По запросу ничего не найдено.</Text> : null}
        renderItem={({ item }) => (
          <NativeWarehouse1CCatalogCard
            item={item}
            kind={kind}
            tokens={tokens}
          />
        )}
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
  boundary: { minHeight: 82, borderWidth: 1, borderRadius: 15, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  boundaryTitle: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  boundaryText: { marginTop: 2, fontSize: 11, lineHeight: 16 },
  statusCard: { minHeight: 88, borderWidth: 1, borderRadius: 16, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  statusTitle: { fontSize: 13, lineHeight: 18, fontWeight: '900' },
  statusDetail: { marginTop: 2, fontSize: 11, lineHeight: 16 },
  statusCounts: { marginTop: 3, fontSize: 11, lineHeight: 16, fontWeight: '700' },
  modes: { flexDirection: 'row', gap: 8 },
  modeButton: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 13, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  modeText: { fontSize: 12, lineHeight: 17, fontWeight: '800', textAlign: 'center' },
  search: { minHeight: 48, borderWidth: 1, borderRadius: 13, paddingLeft: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, minHeight: 46, fontSize: 15 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 12, lineHeight: 17 },
  count: { minHeight: 24, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  loading: { minHeight: 96, alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryAction: { minHeight: 44, borderRadius: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  primaryActionText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  list: { gap: 9, paddingBottom: 8 },
  emptyList: { flexGrow: 1, paddingBottom: 60 },
  empty: { paddingVertical: 22, textAlign: 'center', fontSize: 13, lineHeight: 19 },
});
