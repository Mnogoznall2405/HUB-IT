import * as chatFeatureFlags from './chatFeature';

export const TASK_DETAIL_TABS = ['comments', 'files', 'history'];

function defaultTaskDiscussionEnabled() {
  return Boolean(chatFeatureFlags.TASK_DISCUSSION_CHAT_ENABLED);
}

export function getDefaultTaskDetailTab(taskDiscussionEnabled = defaultTaskDiscussionEnabled()) {
  return taskDiscussionEnabled ? 'files' : 'comments';
}

export function normalizeTaskDetailTab(
  value,
  taskDiscussionEnabled = defaultTaskDiscussionEnabled(),
) {
  const normalized = String(value || '').trim().toLowerCase();
  if (TASK_DETAIL_TABS.includes(normalized)) return normalized;
  return getDefaultTaskDetailTab(taskDiscussionEnabled);
}

export function buildTaskDetailPath(
  taskId,
  {
    tab,
    taskDiscussionEnabled = defaultTaskDiscussionEnabled(),
  } = {},
) {
  const normalizedId = String(taskId || '').trim();
  if (!normalizedId) return '/tasks';

  const params = new URLSearchParams();
  params.set('task', normalizedId);

  const explicitTab = tab != null && String(tab).trim() !== '';
  if (explicitTab) {
    params.set('task_tab', normalizeTaskDetailTab(tab, taskDiscussionEnabled));
  } else if (!taskDiscussionEnabled) {
    params.set('task_tab', getDefaultTaskDetailTab(false));
  }

  const query = params.toString();
  return `/tasks${query ? `?${query}` : ''}`;
}

export function getTaskNotificationPath(
  item,
  { taskDiscussionEnabled = defaultTaskDiscussionEnabled() } = {},
) {
  const entityType = String(item?.entity_type || '').trim().toLowerCase();
  const entityId = String(item?.entity_id || '').trim();
  if (entityType !== 'task' || !entityId) return '/dashboard';

  const eventType = String(item?.event_type || '').trim().toLowerCase();
  if (taskDiscussionEnabled) {
    if (eventType === 'task.comment_added') {
      return buildTaskDetailPath(entityId, { tab: 'comments', taskDiscussionEnabled: true });
    }
    return buildTaskDetailPath(entityId, { taskDiscussionEnabled: true });
  }
  return buildTaskDetailPath(entityId, { tab: 'comments', taskDiscussionEnabled: false });
}

export function getTaskCommentsTabLabel({
  taskDiscussionEnabled = defaultTaskDiscussionEnabled(),
  count = 0,
} = {}) {
  const normalizedCount = Number(count) || 0;
  if (taskDiscussionEnabled) {
    return normalizedCount > 0 ? `Архив (${normalizedCount})` : 'Архив';
  }
  return normalizedCount > 0 ? `Комментарии (${normalizedCount})` : 'Комментарии';
}

export function getTaskUnreadFilterLabel(taskDiscussionEnabled = defaultTaskDiscussionEnabled()) {
  return taskDiscussionEnabled ? 'Новое в архиве' : 'Есть новые комментарии';
}

export function getTaskUnreadFocusLabel(taskDiscussionEnabled = defaultTaskDiscussionEnabled()) {
  return taskDiscussionEnabled ? 'С новым в архиве' : 'С новыми комментариями';
}

export function getTaskUnreadBoardLabel(taskDiscussionEnabled = defaultTaskDiscussionEnabled()) {
  return taskDiscussionEnabled ? 'Архив' : 'Комментарии';
}

export function getTaskUnreadBadgeLabel(taskDiscussionEnabled = defaultTaskDiscussionEnabled()) {
  return taskDiscussionEnabled ? 'Новое в архиве' : 'Новый комментарий';
}
