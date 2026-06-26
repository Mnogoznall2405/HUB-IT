import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  dueStateOptions,
  statusOptions,
} from '../taskConstants';
import {
  findDepartmentById,
  findTaskUserById,
} from '../taskUserUtils';
import {
  hasTaskModeQueryParam,
  readTaskFilters,
  resolveInitialViewMode,
  safeReadStoredPersonalRole,
  safeWriteStoredPersonalRole,
  safeReadStoredTaskMode,
  safeWriteStoredTaskMode,
} from '../taskUrlState';
import {
  applyTaskListFiltersToSearchParams,
  resolveTaskViewModeFromUrl,
} from '../taskUrlSync';

export default function useTasksFilters({
  canManageAllTasks,
  canUseControllerTab,
  isMobile,
  ui,
  tasksTotal = 0,
  departments = [],
  controllers = [],
  getAssigneeById,
  getAssigneePickerOptions,
  handleSingleAssigneeAutocompleteChange,
  renderTaskUserOption,
  taskUserAutocompleteSlotProps,
  assigneeAutocompleteProps,
  getAssigneeAutocompleteInputValue,
  taskDiscussionChatEnabled,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const initialFilters = readTaskFilters(location.search);
  const initialPageMode = initialFilters.taskMode || (
    hasTaskModeQueryParam(location.search) ? '' : safeReadStoredTaskMode()
  ) || 'list';

  const [pageMode, setPageMode] = useState(initialPageMode);
  const [viewMode, setViewMode] = useState(() => resolveInitialViewMode(location.search, canManageAllTasks));
  const [q, setQ] = useState(initialFilters.q);
  const [debouncedQ, setDebouncedQ] = useState(initialFilters.q);
  const [statusFilter, setStatusFilter] = useState(initialFilters.status);
  const [dueState, setDueState] = useState(initialFilters.dueState);
  const [assigneeFilter, setAssigneeFilter] = useState(initialFilters.assigneeFilter);
  const [controllerFilter, setControllerFilter] = useState(initialFilters.controllerFilter);
  const [departmentFilter, setDepartmentFilter] = useState(initialFilters.departmentFilter);
  const [hasAttachments, setHasAttachments] = useState(initialFilters.hasAttachments);
  const [unreadCommentsOnly, setUnreadCommentsOnly] = useState(initialFilters.unreadCommentsOnly);
  const [focusMode, setFocusMode] = useState(initialFilters.focusMode || 'all');
  const [showFilters, setShowFilters] = useState(false);
  const [mobileBoardFiltersOpen, setMobileBoardFiltersOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(() => Boolean(initialFilters.q));
  const [completedTasksOpen, setCompletedTasksOpen] = useState(true);

  const searchInputRef = useRef(null);

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
    const timer = window.setTimeout(() => setDebouncedQ(String(q || '').trim()), 250);
    return () => window.clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    if (!mobileSearchOpen || !isMobile) return undefined;
    const frameId = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus?.();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [isMobile, mobileSearchOpen]);

  useEffect(() => {
    const next = readTaskFilters(location.search);
    const nextView = resolveTaskViewModeFromUrl({
      viewMode: next.viewMode,
      canManageAllTasks,
      canUseControllerTab,
    });
    const nextPageMode = next.taskMode || (
      hasTaskModeQueryParam(location.search) ? '' : safeReadStoredTaskMode()
    ) || 'list';

    setPageMode((prev) => (prev === nextPageMode ? prev : nextPageMode));
    setViewMode((prev) => (prev === nextView ? prev : nextView));
    setQ((prev) => (prev === next.q ? prev : next.q));
    setDebouncedQ((prev) => (prev === next.q ? prev : next.q));
    setStatusFilter((prev) => (prev === next.status ? prev : next.status));
    setDueState((prev) => (prev === next.dueState ? prev : next.dueState));
    setAssigneeFilter((prev) => (prev === next.assigneeFilter ? prev : next.assigneeFilter));
    setControllerFilter((prev) => (prev === next.controllerFilter ? prev : next.controllerFilter));
    setDepartmentFilter((prev) => (prev === next.departmentFilter ? prev : next.departmentFilter));
    setHasAttachments((prev) => (prev === next.hasAttachments ? prev : next.hasAttachments));
    setUnreadCommentsOnly((prev) => (prev === next.unreadCommentsOnly ? prev : next.unreadCommentsOnly));
    setFocusMode((prev) => (prev === (next.focusMode || 'all') ? prev : (next.focusMode || 'all')));
  }, [location.search, canManageAllTasks, canUseControllerTab]);

  useEffect(() => {
    safeWriteStoredTaskMode(pageMode);
    updateSearch((params) => {
      applyTaskListFiltersToSearchParams(params, {
        pageMode,
        viewMode,
        q: debouncedQ,
        statusFilter,
        dueState,
        assigneeFilter,
        controllerFilter,
        departmentFilter,
        hasAttachments,
        unreadCommentsOnly,
        focusMode,
      }, { canManageAllTasks });
    });
  }, [
    assigneeFilter,
    canManageAllTasks,
    controllerFilter,
    departmentFilter,
    dueState,
    focusMode,
    hasAttachments,
    pageMode,
    debouncedQ,
    statusFilter,
    unreadCommentsOnly,
    updateSearch,
    viewMode,
  ]);

  useEffect(() => {
    if (viewMode === 'assignee' || viewMode === 'creator') {
      safeWriteStoredPersonalRole(viewMode);
    }
  }, [viewMode]);

  const handlePersonalRoleChange = useCallback((role) => {
    if (role !== 'assignee' && role !== 'creator') return;
    safeWriteStoredPersonalRole(role);
    setViewMode(role);
  }, []);

  const secondaryViewMode = ['all', 'department', 'controller'].includes(viewMode) ? viewMode : false;

  const personalRoleCounts = useMemo(() => {
    if (viewMode !== 'assignee' && viewMode !== 'creator') {
      return {};
    }
    return {
      [viewMode]: Number(tasksTotal ?? 0),
    };
  }, [tasksTotal, viewMode]);

  const selectedBoardAssignee = useMemo(
    () => getAssigneeById(assigneeFilter),
    [getAssigneeById, assigneeFilter],
  );

  const selectedBoardController = useMemo(
    () => findTaskUserById(controllers, controllerFilter),
    [controllerFilter, controllers],
  );

  const selectedBoardDepartment = useMemo(
    () => findDepartmentById(departments, departmentFilter),
    [departmentFilter, departments],
  );

  const activeFilterCount = useMemo(() => [
    q,
    statusFilter,
    dueState,
    assigneeFilter,
    controllerFilter,
    departmentFilter,
    hasAttachments,
    unreadCommentsOnly,
    focusMode !== 'all',
  ].filter(Boolean).length, [
    assigneeFilter,
    controllerFilter,
    departmentFilter,
    dueState,
    focusMode,
    hasAttachments,
    q,
    statusFilter,
    unreadCommentsOnly,
  ]);

  const resetFilters = useCallback(() => {
    setQ('');
    setStatusFilter('');
    setDueState('');
    setAssigneeFilter('');
    setControllerFilter('');
    setDepartmentFilter('');
    setHasAttachments(false);
    setUnreadCommentsOnly(false);
    setFocusMode('all');
  }, []);

  const boardFiltersPanelProps = useMemo(() => ({
    ui,
    q,
    onQChange: setQ,
    searchInputRef,
    statusFilter,
    onStatusFilterChange: setStatusFilter,
    statusOptions,
    dueState,
    onDueStateChange: setDueState,
    dueStateOptions,
    departments,
    selectedBoardDepartment,
    onDepartmentChange: setDepartmentFilter,
    selectedBoardAssignee,
    getAssigneePickerOptions,
    onAssigneeChange: setAssigneeFilter,
    controllers,
    selectedBoardController,
    onControllerChange: setControllerFilter,
    hasAttachments,
    onHasAttachmentsChange: setHasAttachments,
    unreadCommentsOnly,
    onUnreadCommentsOnlyChange: setUnreadCommentsOnly,
    taskDiscussionChatEnabled,
    onResetFilters: resetFilters,
    handleSingleAssigneeAutocompleteChange,
    renderTaskUserOption,
    taskUserAutocompleteSlotProps,
    assigneeAutocompleteProps,
    getAssigneeAutocompleteInputValue,
  }), [
    assigneeAutocompleteProps,
    assigneeFilter,
    controllerFilter,
    controllers,
    departmentFilter,
    departments,
    dueState,
    getAssigneeAutocompleteInputValue,
    getAssigneePickerOptions,
    handleSingleAssigneeAutocompleteChange,
    hasAttachments,
    q,
    renderTaskUserOption,
    resetFilters,
    selectedBoardAssignee,
    selectedBoardController,
    selectedBoardDepartment,
    setAssigneeFilter,
    statusFilter,
    taskDiscussionChatEnabled,
    taskUserAutocompleteSlotProps,
    ui,
    unreadCommentsOnly,
  ]);

  return {
    pageMode,
    setPageMode,
    viewMode,
    setViewMode,
    q,
    setQ,
    debouncedQ,
    statusFilter,
    setStatusFilter,
    dueState,
    setDueState,
    assigneeFilter,
    setAssigneeFilter,
    controllerFilter,
    setControllerFilter,
    departmentFilter,
    setDepartmentFilter,
    hasAttachments,
    setHasAttachments,
    unreadCommentsOnly,
    setUnreadCommentsOnly,
    focusMode,
    setFocusMode,
    showFilters,
    setShowFilters,
    mobileBoardFiltersOpen,
    setMobileBoardFiltersOpen,
    mobileSearchOpen,
    setMobileSearchOpen,
    completedTasksOpen,
    setCompletedTasksOpen,
    searchInputRef,
    updateSearch,
    handlePersonalRoleChange,
    secondaryViewMode,
    personalRoleCounts,
    selectedBoardAssignee,
    selectedBoardController,
    selectedBoardDepartment,
    activeFilterCount,
    resetFilters,
    boardFiltersPanelProps,
    statusOptions,
    dueStateOptions,
  };
}
