import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type {
  Warehouse1CBalance,
  Warehouse1CCatalogItem,
  Warehouse1CListMeta,
} from '../../api/warehouse1cApi';
import { isWarehouse1CListIncomplete } from '../../api/warehouse1cApi';
import type { FluentTokens } from '../../theme/fluentTokens';
import { useNativeBottomNavInset } from '../../navigation/useNativeBottomNavInset';
import { NativeWarehouse1CBalanceCard } from './NativeWarehouse1CCards';
import { NativeWarehouse1CActiveChip } from './NativeWarehouse1CFilterRow';
import { NativeWarehouse1CFilterSheet } from './NativeWarehouse1CFilterSheet';

export function Warehouse1cMetaNotice({
  meta,
  entityLabel,
  tokens,
}: {
  meta: Warehouse1CListMeta | null;
  entityLabel: string;
  tokens: FluentTokens;
}) {
  if (!isWarehouse1CListIncomplete(meta)) return null;
  const reason = meta?.incompleteReason;
  const detail = reason === 'dismissed_employees_unavailable'
    ? 'Список уволенных сотрудников недоступен — показан неполный результат.'
    : meta?.hasMore || meta?.nextCursor
      ? 'Показана только первая порция данных.'
      : 'Данные могут быть неполными.';
  return (
    <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.warning }]}>
      {entityLabel}: {detail}
    </Text>
  );
}

