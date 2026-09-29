import { useCallback, useRef, useState, type MutableRefObject } from 'react';
import { Alert } from 'react-native';
import * as chatApi from '../../api/chatApi';
import type {
  ChatConversationSummary,
  ChatFolderListResponse,
} from '../../api/types';
import { formatApiError } from '../../api/formatError';
import { setActiveChatFolderKey } from '../../chat/chatActiveFolder';
import {
  buildConversationIdsByFolder,
  DEFAULT_CHAT_FOLDER_KEY,
  resolveFolderSwipeTarget,
  toggleConversationIdInFolderMap,
  type ChatCustomFolder,
} from '../../chat/chatFolders';
import { readNativeSnapshot, writeNativeSnapshot } from '../../cache/nativeSnapshotCache';
import { showNativeToast } from '../../components/nativeToast';
import type { ChatWorkspaceKey } from '../../chat/chatAiWorkspace';

/** Inbox folder state: server folder list, membership map, manager/assign
 * sheets, swipe switching and folder mutations. */
export function useInboxFolders({
  userId,
  offlineMode,
  mountedRef,
  ownerRef,
  workspace,
}: {
  userId: number;
  offlineMode: boolean;
  mountedRef: MutableRefObject<boolean>;
  ownerRef: MutableRefObject<number>;
  workspace: ChatWorkspaceKey;
}) {
  const foldersStartingRef = useRef(false);
  const foldersScopeRef = useRef<{ owner: number } | null>(null);
  const foldersInFlightRef = useRef<Promise<void> | null>(null);
  const [activeFolderKey, setActiveFolderKey] = useState(DEFAULT_CHAT_FOLDER_KEY);
  const [customFolders, setCustomFolders] = useState<ChatCustomFolder[]>([]);
  const [conversationIdsByFolder, setConversationIdsByFolder] = useState<Record<string, string[]>>({});
  const [systemUnreadCounts, setSystemUnreadCounts] = useState<Record<string, number>>({});
  const [folderManagerOpen, setFolderManagerOpen] = useState(false);
  const [folderBusy, setFolderBusy] = useState(false);
  const [assignConversation, setAssignConversation] = useState<ChatConversationSummary | null>(null);
  const [folderSwipeActive, setFolderSwipeActive] = useState(false);

  const loadFolders = useCallback(async () => {
    if (ownerRef.current !== userId) return;
    if (foldersScopeRef.current?.owner !== userId) {
      foldersScopeRef.current = { owner: userId };
      foldersStartingRef.current = false;
      foldersInFlightRef.current = null;
      setCustomFolders([]);
      setConversationIdsByFolder({});
      setSystemUnreadCounts({});
      setActiveFolderKey(DEFAULT_CHAT_FOLDER_KEY);
    }
    const scope = foldersScopeRef.current;
    const isCurrent = () => mountedRef.current && ownerRef.current === userId && foldersScopeRef.current === scope;
    if (foldersStartingRef.current && !foldersInFlightRef.current) return;
    if (foldersInFlightRef.current) {
      await foldersInFlightRef.current;
      return;
    }
    foldersStartingRef.current = true;
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
      const snapshot = await readNativeSnapshot<ChatFolderListResponse>('chat-folders', userId).catch(() => null);
      if (!isCurrent()) return;
      if (snapshot) {
        cached = true;
        applyFolders(snapshot.data);
      }
    }
    if (offlineMode) {
      if (isCurrent()) foldersStartingRef.current = false;
      return;
    }
    const request = chatApi.listChatFolders();
    foldersInFlightRef.current = request.then(() => undefined, () => undefined);
    try {
      const payload = await request;
      if (!isCurrent()) return;
      applyFolders(payload);
      if (userId) void writeNativeSnapshot('chat-folders', userId, payload);
    } catch {
      if (isCurrent() && !cached) {
        setCustomFolders([]);
        setConversationIdsByFolder({});
        setSystemUnreadCounts({});
      }
    } finally {
      if (isCurrent()) {
        foldersStartingRef.current = false;
        foldersInFlightRef.current = null;
      }
    }
  }, [mountedRef, offlineMode, ownerRef, userId]);

  const changeFolder = useCallback((folderKey: string) => {
    setActiveFolderKey(folderKey);
    if (userId) void setActiveChatFolderKey(userId, folderKey);
  }, [userId]);

  const swipeFolder = useCallback((direction: 'prev' | 'next') => {
    if (workspace !== 'chats') return;
    const nextKey = resolveFolderSwipeTarget(activeFolderKey, direction, customFolders);
    if (nextKey) changeFolder(nextKey);
  }, [activeFolderKey, changeFolder, customFolders, workspace]);

  const createFolder = useCallback(async (name: string) => {
    setFolderBusy(true);
    try {
      await chatApi.createChatFolder(name);
      await loadFolders();
    } catch (cause) {
      showNativeToast('Не удалось создать папку', formatApiError(cause, 'Повторите попытку'));
    } finally {
      if (mountedRef.current) setFolderBusy(false);
    }
  }, [loadFolders, mountedRef]);

  const renameFolder = useCallback(async (folderId: string, name: string) => {
    setFolderBusy(true);
    try {
      await chatApi.updateChatFolder(folderId, { name });
      await loadFolders();
    } catch (cause) {
      showNativeToast('Не удалось переименовать папку', formatApiError(cause, 'Повторите попытку'));
    } finally {
      if (mountedRef.current) setFolderBusy(false);
    }
  }, [loadFolders, mountedRef]);

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
                showNativeToast('Не удалось удалить папку', formatApiError(cause, 'Повторите попытку'));
              } finally {
                if (mountedRef.current) setFolderBusy(false);
              }
            })();
          },
        },
      ],
    );
  }, [activeFolderKey, changeFolder, customFolders, loadFolders, mountedRef]);

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
      showNativeToast('Не удалось обновить папку', formatApiError(cause, 'Повторите попытку'));
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

  return {
    activeFolderKey,
    setActiveFolderKey,
    customFolders,
    conversationIdsByFolder,
    systemUnreadCounts,
    setSystemUnreadCounts,
    folderManagerOpen,
    setFolderManagerOpen,
    folderBusy,
    assignConversation,
    setAssignConversation,
    folderSwipeActive,
    setFolderSwipeActive,
    loadFolders,
    changeFolder,
    swipeFolder,
    createFolder,
    renameFolder,
    deleteFolder,
    toggleFolderMembership,
    openFolderAssign,
  };
}
