import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import hubTasksAPI from '../../../api/hubTasks';
import hubTaskActivityAPI from '../../../api/hubTaskActivity';
import hubTaskFilesAPI from '../../../api/hubTaskFiles';
import hubTaskDiscussionAPI from '../../../api/hubTaskDiscussion';
import TaskDetailChecklist from '../../../components/hub/tasks/TaskDetailChecklist';
import { isTransferActUploadTask } from '../../../lib/hubTaskIntegrations';
import { invalidateSWRCacheByPrefix } from '../../../lib/swrCache';
import { isMobileAppWebViewRuntime, requestMobileAppCommand } from '../../../lib/mobileAppBridge';
import {
  buildTaskDetailPath,
  getDefaultTaskDetailTab,
  normalizeTaskDetailTab,
  normalizeTaskDetailView,
} from '../../../lib/taskNavigation';
import { createChecklistItemId } from '../taskChecklistUtils';

const taskHasAssignee = (task, userId) => {
  const normalizedUserId = Number(userId);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) return false;
  const assigneeIds = Array.isArray(task?.assignee_user_ids) && task.assignee_user_ids.length
    ? task.assignee_user_ids
    : [task?.assignee_user_id];
  return assigneeIds.some((value) => Number(value) === normalizedUserId);
};

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
  const [discussionError, setDiscussionError] = useState('');
  const [selectedDiscussionConversationId, setSelectedDiscussionConversationId] = useState('');
  const [discussionRetryNonce, setDiscussionRetryNonce] = useState(0);

  const taskDetailHistorySeededRef = useRef(false);
  const mobileChecklistHistoryPushedRef = useRef(false);
  const loadTaskDetailsRequestRef = useRef(0);
  const checklistMutationRef = useRef(new Map());
  const loadedActivityRef = useRef({ taskId: '', comments: false, history: false });
  const discussionConversationRef = useRef({ taskId: '', conversationId: '' });
  const discussionProvisioningTaskRef = useRef('');
  const discussionAttemptedTaskRef = useRef('');

  const selectedTaskId = useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return String(params.get('task') || '').trim();
  }, [location.search]);

  const selectedTaskTab = useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return normalizeTaskDetailTab(params.get('task_tab'), taskDiscussionChatEnabled);
  }, [location.search, taskDiscussionChatEnabled]);

  const selectedTaskViewParam = useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return String(params.get('task_detail_view') || '').trim().toLowerCase();
  }, [location.search]);
  const selectedTaskView = normalizeTaskDetailView(selectedTaskViewParam);

  const selectedDiscussionMessageId = useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return String(params.get('message') || '').trim();
  }, [location.search]);

  const nativeTaskShareAvailable = isMobileAppWebViewRuntime();

  const selectedMobileTaskView = useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return String(params.get('task_mobile_view') || '').trim() === 'checklist' ? 'checklist' : 'details';
  }, [location.search]);

  const detailsOpen = Boolean(selectedTaskId);

  const taskReturnTo = useMemo(() => {
    const value = String(location.state?.taskReturnTo || '').trim();
    return value.startsWith('/') && !value.startsWith('//') ? value : '';
  }, [location.state]);

  const taskBackLabel = useMemo(() => {
    const explicitLabel = String(location.state?.taskReturnLabel || '').trim();
    if (explicitLabel) return explicitLabel;
    const params = new URLSearchParams(location.search || '');
    const pageMode = String(params.get('task_mode') || '').trim().toLowerCase();
    if (pageMode === 'board') return 'К доске';
    if (pageMode === 'calendar') return 'К календарю';
    if (pageMode === 'plan' || pageMode === 'gantt') return 'К плану';
    if (pageMode === 'deadlines') return 'К срокам';
    return 'К списку';
  }, [location.search, location.state]);

  const updateSearch = useCallback((mutate, { replace = true } = {}) => {
    const params = new URLSearchParams(location.search || '');
    mutate(params);
    const nextSearch = params.toString();
    const currentSearch = String(location.search || '').replace(/^\?/, '');
    if (nextSearch === currentSearch) return;
    navigate(
      { pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : '' },
      { replace, state: location.state },
    );
  }, [location.pathname, location.search, location.state, navigate]);

  useEffect(() => {
    if (!selectedTaskId || selectedTaskView !== 'overview' || !selectedTaskViewParam) return;
    updateSearch((params) => {
      params.delete('task_detail_view');
      params.delete('message');
      params.delete('conversation');
    }, { replace: true });
  }, [selectedTaskId, selectedTaskView, selectedTaskViewParam, updateSearch]);

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
        const res = await hubTaskActivityAPI.getTaskStatusLog(normalizedId);
        if (!stillCurrent()) return;
        setDetailsStatusLog(Array.isArray(res?.items) ? res.items : []);
      } else {
        const res = await hubTaskActivityAPI.getTaskComments(normalizedId);
        if (!stillCurrent()) return;
        setDetailsComments(Array.isArray(res?.items) ? res.items : []);
        if (options.hasUnread) {
          try {
            await hubTaskActivityAPI.markTaskCommentsSeen(normalizedId);
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
      const task = await hubTasksAPI.getTask(normalizedId);
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
    if (isMobile || selectedTaskView !== 'overview' || !detailsTask?.id) return;
    const normalizedId = String(detailsTask.id || '').trim();
    if (!normalizedId || normalizedId !== String(selectedTaskId || '').trim()) return;
    void loadTaskActivity(normalizedId, selectedTaskTab, {
      hasUnread: selectedTaskTab === 'comments' && Boolean(detailsTask.has_unread_comments),
    });
  }, [isMobile, detailsTask?.id, detailsTask?.has_unread_comments, selectedTaskId, selectedTaskTab, selectedTaskView, detailsLoadNonce, loadTaskActivity]);

  useEffect(() => {
    if (!selectedTaskId) {
      taskDetailHistorySeededRef.current = false;
      mobileChecklistHistoryPushedRef.current = false;
      setDetailsTask(null);
      setDetailsComments([]);
      setDetailsStatusLog([]);
      setDetailsActivityLoading(false);
      setDetailsCommentBody('');
      setDiscussionError('');
      setSelectedDiscussionConversationId('');
      discussionAttemptedTaskRef.current = '';
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
    listParams.delete('task_detail_view');
    listParams.delete('conversation');
    listParams.delete('message');
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
    setDiscussionError('');
    setSelectedDiscussionConversationId('');
    discussionAttemptedTaskRef.current = '';
    mobileChecklistHistoryPushedRef.current = false;
    if (taskReturnTo) {
      navigate(taskReturnTo, {
        replace: true,
        state: {
          taskRestoreFocusId: String(location.state?.taskReturnFocusId || '').trim(),
          taskRestoreScrollY: Number(location.state?.taskReturnScrollY || 0),
        },
      });
      return;
    }
    updateSearch((nextParams) => {
      nextParams.delete('task');
      nextParams.delete('task_tab');
      nextParams.delete('task_mobile_view');
      nextParams.delete('task_detail_view');
      nextParams.delete('conversation');
      nextParams.delete('message');
    }, { replace: true });
  }, [location.state, navigate, taskReturnTo, updateSearch]);

  const openTaskDetails = useCallback((task, { view = '', replace = false } = {}) => {
    const id = String(task?.id || '').trim();
    if (!id) return;
    const requestedView = String(view || '').trim();
    setDetailsLoading(true);
    setDetailsActivityLoading(true);
    setDetailsTask(null);
    setDetailsComments([]);
    setDetailsStatusLog([]);
    setDiscussionError('');
    setSelectedDiscussionConversationId('');
    discussionAttemptedTaskRef.current = '';
    mobileChecklistHistoryPushedRef.current = false;
    updateSearch((params) => {
      params.set('task', id);
      if (taskDiscussionChatEnabled) params.delete('task_tab');
      else params.set('task_tab', getDefaultTaskDetailTab(false));
      params.delete('task_mobile_view');
      params.delete('conversation');
      params.delete('message');
      if (requestedView) params.set('task_detail_view', normalizeTaskDetailView(requestedView));
      else params.delete('task_detail_view');
    }, { replace });
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

  const setTaskDetailView = useCallback((view) => {
    const nextView = normalizeTaskDetailView(view);
    setDiscussionError('');
    if (nextView === 'discussion' && selectedTaskView !== 'discussion') {
      discussionAttemptedTaskRef.current = '';
    }
    updateSearch((params) => {
      if (!selectedTaskId) return;
      if (nextView !== 'overview') {
        params.set('task_detail_view', nextView);
        params.delete('task_mobile_view');
      } else {
        params.delete('task_detail_view');
      }
      if (nextView === 'discussion') {
        const cached = discussionConversationRef.current;
        if (cached.taskId === selectedTaskId && cached.conversationId) {
          setSelectedDiscussionConversationId(cached.conversationId);
        }
      } else {
        params.delete('message');
      }
      params.delete('conversation');
    }, { replace: false });
  }, [selectedTaskId, selectedTaskView, updateSearch]);

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
      const response = await hubTaskFilesAPI.downloadTaskAttachment({ taskId: task.id, attachmentId: attachment.id });
      downloadBlob(response, attachment?.file_name || 'attachment');
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка скачивания вложения');
    }
  }, [downloadBlob, setError]);

  const handleDownloadReport = useCallback(async (report) => {
    if (!report?.id || !report?.file_name) return;
    try {
      const response = await hubTaskFilesAPI.downloadTaskReport(report.id);
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
      await hubTaskActivityAPI.addTaskComment(taskId, body);
      setDetailsCommentBody('');
      await refreshTasksAndDetails(taskId);
      window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка добавления комментария');
    } finally {
      setDetailsCommentSaving(false);
    }
  }, [detailsCommentBody, detailsTask?.id, refreshTasksAndDetails, setError]);

  const ensureTaskDiscussion = useCallback(async (taskId, { replace = true } = {}) => {
    const normalizedTaskId = String(taskId || '').trim();
    if (!normalizedTaskId || !taskDiscussionChatEnabled) return '';
    if (discussionProvisioningTaskRef.current === normalizedTaskId) return '';
    discussionProvisioningTaskRef.current = normalizedTaskId;
    setDiscussionOpening(true);
    setDiscussionError('');
    try {
      const response = await hubTaskDiscussionAPI.openTaskDiscussion(normalizedTaskId);
      const conversationId = String(response?.conversation_id || '').trim();
      if (!conversationId) throw new Error('Не удалось открыть обсуждение задачи');
      discussionConversationRef.current = { taskId: normalizedTaskId, conversationId };
      setSelectedDiscussionConversationId(conversationId);
      invalidateSWRCacheByPrefix('chat', 'conversations', String(user?.id || 'guest'));
      updateSearch((params) => {
        params.set('task', normalizedTaskId);
        params.set('task_detail_view', 'discussion');
        params.delete('conversation');
        params.delete('task_mobile_view');
      }, { replace });
      window.dispatchEvent(new CustomEvent('chat-unread-needs-refresh'));
      return conversationId;
    } catch (err) {
      setDiscussionError(
        err?.response?.data?.detail
        || err?.message
        || 'Не удалось открыть обсуждение задачи.',
      );
      return '';
    } finally {
      if (discussionProvisioningTaskRef.current === normalizedTaskId) {
        discussionProvisioningTaskRef.current = '';
      }
      setDiscussionOpening(false);
    }
  }, [taskDiscussionChatEnabled, updateSearch, user?.id]);

  useEffect(() => {
    if (selectedTaskView !== 'discussion' || !selectedTaskId) return;
    if (!detailsTask || String(detailsTask.id || '').trim() !== selectedTaskId) return;
    if (!taskDiscussionChatEnabled || detailsTask?.capabilities?.can_open_discussion === false) {
      setError('Обсуждение этой задачи недоступно.');
      updateSearch((params) => {
        params.delete('task_detail_view');
        params.delete('conversation');
        params.delete('message');
      }, { replace: true });
      return;
    }
    const cached = discussionConversationRef.current;
    if (
      cached.taskId === selectedTaskId
      && cached.conversationId
    ) {
      if (selectedDiscussionConversationId !== cached.conversationId) {
        setSelectedDiscussionConversationId(cached.conversationId);
      }
      return;
    }
    if (discussionAttemptedTaskRef.current === selectedTaskId) return;
    discussionAttemptedTaskRef.current = selectedTaskId;
    void ensureTaskDiscussion(selectedTaskId);
  }, [
    detailsTask?.id,
    detailsTask?.capabilities?.can_open_discussion,
    discussionRetryNonce,
    ensureTaskDiscussion,
    selectedDiscussionConversationId,
    selectedTaskId,
    selectedTaskView,
    setError,
    taskDiscussionChatEnabled,
    updateSearch,
  ]);

  const handleOpenTaskDiscussion = useCallback(async (
    task = detailsTask,
    { replace = false, messageId = '' } = {},
  ) => {
    const taskId = String(task?.id || '').trim();
    if (!taskId || !taskDiscussionChatEnabled) return '';
    setDiscussionError('');
    const cached = discussionConversationRef.current;
    updateSearch((params) => {
      params.set('task', taskId);
      params.set('task_detail_view', 'discussion');
      params.delete('task_mobile_view');
      params.delete('conversation');
      const normalizedMessageId = String(messageId || '').trim();
      if (normalizedMessageId) params.set('message', normalizedMessageId);
      else params.delete('message');
    }, { replace });
    if (cached.taskId === taskId && cached.conversationId) {
      setSelectedDiscussionConversationId(cached.conversationId);
    }
    return cached.taskId === taskId ? cached.conversationId : '';
  }, [detailsTask, taskDiscussionChatEnabled, updateSearch]);

  const retryTaskDiscussion = useCallback(() => {
    discussionConversationRef.current = { taskId: '', conversationId: '' };
    discussionProvisioningTaskRef.current = '';
    discussionAttemptedTaskRef.current = '';
    setDiscussionError('');
    setSelectedDiscussionConversationId('');
    setDiscussionRetryNonce((current) => current + 1);
  }, []);

  const handleCopyTaskLink = useCallback(async (taskId, taskTab, taskView) => {
    const normalizedId = String(taskId || '').trim();
    if (!normalizedId) return;
    const path = buildTaskDetailPath(normalizedId, {
      tab: taskTab,
      view: taskView,
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

  const handleShareTaskLink = useCallback(async (task, taskTab, taskView) => {
    const normalizedId = String(task?.id || '').trim();
    if (!normalizedId || !isMobileAppWebViewRuntime()) return;
    const path = buildTaskDetailPath(normalizedId, {
      tab: taskTab,
      view: taskView,
      taskDiscussionEnabled: taskDiscussionChatEnabled,
    });
    const url = new URL(path, window.location.origin);
    const title = String(task?.title || '').trim().slice(0, 200) || 'Задача HUB-IT';
    try {
      await requestMobileAppCommand('share.text', {
        title,
        text: `Задача HUB-IT: ${title}`,
        url: url.toString(),
      });
    } catch {
      setError('Не удалось открыть системное меню отправки.');
    }
  }, [setError, taskDiscussionChatEnabled]);

  const handleUploadAttachment = useCallback(async (taskId, file) => {
    if (!taskId || !file) return;
    setUploadingAttachment(true);
    try {
      await hubTaskFilesAPI.uploadTaskAttachment({ taskId, file });
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
    const userId = Number(user?.id);
    const creatorId = Number(task?.created_by_user_id);
    if (userId > 0 && taskHasAssignee(task, userId) && userId !== creatorId) return false;
    if (canManageAllTasks) return true;
    if (currentUserManagedDepartmentIds.has(String(task?.department_id || ''))) return true;
    return Number(task?.created_by_user_id) === Number(user?.id)
      || (canReviewTasks && Number(task?.controller_user_id) === Number(user?.id));
  }, [canManageAllTasks, canReviewTasks, currentUserManagedDepartmentIds, user?.id]);

  const canCloseTask = useCallback((task) => {
    if (typeof task?.capabilities?.can_close === 'boolean') return task.capabilities.can_close;
    if (isTransferActUploadTask(task)) return false;
    if (!task?.id) return false;
    const status = String(task?.status || '').toLowerCase();
    if (!['new', 'in_progress', 'review'].includes(status)) return false;
    if (canManageAllTasks) return true;
    if (currentUserManagedDepartmentIds.has(String(task?.department_id || ''))) return true;
    return Number(task?.created_by_user_id) === Number(user?.id);
  }, [canManageAllTasks, currentUserManagedDepartmentIds, user?.id]);

  const canStartTask = useCallback((task) => {
    if (typeof task?.capabilities?.can_start === 'boolean') return task.capabilities.can_start;
    return !isTransferActUploadTask(task)
      && taskHasAssignee(task, user?.id)
      && String(task?.status || '').toLowerCase() === 'new';
  }, [user?.id]);

  const canSubmitTask = useCallback((task) => {
    if (typeof task?.capabilities?.can_submit === 'boolean') return task.capabilities.can_submit;
    return !isTransferActUploadTask(task)
      && taskHasAssignee(task, user?.id)
      && ['new', 'in_progress'].includes(String(task?.status || '').toLowerCase());
  }, [user?.id]);

  const canReopenTask = useCallback((task) => {
    if (typeof task?.capabilities?.can_reopen === 'boolean') return task.capabilities.can_reopen;
    if (isTransferActUploadTask(task)) return false;
    if (String(task?.status || '').toLowerCase() !== 'done') return false;
    if (canManageAllTasks) return true;
    if (currentUserManagedDepartmentIds.has(String(task?.department_id || ''))) return true;
    const actorId = Number(user?.id);
    return actorId > 0 && (
      taskHasAssignee(task, actorId)
      || Number(task?.created_by_user_id) === actorId
      || Number(task?.controller_user_id) === actorId
    );
  }, [canManageAllTasks, currentUserManagedDepartmentIds, user?.id]);

  const canUploadFiles = useCallback((task) => {
    if (typeof task?.capabilities?.can_upload_files === 'boolean') return task.capabilities.can_upload_files;
    if (isTransferActUploadTask(task)) return false;
    if (!task?.id || String(task?.status || '').toLowerCase() === 'done') return false;
    if (canManageAllTasks) return true;
    const actorId = Number(user?.id);
    return actorId > 0 && (
      taskHasAssignee(task, actorId)
      || Number(task?.created_by_user_id) === actorId
      || Number(task?.controller_user_id) === actorId
    );
  }, [canManageAllTasks, user?.id]);

  const canUpdateTaskChecklist = useCallback((task) => {
    if (typeof task?.capabilities?.can_update_checklist === 'boolean') return task.capabilities.can_update_checklist;
    if (!task?.id || String(task?.status || '').toLowerCase() === 'done') return false;
    if (canManageAllTasks) return true;
    if (currentUserManagedDepartmentIds.has(String(task?.department_id || ''))) return true;
    const actorId = Number(user?.id);
    return actorId > 0 && (
      taskHasAssignee(task, actorId)
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
    const chain = runAfter.catch(() => {}).then(() => hubTasksAPI.updateTask(taskId, { checklist_items: nextItems }));
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
      await hubTasksAPI.updateTask(taskId, { checklist_items: nextItems });
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
    discussionError,
    selectedDiscussionConversationId,
    selectedDiscussionMessageId,
    selectedTaskId,
    selectedTaskTab,
    selectedTaskView,
    selectedMobileTaskView,
    nativeTaskShareAvailable,
    taskBackLabel,
    taskReturnTo,
    closeTaskDetails,
    openTaskDetails,
    openMobileTaskChecklist,
    closeMobileTaskChecklist,
    setTaskDetailTab,
    setTaskDetailView,
    setDetailsCommentBody,
    handleAddTaskComment,
    handleOpenTaskDiscussion,
    retryTaskDiscussion,
    handleCopyTaskLink,
    handleShareTaskLink,
    handleDownloadAttachment,
    handleDownloadReport,
    handleUploadAttachment,
    handleToggleTaskChecklistItem,
    handleAddTaskChecklistItem,
    renderTaskChecklist,
    canDeleteTask,
    canEditTask,
    canReviewTask,
    canCloseTask,
    canStartTask,
    canSubmitTask,
    canReopenTask,
    canUploadFiles,
    canUpdateTaskChecklist,
    refreshTasksAndDetails,
    loadTaskDetails,
  };
}
