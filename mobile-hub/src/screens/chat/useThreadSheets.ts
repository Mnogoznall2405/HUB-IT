import { useCallback, useEffect, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import * as chatApi from '../../api/chatApi';
import type {
  ChatConversationSummary,
  ChatMember,
  ChatMessage,
  ChatSticker,
  ChatStickerPack,
  ChatTaskPreview,
  ChatUserSummary,
  HubUser,
} from '../../api/types';
import { formatApiError } from '../../api/formatError';
import { isAiConversation } from '../../chat/chatAiWorkspace';
import type { ChatListAnchorReason } from '../../chat/chatListAnchor';
import { createChatClientMessageId } from '../../chat/chatModels';
import { mergeMessages } from '../../chat/chatState';
import { getRecentStickerIds, rememberRecentSticker } from '../../chat/chatStickers';
import type { createNativeChatOutbox, NativeChatOutboxCommand } from '../../chat/nativeChatOutbox';
import { showNativeToast } from '../../components/nativeToast';
import type { useThreadComposerState } from './useThreadComposerState';

type Composer = ReturnType<typeof useThreadComposerState>;
type ThreadOutbox = ReturnType<typeof createNativeChatOutbox>;

/** Conversation sheets: info/members/rename, task share, sticker picker, emoji. */
export function useThreadSheets({
  conversationId,
  userId,
  user,
  offlineMode,
  mountedRef,
  loadGenerationRef,
  isCurrentSendScope,
  conversation,
  mentionQuery,
  requestBottomAnchor,
  outbox,
  setMessages,
  setConversation,
  setTitle,
  composer,
}: {
  conversationId: string;
  userId?: number;
  user?: HubUser | null;
  offlineMode: boolean;
  mountedRef: MutableRefObject<boolean>;
  loadGenerationRef: MutableRefObject<number>;
  isCurrentSendScope: () => boolean;
  conversation: ChatConversationSummary | null;
  mentionQuery: string | null;
  requestBottomAnchor: (reason?: ChatListAnchorReason) => void;
  outbox: ThreadOutbox;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setConversation: Dispatch<SetStateAction<ChatConversationSummary | null>>;
  setTitle: Dispatch<SetStateAction<string>>;
  composer: Composer;
}) {
  const { composerMode, setComposerMode, composerBusyRef, setComposerBusy } = composer;
  const [infoVisible, setInfoVisible] = useState(false);
  useEffect(() => { setInfoVisible(false); }, [conversationId, userId]);
  const [profileMember, setProfileMember] = useState<ChatMember | null>(null);
  const [conversationBusy, setConversationBusy] = useState(false);
  const [renameVisible, setRenameVisible] = useState(false);
  const [memberPickerVisible, setMemberPickerVisible] = useState(false);
  const [chatUsers, setChatUsers] = useState<ChatUserSummary[]>([]);
  const [taskPickerVisible, setTaskPickerVisible] = useState(false);
  const [shareableTasks, setShareableTasks] = useState<ChatTaskPreview[]>([]);
  const [taskPickerLoading, setTaskPickerLoading] = useState(false);
  const [stickerPickerVisible, setStickerPickerVisible] = useState(false);
  const [stickerPacks, setStickerPacks] = useState<ChatStickerPack[]>([]);
  const [stickerPickerLoading, setStickerPickerLoading] = useState(false);
  const [stickerImporting, setStickerImporting] = useState(false);
  const [recentStickerIds, setRecentStickerIds] = useState<string[]>([]);
  const [emojiPickerVisible, setEmojiPickerVisible] = useState(false);
  const [pollCreateVisible, setPollCreateVisible] = useState(false);

  useEffect(() => {
    if (mentionQuery === null || chatUsers.length) return;
    let active = true;
    void chatApi.getChatUsers().then((users) => {
      if (active) setChatUsers(users);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [chatUsers.length, mentionQuery]);

  const openConversationInfo = useCallback(() => {
    setInfoVisible(true);
    if (offlineMode) return;
    const generation = loadGenerationRef.current;
    void chatApi.getConversation(conversationId).then((details) => {
      if (!mountedRef.current || loadGenerationRef.current !== generation) return;
      setConversation(details);
      setTitle(details.title || 'Chat');
    }).catch(() => undefined);
  }, [conversationId, mountedRef, offlineMode, setConversation, setTitle]);

  const updateConversationSetting = useCallback(async (
    key: 'is_muted' | 'is_pinned' | 'is_archived',
    value: boolean,
  ) => {
    if (conversationBusy) return;
    setConversationBusy(true);
    try {
      const updated = await chatApi.updateConversationSettings(conversationId, { [key]: value });
      if (mountedRef.current) setConversation(updated);
    } catch (cause) {
      if (mountedRef.current) {
        showNativeToast('Не удалось изменить настройки чата', formatApiError(cause, 'Повторите попытку'));
      }
    } finally {
      if (mountedRef.current) setConversationBusy(false);
    }
  }, [conversationBusy, conversationId, mountedRef, setConversation]);

  const renameGroup = useCallback(async (nextTitle: string) => {
    if (!nextTitle.trim() || conversationBusy) return;
    setConversationBusy(true);
    try {
      const updated = isAiConversation(conversation)
        ? await chatApi.renameAiConversation(conversationId, nextTitle.trim())
        : await chatApi.updateGroupProfile(conversationId, nextTitle.trim());
      if (!mountedRef.current) return;
      setConversation(updated);
      setTitle(updated.title || nextTitle.trim());
      setRenameVisible(false);
    } catch (cause) {
      if (mountedRef.current) {
        showNativeToast('Не удалось изменить название', formatApiError(cause, 'Повторите попытку'));
      }
    } finally {
      if (mountedRef.current) setConversationBusy(false);
    }
  }, [conversation, conversationBusy, conversationId, mountedRef, setConversation, setTitle]);

  const resetAiContext = useCallback(() => {
    Alert.alert(
      'Сбросить контекст?',
      'Старые сообщения останутся видимыми, но помощник перестанет учитывать их в новых ответах.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Сбросить',
          onPress: () => {
            void (async () => {
              setConversationBusy(true);
              try {
                await chatApi.resetAiConversationContext(conversationId);
                if (mountedRef.current) {
                  setInfoVisible(false);
                  Alert.alert('Контекст сброшен', 'Новые ответы не будут учитывать предыдущую историю.');
                }
              } catch (cause) {
                if (mountedRef.current) {
                  Alert.alert('Не удалось сбросить контекст', formatApiError(cause, 'Повторите попытку'));
                }
              } finally {
                if (mountedRef.current) setConversationBusy(false);
              }
            })();
          },
        },
      ],
    );
  }, [conversationId, mountedRef]);

  const deleteAiConversation = useCallback(() => {
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
              setConversationBusy(true);
              try {
                await chatApi.deleteAiConversation(conversationId);
                if (mountedRef.current) {
                  setInfoVisible(false);
                  router.back();
                }
              } catch (cause) {
                if (mountedRef.current) {
                  Alert.alert('Не удалось удалить чат', formatApiError(cause, 'Повторите попытку'));
                }
              } finally {
                if (mountedRef.current) setConversationBusy(false);
              }
            })();
          },
        },
      ],
    );
  }, [conversationId, mountedRef]);

  const openMemberPicker = useCallback(async () => {
    setConversationBusy(true);
    try {
      const users = await chatApi.getChatUsers();
      if (!mountedRef.current) return;
      setChatUsers(users);
      setMemberPickerVisible(true);
    } catch (cause) {
      if (mountedRef.current) {
        showNativeToast('Не удалось загрузить пользователей', formatApiError(cause, 'Повторите попытку'));
      }
    } finally {
      if (mountedRef.current) setConversationBusy(false);
    }
  }, [mountedRef]);

  const addMembers = useCallback(async (userIds: number[]) => {
    if (!userIds.length || conversationBusy) return;
    setConversationBusy(true);
    try {
      const updated = await chatApi.addGroupMembers(conversationId, userIds);
      if (!mountedRef.current) return;
      setConversation(updated);
      setMemberPickerVisible(false);
    } catch (cause) {
      if (mountedRef.current) {
        showNativeToast('Не удалось добавить участников', formatApiError(cause, 'Повторите попытку'));
      }
    } finally {
      if (mountedRef.current) setConversationBusy(false);
    }
  }, [conversationBusy, conversationId, mountedRef, setConversation]);

  const updateMember = useCallback(async (
    member: ChatMember,
    action: 'promote' | 'demote' | 'remove' | 'transfer',
  ) => {
    if (conversationBusy) return;
    setConversationBusy(true);
    try {
      const updated = action === 'remove'
        ? await chatApi.removeGroupMember(conversationId, member.user.id)
        : action === 'transfer'
          ? await chatApi.transferGroupOwnership(conversationId, member.user.id)
          : await chatApi.updateGroupMemberRole(
            conversationId,
            member.user.id,
            action === 'promote' ? 'moderator' : 'member',
          );
      if (mountedRef.current) setConversation(updated);
    } catch (cause) {
      if (mountedRef.current) {
        showNativeToast('Не удалось изменить участника', formatApiError(cause, 'Повторите попытку'));
      }
    } finally {
      if (mountedRef.current) setConversationBusy(false);
    }
  }, [conversationBusy, conversationId, mountedRef, setConversation]);

  const openPersonProfile = useCallback((user: ChatUserSummary) => {
    const members = conversation?.members || conversation?.member_preview || [];
    const existing = members.find((member) => member.user.id === user.id);
    if (existing) {
      setProfileMember(existing);
      return;
    }
    if (conversation?.direct_peer?.id === user.id) {
      setProfileMember({ user: conversation.direct_peer, member_role: 'member' });
      return;
    }
    setProfileMember({ user, member_role: 'member' });
  }, [conversation]);

  const openMemberActions = useCallback((member: ChatMember) => {
    const viewerRole = conversation?.viewer_member_role;
    const buttons: Array<{
      text: string;
      style?: 'default' | 'cancel' | 'destructive';
      onPress?: () => void;
    }> = [];
    if (member.member_role === 'moderator') {
      buttons.push({ text: 'Сделать участником', onPress: () => void updateMember(member, 'demote') });
    } else {
      buttons.push({ text: 'Сделать администратором', onPress: () => void updateMember(member, 'promote') });
    }
    if (viewerRole === 'owner') {
      buttons.push({ text: 'Передать права владельца', onPress: () => void updateMember(member, 'transfer') });
    }
    buttons.push({ text: 'Удалить из группы', style: 'destructive', onPress: () => void updateMember(member, 'remove') });
    buttons.push({ text: 'Отмена', style: 'cancel' });
    Alert.alert(member.user.full_name || member.user.username, 'Управление участником', buttons);
  }, [conversation?.viewer_member_role, updateMember]);

  const requestLeaveGroup = useCallback(() => {
    Alert.alert('Покинуть группу?', 'Вы перестанете получать новые сообщения этой группы.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Покинуть',
        style: 'destructive',
        onPress: () => {
          setConversationBusy(true);
          void chatApi.leaveGroup(conversationId).then(() => {
            if (!mountedRef.current) return;
            setInfoVisible(false);
            router.replace('/chat');
          }).catch((cause) => {
            if (mountedRef.current) Alert.alert('Не удалось покинуть группу', formatApiError(cause, 'Повторите попытку'));
          }).finally(() => {
            if (mountedRef.current) setConversationBusy(false);
          });
        },
      },
    ]);
  }, [conversationId, mountedRef]);

  const openTask = useCallback((taskId: string) => {
    router.push({ pathname: '/tasks/[taskId]', params: { taskId } });
  }, []);

  const loadShareableTasks = useCallback(async (query = '') => {
    setTaskPickerLoading(true);
    try {
      const tasks = await chatApi.getShareableTasks(conversationId, query);
      if (mountedRef.current) setShareableTasks(tasks);
    } catch (cause) {
      if (mountedRef.current) showNativeToast('Не удалось загрузить задачи', formatApiError(cause, 'Повторите попытку'));
    } finally {
      if (mountedRef.current) setTaskPickerLoading(false);
    }
  }, [conversationId, mountedRef]);

  const openTaskPicker = useCallback(() => {
    composer.setAttachmentPickerVisible(false);
    setEmojiPickerVisible(false);
    setStickerPickerVisible(false);
    setPollCreateVisible(false);
    setTaskPickerVisible(true);
    void loadShareableTasks();
  }, [composer, loadShareableTasks]);

  // M3: sticker/task-share sends go through the durable outbox — the bubble is
  // optimistic (local_status), the delivery host replays the command with the
  // same client_message_id until the server confirms it, and mergeMessages
  // reconciles the pending bubble with the realtime/HTTP acknowledgement.
  const queueSpecialMessage = useCallback(async (
    fields: Pick<ChatMessage, 'kind' | 'body_text' | 'body' | 'body_format' | 'task_preview' | 'attachments'>,
    command: NativeChatOutboxCommand,
    failureTitle: string,
  ): Promise<ChatMessage | null> => {
    const clientMessageId = createChatClientMessageId();
    const replyMessage = composerMode?.type === 'reply' ? composerMode.message : null;
    const pending: ChatMessage = {
      id: `pending:${clientMessageId}`,
      conversation_id: conversationId,
      sender_user_id: Number(userId || 0),
      sender: user ? {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        avatar_url: user.avatar_url,
      } : null,
      created_at: new Date().toISOString(),
      client_message_id: clientMessageId,
      is_own: true,
      local_status: 'sending',
      reactions: [],
      ...fields,
      reply_preview: replyMessage ? {
        id: replyMessage.id,
        sender_name: replyMessage.sender?.full_name || replyMessage.sender?.username || 'Сообщение',
        kind: replyMessage.kind === 'file' || replyMessage.kind === 'task_share' ? replyMessage.kind : 'text' as const,
        body: replyMessage.body_text || '',
        attachments_count: replyMessage.attachments?.length || 0,
      } : null,
    };
    requestBottomAnchor('own-send');
    setMessages((current) => mergeMessages(
      current.filter((message) => message.id !== pending.id),
      pending,
      userId,
    ));
    try {
      const queued = await outbox.queue(pending, undefined, command);
      if (isCurrentSendScope()) {
        setMessages((current) => mergeMessages(current, queued.message, userId));
      }
      return queued.message;
    } catch (cause) {
      if (isCurrentSendScope()) {
        setMessages((current) => current.map((message) => (
          message.id === pending.id ? { ...message, local_status: 'failed' } : message
        )));
        showNativeToast(failureTitle, formatApiError(cause, 'Сообщение не поставлено в очередь. Повторите попытку.'));
      }
      return null;
    }
  }, [composerMode, conversationId, isCurrentSendScope, outbox, requestBottomAnchor, setMessages, user, userId]);

  const shareTask = useCallback(async (task: ChatTaskPreview) => {
    if (!isCurrentSendScope() || composerBusyRef.current) return;
    setComposerBusy(true);
    try {
      const queued = await queueSpecialMessage(
        {
          kind: 'task_share',
          body: task.title,
          body_text: task.title,
          body_format: 'plain',
          task_preview: task,
          attachments: [],
        },
        { type: 'task_share', task_id: task.id },
        'Не удалось отправить задачу',
      );
      if (!queued) return;
      setTaskPickerVisible(false);
      setComposerMode(null);
    } finally {
      if (isCurrentSendScope()) setComposerBusy(false);
    }
  }, [composerBusyRef, isCurrentSendScope, queueSpecialMessage, setComposerBusy, setComposerMode]);

  const openStickerPicker = useCallback(async () => {
    composer.setAttachmentPickerVisible(false);
    setEmojiPickerVisible(false);
    setPollCreateVisible(false);
    setTaskPickerVisible(false);
    setStickerPickerVisible(true);
    setStickerPickerLoading(true);
    try {
      const [packs, recent] = await Promise.all([
        chatApi.getStickerPacks(),
        userId ? getRecentStickerIds(userId) : Promise.resolve([]),
      ]);
      if (mountedRef.current) {
        setStickerPacks(packs);
        setRecentStickerIds(recent);
      }
    } catch (cause) {
      if (mountedRef.current) showNativeToast('Не удалось загрузить стикеры', formatApiError(cause, 'Повторите попытку'));
    } finally {
      if (mountedRef.current) setStickerPickerLoading(false);
    }
  }, [composer, mountedRef, userId]);

  const importStickerPack = useCallback(async (source: string) => {
    setStickerImporting(true);
    try {
      const packs = await chatApi.importStickerPack(source);
      if (mountedRef.current) setStickerPacks(packs);
    } catch (cause) {
      if (mountedRef.current) showNativeToast('Не удалось добавить набор', formatApiError(cause, 'Проверьте ссылку и повторите'));
    } finally {
      if (mountedRef.current) setStickerImporting(false);
    }
  }, [mountedRef]);

  const removeStickerPack = useCallback((pack: ChatStickerPack) => {
    Alert.alert(
      'Удалить набор?',
      `Набор «${pack.title}» будет убран из вашего списка.`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => {
            void chatApi.removeStickerPack(pack.id)
              .then(() => chatApi.getStickerPacks())
              .then((packs) => {
                if (mountedRef.current) setStickerPacks(packs);
              })
              .catch((cause) => {
                if (mountedRef.current) {
                  Alert.alert('Не удалось удалить набор', formatApiError(cause, 'Повторите попытку'));
                }
              });
          },
        },
      ],
    );
  }, [mountedRef]);

  const sendSticker = useCallback(async (sticker: ChatSticker) => {
    if (!isCurrentSendScope() || composerBusyRef.current) return;
    setStickerPickerVisible(false);
    setComposerBusy(true);
    if (userId) {
      void rememberRecentSticker(userId, sticker.id).then((recent) => {
        if (isCurrentSendScope()) setRecentStickerIds(recent);
      }).catch(() => undefined);
    }
    try {
      const queued = await queueSpecialMessage(
        {
          kind: 'file',
          body: '',
          body_text: '',
          body_format: 'plain',
          attachments: [{
            id: `pending-sticker:${sticker.id}`,
            kind: 'sticker',
            media_kind: 'sticker',
            file_name: sticker.emoji || 'sticker.webp',
            mime_type: sticker.mime_type || null,
            file_size: sticker.file_size,
            original_url: sticker.file_url || null,
            preview_url: sticker.preview_url || undefined,
            url: sticker.file_url || undefined,
          }],
        },
        { type: 'sticker', sticker_id: sticker.id },
        'Не удалось отправить стикер',
      );
      if (!queued) return;
      setComposerMode(null);
    } finally {
      if (isCurrentSendScope()) setComposerBusy(false);
    }
  }, [composerBusyRef, isCurrentSendScope, queueSpecialMessage, setComposerBusy, setComposerMode, userId]);

  return {
    infoVisible,
    setInfoVisible,
    profileMember,
    setProfileMember,
    conversationBusy,
    renameVisible,
    setRenameVisible,
    memberPickerVisible,
    setMemberPickerVisible,
    chatUsers,
    setChatUsers,
    taskPickerVisible,
    setTaskPickerVisible,
    shareableTasks,
    taskPickerLoading,
    stickerPickerVisible,
    setStickerPickerVisible,
    stickerPacks,
    stickerPickerLoading,
    stickerImporting,
    recentStickerIds,
    emojiPickerVisible,
    setEmojiPickerVisible,
    pollCreateVisible,
    setPollCreateVisible,
    openConversationInfo,
    updateConversationSetting,
    renameGroup,
    resetAiContext,
    deleteAiConversation,
    openMemberPicker,
    addMembers,
    updateMember,
    openPersonProfile,
    openMemberActions,
    requestLeaveGroup,
    openTask,
    loadShareableTasks,
    openTaskPicker,
    shareTask,
    openStickerPicker,
    importStickerPack,
    removeStickerPack,
    sendSticker,
  };
}
