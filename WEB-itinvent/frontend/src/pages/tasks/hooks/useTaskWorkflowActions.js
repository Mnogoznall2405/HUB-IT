import { useCallback, useRef, useState } from 'react';
import hubTasksAPI from '../../../api/hubTasks';
import { statusMeta } from '../taskFormatters';

function extractApiDetail(err) {
  return err?.response?.data?.detail ?? err?.message ?? null;
}

function isTaskTransitionConflict(err) {
  const detail = extractApiDetail(err);
  if (!detail || typeof detail !== 'object') return false;
  return detail.code === 'task_transition_conflict';
}

export function formatTaskTransitionConflictMessage(detail) {
  const status = String(detail?.current_status || '').trim().toLowerCase();
  const label = statusMeta(status).label || status || 'неизвестен';
  return `Задача уже была изменена другим пользователем.\nТекущий статус: «${label}».`;
}

export default function useTaskWorkflowActions({
  setError,
  refreshTasksAndDetails,
  loadTaskDetails,
  loadTasks,
  closeTaskDetails,
  selectedTaskId,
  detailsTask,
  visibleTaskItems,
}) {
  const [submitTask, setSubmitTask] = useState(null);
  const [submitSaving, setSubmitSaving] = useState(false);

  const [reviewTask, setReviewTask] = useState(null);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [closeTask, setCloseTask] = useState(null);
  const [closeSaving, setCloseSaving] = useState(false);
  const [startingTaskId, setStartingTaskId] = useState('');
  const [reopenTargetTask, setReopenTargetTask] = useState(null);
  const [reopeningTaskId, setReopeningTaskId] = useState('');

  const handleWorkflowConflict = useCallback(async (err, taskId, fallbackMessage) => {
    if (isTaskTransitionConflict(err)) {
      const detail = extractApiDetail(err);
      setError(formatTaskTransitionConflictMessage(detail));
      const normalizedId = String(taskId || detail?.task_id || '').trim();
      if (normalizedId && typeof loadTaskDetails === 'function') {
        await loadTaskDetails(normalizedId);
      }
      return;
    }
    const detail = extractApiDetail(err);
    setError(typeof detail === 'string' ? detail : (fallbackMessage || 'Ошибка сервера'));
  }, [loadTaskDetails, setError]);

  const handleReviewTask = useCallback(async (decision, comment = '') => {
    if (!reviewTask?.id || reviewSaving) return;
    const reviewTaskId = reviewTask.id;
    setReviewSaving(true);
    try {
      await hubTasksAPI.reviewTask(reviewTaskId, { decision, comment });
      setReviewTask(null);
      await refreshTasksAndDetails(reviewTaskId);
      window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
    } catch (err) {
      await handleWorkflowConflict(err, reviewTaskId, 'Ошибка проверки задачи');
    } finally {
      setReviewSaving(false);
    }
  }, [handleWorkflowConflict, refreshTasksAndDetails, reviewSaving, reviewTask]);

  const handleCloseTask = useCallback(async ({ comment = '' } = {}) => {
    if (!closeTask?.id || closeSaving) return;
    const closeTaskId = closeTask.id;
    setCloseSaving(true);
    try {
      await hubTasksAPI.completeTask(closeTaskId, { comment });
      setCloseTask(null);
      await refreshTasksAndDetails(closeTaskId);
      window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
    } catch (err) {
      await handleWorkflowConflict(err, closeTaskId, 'Ошибка закрытия задачи');
    } finally {
      setCloseSaving(false);
    }
  }, [closeSaving, closeTask, handleWorkflowConflict, refreshTasksAndDetails]);

  const handleStartTask = async (taskId) => {
    const normalizedId = String(taskId || '').trim();
    if (!normalizedId || startingTaskId) return;
    setStartingTaskId(normalizedId);
    try {
      await hubTasksAPI.startTask(normalizedId);
      await refreshTasksAndDetails(normalizedId);
      window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
    } catch (err) {
      await handleWorkflowConflict(err, normalizedId, 'Ошибка перевода задачи в работу');
    } finally {
      setStartingTaskId('');
    }
  };

  const handleOpenReopenTask = (taskOrId) => {
    const task = typeof taskOrId === 'object' && taskOrId
      ? taskOrId
      : visibleTaskItems.find((item) => String(item?.id || '') === String(taskOrId || ''))
        || (String(detailsTask?.id || '') === String(taskOrId || '') ? detailsTask : null);
    const normalizedId = String(task?.id || taskOrId || '').trim();
    if (!normalizedId) return;
    setReopenTargetTask(task || { id: normalizedId, title: '' });
  };

  const handleConfirmReopenTask = async ({ due_at: dueAt } = {}) => {
    const normalizedId = String(reopenTargetTask?.id || '').trim();
    if (!normalizedId || reopeningTaskId) return;
    setReopeningTaskId(normalizedId);
    try {
      await hubTasksAPI.reopenTask(normalizedId, { due_at: dueAt ?? null });
      setReopenTargetTask(null);
      await refreshTasksAndDetails(normalizedId);
      window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
    } catch (err) {
      await handleWorkflowConflict(err, normalizedId, 'Ошибка возврата задачи в работу');
    } finally {
      setReopeningTaskId('');
    }
  };

  const handleSubmitTask = useCallback(async ({ comment = '', file = null } = {}) => {
    if (!submitTask?.id || submitSaving) return;
    setSubmitSaving(true);
    try {
      await hubTasksAPI.submitTask({
        taskId: submitTask.id,
        comment,
        file: file || null,
      });
      const taskId = submitTask.id;
      setSubmitTask(null);
      await refreshTasksAndDetails(taskId);
      window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
    } catch (err) {
      await handleWorkflowConflict(err, submitTask.id, 'Ошибка сдачи задачи');
    } finally {
      setSubmitSaving(false);
    }
  }, [handleWorkflowConflict, refreshTasksAndDetails, setError, submitSaving, submitTask]);

  const selectedTaskRef = useRef({ id: selectedTaskId });
  if (selectedTaskRef.current.id !== selectedTaskId) {
    selectedTaskRef.current = { id: selectedTaskId };
  }

  const handleDeleteTask = async (task) => {
    if (!task?.id || !window.confirm(`Удалить "${task?.title || 'задачу'}"?`)) return;
    const selection = selectedTaskRef.current;
    try {
      await hubTasksAPI.deleteTask(task.id);
      if (selectedTaskRef.current === selection && String(selection.id || '') === String(task.id)) {
        closeTaskDetails();
      }
      await loadTasks();
      window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка удаления задачи');
    }
  };

  return {
    submitTask,
    setSubmitTask,
    submitSaving,
    reviewTask,
    setReviewTask,
    reviewSaving,
    closeTask,
    setCloseTask,
    closeSaving,
    startingTaskId,
    reopenTargetTask,
    setReopenTargetTask,
    reopeningTaskId,
    handleReviewTask,
    handleCloseTask,
    handleStartTask,
    handleOpenReopenTask,
    handleConfirmReopenTask,
    handleSubmitTask,
    handleDeleteTask,
  };
}
