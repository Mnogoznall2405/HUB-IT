import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { formatApiError } from '../../api/formatError';
import {
  createMailTemplate,
  deleteMailTemplate,
  listMailTemplates,
  updateMailTemplate,
  type MailItTemplate,
} from '../../api/mailApi';
import { useAuth } from '../../auth/AuthContext';
import {
  TEMPLATE_FIELD_TYPES,
  buildTemplateEditorPreview,
  buildTemplateEditorState,
  buildTemplatePayload,
  buildTemplateVariableHints,
  makeTemplateField,
  normalizeTemplateFieldKey,
  normalizeTemplateFieldOptions,
  type MailTemplateEditorField,
  type MailTemplateEditorState,
} from '../../mail/nativeMailTemplates';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens, type FluentTokens } from '../../theme/fluentTokens';
import { AccountScreenScaffold, AccountSectionCard } from '../account/AccountChrome';
import { goBackOrReplace } from '../account/accountBack';

function templateRowId(item: MailItTemplate): string {
  return String(item.id || '').trim();
}

function templateInactive(item: MailItTemplate): boolean {
  // The store reports is_active as a real boolean on Postgres but as a 0/1
  // integer on the legacy SQLite runtime — treat both falsy shapes the same.
  return item.is_active === false || item.is_active === 0;
}

function requiredFieldsCount(item: MailItTemplate): number {
  return (Array.isArray(item.fields) ? item.fields : []).filter((field) => Boolean(field?.required ?? true)).length;
}

