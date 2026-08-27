import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  createConsumable,
  createEquipment,
  listEquipmentBranches,
  listEquipmentLocations,
  listEquipmentStatuses,
  listEquipmentTypes,
  type EquipmentDirectoryOption,
  type EquipmentStatusOption,
  type EquipmentTypeOption,
} from '../../api/databaseApi';
import { formatApiError } from '../../api/formatError';
import type { FluentTokens } from '../../theme/fluentTokens';

type CreateKind = 'equipment' | 'consumable';

export function NativeDatabaseCreateModal({
  visible,
  initialKind,
  databaseId,
  tokens,
  onClose,
  onCreated,
}: {
  visible: boolean;
  initialKind: CreateKind;
  databaseId?: string;
  tokens: FluentTokens;
  onClose: () => void;
  onCreated: (message: string, invNo?: string) => Promise<void> | void;
}) {
  const [kind, setKind] = useState<CreateKind>(initialKind);
  const [busy, setBusy] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [error, setError] = useState('');
  const [branches, setBranches] = useState<EquipmentDirectoryOption[]>([]);
  const [locations, setLocations] = useState<EquipmentDirectoryOption[]>([]);
  const [types, setTypes] = useState<EquipmentTypeOption[]>([]);
  const [statuses, setStatuses] = useState<EquipmentStatusOption[]>([]);
  const [branchNo, setBranchNo] = useState<number | string | null>(null);
  const [locationNo, setLocationNo] = useState<number | string | null>(null);
  const [typeNo, setTypeNo] = useState<number | null>(null);
  const [statusNo, setStatusNo] = useState<number | null>(null);
  const [serialNo, setSerialNo] = useState('');
  const [employeeName, setEmployeeName] = useState('');
  const [modelName, setModelName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [partNo, setPartNo] = useState('');
  const [description, setDescription] = useState('');
  const [ipAddress, setIpAddress] = useState('');

  useEffect(() => {
    if (visible) setKind(initialKind);
  }, [initialKind, visible]);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setLoadingOptions(true);
    setError('');
    void Promise.all([
      listEquipmentBranches(databaseId),
      listEquipmentTypes(kind === 'consumable' ? 4 : 1, databaseId),
      kind === 'equipment' ? listEquipmentStatuses(databaseId) : Promise.resolve([]),
    ]).then(([nextBranches, nextTypes, nextStatuses]) => {
      if (!active) return;
      setBranches(nextBranches);
      setTypes(nextTypes);
      setStatuses(nextStatuses);
    }).catch((cause) => {
      if (active) setError(formatApiError(cause, 'Не удалось загрузить справочники для создания.'));
    }).finally(() => { if (active) setLoadingOptions(false); });
    return () => { active = false; };
  }, [databaseId, kind, visible]);

  useEffect(() => {
    if (!visible || branchNo === null) {
      setLocations([]);
      return;
    }
    let active = true;
    void listEquipmentLocations(branchNo, databaseId)
      .then((next) => { if (active) setLocations(next); })
      .catch((cause) => { if (active) setError(formatApiError(cause, 'Не удалось загрузить размещения.')); });
    return () => { active = false; };
  }, [branchNo, databaseId, visible]);

  const reset = useCallback(() => {
    setError('');
    setBranchNo(null);
    setLocationNo(null);
    setTypeNo(null);
    setStatusNo(null);
    setSerialNo('');
    setEmployeeName('');
    setModelName('');
    setQuantity('1');
    setPartNo('');
    setDescription('');
    setIpAddress('');
  }, []);

  const close = useCallback(() => {
    if (busy) return;
    reset();
    onClose();
  }, [busy, onClose, reset]);

  const submit = useCallback(async () => {
    if (busy) return;
    setError('');
    if (branchNo === null || locationNo === null || typeNo === null || !modelName.trim()) {
      setError('Выберите филиал, размещение и тип, затем укажите модель.');
      return;
    }
    if (kind === 'equipment' && (!serialNo.trim() || employeeName.trim().length < 2 || statusNo === null)) {
      setError('Для оборудования нужны серийный номер, сотрудник и статус.');
      return;
    }
    const qty = Number(quantity.trim());
    if (kind === 'consumable' && (!Number.isInteger(qty) || qty < 1)) {
      setError('Количество должно быть целым числом больше нуля.');
      return;
    }
    setBusy(true);
    try {
      const result = kind === 'equipment'
        ? await createEquipment({
          serial_no: serialNo.trim(),
          employee_name: employeeName.trim(),
          branch_no: branchNo,
          loc_no: locationNo,
          type_no: typeNo,
          status_no: statusNo as number,
          model_name: modelName.trim(),
          part_no: partNo.trim() || undefined,
          description: description.trim() || undefined,
          ip_address: ipAddress.trim() || undefined,
        }, databaseId)
        : await createConsumable({
          branch_no: branchNo,
          loc_no: locationNo,
          type_no: typeNo,
          qty,
          model_name: modelName.trim(),
          part_no: partNo.trim() || undefined,
          description: description.trim() || undefined,
        }, databaseId);
      reset();
      onClose();
      await onCreated(result.message || (kind === 'equipment' ? 'Оборудование добавлено.' : 'Расходник добавлен.'), result.inv_no);
    } catch (cause) {
      setError(formatApiError(cause, kind === 'equipment' ? 'Не удалось добавить оборудование.' : 'Не удалось добавить расходник.'));
    } finally {
      setBusy(false);
    }
  }, [branchNo, busy, databaseId, description, employeeName, ipAddress, kind, locationNo, modelName, onClose, onCreated, partNo, quantity, reset, serialNo, statusNo, typeNo]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close} accessibilityViewIsModal>
      <View style={[styles.screen, { backgroundColor: tokens.pageBg }]}> 
        <View style={[styles.header, { borderBottomColor: tokens.borderSoft }]}> 
          <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel="Закрыть создание" onPress={close} style={styles.headerAction}>
            <Text style={[styles.headerText, { color: tokens.textSecondary }]}>Отмена</Text>
          </Pressable>
          <Text accessibilityRole="header" style={[styles.title, { color: tokens.textPrimary }]}>Добавление</Text>
          <Pressable testID="native-database-create-save" disabled={busy} accessibilityRole="button" accessibilityState={{ disabled: busy }} onPress={() => { void submit(); }} style={styles.headerAction}>
            {busy ? <ActivityIndicator size="small" color={tokens.primary} /> : <Text style={[styles.headerText, { color: tokens.primary }]}>Сохранить</Text>}
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <View style={[styles.kindTabs, { backgroundColor: tokens.panelInset }]} accessibilityRole="tablist">
            {(['equipment', 'consumable'] as const).map((value) => {
              const selected = value === kind;
              return (
                <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => { setKind(value); setTypeNo(null); setStatusNo(null); }} style={[styles.kindTab, { backgroundColor: selected ? tokens.panelSolid : 'transparent' }]}> 
                  <Text style={[styles.kindText, { color: selected ? tokens.primary : tokens.textSecondary }]}>{value === 'equipment' ? 'Оборудование' : 'Расходник'}</Text>
                </Pressable>
              );
            })}
          </View>
          {error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{error}</Text> : null}
          {loadingOptions ? <ActivityIndicator style={styles.loader} color={tokens.primary} /> : null}
          <OptionStrip label="Филиал" items={branches.map((item) => ({ id: item.id, name: item.name }))} selected={branchNo} onSelect={(id) => { setBranchNo(id); setLocationNo(null); }} tokens={tokens} />
          <OptionStrip label="Размещение" items={locations.map((item) => ({ id: item.id, name: item.name }))} selected={locationNo} onSelect={setLocationNo} tokens={tokens} />
          <OptionStrip label="Тип" items={types.map((item) => ({ id: item.type_no, name: item.type_name }))} selected={typeNo} onSelect={(id) => setTypeNo(Number(id))} tokens={tokens} />
          {kind === 'equipment' ? <OptionStrip label="Статус" items={statuses.map((item) => ({ id: item.status_no, name: item.status_name }))} selected={statusNo} onSelect={(id) => setStatusNo(Number(id))} tokens={tokens} /> : null}
          {kind === 'equipment' ? <Input label="Серийный номер" value={serialNo} onChange={setSerialNo} tokens={tokens} testID="native-create-serial" /> : null}
          {kind === 'equipment' ? <Input label="Сотрудник" value={employeeName} onChange={setEmployeeName} tokens={tokens} testID="native-create-employee" /> : null}
          <Input label="Модель" value={modelName} onChange={setModelName} tokens={tokens} testID="native-create-model" />
          {kind === 'consumable' ? <Input label="Количество" value={quantity} onChange={setQuantity} tokens={tokens} testID="native-create-quantity" keyboardType="number-pad" /> : null}
          <Input label="Part number (необязательно)" value={partNo} onChange={setPartNo} tokens={tokens} />
          {kind === 'equipment' ? <Input label="IP-адрес (необязательно)" value={ipAddress} onChange={setIpAddress} tokens={tokens} autoCapitalize="none" /> : null}
          <Input label="Описание (необязательно)" value={description} onChange={setDescription} tokens={tokens} multiline />
        </ScrollView>
      </View>
    </Modal>
  );
}

