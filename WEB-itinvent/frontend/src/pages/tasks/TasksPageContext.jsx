import { createContext, useContext, useMemo } from 'react';

const TasksPageContext = createContext(null);

function pick(source, keys) {
  const out = {};
  keys.forEach((key) => {
    out[key] = source[key];
  });
  return out;
}

export function TasksPageProvider({ controller, children }) {
  const value = useMemo(() => ({
    ui: pick(controller, [
      'theme', 'isMobile', 'isAnalyticsMobile', 'ui',
      'renderTaskUserOption', 'renderTaskUserOptionMultiple', 'renderTaskUserTags',
      'renderTaskObserverTags', 'taskUserAutocompleteSlotProps', 'assigneeAutocompleteProps',
      'observerAutocompleteProps',
      'analyticsAccentColor', 'analyticsGridStroke', 'statusMeta', 'priorityMeta',
      'formatDateTime', 'formatFileSize', 'getInitials', 'canOpenTransferActUpload',
      'taskDiscussionChatEnabled', 'transformTaskMarkdown', 'getAssigneePickerOptions',
      'handleSingleAssigneeAutocompleteChange', 'getAssigneeAutocompleteInputValue',
    ]),
    list: pick(controller, [
      'loading', 'error', 'setError', 'visibleTaskItems', 'taskItems', 'taskListSections',
      'activeTaskProjects', 'deadlineBuckets', 'calendarPayload', 'shiftCalendarMonth',
      'setCalendarMonth', 'ganttPayload', 'columnData', 'mobileBoardItems', 'isTaskDataMode',
      'focusCounts', 'renderTaskCard', 'loadTasks', 'loadMoreTasks', 'hasMoreTasks', 'tasksTotal', 'listTruncated',
      'taskUsersLoading', 'taskUsersLoadError',
      'taskEmailDeadlineDefaultHours', 'departments', 'controllers', 'getAssigneePickerOptions',
      'getAssigneeById', 'assigneeFilter', 'resolveAssigneesByIds', 'activeTaskObjects',
      'taskProjects', 'taskObjects',
    ]),
    filters: pick(controller, [
      'pageMode', 'setPageMode', 'viewMode', 'setViewMode', 'q', 'setQ', 'statusFilter',
      'dueState', 'setDueState', 'controllerFilter', 'departmentFilter', 'hasAttachments',
      'unreadCommentsOnly', 'focusMode', 'setFocusMode', 'showFilters', 'setShowFilters',
      'boardFiltersPanelProps', 'boardSummaryItems', 'searchInputRef', 'activeFilterCount',
      'mobileSearchOpen', 'setMobileSearchOpen', 'setMobileBoardFiltersOpen',
      'mobileBottomMode', 'mobilePrimaryModeOptions', 'mobileModeLabel', 'mobileHeaderSubtitle',
      'mobileTasksCopy', 'handlePersonalRoleChange', 'personalRoleCounts', 'secondaryViewMode',
      'canManageAllTasks', 'canUseControllerTab', 'canWriteTasks', 'canCreateTasks',
      'statusOptions', 'dueStateOptions', 'selectedBoardDepartment', 'selectedBoardAssignee',
      'selectedBoardController', 'handleSingleAssigneeAutocompleteChange', 'getAssigneeAutocompleteInputValue',
      'taskDiscussionChatEnabled', 'mobileNavigationDrawerProps', 'completedTasksOpen', 'setCompletedTasksOpen',
    ]),
    detail: pick(controller, [
      'detailsOpen', 'detailsTask', 'detailsLoading', 'selectedMobileTaskView', 'selectedTaskTab',
      'discussionOpening', 'reopeningTaskId', 'detailsComments', 'detailsStatusLog',
      'detailsActivityLoading', 'detailsCommentBody', 'detailsCommentSaving', 'uploadingAttachment',
      'canEditTask', 'canDeleteTask', 'canUploadFiles', 'canUpdateTaskChecklist', 'canStartTask',
      'canSubmitTask', 'canReviewTask', 'canReopenTask', 'closeTaskDetails', 'closeMobileTaskChecklist',
      'handleCopyTaskLink', 'openEditTask', 'handleDeleteTask', 'handleOpenTaskDiscussion',
      'handleToggleTaskChecklistItem', 'handleAddTaskChecklistItem', 'handleUploadAttachment',
      'handleDownloadAttachment', 'handleDownloadReport', 'setTaskDetailTab', 'setDetailsCommentBody',
      'handleAddTaskComment', 'openMobileTaskChecklist', 'openTransferActReminder', 'handleStartTask',
      'handleOpenReopenTask', 'setSubmitTask', 'setReviewTask', 'renderTaskChecklist', 'openTaskDetails',
    ]),
    create: pick(controller, [
      'createOpen', 'setCreateOpen', 'handleCloseCreateDialog', 'createData', 'setCreateData',
      'createSaving', 'handleCreateTask', 'handleCreateDescriptionDraftChange', 'handleOpenCreateMobileSheet',
      'createDescriptionSummary', 'createAssigneeSummary', 'createEmailRemindSummary', 'createDueLabel',
      'createDueAnchorRef', 'setCreateDuePickerOpen', 'selectedCreateAssignees', 'selectedCreateController',
      'selectedCreateObservers', 'selectedCreateDepartment', 'handleChangeCreateAssigneeIds',
      'handleChangeCreateObserverIds', 'createOptionalSections', 'createFiles', 'createChecklistItems',
      'createProjectName', 'setCreateProjectName', 'handleCreateProjectFromTaskDialog', 'createProjectSaving',
      'handleAddChecklistItem', 'handleUpdateChecklistItem', 'handleRemoveChecklistItem',
      'handleAddCreateFiles', 'handleRemoveCreateFile', 'effectiveCreateProjectId', 'effectiveCreateProject',
      'createMobileSheet', 'setCreateMobileSheet', 'createDescriptionRef', 'createDescriptionPreview',
      'setCreateOptionalSections', 'loadTaskUserDirectories', 'handleCloseCreateMobileSheet',
      'searchCreateAssignees', 'resolveCreateAssignees', 'handleChangeCreateControllerId',
      'handleClearCreateController', 'handleClearCreateAssignees', 'handleClearCreateObservers',
      'createDuePickerOpen', 'handleCloseCreateDuePicker', 'createDuePresets', 'handleSelectCreateDuePreset',
      'handleCreateDueAtChange', 'createDueCustomOpen', 'setCreateDueCustomOpen',
      'editOpen', 'setEditOpen', 'handleCloseEdit', 'editData', 'setEditData', 'editSaving', 'handleSaveEdit',
      'handleEditDescriptionDraftChange', 'handleEditObserversChange', 'transformTaskMarkdown', 'selectedEditAssignee',
      'selectedEditController', 'selectedEditObservers', 'selectedEditDepartment', 'editProjectObjects',
      'editDueLabel', 'editDueCustomOpen', 'setEditDueCustomOpen', 'handleSelectEditDuePreset',
      'handleEditDueAtChange', 'taxonomyOpen', 'setTaxonomyOpen', 'taxonomySaving', 'projectDraft',
      'setProjectDraft', 'objectDraft', 'setObjectDraft', 'editingProjectId', 'editingObjectId',
      'handleCreateProject', 'handleCreateObject', 'handleEditProject', 'handleEditObject',
      'resetProjectDraft', 'resetObjectDraft', 'reviewTask', 'reviewSaving', 'handleReviewTask',
      'reopenTargetTask', 'setReopenTargetTask', 'handleConfirmReopenTask', 'submitTask', 'submitSaving',
      'handleSubmitTask', 'openCreateTaskWithPreset', 'prefetchCreateMeta',
    ]),
    analytics: pick(controller, [
      'analyticsFiltersVisible', 'toggleAnalyticsFilters', 'handleExportTaskAnalytics',
      'analyticsLoading', 'analyticsExporting', 'analyticsFocusMeta', 'analyticsFiltersPanelProps',
      'analyticsKpis', 'analyticsPayload', 'analyticsProjectSectionMeta', 'selectedAnalyticsProjects',
      'selectedAnalyticsObjects', 'selectAnalyticsParticipant', 'analyticsStatusChartData',
      'analyticsTrendItems', 'analyticsParticipantSectionMeta', 'analyticsParticipantChartData',
      'analyticsScopeChart', 'selectedAnalyticsParticipant', 'analyticsTableColumns', 'loadTaskAnalytics',
      'prefetchAnalytics',
    ]),
  }), [controller]);

  return (
    <TasksPageContext.Provider value={value}>
      {children}
    </TasksPageContext.Provider>
  );
}

export function useTasksPage() {
  const ctx = useContext(TasksPageContext);
  if (!ctx) {
    throw new Error('useTasksPage must be used within TasksPageProvider');
  }
  return ctx;
}

export function useTasksUiSlice() {
  return useTasksPage().ui;
}

export function useTasksListSlice() {
  return useTasksPage().list;
}

export function useTasksFiltersSlice() {
  return useTasksPage().filters;
}

export function useTasksDetailSlice() {
  return useTasksPage().detail;
}

export function useTasksCreateSlice() {
  return useTasksPage().create;
}

export function useTasksAnalyticsSlice() {
  return useTasksPage().analytics;
}
