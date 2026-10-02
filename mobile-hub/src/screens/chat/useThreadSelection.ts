import { useCallback, useEffect, useMemo, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as chatApi from '../../api/chatApi';
import type { ChatMessage } from '../../api/types';
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

  // Window replacements (search/mention jumps, jump-to-bottom, conversation
  // switch) and remote deletes can leave selected ids pointing at rows that
  // no longer exist or are not selectable anymore; prune them so the header
  // count only covers what the reader can still see and act on.
  useEffect(() => {
    setSelectedMessageIds((current) => {
      if (!current.length) return current;
      const next = current.filter((id) => messages.some(
        (message) => message.id === id && canSelectChatMessage(message),
      ));
      return next.length === current.length ? current : next;
    });
  }, [messages]);

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
    }).catch(() => {
      if (mountedRef.current) showNativeToast('Не удалось скопировать', 'Повторите попытку.');
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
            // allSettled: a single failed delete must not hide the ones the
            // server already removed — merge successes, report only failures.
            void Promise.allSettled(deletable.map((message) => chatApi.deleteMessage(conversationId, message.id)))
              .then((results) => {
                if (!mountedRef.current) return;
                const deleted = results
                  .filter((result): result is PromiseFulfilledResult<ChatMessage> => result.status === 'fulfilled')
                  .map((result) => result.value);
                if (deleted.length) {
                  setMessages((current) => mergeMessages(current, deleted, userId));
                }
                const failed = results.length - deleted.length;
                if (failed) {
                  showNativeToast('Не все сообщения удалены', `Не удалось удалить: ${failed}. Повторите попытку.`);
                } else {
                  clearSelection();
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
