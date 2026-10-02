import { NativeModal as Modal } from '../ui/NativeModal';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState, type ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { EquipmentWorkKind } from '../../api/databaseApi';
import { equipmentWorkKindLabel } from '../../database/nativeDatabaseModel';
import type { FluentTokens } from '../../theme/fluentTokens';
import type { NativeEquipmentActionKind } from './NativeEquipmentActions';

const WORK_ICONS: Record<EquipmentWorkKind, ComponentProps<typeof MaterialCommunityIcons>['name']> = {
  cleaning: 'broom',
  battery: 'battery-sync-outline',
  cartridge: 'printer-pos-wrench-outline',
  component: 'tools',
};

export function NativeActionSheetItem({
  testID,
  icon,
  label,
  onPress,
  disabled = false,
  danger = false,
  tokens,
}: {
  testID: string;
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  tokens: FluentTokens;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.sheetItem, { opacity: disabled ? 0.5 : pressed ? 0.72 : 1 }]}
    >
      <MaterialCommunityIcons name={icon} size={21} color={danger ? tokens.error : tokens.primary} />
      <Text style={[styles.sheetItemLabel, { color: danger ? tokens.error : tokens.textPrimary }]}>{label}</Text>
    </Pressable>
  );
}

export function NativeActionSheetDivider({ tokens }: { tokens: FluentTokens }) {
  return <View style={[styles.sheetDivider, { backgroundColor: tokens.borderSoft }]} />;
}

export function NativeEquipmentActionBar({
  tokens,
  offline,
  workKinds,
  onEdit,
  onOpenAction,
}: {
  tokens: FluentTokens;
  offline: boolean;
  workKinds: EquipmentWorkKind[];
  onEdit: () => void;
  onOpenAction: (kind: NativeEquipmentActionKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const pick = (kind: NativeEquipmentActionKind) => {
    setOpen(false);
    onOpenAction(kind);
  };
  return (
    <View>
      {offline ? <Text style={[styles.offlineNote, { color: tokens.textSecondary }]}>Недоступно без сети</Text> : null}
      <View style={styles.bar}>
        <Pressable
          testID="native-equipment-edit"
          accessibilityRole="button"
          accessibilityLabel="Редактировать карточку оборудования"
          accessibilityState={{ disabled: offline }}
          disabled={offline}
          onPress={onEdit}
          style={[styles.editButton, { backgroundColor: tokens.primary, opacity: offline ? 0.5 : 1 }]}
        >
          <MaterialCommunityIcons name="pencil-outline" size={19} color="#fff" />
          <Text style={styles.editButtonText}>Редактировать</Text>
        </Pressable>
        <Pressable
          testID="native-equipment-actions-open"
          accessibilityRole="button"
          accessibilityLabel="Действия с оборудованием"
          accessibilityState={{ disabled: offline }}
          disabled={offline}
          onPress={() => setOpen(true)}
          style={[styles.actionsButton, { borderColor: tokens.border, opacity: offline ? 0.5 : 1 }]}
        >
          <Text style={[styles.actionsButtonText, { color: tokens.textPrimary }]}>Действия</Text>
          <MaterialCommunityIcons name="chevron-up" size={18} color={tokens.iconMuted} />
        </Pressable>
      </View>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable accessibilityRole="button" accessibilityLabel="Закрыть список действий" style={styles.scrim} onPress={() => setOpen(false)} />
          <View style={[styles.sheet, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderStrong }]}>
            <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
              <NativeActionSheetItem testID="native-equipment-transfer-owner" icon="account-arrow-right-outline" label="Передать сотруднику" onPress={() => pick('owner')} tokens={tokens} />
              <NativeActionSheetItem testID="native-equipment-transfer-location" icon="map-marker-right-outline" label="Сменить размещение" onPress={() => pick('location')} tokens={tokens} />
              <NativeActionSheetItem testID="native-equipment-transfer-act-only" icon="file-document-edit-outline" label="Сформировать акт" onPress={() => pick('act-only')} tokens={tokens} />
              {workKinds.length ? <NativeActionSheetDivider tokens={tokens} /> : null}
              {workKinds.map((kind) => (
                <NativeActionSheetItem
                  key={kind}
                  testID={`native-equipment-record-work-${kind}`}
                  icon={WORK_ICONS[kind]}
                  label={equipmentWorkKindLabel(kind)}
                  onPress={() => pick(kind)}
                  tokens={tokens}
                />
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  offlineNote: { marginBottom: 7, fontSize: 12, lineHeight: 16, fontWeight: '700', textAlign: 'center' },
  bar: { flexDirection: 'row', gap: 9 },
  editButton: { flex: 1, minHeight: 50, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  editButtonText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  actionsButton: { minHeight: 50, borderWidth: 1, borderRadius: 13, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  actionsButtonText: { fontSize: 14, fontWeight: '900' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.48)' },
  sheet: { maxHeight: '72%', borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, paddingTop: 8 },
  sheetContent: { paddingHorizontal: 14, paddingBottom: 26 },
  sheetItem: { minHeight: 52, borderRadius: 12, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  sheetItemLabel: { flex: 1, fontSize: 14, lineHeight: 19, fontWeight: '800' },
  sheetDivider: { height: StyleSheet.hairlineWidth, marginVertical: 6, marginHorizontal: 10 },
});
