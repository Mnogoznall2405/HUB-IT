import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useContext } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext, initialWindowMetrics } from 'react-native-safe-area-context';
import { chatKeyboardAvoidingProps } from '../../chat/chatKeyboard';
import type { FluentTokens } from '../../theme/fluentTokens';
import { NativeModal as Modal } from './NativeModal';
import { NativeFilterChip, NativeSheetHeader } from './NativeFilterControls';

export type NativeFilterOption = { value: string; label: string };

export type NativeFilterSection =
  | {
    kind: 'options';
    key: string;
    title: string;
    options: NativeFilterOption[];
    selected: string;
    onSelect: (value: string) => void;
    testIDPrefix?: string;
  }
  | {
    kind: 'toggles';
    key: string;
    title: string;
    items: { key: string; label: string; value: boolean; onToggle: () => void; testID?: string }[];
  }
  | {
    kind: 'custom';
    key: string;
    title: string;
    children: React.ReactNode;
  };

/**
 * Generic filters bottom sheet: option groups render as wrap chips,
 * boolean groups as checkbox rows. Selection applies immediately.
 */
export function NativeFilterSheet({ visible, title, subtitle, sections, tokens, onClose, onReset, testID = 'native-filter-sheet' }: {
  visible: boolean;
  title: string;
  subtitle?: string;
  sections: NativeFilterSection[];
  tokens: FluentTokens;
  onClose: () => void;
  onReset?: () => void;
  testID?: string;
}) {
  const insets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.root} {...chatKeyboardAvoidingProps()}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть фильтры"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          testID={testID}
          accessibilityViewIsModal
          style={[styles.sheet, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft,
            paddingBottom: Math.max(20, (insets?.bottom || 0) + 12), paddingLeft: insets?.left || 0, paddingRight: insets?.right || 0 }]}
        >
          <NativeSheetHeader title={title} subtitle={subtitle} tokens={tokens} onClose={onClose} />
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {sections.map((section) => (
              <View key={section.key} style={styles.section}>
                <Text style={[styles.sectionTitle, { color: tokens.textSecondary }]}>{section.title}</Text>
                {section.kind === 'custom' ? section.children : section.kind === 'options' ? (
                  <View style={styles.wrapRow}>
                    {section.options.map((option) => (
                      <NativeFilterChip
                        key={option.value || 'any'}
                        testID={section.testIDPrefix ? `${section.testIDPrefix}-${option.value || 'any'}` : undefined}
                        label={option.label}
                        selected={section.selected === option.value}
                        tokens={tokens}
                        onPress={() => section.onSelect(option.value)}
                      />
                    ))}
                  </View>
                ) : (
                  <View style={styles.toggleList}>
                    {section.items.map((item) => (
                      <Pressable
                        key={item.key}
                        testID={item.testID}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: item.value }}
                        accessibilityLabel={item.label}
                        onPress={item.onToggle}
                        style={({ pressed }) => [styles.toggleRow, { borderColor: tokens.borderSoft }, pressed && styles.pressed]}
                      >
                        <MaterialCommunityIcons
                          name={item.value ? 'checkbox-marked' : 'checkbox-blank-outline'}
                          size={23}
                          color={item.value ? tokens.primary : tokens.iconMuted}
                        />
                        <Text style={[styles.toggleLabel, { color: tokens.textPrimary }]}>{item.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            ))}
          </ScrollView>
          {onReset ? (
            <Pressable
              testID={`${testID}-reset`}
              accessibilityRole="button"
              accessibilityLabel="Сбросить фильтры"
              onPress={onReset}
              style={({ pressed }) => [styles.reset, { borderColor: tokens.borderSoft }, pressed && styles.pressed]}
            >
              <MaterialCommunityIcons name="filter-remove-outline" size={18} color={tokens.textSecondary} />
              <Text style={[styles.resetText, { color: tokens.textSecondary }]}>Сбросить фильтры</Text>
            </Pressable>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.48)' },
  pressed: { opacity: 0.82 },
  sheet: {
    maxHeight: '82%',
    borderWidth: 1,
    borderBottomWidth: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 20,
    overflow: 'hidden',
  },
  content: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10, gap: 14 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  toggleList: { gap: 8 },
  toggleRow: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  toggleLabel: { flex: 1, fontSize: 14, fontWeight: '600' },
  reset: {
    minHeight: 46,
    marginHorizontal: 16,
    marginTop: 4,
    borderWidth: 1,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  resetText: { fontSize: 13, fontWeight: '800' },
});