function OptionStrip({ label, items, selected, onSelect, tokens }: {
  label: string;
  items: Array<{ id: number | string; name: string }>;
  selected: number | string | null;
  onSelect: (id: number | string) => void;
  tokens: FluentTokens;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: tokens.textSecondary }]}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.options}>
        {items.map((item) => {
          const active = String(item.id) === String(selected ?? '');
          return (
            <Pressable key={`${label}:${item.id}`} accessibilityRole="radio" accessibilityState={{ checked: active }} onPress={() => onSelect(item.id)} style={[styles.option, { backgroundColor: active ? tokens.primary : tokens.panelSolid, borderColor: active ? tokens.primary : tokens.border }]}> 
              <Text style={[styles.optionText, { color: active ? '#fff' : tokens.textPrimary }]}>{item.name}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function Input({ label, value, onChange, tokens, testID, multiline = false, keyboardType, autoCapitalize }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  tokens: FluentTokens;
  testID?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'number-pad';
  autoCapitalize?: 'none' | 'sentences';
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: tokens.textSecondary }]}>{label}</Text>
      <TextInput testID={testID} value={value} onChangeText={onChange} multiline={multiline} keyboardType={keyboardType} autoCapitalize={autoCapitalize} accessibilityLabel={label} placeholder={label} placeholderTextColor={tokens.textTertiary} style={[styles.input, multiline && styles.textarea, { color: tokens.textPrimary, backgroundColor: tokens.panelSolid, borderColor: tokens.border }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { minHeight: 58, borderBottomWidth: 1, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center' },
  headerAction: { width: 88, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  headerText: { fontSize: 13, fontWeight: '800' },
  title: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '900' },
  content: { padding: 16, paddingBottom: 40 },
  kindTabs: { minHeight: 46, padding: 3, borderRadius: 12, flexDirection: 'row', marginBottom: 15 },
  kindTab: { flex: 1, minHeight: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  kindText: { fontSize: 13, fontWeight: '800' },
  error: { marginBottom: 10, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  loader: { marginBottom: 12 },
  field: { marginBottom: 14 },
  label: { marginBottom: 6, fontSize: 12, fontWeight: '800' },
  options: { gap: 8, paddingBottom: 2 },
  option: { minHeight: 44, maxWidth: 260, borderWidth: 1, borderRadius: 22, paddingHorizontal: 13, justifyContent: 'center' },
  optionText: { fontSize: 12, fontWeight: '800' },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  textarea: { minHeight: 96, textAlignVertical: 'top' },
});
