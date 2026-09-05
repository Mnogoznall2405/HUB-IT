import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatApiError } from '../../api/formatError';
import { listDepartments, type DepartmentRecord } from '../../api/departmentsApi';
import {
  createTaskObject,
  createTaskProject,
  createTask,
  getTaskProjects,
  getTaskObjects,
  searchTaskAssignees,
  searchTaskControllers,
  uploadTaskAttachment,
  type TaskAssignee,
  type TaskCreatePayload,
  type TaskObject,
  type TaskProject,
  type TaskUploadFile,
} from '../../api/taskApi';
import { useAuth } from '../../auth/AuthContext';
import { HubTextField, type HubTextFieldHandle } from '../../components/ui/HubTextField';
import { usePreferences } from '../../preferences/PreferencesContext';
import { consumeIncomingShare } from '../../share/incomingShare';
import {
  TASK_PRIORITY_OPTIONS,
  normalizeDueDate,
  todayProtocolDate,
} from '../../tasks/taskFormat';
import { useFluentTokens, type FluentTokens } from '../../theme/fluentTokens';
import { pickNativeTaskFile } from '../../tasks/nativeTaskFiles';
import {
  AccountLoading,
  AccountPrimaryButton,
  AccountScreenScaffold,
  AccountSecondaryButton,
  AccountSectionCard,
} from '../account/AccountChrome';
import { goBackOrReplace } from '../account/accountBack';

const SEARCH_DEBOUNCE_MS = 300;
const EMAIL_REMINDER_OPTIONS = [
  { value: 'default', label: 'По умолчанию' },
  { value: 'off', label: 'Не отправлять' },
  { value: '1', label: 'За 1 час' },
  { value: '3', label: 'За 3 часа' },
  { value: '6', label: 'За 6 часов' },
  { value: '12', label: 'За 12 часов' },
  { value: '24', label: 'За 24 часа' },
  { value: '48', label: 'За 48 часов' },
  { value: '72', label: 'За 72 часа' },
] as const;
type EmailReminderValue = typeof EMAIL_REMINDER_OPTIONS[number]['value'];

function useDebouncedValue(value: string): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return debounced;
}

function assigneeLabel(item: TaskAssignee): string {
  return String(item.full_name || item.username || '').trim() || `Пользователь ${item.id}`;
}

function findDefaultProject(items: TaskProject[]): TaskProject | null {
  return items.find((item) => (
    String(item.id || '') === 'general-tasks'
    || String(item.code || '').trim().toUpperCase() === 'GENERAL'
    || String(item.name || '').trim().toLowerCase() === 'общие задачи'
  )) || items[0] || null;
}

