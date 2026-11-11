import { formatHubPersonDisplay } from '../../components/hub/taskWorkspaceActions';

export const getTaskUserLabel = (user) => {
  const fullName = String(user?.full_name || '').trim();
  const username = String(user?.username || '').trim();
  const display = formatHubPersonDisplay(fullName, username);
  return display.label === '-' ? 'Пользователь' : display.label;
};

export const getTaskAssigneeEntries = (task) => {
  const entries = Array.isArray(task?.assignees) ? task.assignees : [];
  if (entries.length) return entries;
  const ids = Array.isArray(task?.assignee_user_ids) && task.assignee_user_ids.length
    ? task.assignee_user_ids
    : [task?.assignee_user_id];
  return ids
    .map((userId, index) => ({
      user_id: userId,
      full_name: index === 0 ? task?.assignee_full_name : '',
      username: index === 0 ? task?.assignee_username : '',
    }))
    .filter((item) => String(item.user_id || '').trim());
};

export const formatTaskAssigneesSummary = (task, { compact = false } = {}) => {
  const labels = getTaskAssigneeEntries(task)
    .map((item) => String(item?.full_name || item?.username || item?.user_id || '').trim())
    .filter(Boolean);
  if (!labels.length) return '-';
  if (compact && labels.length > 2) return `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`;
  return labels.join(', ');
};

export const getDepartmentLabel = (department) => String(department?.name || department?.department_name || department?.id || '').trim();

export const findDepartmentById = (options, value) => (
  (Array.isArray(options) ? options : []).find((item) => String(item?.id || '') === String(value || '')) || null
);

export const getTaskUserSearchText = (user) => (
  [
    String(user?.full_name || '').trim(),
    String(user?.username || '').trim(),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
);

export const filterTaskUserOptions = (options, state) => {
  const query = String(state?.inputValue || '').trim().toLowerCase();
  if (!query) return options;
  return options.filter((option) => getTaskUserSearchText(option).includes(query));
};

export const findTaskUserById = (options, value) => (
  (Array.isArray(options) ? options : []).find((item) => String(item?.id || '') === String(value || '')) || null
);

export const formatHubTaskError = (error, fallback = 'Ошибка создания задачи') => {
  const detail = String(error?.response?.data?.detail || error?.message || '').trim();
  if (!detail) return fallback;
  const normalized = detail.toLowerCase();
  if (normalized.includes('task cannot be assigned in the selected department')) {
    return 'Нельзя назначить задачу в выбранном отделе. Выберите исполнителя из своего отдела или укажите его отдел.';
  }
  if (normalized.includes('task cannot be moved to the selected department')) {
    return 'Нельзя перенести задачу в выбранный отдел.';
  }
  return detail;
};

export const areSameTaskUsers = (option, value) => String(option?.id || '') === String(value?.id || '');

export const TASK_USER_AUTOCOMPLETE_LISTBOX_SX = {
  py: 0.45,
  '& .MuiAutocomplete-option': {
    minHeight: 44,
    alignItems: 'stretch',
    py: 0.35,
    px: 0.7,
  },
};
