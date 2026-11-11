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
  onPress: (item: EquipmentRecord) => void;
  onLongPress?: (item: EquipmentRecord) => void;
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
    onPress(item);
  }, [item, onPress]);

  return (
    <Pressable
      testID={`native-equipment-${item.inv_no}`}
      onPress={handlePress}
      onLongPress={onLongPress ? () => {
        longPressHandledRef.current = true;
        onLongPress(item);
      } : undefined}
      delayLongPress={420}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityHint={onLongPress && !selectionMode ? 'Удерживайте, чтобы выбрать для групповой операции' : undefined}
      accessibilityLabel={`${selectionMode ? selected ? 'Выбрано, ' : 'Не выбрано, ' : ''}${title}, инвентарный номер ${item.inv_no}. ${subtitle ? `${subtitle}. ` : ''}${owner}. ${location}`}
      style={({ pressed }) => [
        styles.row,
        {
          borderBottomColor: selected ? accentColor : tokens.borderSoft,
          backgroundColor: selected ? tokens.selected : 'transparent',
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      <View style={styles.body}>
        <Text numberOfLines={2} style={[styles.title, { color: tokens.textPrimary }]}>{title}</Text>
        <Text numberOfLines={1} style={[styles.invNo, { color: accentColor }]}>
          Инв. № {item.inv_no}{subtitle ? ` · ${subtitle}` : ''}
        </Text>
        <Text numberOfLines={1} style={[styles.meta, { color: tokens.textSecondary }]}>
          {owner}{location ? ` · ${location}` : ''}
        </Text>
      </View>
      <MaterialCommunityIcons
        name={selectionMode ? selected ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline' : 'chevron-right'}
        size={22}
        color={selected ? accentColor : tokens.iconMuted}
        style={styles.chevron}
      />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    paddingHorizontal: 2,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  body: { flex: 1, minWidth: 0, gap: 3 },
  title: { fontSize: 15, lineHeight: 20, fontWeight: '800' },
  invNo: { fontSize: 12, lineHeight: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
  meta: { fontSize: 12, lineHeight: 17 },
  chevron: { marginTop: 2 },
});
