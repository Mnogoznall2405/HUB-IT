export const CHAT_ACTIVE_FOLDER_STORAGE_KEY = 'hub.chat.activeFolder';

export const DEFAULT_CHAT_FOLDER_KEY = 'personal';

export const SYSTEM_CHAT_FOLDERS = [
  { key: 'personal', label: 'Личные' },
  { key: 'groups', label: 'Беседы' },
  { key: 'tasks', label: 'Задачи' },
];

/** @deprecated «Все» больше не показывается; оставлено для совместимости старых вызовов. */
export const ALL_CHAT_FOLDER_TAB = { key: 'all', label: 'Все' };

/** Telegram-style order: system tabs → custom folders. */
export const buildChatFolderTabList = (customFolders = [], options = {}) => {
  const { includeAllTab = false } = options;
  const custom = (Array.isArray(customFolders) ? customFolders : [])
    .map((folder) => ({
      key: String(folder?.id || '').trim(),
      label: String(folder?.name || 'Папка').trim() || 'Папка',
    }))
    .filter((item) => item.key);

  const tabs = [...SYSTEM_CHAT_FOLDERS, ...custom];
  if (includeAllTab) tabs.push(ALL_CHAT_FOLDER_TAB);
  return tabs.filter((item) => item.key);
};

/** Swipe/tab navigation order (excludes archive). */
export const getChatFolderNavigationList = (customFolders = [], options = {}) => (
  buildChatFolderTabList(customFolders, options)
);

export const resolveAdjacentFolderKey = ({ tabs, activeKey, direction }) => {
  const normalizedDirection = String(direction || '').trim().toLowerCase();
  if (normalizedDirection !== 'prev' && normalizedDirection !== 'next') return null;

  const navigationTabs = (Array.isArray(tabs) ? tabs : [])
    .map((item) => String(item?.key || '').trim())
    .filter(Boolean);
  if (!navigationTabs.length) return null;

  const normalizedActiveKey = String(activeKey || DEFAULT_CHAT_FOLDER_KEY).trim() || DEFAULT_CHAT_FOLDER_KEY;
  const currentIndex = navigationTabs.indexOf(normalizedActiveKey);
  const resolvedIndex = currentIndex >= 0
    ? currentIndex
    : navigationTabs.indexOf(DEFAULT_CHAT_FOLDER_KEY);

  if (resolvedIndex < 0) return null;

  const nextIndex = normalizedDirection === 'next'
    ? resolvedIndex + 1
    : resolvedIndex - 1;

  if (nextIndex < 0 || nextIndex >= navigationTabs.length) return null;
  return navigationTabs[nextIndex];
};

export const resolveFolderSwipeTarget = (activeKey, direction, customFolders = [], options = {}) => {
  const { includeAllTab = false } = options;
  const normalizedActiveKey = String(activeKey || DEFAULT_CHAT_FOLDER_KEY).trim() || DEFAULT_CHAT_FOLDER_KEY;
  if (normalizedActiveKey === 'archived') {
    return includeAllTab ? 'all' : DEFAULT_CHAT_FOLDER_KEY;
  }

  const tabs = getChatFolderNavigationList(customFolders, { includeAllTab });
  return resolveAdjacentFolderKey({
    tabs,
    activeKey: normalizedActiveKey,
    direction,
  });
};

export const isRegularSidebarConversation = (item) => (
  Boolean(item) && String(item?.kind || '').trim() !== 'ai'
);

export const isTaskConversation = (item) => (
  String(item?.kind || '').trim() === 'task' || Boolean(item?.task_id)
);

export const isPersonalConversation = (item) => {
  const kind = String(item?.kind || '').trim();
  return kind === 'direct' || kind === 'notes' || kind === 'ai';
};

/** Personal folder list rows (AI bots render in the dedicated AI section). */
export const isPersonalSidebarConversation = (item) => {
  const kind = String(item?.kind || '').trim();
  return kind === 'direct' || kind === 'notes';
};

export const isGroupConversation = (item) => (
  String(item?.kind || '').trim() === 'group'
);

export const shouldShowAiChatSection = (activeFolderKey) => (
  ['all', 'personal'].includes(String(activeFolderKey || DEFAULT_CHAT_FOLDER_KEY).trim())
);

