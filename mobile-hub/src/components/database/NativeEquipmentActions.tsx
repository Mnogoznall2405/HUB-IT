import { NativeModal as Modal } from '../ui/NativeModal';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  deleteEquipment,
  getEquipmentTransferJob,
  listConsumables,
  listEquipmentBranches,
  listEquipmentLocations,
  recordEquipmentWork,
  sendEquipmentTransferActsEmail,
  submitEquipmentTransfer,
  type ConsumableRecord,
  type EquipmentDirectoryOption,
  type EquipmentRecord,
  type EquipmentWorkKind,
  type TransferAct,
  type TransferMode,
  type TransferRequest,
  type TransferResult,
} from '../../api/databaseApi';
import { formatApiError } from '../../api/formatError';
import { downloadGeneratedTransferAct } from '../../database/nativeDatabaseFiles';
import { equipmentWorkKindLabel, equipmentWorkKinds } from '../../database/nativeDatabaseModel';
import { openNativeFile } from '../../files/nativeAttachmentDownloads';
import type { FluentTokens } from '../../theme/fluentTokens';

type ActionKind = TransferMode | EquipmentWorkKind | 'delete' | null;

function operationId(): string {
  return Crypto.randomUUID?.()
    || `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function ChoiceStrip({
  label,
  items,
  selected,
  onSelect,
  tokens,
}: {
  label: string;
  items: EquipmentDirectoryOption[];
  selected: number | string | null;
  onSelect: (value: number | string) => void;
  tokens: FluentTokens;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.label, { color: tokens.textSecondary }]}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceStrip}>
        {items.map((item) => {
          const active = String(item.id) === String(selected ?? '');
          return (
            <Pressable
              key={`${label}:${item.id}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              onPress={() => onSelect(item.id)}
              style={[styles.choice, {
                backgroundColor: active ? tokens.primary : tokens.panelSolid,
                borderColor: active ? tokens.primary : tokens.border,
              }]}
            >
              <Text style={[styles.choiceText, { color: active ? '#fff' : tokens.textPrimary }]}>{item.name}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function NativeEquipmentActions({
  equipment,
  targets,
  databaseId,
  canWrite,
  canDeleteEquipment,
  offline,
  surface,
  tokens,
  onChanged,
  onDeleted,
  testIDPrefix = 'native-equipment',
}: {
  equipment: EquipmentRecord;
  targets?: EquipmentRecord[];
  databaseId?: string;
  canWrite: boolean;
  canDeleteEquipment: boolean;
  offline: boolean;
  surface: 'general' | 'works';
  tokens: FluentTokens;
  onChanged: () => Promise<void> | void;
  onDeleted: () => void;
  testIDPrefix?: string;
}) {
  const [action, setAction] = useState<ActionKind>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [branches, setBranches] = useState<EquipmentDirectoryOption[]>([]);
  const [locations, setLocations] = useState<EquipmentDirectoryOption[]>([]);
  const [branchNo, setBranchNo] = useState<number | string | null>(equipment.branch_no ?? null);
  const [locationNo, setLocationNo] = useState<number | string | null>(equipment.loc_no ?? null);
  const [employee, setEmployee] = useState('');
  const [issuer, setIssuer] = useState(equipment.employee_name || '');
  const [comment, setComment] = useState('');
  const [consumables, setConsumables] = useState<ConsumableRecord[]>([]);
  const [selectedConsumable, setSelectedConsumable] = useState<ConsumableRecord | null>(null);
  const [componentType, setComponentType] = useState('component');
  const [result, setResult] = useState<TransferResult | null>(null);
  const [fileBusy, setFileBusy] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMode, setEmailMode] = useState<'old' | 'new' | 'manual'>('new');
  const [manualEmail, setManualEmail] = useState('');
  const attemptRef = useRef<{ signature: string; key: string } | null>(null);
  const targetInvNos = useMemo(() => {
    const values = targets?.length ? targets : [equipment];
    return [...new Set(values.map((item) => item.inv_no.trim()).filter(Boolean))];
  }, [equipment, targets]);
  const multiple = targetInvNos.length > 1;
  const workKinds = useMemo(() => equipmentWorkKinds(equipment), [equipment]);
  const transferAction = action === 'owner' || action === 'location' || action === 'act-only';
  const workAction = action === 'cartridge' || action === 'battery' || action === 'component' || action === 'cleaning';

  useEffect(() => {
    if (!transferAction) return;
    let active = true;
    setError('');
    void Promise.all([
      listEquipmentBranches(databaseId),
      listEquipmentLocations(branchNo, databaseId),
    ]).then(([nextBranches, nextLocations]) => {
      if (!active) return;
      setBranches(nextBranches);
      setLocations(nextLocations);
    }).catch((cause) => {
      if (active) setError(formatApiError(cause, 'Не удалось загрузить справочники размещения.'));
    });
    return () => { active = false; };
  }, [branchNo, databaseId, transferAction]);

  useEffect(() => {
    if (action !== 'cartridge' && action !== 'component') return;
    let active = true;
    setError('');
    void listConsumables({
      branchNo: equipment.branch_no,
      locationNo: equipment.loc_no,
      onlyPositiveQty: true,
      limit: 100,
      databaseId,
    }).then((resultValue) => {
      if (active) setConsumables(resultValue.consumables);
    }).catch((cause) => {
      if (active) setError(formatApiError(cause, 'Не удалось загрузить доступные расходники.'));
    });
    return () => { active = false; };
  }, [action, databaseId, equipment.branch_no, equipment.loc_no]);

  const close = useCallback(() => {
    if (busy) return;
    setAction(null);
    setError('');
    setNotice('');
    setResult(null);
    setSelectedConsumable(null);
  }, [busy]);

  const runTransfer = useCallback(async () => {
    if (!transferAction || busy || offline) return;
    const base: Omit<TransferRequest, 'operation_id'> = {
      inv_nos: targetInvNos,
      comment: comment.trim() || undefined,
      ...(action === 'owner' ? {
        new_employee: employee.trim(),
        branch_no: branchNo ?? undefined,
        loc_no: locationNo ?? undefined,
      } : {}),
      ...(action === 'location' ? {
        branch_no: branchNo ?? undefined,
        loc_no: locationNo ?? undefined,
      } : {}),
      ...(action === 'act-only' ? { issuer_employee: issuer.trim() } : {}),
    };
    if (action === 'owner' && employee.trim().length < 2) {
      setError('Укажите нового сотрудника.');
      return;
    }
    if (action === 'location' && (branchNo === null || locationNo === null)) {
      setError('Выберите филиал и размещение.');
      return;
    }
    if (action === 'act-only' && !issuer.trim()) {
      setError('Укажите сотрудника, который передал оборудование.');
      return;
    }
    const signature = JSON.stringify({ action, ...base });
    if (attemptRef.current?.signature !== signature) attemptRef.current = { signature, key: operationId() };
    const payload: TransferRequest = { ...base, operation_id: attemptRef.current.key };
    setBusy(true);
    setError('');
    setNotice('Операция поставлена в очередь…');
    try {
      let next = await submitEquipmentTransfer(action, payload, databaseId);
      for (let attempt = 0; next.job_id && ['queued', 'processing'].includes(next.job_status || ''); attempt += 1) {
        if (attempt >= 90) throw new Error('Операция выполняется дольше обычного. Повторите проверку — ключ операции сохранён.');
        await wait(1_000);
        next = await getEquipmentTransferJob(next.job_id, databaseId);
        setNotice(next.job_status_text || 'Формируются документы…');
      }
      if (next.job_status === 'failed') throw new Error(next.job_error || 'Операция завершилась ошибкой');
      setResult(next);
      setNotice(next.failed_count
        ? `Выполнено: ${next.success_count}, ошибок: ${next.failed_count}.`
        : 'Операция успешно выполнена.');
      attemptRef.current = null;
      await onChanged();
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось выполнить операцию.'));
    } finally {
      setBusy(false);
    }
  }, [action, branchNo, busy, comment, databaseId, employee, issuer, locationNo, offline, onChanged, targetInvNos, transferAction]);

  const runWork = useCallback(async () => {
    if (!workAction || busy || offline) return;
    setBusy(true);
    setError('');
    try {
      await recordEquipmentWork({
        kind: action,
        equipment,
        databaseId,
        consumable: selectedConsumable,
        componentType,
        componentName: componentType,
        componentModel: selectedConsumable?.model_name,
      });
      setNotice(`${equipmentWorkKindLabel(action)} записана.`);
      await onChanged();
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось записать обслуживание.'));
    } finally {
      setBusy(false);
    }
  }, [action, busy, componentType, databaseId, equipment, offline, onChanged, selectedConsumable, workAction]);

  const confirmDelete = useCallback(async () => {
    if (action !== 'delete' || busy || offline || !canDeleteEquipment) return;
    setBusy(true);
    setError('');
    try {
      await deleteEquipment(equipment.inv_no, databaseId);
      setAction(null);
      onDeleted();
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось удалить оборудование.'));
    } finally {
      setBusy(false);
    }
  }, [action, busy, canDeleteEquipment, databaseId, equipment.inv_no, offline, onDeleted]);

  const openAct = useCallback(async (act: TransferAct) => {
    if (fileBusy) return;
    setFileBusy(act.act_id);
    setError('');
    try {
      const file = await downloadGeneratedTransferAct(act.act_id, {
        fileName: act.file_name,
        fileType: act.file_type,
        databaseId,
      });
      await openNativeFile(file, act.file_type === 'docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/pdf');
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось открыть сформированный акт.'));
    } finally {
      setFileBusy('');
    }
  }, [databaseId, fileBusy]);

  const sendActs = useCallback(async () => {
    if (!result?.acts.length || emailBusy) return;
    if (emailMode === 'manual' && !/^\S+@\S+\.\S+$/.test(manualEmail.trim())) {
      setError('Укажите корректный e-mail получателя.');
      return;
    }
    setEmailBusy(true);
    setError('');
    try {
      const sent = await sendEquipmentTransferActsEmail({
        act_ids: result.acts.map((act) => act.act_id),
        mode: emailMode,
        manual_email: emailMode === 'manual' ? manualEmail.trim() : undefined,
      }, databaseId);
      setNotice(sent.failed_count
        ? `Отправлено: ${sent.success_count}, ошибок: ${sent.failed_count}.`
        : `Акты отправлены: ${sent.success_count}.`);
      if (sent.errors.length) setError(sent.errors.join('\n'));
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось отправить акты по почте.'));
    } finally {
      setEmailBusy(false);
    }
  }, [databaseId, emailBusy, emailMode, manualEmail, result?.acts]);

  if (!canWrite && !canDeleteEquipment) return null;

  return (
    <>
      {surface === 'general' ? (
        <View style={styles.actionGrid}>
          {canWrite ? (
            <>
              <ActionButton testID={`${testIDPrefix}-transfer-owner`} icon="account-arrow-right-outline" label="Передать сотруднику" onPress={() => setAction('owner')} disabled={offline} tokens={tokens} />
              <ActionButton testID={`${testIDPrefix}-transfer-location`} icon="map-marker-right-outline" label="Сменить размещение" onPress={() => setAction('location')} disabled={offline} tokens={tokens} />
              <ActionButton testID={`${testIDPrefix}-transfer-act-only`} icon="file-document-edit-outline" label="Сформировать акт" onPress={() => setAction('act-only')} disabled={offline} tokens={tokens} />
            </>
          ) : null}
          {canDeleteEquipment && !multiple ? (
            <ActionButton testID={`${testIDPrefix}-delete`} icon="delete-outline" label="Удалить карточку" onPress={() => setAction('delete')} disabled={offline} tokens={tokens} destructive />
          ) : null}
        </View>
      ) : (
        <View style={styles.actionGrid}>
          {canWrite ? workKinds.map((kind) => (
            <ActionButton
              key={kind}
              testID={`native-equipment-record-work-${kind}`}
              icon={kind === 'cleaning' ? 'broom' : kind === 'battery' ? 'battery-sync-outline' : kind === 'cartridge' ? 'printer-pos-wrench-outline' : 'tools'}
              label={equipmentWorkKindLabel(kind)}
              onPress={() => setAction(kind)}
              disabled={offline}
              tokens={tokens}
            />
          )) : null}
        </View>
      )}

      <Modal visible={Boolean(action)} animationType="slide" presentationStyle="pageSheet" onRequestClose={close} accessibilityViewIsModal>
        <View style={[styles.modal, { backgroundColor: tokens.pageBg }]}> 
          <View style={[styles.modalHeader, { borderBottomColor: tokens.borderSoft }]}> 
            <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel="Закрыть операцию" onPress={close} style={styles.headerAction}>
              <Text style={[styles.headerText, { color: tokens.textSecondary }]}>Отмена</Text>
            </Pressable>
            <Text accessibilityRole="header" style={[styles.modalTitle, { color: tokens.textPrimary }]}>{actionTitle(action)}</Text>
            <View style={styles.headerAction} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}>
            <Text style={[styles.context, { color: tokens.textSecondary }]}>{multiple
              ? `Выбрано карточек: ${targetInvNos.length}`
              : `Инв. № ${equipment.inv_no} · ${equipment.model_name || equipment.type_name}`}</Text>
            {error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{error}</Text> : null}
            {notice ? <Text accessibilityLiveRegion="polite" style={[styles.notice, { color: tokens.textSecondary }]}>{notice}</Text> : null}

            {action === 'owner' ? <Field label="Новый сотрудник" value={employee} onChange={setEmployee} tokens={tokens} testID="native-transfer-employee" /> : null}
            {action === 'act-only' ? <Field label="Передал оборудование" value={issuer} onChange={setIssuer} tokens={tokens} testID="native-transfer-issuer" /> : null}
            {(action === 'owner' || action === 'location') ? (
              <>
                <ChoiceStrip label="Филиал" items={branches} selected={branchNo} onSelect={(value) => { setBranchNo(value); setLocationNo(null); }} tokens={tokens} />
                <ChoiceStrip label="Размещение" items={locations} selected={locationNo} onSelect={setLocationNo} tokens={tokens} />
              </>
            ) : null}
            {transferAction ? <Field label="Комментарий (необязательно)" value={comment} onChange={setComment} tokens={tokens} multiline /> : null}

            {(action === 'cartridge' || action === 'component') ? (
              <View style={styles.fieldGroup}>
                <Text style={[styles.label, { color: tokens.textSecondary }]}>Расходник со склада</Text>
                {consumables.length ? consumables.map((item) => {
                  const selected = item.id === selectedConsumable?.id;
                  return (
                    <Pressable
                      key={item.id}
                      testID={`native-work-consumable-${item.id}`}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      onPress={() => setSelectedConsumable(item)}
                      style={[styles.consumable, { backgroundColor: selected ? tokens.selected : tokens.panelSolid, borderColor: selected ? tokens.primary : tokens.border }]}
                    >
                      <Text style={[styles.consumableTitle, { color: tokens.textPrimary }]}>{item.model_name || item.type_name}</Text>
                      <Text style={[styles.consumableMeta, { color: tokens.textSecondary }]}>{item.qty} шт. · {item.location_name || 'без размещения'}</Text>
                    </Pressable>
                  );
                }) : <Text style={[styles.empty, { color: tokens.textSecondary }]}>Подходящие расходники с положительным остатком не найдены.</Text>}
              </View>
            ) : null}
            {action === 'component' ? <Field label="Тип компонента" value={componentType} onChange={setComponentType} tokens={tokens} testID="native-work-component-type" /> : null}

            {result?.acts.length ? (
              <View style={styles.resultActs}>
                <Text style={[styles.label, { color: tokens.textSecondary }]}>Сформированные документы</Text>
                {result.acts.map((act) => (
                  <Pressable
                    key={act.act_id}
                    testID={`native-transfer-act-${act.act_id}`}
                    disabled={Boolean(fileBusy)}
                    accessibilityRole="button"
                    accessibilityLabel={`Открыть ${act.file_name}`}
                    onPress={() => { void openAct(act); }}
                    style={[styles.fileButton, { borderColor: tokens.border }]}
                  >
                    {fileBusy === act.act_id ? <ActivityIndicator color={tokens.primary} /> : <MaterialCommunityIcons name="file-download-outline" size={20} color={tokens.primary} />}
                    <Text style={[styles.fileName, { color: tokens.textPrimary }]}>{act.file_name}</Text>
                  </Pressable>
                ))}
                <Text style={[styles.label, { color: tokens.textSecondary }]}>Отправить акты</Text>
                <View style={styles.emailModes}>
                  {(['old', 'new', 'manual'] as const).map((value) => {
                    const selected = emailMode === value;
                    return (
                      <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={() => setEmailMode(value)} style={[styles.emailMode, { backgroundColor: selected ? tokens.primary : tokens.panelSolid, borderColor: selected ? tokens.primary : tokens.border }]}> 
                        <Text style={[styles.emailModeText, { color: selected ? '#fff' : tokens.textPrimary }]}>{value === 'old' ? 'Предыдущему' : value === 'new' ? 'Новому' : 'Другой адрес'}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {emailMode === 'manual' ? <Field label="E-mail получателя" value={manualEmail} onChange={setManualEmail} tokens={tokens} testID="native-transfer-email" /> : null}
                <Pressable testID="native-transfer-email-send" accessibilityRole="button" accessibilityState={{ disabled: emailBusy }} disabled={emailBusy} onPress={() => { void sendActs(); }} style={[styles.secondary, { borderColor: tokens.primary }]}> 
                  {emailBusy ? <ActivityIndicator color={tokens.primary} /> : <Text style={[styles.secondaryText, { color: tokens.primary }]}>Отправить акты</Text>}
                </Pressable>
              </View>
            ) : null}

            {action === 'delete' ? (
              <View style={[styles.dangerBox, { backgroundColor: tokens.panelInset }]}> 
                <Text style={[styles.dangerTitle, { color: tokens.error }]}>Удалить карточку без возможности восстановления?</Text>
                <Text style={[styles.dangerText, { color: tokens.textSecondary }]}>Сервер отменит удаление, если с оборудованием связаны акты или история.</Text>
              </View>
            ) : null}

            {!result ? (
              <Pressable
                testID={`${testIDPrefix}-action-confirm`}
                accessibilityRole="button"
                accessibilityState={{ disabled: busy || offline }}
                disabled={busy || offline}
                onPress={() => { if (transferAction) void runTransfer(); else if (workAction) void runWork(); else void confirmDelete(); }}
                style={[styles.primary, { backgroundColor: action === 'delete' ? tokens.error : tokens.primary, opacity: busy || offline ? 0.55 : 1 }]}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{action === 'delete' ? 'Удалить' : 'Выполнить'}</Text>}
              </Pressable>
            ) : (
              <Pressable accessibilityRole="button" onPress={close} style={[styles.primary, { backgroundColor: tokens.primary }]}>
                <Text style={styles.primaryText}>Готово</Text>
              </Pressable>
            )}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

function ActionButton({ testID, icon, label, onPress, disabled, tokens, destructive = false }: {
  testID: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  onPress: () => void;
  disabled: boolean;
  tokens: FluentTokens;
  destructive?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.actionButton, {
        backgroundColor: destructive ? tokens.panelInset : tokens.panelSolid,
        borderColor: destructive ? tokens.error : tokens.border,
        opacity: disabled ? 0.5 : pressed ? 0.76 : 1,
      }]}
    >
      <MaterialCommunityIcons name={icon} size={21} color={destructive ? tokens.error : tokens.primary} />
      <Text style={[styles.actionLabel, { color: destructive ? tokens.error : tokens.textPrimary }]}>{label}</Text>
    </Pressable>
  );
}

function Field({ label, value, onChange, tokens, testID, multiline = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  tokens: FluentTokens;
  testID?: string;
  multiline?: boolean;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.label, { color: tokens.textSecondary }]}>{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        accessibilityLabel={label}
        placeholder={label}
        placeholderTextColor={tokens.textTertiary}
        style={[styles.input, multiline && styles.textarea, { color: tokens.textPrimary, backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}
      />
    </View>
  );
}

function actionTitle(action: ActionKind): string {
  if (action === 'owner') return 'Передача сотруднику';
  if (action === 'location') return 'Смена размещения';
  if (action === 'act-only') return 'Акт без перемещения';
  if (action === 'delete') return 'Удаление оборудования';
  return action ? equipmentWorkKindLabel(action) : 'Операция';
}

const styles = StyleSheet.create({
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginBottom: 10 },
  actionButton: { minHeight: 52, minWidth: '47%', flexGrow: 1, borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, flexDirection: 'row', gap: 8, alignItems: 'center' },
  actionLabel: { flex: 1, fontSize: 12, lineHeight: 16, fontWeight: '800' },
  modal: { flex: 1 },
  modalHeader: { minHeight: 58, borderBottomWidth: 1, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center' },
  headerAction: { width: 82, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  headerText: { fontSize: 13, fontWeight: '800' },
  modalTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '900' },
  modalContent: { padding: 16, paddingBottom: 40 },
  context: { marginBottom: 14, fontSize: 12, lineHeight: 17 },
  fieldGroup: { marginBottom: 14 },
  label: { marginBottom: 6, fontSize: 12, lineHeight: 16, fontWeight: '800' },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  textarea: { minHeight: 92, textAlignVertical: 'top' },
  choiceStrip: { gap: 8, paddingBottom: 2 },
  choice: { minHeight: 44, maxWidth: 260, borderWidth: 1, borderRadius: 22, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  choiceText: { fontSize: 12, fontWeight: '800' },
  error: { marginBottom: 10, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  notice: { marginBottom: 10, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  consumable: { minHeight: 62, borderWidth: 1, borderRadius: 12, padding: 11, marginBottom: 7 },
  consumableTitle: { fontSize: 13, fontWeight: '800' },
  consumableMeta: { marginTop: 3, fontSize: 11 },
  empty: { fontSize: 12, lineHeight: 17 },
  resultActs: { marginTop: 4, marginBottom: 14 },
  emailModes: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 10 },
  emailMode: { minHeight: 42, borderWidth: 1, borderRadius: 21, paddingHorizontal: 11, justifyContent: 'center' },
  emailModeText: { fontSize: 11, fontWeight: '800' },
  fileButton: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', gap: 9, alignItems: 'center', marginBottom: 7 },
  fileName: { flex: 1, fontSize: 12, fontWeight: '800' },
  dangerBox: { borderRadius: 14, padding: 14, marginBottom: 14 },
  dangerTitle: { fontSize: 14, lineHeight: 19, fontWeight: '900' },
  dangerText: { marginTop: 5, fontSize: 12, lineHeight: 17 },
  primary: { minHeight: 50, borderRadius: 13, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  primaryText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  secondary: { minHeight: 48, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 13, fontWeight: '900' },
});
