import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { memo, useCallback, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { EquipmentRecord } from '../../api/databaseApi';
import {
  equipmentLocation,
  equipmentOwner,
  equipmentSubtitle,
  equipmentTitle,
} from '../../database/nativeDatabaseModel';
import type { FluentTokens } from '../../theme/fluentTokens';

export const NativeEquipmentRow = memo(function NativeEquipmentRow({
  item,
  tokens,
  onPress,
  onLongPress,
  selectionMode = false,
  selected = false,
}: {
  item: EquipmentRecord;
  tokens: FluentTokens;
  onPress: () => void;
  onLongPress?: () => void;
  selectionMode?: boolean;
  selected?: boolean;
}) {
  const longPressHandledRef = useRef(false);
  const accentColor = tokens.scheme === 'dark' ? tokens.primaryLight : tokens.primary;
  const title = equipmentTitle(item);
  const subtitle = equipmentSubtitle(item);
  const owner = equipmentOwner(item);
  const location = equipmentLocation(item);
  const handlePress = useCallback(() => {
    if (longPressHandledRef.current) {
      longPressHandledRef.current = false;
      return;
    }
    onPress();
  }, [onPress]);

  return (
    <Pressable
      testID={`native-equipment-${item.inv_no}`}
      onPress={handlePress}
      onLongPress={onLongPress ? () => {
        longPressHandledRef.current = true;
        onLongPress();
      } : undefined}
      delayLongPress={420}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityHint={onLongPress && !selectionMode ? 'Удерживайте, чтобы выбрать для групповой операции' : undefined}
      accessibilityLabel={`${selectionMode ? selected ? 'Выбрано, ' : 'Не выбрано, ' : ''}${title}, инвентарный номер ${item.inv_no}. ${subtitle ? `${subtitle}. ` : ''}${owner}. ${location}`}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: selected ? tokens.selected : tokens.panelSolid,
          borderColor: selected ? accentColor : tokens.borderSoft,
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: tokens.accentSoft }]}>
        <MaterialCommunityIcons name="desktop-tower-monitor" size={23} color={accentColor} />
      </View>
      <View style={styles.body}>
        <View style={[styles.invBadge, { backgroundColor: tokens.selected }]}>
          <Text numberOfLines={1} style={[styles.invNo, { color: accentColor }]}>Инв. № {item.inv_no}</Text>
        </View>
        <Text numberOfLines={2} style={[styles.title, { color: tokens.textPrimary }]}>{title}</Text>
        {subtitle ? (
          <View style={styles.metaRow}>
            <MaterialCommunityIcons name="barcode-scan" size={15} color={tokens.iconMuted} style={styles.metaIcon} />
            <Text numberOfLines={2} style={[styles.meta, { color: tokens.textSecondary }]}>{subtitle}</Text>
          </View>
        ) : null}
        <View style={styles.metaRow}>
          <MaterialCommunityIcons name="account-outline" size={15} color={tokens.iconMuted} style={styles.metaIcon} />
          <Text numberOfLines={2} style={[styles.meta, { color: tokens.textSecondary }]}>{owner}</Text>
        </View>
        <View style={styles.metaRow}>
          <MaterialCommunityIcons name="map-marker-outline" size={15} color={tokens.iconMuted} style={styles.metaIcon} />
          <Text numberOfLines={2} style={[styles.location, { color: tokens.textTertiary }]}>{location}</Text>
        </View>
      </View>
      <MaterialCommunityIcons style={styles.trailingIcon} name={selectionMode ? selected ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline' : 'chevron-right'} size={22} color={selected ? accentColor : tokens.iconMuted} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: { minHeight: 124, borderRadius: 15, borderWidth: 1, padding: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 11, marginBottom: 8 },
  icon: { width: 44, height: 44, marginTop: 2, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, gap: 5 },
  invBadge: { minHeight: 24, maxWidth: '100%', alignSelf: 'flex-start', borderRadius: 12, paddingHorizontal: 8, justifyContent: 'center' },
  invNo: { flexShrink: 1, fontSize: 12, lineHeight: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
  title: { fontSize: 16, lineHeight: 21, fontWeight: '800' },
  metaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  metaIcon: { width: 16, marginTop: 1 },
  meta: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 17 },
  location: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 17 },
  trailingIcon: { alignSelf: 'center' },
});
