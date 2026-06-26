import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { hubAPI } from '../../../api/client';
import { buildCreateDuePresets, formatCreateDueLabel } from '../taskViewModes';
import {
  createEmptyProjectDraft,
  createEmptyObjectDraft,
  createEmptyOptionalSections,
  createInitialTaskDraft,
} from '../taskCreateModel';
import {
  fromApiEmailDeadlineRemindHours,
  toApiEmailDeadlineRemindHours,
  formatEmailRemindSummary,
  applyDueAtChange,
} from '../taskEmailRemindUtils';
import { createEmptyChecklistItem, normalizeChecklistItems } from '../taskChecklistUtils';
import { getFileIdentity, getCreatedTaskItems } from '../taskApiHelpers';
import { stripMarkdownForPreview } from '../taskRichText';
import {
  getTaskUserLabel,
  findDepartmentById,
  findTaskUserById,
  formatHubTaskError,
} from '../taskUserUtils';
import useTaskTaxonomy from './useTaskTaxonomy';
import { toDateTimeInput, toDateInput } from '../taskFormatters';
import { PENDING_TASK_CREATE_STORAGE_KEY } from '../taskUrlState';
import { TASK_ASSIGNEE_SEARCH_MIN_CHARS, TASK_ASSIGNEE_SEARCH_LIMIT } from '../../../hooks/useTaskAssigneeDirectory';

