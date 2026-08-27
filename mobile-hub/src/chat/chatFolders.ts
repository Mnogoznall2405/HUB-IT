import type { ChatConversationSummary } from '../api/types';

export const DEFAULT_CHAT_FOLDER_KEY = 'personal';
export const UNREAD_CHAT_FOLDER_KEY = 'unread';
export const ARCHIVED_CHAT_FOLDER_KEY = 'archived';

export const SYSTEM_CHAT_FOLDERS = [
  { key: 'personal', label: 'Личные' },
  { key: UNREAD_CHAT_FOLDER_KEY, label: 'Непрочитанные' },
  { key: 'groups', label: 'Беседы' },
  { key: 'tasks', label: 'Задачи' },
] as const;

export const ARCHIVED_CHAT_FOLDER_TAB = { key: ARCHIVED_CHAT_FOLDER_KEY, label: 'Архив' };

export type ChatFolderTab = { key: string; label: string };

export type ChatCustomFolder = {
  id: string;
  name: string;
  sort_order?: number;
  conversation_count?: number;
  unread_count?: number;
  conversation_ids?: string[];
};

export function normalizeFolderKey(value?: string | null): string {
  const normalized = String(value || DEFAULT_CHAT_FOLDER_KEY).trim() || DEFAULT_CHAT_FOLDER_KEY;
  return normalized === 'all' ? DEFAULT_CHAT_FOLDER_KEY : normalized;
}

export function buildChatFolderTabList(
  customFolders: ChatCustomFolder[] = [],
  options: { includeArchivedTab?: boolean } = {},
): ChatFolderTab[] {
  const custom = (Array.isArray(customFolders) ? customFolders : [])
    .map((folder) => ({
      key: String(folder?.id || '').trim(),
      label: String(folder?.name || 'Папка').trim() || 'Папка',
    }))
    .filter((item) => item.key);
  const tabs = [...SYSTEM_CHAT_FOLDERS, ...custom];
  if (options.includeArchivedTab !== false) tabs.push(ARCHIVED_CHAT_FOLDER_TAB);
  return tabs.filter((item) => item.key);
}

export function getChatFolderNavigationList(customFolders: ChatCustomFolder[] = []): ChatFolderTab[] {
  return buildChatFolderTabList(customFolders, { includeArchivedTab: false });
}

export function resolveAdjacentFolderKey({
  tabs,
  activeKey,
  direction,
}: {
  tabs: ChatFolderTab[];
  activeKey?: string | null;
  direction: 'prev' | 'next';
}): string | null {
  if (direction !== 'prev' && direction !== 'next') return null;
  const keys = (Array.isArray(tabs) ? tabs : []).map((item) => String(item?.key || '').trim()).filter(Boolean);
  if (!keys.length) return null;
  const normalizedActiveKey = normalizeFolderKey(activeKey);
  const currentIndex = keys.indexOf(normalizedActiveKey);
  const resolvedIndex = currentIndex >= 0 ? currentIndex : keys.indexOf(DEFAULT_CHAT_FOLDER_KEY);
  if (resolvedIndex < 0) return null;
  const nextIndex = direction === 'next' ? resolvedIndex + 1 : resolvedIndex - 1;
  if (nextIndex < 0 || nextIndex >= keys.length) return null;
  return keys[nextIndex];
}

export function resolveFolderSwipeTarget(
  activeKey: string | undefined,
  direction: 'prev' | 'next',
  customFolders: ChatCustomFolder[] = [],
): string | null {
  const normalizedActiveKey = normalizeFolderKey(activeKey);
  if (normalizedActiveKey === ARCHIVED_CHAT_FOLDER_KEY) {
    return direction === 'prev' ? DEFAULT_CHAT_FOLDER_KEY : null;
  }
  return resolveAdjacentFolderKey({
    tabs: getChatFolderNavigationList(customFolders),
    activeKey: normalizedActiveKey,
    direction,
  });
}

export function isRegularSidebarConversation(item?: ChatConversationSummary | null): boolean {
  return Boolean(item) && String(item?.kind || '').trim() !== 'ai';
}

export function isTaskConversation(item?: ChatConversationSummary | null): boolean {
  return String(item?.kind || '').trim() === 'task' || Boolean((item as { task_id?: string } | null)?.task_id);
}

export function isPersonalSidebarConversation(item?: ChatConversationSummary | null): boolean {
  const kind = String(item?.kind || '').trim();
  return kind === 'direct' || kind === 'notes';
}

export function isGroupConversation(item?: ChatConversationSummary | null): boolean {
  return String(item?.kind || '').trim() === 'group';
}

export function buildConversationIdsByFolder(
  customFolders: ChatCustomFolder[] = [],
  serverMap: Record<string, string[]> = {},
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  (Array.isArray(customFolders) ? customFolders : []).forEach((folder) => {
    const folderId = String(folder?.id || '').trim();
    if (!folderId) return;
    const fromServer = Array.isArray(serverMap?.[folderId]) ? serverMap[folderId] : [];
    const fromFolder = Array.isArray(folder?.conversation_ids) ? folder.conversation_ids : [];
    result[folderId] = Array.from(new Set(
      [...fromServer, ...fromFolder].map((item) => String(item || '').trim()).filter(Boolean),
    ));
  });
  return result;
}

