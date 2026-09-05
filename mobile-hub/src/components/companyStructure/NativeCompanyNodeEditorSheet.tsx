import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { chatKeyboardAvoidingProps } from '../../chat/chatKeyboard';
import {
  searchCompanyStructureDepartmentCodes,
  searchCompanyStructureLeaderCandidates,
  type CompanyStructureDepartmentCode,
  type CompanyStructureLeaderCandidate,
  type CompanyStructureNode,
  type CompanyStructureNodeDraft,
} from '../../api/companyStructureApi';
import { formatApiError } from '../../api/formatError';
import {
  collectCompanyDescendantIds,
  COMPANY_NODE_TYPE_OPTIONS,
  companyNodeTitle,
  companyNodeUsesDepartmentBindings,
  companyNodeUsesLeader,
  defaultCompanyChildType,
  flattenCompanyStructure,
} from '../../companyStructure/nativeCompanyStructureModel';
import type { FluentTokens } from '../../theme/fluentTokens';

type EditorMode = 'create' | 'edit';

function makeDraft(mode: EditorMode, selected: CompanyStructureNode | null): CompanyStructureNodeDraft {
  if (mode === 'edit' && selected) {
    return {
      parent_id: selected.parent_id,
      node_type: selected.node_type,
      title: selected.title,
      person_name: selected.person_name,
      person_position: selected.person_position,
      person_employee_code: selected.person_employee_code,
      department_codes: [...selected.department_codes],
    };
  }
  return {
    parent_id: selected?.id || null,
    node_type: defaultCompanyChildType(selected),
    title: '',
    person_name: '',
    person_position: '',
    person_employee_code: null,
    department_codes: [],
  };
}

function Field({
  label,
  value,
  onChangeText,
  tokens,
  placeholder,
  accessibilityLabel,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  tokens: FluentTokens;
  placeholder?: string;
  accessibilityLabel?: string;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.label, { color: tokens.textSecondary }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={tokens.textTertiary}
        accessibilityLabel={accessibilityLabel || label}
        style={[styles.input, { backgroundColor: tokens.panelSolid, borderColor: tokens.border, color: tokens.textPrimary }]}
      />
    </View>
  );
}

