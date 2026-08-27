import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  searchCompanyStructureDepartmentNames,
  type CompanyStructureDepartmentName,
  type CompanyStructureNode,
} from '../../api/companyStructureApi';
import { formatApiError } from '../../api/formatError';
import { companyNodeTitle } from '../../companyStructure/nativeCompanyStructureModel';
import type { FluentTokens } from '../../theme/fluentTokens';

const SEARCH_LIMIT = 500;
const MAX_SELECTION = 500;

export function NativeCompanyZupImportSheet({
  visible,
  parent,
  importing,
  mutationError,
  tokens,
  onClose,
  onRequestConfirmation,
}: {
  visible: boolean;
  parent: CompanyStructureNode | null;
  importing: boolean;
  mutationError: string;
  tokens: FluentTokens;
  onClose: () => void;
  onRequestConfirmation: (departments: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<CompanyStructureDepartmentName[]>([]);
  const [selected, setSelected] = useState<Map<string, CompanyStructureDepartmentName>>(() => new Map());
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const requestRef = useRef(0);

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setItems([]);
    setSelected(new Map());
    setLoading(false);
    setSearchError('');
  }, [visible]);

  useEffect(() => {
    const normalized = query.trim();
    if (!visible || normalized.length < 2) {
      requestRef.current += 1;
      setItems([]);
      setLoading(false);
      setSearchError('');
      return undefined;
    }
    const requestId = ++requestRef.current;
    setLoading(true);
    setSearchError('');
    const timer = setTimeout(() => {
      void searchCompanyStructureDepartmentNames(normalized, SEARCH_LIMIT).then((payload) => {
        if (requestId === requestRef.current) setItems(payload.items);
      }).catch((cause) => {
        if (requestId === requestRef.current) {
          setItems([]);
          setSearchError(formatApiError(cause, 'Не удалось получить подразделения из ЗУП.'));
        }
      }).finally(() => {
        if (requestId === requestRef.current) setLoading(false);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [query, visible]);

  const selectedItems = useMemo(() => [...selected.values()], [selected]);
  const toggle = (item: CompanyStructureDepartmentName) => {
    if (item.binding_group === 'mixed') return;
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(item.department)) next.delete(item.department);
      else if (next.size < MAX_SELECTION) next.set(item.department, item);
      return next;
    });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => { if (!importing) onClose(); }}>
      <SafeAreaView accessibilityViewIsModal style={[styles.safe, { backgroundColor: tokens.pageBg }]}>
        <View style={[styles.header, { backgroundColor: tokens.headerBandBg, borderBottomColor: tokens.borderSoft }]}>
          <View style={styles.headerBody}>
            <Text style={[styles.title, { color: tokens.textPrimary }]}>Добавить из ЗУП</Text>
            <Text numberOfLines={1} style={[styles.subtitle, { color: tokens.textSecondary }]}>Родитель: {companyNodeTitle(parent)}</Text>
          </View>
          <Pressable disabled={importing} onPress={onClose} accessibilityRole="button" accessibilityLabel="Закрыть импорт из ЗУП" style={styles.close}>
            <MaterialCommunityIcons name="close" size={24} color={tokens.textPrimary} />
          </Pressable>
        </View>

        <View style={styles.body}>
          {mutationError ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{mutationError}</Text> : null}
          <Text style={[styles.info, { color: tokens.textSecondary }]}>Выберите точные карточки подразделений. Смешанные площадки требуют ручной привязки и здесь недоступны.</Text>
          <View style={[styles.search, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
            <MaterialCommunityIcons name="magnify" size={20} color={tokens.iconMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Название или площадка"
              placeholderTextColor={tokens.textTertiary}
              accessibilityLabel="Поиск карточек подразделений ЗУП"
              style={[styles.searchInput, { color: tokens.textPrimary }]}
            />
            {loading ? <ActivityIndicator size="small" color={tokens.primary} /> : null}
          </View>
          {searchError ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{searchError}</Text> : null}
          {selectedItems.length ? (
            <View style={styles.selectedRow} accessibilityLabel={`Выбрано подразделений: ${selectedItems.length}`}>
              {selectedItems.map((item) => (
                <Pressable key={item.department} onPress={() => toggle(item)} accessibilityRole="button" accessibilityLabel={`Убрать ${item.department}`} style={[styles.selectedChip, { backgroundColor: tokens.accentSoft }]}>
                  <Text numberOfLines={1} style={[styles.selectedText, { color: tokens.primary }]}>{item.department}</Text>
                  <MaterialCommunityIcons name="close" size={16} color={tokens.primary} />
                </Pressable>
              ))}
            </View>
          ) : null}
          <FlatList
            data={items}
            extraData={selected}
            keyExtractor={(item) => item.department}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={items.length ? styles.list : styles.emptyList}
            ListEmptyComponent={(
              <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>{query.trim().length < 2 ? 'Введите минимум 2 символа.' : loading ? 'Загрузка…' : 'Подразделения не найдены.'}</Text>
            )}
            renderItem={({ item }) => {
              const checked = selected.has(item.department);
              const mixed = item.binding_group === 'mixed';
              return (
                <Pressable
                  disabled={mixed || importing}
                  onPress={() => toggle(item)}
                  accessibilityRole="checkbox"
                  accessibilityLabel={`${item.department}${mixed ? ', смешанные площадки, недоступно' : ''}`}
                  accessibilityState={{ checked, disabled: mixed || importing }}
                  style={[styles.result, { backgroundColor: tokens.panelSolid, borderColor: checked ? tokens.primary : tokens.borderSoft, opacity: mixed ? 0.55 : 1 }]}
                >
                  <View style={styles.resultBody}>
                    <Text style={[styles.resultTitle, { color: tokens.textPrimary }]}>{item.department}</Text>
                    <Text style={[styles.resultMeta, { color: mixed ? tokens.warning : tokens.textSecondary }]}>{mixed ? 'Смешанные площадки · нужна ручная проверка' : [item.department_location, `${item.people_count} сотрудников`, `${item.department_codes.length} кодов`].filter(Boolean).join(' · ')}</Text>
                  </View>
                  <MaterialCommunityIcons name={checked ? 'checkbox-marked' : 'checkbox-blank-outline'} size={24} color={checked ? tokens.primary : tokens.iconMuted} />
                </Pressable>
              );
            }}
          />
        </View>
        <View style={[styles.footer, { backgroundColor: tokens.pageBg, borderTopColor: tokens.borderSoft }]}>
          <Pressable disabled={importing} onPress={onClose} accessibilityRole="button" style={[styles.secondary, { borderColor: tokens.border }]}>
            <Text style={[styles.buttonText, { color: tokens.textPrimary }]}>Отмена</Text>
          </Pressable>
          <Pressable
            testID="native-company-confirm-import"
            disabled={importing || !selectedItems.length}
            onPress={() => onRequestConfirmation(selectedItems.map((item) => item.department))}
            accessibilityRole="button"
            accessibilityState={{ disabled: importing || !selectedItems.length }}
            style={[styles.primary, { backgroundColor: tokens.primary, opacity: importing || !selectedItems.length ? 0.5 : 1 }]}
          >
            {importing ? <ActivityIndicator size="small" color="#fff" /> : <Text style={[styles.buttonText, { color: '#fff' }]}>Продолжить · {selectedItems.length}</Text>}
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { minHeight: 58, borderBottomWidth: 1, paddingLeft: 16, paddingRight: 4, flexDirection: 'row', alignItems: 'center' },
  headerBody: { flex: 1, minWidth: 0 },
  title: { fontSize: 17, fontWeight: '800' },
  subtitle: { marginTop: 2, fontSize: 11 },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, padding: 16, paddingBottom: 0 },
  info: { marginBottom: 12, fontSize: 12, lineHeight: 17 },
  error: { marginBottom: 10, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  search: { minHeight: 48, borderRadius: 14, borderWidth: 1, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  searchInput: { flex: 1, minWidth: 0, fontSize: 14, paddingVertical: 8 },
  selectedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  selectedChip: { minHeight: 40, maxWidth: '100%', borderRadius: 20, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 },
  selectedText: { maxWidth: 260, fontSize: 12, fontWeight: '800' },
  list: { paddingBottom: 24 },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  emptyText: { textAlign: 'center', fontSize: 13 },
  result: { minHeight: 68, borderRadius: 13, borderWidth: 1, padding: 11, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  resultBody: { flex: 1, minWidth: 0 },
  resultTitle: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  resultMeta: { marginTop: 3, fontSize: 11, lineHeight: 16 },
  footer: { minHeight: 72, borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', gap: 12 },
  secondary: { minHeight: 48, flex: 1, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  primary: { minHeight: 48, flex: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 14, fontWeight: '900' },
});
