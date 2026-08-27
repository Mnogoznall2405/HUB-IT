import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { EquipmentAct } from '../../api/databaseApi';
import { equipmentActTitle, formatDatabaseDate } from '../../database/nativeDatabaseModel';
import type { FluentTokens } from '../../theme/fluentTokens';

export const NativeEquipmentActCard = memo(function NativeEquipmentActCard({
  act,
  tokens,
  fileBusy = false,
  onOpenEquipment,
  onOpenFile,
}: {
  act: EquipmentAct;
  tokens: FluentTokens;
  fileBusy?: boolean;
  onOpenEquipment?: (invNo: string) => void;
  onOpenFile?: () => void;
}) {
  const firstInvNo = act.items.find((item) => item.inv_no)?.inv_no || '';
  return (
    <View style={[styles.card, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
      <View style={styles.heading}>
        <View style={[styles.icon, { backgroundColor: tokens.accentSoft }]}>
          <MaterialCommunityIcons name="file-document-outline" size={22} color={tokens.primary} />
        </View>
        <View style={styles.titleBlock}>
          <Text style={[styles.title, { color: tokens.textPrimary }]}>{equipmentActTitle(act)}</Text>
          <Text style={[styles.date, { color: tokens.textTertiary }]}>{formatDatabaseDate(act.doc_date)}</Text>
        </View>
      </View>
      <Text style={[styles.meta, { color: tokens.textSecondary }]}>{[act.type_name, act.employee_name].filter(Boolean).join(' · ') || 'Тип и сотрудник не указаны'}</Text>
      <Text style={[styles.meta, { color: tokens.textSecondary }]}>{[act.branch_name, act.location_name].filter(Boolean).join(' · ') || 'Местоположение не указано'}</Text>
      {act.items.length ? (
        <Text style={[styles.items, { color: tokens.textTertiary }]} numberOfLines={2}>
          {act.items.map((item) => item.inv_no || item.model_name).filter(Boolean).join(', ')}
        </Text>
      ) : null}
      <View style={styles.actions}>
        {firstInvNo && onOpenEquipment ? (
          <Pressable accessibilityRole="button" onPress={() => onOpenEquipment(firstInvNo)} style={[styles.action, { borderColor: tokens.border }]}>
            <Text style={[styles.actionText, { color: tokens.textPrimary }]}>Карточка</Text>
          </Pressable>
        ) : null}
        {act.has_file && onOpenFile ? (
          <Pressable
            testID={`native-equipment-act-file-${act.doc_no}`}
            accessibilityRole="button"
            accessibilityLabel={`Открыть файл ${equipmentActTitle(act)}`}
            accessibilityState={{ disabled: fileBusy, busy: fileBusy }}
            disabled={fileBusy}
            onPress={onOpenFile}
            style={[styles.action, { backgroundColor: tokens.primary, opacity: fileBusy ? 0.55 : 1 }]}
          >
            {fileBusy ? <ActivityIndicator size="small" color="#fff" /> : <MaterialCommunityIcons name="file-download-outline" size={18} color="#fff" />}
            <Text style={styles.fileText}>Открыть файл</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { borderRadius: 15, borderWidth: 1, padding: 12, gap: 6, marginBottom: 8 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  titleBlock: { flex: 1 },
  title: { fontSize: 15, fontWeight: '800' },
  date: { marginTop: 2, fontSize: 11 },
  meta: { fontSize: 12, lineHeight: 16 },
  items: { fontSize: 11, lineHeight: 15 },
  actions: { marginTop: 5, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: { minHeight: 44, borderWidth: 1, borderRadius: 11, paddingHorizontal: 13, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: 12, fontWeight: '800' },
  fileText: { color: '#fff', fontSize: 12, fontWeight: '800' },
});
