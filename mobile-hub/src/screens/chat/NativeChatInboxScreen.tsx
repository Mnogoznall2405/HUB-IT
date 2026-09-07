import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { ListRenderItemInfo } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconButton } from 'react-native-paper';
import * as chatApi from '../../api/chatApi';
import { formatApiError } from '../../api/formatError';
import type {
  ChatConversationSummary,
  ChatFolderListResponse,
  ChatGlobalMessageSearchHit,
  ChatUserSummary,
} from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { readNativeSnapshot, writeNativeSnapshot } from '../../cache/nativeSnapshotCache';
import {
  readNativeChatInboxSnapshot,
  writeNativeChatInboxSnapshot,
} from '../../chat/nativeChatInboxSnapshot';
import { getActiveChatFolderKey, setActiveChatFolderKey } from '../../chat/chatActiveFolder';
import {
  getActiveNativeChatConversationId,
  subscribeNativeChatConversationRead,
} from '../../chat/chatActiveConversation';
import { chatKeyboardAvoidingProps } from '../../chat/chatKeyboard';
import {
  DEFAULT_CHAT_FOLDER_KEY,
  buildConversationIdsByFolder,
  buildFolderUnreadCounts,
  filterConversationsByFolder,
  resolveFolderSwipeTarget,
  toggleConversationIdInFolderMap,
  type ChatCustomFolder,
} from '../../chat/chatFolders';
import {
  countAiUnread,
  filterAiConversations,
  groupAiSidebarRowsByDate,
  isAiConversation,
  type ChatWorkspaceKey,
} from '../../chat/chatAiWorkspace';
import { filterConversationsByLocalQuery } from '../../chat/nativeChatLocalSearch';
import { ChatRenameSheet } from '../../components/chat/ChatGroupEditSheets';
import { AiConversationActionsSheet } from '../../components/chat/AiConversationActionsSheet';
import type { ChatAiBot } from '../../api/types';
import { nextInboxRowSettings } from '../../chat/chatGestures';
import { applyConversationEnvelope, clearConversationUnread } from '../../chat/chatState';
import { useAndroidBackHandler } from '../../chat/useAndroidBackHandler';
import { chatSocket, shouldUseChatHttpFallback, type ChatSocketStatus } from '../../chat/chatSocket';
import { ChatConversationActionsSheet } from '../../components/chat/ChatConversationActionsSheet';
import { SwipeableConversationRow } from '../../components/chat/SwipeableConversationRow';
import { ChatFolderAssignSheet } from '../../components/chat/ChatFolderAssignSheet';
import { ChatFolderManagerSheet } from '../../components/chat/ChatFolderManagerSheet';
import { ChatFolderTabs } from '../../components/chat/ChatFolderTabs';
import { ChatWorkspaceTabs } from '../../components/chat/ChatWorkspaceTabs';
import { FolderSwipeHost } from '../../components/chat/FolderSwipeHost';
import { NewChatSheet } from '../../components/chat/NewChatSheet';
import { HubConnectionInline } from '../../components/layout/HubConnectionHeader';
import { useNativeBottomNavInset } from '../../navigation/useNativeBottomNavInset';
import { type ChatTokens, useChatTokens } from '../../theme/chatTokens';

type InboxListRow =
  | { key: string; type: 'header'; title: string }
  | { key: string; type: 'conversation'; item: ChatConversationSummary }
  | { key: string; type: 'message'; item: ChatGlobalMessageSearchHit };

