import { useCallback, useState } from 'react';
import hubTasksAPI from '../../../api/hubTasks';

export default function useTaskWorkflowActions({
  setError,
  refreshTasksAndDetails,
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
  const [startingTaskId, setStartingTaskId] = useState('');
  const [reopenTargetTask, setReopenTargetTask] = useState(null);
  const [reopeningTaskId, setReopeningTaskId] = useState('');

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
      setError(err?.response?.data?.detail || err?.message || 'Ошибка проверки задачи');
    } finally {
      setReviewSaving(false);
    }
  }, [refreshTasksAndDetails, reviewSaving, reviewTask, setError]);

  const handleStartTask = async (taskId) => {
    const normalizedId = String(taskId || '').trim();
    if (!normalizedId || startingTaskId) return;
    setStartingTaskId(normalizedId);
    try {
      await hubTasksAPI.startTask(normalizedId);
      await refreshTasksAndDetails(normalizedId);
      window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка перевода задачи в работу');
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
      setError(err?.response?.data?.detail || err?.message || 'Ошибка возврата задачи в работу');
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
      setError(err?.response?.data?.detail || err?.message || 'Ошибка сдачи задачи');
    } finally {
      setSubmitSaving(false);
    }
  }, [refreshTasksAndDetails, setError, submitSaving, submitTask]);

  const handleDeleteTask = async (task) => {
    if (!task?.id || !window.confirm(`Удалить "${task?.title || 'задачу'}"?`)) return;
    try {
      await hubTasksAPI.deleteTask(task.id);
      if (String(selectedTaskId || '') === String(task.id)) {
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
    startingTaskId,
    reopenTargetTask,
    setReopenTargetTask,
    reopeningTaskId,
    handleReviewTask,
    handleStartTask,
    handleOpenReopenTask,
    handleConfirmReopenTask,
    handleSubmitTask,
    handleDeleteTask,
  };
}
