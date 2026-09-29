import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import * as chatApi from '../../api/chatApi';
import type {
  ChatAiBot,
  ChatConversationSummary,
  ChatGlobalMessageSearchHit,
  ChatUserSummary,
} from '../../api/types';
import { formatApiError } from '../../api/formatError';
import { isAiConversation, type ChatWorkspaceKey } from '../../chat/chatAiWorkspace';
import { nextInboxRowSettings } from '../../chat/chatGestures';
import { filterConversationsByLocalQuery } from '../../chat/nativeChatLocalSearch';
import { showNativeToast } from '../../components/nativeToast';

/** Inbox row/sheet actions: search, workspace sheets, AI dialogs, new chat,
 * conversation settings and navigation. Non-blocking errors go to toasts (S7);
 * Alert stays for destructive confirmations. */
export function useInboxActions({
  userId,
  offlineMode,
  mountedRef,
  ownerRef,
  workspace,
  items,
  itemsRef,
  remoteSearchItemsRef,
  setItems,
  setError,
  load,
  loadMore,
  loadFolders,
}: {
  userId: number;
  offlineMode: boolean;
  mountedRef: MutableRefObject<boolean>;
  ownerRef: MutableRefObject<number>;
  workspace: ChatWorkspaceKey;
  items: ChatConversationSummary[];
  itemsRef: MutableRefObject<ChatConversationSummary[]>;
  remoteSearchItemsRef: MutableRefObject<ChatConversationSummary[]>;
  setItems: Dispatch<SetStateAction<ChatConversationSummary[]>>;
  setError: Dispatch<SetStateAction<string>>;
  load: (mode?: 'initial' | 'refresh' | 'silent') => Promise<void>;
  loadMore: () => Promise<void>;
  loadFolders: () => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [searchItems, setSearchItems] = useState<ChatConversationSummary[] | null>(null);
  const [searchMessages, setSearchMessages] = useState<ChatGlobalMessageSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [aiArchiveOpen, setAiArchiveOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [users, setUsers] = useState<ChatUserSummary[]>([]);
  const [bots, setBots] = useState<ChatAiBot[]>([]);
  const [aiActionConversation, setAiActionConversation] = useState<ChatConversationSummary | null>(null);
  const [actionConversation, setActionConversation] = useState<ChatConversationSummary | null>(null);
  const [aiRenameConversation, setAiRenameConversation] = useState<ChatConversationSummary | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const searchRequestRef = useRef(0);

  const mergeSearchResults = useCallback((local: ChatConversationSummary[]) => {
    const byId = new Map<string, ChatConversationSummary>();
    [...local, ...remoteSearchItemsRef.current].forEach((item) => {
      if (item?.id) byId.set(item.id, item);
    });
    return [...byId.values()];
  }, [remoteSearchItemsRef]);

  useEffect(() => {
    const query = search.trim();
    if (!query || workspace === 'ai') {
      remoteSearchItemsRef.current = [];
      searchRequestRef.current += 1;
      setSearchItems(null);
      setSearchMessages([]);
      setSearching(false);
      return undefined;
    }
    const local = filterConversationsByLocalQuery(itemsRef.current, query);
    remoteSearchItemsRef.current = [];
    const requestId = ++searchRequestRef.current;
    // Immediate local filter so offline/saved titles stay findable (OFF-06).
    setSearchItems(local);
    setSearchMessages([]);
    if (offlineMode) {
      setSearching(false);
      return undefined;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      void Promise.all([
        chatApi.getConversationPage({ query, limit: 50 }),
        chatApi.searchMessagesGlobal(query, 20).catch(() => []),
      ]).then(([page, messages]) => {
        if (!mountedRef.current || ownerRef.current !== userId || requestId !== searchRequestRef.current) return;
        const remote = page.items || [];
        remoteSearchItemsRef.current = remote;
        setSearchItems(mergeSearchResults(filterConversationsByLocalQuery(itemsRef.current, query)));
        setSearchMessages(messages);
        setSearching(false);
      }).catch((cause) => {
        if (!mountedRef.current || ownerRef.current !== userId || requestId !== searchRequestRef.current) return;
        setSearching(false);
        // Keep local results; only surface an error when nothing local matched.
        if (!filterConversationsByLocalQuery(itemsRef.current, query).length) {
          setError(formatApiError(cause, 'Не удалось найти диалоги'));
        }
      });
    }, 350);
    return () => {
      clearTimeout(timer);
      if (searchRequestRef.current === requestId) searchRequestRef.current += 1;
    };
  }, [itemsRef, mergeSearchResults, mountedRef, offlineMode, ownerRef, remoteSearchItemsRef, setError, userId, search, workspace]);

  // Realtime inbox updates only refresh local matches. They must not cancel
  // the pending debounce or restart an in-flight remote search.
  useEffect(() => {
    const query = search.trim();
    if (query && workspace !== 'ai') {
      setSearchItems(mergeSearchResults(filterConversationsByLocalQuery(items, query)));
    }
  }, [items, mergeSearchResults, search, workspace]);

  const resetAiContext = useCallback((item: ChatConversationSummary) => {
    Alert.alert(
      'Сбросить контекст?',
      'Старые сообщения останутся видимыми, но помощник перестанет учитывать их в новых ответах.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Сбросить',
          onPress: () => {
            void (async () => {
              setAiBusy(true);
              try {
                await chatApi.resetAiConversationContext(item.id);
                if (mountedRef.current) {
                  showNativeToast('Контекст сброшен', 'Новые ответы не будут учитывать предыдущую историю.');
                }
              } catch (cause) {
                if (mountedRef.current) {
                  showNativeToast('Не удалось сбросить контекст', formatApiError(cause, 'Повторите попытку'));
                }
              } finally {
                if (mountedRef.current) setAiBusy(false);
              }
            })();
          },
        },
      ],
    );
  }, [mountedRef]);

  const deleteAiConversation = useCallback((item: ChatConversationSummary) => {
    Alert.alert(
      'Удалить AI-чат?',
      'Диалог будет удалён без возможности восстановления.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setAiBusy(true);
              try {
                await chatApi.deleteAiConversation(item.id);
                if (!mountedRef.current) return;
                setItems((current) => current.filter((row) => row.id !== item.id));
              } catch (cause) {
                if (mountedRef.current) {
                  showNativeToast('Не удалось удалить чат', formatApiError(cause, 'Повторите попытку'));
                }
              } finally {
                if (mountedRef.current) setAiBusy(false);
              }
            })();
          },
        },
      ],
    );
  }, [mountedRef, setItems]);

  const renameAiConversation = useCallback(async (nextTitle: string) => {
    if (!aiRenameConversation || !nextTitle.trim() || aiBusy) return;
    setAiBusy(true);
    try {
      const updated = await chatApi.renameAiConversation(aiRenameConversation.id, nextTitle.trim());
      if (!mountedRef.current) return;
      setItems((current) => current.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)));
      setAiRenameConversation(null);
    } catch (cause) {
      if (mountedRef.current) {
        showNativeToast('Не удалось переименовать AI-диалог', formatApiError(cause, 'Повторите попытку'));
      }
    } finally {
      if (mountedRef.current) setAiBusy(false);
    }
  }, [aiBusy, aiRenameConversation, mountedRef, setItems]);

  const applyConversationSettings = useCallback(async (
    item: ChatConversationSummary,
    settings: { is_pinned?: boolean; is_muted?: boolean; muted_until?: string | null; is_archived?: boolean },
  ) => {
    setItems((current) => current.map((row) => (
      row.id === item.id ? { ...row, ...settings } : row
    )));
    try {
      const updated = await chatApi.updateConversationSettings(item.id, settings);
      if (!mountedRef.current) return;
      setItems((current) => current.map((row) => (
        row.id === item.id ? { ...row, ...updated } : row
      )));
    } catch (cause) {
      if (mountedRef.current) {
        await load('silent');
        showNativeToast('Не удалось обновить диалог', formatApiError(cause, 'Повторите попытку'));
      }
    }
  }, [load, mountedRef, setItems]);

  const applyRowSwipe = useCallback(async (
    item: ChatConversationSummary,
    action: 'mute' | 'archive' | 'pin',
  ) => {
    const settings = nextInboxRowSettings(item, action);
    if (!settings) return;
    await applyConversationSettings(item, settings);
  }, [applyConversationSettings]);

  const goConversation = useCallback((conversationId: string, messageId?: string) => {
    router.push({
      pathname: '/(shell)/chat/[conversationId]',
      params: messageId ? { conversationId, messageId } : { conversationId },
    });
  }, []);

  const openConversation = useCallback((item: ChatConversationSummary) => {
    goConversation(item.id);
  }, [goConversation]);

  const openConversationActions = useCallback((item: ChatConversationSummary) => {
    if (isAiConversation(item)) setAiActionConversation(item);
    else setActionConversation(item);
  }, []);

  const muteConversation = useCallback((item: ChatConversationSummary) => {
    void applyRowSwipe(item, 'mute');
  }, [applyRowSwipe]);

  const archiveConversation = useCallback((item: ChatConversationSummary) => {
    void applyRowSwipe(item, 'archive');
  }, [applyRowSwipe]);

  const pinConversation = useCallback((item: ChatConversationSummary) => {
    void applyRowSwipe(item, 'pin');
  }, [applyRowSwipe]);

  // F-INBOX-SWIPE: deep right swipe marks the conversation read (the server
  // has no mark-as-unread; unread badge flip is optimistic).
  const toggleReadConversation = useCallback(async (item: ChatConversationSummary) => {
    if (Number(item.unread_count || 0) <= 0) return;
    setItems((current) => current.map((row) => (
      row.id === item.id ? { ...row, unread_count: 0 } : row
    )));
    try {
      await chatApi.markConversationRead(item.id);
      if (!mountedRef.current) return;
    } catch (cause) {
      if (mountedRef.current) {
        await load('silent');
        showNativeToast('Не удалось отметить прочитанным', formatApiError(cause, 'Повторите попытку'));
      }
    }
  }, [load, mountedRef, setItems]);

  const refreshInbox = useCallback(() => {
    void load('refresh');
    void loadFolders();
  }, [load, loadFolders]);

  const handleEndReached = useCallback(() => {
    if (!searchItems) void loadMore();
  }, [loadMore, searchItems]);

  const openNewChat = useCallback(async () => {
    try {
      if (workspace === 'ai') {
        const aiBots = await chatApi.getAiBots();
        setUsers([]);
        setBots(aiBots);
        setNewChatOpen(true);
        return;
      }
      const [chatUsers, aiBots] = await Promise.all([
        chatApi.getChatUsers(),
        chatApi.getAiBots().catch(() => []),
      ]);
      setUsers(chatUsers);
      setBots(aiBots);
      setNewChatOpen(true);
    } catch (cause) {
      showNativeToast(
        workspace === 'ai' ? 'Не удалось открыть AI-чат' : 'Не удалось создать диалог',
        formatApiError(cause, 'Повторите попытку'),
      );
    }
  }, [workspace]);

  const searchNewChatUsers = useCallback((query: string) => (
    chatApi.getChatUsers({ query, limit: 50 })
  ), []);

  return {
    search,
    setSearch,
    searchItems,
    searchMessages,
    searching,
    aiArchiveOpen,
    setAiArchiveOpen,
    newChatOpen,
    setNewChatOpen,
    users,
    bots,
    aiActionConversation,
    setAiActionConversation,
    actionConversation,
    setActionConversation,
    aiRenameConversation,
    setAiRenameConversation,
    aiBusy,
    resetAiContext,
    deleteAiConversation,
    renameAiConversation,
    applyConversationSettings,
    goConversation,
    openConversation,
    openConversationActions,
    muteConversation,
    archiveConversation,
    pinConversation,
    toggleReadConversation,
    refreshInbox,
    handleEndReached,
    openNewChat,
    searchNewChatUsers,
  };
}
