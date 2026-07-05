export const CHAT_ACTIVE_FOLDER_STORAGE_KEY = 'hub.chat.activeFolder';

export const SYSTEM_CHAT_FOLDERS = [
  { key: 'personal', label: 'Личные' },
  { key: 'tasks', label: 'Задачи' },
];

export const ALL_CHAT_FOLDER_TAB = { key: 'all', label: 'Все' };

/** Telegram-style order: system tabs → custom folders → «Все» at the end (optional). */
export const buildChatFolderTabList = (customFolders = [], options = {}) => {
  const { includeAllTab = true } = options;
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

  const normalizedActiveKey = String(activeKey || 'all').trim() || 'all';
  const currentIndex = navigationTabs.indexOf(normalizedActiveKey);
  const resolvedIndex = currentIndex >= 0
    ? currentIndex
    : navigationTabs.indexOf('all');

  if (resolvedIndex < 0) return null;

  const nextIndex = normalizedDirection === 'next'
    ? resolvedIndex + 1
    : resolvedIndex - 1;

  if (nextIndex < 0 || nextIndex >= navigationTabs.length) return null;
  return navigationTabs[nextIndex];
};

export const resolveFolderSwipeTarget = (activeKey, direction, customFolders = [], options = {}) => {
  const { includeAllTab = true } = options;
  const normalizedActiveKey = String(activeKey || 'all').trim() || 'all';
  if (normalizedActiveKey === 'archived') {
    return includeAllTab ? 'all' : 'personal';
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

export const shouldShowAiChatSection = (activeFolderKey) => (
  ['all', 'personal'].includes(String(activeFolderKey || 'all').trim())
);

export const readStoredActiveFolderKey = () => {
  if (typeof window === 'undefined' || !window.localStorage) return 'all';
  try {
    return String(window.localStorage.getItem(CHAT_ACTIVE_FOLDER_STORAGE_KEY) || 'all').trim() || 'all';
  } catch {
    return 'all';
  }
};

export const writeStoredActiveFolderKey = (value) => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const normalized = String(value || 'all').trim() || 'all';
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
  const folderKey = String(activeFolderKey || 'all').trim() || 'all';

  if (folderKey === 'archived') {
    return items.filter((item) => Boolean(item?.is_archived));
  }

  const activeItems = items.filter((item) => !item?.is_archived);

  if (folderKey === 'all') return activeItems;
  if (folderKey === 'personal') {
    return (Array.isArray(conversations) ? conversations : [])
      .filter((item) => !item?.is_archived)
      .filter(isPersonalSidebarConversation);
  }
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
