import { NativeModal as Modal } from '../ui/NativeModal';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useCallback, useEffect, useState } from 'react';
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
  commitUploadedEquipmentAct,
  parseUploadedEquipmentAct,
  type UploadedActCommitResult,
  type UploadedActDraft,
  type UploadedActFile,
} from '../../api/databaseApi';
import { formatApiError } from '../../api/formatError';
import {
  normalizeUploadedActInventoryInput,
  pickNativeDatabaseActPdf,
} from '../../database/nativeDatabaseActUpload';
import type { FluentTokens } from '../../theme/fluentTokens';

type DraftForm = {
  fromEmployee: string;
  toEmployee: string;
  docDate: string;
  inventoryText: string;
};

const EMPTY_FORM: DraftForm = {
  fromEmployee: '',
  toEmployee: '',
  docDate: '',
  inventoryText: '',
};

function responseStatus(error: unknown): number {
  if (!error || typeof error !== 'object') return 0;
  const response = (error as { response?: { status?: unknown } }).response;
  const status = Number(response?.status || 0);
  return Number.isFinite(status) ? status : 0;
}

export function NativeDatabaseActUploadModal({
  visible,
  databaseId,
  offline,
  tokens,
  onClose,
  onCommitted,
}: {
  visible: boolean;
  databaseId?: string;
  offline: boolean;
  tokens: FluentTokens;
  onClose: () => void;
  onCommitted: (message: string) => Promise<void> | void;
}) {
  const [file, setFile] = useState<UploadedActFile | null>(null);
  const [draft, setDraft] = useState<UploadedActDraft | null>(null);
  const [form, setForm] = useState<DraftForm>(EMPTY_FORM);
  const [verified, setVerified] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitRetryBlocked, setCommitRetryBlocked] = useState(false);
  const [result, setResult] = useState<UploadedActCommitResult | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const busy = parsing || committing;

  const reset = useCallback(() => {
    setFile(null);
    setDraft(null);
    setForm(EMPTY_FORM);
    setVerified(false);
    setParsing(false);
    setCommitting(false);
    setCommitRetryBlocked(false);
    setResult(null);
    setError('');
    setNotice('');
  }, []);

  useEffect(() => {
    if (!visible) reset();
  }, [reset, visible]);

  const close = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  const chooseFile = useCallback(async () => {
    if (busy || offline) return;
    setError('');
    try {
      const selected = await pickNativeDatabaseActPdf();
      if (!selected) return;
      setFile(selected);
      setDraft(null);
      setForm(EMPTY_FORM);
      setVerified(false);
      setCommitRetryBlocked(false);
      setResult(null);
      setNotice('PDF выбран. Запустите распознавание или создайте ручной черновик.');
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось выбрать PDF-файл акта.'));
    }
  }, [busy, offline]);

  const parse = useCallback(async (manualMode: boolean) => {
    if (!file || busy || offline) {
      if (!file) setError('Сначала выберите PDF-файл акта.');
      return;
    }
    setParsing(true);
    setError('');
    setNotice(manualMode ? 'Создаётся ручной черновик…' : 'PDF отправлен на распознавание. Это может занять до трёх минут…');
    try {
      const next = await parseUploadedEquipmentAct(file, { manualMode, databaseId });
      setDraft(next);
      setForm({
        fromEmployee: next.from_employee,
        toEmployee: next.to_employee,
        docDate: next.doc_date || '',
        inventoryText: next.equipment_inv_nos.join(', '),
      });
      setVerified(false);
      setCommitRetryBlocked(false);
      setNotice(manualMode
        ? 'Ручной черновик создан. Заполните реквизиты и проверьте инвентарные номера.'
        : 'PDF распознан. Проверьте реквизиты и инвентарные номера.');
    } catch (cause) {
      setError(formatApiError(cause, manualMode
        ? 'Не удалось создать ручной черновик акта.'
        : 'Не удалось распознать PDF. Можно попробовать ручной черновик.'));
      setNotice('');
    } finally {
      setParsing(false);
    }
  }, [busy, databaseId, file, offline]);

  const updateForm = useCallback((key: keyof DraftForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === 'inventoryText') setVerified(false);
  }, []);

  const commit = useCallback(async () => {
    if (!draft || busy || offline || commitRetryBlocked) return;
    const inventoryNumbers = normalizeUploadedActInventoryInput(form.inventoryText);
    if (!inventoryNumbers.length) {
      setError('Укажите хотя бы один числовой инвентарный номер.');
      return;
    }
    if (!verified) {
      setError('Подтвердите, что инвентарные номера сверены с PDF.');
      return;
    }
    setCommitting(true);
    setCommitRetryBlocked(true);
    setError('');
    setNotice('Акт записывается в базу…');
    try {
      const next = await commitUploadedEquipmentAct({
        draft_id: draft.draft_id,
        from_employee: form.fromEmployee,
        to_employee: form.toEmployee,
        doc_date: form.docDate,
        equipment_inv_nos: inventoryNumbers,
      }, databaseId);
      setResult(next);
      setNotice('');
      await onCommitted(next.message || `Акт ${next.doc_number || next.doc_no} записан.`);
    } catch (cause) {
      const status = responseStatus(cause);
      const validationFailure = status === 400 || status === 422;
      if (validationFailure) setCommitRetryBlocked(false);
      setError(validationFailure
        ? formatApiError(cause, 'Проверьте реквизиты акта и повторите запись.')
        : `${formatApiError(cause, 'Не удалось подтвердить результат записи акта.')} Не повторяйте запись: обновите список актов и проверьте результат.`);
      setNotice('');
    } finally {
      setCommitting(false);
    }
  }, [busy, commitRetryBlocked, databaseId, draft, form, offline, onCommitted, verified]);

  const canCommit = Boolean(draft)
    && normalizeUploadedActInventoryInput(form.inventoryText).length > 0
    && verified
    && !busy
    && !offline
    && !commitRetryBlocked;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close} accessibilityViewIsModal>
      <View style={[styles.modal, { backgroundColor: tokens.pageBg }]}> 
        <View style={[styles.header, { borderBottomColor: tokens.borderSoft }]}> 
          <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel="Закрыть загрузку акта" onPress={close} style={styles.headerAction}>
            <Text style={[styles.headerText, { color: tokens.textSecondary }]}>Отмена</Text>
          </Pressable>
          <Text accessibilityRole="header" style={[styles.title, { color: tokens.textPrimary }]}>Подписанный акт</Text>
          <View style={styles.headerAction} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          {offline ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.warning }]}>Загрузка акта недоступна без сети.</Text> : null}
          {error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{error}</Text> : null}
          {notice ? <Text accessibilityLiveRegion="polite" style={[styles.notice, { color: tokens.textSecondary }]}>{notice}</Text> : null}

          {!result ? (
            <>
              <Pressable
                testID="native-database-act-pick"
                disabled={busy || offline}
                accessibilityRole="button"
                accessibilityState={{ disabled: busy || offline }}
                onPress={() => { void chooseFile(); }}
                style={[styles.fileButton, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}
              >
                <MaterialCommunityIcons name="file-pdf-box" size={25} color={tokens.primary} />
                <View style={styles.fileBody}>
                  <Text numberOfLines={1} style={[styles.fileName, { color: tokens.textPrimary }]}>{file?.name || 'Выбрать PDF-акт'}</Text>
                  <Text style={[styles.fileMeta, { color: tokens.textSecondary }]}>{file ? `${(file.size / (1024 * 1024)).toFixed(1)} МБ` : 'До 15 МБ'}</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={22} color={tokens.iconMuted} />
              </Pressable>

              {file && !draft ? (
                <View style={styles.parseActions}>
                  <Pressable testID="native-database-act-parse" disabled={busy || offline} accessibilityRole="button" accessibilityState={{ disabled: busy || offline }} onPress={() => { void parse(false); }} style={[styles.primary, { backgroundColor: tokens.primary }]}>
                    {parsing ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Распознать PDF</Text>}
                  </Pressable>
                  <Pressable testID="native-database-act-manual" disabled={busy || offline} accessibilityRole="button" accessibilityState={{ disabled: busy || offline }} onPress={() => { void parse(true); }} style={[styles.secondary, { borderColor: tokens.primary }]}>
                    <Text style={[styles.secondaryText, { color: tokens.primary }]}>Ручной черновик</Text>
                  </Pressable>
                </View>
              ) : null}

              {draft ? (
                <View style={styles.form}>
                  <Text style={[styles.sectionTitle, { color: tokens.textPrimary }]}>Проверьте данные акта</Text>
                  <Field label="Передал" value={form.fromEmployee} onChange={(value) => updateForm('fromEmployee', value)} tokens={tokens} testID="native-database-act-from" />
                  <Field label="Получил" value={form.toEmployee} onChange={(value) => updateForm('toEmployee', value)} tokens={tokens} testID="native-database-act-to" />
                  <Field label="Дата и время" value={form.docDate} onChange={(value) => updateForm('docDate', value)} tokens={tokens} testID="native-database-act-date" />
                  <Field label="Инвентарные номера" value={form.inventoryText} onChange={(value) => updateForm('inventoryText', value)} tokens={tokens} testID="native-database-act-inventory" multiline />

                  {draft.resolved_items.length ? (
                    <View style={[styles.resolved, { backgroundColor: tokens.panelInset }]}> 
                      <Text style={[styles.resolvedTitle, { color: tokens.textPrimary }]}>Найдено карточек: {draft.resolved_items.length}</Text>
                      {draft.resolved_items.slice(0, 20).map((item) => (
                        <Text key={`${item.item_id}:${item.inv_no}`} style={[styles.resolvedItem, { color: tokens.textSecondary }]}>№ {item.inv_no} · {item.model_name || item.serial_no || `ID ${item.item_id}`}</Text>
                      ))}
                    </View>
                  ) : null}
                  {draft.warnings.map((warning, index) => (
                    <Text key={`${index}:${warning}`} accessibilityRole="alert" style={[styles.warning, { color: tokens.warning }]}>{warning}</Text>
                  ))}

                  <Pressable
                    testID="native-database-act-verify"
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: verified, disabled: busy || commitRetryBlocked }}
                    disabled={busy || commitRetryBlocked}
                    onPress={() => setVerified((value) => !value)}
                    style={[styles.verify, { borderColor: verified ? tokens.primary : tokens.border, backgroundColor: verified ? tokens.selected : tokens.panelSolid }]}
                  >
                    <MaterialCommunityIcons name={verified ? 'checkbox-marked-circle-outline' : 'checkbox-blank-circle-outline'} size={23} color={verified ? tokens.primary : tokens.iconMuted} />
                    <Text style={[styles.verifyText, { color: tokens.textPrimary }]}>Я сверил итоговые инвентарные номера с PDF</Text>
                  </Pressable>

                  <Pressable testID="native-database-act-commit" disabled={!canCommit} accessibilityRole="button" accessibilityState={{ disabled: !canCommit, busy: committing }} onPress={() => { void commit(); }} style={[styles.commit, { backgroundColor: tokens.primary, opacity: canCommit ? 1 : 0.5 }]}>
                    {committing ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Записать акт</Text>}
                  </Pressable>
                </View>
              ) : null}
            </>
          ) : (
            <View style={[styles.success, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}> 
              <MaterialCommunityIcons name="check-circle-outline" size={42} color={tokens.success} />
              <Text accessibilityRole="header" style={[styles.successTitle, { color: tokens.textPrimary }]}>Акт записан</Text>
              <Text style={[styles.successMeta, { color: tokens.textSecondary }]}>№ {result.doc_number || result.doc_no} · DOC_NO {result.doc_no} · FILE_NO {result.file_no}</Text>
              <Text style={[styles.successMeta, { color: tokens.textSecondary }]}>Связано карточек: {result.linked_inv_nos.length}</Text>
              {result.reminder_warning ? <Text accessibilityRole="alert" style={[styles.warning, { color: tokens.warning }]}>{result.reminder_warning}</Text> : null}
              <Pressable testID="native-database-act-done" accessibilityRole="button" onPress={onClose} style={[styles.commit, { backgroundColor: tokens.primary }]}>
                <Text style={styles.primaryText}>Готово</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Field({ label, value, onChange, tokens, testID, multiline = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  tokens: FluentTokens;
  testID: string;
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

const styles = StyleSheet.create({
  modal: { flex: 1 },
  header: { minHeight: 58, borderBottomWidth: 1, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center' },
  headerAction: { width: 82, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  headerText: { fontSize: 13, fontWeight: '800' },
  title: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '900' },
  content: { padding: 16, paddingBottom: 40 },
  error: { marginBottom: 10, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  notice: { marginBottom: 10, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  fileButton: { minHeight: 70, borderWidth: 1, borderRadius: 14, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 11 },
  fileBody: { flex: 1, minWidth: 0 },
  fileName: { fontSize: 14, fontWeight: '900' },
  fileMeta: { marginTop: 3, fontSize: 11 },
  parseActions: { marginTop: 12, gap: 9 },
  primary: { minHeight: 50, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  secondary: { minHeight: 48, borderWidth: 1, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 13, fontWeight: '900' },
  form: { marginTop: 18 },
  sectionTitle: { marginBottom: 13, fontSize: 17, fontWeight: '900' },
  fieldGroup: { marginBottom: 13 },
  label: { marginBottom: 6, fontSize: 12, fontWeight: '800' },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  textarea: { minHeight: 92, textAlignVertical: 'top' },
  resolved: { marginBottom: 12, borderRadius: 13, padding: 12 },
  resolvedTitle: { marginBottom: 6, fontSize: 12, fontWeight: '900' },
  resolvedItem: { fontSize: 11, lineHeight: 17 },
  warning: { marginBottom: 8, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  verify: { minHeight: 58, borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  verifyText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  commit: { minHeight: 50, marginTop: 13, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  success: { borderWidth: 1, borderRadius: 18, padding: 20, alignItems: 'center' },
  successTitle: { marginTop: 10, fontSize: 20, fontWeight: '900' },
  successMeta: { marginTop: 6, textAlign: 'center', fontSize: 12, lineHeight: 18 },
});