export default function useTaskCreate({
  canCreateTasks,
  isMobile,
  setError,
  loadTasks,
  loadTaskMeta,
  loadTaskUserDirectories,
  loadTaskUsers,
  controllers,
  departments,
  activeTaskProjects,
  activeTaskObjects,
  taskEmailDeadlineDefaultHours,
  getAssigneeById,
  resolveAssigneesByIds,
  mergeAssigneesIntoCache,
  clearAssigneeSearchResults,
  setAssigneeSearchInput,
  refreshTasksAndDetails,
  closeTaskDetails,
  selectedTaskId,
  detailsTask,
  visibleTaskItems,
  createOpen: controlledCreateOpen,
  setCreateOpen: controlledSetCreateOpen,
  editOpen: controlledEditOpen,
  setEditOpen: controlledSetEditOpen,
}) {
  const navigate = useNavigate();
  const location = useLocation();

  const taxonomy = useTaskTaxonomy({ loadTaskUsers, setError });
  const {
    taxonomyOpen, setTaxonomyOpen, taxonomySaving, editingProjectId, editingObjectId,
    projectDraft, setProjectDraft, objectDraft, setObjectDraft,
    handleCreateProject, handleCreateObject, handleEditProject, handleEditObject,
    resetProjectDraft, resetObjectDraft,
  } = taxonomy;

  const [internalCreateOpen, setInternalCreateOpen] = useState(false);
  const createOpen = controlledCreateOpen ?? internalCreateOpen;
  const setCreateOpen = controlledSetCreateOpen ?? setInternalCreateOpen;
  const [internalEditOpen, setInternalEditOpen] = useState(false);
  const editOpen = controlledEditOpen ?? internalEditOpen;
  const setEditOpen = controlledSetEditOpen ?? setInternalEditOpen;
  const [createSaving, setCreateSaving] = useState(false);
  const [createDuePickerOpen, setCreateDuePickerOpen] = useState(false);
  const [createDueCustomOpen, setCreateDueCustomOpen] = useState(false);
  const createDueAnchorRef = useRef(null);
  const [editDueCustomOpen, setEditDueCustomOpen] = useState(false);
  const [createMobileSheet, setCreateMobileSheet] = useState('');
  const [createDescriptionPreview, setCreateDescriptionPreview] = useState('');
  const [createOptionalSections, setCreateOptionalSections] = useState(createEmptyOptionalSections);
  const [createData, setCreateData] = useState(() => createInitialTaskDraft());
  const [createFiles, setCreateFiles] = useState([]);
  const [createChecklistItems, setCreateChecklistItems] = useState([]);
  const [createProjectName, setCreateProjectName] = useState('');
  const [createProjectSaving, setCreateProjectSaving] = useState(false);

  const [submitTask, setSubmitTask] = useState(null);
  const [submitSaving, setSubmitSaving] = useState(false);

  const [reviewTask, setReviewTask] = useState(null);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [startingTaskId, setStartingTaskId] = useState('');
  const [reopenTargetTask, setReopenTargetTask] = useState(null);
  const [reopeningTaskId, setReopeningTaskId] = useState('');

  const [editSaving, setEditSaving] = useState(false);
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

  const searchInputRef = useRef(null);
  const createDescriptionRef = useRef('');
  const editDescriptionRef = useRef('');
  const taskDetailHistorySeededRef = useRef(false);
  const taskDetailHistoryPushedRef = useRef(false);
  const mobileChecklistHistoryPushedRef = useRef(false);

  const handleCreateDescriptionDraftChange = useCallback((value) => {
    createDescriptionRef.current = String(value || '');
  }, []);

  const handleEditDescriptionDraftChange = useCallback((value) => {
    editDescriptionRef.current = String(value || '');
  }, []);

  const defaultCreateProject = useMemo(() => {
    const generalProject = activeTaskProjects.find((item) => (
      String(item?.id || '') === 'general-tasks'
      || String(item?.code || '').trim().toUpperCase() === 'GENERAL'
      || String(item?.name || '').trim().toLowerCase() === 'общие задачи'
    ));
    return generalProject || activeTaskProjects[0] || null;
  }, [activeTaskProjects]);

  const defaultCreateProjectId = String(defaultCreateProject?.id || '');
  const effectiveCreateProjectId = String(createData.project_id || defaultCreateProjectId || '').trim();

  const effectiveCreateProject = useMemo(
    () => activeTaskProjects.find((item) => String(item?.id || '') === effectiveCreateProjectId) || null,
    [activeTaskProjects, effectiveCreateProjectId],
  );

  const editProjectObjects = useMemo(() => (
    activeTaskObjects.filter((item) => item?.is_active !== false && String(item?.project_id || '') === String(editData.project_id || ''))
  ), [editData.project_id, activeTaskObjects]);

  const createDuePresets = useMemo(() => buildCreateDuePresets(new Date()), [createOpen]);
  const createDueLabel = useMemo(
    () => formatCreateDueLabel(createData.due_at, new Date()),
    [createData.due_at],
  );
  const editDueLabel = useMemo(
    () => formatCreateDueLabel(editData.due_at, new Date()),
    [editData.due_at],
  );
  const createEmailRemindSummary = useMemo(
    () => formatEmailRemindSummary(
      createData.email_deadline_remind_mode,
      createData.email_deadline_remind_hours,
      taskEmailDeadlineDefaultHours,
    ),
    [createData.email_deadline_remind_hours, createData.email_deadline_remind_mode, taskEmailDeadlineDefaultHours],
  );

  const selectedCreateAssignees = useMemo(() => {
    const ids = Array.isArray(createData.assignee_user_ids) ? createData.assignee_user_ids : [];
    return ids.map(getAssigneeById).filter(Boolean);
  }, [createData.assignee_user_ids, getAssigneeById]);

  const selectedCreateController = useMemo(
    () => findTaskUserById(controllers, createData.controller_user_id),
    [controllers, createData.controller_user_id],
  );

  const selectedCreateObservers = useMemo(() => {
    const ids = Array.isArray(createData.observer_user_ids) ? createData.observer_user_ids : [];
    return ids.map(getAssigneeById).filter(Boolean);
  }, [createData.observer_user_ids, getAssigneeById]);

  const selectedCreateDepartment = useMemo(
    () => findDepartmentById(departments, createData.department_id),
    [departments, createData.department_id],
  );

  const createDescriptionSummary = stripMarkdownForPreview(createDescriptionPreview || createData.description);
  const createAssigneeSummary = useMemo(() => {
    if (selectedCreateAssignees.length === 0) return '';
    const names = selectedCreateAssignees.map(getTaskUserLabel);
    if (names.length <= 2) return names.join(', ');
    return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
  }, [selectedCreateAssignees]);

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

  const openCreateTaskWithPreset = useCallback((preset = {}) => {
    const hasDuePreset = Object.prototype.hasOwnProperty.call(preset, 'due_at');
    if (hasDuePreset) {
      setCreateData((prev) => ({
        ...prev,
        due_at: preset.due_at ? toDateTimeInput(preset.due_at) : '',
      }));
    }
    void loadTaskMeta();
    void loadTaskUserDirectories();
    setCreateOpen(true);
  }, [loadTaskMeta, loadTaskUserDirectories]);

  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    const hasCreateQuery = params.get('create') === '1';
    const hasCreateState = Boolean(location.state?.openCreate);

    if (!hasCreateQuery && !hasCreateState) return;

    try {
      sessionStorage.setItem(PENDING_TASK_CREATE_STORAGE_KEY, '1');
    } catch {
      // ignore storage failures in private mode
    }

    if (hasCreateQuery) {
      params.delete('create');
      const nextSearch = params.toString();
      const { openCreate, ...restState } = location.state || {};
      navigate(
        {
          pathname: location.pathname,
          search: nextSearch ? `?${nextSearch}` : '',
        },
        {
          replace: true,
          state: hasCreateState ? restState : location.state,
        },
      );
      return;
    }

    const { openCreate, ...restState } = location.state || {};
    navigate(
      {
        pathname: location.pathname,
        search: location.search,
      },
      {
        replace: true,
        state: restState,
      },
    );
  }, [location.pathname, location.search, location.state, navigate]);

  useEffect(() => {
    if (!canCreateTasks) return;
    let pendingCreate = false;
    try {
      pendingCreate = sessionStorage.getItem(PENDING_TASK_CREATE_STORAGE_KEY) === '1';
      if (pendingCreate) {
        sessionStorage.removeItem(PENDING_TASK_CREATE_STORAGE_KEY);
      }
    } catch {
      pendingCreate = false;
    }
    if (!pendingCreate) return;
    openCreateTaskWithPreset();
  }, [canCreateTasks, openCreateTaskWithPreset]);

  useEffect(() => {
    if (!createOpen || createData.project_id || !defaultCreateProjectId) return;
    setCreateData((prev) => (
      prev.project_id
        ? prev
        : { ...prev, project_id: defaultCreateProjectId }
    ));
  }, [createData.project_id, createOpen, defaultCreateProjectId]);

  useEffect(() => {
    if (!createOpen) return;
    void loadTaskMeta();
    if (controllers.length === 0) {
      void loadTaskUserDirectories();
    }
  }, [controllers.length, createOpen, loadTaskMeta, loadTaskUserDirectories]);

  useEffect(() => {
    const ids = [
      editData.assignee_user_id,
      ...(Array.isArray(createData.assignee_user_ids) ? createData.assignee_user_ids : []),
    ].filter(Boolean);
    if (ids.length) {
      void resolveAssigneesByIds(ids);
    }
  }, [createData.assignee_user_ids, editData.assignee_user_id, resolveAssigneesByIds]);

  const handleToggleCreateOptionalSection = useCallback((key) => {
    if (key === 'priority') {
      setCreateData((prev) => ({
        ...prev,
        priority: prev.priority === 'high' ? 'normal' : 'high',
      }));
      setCreateOptionalSections((prev) => ({ ...prev, priority: !prev.priority }));
      return;
    }
    if (key === 'checklist') {
      setCreateChecklistItems((prev) => (prev.length > 0 ? prev : [createEmptyChecklistItem()]));
    }
    setCreateOptionalSections((prev) => {
      if (key === 'advanced') {
        const nextAdvanced = !prev.advanced;
        return {
          ...prev,
          advanced: nextAdvanced,
          schedule: nextAdvanced,
          access: nextAdvanced,
          project: nextAdvanced ? true : prev.project,
          controller: nextAdvanced ? true : prev.controller,
        };
      }
      return { ...prev, [key]: !prev[key] };
    });
  }, []);

  const handleOpenCreateMobileSheet = useCallback((key) => {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) return;

    if (!isMobile) {
      handleToggleCreateOptionalSection(normalizedKey);
      return;
    }

    if (normalizedKey === 'checklist') {
      setCreateChecklistItems((prev) => (prev.length > 0 ? prev : [createEmptyChecklistItem()]));
      setCreateOptionalSections((prev) => ({ ...prev, checklist: true }));
    } else if (['files', 'project', 'controller', 'observers'].includes(normalizedKey)) {
      setCreateOptionalSections((prev) => ({ ...prev, [normalizedKey]: true }));
    } else if (normalizedKey === 'advanced') {
      setCreateOptionalSections((prev) => ({
        ...prev,
        advanced: true,
        schedule: true,
        access: true,
        project: true,
        controller: true,
      }));
    }

    if (normalizedKey === 'controller') {
      void loadTaskUserDirectories();
    }

    setCreateMobileSheet(normalizedKey);
  }, [handleToggleCreateOptionalSection, isMobile, loadTaskUserDirectories]);

  const handleCloseCreateMobileSheet = useCallback(() => {
    setCreateDescriptionPreview(String(createDescriptionRef.current || '').trim());
    setCreateMobileSheet('');
  }, []);

  const handleChangeCreateAssigneeIds = useCallback((nextIds) => {
    const normalizedIds = (Array.isArray(nextIds) ? nextIds : [])
      .map((item) => String(item || ''))
      .filter(Boolean);
    setCreateData((prev) => ({
      ...prev,
      assignee_user_ids: normalizedIds,
    }));
    if (normalizedIds.length) {
      void resolveAssigneesByIds(normalizedIds);
    }
  }, [resolveAssigneesByIds]);

  const handleClearCreateAssignees = useCallback(() => {
    setCreateData((prev) => ({ ...prev, assignee_user_ids: [] }));
  }, []);

  const handleChangeCreateControllerId = useCallback((nextIds) => {
    const id = (Array.isArray(nextIds) ? nextIds : [])
      .map((item) => String(item || ''))
      .find(Boolean) || '';
    setCreateData((prev) => ({ ...prev, controller_user_id: id }));
  }, []);

  const handleClearCreateController = useCallback(() => {
    setCreateData((prev) => ({ ...prev, controller_user_id: '' }));
  }, []);

  const handleChangeCreateObserverIds = useCallback((nextIds) => {
    const normalizedIds = (Array.isArray(nextIds) ? nextIds : [])
      .map((item) => String(item || ''))
      .filter(Boolean);
    setCreateData((prev) => ({
      ...prev,
      observer_user_ids: normalizedIds,
    }));
    if (normalizedIds.length) {
      void resolveAssigneesByIds(normalizedIds);
    }
  }, [resolveAssigneesByIds]);

  const handleClearCreateObservers = useCallback(() => {
    setCreateData((prev) => ({ ...prev, observer_user_ids: [] }));
  }, []);

  const handleAddChecklistItem = useCallback(() => {
    setCreateChecklistItems((prev) => [...prev, createEmptyChecklistItem()]);
    setCreateOptionalSections((prev) => ({ ...prev, checklist: true }));
  }, []);

  const handleUpdateChecklistItem = useCallback((itemId, patch) => {
    setCreateChecklistItems((prev) => prev.map((item) => (
      item.id === itemId ? { ...item, ...patch } : item
    )));
  }, []);

  const handleRemoveChecklistItem = useCallback((itemId) => {
    setCreateChecklistItems((prev) => {
      const next = prev.filter((item) => item.id !== itemId);
      return next.length > 0 ? next : [createEmptyChecklistItem()];
    });
  }, []);

  const handleCreateProjectFromTaskDialog = useCallback(async () => {
    const name = String(createProjectName || '').trim();
    if (name.length < 2 || createProjectSaving) return;
    setCreateProjectSaving(true);
    try {
      const created = await hubAPI.createTaskProject({
        name,
        code: '',
        description: '',
        is_active: true,
      });
      setCreateProjectName('');
      await loadTaskUsers({ force: true });
      setCreateData((prev) => ({
        ...prev,
        project_id: String(created?.id || prev.project_id || ''),
        object_id: '',
      }));
      setCreateOptionalSections((prev) => ({ ...prev, project: true }));
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка создания проекта');
    } finally {
      setCreateProjectSaving(false);
    }
  }, [createProjectName, createProjectSaving, loadTaskUsers]);

  const handleAddCreateFiles = useCallback((fileList) => {
    const nextFiles = Array.from(fileList || []).filter(Boolean);
    if (nextFiles.length === 0) return;
    setCreateFiles((prev) => {
      const seen = new Set(prev.map(getFileIdentity));
      const merged = [...prev];
      nextFiles.forEach((file) => {
        const identity = getFileIdentity(file);
        if (!seen.has(identity)) {
          seen.add(identity);
          merged.push(file);
        }
      });
      return merged;
    });
    setCreateOptionalSections((prev) => ({ ...prev, files: true }));
  }, []);

  const handleRemoveCreateFile = useCallback((index) => {
    setCreateFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  }, []);

  const handleCloseCreateDialog = useCallback(() => {
    if (createSaving) return;
    setCreateOpen(false);
    setCreateDuePickerOpen(false);
    setCreateDueCustomOpen(false);
    setCreateMobileSheet('');
    setCreateDescriptionPreview('');
    setCreateFiles([]);
    setCreateChecklistItems([]);
    setCreateProjectName('');
    setCreateOptionalSections((prev) => {
      if (!Object.values(prev).some(Boolean)) return prev;
      return createEmptyOptionalSections();
    });
  }, [createSaving]);

  const handleCloseCreateDuePicker = useCallback(() => {
    setCreateDuePickerOpen(false);
    setCreateDueCustomOpen(false);
  }, []);

  const handleSelectCreateDuePreset = useCallback((value) => {
    setCreateData((prev) => applyDueAtChange(prev, String(value || '')));
    setCreateDueCustomOpen(false);
    setCreateDuePickerOpen(false);
  }, []);

  const handleCreateDueAtChange = useCallback((value) => {
    setCreateData((prev) => applyDueAtChange(prev, String(value || '')));
  }, []);

  const handleEditDueAtChange = useCallback((value) => {
    setEditData((prev) => applyDueAtChange(prev, String(value || '')));
  }, []);

  const handleSelectEditDuePreset = useCallback((value) => {
    setEditData((prev) => applyDueAtChange(prev, String(value || '')));
    setEditDueCustomOpen(false);
  }, []);

  const handleCreateTask = async () => {
    const assigneeIds = Array.isArray(createData.assignee_user_ids) ? createData.assignee_user_ids : [];
    const controllerUserId = Number(createData.controller_user_id || 0);
    const projectId = effectiveCreateProjectId;
    const filesToUpload = createFiles.filter(Boolean);
    if (
      String(createData.title || '').trim().length < 3
      || assigneeIds.length === 0
      || !projectId
      || !String(createData.protocol_date || '').trim()
    ) return;
    setCreateSaving(true);
    try {
      const dueAtValue = String(createData.due_at || '').trim() || null;
      const emailDeadlineRemindHours = dueAtValue
        ? toApiEmailDeadlineRemindHours(createData.email_deadline_remind_mode, createData.email_deadline_remind_hours)
        : null;
      const createResponse = await hubAPI.createTask({
        title: String(createData.title || '').trim(),
        description: String(createDescriptionRef.current || createData.description || '').trim(),
        checklist_items: normalizeChecklistItems(createChecklistItems),
        assignee_user_ids: assigneeIds.map(Number).filter(Number.isInteger),
        controller_user_id: controllerUserId > 0 ? controllerUserId : null,
        project_id: projectId,
        object_id: String(createData.object_id || '').trim() || null,
        protocol_date: String(createData.protocol_date || '').trim() || null,
        due_at: dueAtValue,
        ...(dueAtValue && emailDeadlineRemindHours !== null ? { email_deadline_remind_hours: emailDeadlineRemindHours } : {}),
        priority: createData.priority || 'normal',
        department_id: String(createData.department_id || '').trim() || null,
        visibility_scope: String(createData.department_id || '').trim()
          ? (String(createData.visibility_scope || 'department').trim() || 'department')
          : 'private',
        observer_user_ids: (Array.isArray(createData.observer_user_ids) ? createData.observer_user_ids : [])
          .map(Number)
          .filter((value) => Number.isInteger(value) && value > 0),
      });
      const createdTasks = getCreatedTaskItems(createResponse);
      const uploadFailures = [];
      if (filesToUpload.length > 0 && createdTasks.length === 0) {
        uploadFailures.push('API не вернул id задачи');
      }
      if (filesToUpload.length > 0 && createdTasks.length > 0) {
        for (const task of createdTasks) {
          const taskId = String(task?.id || '').trim();
          if (!taskId) {
            uploadFailures.push('API не вернул id задачи');
            continue;
          }
          for (const file of filesToUpload) {
            try {
              await hubAPI.uploadTaskAttachment({ taskId, file });
            } catch {
              uploadFailures.push(file?.name || 'file');
            }
          }
        }
      }
      setCreateOpen(false);
      setCreateDuePickerOpen(false);
      setCreateDueCustomOpen(false);
      setCreateMobileSheet('');
      setCreateDescriptionPreview('');
      setCreateOptionalSections(createEmptyOptionalSections());
      setCreateData(createInitialTaskDraft(defaultCreateProjectId));
      createDescriptionRef.current = '';
      setCreateFiles([]);
      setCreateChecklistItems([]);
      setCreateProjectName('');
      await loadTasks();
      window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
      if (uploadFailures.length > 0) {
        const visibleFailures = uploadFailures.slice(0, 3).join(', ');
        const suffix = uploadFailures.length > 3 ? ` и ещё ${uploadFailures.length - 3}` : '';
        setError(`Задача создана, но часть файлов не загрузилась: ${visibleFailures}${suffix}`);
      }
    } catch (err) {
      setError(formatHubTaskError(err));
    } finally {
      setCreateSaving(false);
    }
  };

  const handleReviewTask = useCallback(async (decision, comment = '') => {
    if (!reviewTask?.id || reviewSaving) return;
    const reviewTaskId = reviewTask.id;
    setReviewSaving(true);
    try {
      await hubAPI.reviewTask(reviewTaskId, { decision, comment });
      setReviewTask(null);
      await refreshTasksAndDetails(reviewTaskId);
      window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка проверки задачи');
    } finally {
      setReviewSaving(false);
    }
  }, [refreshTasksAndDetails, reviewSaving, reviewTask]);

  const handleStartTask = async (taskId) => {
    const normalizedId = String(taskId || '').trim();
    if (!normalizedId || startingTaskId) return;
    setStartingTaskId(normalizedId);
    try {
      await hubAPI.startTask(normalizedId);
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
      await hubAPI.reopenTask(normalizedId, { due_at: dueAt ?? null });
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
      await hubAPI.submitTask({
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
  }, [refreshTasksAndDetails, submitSaving, submitTask]);

  const handleDeleteTask = async (task) => {
    if (!task?.id || !window.confirm(`Удалить "${task?.title || 'задачу'}"?`)) return;
    try {
      await hubAPI.deleteTask(task.id);
      if (String(selectedTaskId || '') === String(task.id)) {
        closeTaskDetails();
      }
      await loadTasks();
      window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка удаления задачи');
    }
  };

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
      setAssigneeSearchInput(getTaskUserLabel(assigneeSnapshot));
    } else {
      setAssigneeSearchInput('');
      clearAssigneeSearchResults();
    }
    const observerSnapshots = (Array.isArray(task?.observers) ? task.observers : [])
      .map((item) => ({
        id: String(item?.user_id || ''),
        full_name: String(item?.full_name || '').trim(),
        username: String(item?.username || '').trim(),
      }))
      .filter((item) => item.id);
    if (observerSnapshots.length) {
      mergeAssigneesIntoCache(observerSnapshots);
    }
    setEditOpen(true);
  }, [clearAssigneeSearchResults, mergeAssigneesIntoCache]);

  const handleSaveEdit = async () => {
    const taskId = String(editData.id || '').trim();
    if (!taskId) return;
    setEditSaving(true);
    try {
      const dueAtValue = String(editData.due_at || '').trim() || null;
      await hubAPI.updateTask(taskId, {
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
      await refreshTasksAndDetails(taskId);
      window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка сохранения задачи');
    } finally {
      setEditSaving(false);
    }
  };

  return {
    taxonomyOpen, setTaxonomyOpen, taxonomySaving, editingProjectId, editingObjectId,
    projectDraft, setProjectDraft, objectDraft, setObjectDraft,
    createOpen, setCreateOpen, createSaving, createDuePickerOpen, setCreateDuePickerOpen,
    createDueCustomOpen, setCreateDueCustomOpen, createDueAnchorRef, createMobileSheet, setCreateMobileSheet,
    createDescriptionPreview, createOptionalSections, setCreateOptionalSections, createData, setCreateData,
    createFiles, createChecklistItems, createProjectName, setCreateProjectName, createProjectSaving,
    submitTask, setSubmitTask, submitSaving, reviewTask, setReviewTask, reviewSaving,
    startingTaskId, reopenTargetTask, setReopenTargetTask, reopeningTaskId,
    editOpen, setEditOpen, editSaving, editData, setEditData, editDueCustomOpen, setEditDueCustomOpen,
    createDescriptionRef, editDescriptionRef,
    handleCreateDescriptionDraftChange, handleEditDescriptionDraftChange,
    openCreateTaskWithPreset, handleCloseCreateDialog, handleCreateTask,
    handleToggleCreateOptionalSection, handleOpenCreateMobileSheet, handleCloseCreateMobileSheet,
    handleChangeCreateAssigneeIds, handleClearCreateAssignees, handleChangeCreateControllerId,
    handleClearCreateController, handleChangeCreateObserverIds, handleClearCreateObservers,
    handleAddChecklistItem, handleUpdateChecklistItem, handleRemoveChecklistItem,
    handleCreateProjectFromTaskDialog, handleAddCreateFiles, handleRemoveCreateFile,
    handleCloseCreateDuePicker, handleSelectCreateDuePreset, handleCreateDueAtChange,
    handleEditDueAtChange, handleSelectEditDuePreset, handleReviewTask, handleStartTask,
    handleOpenReopenTask, handleConfirmReopenTask, handleSubmitTask, handleDeleteTask,
    openEditTask, handleSaveEdit, handleCreateProject, handleCreateObject, handleEditProject,
    handleEditObject, resetProjectDraft, resetObjectDraft,
    defaultCreateProjectId, effectiveCreateProjectId, effectiveCreateProject,
    editProjectObjects, createDuePresets, createDueLabel, editDueLabel,
    createEmailRemindSummary, createDescriptionSummary, createAssigneeSummary,
    selectedCreateAssignees, selectedCreateController, selectedCreateObservers, selectedCreateDepartment,
    selectedEditAssignee, selectedEditController, selectedEditObservers, selectedEditDepartment,
  };
}
