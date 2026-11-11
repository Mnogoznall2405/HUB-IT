import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useContext, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaInsetsContext, initialWindowMetrics } from 'react-native-safe-area-context';
import type { FluentTokens } from '../../theme/fluentTokens';
import { NativeModal } from '../ui/NativeModal';
import { NativeSheetHeader } from '../ui/NativeFilterControls';

export type NativeEquipmentPickerOption = { id: number | string; name: string };

export function NativeEquipmentOptionPicker({
  visible,
  title,
  options,
  selectedId,
  loading = false,
  tokens,
  onSelect,
  onClose,
  testIDPrefix = 'native-equipment-picker',
}: {
  visible: boolean;
  title: string;
  options: NativeEquipmentPickerOption[];
  selectedId: number | string | null;
  loading?: boolean;
  tokens: FluentTokens;
  onSelect: (id: number | string) => void;
  onClose: () => void;
  testIDPrefix?: string;
}) {
  const insets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets;
  const [query, setQuery] = useState('');
  useEffect(() => { if (visible) setQuery(''); }, [visible]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ru-RU');
    if (!needle) return options;
    return options.filter((item) => item.name.toLocaleLowerCase('ru-RU').includes(needle));
  }, [options, query]);

  return (
    <NativeModal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel="Закрыть выбор" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View
          testID={`${testIDPrefix}-sheet`}
          accessibilityViewIsModal
          style={[styles.sheet, {
            backgroundColor: tokens.panelSolid,
            borderColor: tokens.borderSoft,
            paddingBottom: Math.max(16, (insets?.bottom || 0) + 8),
            paddingLeft: insets?.left || 0,
            paddingRight: insets?.right || 0,
          }]}
        >
          <NativeSheetHeader title={title} tokens={tokens} onClose={onClose} />
          <TextInput
            testID={`${testIDPrefix}-search`}
            value={query}
            onChangeText={setQuery}
            editable={!loading}
            accessibilityLabel={`Поиск: ${title}`}
            placeholder="Поиск"
            placeholderTextColor={tokens.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.search, { color: tokens.textPrimary, backgroundColor: tokens.panelInset, borderColor: tokens.border }]}
          />
          {loading ? <ActivityIndicator style={styles.loading} color={tokens.primary} /> : (
            <FlatList
              data={filtered}
              keyExtractor={(item) => String(item.id)}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Text style={[styles.empty, { color: tokens.textSecondary }]}>Ничего не найдено</Text>}
              renderItem={({ item }) => {
                const selected = String(item.id) === String(selectedId ?? '');
                return (
                  <Pressable
                    testID={`${testIDPrefix}-option-${item.id}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => onSelect(item.id)}
                    style={({ pressed }) => [styles.option, {
                      borderColor: selected ? tokens.primary : tokens.borderSoft,
                      backgroundColor: selected ? tokens.selected : tokens.panelSolid,
                    }, pressed && styles.pressed]}
                  >
                    <Text style={[styles.optionText, { color: tokens.textPrimary }]}>{item.name}</Text>
                    {selected ? <MaterialCommunityIcons name="check" size={20} color={tokens.primary} /> : null}
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      </View>
    </NativeModal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.48)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '78%', borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, paddingTop: 8 },
  search: { minHeight: 44, marginHorizontal: 14, marginBottom: 8, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, fontSize: 15 },
  loading: { marginVertical: 32 },
  empty: { paddingVertical: 32, alignSelf: 'center', fontSize: 14, fontWeight: '600' },
  option: { minHeight: 48, marginHorizontal: 14, marginVertical: 3, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  optionText: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.75 },
});
