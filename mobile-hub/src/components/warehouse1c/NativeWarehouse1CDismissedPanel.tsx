import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type {
  Warehouse1CDismissedWarehouse,
  Warehouse1CListMeta,
} from '../../api/warehouse1cApi';
import type { FluentTokens } from '../../theme/fluentTokens';
import { useNativeBottomNavInset } from '../../navigation/useNativeBottomNavInset';
import { NativeWarehouse1CDismissedCard } from './NativeWarehouse1CCards';
import { Warehouse1cMetaNotice } from './NativeWarehouse1CBalancesPanel';

export function NativeWarehouse1CDismissedPanel({
  tokens,
  offline,
  loading,
  refreshing,
  error,
  items,
  meta,
  expandedRefs,
  onToggle,
  onRefresh,
}: {
  tokens: FluentTokens;
  offline: boolean;
  loading: boolean;
  refreshing: boolean;
  error: string;
  items: Warehouse1CDismissedWarehouse[];
  meta: Warehouse1CListMeta | null;
  expandedRefs: Set<string>;
  onToggle: (key: string) => void;
  onRefresh: () => void;
}) {
  const [cityDraft, setCityDraft] = useState('');
  const navInset = useNativeBottomNavInset();
  const normalizedCity = cityDraft.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!normalizedCity) return items;
    return items.filter((item) => {
      const cities = [item.city, ...item.employeeCandidates.map((candidate) => candidate.city)];
      return cities.some((city) => String(city || '').toLowerCase().includes(normalizedCity));
    });
  }, [items, normalizedCity]);

  return (
    <View style={styles.root}>
      <View style={styles.fixedHeader}>
        {offline ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.warning }]}>Требуется сеть: список не сохраняется на устройстве.</Text> : null}
        {error ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.error }]}>{error}</Text> : null}
        <Text style={[styles.hint, { color: tokens.textSecondary }]}>
          Склады, за которыми числятся остатки уволенных сотрудников. Нажмите на карточку — раскроется список позиций.
        </Text>
        <View style={[styles.search, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}>
          <MaterialCommunityIcons name="city-variant-outline" size={21} color={tokens.iconMuted} />
          <TextInput
            testID="native-warehouse-1c-dismissed-city"
            value={cityDraft}
            onChangeText={setCityDraft}
            placeholder="Фильтр по городу — необязательно"
            placeholderTextColor={tokens.textTertiary}
            accessibilityLabel="Фильтр по городу"
            style={[styles.searchInput, { color: tokens.textPrimary }]}
          />
          {cityDraft ? (
            <Pressable onPress={() => setCityDraft('')} accessibilityRole="button" accessibilityLabel="Очистить фильтр" style={styles.iconButton}>
              <MaterialCommunityIcons name="close" size={20} color={tokens.iconMuted} />
            </Pressable>
          ) : null}
        </View>
        <Warehouse1cMetaNotice meta={meta} entityLabel="Склады уволенных" tokens={tokens} />
        {!loading ? <Text accessibilityLiveRegion="polite" style={[styles.count, { color: tokens.textSecondary }]}>Показано: {filtered.length} из {items.length}</Text> : null}
        {loading && items.length === 0 ? (
          <View style={styles.loading}>
            <ActivityIndicator color={tokens.primary} />
            <Text style={[styles.hint, { color: tokens.textSecondary }]}>Ищем склады уволенных сотрудников…</Text>
          </View>
        ) : null}
      </View>
      <FlatList
        initialNumToRender={10}
        maxToRenderPerBatch={8}
        windowSize={7}
        testID="native-warehouse-1c-dismissed-list"
        data={filtered}
        keyExtractor={(item, index) => item.warehouseRef || item.warehouseName || String(index)}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={filtered.length ? [styles.list, { paddingBottom: navInset }] : [styles.emptyList, { paddingBottom: navInset }]}
        ListEmptyComponent={!loading && !error && !offline ? <Text style={[styles.empty, { color: tokens.textSecondary }]}>{normalizedCity ? 'По фильтру ничего не найдено.' : 'Склады уволенных сотрудников не найдены.'}</Text> : null}
        renderItem={({ item, index }) => {
          const key = item.warehouseRef || item.warehouseName || String(index);
          return (
            <NativeWarehouse1CDismissedCard
              item={item}
              expanded={expandedRefs.has(key)}
              onToggle={() => onToggle(key)}
              tokens={tokens}
            />
          );
        }}
        refreshing={refreshing}
        onRefresh={onRefresh}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fixedHeader: { gap: 8, paddingBottom: 10 },
  notice: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  search: { minHeight: 48, borderWidth: 1, borderRadius: 13, paddingLeft: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, minHeight: 46, fontSize: 15 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 11, lineHeight: 16 },
  count: { minHeight: 24, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  loading: { minHeight: 80, alignItems: 'center', justifyContent: 'center', gap: 8 },
  list: { paddingBottom: 8 },
  emptyList: { flexGrow: 1, paddingBottom: 60 },
  empty: { paddingVertical: 26, textAlign: 'center', fontSize: 13, lineHeight: 19 },
});
