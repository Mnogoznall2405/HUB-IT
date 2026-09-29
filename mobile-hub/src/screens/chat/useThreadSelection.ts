import { useCallback, useMemo, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as chatApi from '../../api/chatApi';
import type { ChatMessage } from '../../api/types';
import { formatApiError } from '../../api/formatError';
import { showNativeToast } from '../../components/nativeToast';
import { mergeMessages } from '../../chat/chatState';
import {
  canDeleteSelectedMessages,
  canSelectChatMessage,
  getSelectedMessagesCopyText,
  selectedMessagesFromIds,
  startMessageSelection,
  toggleSelectedMessageId,
} from '../../chat/chatMessageSelection';
import { hapticSelection } from '../../native/haptics';

/** Multi-select state and its copy/delete actions for the chat thread. */
export function useThreadSelection({
  conversationId,
  conversationKind,
  userId,
  mountedRef,
  messages,
  setActionMessage,
  setMessages,
}: {
  conversationId: string;
  conversationKind?: string;
  userId?: number;
  mountedRef: MutableRefObject<boolean>;
  messages: ChatMessage[];
  setActionMessage: Dispatch<SetStateAction<ChatMessage | null>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
}) {
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);

  const selectedMessages = useMemo(
    () => selectedMessagesFromIds(messages, selectedMessageIds),
    [messages, selectedMessageIds],
  );

  const clearSelection = useCallback(() => setSelectedMessageIds([]), []);

  const startSelection = useCallback((message: ChatMessage) => {
    if (!canSelectChatMessage(message)) return;
    void hapticSelection();
    setActionMessage(null);
    setSelectedMessageIds((current) => (
      current.length ? toggleSelectedMessageId(current, message.id) : startMessageSelection(message.id)
    ));
  }, [setActionMessage]);

  const toggleSelection = useCallback((message: ChatMessage) => {
    if (!canSelectChatMessage(message)) return;
    setSelectedMessageIds((current) => toggleSelectedMessageId(current, message.id));
  }, []);

  const copySelected = useCallback(() => {
    const textValue = getSelectedMessagesCopyText(selectedMessages);
    if (!textValue) {
      showNativeToast('Нечего копировать', 'В выбранных сообщениях нет текста.');
      return;
    }
    void Clipboard.setStringAsync(textValue).then(() => {
      if (mountedRef.current) {
        showNativeToast('Скопировано', 'Текст выбранных сообщений скопирован.');
        clearSelection();
      }
    });
  }, [clearSelection, mountedRef, selectedMessages]);

  const deleteSelected = useCallback(() => {
    const deletable = selectedMessages.filter((message) => canSelectChatMessage(message));
    if (!canDeleteSelectedMessages(deletable, {
      conversationKind,
      currentUserId: userId,
    })) {
      showNativeToast('Нельзя удалить', 'Среди выбранных есть сообщения, которые нельзя удалить.');
      return;
    }
    const confirmLabel = deletable.length === 1
      ? 'Удалить сообщение?'
      : `Удалить ${deletable.length} сообщений?`;
    Alert.alert(
      confirmLabel,
      'Текст и вложения будут скрыты у всех участников диалога.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => {
            void Promise.all(deletable.map((message) => chatApi.deleteMessage(conversationId, message.id)))
              .then((deleted) => {
                if (!mountedRef.current) return;
                setMessages((current) => mergeMessages(current, deleted, userId));
                clearSelection();
              })
              .catch((cause) => {
                if (mountedRef.current) {
                  showNativeToast('Не удалось удалить сообщение', formatApiError(cause, 'Повторите попытку'));
                }
              });
          },
        },
      ],
    );
  }, [clearSelection, conversationId, conversationKind, mountedRef, selectedMessages, setMessages, userId]);

  return {
    selectedMessageIds,
    selectedMessages,
    clearSelection,
    startSelection,
    toggleSelection,
    copySelected,
    deleteSelected,
    setSelectedMessageIds,
  };
}