export function NativeCompanyNodeEditorSheet({
  visible,
  mode,
  tree,
  selectedNode,
  saving,
  mutationError,
  tokens,
  onClose,
  onSave,
}: {
  visible: boolean;
  mode: EditorMode;
  tree: CompanyStructureNode[];
  selectedNode: CompanyStructureNode | null;
  saving: boolean;
  mutationError: string;
  tokens: FluentTokens;
  onClose: () => void;
  onSave: (draft: CompanyStructureNodeDraft) => void;
}) {
  const [draft, setDraft] = useState<CompanyStructureNodeDraft>(() => makeDraft(mode, selectedNode));
  const [parentOpen, setParentOpen] = useState(false);
  const [leaderQuery, setLeaderQuery] = useState('');
  const [leaders, setLeaders] = useState<CompanyStructureLeaderCandidate[]>([]);
  const [leaderLoading, setLeaderLoading] = useState(false);
  const [leaderError, setLeaderError] = useState('');
  const [codeQuery, setCodeQuery] = useState('');
  const [codes, setCodes] = useState<CompanyStructureDepartmentCode[]>([]);
  const [codesLoading, setCodesLoading] = useState(false);
  const [codesError, setCodesError] = useState('');

  useEffect(() => {
    if (!visible) return;
    const next = makeDraft(mode, selectedNode);
    setDraft(next);
    setParentOpen(false);
    setLeaderQuery(next.person_name);
    setLeaders([]);
    setLeaderError('');
    setCodeQuery('');
    setCodes([]);
    setCodesError('');
  }, [mode, selectedNode, visible]);

  const forbiddenParents = useMemo(() => {
    const result = collectCompanyDescendantIds(mode === 'edit' ? selectedNode : null);
    if (mode === 'edit' && selectedNode) result.add(selectedNode.id);
    return result;
  }, [mode, selectedNode]);
  const parentOptions = useMemo(
    () => flattenCompanyStructure(tree).filter(({ node }) => !forbiddenParents.has(node.id)),
    [forbiddenParents, tree],
  );
  const parentTitle = draft.parent_id
    ? companyNodeTitle(parentOptions.find(({ node }) => node.id === draft.parent_id)?.node)
    : 'Верхний уровень';
  const usesLeader = companyNodeUsesLeader(draft.node_type);
  const usesCodes = companyNodeUsesDepartmentBindings(draft.node_type);

  useEffect(() => {
    const query = leaderQuery.trim();
    if (!visible || !usesLeader || query.length < 2 || query === draft.person_name.trim()) {
      setLeaders([]);
      setLeaderLoading(false);
      setLeaderError('');
      return undefined;
    }
    let cancelled = false;
    setLeaderLoading(true);
    setLeaderError('');
    const timer = setTimeout(() => {
      void searchCompanyStructureLeaderCandidates(query, 30).then((payload) => {
        if (!cancelled) setLeaders(payload.items);
      }).catch((cause) => {
        if (!cancelled) setLeaderError(formatApiError(cause, 'Не удалось найти руководителя.'));
      }).finally(() => {
        if (!cancelled) setLeaderLoading(false);
      });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [draft.person_name, leaderQuery, usesLeader, visible]);

  useEffect(() => {
    const query = codeQuery.trim();
    if (!visible || !usesCodes || query.length < 2) {
      setCodes([]);
      setCodesLoading(false);
      setCodesError('');
      return undefined;
    }
    let cancelled = false;
    setCodesLoading(true);
    setCodesError('');
    const timer = setTimeout(() => {
      void searchCompanyStructureDepartmentCodes(query, 100).then((payload) => {
        if (!cancelled) setCodes(payload.items);
      }).catch((cause) => {
        if (!cancelled) setCodesError(formatApiError(cause, 'Не удалось найти подразделение ЗУП.'));
      }).finally(() => {
        if (!cancelled) setCodesLoading(false);
      });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [codeQuery, usesCodes, visible]);

  const chooseType = (nodeType: string) => {
    setDraft((current) => ({
      ...current,
      node_type: nodeType,
      person_name: companyNodeUsesLeader(nodeType) ? current.person_name : '',
      person_position: companyNodeUsesLeader(nodeType) ? current.person_position : '',
      person_employee_code: companyNodeUsesLeader(nodeType) ? current.person_employee_code : null,
      department_codes: companyNodeUsesDepartmentBindings(nodeType) ? current.department_codes : [],
    }));
  };
  const chooseLeader = (leader: CompanyStructureLeaderCandidate) => {
    setDraft((current) => ({
      ...current,
      person_employee_code: leader.employee_code,
      person_name: leader.full_name,
      person_position: leader.position,
    }));
    setLeaderQuery(leader.full_name);
    setLeaders([]);
  };
  const toggleCode = (option: CompanyStructureDepartmentCode) => {
    const ownerConflict = option.linked_node_id && option.linked_node_id !== selectedNode?.id;
    if (ownerConflict) return;
    setDraft((current) => ({
      ...current,
      department_codes: current.department_codes.includes(option.department_code)
        ? current.department_codes.filter((code) => code !== option.department_code)
        : [...current.department_codes, option.department_code],
    }));
  };
  const selectableCodesByGroup = (group: 'office' | 'object') => codes.filter((option) => (
    option.binding_group === group
      && (!option.linked_node_id || option.linked_node_id === selectedNode?.id)
  ));
  const replaceCodesByGroup = (group: 'office' | 'object') => {
    setDraft((current) => ({
      ...current,
      department_codes: selectableCodesByGroup(group).map((option) => option.department_code),
    }));
  };
  const officeCodeCount = selectableCodesByGroup('office').length;
  const objectCodeCount = selectableCodesByGroup('object').length;
  const titleValid = draft.title.trim().length > 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => { if (!saving) onClose(); }}>
      <SafeAreaView accessibilityViewIsModal style={[styles.safe, { backgroundColor: tokens.pageBg }]}>
        <View style={[styles.header, { backgroundColor: tokens.headerBandBg, borderBottomColor: tokens.borderSoft }]}>
          <View style={styles.headerTitleBody}>
            <Text style={[styles.headerTitle, { color: tokens.textPrimary }]}>{mode === 'create' ? 'Новый узел' : 'Изменить узел'}</Text>
            <Text style={[styles.headerSubtitle, { color: tokens.textSecondary }]}>{mode === 'create' ? `Внутри: ${companyNodeTitle(selectedNode)}` : companyNodeTitle(selectedNode)}</Text>
          </View>
          <Pressable disabled={saving} onPress={onClose} accessibilityRole="button" accessibilityLabel="Закрыть редактор" style={styles.close}>
            <MaterialCommunityIcons name="close" size={24} color={tokens.textPrimary} />
          </Pressable>
        </View>
        <KeyboardAvoidingView style={styles.flex} {...chatKeyboardAvoidingProps()}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            {mutationError ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{mutationError}</Text> : null}

            <Text style={[styles.sectionTitle, { color: tokens.textPrimary }]}>Тип узла</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.typeRow} accessibilityRole="radiogroup">
              {COMPANY_NODE_TYPE_OPTIONS.map((option) => {
                const selected = draft.node_type === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => chooseType(option.value)}
                    accessibilityRole="radio"
                    accessibilityLabel={`Тип узла: ${option.label}`}
                    accessibilityState={{ checked: selected }}
                    style={[styles.typeChip, { backgroundColor: selected ? tokens.primary : tokens.panelSolid, borderColor: selected ? tokens.primary : tokens.border }]}
                  >
                    <Text style={[styles.typeText, { color: selected ? '#fff' : tokens.textPrimary }]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Field label="Название" accessibilityLabel="Название узла" value={draft.title} onChangeText={(title) => setDraft((current) => ({ ...current, title }))} tokens={tokens} placeholder="Например, ИТ-блок" />

            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: tokens.textSecondary }]}>Родительский узел</Text>
              <Pressable
                onPress={() => setParentOpen((current) => !current)}
                accessibilityRole="button"
                accessibilityState={{ expanded: parentOpen }}
                accessibilityLabel={`Родительский узел: ${parentTitle}`}
                style={[styles.selector, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}
              >
                <Text numberOfLines={1} style={[styles.selectorText, { color: tokens.textPrimary }]}>{parentTitle}</Text>
                <MaterialCommunityIcons name={parentOpen ? 'chevron-up' : 'chevron-down'} size={22} color={tokens.iconMuted} />
              </Pressable>
              {parentOpen ? (
                <ScrollView
                  style={[styles.options, { borderColor: tokens.borderSoft }]}
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                  accessibilityLabel="Доступные родительские узлы"
                >
                  <Pressable onPress={() => { setDraft((current) => ({ ...current, parent_id: null })); setParentOpen(false); }} accessibilityRole="button" style={styles.option}>
                    <Text style={[styles.optionText, { color: tokens.textPrimary }]}>Верхний уровень</Text>
                  </Pressable>
                  {parentOptions.map(({ node, depth }) => (
                    <Pressable key={node.id} onPress={() => { setDraft((current) => ({ ...current, parent_id: node.id })); setParentOpen(false); }} accessibilityRole="button" accessibilityLabel={`Выбрать родителя ${companyNodeTitle(node)}`} style={[styles.option, { paddingLeft: 12 + Math.min(depth, 5) * 14 }]}>
                      <Text style={[styles.optionText, { color: tokens.textPrimary }]}>{companyNodeTitle(node)}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              ) : null}
            </View>

            {usesLeader ? (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: tokens.textPrimary }]}>Руководитель</Text>
                <Field label="Поиск по ФИО" accessibilityLabel="Поиск руководителя" value={leaderQuery} onChangeText={(value) => { setLeaderQuery(value); setDraft((current) => ({ ...current, person_employee_code: null, person_name: '', person_position: '' })); }} tokens={tokens} placeholder="Минимум 2 символа" />
                {leaderLoading ? <ActivityIndicator color={tokens.primary} /> : null}
                {leaderError ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{leaderError}</Text> : null}
                {leaders.map((leader) => (
                  <Pressable key={leader.employee_code} onPress={() => chooseLeader(leader)} accessibilityRole="button" style={[styles.result, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
                    <Text style={[styles.resultTitle, { color: tokens.textPrimary }]}>{leader.full_name}</Text>
                    <Text style={[styles.resultMeta, { color: tokens.textSecondary }]}>{[leader.position, leader.department, leader.department_location].filter(Boolean).join(' · ')}</Text>
                  </Pressable>
                ))}
                {draft.person_employee_code ? <Text style={[styles.selectedHint, { color: tokens.primary }]}>Выбран сотрудник ЗУП: {draft.person_name}</Text> : null}
                <Field label="Должность на карточке" value={draft.person_position} onChangeText={(person_position) => setDraft((current) => ({ ...current, person_position }))} tokens={tokens} />
              </View>
            ) : null}

            {usesCodes ? (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: tokens.textPrimary }]}>Привязки подразделений ЗУП</Text>
                <Text style={[styles.hint, { color: tokens.textSecondary }]}>Один код может принадлежать только одной карточке. Конфликтные варианты недоступны.</Text>
                <Field label="Название, код или площадка" accessibilityLabel="Поиск подразделений ЗУП" value={codeQuery} onChangeText={setCodeQuery} tokens={tokens} placeholder="Минимум 2 символа" />
                {draft.department_codes.length ? (
                  <View style={styles.selectedCodes}>
                    {draft.department_codes.map((code) => (
                      <Pressable key={code} onPress={() => setDraft((current) => ({ ...current, department_codes: current.department_codes.filter((item) => item !== code) }))} accessibilityRole="button" accessibilityLabel={`Удалить привязку ${code}`} style={[styles.codeChip, { backgroundColor: tokens.accentSoft }]}>
                        <Text style={[styles.codeText, { color: tokens.primary }]}>{code}</Text>
                        <MaterialCommunityIcons name="close" size={16} color={tokens.primary} />
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                {codesLoading ? <ActivityIndicator color={tokens.primary} /> : null}
                {codesError ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{codesError}</Text> : null}
                {codeQuery.trim() ? (
                  <View style={styles.batchActions}>
                    <Pressable
                      testID="native-company-select-office-codes"
                      disabled={!officeCodeCount}
                      onPress={() => replaceCodesByGroup('office')}
                      accessibilityRole="button"
                      accessibilityLabel={`Выбрать офисные привязки, ${officeCodeCount}`}
                      accessibilityState={{ disabled: !officeCodeCount }}
                      style={[styles.batchButton, { borderColor: tokens.border, opacity: officeCodeCount ? 1 : 0.5 }]}
                    >
                      <Text style={[styles.batchButtonText, { color: tokens.primary }]}>Офис · {officeCodeCount}</Text>
                    </Pressable>
                    <Pressable
                      testID="native-company-select-object-codes"
                      disabled={!objectCodeCount}
                      onPress={() => replaceCodesByGroup('object')}
                      accessibilityRole="button"
                      accessibilityLabel={`Выбрать объектовые привязки, ${objectCodeCount}`}
                      accessibilityState={{ disabled: !objectCodeCount }}
                      style={[styles.batchButton, { borderColor: tokens.border, opacity: objectCodeCount ? 1 : 0.5 }]}
                    >
                      <Text style={[styles.batchButtonText, { color: tokens.primary }]}>Объект · {objectCodeCount}</Text>
                    </Pressable>
                  </View>
                ) : null}
                {codes.map((option) => {
                  const selected = draft.department_codes.includes(option.department_code);
                  const conflict = Boolean(option.linked_node_id && option.linked_node_id !== selectedNode?.id);
                  return (
                    <Pressable
                      key={option.department_code}
                      disabled={conflict}
                      onPress={() => toggleCode(option)}
                      accessibilityRole="checkbox"
                      accessibilityLabel={`${option.department_code} ${option.department || 'Без названия'}${conflict ? `, уже привязан: ${option.linked_node_title || option.linked_node_id}` : ''}`}
                      accessibilityState={{ checked: selected, disabled: conflict }}
                      style={[styles.result, { backgroundColor: tokens.panelSolid, borderColor: selected ? tokens.primary : tokens.borderSoft, opacity: conflict ? 0.55 : 1 }]}
                    >
                      <Text style={[styles.resultTitle, { color: tokens.textPrimary }]}>{option.department_code} · {option.department || 'Без названия'}</Text>
                      <Text style={[styles.resultMeta, { color: conflict ? tokens.warning : tokens.textSecondary }]}>{conflict ? `Уже привязан: ${option.linked_node_title || option.linked_node_id}` : [option.department_locations.join(', ') || option.department_location, `${option.people_count} сотрудников`].filter(Boolean).join(' · ')}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </ScrollView>
          <View style={[styles.footer, { backgroundColor: tokens.pageBg, borderTopColor: tokens.borderSoft }]}>
            <Pressable disabled={saving} onPress={onClose} accessibilityRole="button" style={[styles.secondaryButton, { borderColor: tokens.border }]}>
              <Text style={[styles.buttonText, { color: tokens.textPrimary }]}>Отмена</Text>
            </Pressable>
            <Pressable testID="native-company-save" disabled={saving || !titleValid} onPress={() => onSave(draft)} accessibilityRole="button" accessibilityState={{ disabled: saving || !titleValid }} style={[styles.primaryButton, { backgroundColor: tokens.primary, opacity: saving || !titleValid ? 0.5 : 1 }]}>
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={[styles.buttonText, { color: '#fff' }]}>{mode === 'create' ? 'Создать' : 'Сохранить'}</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  header: { minHeight: 58, borderBottomWidth: 1, paddingLeft: 16, paddingRight: 4, flexDirection: 'row', alignItems: 'center' },
  headerTitleBody: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 17, fontWeight: '800' },
  headerSubtitle: { marginTop: 2, fontSize: 11 },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 30 },
  section: { marginTop: 20 },
  sectionTitle: { marginBottom: 8, fontSize: 15, lineHeight: 20, fontWeight: '900' },
  typeRow: { gap: 8, paddingBottom: 16 },
  typeChip: { minHeight: 44, borderRadius: 22, borderWidth: 1, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  typeText: { fontSize: 12, fontWeight: '800' },
  fieldGroup: { marginBottom: 14 },
  label: { marginBottom: 6, fontSize: 12, fontWeight: '700' },
  input: { minHeight: 48, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  selector: { minHeight: 48, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center' },
  selectorText: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '700' },
  options: { maxHeight: 280, borderWidth: 1, borderRadius: 12, marginTop: 6, overflow: 'hidden' },
  option: { minHeight: 48, paddingHorizontal: 12, justifyContent: 'center' },
  optionText: { fontSize: 13, fontWeight: '700' },
  batchActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  batchButton: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  batchButtonText: { fontSize: 12, fontWeight: '800' },
  hint: { marginTop: -4, marginBottom: 10, fontSize: 12, lineHeight: 17 },
  error: { marginBottom: 10, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  result: { minHeight: 62, borderRadius: 12, borderWidth: 1, padding: 10, marginBottom: 8, justifyContent: 'center' },
  resultTitle: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  resultMeta: { marginTop: 3, fontSize: 11, lineHeight: 16 },
  selectedHint: { marginBottom: 10, fontSize: 12, lineHeight: 17, fontWeight: '800' },
  selectedCodes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  codeChip: { minHeight: 40, borderRadius: 20, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 },
  codeText: { fontSize: 12, fontWeight: '800' },
  footer: { minHeight: 72, borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', gap: 12 },
  secondaryButton: { minHeight: 48, flex: 1, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  primaryButton: { minHeight: 48, flex: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 14, fontWeight: '900' },
});
