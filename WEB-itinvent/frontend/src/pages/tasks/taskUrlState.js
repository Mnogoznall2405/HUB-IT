import { normalizeTaskMode } from '../tasksViewModel';

export const TASK_MODE_STORAGE_KEY = 'hub.tasks.taskMode';
export const TASK_PERSONAL_ROLE_STORAGE_KEY = 'hub.tasks.personalRole';
export const PENDING_TASK_CREATE_STORAGE_KEY = 'hub.tasks.pendingCreate';

export const safeReadStoredPersonalRole = () => {
  if (typeof window === 'undefined' || !window.localStorage) return '';
  try {
    const value = String(window.localStorage.getItem(TASK_PERSONAL_ROLE_STORAGE_KEY) || '').trim().toLowerCase();
    if (value === 'creator') return 'creator';
    if (value === 'assignee') return 'assignee';
    return '';
  } catch {
    return '';
  }
};

export const safeWriteStoredPersonalRole = (value) => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const normalized = value === 'creator' ? 'creator' : 'assignee';
  try {
    window.localStorage.setItem(TASK_PERSONAL_ROLE_STORAGE_KEY, normalized);
  } catch {
    // localStorage can be unavailable in private or locked-down browsers.
  }
};

export const readTaskFilters = (search = '') => {
  const params = new URLSearchParams(search || '');
  return {
    taskMode: normalizeTaskMode(params.get('task_mode') || '', ''),
    viewMode: String(params.get('task_view') || ''),
    q: String(params.get('task_q') || ''),
    status: String(params.get('task_status') || ''),
    dueState: String(params.get('task_due') || ''),
    assigneeFilter: String(params.get('task_assignee') || ''),
    controllerFilter: String(params.get('task_controller') || ''),
    departmentFilter: String(params.get('task_department') || ''),
    hasAttachments: params.get('task_files') === '1',
    unreadCommentsOnly: params.get('task_unread_comments') === '1',
    focusMode: String(params.get('task_focus') || 'all') || 'all',
  };
};

export const resolveInitialViewMode = (search = '', canManageAll = false) => {
  const fromUrl = readTaskFilters(search).viewMode;
  if (fromUrl && ['all', 'assignee', 'creator', 'controller', 'department'].includes(fromUrl)) {
    return fromUrl;
  }
  if (canManageAll) return 'all';
  return safeReadStoredPersonalRole() || 'assignee';
};

export const safeReadStoredTaskMode = () => {
  if (typeof window === 'undefined' || !window.localStorage) return '';
  try {
    return normalizeTaskMode(window.localStorage.getItem(TASK_MODE_STORAGE_KEY) || '', '');
  } catch {
    return '';
  }
};

export const safeWriteStoredTaskMode = (value) => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const normalized = normalizeTaskMode(value || '', 'list') || 'list';
  try {
    window.localStorage.setItem(TASK_MODE_STORAGE_KEY, normalized);
  } catch {
    // localStorage can be unavailable in private or locked-down browsers.
  }
};

export const hasTaskModeQueryParam = (search = '') => {
  const params = new URLSearchParams(search || '');
  return params.has('task_mode');
};
