import { useContext } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext, initialWindowMetrics } from 'react-native-safe-area-context';
import type { Warehouse1CCatalogItem } from '../../api/warehouse1cApi';
import type { FluentTokens } from '../../theme/fluentTokens';
import { NativeFilterChip, NativeSheetHeader } from '../ui/NativeFilterControls';
import { NativeModal } from '../ui/NativeModal';
import {
  WAREHOUSE_1C_PERIOD_OPTIONS,
  type Warehouse1cMovementPeriod,
} from './nativeWarehouse1cFilters';
import { NativeWarehouse1CFilterRow } from './NativeWarehouse1CFilterRow';

export function NativeWarehouse1CFilterSheet({
  visible,
  title,
  nomenclature,
  warehouse,
  period,
  requireNomenclature = false,
  applyLabel,
  applyDisabled = false,
  tokens,
  onPickNomenclature,
  onPickWarehouse,
  onSelectPeriod,
  onClearNomenclature,
  onClearWarehouse,
  onApply,
  onReset,
  onClose,
}: {
  visible: boolean;
  title: string;
  nomenclature: Warehouse1CCatalogItem | null;
  warehouse: Warehouse1CCatalogItem | null;
  period?: Warehouse1cMovementPeriod;
  requireNomenclature?: boolean;
  applyLabel: string;
  applyDisabled?: boolean;
  tokens: FluentTokens;
  onPickNomenclature: () => void;
  onPickWarehouse: () => void;
  onSelectPeriod?: (period: Warehouse1cMovementPeriod) => void;
  onClearNomenclature: () => void;
  onClearWarehouse: () => void;
  onApply: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const insets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets;
  const hasFilters = Boolean(nomenclature || warehouse || (period && period !== 'all'));
  const applyBlocked = applyDisabled || (requireNomenclature && !nomenclature);

  return (
    <NativeModal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть фильтры"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          testID="native-warehouse-1c-filter-sheet"
          accessibilityViewIsModal
          style={[styles.sheet, {
            backgroundColor: tokens.panelSolid,
            borderColor: tokens.borderSoft,
            paddingBottom: Math.max(16, (insets?.bottom || 0) + 8),
            paddingLeft: insets?.left || 0,
            paddingRight: insets?.right || 0,
          }]}
        >
          <NativeSheetHeader title={title} tokens={tokens} onClose={onClose} />
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <NativeWarehouse1CFilterRow
              testID="native-warehouse-1c-filter-nomenclature"
              label="Номенклатура"
              icon="package-variant-closed"
              required={requireNomenclature}
              value={nomenclature?.name || nomenclature?.ref || ''}
              placeholder={requireNomenclature ? 'Обязательно — нажмите, чтобы выбрать' : 'Любая — нажмите, чтобы выбрать'}
              tokens={tokens}
              onPress={onPickNomenclature}
              onClear={nomenclature ? onClearNomenclature : undefined}
            />
            <NativeWarehouse1CFilterRow
              testID="native-warehouse-1c-filter-warehouse"
              label="Склад"
              icon="warehouse"
              value={warehouse?.name || warehouse?.ref || ''}
              placeholder="Все склады — нажмите, чтобы выбрать"
              tokens={tokens}
              onPress={onPickWarehouse}
              onClear={warehouse ? onClearWarehouse : undefined}
            />
            {period !== undefined && onSelectPeriod ? (
              <View>
                <Text style={[styles.periodLabel, { color: tokens.textSecondary }]}>Период</Text>
                <View style={styles.periodChips}>
                  {WAREHOUSE_1C_PERIOD_OPTIONS.map((option) => (
                    <NativeFilterChip
                      key={option.value}
                      label={option.label}
                      selected={period === option.value}
                      tokens={tokens}
                      onPress={() => onSelectPeriod(option.value)}
                      testID={`native-warehouse-1c-period-${option.value}`}
                    />
                  ))}
                </View>
              </View>
            ) : null}
            <View style={styles.actions}>
              {hasFilters ? (
                <Pressable
                  testID="native-warehouse-1c-filters-reset"
                  accessibilityRole="button"
                  onPress={onReset}
                  style={({ pressed }) => [
                    styles.secondaryAction,
                    { borderColor: tokens.borderSoft, backgroundColor: tokens.panelInset },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.secondaryActionText, { color: tokens.textPrimary }]}>Сбросить</Text>
                </Pressable>
              ) : null}
              <Pressable
                testID="native-warehouse-1c-filters-apply"
                accessibilityRole="button"
                disabled={applyBlocked}
                onPress={onApply}
                style={({ pressed }) => [
                  styles.primaryAction,
                  { backgroundColor: tokens.primary, opacity: applyBlocked ? 0.5 : 1 },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.primaryActionText}>{applyLabel}</Text>
              </Pressable>
            </View>
            <Text style={[styles.hint, { color: tokens.textSecondary }]}>
              Фильтры необязательны — без них покажем первую порцию данных из 1С.
            </Text>
          </ScrollView>
        </View>
      </View>
    </NativeModal>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.82 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.48)' },
  sheet: {
    maxHeight: '92%',
    borderWidth: 1,
    borderBottomWidth: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  body: { paddingHorizontal: 14, paddingBottom: 20, gap: 9 },
  periodLabel: { fontSize: 11, lineHeight: 15, fontWeight: '700', marginBottom: 6 },
  periodChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actions: { flexDirection: 'row', gap: 9, marginTop: 3 },
  primaryAction: { flex: 1, minHeight: 46, borderRadius: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  primaryActionText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  secondaryAction: { minHeight: 46, minWidth: 110, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  secondaryActionText: { fontSize: 13, fontWeight: '800' },
  hint: { fontSize: 11, lineHeight: 16 },
});