export function filterConversationsByFolder(
  conversations: ChatConversationSummary[],
  activeFolderKey: string,
  conversationIdsByFolder: Record<string, string[]> = {},
): ChatConversationSummary[] {
  const items = (Array.isArray(conversations) ? conversations : []).filter(isRegularSidebarConversation);
  const folderKey = normalizeFolderKey(activeFolderKey);

  if (folderKey === ARCHIVED_CHAT_FOLDER_KEY) {
    return items.filter((item) => Boolean(item?.is_archived));
  }

  const activeItems = items.filter((item) => !item?.is_archived);
  if (folderKey === UNREAD_CHAT_FOLDER_KEY) {
    return activeItems.filter((item) => Number(item?.unread_count || 0) > 0);
  }
  if (folderKey === 'personal') return activeItems.filter(isPersonalSidebarConversation);
  if (folderKey === 'groups') return activeItems.filter(isGroupConversation);
  if (folderKey === 'tasks') return activeItems.filter(isTaskConversation);

  const allowedIds = new Set(
    (Array.isArray(conversationIdsByFolder?.[folderKey]) ? conversationIdsByFolder[folderKey] : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean),
  );
  return activeItems.filter((item) => allowedIds.has(String(item?.id || '').trim()));
}

function takeServerUnreadCount(
  serverSystemCounts: Record<string, number> | null | undefined,
  key: string,
): number | null {
  if (!serverSystemCounts || !Object.prototype.hasOwnProperty.call(serverSystemCounts, key)) return null;
  const value = Number(serverSystemCounts[key]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function buildFolderUnreadCounts(
  conversations: ChatConversationSummary[],
  customFolders: ChatCustomFolder[] = [],
  conversationIdsByFolder: Record<string, string[]> = {},
  serverSystemCounts: Record<string, number> | null = null,
): Record<string, number> {
  const items = (Array.isArray(conversations) ? conversations : []).filter(isRegularSidebarConversation);
  const activeItems = items.filter((item) => !item?.is_archived);
  const sumUnread = (list: ChatConversationSummary[]) => (
    list.reduce((total, item) => total + Number(item?.unread_count || 0), 0)
  );
  const counts: Record<string, number> = {
    personal: takeServerUnreadCount(serverSystemCounts, 'personal')
      ?? sumUnread(activeItems.filter(isPersonalSidebarConversation)),
    unread: takeServerUnreadCount(serverSystemCounts, UNREAD_CHAT_FOLDER_KEY)
      ?? sumUnread(activeItems),
    groups: takeServerUnreadCount(serverSystemCounts, 'groups')
      ?? sumUnread(activeItems.filter(isGroupConversation)),
    tasks: takeServerUnreadCount(serverSystemCounts, 'tasks')
      ?? sumUnread(activeItems.filter(isTaskConversation)),
    archived: takeServerUnreadCount(serverSystemCounts, 'archived')
      ?? sumUnread(items.filter((item) => Boolean(item?.is_archived))),
  };

  (Array.isArray(customFolders) ? customFolders : []).forEach((folder) => {
    const folderId = String(folder?.id || '').trim();
    if (!folderId) return;
    const serverUnread = Number(folder.unread_count);
    if (Number.isFinite(serverUnread) && serverUnread >= 0) {
      counts[folderId] = serverUnread;
      return;
    }
    const allowedIds = new Set(
      (Array.isArray(conversationIdsByFolder?.[folderId]) ? conversationIdsByFolder[folderId] : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    );
    counts[folderId] = sumUnread(activeItems.filter((item) => allowedIds.has(String(item?.id || '').trim())));
  });

  return counts;
}

export function formatFolderUnreadBadge(count: number): string {
  const value = Math.max(0, Number(count) || 0);
  if (value <= 0) return '';
  return value > 99 ? '99+' : String(value);
}

export function conversationKindLabel(kind?: string | null): string {
  switch (String(kind || '').trim()) {
    case 'notes':
      return 'Заметки';
    case 'task':
      return 'Задача';
    case 'ai':
      return 'AI';
    case 'support':
      return 'Поддержка';
    case 'group':
      return 'Беседа';
    case 'direct':
      return 'Личный';
    default:
      return '';
  }
}

export function shouldShowConversationKindChip(kind?: string | null): boolean {
  const value = String(kind || '').trim();
  return value === 'notes' || value === 'task' || value === 'ai' || value === 'support';
}

export function isConversationInFolder(
  conversationId: string,
  folderId: string,
  conversationIdsByFolder: Record<string, string[]> = {},
): boolean {
  const id = String(conversationId || '').trim();
  const folder = String(folderId || '').trim();
  if (!id || !folder) return false;
  return (Array.isArray(conversationIdsByFolder[folder]) ? conversationIdsByFolder[folder] : [])
    .map((item) => String(item || '').trim())
    .includes(id);
}

export function toggleConversationIdInFolderMap(
  conversationIdsByFolder: Record<string, string[]>,
  folderId: string,
  conversationId: string,
  included: boolean,
): Record<string, string[]> {
  const folder = String(folderId || '').trim();
  const id = String(conversationId || '').trim();
  if (!folder || !id) return conversationIdsByFolder;
  const current = (Array.isArray(conversationIdsByFolder[folder]) ? conversationIdsByFolder[folder] : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  const next = included
    ? Array.from(new Set([...current, id]))
    : current.filter((item) => item !== id);
  return { ...conversationIdsByFolder, [folder]: next };
}
