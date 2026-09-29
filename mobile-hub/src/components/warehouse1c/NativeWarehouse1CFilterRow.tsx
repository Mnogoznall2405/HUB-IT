import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { FluentTokens } from '../../theme/fluentTokens';

export function NativeWarehouse1CFilterRow({
  label,
  value,
  placeholder,
  icon,
  required = false,
  tokens,
  onPress,
  onClear,
  testID,
}: {
  label: string;
  value: string;
  placeholder: string;
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  required?: boolean;
  tokens: FluentTokens;
  onPress: () => void;
  onClear?: () => void;
  testID?: string;
}) {
  const hasValue = Boolean(value);
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}${required ? ', обязательное поле' : ''}. ${hasValue ? `Выбрано: ${value}` : placeholder}`}
      style={({ pressed }) => [styles.row, { borderColor: tokens.borderSoft, backgroundColor: tokens.panelInset }, pressed && styles.pressed]}
    >
      <MaterialCommunityIcons name={icon} size={22} color={hasValue ? tokens.primary : tokens.iconMuted} />
      <View style={styles.body}>
        <Text style={[styles.label, { color: tokens.textSecondary }]}>{label}{required ? ' *' : ''}</Text>
        <Text numberOfLines={2} style={[styles.value, { color: hasValue ? tokens.textPrimary : tokens.textTertiary }]}>
          {hasValue ? value : placeholder}
        </Text>
      </View>
      {hasValue && onClear ? (
        <Pressable
          onPress={onClear}
          accessibilityRole="button"
          accessibilityLabel={`Сбросить ${label.toLowerCase()}`}
          style={styles.clearButton}
        >
          <MaterialCommunityIcons name="close" size={19} color={tokens.iconMuted} />
        </Pressable>
      ) : (
        <MaterialCommunityIcons name="chevron-right" size={20} color={tokens.iconMuted} />
      )}
    </Pressable>
  );
}

export function NativeWarehouse1CActiveChip({
  label,
  value,
  tokens,
  onClear,
  testID,
}: {
  label: string;
  value: string;
  tokens: FluentTokens;
  onClear: () => void;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      style={[styles.activeChip, { backgroundColor: tokens.selected, borderColor: tokens.selectedBorder }]}
    >
      <Text numberOfLines={1} style={[styles.activeChipText, { color: tokens.primary }]}>
        <Text style={styles.activeChipLabel}>{label}: </Text>
        {value}
      </Text>
      <Pressable
        onPress={onClear}
        accessibilityRole="button"
        accessibilityLabel={`Сбросить ${label.toLowerCase()}`}
        hitSlop={8}
        style={styles.activeChipClear}
      >
        <MaterialCommunityIcons name="close" size={15} color={tokens.primary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.82 },
  activeChip: {
    maxWidth: '100%',
    minHeight: 32,
    borderWidth: 1,
    borderRadius: 16,
    paddingLeft: 11,
    paddingRight: 6,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  activeChipText: { fontSize: 12, lineHeight: 16, fontWeight: '800', flexShrink: 1 },
  activeChipLabel: { fontWeight: '600' },
  activeChipClear: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  row: {
    minHeight: 56,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  body: { flex: 1, minWidth: 0 },
  label: { fontSize: 11, lineHeight: 15, fontWeight: '700' },
  value: { marginTop: 2, fontSize: 14, lineHeight: 19, fontWeight: '700' },
  clearButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
