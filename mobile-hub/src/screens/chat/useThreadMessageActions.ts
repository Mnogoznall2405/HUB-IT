import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import * as Clipboard from 'expo-clipboard';
import * as chatApi from '../../api/chatApi';
import type { ChatMessage } from '../../api/types';
import { HUB_WEB_ORIGIN } from '../../api/config';
import { formatApiError } from '../../api/formatError';
import { setPinnedChatMessageId } from '../../chat/chatPinnedMessages';
import { showNativeToast } from '../../components/nativeToast';

/** Per-message actions: copy/link/report, read receipts, pin/unpin, AI card actions. */
export function useThreadMessageActions({
  conversationId,
  userId,
  mountedRef,
  pinnedMessageId,
  setPinnedMessageId,
  serverPinKnownRef,
  setMessages,
  loadInitial,
}: {
  conversationId: string;
  userId?: number;
  mountedRef: MutableRefObject<boolean>;
  pinnedMessageId: string | null;
  setPinnedMessageId: Dispatch<SetStateAction<string | null>>;
  serverPinKnownRef: MutableRefObject<boolean>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  loadInitial: () => Promise<void>;
}) {
  const copyMessageText = useCallback((message: ChatMessage) => {
    void Clipboard.setStringAsync(message.body_text || '').then(() => {
      if (mountedRef.current) showNativeToast('Скопировано', 'Текст сообщения скопирован.');
    });
  }, [mountedRef]);

  const copyMessageLink = useCallback((message: ChatMessage) => {
    const link = `${HUB_WEB_ORIGIN}/chat?conversation=${encodeURIComponent(conversationId)}&message=${encodeURIComponent(message.id)}`;
    void Clipboard.setStringAsync(link).then(() => {
      if (mountedRef.current) showNativeToast('Ссылка скопирована', 'Можно отправить её другому участнику HUB-IT.');
    });
  }, [conversationId, mountedRef]);

  const prepareReport = useCallback((message: ChatMessage) => {
    const payload = [
      `Диалог: ${conversationId}`,
      `Сообщение: ${message.id}`,
      `Автор: ${message.sender?.full_name || message.sender?.username || message.sender_user_id}`,
      `Текст: ${message.body_text || '(без текста)'}`,
    ].join('\n');
    void Clipboard.setStringAsync(payload).then(() => {
      if (mountedRef.current) showNativeToast('Данные жалобы скопированы', 'Передайте их администратору HUB-IT.');
    });
  }, [conversationId, mountedRef]);

  const showMessageReads = useCallback(async (message: ChatMessage) => {
    try {
      const reads = await chatApi.getMessageReads(message.id);
      if (!mountedRef.current) return;
      showNativeToast(
        'Кто прочитал',
        reads.length
          ? reads.map((item) => `${item.user.full_name || item.user.username} · ${new Date(item.read_at).toLocaleString('ru-RU')}`).join('\n')
          : 'Пока никто не прочитал сообщение.',
      );
    } catch (cause) {
      if (mountedRef.current) showNativeToast('Не удалось загрузить прочтения', formatApiError(cause, 'Повторите попытку'));
    }
  }, [mountedRef]);

  const togglePinnedMessage = useCallback((message: ChatMessage) => {
    const owner = Number(userId || 0);
    if (!owner) return;
    const next = pinnedMessageId === message.id ? null : message.id;
    setPinnedMessageId(next);
    void setPinnedChatMessageId(owner, conversationId, next);
    void chatApi.setPinnedMessage(conversationId, next).then((updated) => {
      if (!mountedRef.current || updated.pinned_message_id === undefined) return;
      serverPinKnownRef.current = true;
      setPinnedMessageId(updated.pinned_message_id);
      void setPinnedChatMessageId(owner, conversationId, updated.pinned_message_id);
    }).catch(() => undefined);
  }, [conversationId, mountedRef, pinnedMessageId, serverPinKnownRef, setPinnedMessageId, userId]);

  const unpinMessage = useCallback(() => {
    const owner = Number(userId || 0);
    const previous = pinnedMessageId;
    if (!owner || !previous) return;
    setPinnedMessageId(null);
    void setPinnedChatMessageId(owner, conversationId, null);
    void chatApi.setPinnedMessage(conversationId, null).then((updated) => {
      if (!mountedRef.current) return;
      serverPinKnownRef.current = true;
      const next = updated.pinned_message_id || null;
      setPinnedMessageId(next);
      void setPinnedChatMessageId(owner, conversationId, next);
    }).catch(() => {
      if (!mountedRef.current) return;
      setPinnedMessageId(previous);
      void setPinnedChatMessageId(owner, conversationId, previous);
    });
  }, [conversationId, mountedRef, pinnedMessageId, serverPinKnownRef, setPinnedMessageId, userId]);

  const runAiAction = useCallback(async (actionId: string, action: 'confirm' | 'cancel') => {
    setMessages((current) => current.map((message) => {
      const card = message.action_card as { id?: string } | null | undefined;
      return card?.id === actionId
        ? {
          ...message,
          action_card: {
            ...message.action_card,
            status: action === 'confirm' ? 'executing' : 'cancelled',
          },
        }
        : message;
    }));
    try {
      if (action === 'confirm') await chatApi.confirmAiAction(actionId);
      else await chatApi.cancelAiAction(actionId);
    } catch (cause) {
      if (mountedRef.current) {
        showNativeToast('Не удалось выполнить действие AI', formatApiError(cause, 'Повторите попытку'));
        void loadInitial();
      }
    }
  }, [loadInitial, mountedRef, setMessages]);

  return {
    copyMessageText,
    copyMessageLink,
    prepareReport,
    showMessageReads,
    togglePinnedMessage,
    unpinMessage,
    runAiAction,
  };
}
