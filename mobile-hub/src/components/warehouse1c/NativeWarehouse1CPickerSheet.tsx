import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useContext, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaInsetsContext, initialWindowMetrics } from 'react-native-safe-area-context';
import {
  searchWarehouse1CCatalog,
  type Warehouse1CCatalogItem,
  type Warehouse1CCatalogKind,
} from '../../api/warehouse1cApi';
import { formatApiError } from '../../api/formatError';
import { chatKeyboardAvoidingProps } from '../../chat/chatKeyboard';
import type { FluentTokens } from '../../theme/fluentTokens';
import { NativeModal } from '../ui/NativeModal';
import { NativeSheetHeader } from '../ui/NativeFilterControls';

const PICKER_LIMIT = 30;

export function NativeWarehouse1CPickerSheet({
  visible,
  kind,
  tokens,
  onClose,
  onSelect,
}: {
  visible: boolean;
  kind: Warehouse1CCatalogKind;
  tokens: FluentTokens;
  onClose: () => void;
  onSelect: (item: Warehouse1CCatalogItem) => void;
}) {
  const insets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets;
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Warehouse1CCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const title = kind === 'warehouses' ? 'Выбор склада 1С' : 'Выбор номенклатуры 1С';

  useEffect(() => {
    if (!visible) {
      abortRef.current?.abort();
      generationRef.current += 1;
      setDraft('');
      setQuery('');
      setItems([]);
      setError('');
      setLoading(false);
    }
  }, [visible]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(draft.replace(/\s+/g, ' ').trim().slice(0, 200)), 300);
    return () => clearTimeout(timer);
  }, [draft]);

  useEffect(() => {
    generationRef.current += 1;
    const requestId = generationRef.current;
    abortRef.current?.abort();
    if (!visible || query.length < 2) {
      setItems([]);
      setError('');
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError('');
    void searchWarehouse1CCatalog({ kind, query, limit: PICKER_LIMIT, signal: controller.signal }).then((result) => {
      if (requestId === generationRef.current && !controller.signal.aborted) setItems(result);
    }).catch((cause) => {
      if (requestId === generationRef.current && !controller.signal.aborted) {
        setItems([]);
        setError(formatApiError(cause, 'Не удалось выполнить поиск в каталоге 1С.'));
      }
    }).finally(() => {
      if (requestId === generationRef.current && !controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [kind, query, visible]);

  return (
    <NativeModal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} {...chatKeyboardAvoidingProps()}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть выбор"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          testID="native-warehouse-1c-picker"
          accessibilityViewIsModal
          style={[styles.sheet, {
            backgroundColor: tokens.panelSolid,
            borderColor: tokens.borderSoft,
            paddingBottom: Math.max(16, (insets?.bottom || 0) + 8),
            paddingLeft: insets?.left || 0,
            paddingRight: insets?.right || 0,
          }]}
        >
          <NativeSheetHeader title={title} subtitle="Поиск по снимку каталога 1С" tokens={tokens} onClose={onClose} />
          <View style={styles.body}>
            <View style={[styles.search, { backgroundColor: tokens.panelInset, borderColor: tokens.borderSoft }]}>
              <MaterialCommunityIcons name="magnify" size={21} color={tokens.iconMuted} />
              <TextInput
                testID="native-warehouse-1c-picker-search"
                value={draft}
                onChangeText={setDraft}
                autoFocus
                placeholder={kind === 'warehouses' ? 'Название склада' : 'Код или название'}
                placeholderTextColor={tokens.textTertiary}
                accessibilityLabel={kind === 'warehouses' ? 'Поиск склада 1С' : 'Поиск номенклатуры 1С'}
                returnKeyType="search"
                style={[styles.searchInput, { color: tokens.textPrimary }]}
              />
              {draft ? (
                <Pressable
                  onPress={() => setDraft('')}
                  accessibilityRole="button"
                  accessibilityLabel="Очистить поиск"
                  style={styles.iconButton}
                >
                  <MaterialCommunityIcons name="close" size={20} color={tokens.iconMuted} />
                </Pressable>
              ) : null}
            </View>
            {query.length < 2 ? <Text style={[styles.hint, { color: tokens.textSecondary }]}>Введите минимум 2 символа.</Text> : null}
            {error ? <Text accessibilityRole="alert" style={[styles.hint, { color: tokens.error }]}>{error}</Text> : null}
            {!loading && !error && query.length >= 2 && items.length === 0 ? (
              <Text style={[styles.hint, { color: tokens.textSecondary }]}>По запросу ничего не найдено.</Text>
            ) : null}
            <FlatList
              style={styles.list}
              data={items}
              keyExtractor={(item) => item.ref}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.listContent}
              ListFooterComponent={loading ? <ActivityIndicator color={tokens.primary} style={styles.spinner} /> : null}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Выбрать ${item.name}`}
                  onPress={() => onSelect(item)}
                  style={({ pressed }) => [
                    styles.row,
                    { backgroundColor: tokens.panelInset, borderColor: tokens.borderSoft },
                    pressed && styles.pressed,
                  ]}
                >
                  <MaterialCommunityIcons
                    name={kind === 'warehouses' ? 'warehouse' : 'package-variant-closed'}
                    size={22}
                    color={tokens.primary}
                  />
                  <View style={styles.rowContent}>
                    <Text numberOfLines={2} style={[styles.rowTitle, { color: tokens.textPrimary }]}>{item.name}</Text>
                    {item.code ? <Text numberOfLines={1} style={[styles.rowCode, { color: tokens.textSecondary }]}>Код {item.code}</Text> : null}
                  </View>
                </Pressable>
              )}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </NativeModal>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.82 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.48)' },
  sheet: {
    maxHeight: '88%',
    borderWidth: 1,
    borderBottomWidth: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  body: { paddingHorizontal: 14, gap: 8, minHeight: 220, flexShrink: 1 },
  search: { minHeight: 48, borderWidth: 1, borderRadius: 13, paddingLeft: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, minHeight: 46, fontSize: 15 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 12, lineHeight: 17 },
  spinner: { marginVertical: 12 },
  list: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
  listContent: { gap: 8, paddingBottom: 8 },
  row: {
    minHeight: 58,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowContent: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 14, lineHeight: 19, fontWeight: '700' },
  rowCode: { marginTop: 2, fontSize: 11, lineHeight: 15, fontWeight: '700' },
});
