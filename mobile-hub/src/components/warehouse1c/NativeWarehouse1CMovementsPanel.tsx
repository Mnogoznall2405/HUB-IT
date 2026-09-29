import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {
  Warehouse1CCatalogItem,
  Warehouse1CListMeta,
  Warehouse1CMovement,
} from '../../api/warehouse1cApi';
import type { FluentTokens } from '../../theme/fluentTokens';
import { useNativeBottomNavInset } from '../../navigation/useNativeBottomNavInset';
import { NativeWarehouse1CMovementCard } from './NativeWarehouse1CCards';
import { Warehouse1cMetaNotice } from './NativeWarehouse1CBalancesPanel';
import { NativeWarehouse1CActiveChip } from './NativeWarehouse1CFilterRow';
import { NativeWarehouse1CFilterSheet } from './NativeWarehouse1CFilterSheet';
import {
  WAREHOUSE_1C_PERIOD_OPTIONS,
  movementPeriodDates,
  type Warehouse1cMovementPeriod,
} from './nativeWarehouse1cFilters';

export { WAREHOUSE_1C_PERIOD_OPTIONS, movementPeriodDates };
export type { Warehouse1cMovementPeriod };

export function NativeWarehouse1CMovementsPanel({
  tokens,
  offline,
  nomenclature,
  warehouse,
  period,
  onPickNomenclature,
  onPickWarehouse,
  onClearNomenclature,
  onClearWarehouse,
  onSelectPeriod,
  searched,
  loading,
  refreshing,
  loadingMore,
  error,
  items,
  meta,
  onSearch,
  onRefresh,
  onLoadMore,
  onOpenDetail,
}: {
  tokens: FluentTokens;
  offline: boolean;
  nomenclature: Warehouse1CCatalogItem | null;
  warehouse: Warehouse1CCatalogItem | null;
  period: Warehouse1cMovementPeriod;
  onPickNomenclature: () => void;
  onPickWarehouse: () => void;
  onClearNomenclature: () => void;
  onClearWarehouse: () => void;
  onSelectPeriod: (period: Warehouse1cMovementPeriod) => void;
  searched: boolean;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error: string;
  items: Warehouse1CMovement[];
  meta: Warehouse1CListMeta | null;
  onSearch: () => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onOpenDetail: (item: Warehouse1CMovement) => void;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const navInset = useNativeBottomNavInset();
  const filterCount = Number(Boolean(nomenclature)) + Number(Boolean(warehouse)) + Number(period !== 'all');
  const periodLabel = WAREHOUSE_1C_PERIOD_OPTIONS.find((option) => option.value === period)?.label || '';

  return (
    <View style={styles.root}>
      <View style={styles.fixedHeader}>
        {offline ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.warning }]}>Требуется сеть: движения 1С не сохраняются на устройстве.</Text> : null}
        {error ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.error }]}>{error}</Text> : null}
        <View style={styles.toolbar}>
          <Pressable
            testID="native-warehouse-1c-movements-filters"
            accessibilityRole="button"
            accessibilityLabel={`Фильтры движений${filterCount ? `. Выбрано: ${filterCount}` : ''}`}
            onPress={() => setFiltersOpen(true)}
            style={({ pressed }) => [
              styles.filterButton,
              { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft },
              pressed && styles.pressed,
            ]}
          >
            <MaterialCommunityIcons name="filter-variant" size={20} color={tokens.primary} />
            <Text style={[styles.filterButtonText, { color: tokens.textPrimary }]}>Фильтры</Text>
            {filterCount ? (
              <View style={[styles.filterBadge, { backgroundColor: tokens.primary }]}>
                <Text style={styles.filterBadgeText}>{filterCount}</Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable
            testID="native-warehouse-1c-movements-search"
            accessibilityRole="button"
            disabled={offline || loading || !nomenclature}
            onPress={onSearch}
            style={({ pressed }) => [
              styles.searchButton,
              { backgroundColor: tokens.primary, opacity: offline || loading || !nomenclature ? 0.5 : 1 },
              pressed && styles.pressed,
            ]}
          >
            <MaterialCommunityIcons name="magnify" size={18} color="#fff" />
            <Text style={styles.searchButtonText}>Показать</Text>
          </Pressable>
        </View>
        {nomenclature || warehouse || period !== 'all' ? (
          <View style={styles.chips}>
            {nomenclature ? (
              <NativeWarehouse1CActiveChip
                testID="native-warehouse-1c-movements-chip-nomenclature"
                label="Позиция"
                value={nomenclature.name || nomenclature.ref}
                tokens={tokens}
                onClear={onClearNomenclature}
              />
            ) : null}
            {warehouse ? (
              <NativeWarehouse1CActiveChip
                testID="native-warehouse-1c-movements-chip-warehouse"
                label="Склад"
                value={warehouse.name || warehouse.ref}
                tokens={tokens}
                onClear={onClearWarehouse}
              />
            ) : null}
            {period !== 'all' ? (
              <NativeWarehouse1CActiveChip
                testID="native-warehouse-1c-movements-chip-period"
                label="Период"
                value={periodLabel}
                tokens={tokens}
                onClear={() => onSelectPeriod('all')}
              />
            ) : null}
          </View>
        ) : null}
        {!nomenclature && !loading ? (
          <Text style={[styles.hint, { color: tokens.textSecondary }]}>
            Выберите позицию через «Фильтры» — без неё ведомость не строится.
          </Text>
        ) : null}
        <Warehouse1cMetaNotice meta={meta} entityLabel="Движения" tokens={tokens} />
        {searched && !loading ? (
          <Text accessibilityLiveRegion="polite" style={[styles.count, { color: tokens.textSecondary }]}>
            Найдено: {items.length}{meta?.total != null ? ` из ${meta.total}` : ''}{meta?.asOf ? ` · по состоянию на ${new Date(meta.asOf).toLocaleString('ru-RU')}` : ''}
          </Text>
        ) : null}
        {loading && items.length === 0 ? (
          <View style={styles.loading}>
            <ActivityIndicator color={tokens.primary} />
            <Text style={[styles.hint, { color: tokens.textSecondary }]}>Запрашиваем движения в 1С…</Text>
          </View>
        ) : null}
        {!loading && error && items.length === 0 && searched ? (
          <Pressable testID="native-warehouse-1c-movements-retry" disabled={offline} onPress={onRefresh} accessibilityRole="button" style={[styles.primaryAction, { backgroundColor: tokens.primary, opacity: offline ? 0.5 : 1 }]}>
            <Text style={styles.primaryActionText}>Повторить</Text>
          </Pressable>
        ) : null}
      </View>
      <FlatList
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={7}
        testID="native-warehouse-1c-movements-list"
        data={items}
        keyExtractor={(item, index) => `${item.registrarRef || item.registrarName}|${item.period}|${index}`}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={items.length ? [styles.list, { paddingBottom: navInset }] : [styles.emptyList, { paddingBottom: navInset }]}
        ListEmptyComponent={
          !loading && !error && !offline ? (
            <Text style={[styles.empty, { color: tokens.textSecondary }]}>
              {searched ? 'Движения по заданным фильтрам не найдены.' : ''}
            </Text>
          ) : null
        }
        ListFooterComponent={
          meta?.nextCursor ? (
            <Pressable
              testID="native-warehouse-1c-movements-more"
              accessibilityRole="button"
              disabled={loadingMore || offline}
              onPress={onLoadMore}
              style={({ pressed }) => [styles.moreAction, { borderColor: tokens.selectedBorder, backgroundColor: tokens.selected }, pressed && styles.pressed]}
            >
              {loadingMore ? <ActivityIndicator size="small" color={tokens.primary} /> : <Text style={[styles.moreText, { color: tokens.primary }]}>Показать ещё</Text>}
            </Pressable>
          ) : null
        }
        renderItem={({ item }) => (
          <NativeWarehouse1CMovementCard item={item} tokens={tokens} onPress={onOpenDetail} />
        )}
        refreshing={refreshing}
        onRefresh={searched ? onRefresh : undefined}
      />
      <NativeWarehouse1CFilterSheet
        visible={filtersOpen}
        title="Фильтры движений"
        nomenclature={nomenclature}
        warehouse={warehouse}
        period={period}
        requireNomenclature
        applyLabel="Показать движения"
        applyDisabled={offline || loading}
        tokens={tokens}
        onPickNomenclature={onPickNomenclature}
        onPickWarehouse={onPickWarehouse}
        onSelectPeriod={onSelectPeriod}
        onClearNomenclature={onClearNomenclature}
        onClearWarehouse={onClearWarehouse}
        onApply={() => { setFiltersOpen(false); onSearch(); }}
        onReset={() => { onClearNomenclature(); onClearWarehouse(); onSelectPeriod('all'); setFiltersOpen(false); }}
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
  toolbar: { flexDirection: 'row', gap: 8 },
  filterButton: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterButtonText: { flex: 1, fontSize: 14, fontWeight: '800' },
  filterBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800', lineHeight: 14 },
  searchButton: {
    minHeight: 44,
    borderRadius: 13,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  searchButtonText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  hint: { fontSize: 12, lineHeight: 17 },
  primaryAction: { minHeight: 44, borderRadius: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  primaryActionText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  count: { minHeight: 22, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  loading: { minHeight: 80, alignItems: 'center', justifyContent: 'center', gap: 8 },
  moreAction: { minHeight: 44, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  moreText: { fontSize: 13, fontWeight: '800' },
  list: { paddingBottom: 8 },
  emptyList: { flexGrow: 1, paddingBottom: 60 },
  empty: { paddingVertical: 26, textAlign: 'center', fontSize: 13, lineHeight: 19 },
});