export function NativeChatInboxScreen() {
  const chatTokens = useChatTokens();
  const styles = useMemo(() => createStyles(chatTokens), [chatTokens]);
  const { user, offlineMode } = useAuth();
  const bottomInset = useNativeBottomNavInset();
  const mountedRef = useRef(true);
  const loadingMoreRef = useRef(false);
  const loadStartingRef = useRef(false);
  const foldersStartingRef = useRef(false);
  const loadInFlightRef = useRef<Promise<void> | null>(null);
  const foldersInFlightRef = useRef<Promise<void> | null>(null);
  const connectedOnceRef = useRef(chatSocket.getStatus() === 'connected');
  const [items, setItems] = useState<ChatConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<ChatSocketStatus>(chatSocket.getStatus());
  const [activeFolderKey, setActiveFolderKey] = useState(DEFAULT_CHAT_FOLDER_KEY);
  const [customFolders, setCustomFolders] = useState<ChatCustomFolder[]>([]);
  const [conversationIdsByFolder, setConversationIdsByFolder] = useState<Record<string, string[]>>({});
  const [search, setSearch] = useState('');
  const [searchItems, setSearchItems] = useState<ChatConversationSummary[] | null>(null);
  const [searchMessages, setSearchMessages] = useState<ChatGlobalMessageSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [systemUnreadCounts, setSystemUnreadCounts] = useState<Record<string, number>>({});
  const [folderManagerOpen, setFolderManagerOpen] = useState(false);
  const [folderBusy, setFolderBusy] = useState(false);
  const [assignConversation, setAssignConversation] = useState<ChatConversationSummary | null>(null);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [users, setUsers] = useState<ChatUserSummary[]>([]);
  const [bots, setBots] = useState<ChatAiBot[]>([]);
  const [aiActionConversation, setAiActionConversation] = useState<ChatConversationSummary | null>(null);
  const [actionConversation, setActionConversation] = useState<ChatConversationSummary | null>(null);
  const [aiRenameConversation, setAiRenameConversation] = useState<ChatConversationSummary | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [workspace, setWorkspace] = useState<ChatWorkspaceKey>('chats');
  const [aiArchiveOpen, setAiArchiveOpen] = useState(false);
  const [folderSwipeActive, setFolderSwipeActive] = useState(false);
  const searchRequestRef = useRef(0);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
    if (loadStartingRef.current && !loadInFlightRef.current) return;
    if (loadInFlightRef.current) {
      if (mode === 'refresh') setRefreshing(true);
      await loadInFlightRef.current;
      if (mode === 'refresh' && mountedRef.current) setRefreshing(false);
      return;
    }
    loadStartingRef.current = true;
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    const userId = Number(user?.id || 0);
    let cached = false;
    if (mode === 'initial' && userId) {
      const snapshot = await readNativeChatInboxSnapshot(userId);
      if (mountedRef.current && snapshot) {
        cached = true;
        setItems(snapshot.data.items);
        setHasMore(snapshot.data.has_more);
        setNextCursor(snapshot.data.next_cursor);
        setLoading(false);
      }
    }
    if (offlineMode) {
      if (mountedRef.current) {
        if (!cached && mode !== 'silent') {
          setError('Нет подключения и сохранённых диалогов.');
        }
        if (mode === 'initial') setLoading(false);
        if (mode === 'refresh') setRefreshing(false);
      }
      loadStartingRef.current = false;
      return;
    }
    const request = chatApi.getConversationPage({ limit: 50 });
    loadInFlightRef.current = request.then(() => undefined, () => undefined);
    try {
      const page = await request;
      if (!mountedRef.current) return;
      if (mode === 'silent') {
        setItems((current) => {
          const byId = new Map(current.map((item) => [item.id, item]));
          page.items.forEach((item) => byId.set(item.id, { ...byId.get(item.id), ...item }));
          return [...byId.values()];
        });
      } else {
        setItems(page.items);
      }
      setHasMore(page.has_more);
      setNextCursor(page.next_cursor);
      setError('');
      if (userId) void writeNativeChatInboxSnapshot(userId, page);
    } catch (cause) {
      if (mountedRef.current && mode !== 'silent') {
        setError(cached
          ? 'Нет подключения. Показаны сохранённые диалоги.'
          : formatApiError(cause, 'Не удалось загрузить диалоги'));
      }
    } finally {
      loadStartingRef.current = false;
      loadInFlightRef.current = null;
      if (mountedRef.current) {
        if (mode === 'initial') setLoading(false);
        if (mode === 'refresh') setRefreshing(false);
      }
    }
  }, [offlineMode, user?.id]);

  const loadMore = useCallback(async () => {
    if (offlineMode || !hasMore || !nextCursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await chatApi.getConversationPage({ cursor: nextCursor, limit: 50 });
      if (!mountedRef.current) return;
      setItems((current) => {
        const byId = new Map(current.map((item) => [item.id, item]));
        page.items.forEach((item) => byId.set(item.id, { ...byId.get(item.id), ...item }));
        const merged = [...byId.values()];
        const userId = Number(user?.id || 0);
        if (userId) {
          void writeNativeChatInboxSnapshot(userId, {
            items: merged,
            has_more: page.has_more,
            next_cursor: page.next_cursor,
          });
        }
        return merged;
      });
      setHasMore(page.has_more);
      setNextCursor(page.next_cursor);
    } catch (cause) {
      if (mountedRef.current) setError(formatApiError(cause, 'Не удалось загрузить следующие диалоги'));
    } finally {
      loadingMoreRef.current = false;
      if (mountedRef.current) setLoadingMore(false);
    }
  }, [hasMore, nextCursor, offlineMode, user?.id]);

  const loadFolders = useCallback(async () => {
    if (foldersStartingRef.current && !foldersInFlightRef.current) return;
    if (foldersInFlightRef.current) {
      await foldersInFlightRef.current;
      return;
    }
    foldersStartingRef.current = true;
    const userId = Number(user?.id || 0);
    let cached = false;
    const applyFolders = (payload: ChatFolderListResponse) => {
      setCustomFolders(payload.items);
      setConversationIdsByFolder(buildConversationIdsByFolder(
        payload.items,
        payload.conversation_ids_by_folder,
      ));
      setSystemUnreadCounts(payload.folder_unread_counts || {});
    };
    if (userId) {
      const snapshot = await readNativeSnapshot<ChatFolderListResponse>('chat-folders', userId);
      if (mountedRef.current && snapshot) {
        cached = true;
        applyFolders(snapshot.data);
      }
    }
    if (offlineMode) {
      foldersStartingRef.current = false;
      return;
    }
    const request = chatApi.listChatFolders();
    foldersInFlightRef.current = request.then(() => undefined, () => undefined);
    try {
      const payload = await request;
      if (!mountedRef.current) return;
      applyFolders(payload);
      if (userId) void writeNativeSnapshot('chat-folders', userId, payload);
    } catch {
      if (mountedRef.current && !cached) {
        setCustomFolders([]);
        setConversationIdsByFolder({});
        setSystemUnreadCounts({});
      }
    } finally {
      foldersStartingRef.current = false;
      foldersInFlightRef.current = null;
    }
  }, [offlineMode, user?.id]);

  const changeFolder = useCallback((folderKey: string) => {
    setActiveFolderKey(folderKey);
    const userId = Number(user?.id || 0);
    if (userId) void setActiveChatFolderKey(userId, folderKey);
  }, [user?.id]);

  const swipeFolder = useCallback((direction: 'prev' | 'next') => {
    if (workspace !== 'chats') return;
    const nextKey = resolveFolderSwipeTarget(activeFolderKey, direction, customFolders);
    if (nextKey) changeFolder(nextKey);
  }, [activeFolderKey, changeFolder, customFolders, workspace]);

  const changeWorkspace = useCallback((nextWorkspace: ChatWorkspaceKey) => {
    setWorkspace(nextWorkspace);
    if (nextWorkspace === 'ai') setAiArchiveOpen(false);
    setFolderSwipeActive(false);
  }, []);

  const leaveInbox = useCallback(() => {
    if (assignConversation) {
      setAssignConversation(null);
      return true;
    }
    if (folderManagerOpen) {
      setFolderManagerOpen(false);
      return true;
    }
    if (newChatOpen) {
      setNewChatOpen(false);
      return true;
    }
    router.replace('/(shell)/dashboard');
    return true;
  }, [assignConversation, folderManagerOpen, newChatOpen]);

  useAndroidBackHandler(leaveInbox);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    void loadFolders();
    const userId = Number(user?.id || 0);
    if (userId) {
      void getActiveChatFolderKey(userId).then((folderKey) => {
        if (mountedRef.current) setActiveFolderKey(folderKey);
      });
    }
    chatSocket.subscribeInbox();
    void chatSocket.connect();

    const offStatus = chatSocket.on('status', (next) => {
      const nextStatus = next as ChatSocketStatus;
      setStatus(nextStatus);
      if (nextStatus !== 'connected') return;
      if (connectedOnceRef.current) {
        void load('silent');
        void loadFolders();
      } else {
        connectedOnceRef.current = true;
      }
    });
    const applyEnvelope = (envelope: unknown) => {
      setItems((current) => applyConversationEnvelope(
        current,
        envelope,
        user?.id,
        getActiveNativeChatConversationId(),
      ).items);
    };
    const offUpdated = chatSocket.on('chat.conversation.updated', applyEnvelope);
    const offMessage = chatSocket.on('chat.message.created', applyEnvelope);
    const offEdited = chatSocket.on('chat.message.updated', applyEnvelope);
    const offDeleted = chatSocket.on('chat.message.deleted', applyEnvelope);
    const offRemoved = chatSocket.on('chat.conversation.removed', (envelope: unknown) => {
      const conversationId = String(
        (envelope as { payload?: { conversation_id?: string } })?.payload?.conversation_id || '',
      ).trim();
      if (conversationId) setItems((current) => current.filter((item) => item.id !== conversationId));
    });
    const offConversationRead = subscribeNativeChatConversationRead((conversationId) => {
      setItems((current) => clearConversationUnread(current, conversationId));
      setSystemUnreadCounts({});
    });

    return () => {
      mountedRef.current = false;
      offStatus();
      offUpdated();
      offMessage();
      offEdited();
      offDeleted();
      offRemoved();
      offConversationRead();
    };
  }, [load, loadFolders, user?.id]);

  useEffect(() => {
    if (!shouldUseChatHttpFallback(status)) return undefined;
    void load('silent');
    void loadFolders();
    const timer = setInterval(() => {
      void load('silent');
      void loadFolders();
    }, 20_000);
    return () => clearInterval(timer);
  }, [load, loadFolders, status]);

  useFocusEffect(useCallback(() => {
    void load('silent');
    void loadFolders();
  }, [load, loadFolders]));

  useEffect(() => {
    const requestId = ++searchRequestRef.current;
    const query = search.trim();
    if (!query || workspace === 'ai') {
      setSearchItems(null);
      setSearchMessages([]);
      setSearching(false);
      return undefined;
    }
    // Immediate local filter so offline/saved titles stay findable (OFF-06).
    setSearchItems(filterConversationsByLocalQuery(items, query));
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
        if (!mountedRef.current || requestId !== searchRequestRef.current) return;
        const remote = page.items || [];
        const local = filterConversationsByLocalQuery(items, query);
        const byId = new Map<string, ChatConversationSummary>();
        [...local, ...remote].forEach((item) => {
          if (item?.id) byId.set(item.id, item);
        });
        setSearchItems([...byId.values()]);
        setSearchMessages(messages);
        setSearching(false);
      }).catch((cause) => {
        if (!mountedRef.current || requestId !== searchRequestRef.current) return;
        setSearching(false);
        // Keep local results; only surface an error when nothing local matched.
        if (!filterConversationsByLocalQuery(items, query).length) {
          setError(formatApiError(cause, 'Не удалось найти диалоги'));
        }
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [items, offlineMode, search, workspace]);

  const unreadCounts = useMemo(
    () => buildFolderUnreadCounts(items, customFolders, conversationIdsByFolder, systemUnreadCounts),
    [conversationIdsByFolder, customFolders, items, systemUnreadCounts],
  );

  const aiUnreadCount = useMemo(() => countAiUnread(items), [items]);

  const filtered = useMemo(() => {
    if (workspace === 'ai') {
      return filterAiConversations(items, { archived: aiArchiveOpen, query: search });
    }
    const query = search.trim();
    const source = query
      ? (searchItems ?? filterConversationsByLocalQuery(items, query))
      : items;
    const scoped = query
      ? source
      : filterConversationsByFolder(source, activeFolderKey, conversationIdsByFolder);
    return [...scoped].sort((left, right) => {
      const leftPinned = left.is_pinned ? 1 : 0;
      const rightPinned = right.is_pinned ? 1 : 0;
      if (leftPinned !== rightPinned) return rightPinned - leftPinned;
      const leftTime = new Date(left.last_message_at || 0).getTime();
      const rightTime = new Date(right.last_message_at || 0).getTime();
      return rightTime - leftTime;
    });
  }, [
    activeFolderKey,
    aiArchiveOpen,
    conversationIdsByFolder,
    items,
    search,
    searchItems,
    workspace,
  ]);

  const listRows = useMemo<InboxListRow[]>(() => {
    if (workspace === 'ai') {
      return groupAiSidebarRowsByDate(filtered).flatMap((group) => ([
        { key: `h-${group.key}`, type: 'header' as const, title: group.label },
        ...group.items.map((item) => ({ key: `c-${item.id}`, type: 'conversation' as const, item })),
      ]));
    }
    if (!search.trim()) {
      return filtered.map((item) => ({ key: `c-${item.id}`, type: 'conversation', item }));
    }
    const rows: InboxListRow[] = [];
    if (filtered.length) {
      rows.push({ key: 'h-dialogs', type: 'header', title: 'Диалоги' });
      filtered.forEach((item) => rows.push({ key: `c-${item.id}`, type: 'conversation', item }));
    }
    if (searchMessages.length) {
      rows.push({ key: 'h-messages', type: 'header', title: 'Сообщения' });
      searchMessages.forEach((item) => {
        rows.push({
          key: `m-${item.conversation_id}-${item.message_id}`,
          type: 'message',
          item,
        });
      });
    }
    return rows;
  }, [filtered, search, searchMessages, workspace]);

  const createFolder = useCallback(async (name: string) => {
    setFolderBusy(true);
    try {
      await chatApi.createChatFolder(name);
      await loadFolders();
    } catch (cause) {
      Alert.alert('Не удалось создать папку', formatApiError(cause, 'Повторите попытку'));
    } finally {
      if (mountedRef.current) setFolderBusy(false);
    }
  }, [loadFolders]);

  const renameFolder = useCallback(async (folderId: string, name: string) => {
    setFolderBusy(true);
    try {
      await chatApi.updateChatFolder(folderId, { name });
      await loadFolders();
    } catch (cause) {
      Alert.alert('Не удалось переименовать папку', formatApiError(cause, 'Повторите попытку'));
    } finally {
      if (mountedRef.current) setFolderBusy(false);
    }
  }, [loadFolders]);

  const deleteFolder = useCallback((folderId: string) => {
    const folder = customFolders.find((item) => item.id === folderId);
    Alert.alert(
      'Удалить папку?',
      folder ? `Папка «${folder.name}» будет удалена. Диалоги останутся на месте.` : 'Папка будет удалена.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setFolderBusy(true);
              try {
                await chatApi.deleteChatFolder(folderId);
                if (activeFolderKey === folderId) changeFolder(DEFAULT_CHAT_FOLDER_KEY);
                await loadFolders();
              } catch (cause) {
                Alert.alert('Не удалось удалить папку', formatApiError(cause, 'Повторите попытку'));
              } finally {
                if (mountedRef.current) setFolderBusy(false);
              }
            })();
          },
        },
      ],
    );
  }, [activeFolderKey, changeFolder, customFolders, loadFolders]);

  const toggleFolderMembership = useCallback(async (folderId: string, included: boolean) => {
    const conversationId = String(assignConversation?.id || '').trim();
    if (!conversationId) return;
    setConversationIdsByFolder((current) => (
      toggleConversationIdInFolderMap(current, folderId, conversationId, included)
    ));
    try {
      if (included) await chatApi.addFolderConversation(folderId, conversationId);
      else await chatApi.removeFolderConversation(folderId, conversationId);
      await loadFolders();
    } catch (cause) {
      await loadFolders();
      Alert.alert('Не удалось обновить папку', formatApiError(cause, 'Повторите попытку'));
    }
  }, [assignConversation?.id, loadFolders]);

  const openFolderAssign = useCallback((item: ChatConversationSummary) => {
    if (!customFolders.length) {
      Alert.alert('Папки', 'Сначала создайте папку.', [
        { text: 'Создать', onPress: () => setFolderManagerOpen(true) },
        { text: 'Отмена', style: 'cancel' },
      ]);
      return;
    }
    setAssignConversation(item);
  }, [customFolders.length]);

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
                  Alert.alert('Контекст сброшен', 'Новые ответы не будут учитывать предыдущую историю.');
                }
              } catch (cause) {
                if (mountedRef.current) {
                  Alert.alert('Не удалось сбросить контекст', formatApiError(cause, 'Повторите попытку'));
                }
              } finally {
                if (mountedRef.current) setAiBusy(false);
              }
            })();
          },
        },
      ],
    );
  }, []);

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
                  Alert.alert('Не удалось удалить чат', formatApiError(cause, 'Повторите попытку'));
                }
              } finally {
                if (mountedRef.current) setAiBusy(false);
              }
            })();
          },
        },
      ],
    );
  }, []);

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
        Alert.alert('Не удалось переименовать AI-диалог', formatApiError(cause, 'Повторите попытку'));
      }
    } finally {
      if (mountedRef.current) setAiBusy(false);
    }
  }, [aiBusy, aiRenameConversation]);

  const applyConversationSettings = useCallback(async (
    item: ChatConversationSummary,
    settings: { is_pinned?: boolean; is_muted?: boolean; is_archived?: boolean },
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
        Alert.alert('Не удалось обновить диалог', formatApiError(cause, 'Повторите попытку'));
      }
    }
  }, [load]);

  const applyRowSwipe = useCallback(async (
    item: ChatConversationSummary,
    action: 'mute' | 'archive',
  ) => {
    const settings = nextInboxRowSettings(item, action);
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

  const refreshInbox = useCallback(() => {
    void load('refresh');
    void loadFolders();
  }, [load, loadFolders]);

  const handleEndReached = useCallback(() => {
    if (!searchItems) void loadMore();
  }, [loadMore, searchItems]);

  const listContentStyle = useMemo(() => ({ paddingBottom: bottomInset }), [bottomInset]);

  const renderInboxRow = useCallback(({ item }: ListRenderItemInfo<InboxListRow>) => {
    if (item.type === 'header') {
      return <Text style={styles.sectionTitle}>{item.title}</Text>;
    }
    if (item.type === 'message') {
      return (
        <Pressable
          onPress={() => goConversation(item.item.conversation_id, item.item.message_id)}
          style={({ pressed }) => [styles.messageHit, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Сообщение в ${item.item.conversation_title}`}
        >
          <Text style={styles.messageHitTitle} numberOfLines={1}>{item.item.conversation_title}</Text>
          <Text style={styles.messageHitPreview} numberOfLines={2}>
            {[item.item.sender_name, item.item.preview].filter(Boolean).join(': ')}
          </Text>
        </Pressable>
      );
    }
    return (
      <SwipeableConversationRow
        item={item.item}
        onPress={openConversation}
        onLongPress={openConversationActions}
        onMute={muteConversation}
        onArchive={archiveConversation}
      />
    );
  }, [
    archiveConversation,
    goConversation,
    muteConversation,
    openConversation,
    openConversationActions,
    styles,
  ]);

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
      Alert.alert(
        workspace === 'ai' ? 'Не удалось открыть AI-чат' : 'Не удалось создать диалог',
        formatApiError(cause, 'Повторите попытку'),
      );
    }
  }, [workspace]);

  const searchNewChatUsers = useCallback((query: string) => (
    chatApi.getChatUsers({ query, limit: 50 })
  ), []);

  const emptyLabel = workspace === 'ai'
    ? (search.trim()
      ? 'По вашему запросу AI-диалоги не найдены.'
      : (aiArchiveOpen
        ? 'В архиве пока нет AI-диалогов.'
        : 'Нажмите «Новый AI-чат» и выберите помощника.'))
    : (search.trim() || activeFolderKey !== DEFAULT_CHAT_FOLDER_KEY
      ? 'По заданным условиям диалогов нет'
      : 'Диалогов пока нет');

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView style={styles.keyboard} {...chatKeyboardAvoidingProps()}>
      <View style={styles.header}>
        <IconButton
          icon="arrow-left"
          onPress={() => router.replace('/(shell)/dashboard')}
          accessibilityLabel="Вернуться в HUB-IT"
        />
        <Pressable style={styles.headerTitleBlock} disabled={workspace !== 'chats'} accessibilityRole="button" accessibilityLabel={workspace === 'chats' ? 'Управление папками' : 'ИИ'} onPress={() => setFolderManagerOpen(true)}>
          <Text style={styles.headerTitle} accessibilityRole="header">
            {workspace === 'ai' ? (aiArchiveOpen ? 'ИИ · Архив' : 'ИИ') : 'Чат ▾'}
          </Text>
          <HubConnectionInline showHub />
        </Pressable>

        <IconButton icon="tray-arrow-up" accessibilityLabel="Очередь отправки" onPress={() => router.push('/(shell)/chat/outbox')} />
        <IconButton
          icon="message-plus-outline"
          iconColor={chatTokens.composerActionBg}
          onPress={() => void openNewChat()}
          accessibilityLabel={workspace === 'ai' ? 'Новый AI-чат' : 'Создать диалог'}
        />
      </View>

      <ChatWorkspaceTabs
        workspace={workspace}
        aiUnreadCount={aiUnreadCount}
        onChange={changeWorkspace}
      />

      <View style={styles.searchWrap}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={workspace === 'ai' ? 'Поиск по AI-диалогам' : 'Поиск диалогов и сообщений'}
          placeholderTextColor={chatTokens.textSecondary}
          style={styles.search}
          accessibilityLabel={workspace === 'ai' ? 'Поиск по AI-диалогам' : 'Поиск чатов'}
          returnKeyType="search"
        />
        {workspace === 'ai' ? (
          <Pressable
            onPress={() => setAiArchiveOpen((current) => !current)}
            style={[styles.unreadToggle, aiArchiveOpen && styles.unreadToggleActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: aiArchiveOpen }}
            accessibilityLabel="Архив ИИ"
          >
            <Text style={[styles.unreadToggleText, aiArchiveOpen && styles.unreadToggleTextActive]}>
              Архив
            </Text>
          </Pressable>
        ) : null}
      </View>
      {workspace === 'chats' ? (
        <FolderSwipeHost
          fill={false}
          capture
          onSwipeFolder={swipeFolder}
          onSwipeEngage={setFolderSwipeActive}
        >
          <ChatFolderTabs
            activeFolderKey={activeFolderKey}
            customFolders={customFolders}
            unreadCounts={unreadCounts}
            onFolderChange={changeFolder}
          />
        </FolderSwipeHost>
      ) : null}

      {loading ? (
        <View style={[styles.center, { paddingBottom: bottomInset }]} accessibilityLiveRegion="polite">
          <ActivityIndicator color={chatTokens.composerActionBg} />
          <Text style={styles.stateText}>Загружаем диалоги…</Text>
        </View>
      ) : error && items.length === 0 ? (
        <View style={[styles.center, { paddingBottom: bottomInset }]} accessibilityLiveRegion="assertive">
          <Text style={styles.errorTitle}>Не удалось открыть чат</Text>
          <Text style={styles.stateText}>{error}</Text>
          <Pressable
            onPress={() => void load('initial')}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>Повторить</Text>
          </Pressable>
        </View>
      ) : (
        <FolderSwipeHost
          enabled={workspace === 'chats'}
          onSwipeFolder={swipeFolder}
          onSwipeEngage={setFolderSwipeActive}
        >
        <FlatList
          testID="native-chat-inbox-list"
          data={listRows}
          keyExtractor={(item) => item.key}
          contentContainerStyle={listContentStyle}
          renderItem={renderInboxRow}
          refreshControl={folderSwipeActive ? undefined : (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refreshInbox}
              tintColor={chatTokens.composerActionBg}
              colors={[chatTokens.composerActionBg]}
            />
          )}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.35}
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={7}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={(
            <Text style={styles.empty}>
              {searching ? 'Ищем диалоги и сообщения…' : emptyLabel}
            </Text>
          )}
          ListFooterComponent={loadingMore && !searchItems ? (
            <ActivityIndicator style={styles.moreLoader} color={chatTokens.composerActionBg} />
          ) : null}
        />
        </FolderSwipeHost>
      )}

      <ChatFolderManagerSheet
        visible={folderManagerOpen}
        folders={customFolders}
        busy={folderBusy}
        onClose={() => setFolderManagerOpen(false)}
        onCreate={(name) => void createFolder(name)}
        onRename={(folderId, name) => void renameFolder(folderId, name)}
        onDelete={deleteFolder}
      />
      <ChatFolderAssignSheet
        conversation={assignConversation}
        folders={customFolders}
        conversationIdsByFolder={conversationIdsByFolder}
        onClose={() => setAssignConversation(null)}
        onToggle={(folderId, included) => void toggleFolderMembership(folderId, included)}
      />
      <ChatConversationActionsSheet
        conversation={actionConversation}
        onClose={() => setActionConversation(null)}
        onTogglePin={(item) => {
          setActionConversation(null);
          void applyConversationSettings(item, { is_pinned: !Boolean(item.is_pinned) });
        }}
        onToggleMute={(item) => {
          setActionConversation(null);
          void applyConversationSettings(item, { is_muted: !Boolean(item.is_muted) });
        }}
        onToggleArchive={(item) => {
          setActionConversation(null);
          void applyConversationSettings(item, { is_archived: !Boolean(item.is_archived) });
        }}
        onFolders={(item) => {
          setActionConversation(null);
          openFolderAssign(item);
        }}
      />
      <AiConversationActionsSheet
        conversation={aiActionConversation}
        onClose={() => setAiActionConversation(null)}
        onRename={(item) => {
          setAiActionConversation(null);
          setAiRenameConversation(item);
        }}
        onResetContext={(item) => {
          setAiActionConversation(null);
          resetAiContext(item);
        }}
        onDelete={(item) => {
          setAiActionConversation(null);
          deleteAiConversation(item);
        }}
      />
      <ChatRenameSheet
        visible={Boolean(aiRenameConversation)}
        initialTitle={aiRenameConversation?.title || ''}
        busy={aiBusy}
        heading="Название диалога"
        inputLabel="Новое название диалога"
        onClose={() => setAiRenameConversation(null)}
        onSave={(nextTitle) => void renameAiConversation(nextTitle)}
      />
      <NewChatSheet
        visible={newChatOpen}
        users={users}
        bots={bots}
        variant={workspace === 'ai' ? 'ai' : 'chats'}
        onClose={() => setNewChatOpen(false)}
        onGeneralAi={async () => {
          try {
            const conversation = await chatApi.createAiConversation();
            setNewChatOpen(false);
            goConversation(conversation.id);
          } catch (cause) {
            Alert.alert('Не удалось открыть AI-диалог', formatApiError(cause));
          }
        }}
        onDirect={async (userId) => {
          try {
            const conversation = await chatApi.createDirectConversation(userId);
            setNewChatOpen(false);
            goConversation(conversation.id);
          } catch (cause) {
            Alert.alert('Не удалось создать диалог', formatApiError(cause));
          }
        }}
        onSearchUsers={searchNewChatUsers}
        onGroup={async (title, memberIds) => {
          try {
            const conversation = await chatApi.createGroupConversation(title, memberIds);
            setNewChatOpen(false);
            goConversation(conversation.id);
          } catch (cause) {
            Alert.alert('Не удалось создать группу', formatApiError(cause));
          }
        }}
        onBot={async (botId) => {
          try {
            const conversation = await chatApi.openAiBot(botId);
            setNewChatOpen(false);
            goConversation(conversation.id);
          } catch (cause) {
            Alert.alert('Не удалось открыть AI-диалог', formatApiError(cause));
          }
        }}
      />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: chatTokens.sidebarBg },
  keyboard: { flex: 1 },
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 4,
    backgroundColor: chatTokens.panelBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chatTokens.sidebarDivider,
  },
  headerTitleBlock: { flex: 1, minWidth: 0, justifyContent: 'center' },
  headerTitle: { fontSize: 20, lineHeight: 24, fontWeight: '700', color: chatTokens.textPrimary },
  searchWrap: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 2, gap: 8 },
  search: {
    minHeight: 44,
    backgroundColor: chatTokens.sidebarSearchBg,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    color: chatTokens.textPrimary,
  },
  unreadToggle: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: chatTokens.sidebarSearchBg,
  },
  unreadToggleActive: { backgroundColor: chatTokens.composerActionBg },
  unreadToggleText: { color: chatTokens.textSecondary, fontSize: 13, fontWeight: '600' },
  unreadToggleTextActive: { color: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  errorTitle: { color: chatTokens.textPrimary, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  stateText: { color: chatTokens.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  retryButton: {
    minWidth: 120,
    minHeight: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    backgroundColor: chatTokens.composerActionBg,
  },
  retryText: { color: chatTokens.composerActionText, fontSize: 15, fontWeight: '700' },
  pressed: { transform: [{ scale: 0.96 }], opacity: 0.9 },
  empty: { textAlign: 'center', marginTop: 48, color: chatTokens.textSecondary, fontSize: 15 },
  moreLoader: { marginVertical: 16 },
  sectionTitle: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
    color: chatTokens.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  messageHit: {
    minHeight: 64,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: chatTokens.panelBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chatTokens.sidebarDivider,
  },
  messageHitTitle: { color: chatTokens.textPrimary, fontSize: 15, fontWeight: '700' },
  messageHitPreview: { color: chatTokens.textSecondary, fontSize: 14, marginTop: 2, lineHeight: 18 },
});
