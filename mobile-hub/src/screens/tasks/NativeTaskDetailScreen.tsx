import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { formatApiError } from '../../api/formatError';
import { listDepartments, type DepartmentRecord } from '../../api/departmentsApi';
import {
  addTaskComment,
  completeTask,
  deleteTask,
  getTask,
  getTaskComments,
  getTaskObjects,
  getTaskProjects,
  getTaskStatusLog,
  markTaskCommentsSeen,
  openTaskDiscussion,
  reopenTask,
  reviewTask,
  searchTaskAssignees,
  searchTaskControllers,
  startTask,
  submitTask,
  updateTask,
  uploadTaskAttachment,
  type HubTask,
  type TaskAttachment,
  type TaskAssignee,
  type TaskChecklistItem,
  type TaskComment,
  type TaskStatusLog,
  type TaskObject,
  type TaskProject,
  type TaskUploadFile,
} from '../../api/taskApi';
import { HUB_WEB_ORIGIN } from '../../api/config';
import { useAuth } from '../../auth/AuthContext';
import { chatKeyboardAvoidingProps } from '../../chat/chatKeyboard';
import { hubRealtimeSocket } from '../../realtime/hubRealtimeSocket';
import {
  formatNativeSnapshotSavedAt,
  readNativeEntitySnapshot,
  writeNativeEntitySnapshot,
} from '../../cache/nativeSnapshotCache';
import { useAndroidBackHandler } from '../../chat/useAndroidBackHandler';
import { openNativeFile } from '../../files/nativeAttachmentDownloads';
import { useNativeBottomNavInset } from '../../navigation/useNativeBottomNavInset';
import { usePreferences } from '../../preferences/PreferencesContext';
import {
  getTaskActions,
  taskStatusLabel,
  type TaskAction,
  type TaskActionKey,
} from '../../tasks/taskActions';
import {
  formatTaskDate,
  normalizeDueDate,
  TASK_PRIORITY_OPTIONS,
  taskDiscussionConversationId,
  taskPerson,
  taskPriorityLabel,
} from '../../tasks/taskFormat';
import { downloadNativeTaskAttachment, pickNativeTaskFile } from '../../tasks/nativeTaskFiles';
import { useFluentTokens, type FluentTokens } from '../../theme/fluentTokens';
import {
  AccountField,
  AccountLoading,
  AccountScreenScaffold,
  AccountSectionCard,
} from '../account/AccountChrome';
import { goBackOrReplace } from '../account/accountBack';

function actionSuccessMessage(key: TaskActionKey): string {
  return {
    start: 'Задача взята в работу.',
    submit: 'Задача отправлена на проверку.',
    approve: 'Результат принят.',
    reject: 'Задача возвращена на доработку.',
    complete: 'Задача завершена.',
    reopen: 'Задача переоткрыта.',
  }[key];
}

function commentAuthor(comment: TaskComment): string {
  return String(comment.full_name || comment.username || '').trim() || 'Участник';
}

function taskDueDateInput(value: unknown): string {
  return String(value || '').trim().slice(0, 10);
}