const normalizeStoredFolderKey = (value) => {
  const normalized = String(value || DEFAULT_CHAT_FOLDER_KEY).trim() || DEFAULT_CHAT_FOLDER_KEY;
  // Legacy «Все» tab removed — map to personal.
  if (normalized === 'all') return DEFAULT_CHAT_FOLDER_KEY;
  return normalized;
};

export const readStoredActiveFolderKey = () => {
  if (typeof window === 'undefined' || !window.localStorage) return DEFAULT_CHAT_FOLDER_KEY;
  try {
    return normalizeStoredFolderKey(window.localStorage.getItem(CHAT_ACTIVE_FOLDER_STORAGE_KEY));
  } catch {
    return DEFAULT_CHAT_FOLDER_KEY;
  }
};

export const writeStoredActiveFolderKey = (value) => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const normalized = normalizeStoredFolderKey(value);
  try {
    window.localStorage.setItem(CHAT_ACTIVE_FOLDER_STORAGE_KEY, normalized);
  } catch {
    // ignore storage errors
  }
};

export const buildConversationIdsByFolder = (customFolders = [], serverMap = {}) => {
  const result = {};
  (Array.isArray(customFolders) ? customFolders : []).forEach((folder) => {
    const folderId = String(folder?.id || '').trim();
    if (!folderId) return;
    const fromServer = Array.isArray(serverMap?.[folderId]) ? serverMap[folderId] : [];
    const fromFolder = Array.isArray(folder?.conversation_ids) ? folder.conversation_ids : [];
    result[folderId] = Array.from(new Set([...fromServer, ...fromFolder].map((item) => String(item || '').trim()).filter(Boolean)));
  });
  return result;
};

export const filterSidebarConversationsByFolder = (
  conversations,
  activeFolderKey,
  conversationIdsByFolder = {},
) => {
  const items = (Array.isArray(conversations) ? conversations : []).filter(isRegularSidebarConversation);
  const folderKey = normalizeStoredFolderKey(activeFolderKey);

  if (folderKey === 'archived') {
    return items.filter((item) => Boolean(item?.is_archived));
  }

  const activeItems = items.filter((item) => !item?.is_archived);

  if (folderKey === 'personal') {
    return (Array.isArray(conversations) ? conversations : [])
      .filter((item) => !item?.is_archived)
      .filter(isPersonalSidebarConversation);
  }
  if (folderKey === 'groups') return activeItems.filter(isGroupConversation);
  if (folderKey === 'tasks') return activeItems.filter(isTaskConversation);

  const allowedIds = new Set(
    (Array.isArray(conversationIdsByFolder?.[folderKey]) ? conversationIdsByFolder[folderKey] : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean),
  );
  return activeItems.filter((item) => allowedIds.has(String(item?.id || '').trim()));
};

export const buildFolderUnreadCounts = (conversations, customFolders = [], conversationIdsByFolder = {}) => {
  const items = (Array.isArray(conversations) ? conversations : []).filter(isRegularSidebarConversation);
  const activeItems = items.filter((item) => !item?.is_archived);
  const sumUnread = (list) => list.reduce((total, item) => total + Number(item?.unread_count || 0), 0);

  const counts = {
    all: sumUnread(activeItems),
    personal: sumUnread(
      (Array.isArray(conversations) ? conversations : [])
        .filter((item) => !item?.is_archived)
        .filter(isPersonalConversation),
    ),
    groups: sumUnread(activeItems.filter(isGroupConversation)),
    tasks: sumUnread(activeItems.filter(isTaskConversation)),
    archived: sumUnread(items.filter((item) => Boolean(item?.is_archived))),
  };

  (Array.isArray(customFolders) ? customFolders : []).forEach((folder) => {
    const folderId = String(folder?.id || '').trim();
    if (!folderId) return;
    const allowedIds = new Set(
      (Array.isArray(conversationIdsByFolder?.[folderId]) ? conversationIdsByFolder[folderId] : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    );
    counts[folderId] = sumUnread(activeItems.filter((item) => allowedIds.has(String(item?.id || '').trim())));
  });

  return counts;
};

export const getConversationFolderIds = (conversationId, conversationIdsByFolder = {}) => (
  Object.entries(conversationIdsByFolder || {})
    .filter(([, ids]) => (Array.isArray(ids) ? ids : []).includes(String(conversationId || '').trim()))
    .map(([folderId]) => folderId)
);