export function NativeWarehouse1CBalancesPanel({
  tokens,
  offline,
  nomenclature,
  warehouse,
  onPickNomenclature,
  onPickWarehouse,
  onClearNomenclature,
  onClearWarehouse,
  queryDraft,
  onQueryDraft,
  searched,
  loading,
  refreshing,
  error,
  items,
  meta,
  onSearch,
  onRefresh,
  onOpenMovements,
}: {
  tokens: FluentTokens;
  offline: boolean;
  nomenclature: Warehouse1CCatalogItem | null;
  warehouse: Warehouse1CCatalogItem | null;
  onPickNomenclature: () => void;
  onPickWarehouse: () => void;
  onClearNomenclature: () => void;
  onClearWarehouse: () => void;
  queryDraft: string;
  onQueryDraft: (value: string) => void;
  searched: boolean;
  loading: boolean;
  refreshing: boolean;
  error: string;
  items: Warehouse1CBalance[];
  meta: Warehouse1CListMeta | null;
  onSearch: () => void;
  onRefresh: () => void;
  onOpenMovements: (item: Warehouse1CBalance) => void;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const navInset = useNativeBottomNavInset();
  const filterCount = Number(Boolean(nomenclature)) + Number(Boolean(warehouse));

  return (
    <View style={styles.root}>
      <View style={styles.fixedHeader}>
        {offline ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.warning }]}>Требуется сеть: остатки 1С не сохраняются на устройстве.</Text> : null}
        {error ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.error }]}>{error}</Text> : null}
        <View style={styles.toolbar}>
          <View style={[styles.search, { backgroundColor: tokens.panelInset, borderColor: tokens.borderSoft }]}>
            <MaterialCommunityIcons name="magnify" size={21} color={tokens.iconMuted} />
            <TextInput
              testID="native-warehouse-1c-balances-query"
              value={queryDraft}
              onChangeText={onQueryDraft}
              editable={!offline}
              placeholder="Артикул или название"
              placeholderTextColor={tokens.textTertiary}
              accessibilityLabel="Текстовый поиск по остаткам 1С"
              returnKeyType="search"
              onSubmitEditing={onSearch}
              style={[styles.searchInput, { color: tokens.textPrimary }]}
            />
            {queryDraft ? (
              <Pressable onPress={() => onQueryDraft('')} accessibilityRole="button" accessibilityLabel="Очистить запрос" style={styles.iconButton}>
                <MaterialCommunityIcons name="close" size={20} color={tokens.iconMuted} />
              </Pressable>
            ) : null}
          </View>
          <Pressable
            testID="native-warehouse-1c-balances-filters"
            accessibilityRole="button"
            accessibilityLabel={`Фильтры остатков${filterCount ? `. Выбрано: ${filterCount}` : ''}`}
            onPress={() => setFiltersOpen(true)}
            style={({ pressed }) => [
              styles.filterButton,
              { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft },
              pressed && styles.pressed,
            ]}
          >
            <MaterialCommunityIcons name="filter-variant" size={22} color={tokens.primary} />
            {filterCount ? (
              <View style={[styles.filterBadge, { backgroundColor: tokens.primary }]}>
                <Text style={styles.filterBadgeText}>{filterCount}</Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable
            testID="native-warehouse-1c-balances-search"
            accessibilityRole="button"
            accessibilityLabel="Показать остатки"
            disabled={offline || loading}
            onPress={onSearch}
            style={({ pressed }) => [
              styles.searchButton,
              { backgroundColor: tokens.primary, opacity: offline || loading ? 0.5 : 1 },
              pressed && styles.pressed,
            ]}
          >
            <MaterialCommunityIcons name="arrow-right" size={20} color="#fff" />
          </Pressable>
        </View>
        {nomenclature || warehouse ? (
          <View style={styles.chips}>
            {nomenclature ? (
              <NativeWarehouse1CActiveChip
                testID="native-warehouse-1c-balance-chip-nomenclature"
                label="Позиция"
                value={nomenclature.name || nomenclature.ref}
                tokens={tokens}
                onClear={onClearNomenclature}
              />
            ) : null}
            {warehouse ? (
              <NativeWarehouse1CActiveChip
                testID="native-warehouse-1c-balance-chip-warehouse"
                label="Склад"
                value={warehouse.name || warehouse.ref}
                tokens={tokens}
                onClear={onClearWarehouse}
              />
            ) : null}
          </View>
        ) : null}
        <Warehouse1cMetaNotice meta={meta} entityLabel="Остатки" tokens={tokens} />
        {searched && !loading ? <Text accessibilityLiveRegion="polite" style={[styles.count, { color: tokens.textSecondary }]}>Найдено: {items.length}{meta?.total != null ? ` из ${meta.total}` : ''}</Text> : null}
        {loading && items.length === 0 ? (
          <View style={styles.loading}>
            <ActivityIndicator color={tokens.primary} />
            <Text style={[styles.hint, { color: tokens.textSecondary }]}>Запрашиваем остатки в 1С…</Text>
          </View>
        ) : null}
        {!loading && error && items.length === 0 && searched ? (
          <Pressable testID="native-warehouse-1c-balances-retry" disabled={offline} onPress={onRefresh} accessibilityRole="button" style={[styles.primaryAction, { backgroundColor: tokens.primary, opacity: offline ? 0.5 : 1 }]}>
            <Text style={styles.primaryActionText}>Повторить</Text>
          </Pressable>
        ) : null}
      </View>
      <FlatList
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={7}
        testID="native-warehouse-1c-balances-list"
        data={items}
        keyExtractor={(item, index) => `${item.nomenclatureRef || item.nomenclatureCode}|${item.seriesRef}|${item.warehouseRef}|${index}`}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={items.length ? [styles.list, { paddingBottom: navInset }] : [styles.emptyList, { paddingBottom: navInset }]}
        ListEmptyComponent={
          !loading && !error && !offline ? (
            <Text style={[styles.empty, { color: tokens.textSecondary }]}>
              {searched ? 'Остатки по заданным фильтрам не найдены.' : 'Введите запрос или нажмите стрелку — загрузим остатки из 1С.'}
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <NativeWarehouse1CBalanceCard item={item} tokens={tokens} onMovements={onOpenMovements} />
        )}
        refreshing={refreshing}
        onRefresh={searched ? onRefresh : undefined}
      />
      <NativeWarehouse1CFilterSheet
        visible={filtersOpen}
        title="Фильтры остатков"
        nomenclature={nomenclature}
        warehouse={warehouse}
        applyLabel="Показать остатки"
        applyDisabled={offline || loading}
        tokens={tokens}
        onPickNomenclature={onPickNomenclature}
        onPickWarehouse={onPickWarehouse}
        onClearNomenclature={onClearNomenclature}
        onClearWarehouse={onClearWarehouse}
        onApply={() => { setFiltersOpen(false); onSearch(); }}
        onReset={() => { onClearNomenclature(); onClearWarehouse(); onQueryDraft(''); setFiltersOpen(false); }}
        onClose={() => setFiltersOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.82 },
  root: { flex: 1 },
  fixedHeader: { gap: 8, paddingBottom: 8 },
  notice: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  toolbar: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  search: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 13, paddingLeft: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, minHeight: 42, fontSize: 15 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  filterButton: {
    width: 46,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800', lineHeight: 13 },
  searchButton: {
    width: 46,
    minHeight: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  primaryAction: { minHeight: 44, borderRadius: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  primaryActionText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  hint: { fontSize: 11, lineHeight: 16 },
  count: { minHeight: 24, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  loading: { minHeight: 80, alignItems: 'center', justifyContent: 'center', gap: 8 },
  list: { paddingBottom: 8 },
  emptyList: { flexGrow: 1, paddingBottom: 60 },
  empty: { paddingVertical: 26, textAlign: 'center', fontSize: 13, lineHeight: 19 },
});