function taskFileSize(value: unknown): string {
  const bytes = Math.max(0, Number(value || 0));
  if (!bytes) return 'Размер не указан';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

type NativeTaskDetailSnapshot = {
  task: HubTask;
  comments: TaskComment[];
  statusLog: TaskStatusLog[];
};

type TaskPresencePeer = {
  id?: number;
  username?: string;
  full_name?: string;
  connection_id: string;
  seenAt: number;
};

export function NativeTaskDetailScreen({ taskId }: { taskId: string }) {
  const { user, hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const bottomInset = useNativeBottomNavInset();
  const allowed = hasPermission('tasks.read');
  const [task, setTask] = useState<HubTask | null>(null);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [statusLog, setStatusLog] = useState<TaskStatusLog[]>([]);
  const [statusLogError, setStatusLogError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cachedAt, setCachedAt] = useState(0);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [commentText, setCommentText] = useState('');
  const [commentSending, setCommentSending] = useState(false);
  const [pendingAction, setPendingAction] = useState<TaskAction | null>(null);
  const [actionComment, setActionComment] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionFile, setActionFile] = useState<TaskUploadFile | null>(null);
  const [discussionBusy, setDiscussionBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editPriority, setEditPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [editProtocolDate, setEditProtocolDate] = useState('');
  const [editAssigneeIds, setEditAssigneeIds] = useState<number[]>([]);
  const [editControllerId, setEditControllerId] = useState<number | null>(null);
  const [editObserverIds, setEditObserverIds] = useState<number[]>([]);
  const [editProjectId, setEditProjectId] = useState('');
  const [editObjectId, setEditObjectId] = useState('');
  const [editDepartmentId, setEditDepartmentId] = useState('');
  const [editVisibility, setEditVisibility] = useState<'private' | 'department' | 'department_managers'>('private');
  const [editEmailReminder, setEditEmailReminder] = useState('');
  const [editDirectoryQuery, setEditDirectoryQuery] = useState('');
  const [editAssignees, setEditAssignees] = useState<TaskAssignee[]>([]);
  const [editControllers, setEditControllers] = useState<TaskAssignee[]>([]);
  const [editProjects, setEditProjects] = useState<TaskProject[]>([]);
  const [editObjects, setEditObjects] = useState<TaskObject[]>([]);
  const [editDepartments, setEditDepartments] = useState<DepartmentRecord[]>([]);
  const [editMetaLoading, setEditMetaLoading] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [checklistText, setChecklistText] = useState('');
  const [checklistBusy, setChecklistBusy] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [presencePeers, setPresencePeers] = useState<TaskPresencePeer[]>([]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else goBackOrReplace('/(shell)/tasks');
  }, []);

  useAndroidBackHandler(() => {
    if (pendingAction) {
      setPendingAction(null);
      setActionComment('');
      setActionFile(null);
      return true;
    }
    if (editOpen) {
      setEditOpen(false);
      return true;
    }
    if (deleteConfirmOpen) {
      setDeleteConfirmOpen(false);
      return true;
    }
    goBack();
    return true;
  });

  const loadTask = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (!taskId) return;
    if (mode === 'refresh') setRefreshing(true);
    else setLoading(true);
    setError('');
    const cached = user?.id
      ? await readNativeEntitySnapshot<NativeTaskDetailSnapshot>(
        'task-details',
        user.id,
        taskId,
        Number.MAX_SAFE_INTEGER,
      )
      : null;
    if (cached) {
      setTask(cached.data.task);
      setComments(cached.data.comments || []);
      setStatusLog(cached.data.statusLog || []);
      setStatusLogError('');
      setCachedAt(cached.savedAt);
      if (mode === 'initial') setLoading(false);
    }
    if (offlineMode) {
      if (!cached) {
        setTask(null);
        setComments([]);
        setStatusLog([]);
        setCachedAt(0);
        setError('Нет подключения и сохранённой копии задачи. Откройте её один раз при наличии сети.');
      }
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const nextTask = await getTask(taskId);
      setTask(nextTask);
      setCachedAt(0);
      setStatusLogError('');
      try {
        setStatusLog(await getTaskStatusLog(taskId));
      } catch (cause) {
        setStatusLog([]);
        setStatusLogError(formatApiError(cause, 'Не удалось загрузить историю статусов.'));
      }
      if (nextTask.capabilities?.can_open_discussion) {
        setComments([]);
      } else {
        try {
          const nextComments = await getTaskComments(taskId);
          setComments(nextComments);
          void markTaskCommentsSeen(taskId).catch(() => undefined);
        } catch (cause) {
          setComments([]);
          setError(formatApiError(cause, 'Не удалось загрузить комментарии.'));
        }
      }
    } catch (cause) {
      if (!cached) {
        setTask(null);
        setComments([]);
        setStatusLog([]);
      }
      setError(formatApiError(cause, cached
        ? 'Показана сохранённая копия. Не удалось обновить задачу.'
        : 'Не удалось открыть задачу.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [offlineMode, taskId, user?.id]);

  useEffect(() => {
    if (allowed && taskId) void loadTask();
  }, [allowed, loadTask, taskId]);

  useEffect(() => {
    if (!allowed || offlineMode || !taskId) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = (event?: unknown) => {
      const envelope = event && typeof event === 'object' ? event as { payload?: unknown } : {};
      const payload = envelope.payload && typeof envelope.payload === 'object'
        ? envelope.payload as Record<string, unknown>
        : {};
      const changedTaskId = String(payload.task_id || '').trim();
      if (changedTaskId && changedTaskId !== String(taskId)) return;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void loadTask('refresh');
      }, 100);
    };
    const releases = [
      hubRealtimeSocket.onTaskChanged(refresh),
      hubRealtimeSocket.on('hub.realtime.connected', refresh),
    ];
    return () => {
      if (timer) clearTimeout(timer);
      releases.forEach((release) => release());
    };
  }, [allowed, loadTask, offlineMode, taskId]);

  useEffect(() => {
    if (!allowed || offlineMode || !taskId) {
      setPresencePeers([]);
      return undefined;
    }
    const release = hubRealtimeSocket.watchTaskPresence(taskId, (event) => {
      const envelope = event && typeof event === 'object'
        ? event as { type?: string; payload?: unknown }
        : {};
      const payload = envelope.payload && typeof envelope.payload === 'object'
        ? envelope.payload as Record<string, unknown>
        : {};
      if (String(payload.task_id || '') !== String(taskId)) return;
      if (envelope.type === 'tasks.presence.snapshot') {
        setPresencePeers([]);
        return;
      }
      const collaborator = payload.collaborator && typeof payload.collaborator === 'object'
        ? payload.collaborator as Record<string, unknown>
        : {};
      const connectionId = String(payload.connection_id || collaborator.connection_id || '').trim();
      if (!connectionId) return;
      setPresencePeers((current) => {
        if (envelope.type === 'tasks.presence.left') {
          return current.filter((peer) => peer.connection_id !== connectionId);
        }
        const next: TaskPresencePeer = {
          id: Number(collaborator.id || 0) || undefined,
          username: String(collaborator.username || ''),
          full_name: String(collaborator.full_name || ''),
          connection_id: connectionId,
          seenAt: Date.now(),
        };
        return [...current.filter((peer) => peer.connection_id !== connectionId), next];
      });
    });
    const timer = setInterval(() => {
      const oldestAllowed = Date.now() - 80_000;
      setPresencePeers((current) => current.filter((peer) => peer.seenAt >= oldestAllowed));
    }, 20_000);
    return () => {
      clearInterval(timer);
      release();
      setPresencePeers([]);
    };
  }, [allowed, offlineMode, taskId]);

  useEffect(() => {
    if (!task || offlineMode || loading || refreshing || !user?.id) return;
    void writeNativeEntitySnapshot<NativeTaskDetailSnapshot>('task-details', user.id, taskId, {
      task,
      comments,
      statusLog,
    });
  }, [comments, loading, offlineMode, refreshing, statusLog, task, taskId, user?.id]);

  const canDeleteTask = Boolean(
    task?.id
      && String(task.integration_kind || '').trim().toLowerCase() !== 'transfer_act_upload'
      && (
        String(user?.role || '').trim().toLowerCase() === 'admin'
        || Number(task.created_by_user_id) === Number(user?.id)
      ),
  );

  const copyTaskLink = useCallback(async () => {
    if (!task?.id) return;
    try {
      await Clipboard.setStringAsync(`${HUB_WEB_ORIGIN}/tasks?task=${encodeURIComponent(task.id)}`);
      setMessage('Ссылка на задачу скопирована.');
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось скопировать ссылку.'));
    }
  }, [task?.id]);

  const confirmDeleteTask = useCallback(async () => {
    if (!task?.id || !canDeleteTask || deleteBusy || offlineMode) return;
    setDeleteBusy(true);
    setError('');
    try {
      await deleteTask(task.id);
      setDeleteConfirmOpen(false);
      router.replace('/(shell)/tasks' as never);
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось удалить задачу.'));
    } finally {
      setDeleteBusy(false);
    }
  }, [canDeleteTask, deleteBusy, offlineMode, task?.id]);

  const executeAction = useCallback(async () => {
    if (!task || !pendingAction || actionBusy || offlineMode) return;
    const comment = actionComment.trim();
    if (pendingAction.commentRequired && !comment) {
      setError('Для возврата на доработку укажите комментарий.');
      return;
    }
    setActionBusy(true);
    setError('');
    try {
      let updated: HubTask;
      switch (pendingAction.key) {
        case 'start':
          updated = await startTask(task.id);
          break;
        case 'submit':
          updated = await submitTask(task.id, comment, actionFile);
          break;
        case 'approve':
          updated = await reviewTask(task.id, 'approve', comment);
          break;
        case 'reject':
          updated = await reviewTask(task.id, 'reject', comment);
          break;
        case 'complete':
          updated = await completeTask(task.id, comment);
          break;
        case 'reopen':
          updated = await reopenTask(task.id);
          break;
      }
      setTask(updated);
      setPendingAction(null);
      setActionComment('');
      setActionFile(null);
      setMessage(actionSuccessMessage(pendingAction.key));
    } catch (cause) {
      const actionError = formatApiError(cause, 'Не удалось изменить состояние задачи.');
      await loadTask('refresh');
      setError(actionError);
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, actionComment, actionFile, loadTask, offlineMode, pendingAction, task]);

  const openEdit = useCallback(() => {
    if (!task) return;
    setEditTitle(String(task.title || ''));
    setEditDescription(String(task.description || ''));
    setEditDueDate(taskDueDateInput(task.due_at));
    setEditPriority(TASK_PRIORITY_OPTIONS.some((item) => item.value === task.priority)
      ? task.priority as 'low' | 'normal' | 'high' | 'urgent'
      : 'normal');
    setEditProtocolDate(String(task.protocol_date || '').slice(0, 10));
    const assigneeIds = (Array.isArray(task.assignee_user_ids)
      ? task.assignee_user_ids
      : [task.assignee_user_id])
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0);
    setEditAssigneeIds([...new Set(assigneeIds)]);
    setEditControllerId(Number(task.controller_user_id || 0) || null);
    setEditObserverIds((Array.isArray(task.observer_user_ids) ? task.observer_user_ids : [])
      .map(Number).filter((id) => Number.isInteger(id) && id > 0));
    setEditProjectId(String(task.project_id || ''));
    setEditObjectId(String(task.object_id || ''));
    setEditDepartmentId(String(task.department_id || ''));
    setEditVisibility(['department', 'department_managers'].includes(String(task.visibility_scope || ''))
      ? task.visibility_scope as 'department' | 'department_managers'
      : 'private');
    setEditEmailReminder(task.email_deadline_remind_hours == null ? '' : String(task.email_deadline_remind_hours));
    setEditDirectoryQuery('');
    setEditOpen(true);
    setError('');
    setEditMetaLoading(true);
    void Promise.all([
      searchTaskAssignees('', 100),
      searchTaskControllers('', 100),
      getTaskProjects(),
      getTaskObjects(),
      listDepartments(),
    ]).then(([assignees, controllers, projects, objects, departments]) => {
      setEditAssignees(assignees);
      setEditControllers(controllers);
      setEditProjects(projects);
      setEditObjects(objects);
      setEditDepartments(departments);
    }).catch((cause) => {
      setError(formatApiError(cause, 'Не удалось загрузить справочники для редактирования задачи.'));
    }).finally(() => setEditMetaLoading(false));
  }, [task]);

  const filteredEditAssignees = useMemo(() => {
    const query = editDirectoryQuery.trim().toLocaleLowerCase('ru');
    const items = query ? editAssignees.filter((item) => (
      `${item.full_name || ''} ${item.username || ''} ${item.department || ''} ${item.job_title || ''}`
        .toLocaleLowerCase('ru').includes(query)
    )) : editAssignees;
    return items.slice(0, 40);
  }, [editAssignees, editDirectoryQuery]);

  const filteredEditControllers = useMemo(() => {
    const query = editDirectoryQuery.trim().toLocaleLowerCase('ru');
    const items = query ? editControllers.filter((item) => (
      `${item.full_name || ''} ${item.username || ''} ${item.department || ''}`
        .toLocaleLowerCase('ru').includes(query)
    )) : editControllers;
    return items.slice(0, 40);
  }, [editControllers, editDirectoryQuery]);

  const editProjectObjects = useMemo(
    () => editObjects.filter((item) => !editProjectId || String(item.project_id) === editProjectId),
    [editObjects, editProjectId],
  );

  const saveEdit = useCallback(async () => {
    if (!task || editBusy || offlineMode) return;
    const title = editTitle.trim();
    if (!title) {
      setError('Укажите название задачи.');
      return;
    }
    if (!editAssigneeIds.length) {
      setError('Выберите хотя бы одного исполнителя.');
      return;
    }
    let dueAt: string | null;
    try {
      dueAt = normalizeDueDate(editDueDate);
    } catch (cause) {
      setError(formatApiError(cause, 'Проверьте срок задачи.'));
      return;
    }
    const protocolDate = editProtocolDate.trim();
    if (protocolDate && !/^\d{4}-\d{2}-\d{2}$/.test(protocolDate)) {
      setError('Укажите дату протокола в формате ГГГГ-ММ-ДД.');
      return;
    }
    const reminder = editEmailReminder.trim() === '' ? undefined : Number(editEmailReminder);
    if (reminder !== undefined && (!Number.isInteger(reminder) || reminder < 0 || reminder > 720)) {
      setError('Напоминание должно быть целым числом от 0 до 720 часов.');
      return;
    }
    setEditBusy(true);
    setError('');
    try {
      const updated = await updateTask(task.id, {
        title,
        description: editDescription.trim(),
        due_at: dueAt,
        priority: editPriority,
        protocol_date: protocolDate || undefined,
        assignee_user_ids: editAssigneeIds,
        controller_user_id: editControllerId,
        observer_user_ids: editObserverIds,
        project_id: editProjectId || undefined,
        object_id: editObjectId || null,
        department_id: editDepartmentId || null,
        visibility_scope: editDepartmentId ? editVisibility : 'private',
        email_deadline_remind_hours: dueAt ? reminder : undefined,
      });
      setTask(updated);
      setEditOpen(false);
      setMessage('Задача обновлена.');
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось сохранить задачу.'));
    } finally {
      setEditBusy(false);
    }
  }, [editAssigneeIds, editBusy, editControllerId, editDepartmentId, editDescription, editDueDate, editEmailReminder, editObjectId, editObserverIds, editPriority, editProjectId, editProtocolDate, editTitle, editVisibility, offlineMode, task]);

  const saveChecklist = useCallback(async (items: TaskChecklistItem[], successMessage: string) => {
    if (!task || checklistBusy || offlineMode) return;
    setChecklistBusy(true);
    setError('');
    try {
      const updated = await updateTask(task.id, { checklist_items: items });
      setTask(updated);
      setChecklistText('');
      setMessage(successMessage);
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось обновить чек-лист.'));
    } finally {
      setChecklistBusy(false);
    }
  }, [checklistBusy, offlineMode, task]);

  const addChecklistItem = useCallback(() => {
    const text = checklistText.trim();
    if (!task || !text) return;
    const current = Array.isArray(task.checklist_items) ? task.checklist_items : [];
    void saveChecklist([
      ...current,
      { id: `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text, done: false },
    ], 'Пункт добавлен.');
  }, [checklistText, saveChecklist, task]);

  const toggleChecklistItem = useCallback((item: TaskChecklistItem) => {
    if (!task) return;
    const current = Array.isArray(task.checklist_items) ? task.checklist_items : [];
    void saveChecklist(current.map((candidate) => candidate.id === item.id
      ? { ...candidate, done: !candidate.done }
      : candidate), item.done ? 'Пункт снова открыт.' : 'Пункт выполнен.');
  }, [saveChecklist, task]);

  const removeChecklistItem = useCallback((item: TaskChecklistItem) => {
    if (!task) return;
    const current = Array.isArray(task.checklist_items) ? task.checklist_items : [];
    void saveChecklist(current.filter((candidate) => candidate.id !== item.id), 'Пункт удалён.');
  }, [saveChecklist, task]);

  const chooseActionFile = useCallback(async () => {
    if (fileBusy || offlineMode) return;
    setFileBusy(true);
    setError('');
    try {
      setActionFile(await pickNativeTaskFile());
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось выбрать файл отчёта.'));
    } finally {
      setFileBusy(false);
    }
  }, [fileBusy, offlineMode]);

  const uploadAttachment = useCallback(async () => {
    if (!task || fileBusy || offlineMode) return;
    setFileBusy(true);
    setError('');
    try {
      const picked = await pickNativeTaskFile();
      if (!picked) return;
      await uploadTaskAttachment(task.id, picked);
      await loadTask('refresh');
      setMessage('Файл прикреплён к задаче.');
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось прикрепить файл.'));
    } finally {
      setFileBusy(false);
    }
  }, [fileBusy, loadTask, offlineMode, task]);

  const openAttachment = useCallback(async (attachment: TaskAttachment) => {
    if (!task || fileBusy || offlineMode) return;
    setFileBusy(true);
    setError('');
    try {
      const file = await downloadNativeTaskAttachment(task.id, attachment);
      await openNativeFile(file, attachment.file_mime);
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось открыть файл задачи.'));
    } finally {
      setFileBusy(false);
    }
  }, [fileBusy, offlineMode, task]);

  const sendComment = useCallback(async () => {
    const body = commentText.trim();
    if (!task || !body || commentSending || offlineMode) return;
    setCommentSending(true);
    setError('');
    try {
      const created = await addTaskComment(task.id, body);
      setComments((current) => [...current, created]);
      setCommentText('');
      setTask((current) => current ? {
        ...current,
        comments_count: Number(current.comments_count || 0) + 1,
      } : current);
      setMessage('Комментарий добавлен.');
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось добавить комментарий.'));
    } finally {
      setCommentSending(false);
    }
  }, [commentSending, commentText, offlineMode, task]);

  const openDiscussion = useCallback(async () => {
    if (!task || discussionBusy || offlineMode) return;
    setDiscussionBusy(true);
    setError('');
    try {
      const payload = await openTaskDiscussion(task.id);
      const conversationId = taskDiscussionConversationId(payload);
      if (!conversationId) throw new Error('Сервер не вернул идентификатор чата задачи.');
      router.push({
        pathname: '/(shell)/chat/[conversationId]',
        params: { conversationId },
      } as never);
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось открыть чат задачи.'));
    } finally {
      setDiscussionBusy(false);
    }
  }, [discussionBusy, offlineMode, task]);

  if (!allowed) {
    return (
      <AccountScreenScaffold title="Задача" tokens={tokens} onBack={goBack}>
        <AccountSectionCard tokens={tokens} title="Нет доступа" description="Нужно право tasks.read.">
          {null}
        </AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  if (!taskId) {
    return (
      <AccountScreenScaffold title="Задача" tokens={tokens} onBack={goBack}>
        <Text accessibilityRole="alert" style={{ color: tokens.error }}>Не указан идентификатор задачи.</Text>
      </AccountScreenScaffold>
    );
  }

  return (
    <AccountScreenScaffold
      title="Задача"
      tokens={tokens}
      scroll={false}
      onBack={goBack}
      rightAction={(
        <View style={styles.headerActions}>
          {task?.capabilities?.can_edit ? (
            <Pressable
              testID="native-task-edit-open"
              onPress={openEdit}
              disabled={offlineMode}
              accessibilityRole="button"
              accessibilityLabel="Редактировать задачу"
              accessibilityState={{ disabled: offlineMode }}
              style={styles.headerAction}
            >
              <MaterialCommunityIcons name="pencil-outline" size={21} color={tokens.primary} />
            </Pressable>
          ) : null}
          {task ? (
            <Pressable
              testID="native-task-copy-link"
              onPress={() => { void copyTaskLink(); }}
              accessibilityRole="button"
              accessibilityLabel="Скопировать ссылку на задачу"
              style={styles.headerAction}
            >
              <MaterialCommunityIcons name="link-variant" size={21} color={tokens.iconMuted} />
            </Pressable>
          ) : null}
        </View>
      )}
    >
      <KeyboardAvoidingView
        testID="native-task-detail-keyboard-host"
        style={styles.flex}
        {...chatKeyboardAvoidingProps()}
      >
      {loading && !task ? (
        <AccountLoading tokens={tokens} />
      ) : !task ? (
        <View style={styles.emptyState}>
          <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>
            {error || 'Задача не найдена.'}
          </Text>
          <Pressable
            onPress={() => { void loadTask(); }}
            accessibilityRole="button"
            style={[styles.retryButton, { borderColor: tokens.border }]}
          >
            <Text style={{ color: tokens.primary, fontWeight: '800' }}>Повторить</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.flex}>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[styles.content, { paddingBottom: bottomInset + 88 }]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            refreshControl={undefined}
          >
            {refreshing ? <ActivityIndicator color={tokens.primary} /> : null}
            {offlineMode ? (
              <Text accessibilityRole="alert" style={[styles.offlineText, { color: tokens.warning }]}>
                Автономный режим: действия и комментарии отключены.{cachedAt ? ` Копия от ${formatNativeSnapshotSavedAt(cachedAt)}.` : ''}
              </Text>
            ) : null}
            {error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{error}</Text> : null}
            {message ? (
              <Text accessibilityLiveRegion="polite" style={[styles.message, { color: tokens.success }]}>{message}</Text>
            ) : null}

            <View style={styles.hero}>
              <Text accessibilityRole="header" style={[styles.title, { color: tokens.textPrimary }]}>
                {task.title || 'Задача'}
              </Text>
              <View style={styles.badgeRow}>
                <TaskBadge label={taskStatusLabel(task.status)} color={tokens.primary} tokens={tokens} />
                <TaskBadge label={taskPriorityLabel(task.priority)} color={task.priority === 'urgent' ? tokens.error : tokens.warning} tokens={tokens} />
                {task.is_overdue ? <TaskBadge label="Просрочена" color={tokens.error} tokens={tokens} /> : null}
              </View>
              {presencePeers.filter((peer) => Number(peer.id || 0) !== Number(user?.id || 0)).length ? (
                <Text
                  accessibilityLiveRegion="polite"
                  style={[styles.presence, { color: tokens.textSecondary }]}
                >
                  Сейчас смотрят: {Array.from(new Set(
                    presencePeers
                      .filter((peer) => Number(peer.id || 0) !== Number(user?.id || 0))
                      .map((peer) => String(peer.full_name || peer.username || 'Пользователь').trim()),
                  )).join(', ')}
                </Text>
              ) : null}
              <Text style={[styles.description, { color: tokens.textSecondary }]}>
                {String(task.description || '').trim() || 'Описание задачи не заполнено.'}
              </Text>
            </View>

            {editOpen ? (
              <AccountSectionCard tokens={tokens} title="Редактирование" description="Изменения сохраняются в общей задаче HUB-IT.">
                <Text style={[styles.fieldLabel, { color: tokens.textSecondary }]}>Название</Text>
                <TextInput
                  testID="native-task-edit-title"
                  value={editTitle}
                  onChangeText={setEditTitle}
                  maxLength={200}
                  accessibilityLabel="Название задачи"
                  style={[styles.input, { color: tokens.textPrimary, borderColor: tokens.border }]}
                />
                <Text style={[styles.fieldLabel, { color: tokens.textSecondary }]}>Описание</Text>
                <TextInput
                  testID="native-task-edit-description"
                  value={editDescription}
                  onChangeText={setEditDescription}
                  maxLength={5_000}
                  multiline
                  accessibilityLabel="Описание задачи"
                  style={[styles.textArea, { color: tokens.textPrimary, borderColor: tokens.border }]}
                />
                <Text style={[styles.fieldLabel, { color: tokens.textSecondary }]}>Срок · ГГГГ-ММ-ДД</Text>
                <TextInput
                  testID="native-task-edit-due-date"
                  value={editDueDate}
                  onChangeText={(value) => setEditDueDate(value.slice(0, 10))}
                  placeholder="Без срока"
                  placeholderTextColor={tokens.textTertiary}
                  accessibilityLabel="Дата срока задачи"
                  style={[styles.input, { color: tokens.textPrimary, borderColor: tokens.border }]}
                />
                <Text style={[styles.fieldLabel, { color: tokens.textSecondary }]}>Дата протокола · ГГГГ-ММ-ДД</Text>
                <TextInput
                  testID="native-task-edit-protocol-date"
                  value={editProtocolDate}
                  onChangeText={(value) => setEditProtocolDate(value.slice(0, 10))}
                  placeholder="Не изменять"
                  placeholderTextColor={tokens.textTertiary}
                  accessibilityLabel="Дата протокола задачи"
                  style={[styles.input, { color: tokens.textPrimary, borderColor: tokens.border }]}
                />
                <Text style={[styles.fieldLabel, { color: tokens.textSecondary }]}>Напомнить по e-mail за часов</Text>
                <TextInput
                  testID="native-task-edit-email-reminder"
                  value={editEmailReminder}
                  onChangeText={(value) => setEditEmailReminder(value.replace(/\D/g, '').slice(0, 3))}
                  keyboardType="number-pad"
                  placeholder="Без отдельного напоминания"
                  placeholderTextColor={tokens.textTertiary}
                  accessibilityLabel="Напоминание о сроке по электронной почте в часах"
                  style={[styles.input, { color: tokens.textPrimary, borderColor: tokens.border }]}
                />
                <View accessibilityRole="radiogroup" style={styles.chipRow}>
                  {TASK_PRIORITY_OPTIONS.map((option) => {
                    const selected = editPriority === option.value;
                    return (
                      <Pressable
                        key={option.value}
                        testID={`native-task-edit-priority-${option.value}`}
                        onPress={() => setEditPriority(option.value)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        style={[styles.chip, { backgroundColor: selected ? tokens.primary : tokens.actionBg, borderColor: selected ? tokens.primary : tokens.border }]}
                      >
                        <Text style={{ color: selected ? '#fff' : tokens.textPrimary, fontWeight: '800' }}>{option.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {editMetaLoading ? <ActivityIndicator color={tokens.primary} style={styles.editMetaLoading} /> : (
                  <>
                    <Text style={[styles.fieldLabel, { color: tokens.textSecondary }]}>Поиск участников</Text>
                    <TextInput
                      testID="native-task-edit-user-search"
                      value={editDirectoryQuery}
                      onChangeText={setEditDirectoryQuery}
                      placeholder="ФИО, логин, отдел или должность"
                      placeholderTextColor={tokens.textTertiary}
                      accessibilityLabel="Поиск участников задачи"
                      style={[styles.input, { color: tokens.textPrimary, borderColor: tokens.border }]}
                    />

                    <Text style={[styles.editGroupTitle, { color: tokens.textPrimary }]}>Исполнители</Text>
                    <View style={styles.editDirectoryList}>
                      {filteredEditAssignees.map((person) => {
                        const personId = Number(person.id);
                        const selected = editAssigneeIds.includes(personId);
                        return (
                          <Pressable
                            key={`assignee-${person.id}`}
                            testID={`native-task-edit-assignee-${person.id}`}
                            onPress={() => {
                              if (selected && editAssigneeIds.length === 1) return;
                              setEditAssigneeIds((current) => selected
                                ? current.filter((id) => id !== personId)
                                : [...current, personId]);
                              if (!selected) {
                                setEditObserverIds((current) => current.filter((id) => id !== personId));
                              }
                            }}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: selected, disabled: selected && editAssigneeIds.length === 1 }}
                            style={[styles.editDirectoryRow, { borderColor: selected ? tokens.selectedBorder : tokens.borderSoft, backgroundColor: selected ? tokens.selected : tokens.actionBg }]}
                          >
                            <MaterialCommunityIcons name={selected ? 'checkbox-marked-outline' : 'checkbox-blank-outline'} size={20} color={selected ? tokens.primary : tokens.iconMuted} />
                            <View style={styles.editDirectoryBody}>
                              <Text style={{ color: tokens.textPrimary, fontWeight: '800' }}>{person.full_name || person.username || person.id}</Text>
                              <Text style={{ color: tokens.textSecondary, fontSize: 12 }}>{[person.job_title, person.department].filter(Boolean).join(' · ') || person.username}</Text>
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>

                    <Text style={[styles.editGroupTitle, { color: tokens.textPrimary }]}>Контролёр</Text>
                    <View accessibilityRole="radiogroup" style={styles.editDirectoryList}>
                      <Pressable
                        testID="native-task-edit-controller-none"
                        onPress={() => setEditControllerId(null)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: editControllerId == null }}
                        style={[styles.editDirectoryRow, { borderColor: editControllerId == null ? tokens.selectedBorder : tokens.borderSoft, backgroundColor: editControllerId == null ? tokens.selected : tokens.actionBg }]}
                      >
                        <MaterialCommunityIcons name={editControllerId == null ? 'radiobox-marked' : 'radiobox-blank'} size={20} color={editControllerId == null ? tokens.primary : tokens.iconMuted} />
                        <Text style={{ color: tokens.textPrimary, fontWeight: '800' }}>Без контролёра</Text>
                      </Pressable>
                      {filteredEditControllers.map((person) => {
                        const selected = editControllerId === Number(person.id);
                        return (
                          <Pressable
                            key={`controller-${person.id}`}
                            testID={`native-task-edit-controller-${person.id}`}
                            onPress={() => setEditControllerId(Number(person.id))}
                            accessibilityRole="radio"
                            accessibilityState={{ selected }}
                            style={[styles.editDirectoryRow, { borderColor: selected ? tokens.selectedBorder : tokens.borderSoft, backgroundColor: selected ? tokens.selected : tokens.actionBg }]}
                          >
                            <MaterialCommunityIcons name={selected ? 'radiobox-marked' : 'radiobox-blank'} size={20} color={selected ? tokens.primary : tokens.iconMuted} />
                            <Text style={{ color: tokens.textPrimary, fontWeight: '800', flex: 1 }}>{person.full_name || person.username || person.id}</Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    <Text style={[styles.editGroupTitle, { color: tokens.textPrimary }]}>Наблюдатели</Text>
                    <View style={styles.editDirectoryList}>
                      {filteredEditAssignees.map((person) => {
                        const personId = Number(person.id);
                        const unavailable = editAssigneeIds.includes(personId);
                        const selected = !unavailable && editObserverIds.includes(personId);
                        return (
                          <Pressable
                            key={`observer-${person.id}`}
                            testID={`native-task-edit-observer-${person.id}`}
                            onPress={() => {
                              if (unavailable) return;
                              setEditObserverIds((current) => selected
                                ? current.filter((id) => id !== personId)
                                : [...current, personId]);
                            }}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: selected, disabled: unavailable }}
                            style={[styles.editDirectoryRow, { borderColor: selected ? tokens.selectedBorder : tokens.borderSoft, backgroundColor: selected ? tokens.selected : tokens.actionBg }]}
                          >
                            <MaterialCommunityIcons name={selected ? 'checkbox-marked-outline' : 'checkbox-blank-outline'} size={20} color={selected ? tokens.primary : tokens.iconMuted} />
                            <Text style={{ color: tokens.textPrimary, fontWeight: '800', flex: 1 }}>{person.full_name || person.username || person.id}</Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    <TaskEditChoiceGroup
                      title="Проект"
                      testPrefix="native-task-edit-project"
                      items={editProjects.map((item) => ({ id: String(item.id), label: item.name }))}
                      value={editProjectId}
                      onChange={(value) => {
                        setEditProjectId(value);
                        if (!editObjects.some((item) => String(item.id) === editObjectId && String(item.project_id) === value)) setEditObjectId('');
                      }}
                      tokens={tokens}
                    />
                    <TaskEditChoiceGroup
                      title="Объект"
                      testPrefix="native-task-edit-object"
                      items={[{ id: '', label: 'Без объекта' }, ...editProjectObjects.map((item) => ({ id: String(item.id), label: item.name }))]}
                      value={editObjectId}
                      onChange={setEditObjectId}
                      tokens={tokens}
                    />
                    <TaskEditChoiceGroup
                      title="Отдел"
                      testPrefix="native-task-edit-department"
                      items={[{ id: '', label: 'Без отдела' }, ...editDepartments.map((item) => ({ id: String(item.id), label: item.name || String(item.id) }))]}
                      value={editDepartmentId}
                      onChange={(value) => {
                        setEditDepartmentId(value);
                        if (!value) setEditVisibility('private');
                      }}
                      tokens={tokens}
                    />
                    <TaskEditChoiceGroup
                      title="Видимость"
                      testPrefix="native-task-edit-visibility"
                      items={[
                        { id: 'private', label: 'Только участники' },
                        { id: 'department', label: 'Весь отдел' },
                        { id: 'department_managers', label: 'Руководители отдела' },
                      ]}
                      value={editDepartmentId ? editVisibility : 'private'}
                      onChange={(value) => setEditVisibility(value as 'private' | 'department' | 'department_managers')}
                      disabled={!editDepartmentId}
                      tokens={tokens}
                    />
                  </>
                )}
                <View style={styles.confirmActions}>
                  <Pressable onPress={() => setEditOpen(false)} disabled={editBusy} accessibilityRole="button" style={[styles.confirmButton, { borderColor: tokens.border }]}>
                    <Text style={{ color: tokens.textPrimary, fontWeight: '800' }}>Отмена</Text>
                  </Pressable>
                  <Pressable
                    testID="native-task-edit-save"
                    onPress={() => { void saveEdit(); }}
                    disabled={editBusy || offlineMode}
                    accessibilityRole="button"
                    accessibilityState={{ busy: editBusy, disabled: editBusy || offlineMode }}
                    style={[styles.confirmButton, { backgroundColor: tokens.primary, opacity: editBusy || offlineMode ? 0.55 : 1 }]}
                  >
                    {editBusy ? <ActivityIndicator size="small" color="#fff" /> : null}
                    <Text style={styles.confirmLabel}>Сохранить</Text>
                  </Pressable>
                </View>
              </AccountSectionCard>
            ) : null}

            <AccountSectionCard tokens={tokens} title="Участники и срок">
              <AccountField tokens={tokens} label="Постановщик" value={taskPerson(task, 'created_by')} />
              <AccountField tokens={tokens} label="Исполнители" value={taskPerson(task, 'assignee')} />
              <AccountField tokens={tokens} label="Контролёр" value={taskPerson(task, 'controller')} />
              <AccountField tokens={tokens} label="Срок" value={formatTaskDate(task.due_at)} />
              {task.project_name ? <AccountField tokens={tokens} label="Проект" value={task.project_name} /> : null}
              {task.object_name ? <AccountField tokens={tokens} label="Объект" value={task.object_name} /> : null}
            </AccountSectionCard>

            <AccountSectionCard
              tokens={tokens}
              title={`Чек-лист · ${(task.checklist_items || []).filter((item) => item.done).length}/${(task.checklist_items || []).length}`}
              description={task.capabilities?.can_update_checklist ? 'Отмечайте выполненные пункты — состояние сразу синхронизируется с HUB-IT.' : 'Чек-лист доступен только для просмотра.'}
            >
              {(task.checklist_items || []).length ? (task.checklist_items || []).map((item) => (
                <View key={item.id} style={[styles.checklistRow, { borderColor: tokens.borderSoft }]}>
                  <Pressable
                    testID={`native-task-checklist-toggle-${item.id}`}
                    onPress={() => toggleChecklistItem(item)}
                    disabled={!task.capabilities?.can_update_checklist || checklistBusy || offlineMode}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: item.done, disabled: !task.capabilities?.can_update_checklist || checklistBusy || offlineMode }}
                    style={styles.checklistMain}
                  >
                    <MaterialCommunityIcons name={item.done ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'} size={23} color={item.done ? tokens.success : tokens.iconMuted} />
                    <Text style={[styles.checklistText, { color: tokens.textPrimary, textDecorationLine: item.done ? 'line-through' : 'none' }]}>{item.text}</Text>
                  </Pressable>
                  {task.capabilities?.can_update_checklist ? (
                    <Pressable
                      testID={`native-task-checklist-remove-${item.id}`}
                      onPress={() => removeChecklistItem(item)}
                      disabled={checklistBusy || offlineMode}
                      accessibilityRole="button"
                      accessibilityLabel={`Удалить пункт: ${item.text}`}
                      style={styles.inlineIconButton}
                    >
                      <MaterialCommunityIcons name="close" size={20} color={tokens.error} />
                    </Pressable>
                  ) : null}
                </View>
              )) : <Text style={{ color: tokens.textSecondary }}>Пунктов пока нет.</Text>}
              {task.capabilities?.can_update_checklist ? (
                <View style={styles.addRow}>
                  <TextInput
                    testID="native-task-checklist-input"
                    value={checklistText}
                    onChangeText={setChecklistText}
                    onSubmitEditing={addChecklistItem}
                    editable={!checklistBusy && !offlineMode}
                    maxLength={500}
                    placeholder="Новый пункт"
                    placeholderTextColor={tokens.textTertiary}
                    accessibilityLabel="Новый пункт чек-листа"
                    style={[styles.addInput, { color: tokens.textPrimary, borderColor: tokens.border }]}
                  />
                  <Pressable
                    testID="native-task-checklist-add"
                    onPress={addChecklistItem}
                    disabled={checklistBusy || offlineMode || !checklistText.trim()}
                    accessibilityRole="button"
                    accessibilityLabel="Добавить пункт чек-листа"
                    accessibilityState={{ disabled: checklistBusy || offlineMode || !checklistText.trim() }}
                    style={[styles.addButton, { backgroundColor: tokens.primary, opacity: checklistBusy || offlineMode || !checklistText.trim() ? 0.5 : 1 }]}
                  >
                    {checklistBusy ? <ActivityIndicator size="small" color="#fff" /> : <MaterialCommunityIcons name="plus" size={22} color="#fff" />}
                  </Pressable>
                </View>
              ) : null}
            </AccountSectionCard>

            <AccountSectionCard tokens={tokens} title={`Файлы · ${(task.attachments || []).length}`} description="Открывайте оригиналы или прикрепляйте новый файл размером до 20 МБ.">
              {(task.attachments || []).length ? (task.attachments || []).map((attachment) => (
                <Pressable
                  key={attachment.id}
                  testID={`native-task-attachment-${attachment.id}`}
                  onPress={() => { void openAttachment(attachment); }}
                  disabled={fileBusy || offlineMode}
                  accessibilityRole="button"
                  accessibilityLabel={`Открыть файл ${attachment.file_name}`}
                  accessibilityState={{ disabled: fileBusy || offlineMode }}
                  style={[styles.fileRow, { borderColor: tokens.borderSoft }]}
                >
                  <MaterialCommunityIcons name="file-outline" size={23} color={tokens.primary} />
                  <View style={styles.flex}>
                    <Text numberOfLines={2} style={[styles.fileName, { color: tokens.textPrimary }]}>{attachment.file_name}</Text>
                    <Text style={[styles.fileMeta, { color: tokens.textSecondary }]}>{taskFileSize(attachment.file_size)} · {formatTaskDate(attachment.uploaded_at)}</Text>
                  </View>
                  <MaterialCommunityIcons name="open-in-new" size={19} color={tokens.iconMuted} />
                </Pressable>
              )) : <Text style={{ color: tokens.textSecondary }}>Файлов пока нет.</Text>}
              {task.capabilities?.can_upload_files ? (
                <Pressable
                  testID="native-task-attachment-upload"
                  onPress={() => { void uploadAttachment(); }}
                  disabled={fileBusy || offlineMode}
                  accessibilityRole="button"
                  accessibilityState={{ busy: fileBusy, disabled: fileBusy || offlineMode }}
                  style={[styles.uploadButton, { borderColor: tokens.primary, opacity: fileBusy || offlineMode ? 0.55 : 1 }]}
                >
                  {fileBusy ? <ActivityIndicator size="small" color={tokens.primary} /> : <MaterialCommunityIcons name="paperclip" size={20} color={tokens.primary} />}
                  <Text style={{ color: tokens.primary, fontWeight: '800' }}>Прикрепить файл</Text>
                </Pressable>
              ) : null}
            </AccountSectionCard>

            {getTaskActions(task.capabilities).length ? (
              <AccountSectionCard
                tokens={tokens}
                title="Действия"
                description="Доступны только операции, разрешённые сервером."
              >
                <View style={styles.actions}>
                  {getTaskActions(task.capabilities).map((action) => (
                    <Pressable
                      key={action.key}
                      testID={`native-task-action-${action.key}`}
                      disabled={offlineMode || actionBusy}
                      onPress={() => {
                        setPendingAction(action);
                        setActionComment('');
                        setError('');
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: offlineMode || actionBusy }}
                      style={[
                        styles.actionButton,
                        {
                          borderColor: action.tone === 'danger' ? tokens.error : tokens.border,
                          backgroundColor: action.tone === 'success' ? `${tokens.success}14` : tokens.actionBg,
                          opacity: offlineMode || actionBusy ? 0.5 : 1,
                        },
                      ]}
                    >
                      <Text style={{ color: action.tone === 'danger' ? tokens.error : tokens.textPrimary, fontWeight: '800' }}>
                        {action.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </AccountSectionCard>
            ) : null}

            {pendingAction ? (
              <AccountSectionCard
                tokens={tokens}
                title={pendingAction.label}
                description="Подтвердите изменение состояния задачи."
              >
                {['submit', 'approve', 'reject', 'complete'].includes(pendingAction.key) ? (
                  <TextInput
                    testID="native-task-action-comment"
                    value={actionComment}
                    onChangeText={setActionComment}
                    placeholder={pendingAction.commentRequired ? 'Комментарий обязателен' : 'Комментарий (необязательно)'}
                    placeholderTextColor={tokens.textTertiary}
                    accessibilityLabel="Комментарий к действию"
                    multiline
                    style={[styles.textArea, { color: tokens.textPrimary, borderColor: tokens.border }]}
                  />
                ) : null}
                {pendingAction.key === 'submit' ? (
                  <View style={styles.reportFileBlock}>
                    <Pressable
                      testID="native-task-submit-file"
                      onPress={() => { void chooseActionFile(); }}
                      disabled={fileBusy || offlineMode}
                      accessibilityRole="button"
                      accessibilityState={{ busy: fileBusy, disabled: fileBusy || offlineMode }}
                      style={[styles.uploadButton, { borderColor: tokens.primary }]}
                    >
                      <MaterialCommunityIcons name="file-upload-outline" size={20} color={tokens.primary} />
                      <Text style={{ color: tokens.primary, fontWeight: '800' }}>{actionFile ? 'Заменить файл отчёта' : 'Добавить файл отчёта'}</Text>
                    </Pressable>
                    {actionFile ? (
                      <View style={styles.selectedFileRow}>
                        <Text numberOfLines={2} style={[styles.fileName, { color: tokens.textPrimary }]}>{actionFile.name} · {taskFileSize(actionFile.size)}</Text>
                        <Pressable onPress={() => setActionFile(null)} accessibilityRole="button" accessibilityLabel="Убрать файл отчёта" style={styles.inlineIconButton}>
                          <MaterialCommunityIcons name="close" size={20} color={tokens.error} />
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                ) : null}
                <View style={styles.confirmActions}>
                  <Pressable
                    onPress={() => {
                      setPendingAction(null);
                      setActionComment('');
                      setActionFile(null);
                    }}
                    accessibilityRole="button"
                    style={[styles.confirmButton, { borderColor: tokens.border }]}
                  >
                    <Text style={{ color: tokens.textPrimary, fontWeight: '800' }}>Отмена</Text>
                  </Pressable>
                  <Pressable
                    testID="native-task-action-confirm"
                    onPress={() => { void executeAction(); }}
                    disabled={actionBusy}
                    accessibilityRole="button"
                    accessibilityState={{ busy: actionBusy, disabled: actionBusy }}
                    style={[styles.confirmButton, { backgroundColor: tokens.primary, opacity: actionBusy ? 0.6 : 1 }]}
                  >
                    {actionBusy ? <ActivityIndicator size="small" color="#fff" /> : null}
                    <Text style={styles.confirmLabel}>Подтвердить</Text>
                  </Pressable>
                </View>
              </AccountSectionCard>
            ) : null}

            <AccountSectionCard tokens={tokens} title={`История статусов (${statusLog.length})`}>
              {statusLogError ? (
                <Text accessibilityRole="alert" style={[styles.error, { color: tokens.warning }]}>{statusLogError}</Text>
              ) : null}
              {statusLog.length ? statusLog.map((item, index) => (
                <View key={String(item.id || `${item.changed_at || ''}-${index}`)} style={[styles.historyRow, { borderColor: tokens.borderSoft }]}>
                  <MaterialCommunityIcons name="history" size={20} color={tokens.primary} />
                  <View style={styles.flex}>
                    <Text style={[styles.historyTitle, { color: tokens.textPrimary }]}>
                      {taskStatusLabel(item.old_status)} → {taskStatusLabel(item.new_status)}
                    </Text>
                    <Text style={[styles.fileMeta, { color: tokens.textSecondary }]}>
                      {String(item.changed_by_username || '').trim() || 'Система'} · {formatTaskDate(item.changed_at)}
                    </Text>
                  </View>
                </View>
              )) : !statusLogError ? (
                <Text style={{ color: tokens.textSecondary }}>Изменений статуса пока нет.</Text>
              ) : null}
            </AccountSectionCard>

            {canDeleteTask ? (
              <AccountSectionCard tokens={tokens} title="Удаление задачи" description="Удаление доступно автору задачи и администратору.">
                {deleteConfirmOpen ? (
                  <View style={styles.deleteConfirm}>
                    <Text accessibilityRole="alert" style={{ color: tokens.error, fontWeight: '700' }}>
                      Удалить задачу без возможности восстановления?
                    </Text>
                    <View style={styles.confirmActions}>
                      <Pressable
                        testID="native-task-delete-cancel"
                        onPress={() => setDeleteConfirmOpen(false)}
                        disabled={deleteBusy}
                        accessibilityRole="button"
                        style={[styles.confirmButton, { borderColor: tokens.border }]}
                      >
                        <Text style={{ color: tokens.textPrimary, fontWeight: '800' }}>Отмена</Text>
                      </Pressable>
                      <Pressable
                        testID="native-task-delete-confirm"
                        onPress={() => { void confirmDeleteTask(); }}
                        disabled={deleteBusy || offlineMode}
                        accessibilityRole="button"
                        accessibilityState={{ busy: deleteBusy, disabled: deleteBusy || offlineMode }}
                        style={[styles.confirmButton, { backgroundColor: tokens.error, opacity: deleteBusy || offlineMode ? 0.55 : 1 }]}
                      >
                        {deleteBusy ? <ActivityIndicator size="small" color="#fff" /> : null}
                        <Text style={styles.confirmLabel}>Удалить</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Pressable
                    testID="native-task-delete-open"
                    onPress={() => setDeleteConfirmOpen(true)}
                    disabled={offlineMode}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: offlineMode }}
                    style={[styles.uploadButton, { borderColor: tokens.error, opacity: offlineMode ? 0.55 : 1 }]}
                  >
                    <MaterialCommunityIcons name="delete-outline" size={20} color={tokens.error} />
                    <Text style={{ color: tokens.error, fontWeight: '800' }}>Удалить задачу</Text>
                  </Pressable>
                )}
              </AccountSectionCard>
            ) : null}

            {task.capabilities?.can_open_discussion ? (
              <AccountSectionCard
                tokens={tokens}
                title="Обсуждение"
                description="Комментарии задачи ведутся в корпоративном чате."
              >
                <Pressable
                  testID="native-task-open-discussion"
                  onPress={() => { void openDiscussion(); }}
                  disabled={discussionBusy || offlineMode}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: discussionBusy || offlineMode, busy: discussionBusy }}
                  style={[
                    styles.discussionButton,
                    { backgroundColor: tokens.primary, opacity: discussionBusy || offlineMode ? 0.6 : 1 },
                  ]}
                >
                  <MaterialCommunityIcons name="forum-outline" size={20} color="#fff" />
                  <Text style={styles.confirmLabel}>{discussionBusy ? 'Открываем…' : 'Открыть чат задачи'}</Text>
                </Pressable>
              </AccountSectionCard>
            ) : (
              <AccountSectionCard tokens={tokens} title={`Комментарии (${comments.length})`}>
                {comments.length === 0 ? (
                  <Text style={{ color: tokens.textSecondary }}>Комментариев пока нет.</Text>
                ) : comments.map((comment) => (
                  <View key={String(comment.id)} style={[styles.comment, { borderColor: tokens.borderSoft }]}>
                    <Text style={[styles.commentAuthor, { color: tokens.textPrimary }]}>{commentAuthor(comment)}</Text>
                    <Text style={[styles.commentDate, { color: tokens.textTertiary }]}>{formatTaskDate(comment.created_at)}</Text>
                    <Text style={[styles.commentBody, { color: tokens.textPrimary }]}>{comment.body}</Text>
                  </View>
                ))}
              </AccountSectionCard>
            )}
          </ScrollView>

          {!task.capabilities?.can_open_discussion ? (
            <View style={[styles.composer, { backgroundColor: tokens.navBg, borderTopColor: tokens.borderSoft }]}>
              <TextInput
                testID="native-task-comment-input"
                value={commentText}
                onChangeText={setCommentText}
                placeholder="Комментарий"
                placeholderTextColor={tokens.textTertiary}
                accessibilityLabel="Новый комментарий"
                multiline
                editable={!offlineMode}
                style={[styles.composerInput, { color: tokens.textPrimary, borderColor: tokens.border }]}
              />
              <Pressable
                testID="native-task-comment-send"
                onPress={() => { void sendComment(); }}
                disabled={commentSending || offlineMode || !commentText.trim()}
                accessibilityRole="button"
                accessibilityLabel="Отправить комментарий"
                accessibilityState={{ disabled: commentSending || offlineMode || !commentText.trim() }}
                style={[
                  styles.sendButton,
                  { backgroundColor: tokens.primary, opacity: commentSending || offlineMode || !commentText.trim() ? 0.5 : 1 },
                ]}
              >
                {commentSending ? <ActivityIndicator size="small" color="#fff" /> : (
                  <MaterialCommunityIcons name="send" size={19} color="#fff" />
                )}
              </Pressable>
            </View>
          ) : null}
        </View>
      )}
      </KeyboardAvoidingView>
    </AccountScreenScaffold>
  );
}

function TaskBadge({ label, color, tokens }: {
  label: string;
  color: string;
  tokens: FluentTokens;
}) {
  return (
    <View style={[styles.badge, { backgroundColor: `${color}18`, borderColor: `${color}35` }]}>
      <Text style={{ color: color || tokens.textSecondary, fontSize: 12, fontWeight: '800' }}>{label}</Text>
    </View>
  );
}

function TaskEditChoiceGroup({
  title,
  testPrefix,
  items,
  value,
  onChange,
  disabled = false,
  tokens,
}: {
  title: string;
  testPrefix: string;
  items: Array<{ id: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  tokens: FluentTokens;
}) {
  return (
    <View style={styles.editChoiceGroup}>
      <Text style={[styles.editGroupTitle, { color: tokens.textPrimary }]}>{title}</Text>
      <View accessibilityRole="radiogroup" style={styles.chipRow}>
        {items.map((item) => {
          const selected = value === item.id;
          return (
            <Pressable
              key={`${testPrefix}-${item.id || 'none'}`}
              testID={`${testPrefix}-${item.id || 'none'}`}
              onPress={() => onChange(item.id)}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled }}
              style={[
                styles.chip,
                {
                  opacity: disabled ? 0.45 : 1,
                  backgroundColor: selected ? tokens.primary : tokens.actionBg,
                  borderColor: selected ? tokens.primary : tokens.border,
                },
              ]}
            >
              <Text style={{ color: selected ? '#fff' : tokens.textPrimary, fontWeight: '800' }}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  headerAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { gap: 16 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  error: { fontSize: 13, fontWeight: '700' },
  message: { fontSize: 13, fontWeight: '700' },
  offlineText: { fontSize: 13, fontWeight: '700' },
  retryButton: { minHeight: 44, minWidth: 120, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  hero: { gap: 10 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '900' },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge: { minHeight: 30, borderRadius: 15, borderWidth: 1, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  presence: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  description: { fontSize: 15, lineHeight: 22 },
  fieldLabel: { marginTop: 4, fontSize: 12, lineHeight: 17, fontWeight: '800' },
  editMetaLoading: { marginVertical: 18 },
  editGroupTitle: { marginTop: 12, marginBottom: 6, fontSize: 13, fontWeight: '900' },
  editDirectoryList: { gap: 6 },
  editDirectoryRow: { minHeight: 46, borderWidth: 1, borderRadius: 11, paddingHorizontal: 10, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 8 },
  editDirectoryBody: { flex: 1, minWidth: 0 },
  editChoiceGroup: { marginTop: 4 },
  input: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: { minHeight: 42, borderWidth: 1, borderRadius: 21, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  checklistRow: { minHeight: 48, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  checklistMain: { minHeight: 48, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  checklistText: { flex: 1, fontSize: 14, lineHeight: 20 },
  inlineIconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  addInput: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15 },
  addButton: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  fileRow: { minHeight: 58, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  fileName: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  fileMeta: { marginTop: 2, fontSize: 12, lineHeight: 17 },
  historyRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  historyTitle: { fontSize: 14, fontWeight: '800' },
  uploadButton: { minHeight: 44, marginTop: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  reportFileBlock: { marginTop: 2 },
  selectedFileRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  actions: { gap: 10 },
  actionButton: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  textArea: { minHeight: 88, maxHeight: 160, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, textAlignVertical: 'top' },
  confirmActions: { flexDirection: 'row', gap: 12, marginTop: 12 },
  confirmButton: { flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: 'transparent', flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  confirmLabel: { color: '#fff', fontWeight: '800', fontSize: 14 },
  deleteConfirm: { gap: 12 },
  discussionButton: { minHeight: 48, borderRadius: 12, paddingHorizontal: 14, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  comment: { borderTopWidth: 1, paddingVertical: 10 },
  commentAuthor: { fontSize: 13, fontWeight: '800' },
  commentDate: { marginTop: 2, fontSize: 11 },
  commentBody: { marginTop: 6, fontSize: 14, lineHeight: 20 },
  composer: { borderTopWidth: 1, paddingTop: 8, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  composerInput: { flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  sendButton: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
