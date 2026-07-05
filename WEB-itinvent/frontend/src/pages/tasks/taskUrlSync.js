import { safeReadStoredPersonalRole } from './taskUrlState';

const VIEW_MODES = ['all', 'assignee', 'creator', 'controller', 'department'];

export const resolveTaskViewModeFromUrl = ({
  viewMode = '',
  canManageAllTasks = false,
  canUseControllerTab = true,
} = {}) => {
  const fallbackView = canManageAllTasks ? 'all' : (safeReadStoredPersonalRole() || 'assignee');
  let nextView = viewMode || fallbackView;
  if (nextView === 'all' && !canManageAllTasks) nextView = fallbackView;
  if (nextView === 'controller' && !canUseControllerTab) nextView = fallbackView;
  if (!VIEW_MODES.includes(nextView)) nextView = fallbackView;
  return nextView;
};

export const applyTaskListFiltersToSearchParams = (params, filters, { canManageAllTasks = false } = {}) => {
  const nextParams = params instanceof URLSearchParams ? params : new URLSearchParams(params || '');
  const {
    pageMode = 'list',
    viewMode = 'assignee',
    q = '',
    statusFilter = '',
    dueState = '',
    assigneeFilter = '',
    controllerFilter = '',
    departmentFilter = '',
    hasAttachments = false,
    unreadCommentsOnly = false,
    focusMode = 'all',
  } = filters || {};

  if (pageMode && pageMode !== 'list') nextParams.set('task_mode', pageMode);
  else nextParams.delete('task_mode');

  if (viewMode && !(viewMode === 'assignee' && !canManageAllTasks)) nextParams.set('task_view', viewMode);
  else nextParams.delete('task_view');

  if (q) nextParams.set('task_q', q);
  else nextParams.delete('task_q');

  if (statusFilter) nextParams.set('task_status', statusFilter);
  else nextParams.delete('task_status');

  if (dueState) nextParams.set('task_due', dueState);
  else nextParams.delete('task_due');

  if (assigneeFilter) nextParams.set('task_assignee', assigneeFilter);
  else nextParams.delete('task_assignee');

  if (controllerFilter) nextParams.set('task_controller', controllerFilter);
  else nextParams.delete('task_controller');

  if (departmentFilter) nextParams.set('task_department', departmentFilter);
  else nextParams.delete('task_department');

  if (hasAttachments) nextParams.set('task_files', '1');
  else nextParams.delete('task_files');

  if (unreadCommentsOnly) nextParams.set('task_unread_comments', '1');
  else nextParams.delete('task_unread_comments');

  if (focusMode && focusMode !== 'all') nextParams.set('task_focus', focusMode);
  else nextParams.delete('task_focus');

  return nextParams;
};

export const buildAnalyticsRequestParams = (analyticsFilters = {}) => ({
  start_date: analyticsFilters.start_date || undefined,
  end_date: analyticsFilters.end_date || undefined,
  date_basis: analyticsFilters.date_basis || 'protocol_date',
  project_id: Array.isArray(analyticsFilters.project_ids) && analyticsFilters.project_ids.length > 0
    ? analyticsFilters.project_ids
    : undefined,
  object_id: Array.isArray(analyticsFilters.object_ids) && analyticsFilters.object_ids.length > 0
    ? analyticsFilters.object_ids
    : undefined,
  participant_user_id: analyticsFilters.participant_user_id
    ? Number(analyticsFilters.participant_user_id)
    : undefined,
});
