import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  createDocflowAssignment,
  getDocflowAssignmentCapability,
  getDocflowAssignmentCommand,
  searchDocflowAssignmentAssignees,
  searchDocflowAssignmentDocuments,
  type DocflowAssignmentAssignee,
  type DocflowAssignmentCommand,
  type DocflowAssignmentDocument,
} from '../../api/docflowApi';
import { useAuth } from '../../auth/AuthContext';
import { HubTextField } from '../../components/ui/HubTextField';
import { resolveNativeDocflowError } from '../../docflow/docflowError';
import {
  buildDocflowAssignmentDueAt,
  defaultDocflowAssignmentDueFields,
} from '../../docflow/nativeDocflowModel';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens, type FluentTokens } from '../../theme/fluentTokens';
import {
  AccountLoading,
  AccountPrimaryButton,
  AccountScreenScaffold,
  AccountSecondaryButton,
  AccountSectionCard,
} from '../account/AccountChrome';
import { goBackOrReplace } from '../account/accountBack';

type CreateAttempt = { signature: string; key: string };

function createIdempotencyKey(): string {
  return Crypto.randomUUID?.()
    || `assignment-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

function commandIsWaiting(command: DocflowAssignmentCommand | null): boolean {
  return command?.status === 'pending' || command?.status === 'state_unknown';
}

function DocumentOption({
  item,
  selected,
  tokens,
  onPress,
}: {
  item: DocflowAssignmentDocument;
  selected: boolean;
  tokens: FluentTokens;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={`native-docflow-assignment-document-${item.ref}`}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.option, { backgroundColor: selected ? tokens.selected : tokens.panelInset, borderColor: selected ? tokens.selectedBorder : tokens.borderSoft }]}
    >
      <MaterialCommunityIcons name={selected ? 'radiobox-marked' : 'radiobox-blank'} size={20} color={selected ? tokens.primary : tokens.iconMuted} />
      <View style={styles.flex}>
        <Text style={[styles.optionTitle, { color: tokens.textPrimary }]}>{item.title}</Text>
        <Text style={[styles.optionMeta, { color: tokens.textSecondary }]}>{item.document_type_label}{item.number ? ` · ${item.number}` : ''}</Text>
      </View>
    </Pressable>
  );
}

function PersonOption({
  item,
  selected,
  optional,
  tokens,
  onPress,
}: {
  item: DocflowAssignmentAssignee;
  selected: boolean;
  optional?: boolean;
  tokens: FluentTokens;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={`native-docflow-assignment-${optional ? 'controller' : 'assignee'}-${item.ref}`}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.option, { backgroundColor: selected ? tokens.selected : tokens.panelInset, borderColor: selected ? tokens.selectedBorder : tokens.borderSoft }]}
    >
      <MaterialCommunityIcons name={selected ? 'account-check' : 'account-outline'} size={21} color={selected ? tokens.primary : tokens.iconMuted} />
      <View style={styles.flex}>
        <Text style={[styles.optionTitle, { color: tokens.textPrimary }]}>{item.name}</Text>
        {item.department ? <Text style={[styles.optionMeta, { color: tokens.textSecondary }]}>{item.department}</Text> : null}
      </View>
    </Pressable>
  );
}

export function NativeDocflowAssignmentScreen() {
  const { hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const canCreate = hasPermission('docflow.create');
  const defaultDue = defaultDocflowAssignmentDueFields();
  const [capability, setCapability] = useState<Awaited<ReturnType<typeof getDocflowAssignmentCapability>> | null>(null);
  const [loadingCapability, setLoadingCapability] = useState(true);
  const [documentQuery, setDocumentQuery] = useState('');
  const [documents, setDocuments] = useState<DocflowAssignmentDocument[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<DocflowAssignmentDocument | null>(null);
  const [documentHint, setDocumentHint] = useState('Введите не менее 3 символов и нажмите «Найти».');
  const [assigneeQuery, setAssigneeQuery] = useState('');
  const [assignees, setAssignees] = useState<DocflowAssignmentAssignee[]>([]);
  const [selectedAssignee, setSelectedAssignee] = useState<DocflowAssignmentAssignee | null>(null);
  const [assigneeHint, setAssigneeHint] = useState('');
  const [controllerQuery, setControllerQuery] = useState('');
  const [controllers, setControllers] = useState<DocflowAssignmentAssignee[]>([]);
  const [selectedController, setSelectedController] = useState<DocflowAssignmentAssignee | null>(null);
  const [controllerHint, setControllerHint] = useState('');
  const [dueDate, setDueDate] = useState(defaultDue.date);
  const [dueTime, setDueTime] = useState(defaultDue.time);
  const [importance, setImportance] = useState<'normal' | 'high'>('normal');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [loadingAssignees, setLoadingAssignees] = useState(false);
  const [loadingControllers, setLoadingControllers] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [correlationId, setCorrelationId] = useState('');
  const [command, setCommand] = useState<DocflowAssignmentCommand | null>(null);
  const [created, setCreated] = useState<DocflowAssignmentCommand['assignment']>(null);
  const lifecycleRef = useRef(0);
  const documentRequestRef = useRef(0);
  const assigneeRequestRef = useRef(0);
  const controllerRequestRef = useRef(0);
  const commandCheckRef = useRef(false);
  const attemptRef = useRef<CreateAttempt | null>(null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else goBackOrReplace('/(shell)/docflow');
  }, []);

  useEffect(() => {
    if (!canCreate || offlineMode) {
      setLoadingCapability(false);
      return undefined;
    }
    const lifecycle = ++lifecycleRef.current;
    setLoadingCapability(true);
    setError('');
    void getDocflowAssignmentCapability().then(async (next) => {
      if (lifecycle !== lifecycleRef.current) return;
      setCapability(next);
      const prefix = next.required_title_prefix?.trim() || 'HUB-IT TEST';
      if (next.test_only) setTitle((current) => current || `${prefix} · `);
      if (!next.enabled) return;
      setLoadingAssignees(true);
      setLoadingControllers(true);
      try {
        const result = await searchDocflowAssignmentAssignees('', 20);
        if (lifecycle !== lifecycleRef.current) return;
        setAssignees(result.items);
        setControllers(result.items);
        const hint = result.reason || (result.truncated ? 'Показаны первые результаты — уточните ФИО.' : '');
        setAssigneeHint(hint);
        setControllerHint(hint);
      } catch (cause) {
        if (lifecycle === lifecycleRef.current) setError(resolveNativeDocflowError(cause, 'Не удалось загрузить исполнителей из 1С.').message);
      } finally {
        if (lifecycle === lifecycleRef.current) {
          setLoadingAssignees(false);
          setLoadingControllers(false);
        }
      }
    }).catch((cause) => {
      if (lifecycle !== lifecycleRef.current) return;
      const resolved = resolveNativeDocflowError(cause, 'Не удалось проверить возможность создания поручений.');
      setError(resolved.message);
      setCorrelationId(resolved.correlationId);
    }).finally(() => {
      if (lifecycle === lifecycleRef.current) setLoadingCapability(false);
    });
    return () => { lifecycleRef.current += 1; };
  }, [canCreate, offlineMode]);

  const searchDocuments = useCallback(async () => {
    const query = documentQuery.trim();
    if (query.length < 3 || loadingDocuments || offlineMode) {
      setDocumentHint('Введите не менее 3 символов для поиска документов.');
      return;
    }
    const requestId = ++documentRequestRef.current;
    setLoadingDocuments(true);
    setError('');
    try {
      const result = await searchDocflowAssignmentDocuments(query, 20);
      if (requestId !== documentRequestRef.current) return;
      setDocuments(result.items);
      setDocumentHint(result.reason || (result.truncated ? 'Показаны первые результаты — уточните название или номер.' : result.items.length ? '' : 'Документы не найдены.'));
    } catch (cause) {
      if (requestId !== documentRequestRef.current) return;
      setDocuments([]);
      setError(resolveNativeDocflowError(cause, '1С не успела ответить — уточните название или номер и повторите поиск.').message);
    } finally {
      if (requestId === documentRequestRef.current) setLoadingDocuments(false);
    }
  }, [documentQuery, loadingDocuments, offlineMode]);

  const searchPeople = useCallback(async (kind: 'assignee' | 'controller') => {
    if (offlineMode) return;
    const isAssignee = kind === 'assignee';
    const requestRef = isAssignee ? assigneeRequestRef : controllerRequestRef;
    const requestId = ++requestRef.current;
    if (isAssignee) setLoadingAssignees(true); else setLoadingControllers(true);
    setError('');
    try {
      const result = await searchDocflowAssignmentAssignees(isAssignee ? assigneeQuery : controllerQuery, 20);
      if (requestId !== requestRef.current) return;
      if (isAssignee) {
        setAssignees(result.items);
        setAssigneeHint(result.reason || (result.truncated ? 'Показаны первые результаты — уточните ФИО.' : result.items.length ? '' : 'Сотрудники не найдены.'));
      } else {
        setControllers(result.items);
        setControllerHint(result.reason || (result.truncated ? 'Показаны первые результаты — уточните ФИО.' : result.items.length ? '' : 'Сотрудники не найдены.'));
      }
    } catch (cause) {
      if (requestId === requestRef.current) setError(resolveNativeDocflowError(cause, 'Не удалось найти сотрудников в 1С.').message);
    } finally {
      if (requestId === requestRef.current) {
        if (isAssignee) setLoadingAssignees(false); else setLoadingControllers(false);
      }
    }
  }, [assigneeQuery, controllerQuery, offlineMode]);

  const handleCommand = useCallback((result: DocflowAssignmentCommand) => {
    if (result.status === 'applied' || result.status === 'already_applied') {
      setCreated(result.assignment);
      setCommand(null);
      setError('');
      attemptRef.current = null;
      return;
    }
    if (result.status === 'rejected') {
      setCommand(null);
      setError(result.error_code === 'DOCFLOW_ASSIGNMENT_NOT_APPLIED'
        ? '1С не создала поручение. Проверьте поля и повторите отправку.'
        : '1С отклонила создание поручения. Обновите форму и повторите попытку.');
      attemptRef.current = null;
      return;
    }
    setCommand(result);
  }, []);

  const checkCommand = useCallback(async () => {
    const commandId = command?.command_id.trim();
    if (!commandId || commandCheckRef.current || offlineMode) return;
    commandCheckRef.current = true;
    setWorking(true);
    setError('');
    try {
      handleCommand(await getDocflowAssignmentCommand(commandId));
    } catch (cause) {
      const resolved = resolveNativeDocflowError(cause, 'Не удалось проверить состояние поручения в 1С.');
      setError(resolved.message);
      setCorrelationId(resolved.correlationId);
    } finally {
      commandCheckRef.current = false;
      setWorking(false);
    }
  }, [command?.command_id, handleCommand, offlineMode]);

  useEffect(() => {
    if (!commandIsWaiting(command) || offlineMode) return undefined;
    const first = setTimeout(() => { void checkCommand(); }, 750);
    const interval = setInterval(() => { void checkCommand(); }, 3_000);
    return () => { clearTimeout(first); clearInterval(interval); };
  }, [checkCommand, command, offlineMode]);

  const submit = useCallback(async () => {
    if (working || command || created || offlineMode || !capability?.enabled) return;
    const dueAt = buildDocflowAssignmentDueAt(dueDate, dueTime);
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    const prefix = capability.required_title_prefix?.trim() || 'HUB-IT TEST';
    const prefixReady = !capability.test_only || (trimmedTitle.startsWith(prefix) && trimmedTitle.length > prefix.length + 1);
    if (!selectedDocument) setError('Выберите существующий документ 1С.');
    else if (!selectedAssignee) setError('Выберите исполнителя.');
    else if (!dueAt) setError('Укажите срок в формате ГГГГ-ММ-ДД и время ЧЧ:ММ.');
    else if (!prefixReady) setError(capability.test_only ? `Название должно начинаться с ${prefix} и содержать текст после префикса.` : 'Укажите название поручения.');
    else if (!trimmedDescription) setError('Добавьте описание для исполнителя.');
    else {
      const payload = {
        document_type: selectedDocument.document_type,
        document_ref: selectedDocument.ref,
        assignee_ref: selectedAssignee.ref,
        controller_ref: selectedController?.ref || null,
        due_at: dueAt,
        importance,
        title: trimmedTitle,
        description: trimmedDescription,
      } as const;
      const signature = JSON.stringify(payload);
      if (attemptRef.current?.signature !== signature) attemptRef.current = { signature, key: createIdempotencyKey() };
      setWorking(true);
      setError('');
      setCorrelationId('');
      try {
        handleCommand(await createDocflowAssignment(payload, attemptRef.current.key));
      } catch (cause) {
        const resolved = resolveNativeDocflowError(cause, 'Не удалось создать поручение в 1С.');
        setError(resolved.message);
        setCorrelationId(resolved.correlationId);
      } finally {
        setWorking(false);
      }
    }
  }, [capability, command, created, description, dueDate, dueTime, handleCommand, importance, offlineMode, selectedAssignee, selectedController, selectedDocument, title, working]);

  if (!canCreate) {
    return <AccountScreenScaffold title="Новое поручение 1С" tokens={tokens} onBack={goBack}><AccountSectionCard tokens={tokens} title="Нет доступа" description="Для создания поручения нужно право docflow.create.">{null}</AccountSectionCard></AccountScreenScaffold>;
  }

  return (
    <AccountScreenScaffold title="Новое поручение 1С" tokens={tokens} onBack={goBack}>
      {offlineMode ? <Text accessibilityRole="alert" style={[styles.statusText, { color: tokens.warning }]}>Автономный режим: создание поручений отключено.</Text> : null}
      {loadingCapability ? <AccountLoading tokens={tokens} /> : !capability?.enabled ? (
        <AccountSectionCard tokens={tokens} title="Создание сейчас недоступно" description={capability?.reason || error || 'Сервер не разрешил создание поручений для этой учётной записи.'}>
          {correlationId ? <Text selectable style={[styles.meta, { color: tokens.textSecondary }]}>Код обращения: {correlationId}</Text> : null}
        </AccountSectionCard>
      ) : created ? (
        <AccountSectionCard tokens={tokens} title="Поручение создано" description={created.title || '1С подтвердила создание поручения.'}>
          {created.state ? <Text style={[styles.statusText, { color: tokens.textSecondary }]}>Состояние: {created.state}</Text> : null}
          <AccountPrimaryButton tokens={tokens} label="Вернуться к заданиям" onPress={goBack} />
        </AccountSectionCard>
      ) : (
        <>
          <AccountSectionCard tokens={tokens} title="Выберите документ" description="Документ должен уже существовать в 1С. Поиск запускается только от трёх символов.">
            <View style={styles.searchRow}>
              <View style={styles.flex}><HubTextField testID="native-docflow-assignment-document-query" label="Название или номер" value={documentQuery} onChangeText={(value) => { setDocumentQuery(value.slice(0, 200)); setDocumentHint(''); }} onSubmitEditing={() => { void searchDocuments(); }} /></View>
              <Pressable testID="native-docflow-assignment-document-search" onPress={() => { void searchDocuments(); }} disabled={loadingDocuments || documentQuery.trim().length < 3} accessibilityRole="button" accessibilityLabel="Найти документ 1С" style={[styles.searchButton, { backgroundColor: tokens.primary, opacity: loadingDocuments || documentQuery.trim().length < 3 ? 0.5 : 1 }]}>
                {loadingDocuments ? <ActivityIndicator color="#fff" /> : <MaterialCommunityIcons name="magnify" size={22} color="#fff" />}
              </Pressable>
            </View>
            {documentHint ? <Text style={[styles.hint, { color: tokens.textSecondary }]}>{documentHint}</Text> : null}
            <View accessibilityRole="radiogroup" style={styles.options}>{documents.map((item) => <DocumentOption key={`${item.document_type}-${item.ref}`} item={item} selected={selectedDocument?.ref === item.ref} tokens={tokens} onPress={() => { setSelectedDocument(item); setError(''); }} />)}</View>
          </AccountSectionCard>

          <AccountSectionCard tokens={tokens} title="Исполнитель" description="Выберите одного исполнителя поручения.">
            <View style={styles.searchRow}>
              <View style={styles.flex}><HubTextField testID="native-docflow-assignment-assignee-query" label="ФИО" value={assigneeQuery} onChangeText={(value) => setAssigneeQuery(value.slice(0, 200))} onSubmitEditing={() => { void searchPeople('assignee'); }} /></View>
              <Pressable testID="native-docflow-assignment-assignee-search" onPress={() => { void searchPeople('assignee'); }} disabled={loadingAssignees} accessibilityRole="button" accessibilityLabel="Найти исполнителя" style={[styles.searchButton, { backgroundColor: tokens.primary, opacity: loadingAssignees ? 0.5 : 1 }]}>{loadingAssignees ? <ActivityIndicator color="#fff" /> : <MaterialCommunityIcons name="magnify" size={22} color="#fff" />}</Pressable>
            </View>
            {assigneeHint ? <Text style={[styles.hint, { color: tokens.textSecondary }]}>{assigneeHint}</Text> : null}
            <View accessibilityRole="radiogroup" style={styles.options}>{assignees.map((item) => <PersonOption key={item.ref} item={item} selected={selectedAssignee?.ref === item.ref} tokens={tokens} onPress={() => { setSelectedAssignee(item); setError(''); }} />)}</View>
          </AccountSectionCard>

          <AccountSectionCard tokens={tokens} title="Контролёр" description="Необязательно. Поиск контролёра выполняется отдельно.">
            <View style={styles.searchRow}>
              <View style={styles.flex}><HubTextField testID="native-docflow-assignment-controller-query" label="ФИО контролёра" value={controllerQuery} onChangeText={(value) => setControllerQuery(value.slice(0, 200))} onSubmitEditing={() => { void searchPeople('controller'); }} /></View>
              <Pressable testID="native-docflow-assignment-controller-search" onPress={() => { void searchPeople('controller'); }} disabled={loadingControllers} accessibilityRole="button" accessibilityLabel="Найти контролёра" style={[styles.searchButton, { backgroundColor: tokens.primary, opacity: loadingControllers ? 0.5 : 1 }]}>{loadingControllers ? <ActivityIndicator color="#fff" /> : <MaterialCommunityIcons name="magnify" size={22} color="#fff" />}</Pressable>
            </View>
            {selectedController ? <AccountSecondaryButton tokens={tokens} label="Убрать контролёра" onPress={() => setSelectedController(null)} /> : null}
            {controllerHint ? <Text style={[styles.hint, { color: tokens.textSecondary }]}>{controllerHint}</Text> : null}
            <View accessibilityRole="radiogroup" style={styles.options}>{controllers.map((item) => <PersonOption key={item.ref} item={item} optional selected={selectedController?.ref === item.ref} tokens={tokens} onPress={() => { setSelectedController(item); setError(''); }} />)}</View>
          </AccountSectionCard>

          <AccountSectionCard tokens={tokens} title="Срок и важность">
            <View style={styles.dateRow}>
              <View style={styles.flex}><HubTextField testID="native-docflow-assignment-date" label="Дата · ГГГГ-ММ-ДД" value={dueDate} onChangeText={(value) => setDueDate(value.slice(0, 10))} keyboardType="numbers-and-punctuation" /></View>
              <View style={styles.timeField}><HubTextField testID="native-docflow-assignment-time" label="Время" value={dueTime} onChangeText={(value) => setDueTime(value.slice(0, 5))} keyboardType="numbers-and-punctuation" /></View>
            </View>
            <View accessibilityRole="radiogroup" style={styles.importanceRow}>
              {(['normal', 'high'] as const).map((value) => <Pressable key={value} testID={`native-docflow-assignment-importance-${value}`} onPress={() => setImportance(value)} accessibilityRole="radio" accessibilityState={{ selected: importance === value }} style={[styles.importance, { backgroundColor: importance === value ? tokens.selected : tokens.panelInset, borderColor: importance === value ? tokens.selectedBorder : tokens.borderSoft }]}><Text style={[styles.optionTitle, { color: importance === value ? tokens.primary : tokens.textPrimary }]}>{value === 'normal' ? 'Обычная' : 'Высокая'}</Text></Pressable>)}
            </View>
          </AccountSectionCard>

          <AccountSectionCard tokens={tokens} title="Текст поручения" description={capability.test_only ? `Пилотный режим: название должно начинаться с ${capability.required_title_prefix || 'HUB-IT TEST'}.` : undefined}>
            <HubTextField testID="native-docflow-assignment-title" label="Название *" value={title} onChangeText={(value) => setTitle(value.slice(0, 200))} maxLength={200} />
            <View style={styles.fieldGap} />
            <HubTextField testID="native-docflow-assignment-description" label="Описание *" value={description} onChangeText={(value) => setDescription(value.slice(0, 2_000))} multiline numberOfLines={4} maxLength={2_000} />
          </AccountSectionCard>

          {commandIsWaiting(command) ? <View accessibilityRole="progressbar" accessibilityLiveRegion="polite" style={[styles.command, { backgroundColor: tokens.accentSoft, borderColor: tokens.primary }]}><ActivityIndicator color={tokens.primary} /><View style={styles.flex}><Text style={[styles.optionTitle, { color: tokens.textPrimary }]}>Проверяем создание в 1С</Text><Text style={[styles.hint, { color: tokens.textSecondary }]}>Повторная отправка отключена до окончательного статуса.</Text>{command?.correlation_id ? <Text selectable style={[styles.meta, { color: tokens.textSecondary }]}>Код обращения: {command.correlation_id}</Text> : null}</View><AccountSecondaryButton tokens={tokens} label="Проверить" onPress={() => { void checkCommand(); }} disabled={working} /></View> : null}
          {error ? <Text accessibilityRole="alert" style={[styles.statusText, { color: tokens.error }]}>{error}</Text> : null}
          {correlationId ? <Text selectable style={[styles.meta, { color: tokens.textSecondary }]}>Код обращения: {correlationId}</Text> : null}
          {!command ? <AccountPrimaryButton tokens={tokens} testID="native-docflow-assignment-submit" label={working ? 'Создаём в 1С…' : 'Создать в 1С'} onPress={() => { void submit(); }} disabled={working || offlineMode} /> : null}
        </>
      )}
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  statusText: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  meta: { marginTop: 4, fontSize: 10, lineHeight: 14 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchButton: { width: 48, height: 48, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  hint: { marginTop: 6, fontSize: 11, lineHeight: 16 },
  options: { marginTop: 9, gap: 7 },
  option: { minHeight: 58, borderWidth: 1, borderRadius: 13, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 9 },
  optionTitle: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  optionMeta: { marginTop: 2, fontSize: 11, lineHeight: 15 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timeField: { width: 112 },
  importanceRow: { marginTop: 10, flexDirection: 'row', gap: 8 },
  importance: { minHeight: 44, flex: 1, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  fieldGap: { height: 10 },
  command: { borderWidth: 1, borderRadius: 14, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10 },
});
