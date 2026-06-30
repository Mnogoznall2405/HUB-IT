import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import hubTasksAPI from '../../../api/hubTasks';
import hubTaskSupportAPI from '../../../api/hubTaskSupport';
import hubTaskFilesAPI from '../../../api/hubTaskFiles';
import { buildCreateDuePresets, formatCreateDueLabel } from '../taskViewModes';
import {
  createEmptyOptionalSections,
  createInitialTaskDraft,
} from '../taskCreateModel';
import {
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

export default function useTaskCreateForm({
  isMobile,
  setError,
  loadTasks,
  loadTaskMeta,
  loadTaskUserDirectories,
  loadTaskUsers,
  controllers,
  departments,
  activeTaskProjects,
  taskEmailDeadlineDefaultHours,
  getAssigneeById,
    resolveAssigneesByIds,
    setObserverSearchInput,
    clearAssigneeSearchResults,
    createOpen: controlledCreateOpen,
  setCreateOpen: controlledSetCreateOpen,
  editData,
}) {
  const [internalCreateOpen, setInternalCreateOpen] = useState(false);
  const createOpen = controlledCreateOpen ?? internalCreateOpen;
  const setCreateOpen = controlledSetCreateOpen ?? setInternalCreateOpen;
  const [createSaving, setCreateSaving] = useState(false);
  const [createDuePickerOpen, setCreateDuePickerOpen] = useState(false);
  const [createDueCustomOpen, setCreateDueCustomOpen] = useState(false);
  const createDueAnchorRef = useRef(null);
  const [createMobileSheet, setCreateMobileSheet] = useState('');
  const [createDescriptionPreview, setCreateDescriptionPreview] = useState('');
  const [createOptionalSections, setCreateOptionalSections] = useState(createEmptyOptionalSections);
  const [createData, setCreateData] = useState(() => createInitialTaskDraft());
  const [createFiles, setCreateFiles] = useState([]);
  const [createChecklistItems, setCreateChecklistItems] = useState([]);
  const [createProjectName, setCreateProjectName] = useState('');
  const [createProjectSaving, setCreateProjectSaving] = useState(false);

  const createDescriptionRef = useRef('');

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

  const createDuePresets = useMemo(() => buildCreateDuePresets(new Date()), [createOpen]);
  const createDueLabel = useMemo(
    () => formatCreateDueLabel(createData.due_at, new Date()),
    [createData.due_at],
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
      editData?.assignee_user_id,
      ...(Array.isArray(createData.assignee_user_ids) ? createData.assignee_user_ids : []),
    ].filter(Boolean);
    if (ids.length) {
      void resolveAssigneesByIds(ids);
    }
  }, [createData.assignee_user_ids, editData?.assignee_user_id, resolveAssigneesByIds]);

  const handleCreateDescriptionDraftChange = useCallback((value) => {
    createDescriptionRef.current = String(value || '');
  }, []);

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
    setObserverSearchInput('');
    clearAssigneeSearchResults();
    if (normalizedIds.length) {
      void resolveAssigneesByIds(normalizedIds);
    }
  }, [clearAssigneeSearchResults, resolveAssigneesByIds, setObserverSearchInput]);

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
      const created = await hubTaskSupportAPI.createTaskProject({
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
  }, [createProjectName, createProjectSaving, loadTaskUsers, setError]);

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
  }, [createSaving, setCreateOpen]);

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
      const createResponse = await hubTasksAPI.createTask({
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
              await hubTaskFilesAPI.uploadTaskAttachment({ taskId, file });
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

  return {
    createOpen,
    setCreateOpen,
    createSaving,
    createDuePickerOpen,
    setCreateDuePickerOpen,
    createDueCustomOpen,
    setCreateDueCustomOpen,
    createDueAnchorRef,
    createMobileSheet,
    setCreateMobileSheet,
    createDescriptionPreview,
    createOptionalSections,
    setCreateOptionalSections,
    createData,
    setCreateData,
    createFiles,
    createChecklistItems,
    createProjectName,
    setCreateProjectName,
    createProjectSaving,
    createDescriptionRef,
    defaultCreateProjectId,
    effectiveCreateProjectId,
    effectiveCreateProject,
    createDuePresets,
    createDueLabel,
    createEmailRemindSummary,
    createDescriptionSummary,
    createAssigneeSummary,
    selectedCreateAssignees,
    selectedCreateController,
    selectedCreateObservers,
    selectedCreateDepartment,
    handleCreateDescriptionDraftChange,
    handleToggleCreateOptionalSection,
    handleOpenCreateMobileSheet,
    handleCloseCreateMobileSheet,
    handleChangeCreateAssigneeIds,
    handleClearCreateAssignees,
    handleChangeCreateControllerId,
    handleClearCreateController,
    handleChangeCreateObserverIds,
    handleClearCreateObservers,
    handleAddChecklistItem,
    handleUpdateChecklistItem,
    handleRemoveChecklistItem,
    handleCreateProjectFromTaskDialog,
    handleAddCreateFiles,
    handleRemoveCreateFile,
    handleCloseCreateDialog,
    handleCloseCreateDuePicker,
    handleSelectCreateDuePreset,
    handleCreateDueAtChange,
    handleCreateTask,
  };
}
