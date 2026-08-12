const MAXIMUM_QUICK_ROUTES = 12;
const MAXIMUM_EXTRA_ROUTES = 5;
const MAXIMUM_LABEL_LENGTH = 48;
const MAXIMUM_BADGE = 9999;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F]/u;
const CONTROL_CHARACTER_REPLACE_PATTERN = /[\u0000-\u001F\u007F-\u009F]/gu;

const directRouteIds = new Map([
  ['/tasks', 'tasks'],
  ['/chat', 'chat'],
  ['/mail', 'mail'],
]);

const isSafeInternalRoute = (route) => (
  typeof route === 'string'
  && route.startsWith('/')
  && !route.startsWith('//')
  && !route.includes('\\')
  && !CONTROL_CHARACTER_PATTERN.test(route)
);

const normalizeBadge = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(MAXIMUM_BADGE, Math.max(0, Math.trunc(numeric)));
};

const normalizeLabel = (value) => (
  String(value || '')
    .replace(CONTROL_CHARACTER_REPLACE_PATTERN, '')
    .trim()
    .slice(0, MAXIMUM_LABEL_LENGTH)
);

const routeId = (path) => (
  String(path || '')
    .replace(/^\/+|\?.*$/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 32)
);

const badgeForPath = (path, unreadCounts) => {
  if (path === '/tasks') {
    return normalizeBadge(unreadCounts?.tasks_open || unreadCounts?.tasks_open_total);
  }
  if (path === '/chat') {
    return normalizeBadge(unreadCounts?.chat_messages_unread_total);
  }
  if (path === '/mail') {
    return normalizeBadge(unreadCounts?.mail_unread);
  }
  return 0;
};

export function buildDesktopQuickRoutes({
  visibleNavigationItems = [],
  pinnedPaths = [],
  showNotifications = false,
  unreadCounts = {},
  canCreateTasks = false,
  canComposeMail = false,
} = {}) {
  const visibleByPath = new Map();
  for (const item of Array.isArray(visibleNavigationItems) ? visibleNavigationItems : []) {
    const path = String(item?.path || '').trim();
    const label = normalizeLabel(item?.label);
    if (!isSafeInternalRoute(path) || !label || visibleByPath.has(path)) continue;
    visibleByPath.set(path, { path, label });
  }

  const result = [];
  const notificationBase = ['/dashboard', '/tasks', '/chat', '/mail']
    .find((path) => visibleByPath.has(path));
  if (showNotifications && notificationBase) {
    result.push({
      id: 'notifications',
      label: 'Уведомления',
      route: `${notificationBase}?desktop_action=notifications`,
      badge: normalizeBadge(unreadCounts?.notifications_unread_total),
    });
  }

  for (const [path, id] of directRouteIds) {
    const item = visibleByPath.get(path);
    if (!item) continue;
    result.push({
      id,
      label: item.label,
      route: item.path,
      badge: badgeForPath(path, unreadCounts),
    });
  }

  if (canCreateTasks && visibleByPath.has('/tasks')) {
    result.push({
      id: 'new-task',
      label: 'Новая задача',
      route: '/tasks?create=1',
      badge: 0,
    });
  }
  if (canComposeMail && visibleByPath.has('/mail')) {
    result.push({
      id: 'new-mail',
      label: 'Новое письмо',
      route: '/mail?compose=new',
      badge: 0,
    });
  }

  const usedPaths = new Set(
    result
      .filter((item) => item.id !== 'notifications')
      .map((item) => item.route.split('?')[0]),
  );
  let extraCount = 0;
  for (const rawPath of Array.isArray(pinnedPaths) ? pinnedPaths : []) {
    if (result.length >= MAXIMUM_QUICK_ROUTES || extraCount >= MAXIMUM_EXTRA_ROUTES) break;
    const path = String(rawPath || '').trim();
    const item = visibleByPath.get(path);
    const id = routeId(path);
    if (!item || !id || usedPaths.has(path)) continue;
    result.push({ id, label: item.label, route: item.path, badge: 0 });
    usedPaths.add(path);
    extraCount += 1;
  }

  return result;
}
