import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useContext, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaInsetsContext, initialWindowMetrics } from 'react-native-safe-area-context';
import type { FluentTokens } from '../../theme/fluentTokens';
import { NativeModal } from './NativeModal';
import { NativeSheetHeader } from './NativeFilterControls';

export type NativeTabPickerOption<T extends string = string> = {
  value: T;
  label: string;
  icon?: string;
};

/**
 * Compact section picker: one collapsed row opening a bottom-sheet list.
 * Use instead of NativeSegmentedControl when there are 4+ options or labels are long.
 */
export function NativeTabPicker<T extends string>({
  options,
  selected,
  onSelect,
  tokens,
  testIDPrefix,
  title = 'Раздел',
  fallbackIcon,
  style,
}: {
  options: NativeTabPickerOption<T>[];
  selected: T;
  onSelect: (value: T) => void;
  tokens: FluentTokens;
  testIDPrefix: string;
  title?: string;
  fallbackIcon?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const [open, setOpen] = useState(false);
  const insets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets;
  const current = options.find((option) => option.value === selected) || options[0];
  const currentIcon = current?.icon || fallbackIcon;

  return (
    <>
      <Pressable
        testID={`${testIDPrefix}-current`}
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${current?.label || ''}. Нажмите, чтобы выбрать другой`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.current,
          style,
          { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft },
          pressed && styles.pressed,
        ]}
      >
        {currentIcon ? (
          <MaterialCommunityIcons name={currentIcon as never} size={19} color={tokens.primary} />
        ) : null}
        <Text numberOfLines={1} style={[styles.currentLabel, { color: tokens.textPrimary }]}>{current?.label || ''}</Text>
        <MaterialCommunityIcons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={tokens.iconMuted} />
      </Pressable>
      <NativeModal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Закрыть: ${title}`}
            onPress={() => setOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View
            testID={`${testIDPrefix}-menu`}
            accessibilityViewIsModal
            style={[styles.menu, {
              backgroundColor: tokens.panelSolid,
              borderColor: tokens.borderSoft,
              paddingBottom: Math.max(14, (insets?.bottom || 0) + 6),
              paddingLeft: insets?.left || 0,
              paddingRight: insets?.right || 0,
            }]}
          >
            <NativeSheetHeader title={title} tokens={tokens} onClose={() => setOpen(false)} />
            <View style={styles.menuBody}>
              {options.map((option) => {
                const active = option.value === selected;
                return (
                  <Pressable
                    key={option.value}
                    testID={`${testIDPrefix}-${option.value}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`${title} ${option.label}`}
                    onPress={() => { onSelect(option.value); setOpen(false); }}
                    style={({ pressed }) => [
                      styles.menuItem,
                      { borderColor: active ? tokens.selectedBorder : tokens.borderSoft },
                      active && { backgroundColor: tokens.selected },
                      pressed && styles.pressed,
                    ]}
                  >
                    {option.icon ? (
                      <MaterialCommunityIcons
                        name={option.icon as never}
                        size={21}
                        color={active ? tokens.primary : tokens.iconMuted}
                      />
                    ) : null}
                    <Text style={[styles.menuLabel, { color: active ? tokens.primary : tokens.textPrimary }]}>
                      {option.label}
                    </Text>
                    {active ? <MaterialCommunityIcons name="check" size={20} color={tokens.primary} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </NativeModal>
    </>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.82 },
  current: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  currentLabel: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 19, fontWeight: '800' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.48)' },
  menu: {
    borderWidth: 1,
    borderBottomWidth: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  menuBody: { paddingHorizontal: 14, paddingBottom: 8, gap: 7 },
  menuItem: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  menuLabel: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 19, fontWeight: '800' },
});
