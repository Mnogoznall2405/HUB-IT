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

// U1: AI conversations live in the dedicated «ИИ» workspace — they are not personal.
export const isPersonalConversation = (item) => {
  const kind = String(item?.kind || '').trim();
  return kind === 'direct' || kind === 'notes';
};

export const isAiConversation = (item) => (
  String(item?.kind || '').trim() === 'ai'
);

/** Personal folder list rows (AI bots render in the dedicated AI section). */
export const isPersonalSidebarConversation = (item) => isPersonalConversation(item);

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

/** Mirrors the backend mute rule: muted_until that already expired unmutes. */
export const isConversationEffectivelyMuted = (item, now = Date.now()) => {
  if (!item) return false;
  if (item?.is_muted) {
    const mutedUntil = Date.parse(String(item?.muted_until || ''));
    return Number.isFinite(mutedUntil) ? mutedUntil > now : true;
  }
  return false;
};

export const buildFolderUnreadCounts = (conversations, customFolders = [], conversationIdsByFolder = {}) => {
  const items = (Array.isArray(conversations) ? conversations : [])
    .filter(isRegularSidebarConversation)
    // A3-2: muted conversations stay out of folder badges like on the server.
    .filter((item) => !isConversationEffectivelyMuted(item));
  const activeItems = items.filter((item) => !item?.is_archived);
  const sumUnread = (list) => list.reduce((total, item) => total + Number(item?.unread_count || 0), 0);

  const counts = {
    all: sumUnread(activeItems),
    personal: sumUnread(activeItems.filter(isPersonalConversation)),
    groups: sumUnread(activeItems.filter(isGroupConversation)),
    tasks: sumUnread(activeItems.filter(isTaskConversation)),
    archived: sumUnread(items.filter((item) => Boolean(item?.is_archived))),
    ai: sumUnread(
      (Array.isArray(conversations) ? conversations : [])
        .filter((item) => !item?.is_archived)
        .filter((item) => !isConversationEffectivelyMuted(item))
        .filter(isAiConversation),
    ),
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

/** Folder keys a conversation contributes unread to (mirrors backend folder_unread rules). */
export const resolveConversationFolderKeys = (item, conversationIdsByFolder = {}) => {
  if (!item) return [];
  if (item?.is_archived) return ['archived'];
  const keys = [];
  if (isAiConversation(item)) keys.push('ai');
  if (isPersonalConversation(item)) keys.push('personal');
  if (isGroupConversation(item)) keys.push('groups');
  if (isTaskConversation(item)) keys.push('tasks');
  const conversationId = String(item?.id || '').trim();
  if (conversationId) {
    Object.entries(conversationIdsByFolder || {}).forEach(([folderId, ids]) => {
      if (Array.isArray(ids) && ids.includes(conversationId)) keys.push(folderId);
    });
  }
  return keys;
};

/**
 * U2: server `folder_unread_counts` are the badge source of truth. Loaded rows
 * only apply an optimistic delta versus the unread snapshot taken when those
 * server counts arrived (read a conversation locally → subtract it) — the
 * server total itself is never replaced by the loaded-rows sum.
 */
export const mergeServerFolderUnreadCounts = ({
  serverCounts,
  localCounts = {},
  conversations = [],
  baselineUnreadById,
  conversationIdsByFolder = {},
} = {}) => {
  const merged = { ...localCounts };
  const server = serverCounts && typeof serverCounts === 'object' ? serverCounts : null;
  if (!server) return merged;
  const deltas = {};
  if (baselineUnreadById instanceof Map) {
    (Array.isArray(conversations) ? conversations : []).forEach((item) => {
      const conversationId = String(item?.id || '').trim();
      if (!conversationId || !baselineUnreadById.has(conversationId)) return;
      const delta = Number(item?.unread_count || 0)
        - Math.max(0, Number(baselineUnreadById.get(conversationId) || 0));
      if (!delta) return;
      resolveConversationFolderKeys(item, conversationIdsByFolder).forEach((key) => {
        deltas[key] = (deltas[key] || 0) + delta;
      });
    });
  }
  Object.entries(server).forEach(([key, value]) => {
    merged[key] = Math.max(0, (Number(value) || 0) + (deltas[key] || 0));
  });
  return merged;
};

export const getConversationFolderIds = (conversationId, conversationIdsByFolder = {}) => (
  Object.entries(conversationIdsByFolder || {})
    .filter(([, ids]) => (Array.isArray(ids) ? ids : []).includes(String(conversationId || '').trim()))
    .map(([folderId]) => folderId)
);
