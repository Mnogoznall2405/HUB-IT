import { useState } from 'react';

import useChatGroupDialog from '../../components/chat/useChatGroupDialog';
import useChatMessageSearch from '../../components/chat/useChatMessageSearch';
import useChatTaskShareDialog from '../../components/chat/useChatTaskShareDialog';
import { loadChatDialogsModule } from './useChatDialogsController';
import { CHAT_SEARCH_DEBOUNCE_MS } from './chatPageConstants';

export default function useChatPageOverlayDialogs({
  isMobile,
  activeConversationId,
  activeConversationIdRef,
  loadConversationsRef,
  notifyApiError,
  notifyInfo,
  openMobileThreadViewRef,
  revealMessageRef,
  setActiveConversationId,
}) {
  const [replyMessage, setReplyMessage] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const {
    addGroupMember,
    closeGroupDialog,
    createGroup,
    creatingConversation,
    groupCreateDisabled,
    groupMemberIds,
    groupOpen,
    groupSearch,
    groupSelectedUsers,
    groupTitle,
    groupUsers,
    groupUsersLoading,
    openGroupDialog,
    patchGroupPresence,
    removeGroupMember,
    setGroupSearch,
    setGroupTitle,
  } = useChatGroupDialog({
    isMobile,
    loadChatDialogsModule,
    loadConversationsRef,
    notifyApiError,
    openMobileThreadViewRef,
    searchDebounceMs: CHAT_SEARCH_DEBOUNCE_MS,
    setActiveConversationId,
  });
  const [openingPeerId, setOpeningPeerId] = useState('');
  const [threadMenuAnchor, setThreadMenuAnchor] = useState(null);
  const [messageMenuAnchor, setMessageMenuAnchor] = useState(null);
  const [messageMenuMessage, setMessageMenuMessage] = useState(null);
  const [composerMenuAnchor, setComposerMenuAnchor] = useState(null);
  const {
    openShareDialog,
    resetShareDialog,
    setSharingTaskId,
    setTaskSearch,
    shareOpen,
    shareableLoading,
    shareableTasks,
    sharingTaskId,
    taskSearch,
  } = useChatTaskShareDialog({
    activeConversationId,
    loadChatDialogsModule,
    notifyApiError,
    searchDebounceMs: CHAT_SEARCH_DEBOUNCE_MS,
    setComposerMenuAnchor,
    setMessageMenuAnchor,
    setMessageMenuMessage,
    setThreadMenuAnchor,
  });
  const [selectedMessageIds, setSelectedMessageIds] = useState([]);
  const [emojiAnchorEl, setEmojiAnchorEl] = useState(null);
  const [messageReadsOpen, setMessageReadsOpen] = useState(false);
  const [messageReadsLoading, setMessageReadsLoading] = useState(false);
  const [messageReadsItems, setMessageReadsItems] = useState([]);
  const [messageReadsMessage, setMessageReadsMessage] = useState(null);
  const {
    closeSearchDialog,
    loadMoreSearchResults,
    messageSearch,
    messageSearchHasMore,
    messageSearchLoading,
    messageSearchResults,
    openSearchDialog,
    openSearchResult,
    resetMessageSearch,
    searchOpen,
    setMessageSearch,
  } = useChatMessageSearch({
    activeConversationId,
    activeConversationIdRef,
    loadChatDialogsModule,
    notifyApiError,
    notifyInfo,
    revealMessageRef,
    searchDebounceMs: CHAT_SEARCH_DEBOUNCE_MS,
    setMessageMenuAnchor,
    setMessageMenuMessage,
    setThreadMenuAnchor,
  });

  return {
    replyMessage,
    setReplyMessage,
    editingMessage,
    setEditingMessage,
    addGroupMember,
    closeGroupDialog,
    createGroup,
    creatingConversation,
    groupCreateDisabled,
    groupMemberIds,
    groupOpen,
    groupSearch,
    groupSelectedUsers,
    groupTitle,
    groupUsers,
    groupUsersLoading,
    openGroupDialog,
    patchGroupPresence,
    removeGroupMember,
    setGroupSearch,
    setGroupTitle,
    openingPeerId,
    setOpeningPeerId,
    threadMenuAnchor,
    setThreadMenuAnchor,
    messageMenuAnchor,
    setMessageMenuAnchor,
    messageMenuMessage,
    setMessageMenuMessage,
    composerMenuAnchor,
    setComposerMenuAnchor,
    openShareDialog,
    resetShareDialog,
    setSharingTaskId,
    setTaskSearch,
    shareOpen,
    shareableLoading,
    shareableTasks,
    sharingTaskId,
    taskSearch,
    selectedMessageIds,
    setSelectedMessageIds,
    emojiAnchorEl,
    setEmojiAnchorEl,
    messageReadsOpen,
    setMessageReadsOpen,
    messageReadsLoading,
    setMessageReadsLoading,
    messageReadsItems,
    setMessageReadsItems,
    messageReadsMessage,
    setMessageReadsMessage,
    closeSearchDialog,
    loadMoreSearchResults,
    messageSearch,
    messageSearchHasMore,
    messageSearchLoading,
    messageSearchResults,
    openSearchDialog,
    openSearchResult,
    resetMessageSearch,
    searchOpen,
    setMessageSearch,
  };
}
