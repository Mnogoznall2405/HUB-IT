import { useCallback, useMemo, useState } from 'react';
import hubTaskSubtasksAPI from '../../../api/hubTaskSubtasks';
import { formatHubTaskError } from '../taskUserUtils';

export const SUBTASK_TITLE_MIN_LENGTH = 3;

export const createInitialSubtaskDraft = () => ({
  title: '',
  description: '',
  assignee_user_ids: [],
  due_at: '',
  priority: 'normal',
});

export const buildSubtaskPayload = (draft) => ({
  title: String(draft.title || '').trim(),
  description: String(draft.description || '').trim(),
  assignee_user_ids: (draft.assignee_user_ids || []).map((id) => Number(id)).filter((id) => id > 0),
  due_at: String(draft.due_at || '').trim() || null,
  priority: draft.priority || 'normal',
});

export const validateSubtaskDraft = (draft) => {
  const payload = buildSubtaskPayload(draft);
  if (payload.title.length < SUBTASK_TITLE_MIN_LENGTH) return 'Название подзадачи — не короче 3 символов.';
  if (payload.assignee_user_ids.length === 0) return 'Выберите хотя бы одного исполнителя подзадачи.';
  return '';
};

/**
 * Диалог «Подзадача»: создаёт задачу, связанную с родителем, и обновляет карточку родителя
 * (счётчики и список подзадач) без перезагрузки страницы.
 */
export default function useTaskSubtasks({
  setNotice,
  loadTasks,
  loadTaskDetails,
  getAssigneeById,
  resolveAssigneesByIds,
}) {
  const [subtaskParent, setSubtaskParent] = useState(null);
  const [subtaskDraft, setSubtaskDraft] = useState(createInitialSubtaskDraft);
  const [subtaskSaving, setSubtaskSaving] = useState(false);
  const [subtaskFormError, setSubtaskFormError] = useState('');

  const selectedSubtaskAssignees = useMemo(
    () => (subtaskDraft.assignee_user_ids || []).map(getAssigneeById).filter(Boolean),
    [getAssigneeById, subtaskDraft.assignee_user_ids],
  );

  const openSubtaskDialog = useCallback((parentTask) => {
    if (!parentTask?.id) return;
    setSubtaskDraft(createInitialSubtaskDraft());
    setSubtaskFormError('');
    setSubtaskParent({ id: String(parentTask.id), title: parentTask.title || '' });
  }, []);

  const closeSubtaskDialog = useCallback(() => {
    if (subtaskSaving) return;
    setSubtaskParent(null);
  }, [subtaskSaving]);

  const handleChangeSubtaskAssigneeIds = useCallback((nextIds) => {
    const ids = (Array.isArray(nextIds) ? nextIds : []).map((item) => String(item || '')).filter(Boolean);
    setSubtaskDraft((prev) => ({ ...prev, assignee_user_ids: ids }));
    if (ids.length) void resolveAssigneesByIds(ids);
  }, [resolveAssigneesByIds]);

  const handleCreateSubtask = useCallback(async () => {
    if (!subtaskParent || subtaskSaving) return;
    const validationError = validateSubtaskDraft(subtaskDraft);
    if (validationError) {
      setSubtaskFormError(validationError);
      return;
    }
    setSubtaskSaving(true);
    setSubtaskFormError('');
    try {
      await hubTaskSubtasksAPI.createSubtask(subtaskParent.id, buildSubtaskPayload(subtaskDraft));
      const parentId = subtaskParent.id;
      setSubtaskParent(null);
      setNotice?.('Подзадача создана');
      await Promise.all([loadTaskDetails(parentId), loadTasks()]);
    } catch (err) {
      setSubtaskFormError(formatHubTaskError(err, 'Не удалось создать подзадачу'));
    } finally {
      setSubtaskSaving(false);
    }
  }, [loadTaskDetails, loadTasks, setNotice, subtaskDraft, subtaskParent, subtaskSaving]);

  return {
    subtaskParent,
    subtaskDraft,
    setSubtaskDraft,
    subtaskSaving,
    subtaskFormError,
    selectedSubtaskAssignees,
    openSubtaskDialog,
    closeSubtaskDialog,
    handleChangeSubtaskAssigneeIds,
    handleCreateSubtask,
  };
}
