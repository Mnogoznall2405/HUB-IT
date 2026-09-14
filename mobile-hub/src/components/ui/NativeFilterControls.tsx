import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { FluentTokens } from '../../theme/fluentTokens';

export function NativeFilterChip({ label, selected, count, tokens, onPress, testID }: {
  label: string;
  selected: boolean;
  count?: number;
  tokens: FluentTokens;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.filterChip,
        {
          backgroundColor: selected ? tokens.selected : tokens.panelSolid,
          borderColor: selected ? tokens.selectedBorder : tokens.borderSoft,
        },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.filterChipText, { color: selected ? tokens.primary : tokens.textSecondary }]}>{label}</Text>
      {count ? <Text style={[styles.filterChipCount, { color: selected ? tokens.primary : tokens.textTertiary }]}>{count > 99 ? '99+' : count}</Text> : null}
    </Pressable>
  );
}

export function NativeAppliedChip({ label, tokens, onRemove }: {
  label: string;
  tokens: FluentTokens;
  onRemove: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Убрать фильтр: ${label}`}
      onPress={onRemove}
      style={({ pressed }) => [
        styles.appliedChip,
        { backgroundColor: tokens.selected, borderColor: tokens.selectedBorder },
        pressed && styles.pressed,
      ]}
    >
      <Text numberOfLines={1} style={[styles.appliedChipText, { color: tokens.primary }]}>{label}</Text>
      <MaterialCommunityIcons name="close" size={16} color={tokens.primary} />
    </Pressable>
  );
}

export function NativeSheetHeader({ title, subtitle, tokens, onClose, closeDisabled = false }: {
  title: string;
  subtitle?: string;
  tokens: FluentTokens;
  onClose: () => void;
  closeDisabled?: boolean;
}) {
  return (
    <View style={styles.sheetHeader}>
      <View style={styles.sheetHeaderText}>
        <Text accessibilityRole="header" style={[styles.sheetTitle, { color: tokens.textPrimary }]}>{title}</Text>
        {subtitle ? <Text style={[styles.sheetSubtitle, { color: tokens.textSecondary }]}>{subtitle}</Text> : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Закрыть"
        disabled={closeDisabled}
        accessibilityState={{ disabled: closeDisabled }}
        onPress={onClose}
        style={({ pressed }) => [styles.sheetClose, closeDisabled && { opacity: 0.45 }, pressed && styles.pressed]}
      >
        <MaterialCommunityIcons name="close" size={22} color={tokens.iconMuted} />
      </Pressable>
    </View>
  );
}

export function NativeSegmentedControl({ options, selected, onSelect, tokens, testIDPrefix }: {
  options: { value: string; label: string }[];
  selected: string;
  onSelect: (value: string) => void;
  tokens: FluentTokens;
  testIDPrefix?: string;
}) {
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const width = measuredWidth || Math.max(1, windowWidth - 24);
  const fittingColumns = Math.max(1, Math.floor((width - 5) / (112 * Math.max(1, fontScale) + 3)));
  const columns = Math.max(1, Math.min(options.length,
    options.length > 3 && fittingColumns < options.length ? Math.min(2, fittingColumns) : fittingColumns));
  const basis = Math.max(0, (width - 8 - (columns - 1) * 3) / columns);
  return (
    <View
      testID={testIDPrefix ? `${testIDPrefix}-group` : undefined}
      onLayout={(event) => setMeasuredWidth(event.nativeEvent.layout.width)}
      style={[styles.segmented, { borderColor: tokens.borderSoft, backgroundColor: tokens.panelInset }]}
      accessibilityRole="tablist"
    >
      {options.map((option) => {
        const active = option.value === selected;
        return (
          <Pressable
            key={option.value}
            testID={testIDPrefix ? `${testIDPrefix}-${option.value}` : undefined}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label}
            onPress={() => onSelect(option.value)}
            style={({ pressed }) => [
              styles.segment,
              { flexBasis: basis },
              active && { backgroundColor: tokens.primary },
              pressed && !active && { opacity: 0.75 },
            ]}
          >
            <Text
              style={[styles.segmentText, { color: active ? '#fff' : tokens.textSecondary }]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function NativeFilterButton({ count, tokens, onPress, testID = 'native-filter-button', label = 'Фильтры' }: {
  count: number;
  tokens: FluentTokens;
  onPress: () => void;
  testID?: string;
  label?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}${count ? `. Активно: ${count}` : ''}`}
      accessibilityState={{ selected: count > 0 }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterButton,
        {
          backgroundColor: count > 0 ? tokens.selected : tokens.panelSolid,
          borderColor: count > 0 ? tokens.selectedBorder : tokens.borderSoft,
        },
        pressed && styles.pressed,
      ]}
    >
      <MaterialCommunityIcons name="tune-variant" size={19} color={count > 0 ? tokens.primary : tokens.iconMuted} />
      <Text style={[styles.filterButtonText, { color: count > 0 ? tokens.primary : tokens.textSecondary }]}>{label}</Text>
      {count > 0 ? (
        <View style={[styles.filterBadge, { backgroundColor: tokens.primary }]}>
          <Text style={styles.filterBadgeText}>{count > 9 ? '9+' : count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.82 },
  filterChip: {
    minHeight: 44,
    maxWidth: '100%',
    flexShrink: 1,
    borderWidth: 1,
    borderRadius: 19,
    paddingHorizontal: 13,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  filterChipText: { flexShrink: 1, fontSize: 13, fontWeight: '700' },
  filterChipCount: { fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
  appliedChip: {
    maxWidth: 240,
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 18,
    paddingLeft: 11,
    paddingRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  appliedChipText: { flexShrink: 1, fontSize: 12, fontWeight: '800' },
  sheetHeader: {
    minHeight: 60,
    paddingLeft: 18,
    paddingRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sheetHeaderText: { flex: 1, minWidth: 0 },
  sheetTitle: { fontSize: 17, lineHeight: 22, fontWeight: '900' },
  sheetSubtitle: { marginTop: 2, fontSize: 12, lineHeight: 16 },
  sheetClose: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  segmented: {
    width: '100%',
    flexShrink: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderWidth: 1,
    borderRadius: 14,
    padding: 3,
    gap: 3,
  },
  segment: {
    flexGrow: 1,
    flexShrink: 0,
    minWidth: 0,
    minHeight: 44,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  segmentText: { maxWidth: '100%', textAlign: 'center', fontSize: 13, fontWeight: '800' },
  filterButton: {
    maxWidth: '100%',
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 13,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  filterButtonText: { flexShrink: 1, fontSize: 13, fontWeight: '800' },
  filterBadge: {
    minWidth: 19,
    minHeight: 19,
    paddingVertical: 2,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: { color: '#fff', fontSize: 11, fontWeight: '900', fontVariant: ['tabular-nums'] },
});
