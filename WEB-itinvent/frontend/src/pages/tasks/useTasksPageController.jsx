import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import hubTaskAnalyticsAPI from '../../api/hubTaskAnalytics';
import hubTaskSupportAPI from '../../api/hubTaskSupport';
import hubMarkdownAPI from '../../api/hubMarkdown';
import useDebounce from '../../hooks/useDebounce';
import useTaskAssigneeDirectory, { TASK_ASSIGNEE_SEARCH_MIN_CHARS, TASK_ASSIGNEE_SEARCH_LIMIT } from '../../hooks/useTaskAssigneeDirectory';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import {
  canOpenTransferActUpload,
  getTransferActUploadUrl,
} from '../../lib/hubTaskIntegrations';
import { CHAT_FEATURE_ENABLED, TASK_DISCUSSION_CHAT_ENABLED } from '../../lib/chatFeature';
import { getTaskUnreadBoardLabel } from '../../lib/taskNavigation';
import {
  HUB_REALTIME_CONNECTED_EVENT,
  HUB_REALTIME_TASK_EVENT,
} from '../../lib/hubRealtimeSocket';
import { buildOfficeUiTokens } from '../../theme/officeUiTokens';
import {
  statusMeta,
  priorityMeta,
  formatDateTime,
  formatFileSize,
  getInitials,
  parseFilename,
} from './taskFormatters';
import {
  getTaskUserLabel,
  findDepartmentById,
  findTaskUserById,
  TASK_USER_AUTOCOMPLETE_LISTBOX_SX,
} from './taskUserUtils';
import { TASKS_MOBILE_COPY } from './tasksMobileCopy';
import TaskCard from '../../components/hub/tasks/TaskCard';
import { buildTaskActionMenuItems } from './taskCardModel';
import {
  createTaskObserverAutocompleteTagsRenderer,
  createTaskUserAutocompleteOptionRenderer,
  createTaskUserAutocompleteTagsRenderer,
} from '../../components/hub/tasks/taskUserAutocompleteRenderers';
import {
  buildTasksMobilePrimaryModeOptions,
} from '../../components/hub/tasks/TasksMobileHeader';
import { TASKS_MOBILE_MORE_MODE_OPTIONS } from '../../components/hub/tasks/TasksMobileNavigationDrawer';
import { preloadTasksAnalyticsBundle } from '../../components/hub/tasks/TasksDataModeRouter';
import useTasksFilters from './hooks/useTasksFilters';
import useTasksListQuery from './hooks/useTasksListQuery';
import useTasksAnalyticsPanel from './hooks/useTasksAnalyticsPanel';
import useTaskDetails from './hooks/useTaskDetails.jsx';
import useTaskCreate from './hooks/useTaskCreate.jsx';

