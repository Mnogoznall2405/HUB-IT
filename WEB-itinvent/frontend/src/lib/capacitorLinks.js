const DEFAULT_ALLOWED_HOST = 'hubit.zsgp.ru';

const TOP_LEVEL_ROUTES = new Set([
  'address-book',
  'ad-users',
  'chat',
  'computers',
  'dashboard',
  'database',
  'kb',
  'login',
  'mail',
  'mfu',
  'networks',
  'scan-center',
  'settings',
  'statistics',
  'tasks',
  'tickets',
  'vcs',
]);

const isPlainObject = (value) => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const cleanPart = (value) => String(value || '').trim().replace(/^\/+|\/+$/g, '');

const buildPath = (path, search = '', hash = '') => {
  const normalizedPath = String(path || '').startsWith('/') ? String(path || '') : `/${path || ''}`;
  const normalizedSearch = search ? (String(search).startsWith('?') ? String(search) : `?${search}`) : '';
  const normalizedHash = hash ? (String(hash).startsWith('#') ? String(hash) : `#${hash}`) : '';
  return `${normalizedPath || '/'}${normalizedSearch}${normalizedHash}`;
};

const isAllowedAppPath = (path) => {
  const normalizedPath = String(path || '').trim();
  if (!normalizedPath || normalizedPath === '/') {
    return true;
  }
  const firstSegment = cleanPart(normalizedPath.split(/[?#]/, 1)[0]).split('/')[0];
  return TOP_LEVEL_ROUTES.has(firstSegment);
};

const withParam = (basePath, paramName, value, existingSearch = '') => {
  const params = new URLSearchParams(String(existingSearch || '').replace(/^\?/, ''));
  const normalizedValue = String(value || '').trim();
  if (normalizedValue) {
    params.set(paramName, normalizedValue);
  }
  const query = params.toString();
  return `${basePath}${query ? `?${query}` : ''}`;
};

const normalizeHubitSchemeUrl = (url) => {
  const host = cleanPart(url.hostname);
  const pathSegments = cleanPart(url.pathname)
    .split('/')
    .map(cleanPart)
    .filter(Boolean);
  const segments = [host, ...pathSegments].filter(Boolean);
  const section = cleanPart(segments[0]).toLowerCase();
  const id = cleanPart(segments[1]);

  if (!section) {
    return buildPath('/', url.search, url.hash);
  }

  if (section === 'task' || section === 'tasks') {
    return id ? withParam('/tasks', 'task', id, url.search) : buildPath('/tasks', url.search, url.hash);
  }

  if (section === 'ticket' || section === 'tickets') {
    return id ? withParam('/tickets', 'request', id, url.search) : buildPath('/tickets', url.search, url.hash);
  }

  if (section === 'chat') {
    return id ? withParam('/chat', 'conversation', id, url.search) : buildPath('/chat', url.search, url.hash);
  }

  if (section === 'mail') {
    return id ? withParam('/mail', 'message_id', id, url.search) : buildPath('/mail', url.search, url.hash);
  }

  if (section === 'network' || section === 'networks') {
    return id ? buildPath(`/networks/${encodeURIComponent(id)}`, url.search, url.hash) : buildPath('/networks', url.search, url.hash);
  }

  if (!TOP_LEVEL_ROUTES.has(section)) {
    return null;
  }

  const tail = segments.slice(1).map(encodeURIComponent).join('/');
  return buildPath(`/${section}${tail ? `/${tail}` : ''}`, url.search, url.hash);
};

export const normalizeCapacitorAppUrl = (rawUrl, {
  allowedHost = DEFAULT_ALLOWED_HOST,
  currentOrigin,
} = {}) => {
  const input = String(rawUrl || '').trim();
  if (!input) {
    return null;
  }

  if (input.startsWith('/')) {
    const hashIndex = input.indexOf('#');
    const queryIndex = input.indexOf('?');
    const endIndexCandidates = [hashIndex, queryIndex].filter((index) => index >= 0);
    const pathEnd = endIndexCandidates.length > 0 ? Math.min(...endIndexCandidates) : input.length;
    const pathname = input.slice(0, pathEnd) || '/';
    return isAllowedAppPath(pathname) ? input : null;
  }

  let url;
  try {
    url = new URL(input, currentOrigin || `https://${allowedHost}`);
  } catch {
    return null;
  }

  const protocol = String(url.protocol || '').toLowerCase();
  if (protocol === 'hubit:') {
    return normalizeHubitSchemeUrl(url);
  }

  if (protocol !== 'https:' && protocol !== 'http:') {
    return null;
  }

  const allowedHosts = new Set([
    cleanPart(allowedHost).toLowerCase(),
    cleanPart(currentOrigin ? new URL(currentOrigin).hostname : '').toLowerCase(),
  ].filter(Boolean));
  if (!allowedHosts.has(cleanPart(url.hostname).toLowerCase())) {
    return null;
  }

  const path = buildPath(url.pathname || '/', url.search, url.hash);
  return isAllowedAppPath(url.pathname || '/') ? path : null;
};

export const normalizePushNotificationRoute = (notification, options = {}) => {
  const rawNotification = isPlainObject(notification?.notification)
    ? notification.notification
    : notification;
  const data = isPlainObject(rawNotification?.data) ? rawNotification.data : {};

  const directRoute = (
    data.route
    || data.deep_link
    || data.deepLink
    || data.url
    || rawNotification?.route
    || rawNotification?.deepLink
    || rawNotification?.url
    || ''
  );

  const normalizedDirectRoute = normalizeCapacitorAppUrl(directRoute, options);
  if (normalizedDirectRoute) {
    return normalizedDirectRoute;
  }

  const conversationId = String(data.conversation_id || data.conversationId || '').trim();
  const messageId = String(data.message_id || data.messageId || '').trim();
  if (conversationId) {
    const params = new URLSearchParams({ conversation: conversationId });
    if (messageId) {
      params.set('message', messageId);
    }
    return `/chat?${params.toString()}`;
  }

  const taskId = String(data.task_id || data.taskId || '').trim();
  if (taskId) {
    return `/tasks?task=${encodeURIComponent(taskId)}`;
  }

  const mailMessageId = String(data.mail_message_id || data.message_id || '').trim();
  if (String(data.channel || '').trim().toLowerCase() === 'mail' && mailMessageId) {
    return `/mail?message_id=${encodeURIComponent(mailMessageId)}`;
  }

  return null;
};
