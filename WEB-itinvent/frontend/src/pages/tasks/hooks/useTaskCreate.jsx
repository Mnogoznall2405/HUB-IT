import { useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import useTaskTaxonomy from './useTaskTaxonomy';
import useTaskCreateForm from './useTaskCreateForm';
import useTaskEditForm from './useTaskEditForm';
import useTaskWorkflowActions from './useTaskWorkflowActions';
import { PENDING_TASK_CREATE_STORAGE_KEY } from '../taskUrlState';
import { toDateTimeInput } from '../taskFormatters';

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
  setObserverSearchInput,
  resetTaskUserSearchInputs,
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

  const handleCloseEdit = useCallback(() => {
    if (controlledSetEditOpen) {
      controlledSetEditOpen(false);
    }
    resetTaskUserSearchInputs();
  }, [controlledSetEditOpen, resetTaskUserSearchInputs]);

  const taxonomy = useTaskTaxonomy({ loadTaskUsers, setError });
  const {
    taxonomyOpen, setTaxonomyOpen, taxonomySaving, editingProjectId, editingObjectId,
    projectDraft, setProjectDraft, objectDraft, setObjectDraft,
    handleCreateProject, handleCreateObject, handleEditProject, handleEditObject,
    resetProjectDraft, resetObjectDraft,
  } = taxonomy;

  const editForm = useTaskEditForm({
    setError,
    refreshTasksAndDetails,
    controllers,
    departments,
    activeTaskObjects,
    getAssigneeById,
    resolveAssigneesByIds,
    mergeAssigneesIntoCache,
    clearAssigneeSearchResults,
    setAssigneeSearchInput,
    setObserverSearchInput,
    resetTaskUserSearchInputs,
    editOpen: controlledEditOpen,
    setEditOpen: controlledSetEditOpen,
  });

  const createForm = useTaskCreateForm({
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
    editData: editForm.editData,
  });

  const workflow = useTaskWorkflowActions({
    setError,
    refreshTasksAndDetails,
    loadTasks,
    closeTaskDetails,
    selectedTaskId,
    detailsTask,
    visibleTaskItems,
  });

  const { setCreateOpen, setCreateData } = createForm;

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
  }, [loadTaskMeta, loadTaskUserDirectories, setCreateData, setCreateOpen]);

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

  return {
    taxonomyOpen, setTaxonomyOpen, taxonomySaving, editingProjectId, editingObjectId,
    projectDraft, setProjectDraft, objectDraft, setObjectDraft,
    ...createForm,
    ...workflow,
    ...editForm,
    handleCloseEdit,
    openCreateTaskWithPreset,
    handleCreateProject, handleCreateObject, handleEditProject, handleEditObject,
    resetProjectDraft, resetObjectDraft,
  };
}
