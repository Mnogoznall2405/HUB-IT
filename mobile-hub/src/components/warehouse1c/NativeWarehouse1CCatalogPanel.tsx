import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import type { FluentTokens } from '../../theme/fluentTokens';
import { useNativeBottomNavInset } from '../../navigation/useNativeBottomNavInset';
import { NativeFilterChip } from '../ui/NativeFilterControls';
import { NativeWarehouse1CCatalogCard } from './NativeWarehouse1CCards';

const SEARCH_LIMIT = 30;

function formatDateTime(value: string): string {
  if (!value) return 'нет данных';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU');
}

function statusCopy(status: Warehouse1CCatalogStatus | null): { title: string; detail: string; tone: 'normal' | 'warning' | 'error' } {
  if (!status) return { title: 'Статус не загружен', detail: '', tone: 'warning' };
  const detail = `обновлён ${formatDateTime(status.updated_at)}`;
  if (status.status === 'ok') return { title: 'Каталог актуален', detail, tone: 'normal' };
  if (status.status === 'stale') return { title: 'Каталог давно не обновлялся', detail, tone: 'warning' };
  if (status.status === 'incomplete') return { title: 'Каталог загружен не полностью', detail, tone: 'warning' };
  if (status.status === 'error') return { title: 'Обновление завершилось с ошибкой', detail, tone: 'error' };
  return { title: 'Свежесть каталога не подтверждена', detail, tone: 'warning' };
}

export function NativeWarehouse1CCatalogPanel({
  tokens,
  canRead,
  offline,
  active,
}: {
  tokens: FluentTokens;
  canRead: boolean;
  offline: boolean;
  active: boolean;
}) {
  const [kind, setKind] = useState<Warehouse1CCatalogKind>('nomenclature');
const navInset = useNativeBottomNavInset();
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

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(queryDraft.replace(/\s+/g, ' ').trim().slice(0, 200));
    }, 300);
    return () => clearTimeout(timer);
  }, [queryDraft]);

  useEffect(() => {
    if (!active || !canRead || offline) {
      statusAbortRef.current?.abort();
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
  }, [active, canRead, offline, statusRevision]);

  useEffect(() => {
    const normalized = query.trim();
    searchGenerationRef.current += 1;
    const requestId = searchGenerationRef.current;
    searchAbortRef.current?.abort();
    if (!active || !canRead || offline || normalized.length < 2) {
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
  }, [active, canRead, kind, offline, query, revision]);

  const refresh = useCallback(() => {
    if (offline || !canRead) return;
    setRefreshing(query.length >= 2);
    setRevision((value) => value + 1);
    setStatusRevision((value) => value + 1);
  }, [canRead, offline, query.length]);

  const statusMessage = statusCopy(status);
  const statusColor = statusMessage.tone === 'error'
    ? tokens.error
    : (statusMessage.tone === 'warning' ? tokens.warning : tokens.primary);

  return (
    <View style={styles.root}>
      <View style={styles.fixedHeader}>
        {offline ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.warning }]}>Требуется сеть: каталог 1С не сохраняется на устройстве.</Text> : null}
        {error ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.error }]}>{error}</Text> : null}
        {statusError ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.error }]}>{statusError}</Text> : null}
        <View style={styles.toolbar}>
          <View style={[styles.search, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}>
            <MaterialCommunityIcons name="magnify" size={21} color={tokens.iconMuted} />
            <TextInput
              testID="native-warehouse-1c-search"
              value={queryDraft}
              onChangeText={setQueryDraft}
              editable={!offline}
              placeholder={kind === 'warehouses' ? 'Название склада' : 'Код или название позиции'}
              placeholderTextColor={tokens.textTertiary}
              accessibilityLabel={kind === 'warehouses' ? 'Поиск склада 1С' : 'Поиск номенклатуры 1С'}
              returnKeyType="search"
              style={[styles.searchInput, { color: tokens.textPrimary }]}
            />
            {queryDraft ? <Pressable onPress={() => { setQueryDraft(''); setQuery(''); }} accessibilityRole="button" accessibilityLabel="Очистить поиск" style={styles.iconButton}><MaterialCommunityIcons name="close" size={20} color={tokens.iconMuted} /></Pressable> : null}
          </View>
        </View>
        <View accessibilityRole="tablist" style={styles.modes}>
          <NativeFilterChip
            label="Номенклатура"
            selected={kind === 'nomenclature'}
            tokens={tokens}
            onPress={() => { setKind('nomenclature'); setQueryDraft(''); setQuery(''); }}
            testID="native-warehouse-1c-kind-nomenclature"
          />
          <NativeFilterChip
            label="Склады"
            selected={kind === 'warehouses'}
            tokens={tokens}
            onPress={() => { setKind('warehouses'); setQueryDraft(''); setQuery(''); }}
            testID="native-warehouse-1c-kind-warehouses"
          />
          <Text numberOfLines={1} accessibilityLiveRegion="polite" style={[styles.statusLine, { color: statusColor }]}>
            {statusMessage.title}{status && status.status !== 'unknown' ? ` · ${status.nomenclature_count} поз.` : ''}
          </Text>
        </View>
        {queryDraft.length > 0 && queryDraft.trim().length < 2 ? <Text style={[styles.hint, { color: tokens.textSecondary }]}>Введите минимум 2 символа — поиск начнётся сам.</Text> : null}
        {query.length >= 2 ? <Text accessibilityLiveRegion="polite" style={[styles.count, { color: tokens.textSecondary }]}>Найдено: {items.length}</Text> : null}
        {items.length >= SEARCH_LIMIT ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.warning }]}>Показаны первые {SEARCH_LIMIT} совпадений. Уточните запрос, если нужной записи нет.</Text> : null}
        {loading && items.length === 0 ? <View style={styles.loading}><ActivityIndicator color={tokens.primary} /><Text style={[styles.hint, { color: tokens.textSecondary }]}>Ищем в снимке каталога…</Text></View> : null}
        {!loading && error && items.length === 0 ? <Pressable testID="native-warehouse-1c-retry" disabled={offline} onPress={refresh} accessibilityRole="button" style={[styles.primaryAction, { backgroundColor: tokens.primary, opacity: offline ? 0.5 : 1 }]}><Text style={styles.primaryActionText}>Повторить</Text></Pressable> : null}
      </View>
      <FlatList
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={7}
        testID="native-warehouse-1c-list"
        data={items}
        keyExtractor={(item) => item.ref}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={items.length ? [styles.list, { paddingBottom: navInset }] : [styles.emptyList, { paddingBottom: navInset }]}
        ListEmptyComponent={!loading && !error && query.length >= 2 && !offline ? <Text style={[styles.empty, { color: tokens.textSecondary }]}>По запросу ничего не найдено.</Text> : null}
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fixedHeader: { gap: 8, paddingBottom: 8 },
  notice: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  statusLine: { flex: 1, minWidth: 0, fontSize: 11, lineHeight: 16, fontWeight: '700' },
  toolbar: { flexDirection: 'row', gap: 8 },
  modes: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  search: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 13, paddingLeft: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, minHeight: 42, fontSize: 15 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 11, lineHeight: 16 },
  count: { minHeight: 24, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  loading: { minHeight: 80, alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryAction: { minHeight: 44, borderRadius: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  primaryActionText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  list: { paddingBottom: 8 },
  emptyList: { flexGrow: 1, paddingBottom: 60 },
  empty: { paddingVertical: 26, textAlign: 'center', fontSize: 13, lineHeight: 19 },
});