export function NativeTaskCreateScreen() {
  const { hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const allowed = hasPermission('tasks.create') || hasPermission('tasks.write');
  const canReadDepartments = hasPermission('settings.read') || hasPermission('departments.manage');
  const canCreateObject = hasPermission('tasks.write');
  const titleRef = useRef<HubTextFieldHandle>(null);
  const assigneeRequestRef = useRef(0);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [emailReminder, setEmailReminder] = useState<EmailReminderValue>('default');
  const [priority, setPriority] = useState<TaskCreatePayload['priority']>('normal');
  const [assigneeQuery, setAssigneeQuery] = useState('');
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<number[]>([]);
  const [projects, setProjects] = useState<TaskProject[]>([]);
  const [projectId, setProjectId] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [projectSaving, setProjectSaving] = useState(false);
  const [controllers, setControllers] = useState<TaskAssignee[]>([]);
  const [controllerId, setControllerId] = useState<number | null>(null);
  const [observerIds, setObserverIds] = useState<number[]>([]);
  const [objects, setObjects] = useState<TaskObject[]>([]);
  const [objectId, setObjectId] = useState('');
  const [newObjectName, setNewObjectName] = useState('');
  const [objectSaving, setObjectSaving] = useState(false);
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);
  const [departmentId, setDepartmentId] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'department' | 'department_managers'>('private');
  const [checklistText, setChecklistText] = useState('');
  const [checklistItems, setChecklistItems] = useState<Array<{ id: string; text: string; done: boolean }>>([]);
  const [files, setFiles] = useState<TaskUploadFile[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(true);
  const [assigneesLoading, setAssigneesLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const incomingShareAppliedRef = useRef(false);
  const debouncedAssigneeQuery = useDebouncedValue(assigneeQuery);
  const protocolDate = useMemo(() => todayProtocolDate(), []);
  const visibleObjects = useMemo(
    () => objects.filter((item) => String(item.project_id) === projectId),
    [objects, projectId],
  );

  useEffect(() => {
    if (incomingShareAppliedRef.current) return;
    incomingShareAppliedRef.current = true;
    const share = consumeIncomingShare('task');
    if (!share) return;
    const fallbackTitle = share.text.trim().split(/\r?\n/, 1)[0] || 'Новая задача';
    setTitle((share.subject || fallbackTitle).slice(0, 300));
    setDescription(share.text.slice(0, 12_000));
  }, []);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else goBackOrReplace('/(shell)/tasks');
  }, []);

  useEffect(() => {
    if (!allowed) return;
    let active = true;
    setLoadingRefs(true);
    Promise.all([
      getTaskProjects(),
      searchTaskAssignees('', 50),
      searchTaskControllers('', 50),
      getTaskObjects(),
      canReadDepartments ? listDepartments() : Promise.resolve([]),
    ])
      .then(([nextProjects, nextAssignees, nextControllers, nextObjects, nextDepartments]) => {
        if (!active) return;
        setProjects(nextProjects);
        setProjectId(String(findDefaultProject(nextProjects)?.id || ''));
        setAssignees(nextAssignees);
        setControllers(nextControllers);
        setObjects(nextObjects);
        setDepartments(nextDepartments);
      })
      .catch((cause) => {
        if (active) setError(formatApiError(cause, 'Не удалось загрузить справочники задачи.'));
      })
      .finally(() => {
        if (active) setLoadingRefs(false);
      });
    return () => { active = false; };
  }, [allowed, canReadDepartments]);

  useEffect(() => {
    if (!allowed || loadingRefs) return;
    const requestId = ++assigneeRequestRef.current;
    setAssigneesLoading(true);
    void searchTaskAssignees(debouncedAssigneeQuery, 50)
      .then((items) => {
        if (requestId === assigneeRequestRef.current) setAssignees(items);
      })
      .catch((cause) => {
        if (requestId === assigneeRequestRef.current) {
          setError(formatApiError(cause, 'Не удалось найти исполнителей.'));
        }
      })
      .finally(() => {
        if (requestId === assigneeRequestRef.current) setAssigneesLoading(false);
      });
  }, [allowed, debouncedAssigneeQuery, loadingRefs]);

  const toggleAssignee = useCallback((userId: number) => {
    setSelectedAssigneeIds((current) => (
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId]
    ));
  }, []);

  const toggleObserver = useCallback((userId: number) => {
    setObserverIds((current) => current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]);
  }, []);

  const changeDueDate = useCallback((value: string) => {
    setDueDate(value);
    if (!value.trim()) setEmailReminder('default');
  }, []);

  const addChecklistItem = useCallback(() => {
    const text = checklistText.trim();
    if (!text) return;
    setChecklistItems((current) => [...current, { id: `native-${Date.now()}-${current.length}`, text, done: false }]);
    setChecklistText('');
  }, [checklistText]);

  const addFile = useCallback(async () => {
    try {
      const file = await pickNativeTaskFile();
      if (!file) return;
      setFiles((current) => current.some((item) => item.uri === file.uri && item.name === file.name) ? current : [...current, file]);
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось выбрать файл.'));
    }
  }, []);

  const selectProject = useCallback((nextProjectId: string) => {
    setProjectId(nextProjectId);
    setObjectId('');
  }, []);

  const selectDepartment = useCallback((nextDepartmentId: string) => {
    setDepartmentId(nextDepartmentId);
    setVisibility((current) => nextDepartmentId ? (current === 'private' ? 'department' : current) : 'private');
  }, []);

  const addProject = useCallback(async () => {
    const name = newProjectName.trim();
    if (name.length < 2 || projectSaving || offlineMode) {
      if (name.length < 2) setError('Название проекта должно содержать не меньше двух символов.');
      return;
    }
    setProjectSaving(true);
    setError('');
    try {
      const created = await createTaskProject({ name, code: '', description: '', is_active: true });
      const createdId = String(created?.id || '').trim();
      if (!createdId) throw new Error('Сервер не вернул идентификатор проекта');
      setProjects((current) => [...current.filter((item) => String(item.id) !== createdId), created]);
      setProjectId(createdId);
      setObjectId('');
      setNewProjectName('');
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось создать проект.'));
    } finally {
      setProjectSaving(false);
    }
  }, [newProjectName, offlineMode, projectSaving]);

  const addObject = useCallback(async () => {
    const name = newObjectName.trim();
    if (!canCreateObject || !projectId || name.length < 2 || objectSaving || offlineMode) {
      if (name.length < 2) setError('Название объекта должно содержать не меньше двух символов.');
      return;
    }
    setObjectSaving(true);
    setError('');
    try {
      const created = await createTaskObject({
        project_id: projectId,
        name,
        code: '',
        description: '',
        is_active: true,
      });
      const createdId = String(created?.id || '').trim();
      if (!createdId) throw new Error('Сервер не вернул идентификатор объекта');
      setObjects((current) => [...current.filter((item) => String(item.id) !== createdId), created]);
      setObjectId(createdId);
      setNewObjectName('');
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось создать объект.'));
    } finally {
      setObjectSaving(false);
    }
  }, [canCreateObject, newObjectName, objectSaving, offlineMode, projectId]);

  const submit = useCallback(async () => {
    if (saving || offlineMode) return;
    const normalizedTitle = title.trim();
    if (normalizedTitle.length < 3) {
      setError('Название должно содержать не меньше трёх символов.');
      titleRef.current?.focus();
      return;
    }
    if (selectedAssigneeIds.length === 0) {
      setError('Выберите хотя бы одного исполнителя.');
      return;
    }
    if (!projectId) {
      setError('Выберите проект задачи.');
      return;
    }

    let normalizedDueAt: string | null;
    try {
      normalizedDueAt = normalizeDueDate(dueDate);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Проверьте срок задачи.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const created = await createTask({
        title: normalizedTitle,
        description: description.trim(),
        assignee_user_ids: selectedAssigneeIds,
        project_id: projectId,
        protocol_date: protocolDate,
        due_at: normalizedDueAt,
        ...(normalizedDueAt && emailReminder !== 'default' ? {
          email_deadline_remind_hours: emailReminder === 'off' ? 0 : Number(emailReminder),
        } : {}),
        priority,
        department_id: departmentId || null,
        visibility_scope: departmentId ? visibility : 'private',
        observer_user_ids: observerIds,
        controller_user_id: controllerId,
        object_id: objectId || null,
        checklist_items: checklistItems,
      });
      const uploadFailures: string[] = [];
      for (const task of created) {
        const taskId = String(task.id || '').trim();
        if (!taskId) continue;
        for (const file of files) {
          try {
            await uploadTaskAttachment(taskId, file);
          } catch {
            uploadFailures.push(file.name);
          }
        }
      }
      const firstId = String(created[0]?.id || '').trim();
      if (uploadFailures.length) {
        Alert.alert('Задача создана', `Не загрузились файлы: ${uploadFailures.slice(0, 3).join(', ')}`);
      }
      if (firstId) {
        router.replace({
          pathname: '/(shell)/tasks/[taskId]',
          params: { taskId: firstId },
        } as never);
      } else {
        router.replace('/(shell)/tasks' as never);
      }
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось создать задачу.'));
    } finally {
      setSaving(false);
    }
  }, [checklistItems, controllerId, departmentId, description, dueDate, emailReminder, files, objectId, observerIds, offlineMode, priority, projectId, protocolDate, saving, selectedAssigneeIds, title, visibility]);

  if (!allowed) {
    return (
      <AccountScreenScaffold title="Новая задача" tokens={tokens} onBack={goBack}>
        <AccountSectionCard
          tokens={tokens}
          title="Нет доступа"
          description="Нужно право tasks.create или tasks.write."
        >
          {null}
        </AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  return (
    <AccountScreenScaffold
      title="Новая задача"
      tokens={tokens}
      onBack={goBack}
    >
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{error}</Text> : null}
      {offlineMode ? (
        <Text accessibilityRole="alert" style={[styles.warning, { color: tokens.warning }]}>
          Создание задачи недоступно без подключения к серверу.
        </Text>
      ) : null}
      <AccountSectionCard
        tokens={tokens}
        title="Основное"
        description="Поля со звёздочкой обязательны."
      >
        <HubTextField
          ref={titleRef}
          testID="native-task-create-title"
          label="Название *"
          value={title}
          onChangeText={setTitle}
          autoCapitalize="sentences"
          returnKeyType="next"
          maxLength={300}
        />
        <View style={styles.fieldGap} />
        <HubTextField
          testID="native-task-create-description"
          label="Описание"
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={5}
          maxLength={12000}
          style={styles.descriptionField}
        />
        <View style={styles.fieldGap} />
        <HubTextField
          testID="native-task-create-due"
          label="Срок"
          value={dueDate}
          onChangeText={changeDueDate}
          placeholder="ГГГГ-ММ-ДД"
          keyboardType="numbers-and-punctuation"
          maxLength={10}
          accessibilityHint="Оставьте пустым, если срок не нужен"
        />
        <Text style={[styles.helper, { color: tokens.textSecondary }]}>Дата протокола: {protocolDate}</Text>
        {dueDate.trim() ? (
          <View style={styles.subsection}>
            <Text style={[styles.subsectionLabel, { color: tokens.textSecondary }]}>Email-напоминание о сроке</Text>
            <View style={styles.choiceWrap}>
              {EMAIL_REMINDER_OPTIONS.map((option) => (
                <ChoiceChip
                  key={option.value}
                  testID={`native-task-email-reminder-${option.value}`}
                  label={option.label}
                  selected={emailReminder === option.value}
                  tokens={tokens}
                  onPress={() => setEmailReminder(option.value)}
                />
              ))}
            </View>
          </View>
        ) : null}
      </AccountSectionCard>

      <AccountSectionCard tokens={tokens} title="Приоритет">
        <View style={styles.choiceWrap}>
          {TASK_PRIORITY_OPTIONS.map((option) => (
            <ChoiceChip
              key={option.value}
              label={option.label}
              selected={priority === option.value}
              tokens={tokens}
              onPress={() => setPriority(option.value)}
            />
          ))}
        </View>
      </AccountSectionCard>

      <AccountSectionCard
        tokens={tokens}
        title={`Исполнители * (${selectedAssigneeIds.length})`}
        description="Все выбранные исполнители работают в одной общей задаче."
      >
        <HubTextField
          testID="native-task-create-assignee-search"
          label="Поиск исполнителей"
          value={assigneeQuery}
          onChangeText={setAssigneeQuery}
          autoCapitalize="words"
        />
        {assigneesLoading ? <ActivityIndicator color={tokens.primary} style={styles.inlineLoader} /> : null}
        <View style={styles.peopleList}>
          {assignees.length === 0 && !assigneesLoading ? (
            <Text style={{ color: tokens.textSecondary }}>Исполнители не найдены.</Text>
          ) : assignees.map((item) => {
            const selected = selectedAssigneeIds.includes(Number(item.id));
            return (
              <Pressable
                key={String(item.id)}
                testID={`native-task-assignee-${item.id}`}
                onPress={() => toggleAssignee(Number(item.id))}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                style={[
                  styles.personRow,
                  {
                    borderColor: selected ? tokens.selectedBorder : tokens.borderSoft,
                    backgroundColor: selected ? tokens.selected : tokens.panelSolid,
                  },
                ]}
              >
                <View style={[styles.check, { borderColor: selected ? tokens.primary : tokens.borderStrong, backgroundColor: selected ? tokens.primary : 'transparent' }]}>
                  {selected ? <MaterialCommunityIcons name="check" size={16} color="#fff" /> : null}
                </View>
                <View style={styles.personText}>
                  <Text style={[styles.personName, { color: tokens.textPrimary }]}>{assigneeLabel(item)}</Text>
                  <Text style={[styles.personMeta, { color: tokens.textSecondary }]}>
                    {[item.job_title, item.department].filter(Boolean).join(' · ') || item.username || 'сотрудник'}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </AccountSectionCard>

      <AccountSectionCard tokens={tokens} title="Проект *">
        {loadingRefs ? <AccountLoading tokens={tokens} /> : projects.length === 0 ? (
          <Text style={{ color: tokens.error }}>Нет доступных проектов. Обратитесь к администратору.</Text>
        ) : (
          <View style={styles.choiceWrap}>
            {projects.map((project) => (
              <ChoiceChip
                key={String(project.id)}
                label={project.name || project.code || String(project.id)}
                selected={projectId === String(project.id)}
                tokens={tokens}
                onPress={() => selectProject(String(project.id))}
              />
            ))}
          </View>
        )}
        <View style={styles.subsection}>
          <HubTextField
            testID="native-task-new-project-name"
            label="Новый проект"
            value={newProjectName}
            onChangeText={setNewProjectName}
            maxLength={200}
            returnKeyType="done"
            onSubmitEditing={() => { void addProject(); }}
          />
          <View style={styles.inlineActions}>
            <AccountSecondaryButton
              testID="native-task-create-project"
              tokens={tokens}
              label={projectSaving ? 'Создаём…' : 'Создать проект'}
              disabled={projectSaving || offlineMode || newProjectName.trim().length < 2}
              onPress={() => { void addProject(); }}
            />
          </View>
        </View>
      </AccountSectionCard>

      <AccountSectionCard tokens={tokens} title="Контролёр">
        <View style={styles.choiceWrap}>
          <ChoiceChip label="Без контролёра" selected={controllerId === null} tokens={tokens} onPress={() => setControllerId(null)} />
          {controllers.map((item) => (
            <ChoiceChip testID={`native-task-controller-${item.id}`} key={item.id} label={assigneeLabel(item)} selected={controllerId === Number(item.id)} tokens={tokens} onPress={() => setControllerId(Number(item.id))} />
          ))}
        </View>
      </AccountSectionCard>

      {projectId && (visibleObjects.length > 0 || canCreateObject) ? (
        <AccountSectionCard tokens={tokens} title="Объект">
          <View style={styles.choiceWrap}>
            <ChoiceChip label="Без объекта" selected={!objectId} tokens={tokens} onPress={() => setObjectId('')} />
            {visibleObjects.map((item) => (
              <ChoiceChip testID={`native-task-object-${item.id}`} key={item.id} label={item.name || item.code || item.id} selected={objectId === String(item.id)} tokens={tokens} onPress={() => setObjectId(String(item.id))} />
            ))}
          </View>
          {canCreateObject ? (
            <View style={styles.subsection}>
              <HubTextField
                testID="native-task-new-object-name"
                label="Новый объект"
                value={newObjectName}
                onChangeText={setNewObjectName}
                maxLength={200}
                returnKeyType="done"
                onSubmitEditing={() => { void addObject(); }}
              />
              <View style={styles.inlineActions}>
                <AccountSecondaryButton
                  testID="native-task-create-object"
                  tokens={tokens}
                  label={objectSaving ? 'Создаём…' : 'Создать объект'}
                  disabled={objectSaving || offlineMode || newObjectName.trim().length < 2}
                  onPress={() => { void addObject(); }}
                />
              </View>
            </View>
          ) : null}
        </AccountSectionCard>
      ) : null}

      {canReadDepartments ? (
        <AccountSectionCard tokens={tokens} title="Отдел" description="Доступность списка определяется серверными правами на справочник отделов.">
          {departments.length ? (
            <View style={styles.choiceWrap}>
              <ChoiceChip testID="native-task-department-none" label="Без отдела" selected={!departmentId} tokens={tokens} onPress={() => selectDepartment('')} />
              {departments.map((department) => (
                <ChoiceChip
                  testID={`native-task-department-${department.id}`}
                  key={String(department.id)}
                  label={String(department.name || department.id)}
                  selected={departmentId === String(department.id)}
                  tokens={tokens}
                  onPress={() => selectDepartment(String(department.id))}
                />
              ))}
            </View>
          ) : (
            <Text style={{ color: tokens.textSecondary }}>Доступных отделов нет.</Text>
          )}
        </AccountSectionCard>
      ) : null}

      <AccountSectionCard tokens={tokens} title="Наблюдатели" description="Получают обновления задачи без назначения исполнителем.">
        <View style={styles.peopleList}>
          {assignees.filter((item) => !selectedAssigneeIds.includes(Number(item.id))).map((item) => {
            const selected = observerIds.includes(Number(item.id));
            return (
              <Pressable key={item.id} testID={`native-task-observer-${item.id}`} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={() => toggleObserver(Number(item.id))} style={[styles.personRow, { borderColor: selected ? tokens.selectedBorder : tokens.borderSoft, backgroundColor: selected ? tokens.selected : tokens.panelSolid }]}> 
                <View style={[styles.check, { borderColor: selected ? tokens.primary : tokens.borderStrong, backgroundColor: selected ? tokens.primary : 'transparent' }]}>{selected ? <MaterialCommunityIcons name="check" size={16} color="#fff" /> : null}</View>
                <Text style={[styles.personName, { color: tokens.textPrimary, flex: 1 }]}>{assigneeLabel(item)}</Text>
              </Pressable>
            );
          })}
        </View>
      </AccountSectionCard>

      {departmentId ? (
        <AccountSectionCard tokens={tokens} title="Видимость">
          <View style={styles.choiceWrap}>
            {([
              ['private', 'Только участники'],
              ['department', 'Отдел'],
              ['department_managers', 'Руководители отдела'],
            ] as const).map(([value, label]) => <ChoiceChip testID={`native-task-visibility-${value}`} key={value} label={label} selected={visibility === value} tokens={tokens} onPress={() => setVisibility(value)} />)}
          </View>
        </AccountSectionCard>
      ) : null}

      <AccountSectionCard tokens={tokens} title={`Чек-лист (${checklistItems.length})`}>
        <HubTextField testID="native-task-create-checklist-input" label="Новый пункт" value={checklistText} onChangeText={setChecklistText} returnKeyType="done" onSubmitEditing={addChecklistItem} />
        <View style={styles.inlineActions}><AccountSecondaryButton tokens={tokens} label="Добавить пункт" disabled={!checklistText.trim()} onPress={addChecklistItem} /></View>
        {checklistItems.map((item) => (
          <View key={item.id} style={[styles.checklistRow, { borderBottomColor: tokens.borderSoft }]}> 
            <Text style={[styles.checklistText, { color: tokens.textPrimary }]}>{item.text}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Удалить ${item.text}`} onPress={() => setChecklistItems((current) => current.filter((entry) => entry.id !== item.id))} style={styles.removeButton}><MaterialCommunityIcons name="close" size={19} color={tokens.error} /></Pressable>
          </View>
        ))}
      </AccountSectionCard>

      <AccountSectionCard tokens={tokens} title={`Файлы (${files.length})`} description="До 20 МБ на файл.">
        <AccountSecondaryButton tokens={tokens} label="Добавить файл" onPress={() => { void addFile(); }} />
        {files.map((file) => (
          <View key={`${file.uri}:${file.name}`} style={[styles.checklistRow, { borderBottomColor: tokens.borderSoft }]}> 
            <Text numberOfLines={1} style={[styles.checklistText, { color: tokens.textPrimary }]}>{file.name}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Убрать ${file.name}`} onPress={() => setFiles((current) => current.filter((item) => item !== file))} style={styles.removeButton}><MaterialCommunityIcons name="close" size={19} color={tokens.error} /></Pressable>
          </View>
        ))}
      </AccountSectionCard>

      <AccountPrimaryButton
        tokens={tokens}
        testID="native-task-create-submit"
        label={saving ? 'Создание…' : 'Создать задачу'}
        disabled={saving || offlineMode}
        onPress={() => { void submit(); }}
      />
    </AccountScreenScaffold>
  );
}

function ChoiceChip({ testID, label, selected, tokens, onPress }: {
  testID?: string;
  label: string;
  selected: boolean;
  tokens: FluentTokens;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        styles.choice,
        {
          borderColor: selected ? tokens.selectedBorder : tokens.borderSoft,
          backgroundColor: selected ? tokens.selected : tokens.panelSolid,
        },
      ]}
    >
      <Text style={{ color: selected ? tokens.primary : tokens.textPrimary, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  error: { fontSize: 13, fontWeight: '700' },
  warning: { fontSize: 13, fontWeight: '700' },
  fieldGap: { height: 12 },
  descriptionField: { minHeight: 112 },
  helper: { marginTop: 8, fontSize: 12, fontWeight: '600' },
  subsection: { marginTop: 16 },
  subsectionLabel: { marginBottom: 8, fontSize: 12, lineHeight: 17, fontWeight: '800' },
  choiceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { minHeight: 44, borderWidth: 1, borderRadius: 22, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  inlineLoader: { marginVertical: 10 },
  peopleList: { gap: 8, marginTop: 10 },
  personRow: { minHeight: 56, borderWidth: 1, borderRadius: 12, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  check: { width: 24, height: 24, borderWidth: 2, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  personText: { flex: 1, minWidth: 0 },
  personName: { fontSize: 14, fontWeight: '800' },
  personMeta: { marginTop: 2, fontSize: 12 },
  inlineActions: { marginTop: 9 },
  checklistRow: { minHeight: 48, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  checklistText: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 18 },
  removeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
