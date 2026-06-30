import { useCallback, useMemo, useRef, useState } from 'react';
import hubTasksAPI from '../../../api/hubTasks';
import { formatCreateDueLabel } from '../taskViewModes';
import {
  fromApiEmailDeadlineRemindHours,
  toApiEmailDeadlineRemindHours,
  applyDueAtChange,
} from '../taskEmailRemindUtils';
import {
  findDepartmentById,
  findTaskUserById,
} from '../taskUserUtils';
import { toDateTimeInput, toDateInput } from '../taskFormatters';

export default function useTaskEditForm({
  setError,
  refreshTasksAndDetails,
  controllers,
  departments,
  activeTaskObjects,
  getAssigneeById,
  resolveAssigneesByIds,
  mergeAssigneesIntoCache,
  clearAssigneeSearchResults,
  setObserverSearchInput,
  resetTaskUserSearchInputs,
  editOpen: controlledEditOpen,
  setEditOpen: controlledSetEditOpen,
}) {
  const [internalEditOpen, setInternalEditOpen] = useState(false);
  const editOpen = controlledEditOpen ?? internalEditOpen;
  const setEditOpen = controlledSetEditOpen ?? setInternalEditOpen;
  const [editSaving, setEditSaving] = useState(false);
  const [editDueCustomOpen, setEditDueCustomOpen] = useState(false);
  const [editData, setEditData] = useState({
    id: '',
    title: '',
    description: '',
    due_at: '',
    protocol_date: '',
    priority: 'normal',
    project_id: '',
    object_id: '',
    assignee_user_id: '',
    controller_user_id: '',
    observer_user_ids: [],
    department_id: '',
    visibility_scope: 'private',
    email_deadline_remind_mode: 'default',
    email_deadline_remind_hours: 24,
  });

  const editDescriptionRef = useRef('');

  const editProjectObjects = useMemo(() => (
    activeTaskObjects.filter((item) => item?.is_active !== false && String(item?.project_id || '') === String(editData.project_id || ''))
  ), [editData.project_id, activeTaskObjects]);

  const editDueLabel = useMemo(
    () => formatCreateDueLabel(editData.due_at, new Date()),
    [editData.due_at],
  );

  const selectedEditAssignee = useMemo(
    () => getAssigneeById(editData.assignee_user_id),
    [getAssigneeById, editData.assignee_user_id],
  );

  const selectedEditObservers = useMemo(() => {
    const ids = Array.isArray(editData.observer_user_ids) ? editData.observer_user_ids : [];
    return ids
      .map((value) => getAssigneeById(value))
      .filter(Boolean);
  }, [getAssigneeById, editData.observer_user_ids]);

  const selectedEditController = useMemo(
    () => findTaskUserById(controllers, editData.controller_user_id),
    [controllers, editData.controller_user_id],
  );

  const selectedEditDepartment = useMemo(
    () => findDepartmentById(departments, editData.department_id),
    [departments, editData.department_id],
  );

  const handleEditDescriptionDraftChange = useCallback((value) => {
    editDescriptionRef.current = String(value || '');
  }, []);

  const handleEditDueAtChange = useCallback((value) => {
    setEditData((prev) => applyDueAtChange(prev, String(value || '')));
  }, []);

  const handleSelectEditDuePreset = useCallback((value) => {
    setEditData((prev) => applyDueAtChange(prev, String(value || '')));
    setEditDueCustomOpen(false);
  }, []);

  const openEditTask = useCallback((task) => {
    editDescriptionRef.current = String(task?.description || '');
    const emailRemind = fromApiEmailDeadlineRemindHours(task?.email_deadline_remind_hours);
    const assigneeId = String(task?.assignee_user_id || '').trim();
    setEditDueCustomOpen(false);
    setEditData({
      id: String(task?.id || ''),
      title: task?.title || '',
      description: task?.description || '',
      due_at: toDateTimeInput(task?.due_at),
      protocol_date: toDateInput(task?.protocol_date),
      priority: task?.priority || 'normal',
      project_id: String(task?.project_id || ''),
      object_id: String(task?.object_id || ''),
      assignee_user_id: assigneeId,
      controller_user_id: String(task?.controller_user_id || ''),
      observer_user_ids: (Array.isArray(task?.observer_user_ids) ? task.observer_user_ids : [])
        .map((value) => String(value || ''))
        .filter(Boolean),
      department_id: String(task?.department_id || ''),
      visibility_scope: String(task?.visibility_scope || 'private'),
      email_deadline_remind_mode: emailRemind.mode,
      email_deadline_remind_hours: emailRemind.hours,
    });
    if (assigneeId) {
      const assigneeSnapshot = {
        id: assigneeId,
        full_name: String(task?.assignee_full_name || '').trim(),
        username: String(task?.assignee_username || '').trim(),
      };
      mergeAssigneesIntoCache([assigneeSnapshot]);
    }
    resetTaskUserSearchInputs();
    const observerIds = (Array.isArray(task?.observer_user_ids) ? task.observer_user_ids : [])
      .map((value) => String(value || ''))
      .filter(Boolean);
    let observerSnapshots = (Array.isArray(task?.observers) ? task.observers : [])
      .map((item) => ({
        id: String(item?.user_id || ''),
        full_name: String(item?.full_name || '').trim(),
        username: String(item?.username || '').trim(),
      }))
      .filter((item) => item.id);
    if (!observerSnapshots.length && observerIds.length) {
      observerSnapshots = observerIds.map((id) => ({ id, full_name: '', username: '' }));
    }
    if (observerSnapshots.length) {
      mergeAssigneesIntoCache(observerSnapshots);
      if (resolveAssigneesByIds) {
        void resolveAssigneesByIds(observerIds);
      }
    }
    setEditOpen(true);
  }, [mergeAssigneesIntoCache, resetTaskUserSearchInputs, resolveAssigneesByIds, setEditOpen]);

  const handleEditObserversChange = useCallback((_, value) => {
    setEditData((prev) => ({
      ...prev,
      observer_user_ids: Array.isArray(value)
        ? value.map((item) => String(item?.id || '')).filter(Boolean)
        : [],
    }));
    setObserverSearchInput('');
    clearAssigneeSearchResults();
  }, [clearAssigneeSearchResults, setObserverSearchInput]);

  const handleSaveEdit = async () => {
    const taskId = String(editData.id || '').trim();
    if (!taskId) return;
    setEditSaving(true);
    try {
      const dueAtValue = String(editData.due_at || '').trim() || null;
      await hubTasksAPI.updateTask(taskId, {
        title: String(editData.title || '').trim(),
        description: String(editDescriptionRef.current || editData.description || '').trim(),
        due_at: dueAtValue,
        ...(dueAtValue ? {
          email_deadline_remind_hours: toApiEmailDeadlineRemindHours(
            editData.email_deadline_remind_mode,
            editData.email_deadline_remind_hours,
          ),
        } : {}),
        protocol_date: String(editData.protocol_date || '').trim() || null,
        priority: editData.priority || 'normal',
        project_id: String(editData.project_id || '').trim() || null,
        object_id: String(editData.object_id || '').trim() || null,
        assignee_user_id: Number(editData.assignee_user_id || 0) || null,
        controller_user_id: Number(editData.controller_user_id || 0) || null,
        observer_user_ids: (Array.isArray(editData.observer_user_ids) ? editData.observer_user_ids : [])
          .map(Number)
          .filter((value) => Number.isInteger(value) && value > 0),
        department_id: String(editData.department_id || '').trim() || null,
        visibility_scope: String(editData.visibility_scope || 'private').trim() || 'private',
      });
      setEditOpen(false);
      resetTaskUserSearchInputs();
      await refreshTasksAndDetails(taskId);
      window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка сохранения задачи');
    } finally {
      setEditSaving(false);
    }
  };

  return {
    editOpen,
    setEditOpen,
    editSaving,
    editData,
    setEditData,
    editDueCustomOpen,
    setEditDueCustomOpen,
    editDescriptionRef,
    editProjectObjects,
    editDueLabel,
    selectedEditAssignee,
    selectedEditController,
    selectedEditObservers,
    selectedEditDepartment,
    handleEditDescriptionDraftChange,
    handleEditDueAtChange,
    handleSelectEditDuePreset,
    openEditTask,
    handleSaveEdit,
    handleEditObserversChange,
  };
}
