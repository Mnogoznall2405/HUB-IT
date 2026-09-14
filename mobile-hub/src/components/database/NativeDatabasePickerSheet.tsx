import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { NativeModal as Modal } from '../ui/NativeModal';
import type { FluentTokens } from '../../theme/fluentTokens';

export type NativeDatabasePickerOption = {
  id: string;
  name?: string | null;
};

/**
 * Shared bottom-sheet database picker used by inventory and statistics so the
 * same action looks and behaves identically across modules.
 */
export function NativeDatabasePickerSheet({
  visible,
  title = 'Выберите базу',
  subtitle,
  options,
  currentId,
  locked = false,
  switching = false,
  switchingId = null,
  accentColor,
  tokens,
  testIDPrefix = 'native-database',
  onSelect,
  onClose,
}: {
  visible: boolean;
  title?: string;
  subtitle?: string;
  options: NativeDatabasePickerOption[];
  currentId?: string | null;
  locked?: boolean;
  switching?: boolean;
  switchingId?: string | null;
  accentColor: string;
  tokens: FluentTokens;
  testIDPrefix?: string;
  onSelect: (option: NativeDatabasePickerOption) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Pressable
          testID={`${testIDPrefix}-picker-backdrop`}
          accessibilityRole="button"
          accessibilityLabel="Закрыть выбор базы данных"
          onPress={onClose}
          style={styles.backdrop}
        />
        <View
          testID={`${testIDPrefix}-picker-sheet`}
          accessibilityViewIsModal
          style={[styles.sheet, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}
        >
          <View style={styles.header}>
            <View style={styles.heading}>
              <Text accessibilityRole="header" style={[styles.title, { color: tokens.textPrimary }]}>{title}</Text>
              {subtitle ? (
                <Text style={[styles.subtitle, { color: tokens.textSecondary }]}>{subtitle}</Text>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Закрыть"
              onPress={onClose}
              style={({ pressed }) => [styles.close, { opacity: pressed ? 0.65 : 1 }]}
            >
              <MaterialCommunityIcons name="close" size={24} color={tokens.iconMuted} />
            </Pressable>
          </View>
          {locked ? (
            <View style={[styles.lockedNotice, { backgroundColor: tokens.panelInset }]}>
              <MaterialCommunityIcons name="lock-outline" size={17} color={tokens.iconMuted} />
              <Text style={[styles.lockedText, { color: tokens.textSecondary }]}>База закреплена администратором и недоступна для переключения.</Text>
            </View>
          ) : null}
          <ScrollView contentContainerStyle={styles.options} keyboardShouldPersistTaps="handled">
            {options.map((option) => {
              const selected = option.id === currentId;
              const busy = switchingId === option.id;
              const disabled = switching || busy || (!selected && locked);
              return (
                <Pressable
                  key={option.id}
                  testID={`${testIDPrefix}-option-${option.id}`}
                  accessibilityRole="radio"
                  accessibilityLabel={`${option.name || option.id}${selected ? ', выбрана' : ''}`}
                  accessibilityState={{ selected, disabled, busy }}
                  disabled={disabled}
                  onPress={() => {
                    if (selected) {
                      onClose();
                      return;
                    }
                    onSelect(option);
                  }}
                  style={({ pressed }) => [
                    styles.option,
                    {
                      backgroundColor: selected ? tokens.selected : tokens.panelInset,
                      borderColor: selected ? tokens.selectedBorder : tokens.borderSoft,
                      opacity: disabled ? 0.55 : pressed ? 0.84 : 1,
                      transform: [{ scale: pressed && !disabled ? 0.96 : 1 }],
                    },
                  ]}
                >
                  <View style={[styles.optionIcon, { backgroundColor: selected ? tokens.accentSoft : tokens.panelSolid }]}>
                    {busy ? (
                      <ActivityIndicator size="small" color={accentColor} />
                    ) : (
                      <MaterialCommunityIcons name="database-outline" size={21} color={selected ? accentColor : tokens.iconMuted} />
                    )}
                  </View>
                  <View style={styles.optionText}>
                    <Text numberOfLines={1} style={[styles.optionTitle, { color: tokens.textPrimary }]}>{option.name || option.id}</Text>
                    {option.name && option.name !== option.id ? (
                      <Text numberOfLines={1} style={[styles.optionId, { color: tokens.textSecondary }]}>{option.id}</Text>
                    ) : null}
                  </View>
                  <MaterialCommunityIcons name={selected ? 'check-circle' : 'chevron-right'} size={22} color={selected ? accentColor : tokens.iconMuted} />
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.48)' },
  sheet: { maxHeight: '72%', borderWidth: 1, borderBottomWidth: 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8, paddingBottom: 24, overflow: 'hidden' },
  header: { minHeight: 64, paddingLeft: 18, paddingRight: 8, flexDirection: 'row', alignItems: 'center', gap: 12 },
  heading: { flex: 1, minWidth: 0 },
  title: { fontSize: 18, lineHeight: 23, fontWeight: '900' },
  subtitle: { marginTop: 2, fontSize: 12, lineHeight: 16 },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  lockedNotice: { minHeight: 42, marginHorizontal: 14, marginBottom: 8, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  lockedText: { flex: 1, fontSize: 12, lineHeight: 16, fontWeight: '700' },
  options: { paddingHorizontal: 12, paddingTop: 4, gap: 8 },
  option: { minHeight: 64, borderRadius: 16, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 11 },
  optionIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  optionText: { flex: 1, minWidth: 0 },
  optionTitle: { fontSize: 15, lineHeight: 20, fontWeight: '800' },
  optionId: { marginTop: 2, fontSize: 11, lineHeight: 15, fontVariant: ['tabular-nums'] },
});
