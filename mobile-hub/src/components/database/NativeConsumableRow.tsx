import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ConsumableRecord } from '../../api/databaseApi';
import type { FluentTokens } from '../../theme/fluentTokens';

export const NativeConsumableRow = memo(function NativeConsumableRow({
  item,
  tokens,
  onEditQuantity,
  onDelete,
}: {
  item: ConsumableRecord;
  tokens: FluentTokens;
  onEditQuantity?: (item: ConsumableRecord) => void;
  onDelete?: (item: ConsumableRecord) => void;
}) {
  const accentColor = tokens.scheme === 'dark' ? tokens.primaryLight : tokens.primary;
  const title = item.model_name || item.type_name || item.inv_no || `Расходник ${item.id}`;
  const identity = [item.type_name, item.part_no ? `P/N ${item.part_no}` : '', item.inv_no ? `№ ${item.inv_no}` : '']
    .filter(Boolean)
    .join(' · ');
  const location = [item.branch_name, item.location_name].filter(Boolean).join(' · ') || 'Местоположение не указано';
  return (
    <View
      testID={`native-consumable-${item.id}`}
      style={[styles.card, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}
    >
      <View style={[styles.icon, { backgroundColor: tokens.accentSoft }]}>
        <MaterialCommunityIcons name="package-variant-closed" size={23} color={accentColor} />
      </View>
      <View accessible accessibilityLabel={`${title}. Остаток ${item.qty}. ${location}`} style={styles.body}>
        <View style={[styles.quantity, { backgroundColor: tokens.selected }]}> 
          <Text style={[styles.quantityText, { color: accentColor }]}>{item.qty} шт.</Text>
        </View>
        <Text numberOfLines={2} style={[styles.title, { color: tokens.textPrimary }]}>{title}</Text>
        {identity ? <Text numberOfLines={2} style={[styles.meta, { color: tokens.textSecondary }]}>{identity}</Text> : null}
        <Text numberOfLines={2} style={[styles.location, { color: tokens.textTertiary }]}>{location}</Text>
        {item.description ? <Text numberOfLines={2} style={[styles.description, { color: tokens.textSecondary }]}>{item.description}</Text> : null}
      </View>
      {onEditQuantity || onDelete ? (
        <View style={styles.actions}>
          {onEditQuantity ? (
            <Pressable
              testID={`native-consumable-edit-${item.id}`}
              onPress={() => onEditQuantity(item)}
              accessibilityRole="button"
              accessibilityLabel={`Изменить остаток ${title}`}
              style={styles.action}
            >
              <MaterialCommunityIcons name="pencil-outline" size={20} color={accentColor} />
            </Pressable>
          ) : null}
          {onDelete ? (
            <Pressable
              testID={`native-consumable-delete-${item.id}`}
              onPress={() => onDelete(item)}
              accessibilityRole="button"
              accessibilityLabel={`Удалить расходник ${title}`}
              style={styles.action}
            >
              <MaterialCommunityIcons name="delete-outline" size={20} color={tokens.error} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  card: { minHeight: 108, borderRadius: 15, borderWidth: 1, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 11, marginBottom: 8 },
  icon: { width: 44, height: 44, marginTop: 2, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, gap: 4 },
  title: { fontSize: 15, lineHeight: 20, fontWeight: '800' },
  quantity: { minHeight: 26, alignSelf: 'flex-start', borderRadius: 13, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center' },
  quantityText: { fontSize: 12, fontWeight: '900' },
  meta: { fontSize: 12, lineHeight: 16 },
  location: { fontSize: 12, lineHeight: 16 },
  description: { fontSize: 12, lineHeight: 16 },
  actions: { alignSelf: 'center' },
  action: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
