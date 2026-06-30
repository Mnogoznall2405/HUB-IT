import {
  buildFolderUnreadCounts,
  filterSidebarConversationsByFolder,
} from '../../components/chat/chatFolderUtils';

export const isRegularSidebarConversation = (item) => (
  Boolean(item) && String(item?.kind || '').trim() !== 'ai'
);

export const buildConversationFilterCounts = (conversations) => (
  buildFolderUnreadCounts(conversations, [], {})
);

export const filterSidebarConversations = (conversations, conversationFilter, conversationIdsByFolder = {}) => {
  const folderKey = conversationFilter === 'direct' ? 'personal' : String(conversationFilter || 'all');
  return filterSidebarConversationsByFolder(conversations, folderKey, conversationIdsByFolder);
};
