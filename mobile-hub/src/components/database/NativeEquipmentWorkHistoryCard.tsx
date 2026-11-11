import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { EquipmentWorkHistory } from '../../api/databaseApi';
import { equipmentWorkKindLabel, formatDatabaseDate } from '../../database/nativeDatabaseModel';
import type { FluentTokens } from '../../theme/fluentTokens';

const ICONS = {
  cartridge: 'printer-outline',
  battery: 'battery-sync-outline',
  component: 'memory',
  cleaning: 'broom',
} as const;

export const NativeEquipmentWorkHistoryCard = memo(function NativeEquipmentWorkHistoryCard({
  history,
  tokens,
}: {
  history: EquipmentWorkHistory;
  tokens: FluentTokens;
}) {
  const label = equipmentWorkKindLabel(history.kind);
  const lastWork = history.last_date ? formatDatabaseDate(history.last_date) : 'Работы не зарегистрированы';
  return (
    <View
      testID={`native-equipment-work-${history.kind}`}
      accessible
      accessibilityLabel={`${label}. Всего записей ${history.count}. Последняя работа: ${lastWork}`}
      style={[styles.card, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}
    >
      <View style={[styles.icon, { backgroundColor: tokens.accentSoft }]}>
        <MaterialCommunityIcons name={ICONS[history.kind]} size={22} color={tokens.primary} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: tokens.textPrimary }]}>{label}</Text>
        <Text style={[styles.count, { color: tokens.textSecondary }]}>Записей: {history.count}</Text>
        <Text style={[styles.date, { color: tokens.textTertiary }]}>
          {history.last_date ? `Последняя: ${lastWork}${history.time_ago_str ? ` · ${history.time_ago_str}` : ''}` : lastWork}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { minHeight: 88, borderRadius: 15, borderWidth: 1, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 8 },
  icon: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, gap: 3 },
  title: { fontSize: 14, lineHeight: 18, fontWeight: '800' },
  count: { fontSize: 12, lineHeight: 16 },
  date: { fontSize: 11, lineHeight: 15 },
});
