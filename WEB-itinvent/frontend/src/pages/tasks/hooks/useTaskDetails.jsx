import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { hubAPI } from '../../../api/client';
import TaskDetailChecklist from '../../../components/hub/tasks/TaskDetailChecklist';
import { isTransferActUploadTask } from '../../../lib/hubTaskIntegrations';
import { invalidateSWRCacheByPrefix } from '../../../lib/swrCache';
import {
  buildTaskDetailPath,
  getDefaultTaskDetailTab,
  normalizeTaskDetailTab,
} from '../../../lib/taskNavigation';
import { createChecklistItemId } from '../taskChecklistUtils';

export default function useTaskDetails({
  user,
  canManageAllTasks,
  canReviewTasks,
  taskDiscussionChatEnabled,
  isMobile,
  ui,
  setError,
  patchTaskItem,
  loadTasks,
  departments = [],
}) {
  const navigate = useNavigate();
  const location = useLocation();

  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsTask, setDetailsTask] = useState(null);
  const [detailsComments, setDetailsComments] = useState([]);
  const [detailsStatusLog, setDetailsStatusLog] = useState([]);
  const [detailsActivityLoading, setDetailsActivityLoading] = useState(false);
  const [detailsLoadNonce, setDetailsLoadNonce] = useState(0);
  const [detailsCommentBody, setDetailsCommentBody] = useState('');
  const [detailsCommentSaving, setDetailsCommentSaving] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [discussionOpening, setDiscussionOpening] = useState(false);

  const taskDetailHistorySeededRef = useRef(false);
  const mobileChecklistHistoryPushedRef = useRef(false);
  const loadTaskDetailsRequestRef = useRef(0);
  const checklistMutationRef = useRef(new Map());
  const loadedActivityRef = useRef({ taskId: '', comments: false, history: false });

  const selectedTaskId = useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return String(params.get('task') || '').trim();
  }, [location.search]);

  const selectedTaskTab = useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return normalizeTaskDetailTab(params.get('task_tab'), taskDiscussionChatEnabled);
  }, [location.search, taskDiscussionChatEnabled]);

  const selectedMobileTaskView = useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return String(params.get('task_mobile_view') || '').trim() === 'checklist' ? 'checklist' : 'details';
  }, [location.search]);

  const detailsOpen = Boolean(selectedTaskId);

  const updateSearch = useCallback((mutate, { replace = true } = {}) => {
    const params = new URLSearchParams(location.search || '');
    mutate(params);
    const nextSearch = params.toString();
    const currentSearch = String(location.search || '').replace(/^\?/, '');
    if (nextSearch === currentSearch) return;
    navigate(
      { pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : '' },
      { replace },
    );
  }, [location.pathname, location.search, navigate]);

  useEffect(() => {
    if (selectedMobileTaskView !== 'checklist') {
      mobileChecklistHistoryPushedRef.current = false;
    }
  }, [selectedMobileTaskView]);

  const loadTaskActivity = useCallback(async (taskId, tab, options = {}) => {
    const normalizedId = String(taskId || '').trim();
    if (!normalizedId || tab === 'files') return;
    if (loadedActivityRef.current.taskId !== normalizedId) {
      loadedActivityRef.current = { taskId: normalizedId, comments: false, history: false };
    }
    const ledger = loadedActivityRef.current;
    const isHistory = tab === 'history';
    if (isHistory ? ledger.history : ledger.comments) return;
    if (isHistory) ledger.history = true; else ledger.comments = true;

    const stillCurrent = () => loadedActivityRef.current.taskId === normalizedId;
    setDetailsActivityLoading(true);
    try {
      if (isHistory) {
        const res = await hubAPI.getTaskStatusLog(normalizedId);
        if (!stillCurrent()) return;
        setDetailsStatusLog(Array.isArray(res?.items) ? res.items : []);
      } else {
        const res = await hubAPI.getTaskComments(normalizedId);
        if (!stillCurrent()) return;
        setDetailsComments(Array.isArray(res?.items) ? res.items : []);
        if (options.hasUnread) {
          try {
            await hubAPI.markTaskCommentsSeen(normalizedId);
            if (!stillCurrent()) return;
            patchTaskItem(normalizedId, { has_unread_comments: false });
            setDetailsTask((prev) => (
              prev && String(prev.id || '') === normalizedId
                ? { ...prev, has_unread_comments: false }
                : prev
            ));
            window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
          } catch {
            // ignore
          }
        }
      }
    } catch {
      if (isHistory) ledger.history = false; else ledger.comments = false;
    } finally {
      if (stillCurrent()) setDetailsActivityLoading(false);
    }
  }, [patchTaskItem]);

  const loadTaskDetails = useCallback(async (taskId) => {
    const normalizedId = String(taskId || '').trim();
    if (!normalizedId) return;
    const requestId = loadTaskDetailsRequestRef.current + 1;
    loadTaskDetailsRequestRef.current = requestId;
    const isStale = () => loadTaskDetailsRequestRef.current !== requestId;
    loadedActivityRef.current = { taskId: normalizedId, comments: false, history: false };
    setDetailsLoading(true);
    setDetailsActivityLoading(true);
    try {
      const task = await hubAPI.getTask(normalizedId);
      if (isStale()) return;
      patchTaskItem(normalizedId, task || {});
      setDetailsTask(task || null);
      setDetailsLoading(false);
      setDetailsLoadNonce((prev) => prev + 1);
      if (typeof window !== 'undefined') {
        const scheduleIdle = window.requestIdleCallback
          ? (cb) => window.requestIdleCallback(cb, { timeout: 1000 })
          : (cb) => window.setTimeout(cb, 400);
        scheduleIdle(() => {
          if (!isStale()) window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
        });
      }
    } catch (err) {
      if (isStale()) return;
      setDetailsTask(null);
      setDetailsComments([]);
      setDetailsStatusLog([]);
      setDetailsActivityLoading(false);
      setError(err?.response?.data?.detail || err?.message || 'Ошибка загрузки карточки задачи');
    } finally {
      if (loadTaskDetailsRequestRef.current === requestId) setDetailsLoading(false);
    }
  }, [patchTaskItem, setError]);

  useEffect(() => {
    if (isMobile || !detailsTask?.id) return;
    const normalizedId = String(detailsTask.id || '').trim();
    if (!normalizedId || normalizedId !== String(selectedTaskId || '').trim()) return;
    void loadTaskActivity(normalizedId, selectedTaskTab, {
      hasUnread: selectedTaskTab === 'comments' && Boolean(detailsTask.has_unread_comments),
    });
  }, [isMobile, detailsTask?.id, detailsTask?.has_unread_comments, selectedTaskId, selectedTaskTab, detailsLoadNonce, loadTaskActivity]);

  useEffect(() => {
    if (!selectedTaskId) {
      taskDetailHistorySeededRef.current = false;
      mobileChecklistHistoryPushedRef.current = false;
      setDetailsTask(null);
      setDetailsComments([]);
      setDetailsStatusLog([]);
      setDetailsActivityLoading(false);
      setDetailsCommentBody('');
      return;
    }
    void loadTaskDetails(selectedTaskId);
  }, [loadTaskDetails, selectedTaskId]);

  useLayoutEffect(() => {
    if (!isMobile || !selectedTaskId || taskDetailHistorySeededRef.current || typeof window === 'undefined') return;
    const historyIdx = window.history.state?.idx;
    if (typeof historyIdx === 'number' && historyIdx > 0) {
      taskDetailHistorySeededRef.current = true;
      return;
    }
    const listParams = new URLSearchParams(location.search || '');
    listParams.delete('task');
    listParams.delete('task_tab');
    listParams.delete('task_mobile_view');
    const listHref = `${location.pathname}${listParams.toString() ? `?${listParams.toString()}` : ''}`;
    const taskHref = `${location.pathname}${location.search || ''}`;
    if (listHref === taskHref) {
      taskDetailHistorySeededRef.current = true;
      return;
    }
    taskDetailHistorySeededRef.current = true;
    const currentState = window.history.state;
    window.history.replaceState(currentState, '', listHref);
    window.history.pushState(currentState, '', taskHref);
  }, [isMobile, location.pathname, location.search, selectedTaskId]);

  const refreshTasksAndDetails = useCallback(async (taskId = '') => {
    await loadTasks();
    if (taskId) await loadTaskDetails(taskId);
  }, [loadTaskDetails, loadTasks]);

  const closeTaskDetails = useCallback(() => {
    setDetailsTask(null);
    setDetailsComments([]);
    setDetailsStatusLog([]);
    setDetailsCommentBody('');
    mobileChecklistHistoryPushedRef.current = false;
    updateSearch((nextParams) => {
      nextParams.delete('task');
      nextParams.delete('task_tab');
      nextParams.delete('task_mobile_view');
    }, { replace: true });
  }, [updateSearch]);

  const openTaskDetails = useCallback((task) => {
    const id = String(task?.id || '').trim();
    if (!id) return;
    setDetailsLoading(true);
    setDetailsActivityLoading(true);
    setDetailsTask(null);
    setDetailsComments([]);
    setDetailsStatusLog([]);
    mobileChecklistHistoryPushedRef.current = false;
    updateSearch((params) => {
      params.set('task', id);
      if (taskDiscussionChatEnabled) params.delete('task_tab');
      else params.set('task_tab', getDefaultTaskDetailTab(false));
      params.delete('task_mobile_view');
    }, { replace: false });
  }, [taskDiscussionChatEnabled, updateSearch]);

  const openMobileTaskChecklist = useCallback(() => {
    if (!selectedTaskId) return;
    mobileChecklistHistoryPushedRef.current = true;
    updateSearch((params) => {
      params.set('task', selectedTaskId);
      params.set('task_mobile_view', 'checklist');
    }, { replace: false });
  }, [selectedTaskId, updateSearch]);

  const closeMobileTaskChecklist = useCallback(() => {
    if (mobileChecklistHistoryPushedRef.current) {
      mobileChecklistHistoryPushedRef.current = false;
      navigate(-1);
      return;
    }
    updateSearch((params) => { params.delete('task_mobile_view'); }, { replace: true });
  }, [navigate, updateSearch]);

  const setTaskDetailTab = useCallback((tab) => {
    const nextTab = normalizeTaskDetailTab(tab, taskDiscussionChatEnabled);
    updateSearch((params) => {
      if (selectedTaskId) params.set('task_tab', nextTab);
    }, { replace: false });
  }, [selectedTaskId, taskDiscussionChatEnabled, updateSearch]);

  const downloadBlob = useCallback((response, fileName) => {
    const blob = response?.data instanceof Blob
      ? response.data
      : new Blob([response?.data || response], { type: response?.headers?.['content-type'] || 'application/octet-stream' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName || 'file';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }, []);

  const handleDownloadAttachment = useCallback(async (task, attachment) => {
    try {
      const response = await hubAPI.downloadTaskAttachment({ taskId: task.id, attachmentId: attachment.id });
      downloadBlob(response, attachment?.file_name || 'attachment');
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка скачивания вложения');
    }
  }, [downloadBlob, setError]);

  const handleDownloadReport = useCallback(async (report) => {
    if (!report?.id || !report?.file_name) return;
    try {
      const response = await hubAPI.downloadTaskReport(report.id);
      downloadBlob(response, report.file_name);
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка скачивания отчёта');
    }
  }, [downloadBlob, setError]);

  const handleAddTaskComment = useCallback(async () => {
    const taskId = String(detailsTask?.id || '').trim();
    const body = String(detailsCommentBody || '').trim();
    if (!taskId || !body) return;
    setDetailsCommentSaving(true);
    try {
      await hubAPI.addTaskComment(taskId, body);
      setDetailsCommentBody('');
      await refreshTasksAndDetails(taskId);
      window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка добавления комментария');
    } finally {
      setDetailsCommentSaving(false);
    }
  }, [detailsCommentBody, detailsTask?.id, refreshTasksAndDetails, setError]);

  const handleOpenTaskDiscussion = useCallback(async (task = detailsTask) => {
    const taskId = String(task?.id || '').trim();
    if (!taskId || !taskDiscussionChatEnabled) return;
    setDiscussionOpening(true);
    try {
      const response = await hubAPI.openTaskDiscussion(taskId);
      const conversationId = String(response?.conversation_id || '').trim();
      if (!conversationId) throw new Error('Не удалось открыть чат по задаче');
      invalidateSWRCacheByPrefix('chat', 'conversations', String(user?.id || 'guest'));
      navigate(`/chat?conversation=${encodeURIComponent(conversationId)}`);
      window.dispatchEvent(new CustomEvent('chat-unread-needs-refresh'));
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка открытия чата по задаче');
    } finally {
      setDiscussionOpening(false);
    }
  }, [detailsTask, navigate, setError, taskDiscussionChatEnabled, user?.id]);

  const handleCopyTaskLink = useCallback(async (taskId, taskTab) => {
    const normalizedId = String(taskId || '').trim();
    if (!normalizedId) return;
    const path = buildTaskDetailPath(normalizedId, {
      tab: taskTab,
      taskDiscussionEnabled: taskDiscussionChatEnabled,
    });
    const url = new URL(path, window.location.origin);
    try {
      if (!navigator?.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(url.toString());
    } catch {
      setError('Не удалось скопировать ссылку. Скопируйте адрес вручную.');
    }
  }, [setError, taskDiscussionChatEnabled]);

  const handleUploadAttachment = useCallback(async (taskId, file) => {
    if (!taskId || !file) return;
    setUploadingAttachment(true);
    try {
      await hubAPI.uploadTaskAttachment({ taskId, file });
      await refreshTasksAndDetails(taskId);
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка загрузки файла');
    } finally {
      setUploadingAttachment(false);
    }
  }, [refreshTasksAndDetails, setError]);

  const currentUserManagedDepartmentIds = useMemo(() => new Set(
    departments.filter((item) => item?.is_current_user_manager).map((item) => String(item?.id || '')).filter(Boolean),
  ), [departments]);

  const canDeleteTask = useCallback((task) => {
    if (!task?.id) return false;
    if (isTransferActUploadTask(task) && !canManageAllTasks) return false;
    if (canManageAllTasks) return true;
    return Number(task?.created_by_user_id) === Number(user?.id);
  }, [canManageAllTasks, user?.id]);

  const canEditTask = useCallback((task) => {
    if (!task?.id) return false;
    if (isTransferActUploadTask(task) && !canManageAllTasks) return false;
    if (canManageAllTasks) return true;
    if (currentUserManagedDepartmentIds.has(String(task?.department_id || ''))) return true;
    return Number(task?.created_by_user_id) === Number(user?.id);
  }, [canManageAllTasks, currentUserManagedDepartmentIds, user?.id]);

  const canReviewTask = useCallback((task) => {
    if (isTransferActUploadTask(task)) return false;
    if (!task?.id || String(task?.status || '').toLowerCase() !== 'review') return false;
    if (canManageAllTasks) return true;
    if (currentUserManagedDepartmentIds.has(String(task?.department_id || ''))) return true;
    return Number(task?.created_by_user_id) === Number(user?.id)
      || (canReviewTasks && Number(task?.controller_user_id) === Number(user?.id));
  }, [canManageAllTasks, canReviewTasks, currentUserManagedDepartmentIds, user?.id]);

  const canStartTask = useCallback((task) => (
    !isTransferActUploadTask(task)
    && Number(task?.assignee_user_id) === Number(user?.id)
    && String(task?.status || '').toLowerCase() === 'new'
  ), [user?.id]);

  const canSubmitTask = useCallback((task) => (
    !isTransferActUploadTask(task)
    && Number(task?.assignee_user_id) === Number(user?.id)
    && ['new', 'in_progress'].includes(String(task?.status || '').toLowerCase())
  ), [user?.id]);

  const canReopenTask = useCallback((task) => {
    if (typeof task?.capabilities?.can_reopen === 'boolean') return task.capabilities.can_reopen;
    if (isTransferActUploadTask(task)) return false;
    if (String(task?.status || '').toLowerCase() !== 'done') return false;
    if (canManageAllTasks) return true;
    if (currentUserManagedDepartmentIds.has(String(task?.department_id || ''))) return true;
    const actorId = Number(user?.id);
    return actorId > 0 && (
      Number(task?.assignee_user_id) === actorId
      || Number(task?.created_by_user_id) === actorId
      || Number(task?.controller_user_id) === actorId
    );
  }, [canManageAllTasks, currentUserManagedDepartmentIds, user?.id]);

  const canUploadFiles = useCallback((task) => {
    if (isTransferActUploadTask(task)) return false;
    if (!task?.id || String(task?.status || '').toLowerCase() === 'done') return false;
    if (canManageAllTasks) return true;
    const actorId = Number(user?.id);
    return actorId > 0 && (
      Number(task?.assignee_user_id) === actorId
      || Number(task?.created_by_user_id) === actorId
      || Number(task?.controller_user_id) === actorId
    );
  }, [canManageAllTasks, user?.id]);

  const canUpdateTaskChecklist = useCallback((task) => {
    if (!task?.id || String(task?.status || '').toLowerCase() === 'done') return false;
    if (canManageAllTasks) return true;
    if (currentUserManagedDepartmentIds.has(String(task?.department_id || ''))) return true;
    const actorId = Number(user?.id);
    return actorId > 0 && (
      Number(task?.assignee_user_id) === actorId
      || Number(task?.created_by_user_id) === actorId
      || Number(task?.controller_user_id) === actorId
    );
  }, [canManageAllTasks, currentUserManagedDepartmentIds, user?.id]);

  const handleToggleTaskChecklistItem = useCallback(async (task, itemId, done) => {
    const taskId = String(task?.id || '').trim();
    const baseItems = Array.isArray(task?.checklist_items) ? task.checklist_items : [];
    if (!taskId || !itemId) return;
    const mutations = checklistMutationRef.current;
    const existing = mutations.get(taskId);
    const sourceItems = existing?.items || baseItems;
    if (sourceItems.length === 0) return;
    const nextItems = sourceItems.map((item) => (
      String(item?.id || '') === String(itemId) ? { ...item, done: Boolean(done) } : item
    ));
    const runAfter = existing?.chain || Promise.resolve();
    const chain = runAfter.catch(() => {}).then(() => hubAPI.updateTask(taskId, { checklist_items: nextItems }));
    mutations.set(taskId, { items: nextItems, chain });
    try {
      const updatedTask = await chain;
      if (mutations.get(taskId)?.chain === chain) {
        mutations.delete(taskId);
        const serverItems = Array.isArray(updatedTask?.checklist_items) ? updatedTask.checklist_items : nextItems;
        const patch = { checklist_items: serverItems };
        patchTaskItem(taskId, patch);
        setDetailsTask((prev) => (prev && String(prev.id || '') === taskId ? { ...prev, ...patch } : prev));
      }
    } catch (err) {
      if (mutations.get(taskId)?.chain === chain) mutations.delete(taskId);
      setError(err?.response?.data?.detail || err?.message || 'Ошибка обновления чек-листа');
    }
  }, [patchTaskItem, setError]);

  const handleAddTaskChecklistItem = useCallback(async (task, text) => {
    const taskId = String(task?.id || '').trim();
    const itemText = String(text || '').trim();
    if (!taskId || !itemText || !canUpdateTaskChecklist(task)) return;
    const items = Array.isArray(task?.checklist_items) ? task.checklist_items : [];
    const nextItems = [...items, { id: createChecklistItemId(), text: itemText, done: false }];
    try {
      await hubAPI.updateTask(taskId, { checklist_items: nextItems });
      await refreshTasksAndDetails(taskId);
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка добавления пункта чек-листа');
    }
  }, [canUpdateTaskChecklist, refreshTasksAndDetails, setError]);

  const renderTaskChecklist = useCallback((task) => (
    <TaskDetailChecklist
      task={task}
      canUpdate={canUpdateTaskChecklist(task)}
      onToggle={(itemId, done) => void handleToggleTaskChecklistItem(task, itemId, done)}
      ui={ui}
    />
  ), [canUpdateTaskChecklist, handleToggleTaskChecklistItem, ui]);

  return {
    detailsOpen,
    detailsLoading,
    detailsTask,
    detailsComments,
    detailsStatusLog,
    detailsActivityLoading,
    detailsCommentBody,
    detailsCommentSaving,
    uploadingAttachment,
    discussionOpening,
    selectedTaskId,
    selectedTaskTab,
    selectedMobileTaskView,
    closeTaskDetails,
    openTaskDetails,
    openMobileTaskChecklist,
    closeMobileTaskChecklist,
    setTaskDetailTab,
    setDetailsCommentBody,
    handleAddTaskComment,
    handleOpenTaskDiscussion,
    handleCopyTaskLink,
    handleDownloadAttachment,
    handleDownloadReport,
    handleUploadAttachment,
    handleToggleTaskChecklistItem,
    handleAddTaskChecklistItem,
    renderTaskChecklist,
    canDeleteTask,
    canEditTask,
    canReviewTask,
    canStartTask,
    canSubmitTask,
    canReopenTask,
    canUploadFiles,
    canUpdateTaskChecklist,
    refreshTasksAndDetails,
    loadTaskDetails,
  };
}
