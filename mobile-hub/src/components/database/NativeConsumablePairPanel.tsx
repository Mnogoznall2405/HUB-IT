import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ConsumableRecord, EquipmentRecord } from '../../api/databaseApi';
import type { FluentTokens } from '../../theme/fluentTokens';

function consumableLabel(item: ConsumableRecord): string {
  return item.model_name || item.type_name || item.inv_no || `Расходник #${item.id}`;
}

function equipmentLabel(item: EquipmentRecord): string {
  const inv = item.inv_no ? ` · инв. ${item.inv_no}` : '';
  return `${item.model_name || item.type_name || 'МФУ'}${inv}`;
}

// Slot panel for the "consumable ↔ MFU" pairing mode of the QR scanner:
// the user scans both codes in any order, each filled slot is shown here.
export function NativeConsumablePairPanel({
  consumable,
  mfu,
  busy = false,
  expanded = false,
  tokens,
  onToggleExpanded,
  onCancel,
}: {
  consumable: ConsumableRecord | null;
  mfu: EquipmentRecord | null;
  busy?: boolean;
  expanded?: boolean;
  tokens: FluentTokens;
  onToggleExpanded?: () => void;
  onCancel: () => void;
}) {
  const waiting = consumable ? 'МФУ' : 'расходника';
  return (
    <View testID="native-pair-panel" style={[styles.panel, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderStrong }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Скрыть детали спаривания' : 'Показать детали спаривания'}
        onPress={onToggleExpanded}
        style={styles.header}
      >
        <MaterialCommunityIcons name="swap-horizontal" size={20} color={tokens.primary} />
        <Text style={[styles.title, { color: tokens.textPrimary }]}>Списание расходника в МФУ</Text>
        {busy ? <ActivityIndicator size="small" color={tokens.primary} /> : null}
        <Pressable
          testID="native-pair-cancel"
          accessibilityRole="button"
          accessibilityLabel="Выйти из режима спаривания"
          onPress={onCancel}
          style={styles.cancel}
        >
          <MaterialCommunityIcons name="close" size={18} color={tokens.textSecondary} />
        </Pressable>
      </Pressable>
      {expanded ? (
        <View style={styles.slots}>
          <View style={styles.slotRow}>
            <MaterialCommunityIcons
              name={consumable ? 'check-circle' : 'qrcode-scan'}
              size={18}
              color={consumable ? tokens.success : tokens.textTertiary}
            />
            <Text numberOfLines={1} style={[styles.slotText, { color: consumable ? tokens.textPrimary : tokens.textTertiary }]}>
              {consumable ? consumableLabel(consumable) : 'Сканируйте QR расходника'}
            </Text>
          </View>
          <View style={styles.slotRow}>
            <MaterialCommunityIcons
              name={mfu ? 'check-circle' : 'qrcode-scan'}
              size={18}
              color={mfu ? tokens.success : tokens.textTertiary}
            />
            <Text numberOfLines={1} style={[styles.slotText, { color: mfu ? tokens.textPrimary : tokens.textTertiary }]}>
              {mfu ? equipmentLabel(mfu) : 'Сканируйте QR МФУ'}
            </Text>
          </View>
          <Text style={[styles.hint, { color: tokens.textSecondary }]}>
            {consumable || mfu
              ? `Осталось отсканировать QR ${waiting}.`
              : 'Порядок сканирования любой — расходник и МФУ.'}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    marginHorizontal: 12,
    marginBottom: 8,
    overflow: 'hidden',
  },
  header: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
  title: { flex: 1, fontSize: 14, fontWeight: '800' },
  cancel: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  slots: { paddingHorizontal: 14, paddingBottom: 12, gap: 8 },
  slotRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  slotText: { flex: 1, fontSize: 13, fontWeight: '700' },
  hint: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
});