export default function useTasksPageController() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isAnalyticsMobile = isMobile;
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const renderTaskUserOption = useMemo(
    () => createTaskUserAutocompleteOptionRenderer({ ui, theme, multiple: false }),
    [ui, theme],
  );
  const renderTaskUserOptionMultiple = useMemo(
    () => createTaskUserAutocompleteOptionRenderer({ ui, theme, multiple: true }),
    [ui, theme],
  );
  const renderTaskUserTags = useMemo(
    () => createTaskUserAutocompleteTagsRenderer({ theme }),
    [theme],
  );
  const renderTaskObserverTags = useMemo(
    () => createTaskObserverAutocompleteTagsRenderer({ theme }),
    [theme],
  );
  const taskUserAutocompleteSlotProps = useMemo(
    () => ({ listbox: { sx: TASK_USER_AUTOCOMPLETE_LISTBOX_SX } }),
    [],
  );
  const analyticsAccentColor = theme?.palette?.primary?.main || '#2563eb';
  const analyticsGridStroke = ui?.borderSoft || 'rgba(148,163,184,0.22)';
  const navigate = useNavigate();
  const { user, hasPermission, hasAnyPermission } = useAuth();
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';
  const canManageAllTasks = isAdmin || hasPermission('tasks.manage_all');
  const canCreateTasks = hasAnyPermission(['tasks.create', 'tasks.write']);
  const canWriteTasks = hasPermission('tasks.write');
  const canReviewTasks = hasPermission('tasks.review');
  const taskDiscussionChatEnabled = CHAT_FEATURE_ENABLED && TASK_DISCUSSION_CHAT_ENABLED;
  const canUseControllerTab = canReviewTasks;

  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const taskOpenTriggerRef = useRef(null);
  const taskOpenTriggerIdRef = useRef('');

  const [assigneeSearchInput, setAssigneeSearchInput] = useState('');
  const [observerSearchInput, setObserverSearchInput] = useState('');
  const debouncedAssigneeSearchInput = useDebounce(assigneeSearchInput, 300);
  const debouncedObserverSearchInput = useDebounce(observerSearchInput, 300);
  const {
    search: searchAssignees,
    resolveByIds: resolveAssigneesByIds,
    getById: getAssigneeById,
    getPickerOptions: getAssigneePickerOptions,
    clearSearchResults: clearAssigneeSearchResults,
    mergeIntoCache: mergeAssigneesIntoCache,
    loading: assigneeSearchLoading,
    error: assigneeSearchError,
  } = useTaskAssigneeDirectory();

  const assigneeAutocompleteProps = useMemo(() => ({
    filterOptions: (options) => options,
    inputValue: assigneeSearchInput,
    clearOnBlur: false,
    onInputChange: (_, value, reason) => {
      if (reason === 'input') {
        setAssigneeSearchInput(value);
        return;
      }
      if (reason === 'reset' || reason === 'clear') {
        setAssigneeSearchInput('');
        clearAssigneeSearchResults();
      }
    },
    loading: assigneeSearchLoading,
    noOptionsText: String(assigneeSearchInput || '').trim().length < TASK_ASSIGNEE_SEARCH_MIN_CHARS
      ? 'Введите фамилию или логин'
      : (assigneeSearchError || 'Ничего не найдено'),
  }), [assigneeSearchError, assigneeSearchInput, assigneeSearchLoading, clearAssigneeSearchResults]);

  const observerAutocompleteProps = useMemo(() => ({
    filterOptions: (options) => options,
    inputValue: observerSearchInput,
    clearOnBlur: false,
    onInputChange: (_, value, reason) => {
      if (reason === 'input') {
        setObserverSearchInput(value);
        return;
      }
      if (reason === 'reset' || reason === 'clear') {
        setObserverSearchInput('');
        clearAssigneeSearchResults();
      }
    },
    loading: assigneeSearchLoading,
    noOptionsText: String(observerSearchInput || '').trim().length < TASK_ASSIGNEE_SEARCH_MIN_CHARS
      ? 'Введите фамилию или логин'
      : (assigneeSearchError || 'Ничего не найдено'),
  }), [assigneeSearchError, assigneeSearchLoading, clearAssigneeSearchResults, observerSearchInput]);

  const resetTaskUserSearchInputs = useCallback(() => {
    setAssigneeSearchInput('');
    setObserverSearchInput('');
    clearAssigneeSearchResults();
  }, [clearAssigneeSearchResults]);

  const handleSingleAssigneeAutocompleteChange = useCallback((onSelect) => (_, value) => {
    onSelect(value);
    setAssigneeSearchInput(value ? getTaskUserLabel(value) : '');
    clearAssigneeSearchResults();
  }, [clearAssigneeSearchResults]);

  const getAssigneeAutocompleteInputValue = useCallback((selectedUser) => {
    const searchText = String(assigneeSearchInput || '');
    if (searchText.trim()) return searchText;
    return selectedUser ? getTaskUserLabel(selectedUser) : '';
  }, [assigneeSearchInput]);

  const filters = useTasksFilters({
    canManageAllTasks,
    canUseControllerTab,
    isMobile,
    ui,
    tasksTotal: 0,
    departments: [],
    controllers: [],
    getAssigneeById,
    getAssigneePickerOptions,
    handleSingleAssigneeAutocompleteChange,
    renderTaskUserOption,
    taskUserAutocompleteSlotProps,
    assigneeAutocompleteProps,
    getAssigneeAutocompleteInputValue,
    taskDiscussionChatEnabled,
  });

  const list = useTasksListQuery({
    setError,
    viewMode: filters.viewMode,
    debouncedQ: filters.debouncedQ,
    statusFilter: filters.statusFilter,
    dueState: filters.dueState,
    assigneeFilter: filters.assigneeFilter,
    controllerFilter: filters.controllerFilter,
    departmentFilter: filters.departmentFilter,
    hasAttachments: filters.hasAttachments,
    unreadCommentsOnly: filters.unreadCommentsOnly,
    focusMode: filters.focusMode,
    dateSortDirection: filters.dateSortDirection,
    pageMode: filters.pageMode,
    canManageAllTasks,
    createOpen,
    editOpen,
    showFilters: filters.showFilters,
    mobileBoardFiltersOpen: filters.mobileBoardFiltersOpen,
  });

  const boardFiltersPanelProps = useMemo(() => ({
    ...filters.boardFiltersPanelProps,
    departments: list.departments,
    controllers: list.controllers,
    selectedBoardAssignee: getAssigneeById(filters.assigneeFilter),
    selectedBoardController: findTaskUserById(list.controllers, filters.controllerFilter),
    selectedBoardDepartment: findDepartmentById(list.departments, filters.departmentFilter),
  }), [
    filters.assigneeFilter,
    filters.boardFiltersPanelProps,
    filters.controllerFilter,
    filters.departmentFilter,
    getAssigneeById,
    list.controllers,
    list.departments,
  ]);

  const personalRoleCounts = useMemo(() => {
    if (filters.viewMode !== 'assignee' && filters.viewMode !== 'creator') return {};
    return { [filters.viewMode]: Number(list.tasksPayload?.total ?? 0) };
  }, [filters.viewMode, list.tasksPayload?.total]);

  useEffect(() => {
    const normalized = String(debouncedAssigneeSearchInput || '').trim();
    if (normalized.length < TASK_ASSIGNEE_SEARCH_MIN_CHARS) return;
    void searchAssignees(normalized);
  }, [debouncedAssigneeSearchInput, searchAssignees]);

  useEffect(() => {
    const normalized = String(debouncedObserverSearchInput || '').trim();
    if (normalized.length < TASK_ASSIGNEE_SEARCH_MIN_CHARS) return;
    void searchAssignees(normalized);
  }, [debouncedObserverSearchInput, searchAssignees]);

  const details = useTaskDetails({
    user,
    canManageAllTasks,
    canReviewTasks,
    taskDiscussionChatEnabled,
    isMobile,
    ui,
    setError,
    patchTaskItem: list.patchTaskItem,
    loadTasks: list.loadTasks,
    departments: list.departments,
  });

  useEffect(() => {
    let refreshTimer = null;
    let refreshSelectedTask = false;
    let selectedTaskDeleted = false;
    const scheduleRefresh = ({ taskId = '', operation = '', forceSnapshot = false } = {}) => {
      const normalizedTaskId = String(taskId || '').trim();
      const selectedTaskId = String(details.selectedTaskId || '').trim();
      if (forceSnapshot || (normalizedTaskId && normalizedTaskId === selectedTaskId)) {
        refreshSelectedTask = Boolean(selectedTaskId);
        selectedTaskDeleted = selectedTaskDeleted
          || (normalizedTaskId === selectedTaskId && operation === 'deleted');
      }
      if (refreshTimer) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void list.reloadTasks();
        if (selectedTaskDeleted) {
          details.closeTaskDetails();
        } else if (refreshSelectedTask && selectedTaskId) {
          void details.loadTaskDetails(selectedTaskId);
        }
        refreshSelectedTask = false;
        selectedTaskDeleted = false;
      }, 75);
    };
    const handleTaskChanged = (event) => {
      const payload = event?.detail?.payload || {};
      scheduleRefresh({
        taskId: payload.task_id,
        operation: String(payload.operation || '').trim().toLowerCase(),
      });
    };
    const handleConnected = () => scheduleRefresh({ forceSnapshot: true });

    window.addEventListener(HUB_REALTIME_TASK_EVENT, handleTaskChanged);
    window.addEventListener(HUB_REALTIME_CONNECTED_EVENT, handleConnected);
    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      window.removeEventListener(HUB_REALTIME_TASK_EVENT, handleTaskChanged);
      window.removeEventListener(HUB_REALTIME_CONNECTED_EVENT, handleConnected);
    };
  }, [
    details.closeTaskDetails,
    details.loadTaskDetails,
    details.selectedTaskId,
    list.reloadTasks,
  ]);

  const create = useTaskCreate({
    canCreateTasks,
    isMobile,
    setError,
    loadTasks: list.loadTasks,
    loadTaskMeta: list.loadTaskMeta,
    loadTaskUserDirectories: list.loadTaskUserDirectories,
    loadTaskUsers: list.loadTaskUsers,
    controllers: list.controllers,
    departments: list.departments,
    activeTaskProjects: list.activeTaskProjects,
    activeTaskObjects: list.activeTaskObjects,
    taskEmailDeadlineDefaultHours: list.taskEmailDeadlineDefaultHours,
    getAssigneeById,
    resolveAssigneesByIds,
    mergeAssigneesIntoCache,
    clearAssigneeSearchResults,
    setAssigneeSearchInput,
    setObserverSearchInput,
    resetTaskUserSearchInputs,
    refreshTasksAndDetails: details.refreshTasksAndDetails,
    loadTaskDetails: details.loadTaskDetails,
    closeTaskDetails: details.closeTaskDetails,
    selectedTaskId: details.selectedTaskId,
    detailsTask: details.detailsTask,
    visibleTaskItems: list.visibleTaskItems,
    createOpen,
    setCreateOpen,
    editOpen,
    setEditOpen,
  });

  const analytics = useTasksAnalyticsPanel({
    enabled: filters.pageMode === 'analytics',
    activeTaskObjects: list.activeTaskObjects,
    activeTaskProjects: list.activeTaskProjects,
    getAssigneeById,
    isAnalyticsMobile,
    mobileBoardFiltersOpen: filters.mobileBoardFiltersOpen,
    setMobileBoardFiltersOpen: filters.setMobileBoardFiltersOpen,
    ui,
    analyticsAccentColor,
    handleSingleAssigneeAutocompleteChange,
    renderTaskUserOption,
    taskUserAutocompleteSlotProps,
    assigneeAutocompleteProps,
    getAssigneeAutocompleteInputValue,
    getAssigneePickerOptions,
  });

  const prefetchAnalytics = useCallback(() => {
    void preloadTasksAnalyticsBundle();
    void list.loadTaskMeta();
    void list.loadTaskUserDirectories();
    analytics.prefetchTaskAnalytics();
  }, [analytics.prefetchTaskAnalytics, list.loadTaskMeta, list.loadTaskUserDirectories]);

  const handleSetPageMode = useCallback((value) => {
    if (value === 'analytics') prefetchAnalytics();
    filters.setPageMode(value);
  }, [filters.setPageMode, prefetchAnalytics]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.requestIdleCallback !== 'function') return undefined;
    const id = window.requestIdleCallback(() => {
      void preloadTasksAnalyticsBundle();
    }, { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }, []);

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

  const handleExportTaskAnalytics = useCallback(async () => {
    analytics.setAnalyticsExporting(true);
    try {
      const response = await hubTaskAnalyticsAPI.exportTaskAnalyticsExcel(analytics.analyticsRequestParams);
      const filename = parseFilename(response?.headers?.['content-disposition']) || 'task_analytics.xlsx';
      downloadBlob(response, filename);
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка экспорта аналитики задач');
    } finally {
      analytics.setAnalyticsExporting(false);
    }
  }, [analytics, downloadBlob, setError]);

  const searchCreateAssignees = useCallback(async (query) => {
    const normalizedQuery = String(query || '').trim();
    if (normalizedQuery.length < TASK_ASSIGNEE_SEARCH_MIN_CHARS) return [];
    const payload = await hubTaskSupportAPI.getAssignees({ q: normalizedQuery, limit: TASK_ASSIGNEE_SEARCH_LIMIT });
    return Array.isArray(payload?.items) ? payload.items : [];
  }, []);

  const resolveCreateAssignees = useCallback(
    (ids) => resolveAssigneesByIds(ids),
    [resolveAssigneesByIds],
  );

  const transformTaskMarkdown = useCallback(async (text, context) => {
    try {
      return await hubMarkdownAPI.transformMarkdown({ text, context });
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка');
      throw err;
    }
  }, [setError]);

  const openTransferActReminder = useCallback((task) => {
    if (!canOpenTransferActUpload(task)) return;
    const uploadUrl = getTransferActUploadUrl(task);
    if (!uploadUrl) return;
    navigate(uploadUrl);
  }, [navigate]);

  const onOpenTaskDetails = useCallback((task) => {
    const taskId = String(task?.id || '').trim();
    taskOpenTriggerIdRef.current = taskId;
    if (typeof document !== 'undefined') {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement && activeElement.dataset?.taskOpenTrigger === taskId) {
        taskOpenTriggerRef.current = activeElement;
      } else if (taskId) {
        taskOpenTriggerRef.current = Array.from(document.querySelectorAll('[data-task-open-trigger]'))
          .find((element) => element.dataset?.taskOpenTrigger === taskId && element.getClientRects().length > 0)
          || null;
      }
    }
    details.openTaskDetails(task);
  }, [details.openTaskDetails]);

  const onCloseTaskDetails = useCallback(() => {
    const shouldRestoreListFocus = !details.taskReturnTo;
    details.closeTaskDetails();
    if (!shouldRestoreListFocus || typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      const taskId = taskOpenTriggerIdRef.current;
      const stored = taskOpenTriggerRef.current;
      const fallback = taskId
        ? Array.from(document.querySelectorAll('[data-task-open-trigger]'))
          .find((element) => element.dataset?.taskOpenTrigger === taskId && element.getClientRects().length > 0)
        : null;
      (stored?.isConnected ? stored : fallback)?.focus?.();
    });
  }, [details.closeTaskDetails, details.taskReturnTo]);

  const onOpenEditTask = useCallback((task) => {
    create.openEditTask(task);
  }, [create.openEditTask]);

  const onDeleteTask = useCallback((task) => {
    void create.handleDeleteTask(task);
  }, [create.handleDeleteTask]);

  const onCopyTaskLink = useCallback((item) => {
    void details.handleCopyTaskLink(item.id);
  }, [details.handleCopyTaskLink]);

  const handleTaskMenuAction = useCallback((task, key) => {
    if (key === 'upload_act') {
      openTransferActReminder(task);
      return;
    }
    if (key === 'start') {
      void create.handleStartTask(task?.id);
      return;
    }
    if (key === 'submit') {
      create.setSubmitTask(task);
      return;
    }
    if (key === 'review') {
      create.setReviewTask(task);
      return;
    }
    if (key === 'close') {
      create.setCloseTask(task);
      return;
    }
    if (key === 'reopen') {
      create.handleOpenReopenTask(task);
      return;
    }
    if (key === 'edit') {
      create.openEditTask(task);
      return;
    }
    if (key === 'delete') {
      void create.handleDeleteTask(task);
      return;
    }
    if (key === 'copy') {
      void details.handleCopyTaskLink(task?.id);
    }
  }, [
    create.handleDeleteTask,
    create.handleOpenReopenTask,
    create.handleStartTask,
    create.openEditTask,
    create.setCloseTask,
    create.setReviewTask,
    create.setSubmitTask,
    details.handleCopyTaskLink,
    openTransferActReminder,
  ]);

  const getTaskActionMenuItems = useCallback((task) => buildTaskActionMenuItems({
    canUploadAct: canOpenTransferActUpload(task),
    canStart: details.canStartTask(task),
    canSubmit: details.canSubmitTask(task),
    canReview: details.canReviewTask(task),
    canClose: details.canCloseTask(task),
    canReopen: details.canReopenTask(task),
    canEdit: details.canEditTask(task),
    canDelete: details.canDeleteTask(task),
  }), [
    details.canCloseTask,
    details.canDeleteTask,
    details.canEditTask,
    details.canReopenTask,
    details.canReviewTask,
    details.canStartTask,
    details.canSubmitTask,
  ]);

  const renderTaskCard = useCallback((task, column) => (
    <TaskCard
        task={task}
      column={column}
      isMobile={isMobile}
        ui={ui}
      canEdit={details.canEditTask(task)}
      canDelete={details.canDeleteTask(task)}
      canStart={details.canStartTask(task)}
      canSubmit={details.canSubmitTask(task)}
      canReview={details.canReviewTask(task)}
      canClose={details.canCloseTask(task)}
      canReopen={details.canReopenTask(task)}
      onOpen={onOpenTaskDetails}
      onEdit={onOpenEditTask}
      onDelete={onDeleteTask}
      onCopyLink={onCopyTaskLink}
      onOpenTransferAct={openTransferActReminder}
      onStart={(item) => handleTaskMenuAction(item, 'start')}
      onSubmit={(item) => handleTaskMenuAction(item, 'submit')}
      onReview={(item) => handleTaskMenuAction(item, 'review')}
      onCloseTask={(item) => handleTaskMenuAction(item, 'close')}
      onReopen={(item) => handleTaskMenuAction(item, 'reopen')}
    />
  ), [
    details.canCloseTask,
    details.canDeleteTask,
    details.canEditTask,
    details.canReopenTask,
    details.canReviewTask,
    details.canStartTask,
    details.canSubmitTask,
    handleTaskMenuAction,
    isMobile,
    onCopyTaskLink,
    onDeleteTask,
    onOpenEditTask,
    onOpenTaskDetails,
    openTransferActReminder,
    ui,
  ]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const target = event.target;
      const tagName = String(target?.tagName || '').toLowerCase();
      const isTyping = Boolean(target?.isContentEditable) || tagName === 'input' || tagName === 'textarea';

      if (event.key === 'Escape') {
        if (editOpen) { setEditOpen(false); resetTaskUserSearchInputs(); return; }
        if (createOpen) { setCreateOpen(false); return; }
        if (create.reviewTask) { create.setReviewTask(null); return; }
        if (create.closeTask) { create.setCloseTask(null); return; }
        if (create.reopenTargetTask && !create.reopeningTaskId) { create.setReopenTargetTask(null); return; }
        if (create.submitTask) { create.setSubmitTask(null); return; }
        if (details.detailsOpen) details.closeTaskDetails();
        return;
      }

      if (isTyping) return;

      if (canCreateTasks && String(event.key || '').toLowerCase() === 'n') {
        event.preventDefault();
        setCreateOpen(true);
        return;
      }

      if (event.key === '/' || String(event.key || '').toLowerCase() === 'f') {
        event.preventDefault();
        if (filters.pageMode === 'analytics') {
          if (isAnalyticsMobile) filters.setMobileBoardFiltersOpen(true);
          else analytics.setAnalyticsDesktopFiltersVisible(true);
          return;
        }
        if (!isMobile) filters.setShowFilters(true);
        else filters.setMobileSearchOpen(true);
        window.requestAnimationFrame(() => filters.searchInputRef.current?.focus?.());
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [analytics, canCreateTasks, create, createOpen, details, editOpen, filters, isAnalyticsMobile, isMobile, setCreateOpen, setEditOpen]);

  const boardSummaryItems = useMemo(() => [
    { key: 'open', label: 'Открыто', value: list.openTasksCount, color: '#2563eb' },
    { key: 'review', label: 'Проверка', value: list.focusCounts.review, color: '#7c3aed' },
    { key: 'overdue', label: 'Просрочено', value: list.focusCounts.overdue, color: '#dc2626' },
    { key: 'comments', label: getTaskUnreadBoardLabel(taskDiscussionChatEnabled), value: list.focusCounts.comments, color: '#059669' },
  ], [
    list.focusCounts.comments,
    list.focusCounts.overdue,
    list.focusCounts.review,
    list.openTasksCount,
    taskDiscussionChatEnabled,
  ]);

  const handleCloseMobileBoardFilters = useCallback(() => {
    filters.setMobileBoardFiltersOpen(false);
  }, [filters.setMobileBoardFiltersOpen]);

  const handleOpenTaxonomy = useCallback(() => {
    create.setTaxonomyOpen(true);
  }, [create.setTaxonomyOpen]);

  const handleRefreshTasks = useCallback(() => {
    void list.loadTasks();
  }, [list.loadTasks]);

  const handleRefreshAnalytics = useCallback(() => {
    void analytics.loadTaskAnalytics({ force: true });
  }, [analytics.loadTaskAnalytics]);

  const mobileTasksCopy = TASKS_MOBILE_COPY;
  const mobileModeLabel = filters.pageMode === 'list' ? mobileTasksCopy.feedTitle : list.activeTaskModeMeta.label;
  const mobileBottomMode = ['list', 'deadlines', 'board'].includes(filters.pageMode) ? filters.pageMode : 'more';
  const mobilePrimaryModeOptions = useMemo(
    () => buildTasksMobilePrimaryModeOptions(mobileTasksCopy.feedTitle),
    [mobileTasksCopy.feedTitle],
  );

  const mobileHeaderSubtitle = list.isTaskDataMode
    ? `${list.visibleTaskItems.length} ${mobileTasksCopy.listSuffix}`
    : (analytics.analyticsFocusMeta?.title || 'Аналитика');

  const mobileNavigationDrawerProps = useMemo(() => (isMobile ? {
    open: filters.mobileBoardFiltersOpen,
    onClose: handleCloseMobileBoardFilters,
    ui,
    mobileTasksCopy,
    isTaskDataMode: list.isTaskDataMode,
    pageMode: filters.pageMode,
    onPageModeChange: handleSetPageMode,
    canWriteTasks,
    onOpenTaxonomy: handleOpenTaxonomy,
    canManageAllTasks,
    canUseControllerTab,
    secondaryViewMode: filters.secondaryViewMode,
    onViewModeChange: filters.setViewMode,
    boardSummaryItems,
    statusFilter: filters.statusFilter,
    onStatusFilterChange: filters.setStatusFilter,
    focusMode: filters.focusMode,
    focusCounts: list.focusCounts,
    onFocusModeChange: filters.setFocusMode,
    taskDiscussionChatEnabled,
    boardFiltersPanelProps,
    onRefreshTasks: handleRefreshTasks,
    onRefreshAnalytics: handleRefreshAnalytics,
    analyticsLoading: analytics.analyticsLoading,
    analyticsExporting: analytics.analyticsExporting,
    onExportAnalytics: handleExportTaskAnalytics,
    analyticsFocusMeta: analytics.analyticsFocusMeta,
    analyticsFiltersPanelProps: analytics.analyticsFiltersPanelProps,
    onResetFilters: filters.resetFilters,
    mobileMoreModeOptions: TASKS_MOBILE_MORE_MODE_OPTIONS,
  } : null), [
    analytics.analyticsExporting,
    analytics.analyticsFiltersPanelProps,
    analytics.analyticsFocusMeta,
    analytics.analyticsLoading,
    analytics.loadTaskAnalytics,
    boardFiltersPanelProps,
    boardSummaryItems,
    canManageAllTasks,
    canUseControllerTab,
    canWriteTasks,
    create.setTaxonomyOpen,
    filters.focusMode,
    filters.mobileBoardFiltersOpen,
    filters.pageMode,
    filters.resetFilters,
    filters.secondaryViewMode,
    filters.setFocusMode,
    handleSetPageMode,
    filters.setStatusFilter,
    filters.setViewMode,
    filters.statusFilter,
    handleCloseMobileBoardFilters,
    handleExportTaskAnalytics,
    handleOpenTaxonomy,
    handleRefreshAnalytics,
    handleRefreshTasks,
    isMobile,
    list.focusCounts,
    list.isTaskDataMode,
    list.loadTasks,
    mobileTasksCopy,
    taskDiscussionChatEnabled,
    ui,
  ]);

  const prefetchCreateMeta = useCallback(() => {
    void list.loadTaskMeta();
    void list.loadTaskUserDirectories();
  }, [list.loadTaskMeta, list.loadTaskUserDirectories]);

  return {
    theme,
    isMobile,
    isAnalyticsMobile,
    ui,
    renderTaskUserOption,
    renderTaskUserOptionMultiple,
    renderTaskUserTags,
    renderTaskObserverTags,
    taskUserAutocompleteSlotProps,
    assigneeAutocompleteProps,
    observerAutocompleteProps,
    analyticsAccentColor,
    analyticsGridStroke,
    loading: list.loading,
    error,
    setError,
    pageMode: filters.pageMode,
    setPageMode: handleSetPageMode,
    detailsOpen: details.detailsOpen,
    detailsTask: details.detailsTask,
    detailsLoading: details.detailsLoading,
    selectedMobileTaskView: details.selectedMobileTaskView,
    selectedTaskTab: details.selectedTaskTab,
    selectedTaskView: details.selectedTaskView,
    taskDiscussionChatEnabled,
    discussionOpening: details.discussionOpening,
    discussionError: details.discussionError,
    discussionConversationId: details.selectedDiscussionConversationId,
    discussionMessageId: details.selectedDiscussionMessageId,
    taskBackLabel: details.taskBackLabel,
    reopeningTaskId: create.reopeningTaskId,
    detailsComments: details.detailsComments,
    detailsStatusLog: details.detailsStatusLog,
    detailsActivityLoading: details.detailsActivityLoading,
    detailsCommentBody: details.detailsCommentBody,
    detailsCommentSaving: details.detailsCommentSaving,
    uploadingAttachment: details.uploadingAttachment,
    canEditTask: details.canEditTask,
    canDeleteTask: details.canDeleteTask,
    canUploadFiles: details.canUploadFiles,
    canUpdateTaskChecklist: details.canUpdateTaskChecklist,
    canStartTask: details.canStartTask,
    canSubmitTask: details.canSubmitTask,
    canReviewTask: details.canReviewTask,
    canCloseTask: details.canCloseTask,
    canReopenTask: details.canReopenTask,
    closeTaskDetails: onCloseTaskDetails,
    closeMobileTaskChecklist: details.closeMobileTaskChecklist,
    handleCopyTaskLink: details.handleCopyTaskLink,
    openEditTask: create.openEditTask,
    handleDeleteTask: create.handleDeleteTask,
    handleOpenTaskDiscussion: details.handleOpenTaskDiscussion,
    retryTaskDiscussion: details.retryTaskDiscussion,
    handleToggleTaskChecklistItem: details.handleToggleTaskChecklistItem,
    handleAddTaskChecklistItem: details.handleAddTaskChecklistItem,
    handleUploadAttachment: details.handleUploadAttachment,
    handleDownloadAttachment: details.handleDownloadAttachment,
    handleDownloadReport: details.handleDownloadReport,
    setTaskDetailTab: details.setTaskDetailTab,
    setTaskDetailView: details.setTaskDetailView,
    setDetailsCommentBody: details.setDetailsCommentBody,
    handleAddTaskComment: details.handleAddTaskComment,
    openMobileTaskChecklist: details.openMobileTaskChecklist,
    openTransferActReminder,
    handleStartTask: create.handleStartTask,
    handleOpenReopenTask: create.handleOpenReopenTask,
    setSubmitTask: create.setSubmitTask,
    setReviewTask: create.setReviewTask,
    getTaskActionMenuItems,
    handleTaskMenuAction,
    renderTaskChecklist: details.renderTaskChecklist,
    mobileTasksCopy,
    mobileModeLabel,
    mobileHeaderSubtitle,
    isTaskDataMode: list.isTaskDataMode,
    mobileSearchOpen: filters.mobileSearchOpen,
    setMobileSearchOpen: filters.setMobileSearchOpen,
    q: filters.q,
    setQ: filters.setQ,
    statusFilter: filters.statusFilter,
    dueState: filters.dueState,
    controllerFilter: filters.controllerFilter,
    departmentFilter: filters.departmentFilter,
    hasAttachments: filters.hasAttachments,
    unreadCommentsOnly: filters.unreadCommentsOnly,
    searchInputRef: filters.searchInputRef,
    activeFilterCount: filters.activeFilterCount,
    setMobileBoardFiltersOpen: filters.setMobileBoardFiltersOpen,
    mobileBottomMode,
    mobilePrimaryModeOptions,
    handlePersonalRoleChange: filters.handlePersonalRoleChange,
    personalRoleCounts,
    viewMode: filters.viewMode,
    boardSummaryItems,
    canWriteTasks,
    canCreateTasks,
    loadTaskAnalytics: analytics.loadTaskAnalytics,
    loadTasks: list.loadTasks,
    loadMoreTasks: list.loadMoreTasks,
    hasMoreTasks: list.hasMoreTasks,
    tasksTotal: list.tasksTotal,
    setTaxonomyOpen: create.setTaxonomyOpen,
    setCreateOpen,
    secondaryViewMode: filters.secondaryViewMode,
    setViewMode: filters.setViewMode,
    canManageAllTasks,
    canUseControllerTab,
    focusMode: filters.focusMode,
    dateSortDirection: filters.dateSortDirection,
    setDateSortDirection: filters.setDateSortDirection,
    focusCounts: list.focusCounts,
    setFocusMode: filters.setFocusMode,
    showFilters: filters.showFilters,
    setShowFilters: filters.setShowFilters,
    boardFiltersPanelProps,
    analyticsFiltersVisible: analytics.analyticsFiltersVisible,
    toggleAnalyticsFilters: analytics.toggleAnalyticsFilters,
    handleExportTaskAnalytics,
    analyticsLoading: analytics.analyticsLoading,
    analyticsExporting: analytics.analyticsExporting,
    analyticsFocusMeta: analytics.analyticsFocusMeta,
    analyticsFiltersPanelProps: analytics.analyticsFiltersPanelProps,
    analyticsKpis: analytics.analyticsKpis,
    analyticsPayload: analytics.analyticsPayload,
    analyticsError: analytics.analyticsError,
    analyticsHasCurrentPayload: analytics.analyticsHasCurrentPayload,
    analyticsProjectSectionMeta: analytics.analyticsProjectSectionMeta,
    selectedAnalyticsProjects: analytics.selectedAnalyticsProjects,
    selectedAnalyticsObjects: analytics.selectedAnalyticsObjects,
    selectAnalyticsParticipant: analytics.selectAnalyticsParticipant,
    analyticsStatusChartData: analytics.analyticsStatusChartData,
    analyticsTrendItems: analytics.analyticsTrendItems,
    analyticsParticipantSectionMeta: analytics.analyticsParticipantSectionMeta,
    analyticsParticipantChartData: analytics.analyticsParticipantChartData,
    analyticsScopeChart: analytics.analyticsScopeChart,
    selectedAnalyticsParticipant: analytics.selectedAnalyticsParticipant,
    analyticsTableColumns: analytics.analyticsTableColumns,
    visibleTaskItems: list.visibleTaskItems,
    taskItems: list.taskItems,
    taskListSections: list.taskListSections,
    completedTasksOpen: filters.completedTasksOpen,
    setCompletedTasksOpen: filters.setCompletedTasksOpen,
    activeTaskProjects: list.activeTaskProjects,
    openTaskDetails: onOpenTaskDetails,
    deadlineBuckets: list.deadlineBuckets,
    openCreateTaskWithPreset: create.openCreateTaskWithPreset,
    renderTaskCard,
    calendarPayload: list.calendarPayload,
    shiftCalendarMonth: list.shiftCalendarMonth,
    setCalendarMonth: list.setCalendarMonth,
    setDueState: filters.setDueState,
    ganttPayload: list.ganttPayload,
    columnData: list.columnData,
    mobileBoardItems: list.mobileBoardItems,
    mobileNavigationDrawerProps,
    createOpen,
    handleCloseCreateDialog: create.handleCloseCreateDialog,
    createData: create.createData,
    setCreateData: create.setCreateData,
    createSaving: create.createSaving,
    handleCreateTask: create.handleCreateTask,
    handleCreateDescriptionDraftChange: create.handleCreateDescriptionDraftChange,
    handleOpenCreateMobileSheet: create.handleOpenCreateMobileSheet,
    createDescriptionSummary: create.createDescriptionSummary,
    createAssigneeSummary: create.createAssigneeSummary,
    createEmailRemindSummary: create.createEmailRemindSummary,
    createDueLabel: create.createDueLabel,
    createDueAnchorRef: create.createDueAnchorRef,
    setCreateDuePickerOpen: create.setCreateDuePickerOpen,
    selectedCreateAssignees: create.selectedCreateAssignees,
    selectedCreateController: create.selectedCreateController,
    selectedCreateObservers: create.selectedCreateObservers,
    selectedCreateDepartment: create.selectedCreateDepartment,
    getAssigneePickerOptions,
    handleChangeCreateAssigneeIds: create.handleChangeCreateAssigneeIds,
    handleChangeCreateObserverIds: create.handleChangeCreateObserverIds,
    createOptionalSections: create.createOptionalSections,
    createFiles: create.createFiles,
    createChecklistItems: create.createChecklistItems,
    createProjectName: create.createProjectName,
    setCreateProjectName: create.setCreateProjectName,
    handleCreateProjectFromTaskDialog: create.handleCreateProjectFromTaskDialog,
    createProjectSaving: create.createProjectSaving,
    handleAddChecklistItem: create.handleAddChecklistItem,
    handleUpdateChecklistItem: create.handleUpdateChecklistItem,
    handleRemoveChecklistItem: create.handleRemoveChecklistItem,
    handleAddCreateFiles: create.handleAddCreateFiles,
    handleRemoveCreateFile: create.handleRemoveCreateFile,
    taskUsersLoading: list.taskUsersLoading,
    taskUsersLoadError: list.taskUsersLoadError,
    taskEmailDeadlineDefaultHours: list.taskEmailDeadlineDefaultHours,
    effectiveCreateProjectId: create.effectiveCreateProjectId,
    effectiveCreateProject: create.effectiveCreateProject,
    createMobileSheet: create.createMobileSheet,
    setCreateMobileSheet: create.setCreateMobileSheet,
    createDescriptionRef: create.createDescriptionRef,
    createDescriptionPreview: create.createDescriptionPreview,
    setCreateOptionalSections: create.setCreateOptionalSections,
    loadTaskUserDirectories: list.loadTaskUserDirectories,
    handleCloseCreateMobileSheet: create.handleCloseCreateMobileSheet,
    searchCreateAssignees,
    resolveCreateAssignees,
    handleChangeCreateControllerId: create.handleChangeCreateControllerId,
    handleClearCreateController: create.handleClearCreateController,
    handleClearCreateAssignees: create.handleClearCreateAssignees,
    handleClearCreateObservers: create.handleClearCreateObservers,
    createDuePickerOpen: create.createDuePickerOpen,
    handleCloseCreateDuePicker: create.handleCloseCreateDuePicker,
    createDuePresets: create.createDuePresets,
    handleSelectCreateDuePreset: create.handleSelectCreateDuePreset,
    handleCreateDueAtChange: create.handleCreateDueAtChange,
    createDueCustomOpen: create.createDueCustomOpen,
    setCreateDueCustomOpen: create.setCreateDueCustomOpen,
    editOpen,
    setEditOpen,
    handleCloseEdit: create.handleCloseEdit,
    editData: create.editData,
    setEditData: create.setEditData,
    editSaving: create.editSaving,
    handleSaveEdit: create.handleSaveEdit,
    handleEditDescriptionDraftChange: create.handleEditDescriptionDraftChange,
    handleEditObserversChange: create.handleEditObserversChange,
    transformTaskMarkdown,
    selectedEditAssignees: create.selectedEditAssignees,
    selectedEditController: create.selectedEditController,
    selectedEditObservers: create.selectedEditObservers,
    selectedEditDepartment: create.selectedEditDepartment,
    controllers: list.controllers,
    departments: list.departments,
    editProjectObjects: create.editProjectObjects,
    handleSingleAssigneeAutocompleteChange,
    getAssigneeAutocompleteInputValue,
    editDueLabel: create.editDueLabel,
    editDueCustomOpen: create.editDueCustomOpen,
    setEditDueCustomOpen: create.setEditDueCustomOpen,
    handleSelectEditDuePreset: create.handleSelectEditDuePreset,
    handleEditDueAtChange: create.handleEditDueAtChange,
    taxonomyOpen: create.taxonomyOpen,
    taxonomySaving: create.taxonomySaving,
    projectDraft: create.projectDraft,
    setProjectDraft: create.setProjectDraft,
    objectDraft: create.objectDraft,
    setObjectDraft: create.setObjectDraft,
    editingProjectId: create.editingProjectId,
    editingObjectId: create.editingObjectId,
    handleCreateProject: create.handleCreateProject,
    handleCreateObject: create.handleCreateObject,
    handleEditProject: create.handleEditProject,
    handleEditObject: create.handleEditObject,
    resetProjectDraft: create.resetProjectDraft,
    resetObjectDraft: create.resetObjectDraft,
    taskProjects: list.taskProjects,
    taskObjects: list.taskObjects,
    reviewTask: create.reviewTask,
    reviewSaving: create.reviewSaving,
    handleReviewTask: create.handleReviewTask,
    closeTask: create.closeTask,
    closeSaving: create.closeSaving,
    handleCloseTask: create.handleCloseTask,
    setCloseTask: create.setCloseTask,
    reopenTargetTask: create.reopenTargetTask,
    setReopenTargetTask: create.setReopenTargetTask,
    handleConfirmReopenTask: create.handleConfirmReopenTask,
    submitTask: create.submitTask,
    submitSaving: create.submitSaving,
    handleSubmitTask: create.handleSubmitTask,
    statusMeta,
    priorityMeta,
    formatDateTime,
    formatFileSize,
    getInitials,
    canOpenTransferActUpload,
    getAssigneeById,
    resolveAssigneesByIds,
    assigneeFilter: filters.assigneeFilter,
    statusOptions: filters.statusOptions,
    dueStateOptions: filters.dueStateOptions,
    selectedBoardDepartment: findDepartmentById(list.departments, filters.departmentFilter),
    selectedBoardAssignee: getAssigneeById(filters.assigneeFilter),
    selectedBoardController: findTaskUserById(list.controllers, filters.controllerFilter),
    activeTaskObjects: list.activeTaskObjects,
    prefetchCreateMeta,
    prefetchAnalytics,
  };
}
