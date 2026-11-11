import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useContext, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaInsetsContext, initialWindowMetrics } from 'react-native-safe-area-context';
import { searchEquipmentOwners, type EquipmentOwnerOption } from '../../api/databaseApi';
import { formatApiError } from '../../api/formatError';
import type { FluentTokens } from '../../theme/fluentTokens';
import { NativeModal } from '../ui/NativeModal';
import { NativeSheetHeader } from '../ui/NativeFilterControls';

export function NativeEquipmentOwnerPicker({
  visible,
  title,
  databaseId,
  selectedOwnerNo,
  allowManual = false,
  initialQuery,
  tokens,
  onSelect,
  onManual,
  onClose,
  testIDPrefix = 'native-owner-picker',
}: {
  visible: boolean;
  title: string;
  databaseId?: string;
  selectedOwnerNo: number | null;
  allowManual?: boolean;
  initialQuery?: string;
  tokens: FluentTokens;
  onSelect: (owner: EquipmentOwnerOption) => void;
  onManual?: (name: string) => void;
  onClose: () => void;
  testIDPrefix?: string;
}) {
  const insets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets;
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<EquipmentOwnerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      setQuery(initialQuery ?? '');
      setOptions([]);
      setError('');
    }
  }, [initialQuery, visible]);

  useEffect(() => {
    if (!visible) return;
    const q = query.trim();
    if (q.length < 2) {
      setOptions([]);
      setError('');
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      void searchEquipmentOwners(q, 20, databaseId)
        .then((items) => {
          if (!active) return;
          setOptions(items);
          setError('');
        })
        .catch((cause) => {
          if (!active) return;
          setOptions([]);
          setError(formatApiError(cause, 'Не удалось найти сотрудников.'));
        })
        .finally(() => { if (active) setLoading(false); });
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [databaseId, query, visible]);

  const trimmed = query.trim();
  const manualAllowed = allowManual && trimmed.length >= 2;

  return (
    <NativeModal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
            autoFocus
            accessibilityLabel={`Поиск: ${title}`}
            placeholder="Начните вводить ФИО"
            placeholderTextColor={tokens.textTertiary}
            autoCapitalize="words"
            autoCorrect={false}
            style={[styles.search, { color: tokens.textPrimary, backgroundColor: tokens.panelInset, borderColor: tokens.border }]}
          />
          {manualAllowed ? (
            <Pressable
              testID={`${testIDPrefix}-manual`}
              accessibilityRole="button"
              onPress={() => onManual?.(trimmed)}
              style={({ pressed }) => [styles.option, { borderColor: tokens.borderSoft, backgroundColor: tokens.panelSolid }, pressed && styles.pressed]}
            >
              <Text style={[styles.optionText, { color: tokens.primary }]}>Указать вручную: «{trimmed}»</Text>
            </Pressable>
          ) : null}
          {loading ? <ActivityIndicator style={styles.loading} color={tokens.primary} /> : (
            <FlatList
              style={styles.list}
              data={options}
              keyExtractor={(item) => String(item.owner_no)}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={(
                <Text style={[styles.empty, { color: error ? tokens.error : tokens.textSecondary }]}>
                  {error || (trimmed.length < 2 ? 'Введите минимум 2 символа' : 'Сотрудники не найдены')}
                </Text>
              )}
              renderItem={({ item }) => {
                const selected = item.owner_no === selectedOwnerNo;
                return (
                  <Pressable
                    testID={`${testIDPrefix}-option-${item.owner_no}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => onSelect(item)}
                    style={({ pressed }) => [styles.option, {
                      borderColor: selected ? tokens.primary : tokens.borderSoft,
                      backgroundColor: selected ? tokens.selected : tokens.panelSolid,
                    }, pressed && styles.pressed]}
                  >
                    <View style={styles.optionBody}>
                      <Text style={[styles.optionText, { color: tokens.textPrimary }]}>{item.name}</Text>
                      {item.department ? <Text style={[styles.optionMeta, { color: tokens.textSecondary }]}>{item.department}</Text> : null}
                    </View>
                    {selected ? <MaterialCommunityIcons name="check" size={20} color={tokens.primary} /> : null}
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </NativeModal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.48)', justifyContent: 'flex-end' },
  sheet: { height: '78%', borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, paddingTop: 8 },
  list: { flex: 1 },
  search: { minHeight: 44, marginHorizontal: 14, marginBottom: 8, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, fontSize: 15 },
  loading: { marginVertical: 32 },
  empty: { paddingVertical: 32, alignSelf: 'center', fontSize: 14, fontWeight: '600' },
  option: { minHeight: 48, marginHorizontal: 14, marginVertical: 3, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  optionBody: { flex: 1, minWidth: 0 },
  optionText: { fontSize: 15, fontWeight: '600' },
  optionMeta: { marginTop: 2, fontSize: 12 },
  pressed: { opacity: 0.75 },
});