export function NativeMailTemplatesScreen() {
  const { user, hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const accent = tokens.scheme === 'dark' ? tokens.primaryLight : tokens.primary;
  const allowed = hasPermission('settings.users.manage');
  const requestRef = useRef(0);
  // Same stale-drop rule as the inbox IT-request flow: when the signed-in user
  // or the manage permission flips mid-flight, late results are discarded.
  const scope = `${user?.id ?? ''}|${allowed ? '1' : '0'}`;
  const scopeRef = useRef(scope);
  useEffect(() => {
    scopeRef.current = scope;
    requestRef.current += 1;
  }, [scope]);
  const savingRef = useRef(false);
  const deletingRef = useRef(false);
  const [templates, setTemplates] = useState<MailItTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [editor, setEditor] = useState<MailTemplateEditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    const lease = ++requestRef.current;
    if (offlineMode || !allowed) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const items = await listMailTemplates({ include_inactive: true });
      if (lease !== requestRef.current) return;
      setTemplates(items);
    } catch (cause) {
      if (lease !== requestRef.current) return;
      setError(formatApiError(cause, 'Не удалось загрузить шаблоны IT-заявок.'));
    } finally {
      if (lease === requestRef.current) setLoading(false);
    }
    // user?.id is a dependency on purpose: a user switch with the permission
    // still granted must drop the previous user's list and refetch.
  }, [allowed, offlineMode, user?.id]);

  useEffect(() => {
    void load();
    return () => { requestRef.current += 1; };
  }, [load]);

  const startCreate = useCallback(() => {
    setError('');
    setStatus('');
    setEditor(buildTemplateEditorState(null));
  }, []);

  const startEdit = useCallback((template: MailItTemplate) => {
    setError('');
    setStatus('');
    setEditor(buildTemplateEditorState(template));
  }, []);

  const updateEditor = useCallback((patch: Partial<MailTemplateEditorState>) => {
    setEditor((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const updateField = useCallback((index: number, patch: Partial<MailTemplateEditorField>) => {
    setEditor((current) => current ? {
      ...current,
      fields: current.fields.map((field, itemIndex) => (itemIndex === index ? { ...field, ...patch } : field)),
    } : current);
  }, []);

  const addField = useCallback(() => {
    setEditor((current) => current ? { ...current, fields: [...current.fields, makeTemplateField(current.fields.length)] } : current);
  }, []);

  const moveField = useCallback((index: number, direction: number) => {
    setEditor((current) => {
      if (!current) return current;
      const to = index + direction;
      if (index < 0 || to < 0 || index >= current.fields.length || to >= current.fields.length) return current;
      const fields = [...current.fields];
      [fields[index], fields[to]] = [fields[to], fields[index]];
      return { ...current, fields };
    });
  }, []);

  const removeField = useCallback((index: number) => {
    setEditor((current) => current ? { ...current, fields: current.fields.filter((_, itemIndex) => itemIndex !== index) } : current);
  }, []);

  const variableHints = useMemo(() => (editor ? buildTemplateVariableHints(editor.fields) : []), [editor]);
  const editorPreview = useMemo(
    () => (editor ? buildTemplateEditorPreview({ subject: editor.subject, body: editor.body, fields: editor.fields }) : ''),
    [editor],
  );

  const deleteTemplate = useCallback(async () => {
    const editId = editor?.editId || '';
    if (!editId || savingRef.current || deletingRef.current || saving || deleting || offlineMode) return;
    deletingRef.current = true;
    setDeleting(true);
    setError('');
    setStatus('');
    const requestScope = scope;
    try {
      await deleteMailTemplate(editId);
      if (requestScope !== scopeRef.current) return;
      await load();
      if (requestScope !== scopeRef.current) return;
      // Web: startCreateTemplate() — the dialog falls back to an empty editor.
      setEditor(buildTemplateEditorState(null));
      setStatus('Шаблон деактивирован.');
    } catch (cause) {
      if (requestScope !== scopeRef.current) return;
      setError(formatApiError(cause, 'Не удалось удалить шаблон.'));
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }, [deleting, editor?.editId, load, offlineMode, saving, scope]);

  const confirmDelete = useCallback(() => {
    const editId = editor?.editId || '';
    if (!editId || saving || deleting || offlineMode) return;
    const label = editor?.title || editor?.code || 'Без названия';
    Alert.alert(
      `Удалить шаблон «${label}»?`,
      'Шаблон будет деактивирован и больше не будет предлагаться при создании заявок.',
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Удалить', style: 'destructive', onPress: () => { void deleteTemplate(); } },
      ],
    );
  }, [deleting, deleteTemplate, editor?.code, editor?.editId, editor?.title, offlineMode, saving]);

  const saveTemplate = useCallback(async () => {
    if (!editor) return;
    const { error: validationError, payload } = buildTemplatePayload({
      code: editor.code,
      title: editor.title,
      category: editor.category,
      subject: editor.subject,
      body: editor.body,
      fields: editor.fields,
    });
    if (validationError || !payload) {
      setError(validationError || 'Не удалось сохранить шаблон.');
      setStatus('');
      return;
    }
    if (savingRef.current || deletingRef.current || saving || deleting || offlineMode) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    setStatus('');
    const requestScope = scope;
    const editId = editor.editId;
    try {
      const saved = editId
        ? await updateMailTemplate(editId, payload)
        : await createMailTemplate(payload);
      if (requestScope !== scopeRef.current) return;
      // Web order: refreshTemplates() then startEditTemplate(saved).
      await load();
      if (requestScope !== scopeRef.current) return;
      setEditor(buildTemplateEditorState(saved));
      setStatus(editId ? 'Шаблон обновлен.' : 'Шаблон создан.');
    } catch (cause) {
      if (requestScope !== scopeRef.current) return;
      setError(formatApiError(cause, 'Не удалось сохранить шаблон.'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [deleting, editor, load, offlineMode, saving, scope]);

  if (!allowed) {
    return (
      <AccountScreenScaffold title="Шаблоны IT-заявок" tokens={tokens} onBack={() => goBackOrReplace('/(shell)/mail/settings')}>
        <View testID="native-mail-templates-screen">
          <AccountSectionCard tokens={tokens} title="Нет доступа" description="Нужно право settings.users.manage.">{null}</AccountSectionCard>
        </View>
      </AccountScreenScaffold>
    );
  }

  if (editor) {
    const mutationBusy = saving || deleting;
    return (
      <AccountScreenScaffold
        title={editor.editId ? 'Шаблон заявки' : 'Новый шаблон'}
        tokens={tokens}
        onBack={() => setEditor(null)}
      >
        <View testID="native-mail-templates-screen" style={styles.content}>
          {offlineMode ? <Text accessibilityRole="alert" style={[styles.warning, { color: tokens.warning }]}>Автономный режим: изменения не сохранятся.</Text> : null}
          {error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{error}</Text> : null}
          {status ? <Text accessibilityLiveRegion="polite" style={[styles.success, { color: tokens.success }]}>{status}</Text> : null}
          <AccountSectionCard tokens={tokens} title="Шаблон">
            <EditorInput testID="native-mail-template-code" label="Код" value={editor.code} tokens={tokens} onChangeText={(code) => updateEditor({ code })} />
            <EditorInput testID="native-mail-template-title" label="Название" value={editor.title} tokens={tokens} onChangeText={(title) => updateEditor({ title })} />
            <EditorInput testID="native-mail-template-category" label="Категория" value={editor.category} tokens={tokens} onChangeText={(category) => updateEditor({ category })} />
            <EditorInput testID="native-mail-template-subject" label="Шаблон темы" value={editor.subject} tokens={tokens} onChangeText={(subject) => updateEditor({ subject })} />
            <EditorInput testID="native-mail-template-body" label="Текст шаблона" value={editor.body} tokens={tokens} multiline onChangeText={(body) => updateEditor({ body })} />
          </AccountSectionCard>

          <AccountSectionCard tokens={tokens} title="Поля формы">
            {editor.fields.map((field, index) => (
              <TemplateFieldEditor
                // Index key on purpose: the card is fully controlled, and keying by
                // field.key would remount the card (and drop keyboard focus) on
                // every normalized keystroke in the «Ключ» input.
                key={index}
                index={index}
                field={field}
                fieldsCount={editor.fields.length}
                disabled={mutationBusy}
                tokens={tokens}
                accent={accent}
                onUpdate={(patch) => updateField(index, patch)}
                onMove={(direction) => moveField(index, direction)}
                onRemove={() => removeField(index)}
              />
            ))}
            <Pressable
              testID="native-mail-template-field-add"
              accessibilityRole="button"
              accessibilityLabel="Добавить поле"
              accessibilityState={{ disabled: mutationBusy }}
              disabled={mutationBusy}
              onPress={addField}
              style={({ pressed }) => [styles.addField, { borderColor: tokens.borderSoft, backgroundColor: tokens.panelInset, opacity: mutationBusy ? 0.5 : pressed ? 0.8 : 1 }]}
            >
              <MaterialCommunityIcons name="plus" size={20} color={accent} />
              <Text style={[styles.addFieldText, { color: accent }]}>Добавить поле</Text>
            </Pressable>
          </AccountSectionCard>

          {variableHints.length ? (
            <AccountSectionCard tokens={tokens} title="Доступные переменные">
              <View testID="native-mail-template-hints" style={styles.hintRow}>
                {variableHints.map((variable) => (
                  <View key={variable} style={[styles.hintChip, { borderColor: tokens.borderSoft, backgroundColor: tokens.panelInset }]}>
                    <Text style={[styles.hintText, { color: tokens.textSecondary }]}>{`{{${variable}}}`}</Text>
                  </View>
                ))}
              </View>
            </AccountSectionCard>
          ) : null}

          <AccountSectionCard tokens={tokens} title="Предпросмотр шаблона">
            <Text testID="native-mail-template-preview" style={[styles.previewText, { color: tokens.textPrimary }]}>{editorPreview || 'Предпросмотр появится после заполнения шаблона.'}</Text>
          </AccountSectionCard>

          <View style={styles.footerActions}>
            {editor.editId ? (
              <Pressable
                testID="native-mail-template-delete"
                accessibilityRole="button"
                accessibilityLabel="Удалить шаблон"
                accessibilityState={{ disabled: mutationBusy || offlineMode, busy: deleting }}
                disabled={mutationBusy || offlineMode}
                onPress={confirmDelete}
                style={({ pressed }) => [styles.deleteButton, { borderColor: tokens.error, opacity: mutationBusy || offlineMode ? 0.5 : pressed ? 0.8 : 1 }]}
              >
                {deleting ? <ActivityIndicator color={tokens.error} /> : <Text style={[styles.deleteButtonText, { color: tokens.error }]}>Удалить</Text>}
              </Pressable>
            ) : null}
            <Pressable
              testID="native-mail-template-save"
              accessibilityRole="button"
              accessibilityLabel="Сохранить шаблон"
              accessibilityState={{ disabled: mutationBusy || offlineMode, busy: saving }}
              disabled={mutationBusy || offlineMode}
              onPress={() => { void saveTemplate(); }}
              style={({ pressed }) => [styles.saveButton, { backgroundColor: tokens.primary, opacity: mutationBusy || offlineMode ? 0.5 : pressed ? 0.88 : 1 }]}
            >
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>Сохранить</Text>}
            </Pressable>
          </View>
        </View>
      </AccountScreenScaffold>
    );
  }

  return (
    <AccountScreenScaffold
      title="Шаблоны IT-заявок"
      tokens={tokens}
      onBack={() => goBackOrReplace('/(shell)/mail/settings')}
      refreshing={loading}
      onRefresh={() => { void load(); }}
    >
      <View testID="native-mail-templates-screen" style={styles.content}>
        {offlineMode ? <Text accessibilityRole="alert" style={[styles.warning, { color: tokens.warning }]}>Автономный режим: управление шаблонами недоступно.</Text> : null}
        {error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{error}</Text> : null}
        {status ? <Text accessibilityLiveRegion="polite" style={[styles.success, { color: tokens.success }]}>{status}</Text> : null}
        <Pressable
          testID="native-mail-template-create"
          accessibilityRole="button"
          accessibilityLabel="Новый шаблон"
          accessibilityState={{ disabled: offlineMode }}
          disabled={offlineMode}
          onPress={startCreate}
          style={({ pressed }) => [styles.createButton, { backgroundColor: tokens.primary, opacity: offlineMode ? 0.5 : pressed ? 0.88 : 1 }]}
        >
          <MaterialCommunityIcons name="file-plus-outline" size={20} color="#fff" />
          <Text style={styles.createButtonText}>Новый шаблон</Text>
        </Pressable>
        {loading && !templates.length ? <View style={styles.loading}><ActivityIndicator color={tokens.primary} /></View> : null}
        {!loading && !templates.length ? (
          <AccountSectionCard tokens={tokens} title="Шаблонов нет" description="Создайте первый шаблон, чтобы заявки в IT отправлялись по готовой форме.">{null}</AccountSectionCard>
        ) : null}
        <View style={styles.rows}>
          {templates.map((item) => {
            const id = templateRowId(item);
            if (!id) return null;
            const title = String(item.title || item.code || '').trim() || 'Без названия';
            const meta = [
              String(item.code || '').trim(),
              String(item.category || '').trim(),
              `Обязательных полей: ${requiredFieldsCount(item)}`,
            ].filter(Boolean).join(' · ');
            return (
              <Pressable
                key={id}
                testID={`native-mail-template-row-${id}`}
                accessibilityRole="button"
                accessibilityLabel={`Шаблон ${title}${templateInactive(item) ? ', неактивен' : ''}`}
                onPress={() => startEdit(item)}
                style={({ pressed }) => [styles.row, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft, opacity: pressed ? 0.8 : 1 }]}
              >
                <MaterialCommunityIcons name="file-document-outline" size={24} color={tokens.iconMuted} />
                <View style={styles.rowText}>
                  <Text numberOfLines={2} style={[styles.rowTitle, { color: tokens.textPrimary }]}>{title}</Text>
                  <Text numberOfLines={2} style={[styles.rowMeta, { color: tokens.textSecondary }]}>{meta}</Text>
                </View>
                {templateInactive(item) ? (
                  <View style={[styles.inactiveBadge, { borderColor: tokens.warning }]}>
                    <Text style={[styles.inactiveBadgeText, { color: tokens.warning }]}>неактивен</Text>
                  </View>
                ) : null}
                <MaterialCommunityIcons name="chevron-right" size={20} color={tokens.iconMuted} />
              </Pressable>
            );
          })}
        </View>
      </View>
    </AccountScreenScaffold>
  );
}

function EditorInput({ testID, label, value, multiline = false, tokens, onChangeText }: {
  testID: string;
  label: string;
  value: string;
  multiline?: boolean;
  tokens: FluentTokens;
  onChangeText: (value: string) => void;
}) {
  return (
    <View style={styles.inputBlock}>
      <Text style={[styles.inputLabel, { color: tokens.textSecondary }]}>{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        accessibilityLabel={label}
        placeholderTextColor={tokens.textTertiary}
        style={[styles.input, multiline ? styles.inputMultiline : null, { color: tokens.textPrimary, borderColor: tokens.borderSoft, backgroundColor: tokens.panelInset }]}
      />
    </View>
  );
}

function TemplateFieldEditor({ index, field, fieldsCount, disabled, tokens, accent, onUpdate, onMove, onRemove }: {
  index: number;
  field: MailTemplateEditorField;
  fieldsCount: number;
  disabled: boolean;
  tokens: FluentTokens;
  accent: string;
  onUpdate: (patch: Partial<MailTemplateEditorField>) => void;
  onMove: (direction: number) => void;
  onRemove: () => void;
}) {
  const fieldType = String(field?.type || 'text');
  const supportsOptions = fieldType === 'select' || fieldType === 'multiselect';
  const optionsText = normalizeTemplateFieldOptions(field?.options).join('\n');
  return (
    <View style={[styles.fieldCard, { borderColor: tokens.borderSoft, backgroundColor: tokens.panelInset }]}>
      <View style={styles.fieldHeader}>
        <Text style={[styles.fieldHeaderText, { color: tokens.textSecondary }]}>{`Поле #${index + 1}`}</Text>
        <View style={styles.fieldHeaderActions}>
          <Pressable
            testID={`native-mail-template-field-${index}-up`}
            accessibilityRole="button"
            accessibilityLabel="Выше"
            accessibilityState={{ disabled: disabled || index === 0 }}
            disabled={disabled || index === 0}
            onPress={() => onMove(-1)}
            style={({ pressed }) => [styles.fieldIconButton, { opacity: disabled || index === 0 ? 0.4 : pressed ? 0.7 : 1 }]}
          >
            <MaterialCommunityIcons name="arrow-up" size={20} color={tokens.iconMuted} />
          </Pressable>
          <Pressable
            testID={`native-mail-template-field-${index}-down`}
            accessibilityRole="button"
            accessibilityLabel="Ниже"
            accessibilityState={{ disabled: disabled || index === fieldsCount - 1 }}
            disabled={disabled || index === fieldsCount - 1}
            onPress={() => onMove(1)}
            style={({ pressed }) => [styles.fieldIconButton, { opacity: disabled || index === fieldsCount - 1 ? 0.4 : pressed ? 0.7 : 1 }]}
          >
            <MaterialCommunityIcons name="arrow-down" size={20} color={tokens.iconMuted} />
          </Pressable>
          <Pressable
            testID={`native-mail-template-field-${index}-remove`}
            accessibilityRole="button"
            accessibilityLabel="Удалить поле"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={onRemove}
            style={({ pressed }) => [styles.fieldIconButton, { opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }]}
          >
            <MaterialCommunityIcons name="trash-can-outline" size={20} color={tokens.error} />
          </Pressable>
        </View>
      </View>

      <EditorInput
        testID={`native-mail-template-field-${index}-key`}
        label="Ключ"
        value={field?.key || ''}
        tokens={tokens}
        onChangeText={(value) => onUpdate({ key: normalizeTemplateFieldKey(value) })}
      />
      <EditorInput
        testID={`native-mail-template-field-${index}-label`}
        label="Название поля"
        value={field?.label || ''}
        tokens={tokens}
        onChangeText={(value) => onUpdate({ label: value })}
      />

      <Text style={[styles.inputLabel, { color: tokens.textSecondary }]}>Тип</Text>
      <View testID={`native-mail-template-field-${index}-type`} style={styles.typeRow}>
        {TEMPLATE_FIELD_TYPES.map((typeItem) => {
          const selected = fieldType === typeItem.value;
          return (
            <Pressable
              key={typeItem.value}
              testID={`native-mail-template-field-${index}-type-${typeItem.value}`}
              accessibilityRole="button"
              accessibilityLabel={`Тип поля: ${typeItem.label}`}
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              onPress={() => onUpdate({ type: typeItem.value })}
              style={({ pressed }) => [styles.typeChip, {
                backgroundColor: selected ? tokens.selected : tokens.panelSolid,
                borderColor: selected ? tokens.selectedBorder : tokens.borderSoft,
                opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
              }]}
            >
              <Text style={[styles.typeChipText, { color: selected ? accent : tokens.textSecondary }]}>{typeItem.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <EditorInput
        testID={`native-mail-template-field-${index}-placeholder`}
        label="Подсказка"
        value={field?.placeholder || ''}
        tokens={tokens}
        onChangeText={(value) => onUpdate({ placeholder: value })}
      />
      <EditorInput
        testID={`native-mail-template-field-${index}-default`}
        label="Значение по умолчанию"
        value={Array.isArray(field?.default_value) ? field.default_value.join(', ') : String(field?.default_value ?? '')}
        tokens={tokens}
        multiline={fieldType === 'textarea'}
        onChangeText={(value) => onUpdate({ default_value: value })}
      />

      <Pressable
        testID={`native-mail-template-field-${index}-required`}
        accessibilityRole="switch"
        accessibilityLabel="Обязательное поле"
        accessibilityState={{ checked: Boolean(field?.required ?? true), disabled }}
        disabled={disabled}
        onPress={() => onUpdate({ required: !Boolean(field?.required ?? true) })}
        style={({ pressed }) => [styles.requiredRow, { opacity: disabled ? 0.5 : pressed ? 0.75 : 1 }]}
      >
        <Text style={[styles.requiredLabel, { color: tokens.textPrimary }]}>Обязательное поле</Text>
        <Switch
          pointerEvents="none"
          accessible={false}
          disabled={disabled}
          value={Boolean(field?.required ?? true)}
          trackColor={{ false: tokens.border, true: tokens.primary }}
        />
      </Pressable>

      {supportsOptions ? (
        <EditorInput
          testID={`native-mail-template-field-${index}-options`}
          label="Опции (каждая с новой строки)"
          value={optionsText}
          tokens={tokens}
          multiline
          onChangeText={(value) => onUpdate({ options: normalizeTemplateFieldOptions(value) })}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 10 },
  warning: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  error: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  success: { fontSize: 12, lineHeight: 17, fontWeight: '800' },
  createButton: { minHeight: 48, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  createButtonText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  loading: { minHeight: 200, alignItems: 'center', justifyContent: 'center' },
  rows: { gap: 8 },
  row: { minHeight: 64, borderWidth: 1, borderRadius: 14, paddingLeft: 12, paddingRight: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowText: { flex: 1, minWidth: 0, paddingVertical: 10 },
  rowTitle: { fontSize: 13, lineHeight: 18, fontWeight: '900' },
  rowMeta: { marginTop: 3, fontSize: 11, lineHeight: 15 },
  inactiveBadge: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 3 },
  inactiveBadgeText: { fontSize: 10, lineHeight: 13, fontWeight: '800' },
  inputBlock: { marginBottom: 10 },
  inputLabel: { fontSize: 12, fontWeight: '700', marginBottom: 4 },
  input: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, fontSize: 14, textAlignVertical: 'center' },
  inputMultiline: { minHeight: 96, paddingTop: 10, paddingBottom: 10, textAlignVertical: 'top' },
  fieldCard: { borderWidth: 1, borderRadius: 12, padding: 10, marginBottom: 10, gap: 2 },
  fieldHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldHeaderText: { fontSize: 12, fontWeight: '800' },
  fieldHeaderActions: { flexDirection: 'row', alignItems: 'center' },
  fieldIconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  typeChip: { minHeight: 44, borderWidth: 1, borderRadius: 22, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  typeChipText: { fontSize: 12, fontWeight: '800' },
  requiredRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  requiredLabel: { fontSize: 13, fontWeight: '700' },
  addField: { minHeight: 48, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  addFieldText: { fontSize: 13, fontWeight: '900' },
  hintRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  hintChip: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 9, paddingVertical: 4 },
  hintText: { fontSize: 11, fontWeight: '700' },
  previewText: { fontSize: 13, lineHeight: 19 },
  footerActions: { flexDirection: 'row', gap: 8, marginTop: 2 },
  saveButton: { flex: 1, minHeight: 48, borderRadius: 13, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  saveButtonText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  deleteButton: { minHeight: 48, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  deleteButtonText: { fontSize: 14, fontWeight: '900' },
});
