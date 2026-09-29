import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import * as chatApi from '../../api/chatApi';
import type { ChatConversationSummary, ChatMessage } from '../../api/types';
import { formatApiError } from '../../api/formatError';
import { showNativeToast } from '../../components/nativeToast';
import { mergeMessages } from '../../chat/chatState';
import type { ChatListAnchorReason } from '../../chat/chatListAnchor';

/** Forward-to-conversation queue: picker state, sequential sends, progress. */
export function useThreadForward({
  conversationId,
  sendScope,
  isCurrentSendScope,
  userId,
  requestBottomAnchor,
  setMessages,
  setSelectedMessageIds,
}: {
  conversationId: string;
  sendScope: symbol;
  isCurrentSendScope: () => boolean;
  userId?: number;
  requestBottomAnchor: (reason?: ChatListAnchorReason) => void;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setSelectedMessageIds: Dispatch<SetStateAction<string[]>>;
}) {
  const [forwardSource, setForwardSource] = useState<ChatMessage | null>(null);
  const [forwardQueue, setForwardQueue] = useState<ChatMessage[]>([]);
  const [forwardConversations, setForwardConversations] = useState<ChatConversationSummary[]>([]);
  const [forwarding, setForwarding] = useState(false);
  const forwardInFlightRef = useRef(false);
  const [forwardProgress, setForwardProgress] = useState<{ target: ChatConversationSummary; completed: number; total: number } | null>(null);
  const [forwardError, setForwardError] = useState('');
  useEffect(() => {
    setForwardSource(null);
    setForwardQueue([]);
    setForwardProgress(null);
    setForwardError('');
  }, [sendScope]);

  const openForward = useCallback(async (message: ChatMessage | ChatMessage[]) => {
    if (!isCurrentSendScope() || forwardInFlightRef.current) return;
    try {
      const conversations = await chatApi.getConversations();
      if (!isCurrentSendScope()) return;
      setForwardConversations(conversations);
      setForwardProgress(null);
      setForwardError('');
      const queue = Array.isArray(message) ? message : [message];
      setForwardSource(queue[0] || null);
      setForwardQueue(queue);
    } catch (cause) {
      if (isCurrentSendScope()) {
        showNativeToast('Не удалось загрузить диалоги', formatApiError(cause, 'Повторите попытку'));
      }
    }
  }, [isCurrentSendScope]);

  const forwardToConversation = useCallback(async (target: ChatConversationSummary) => {
    const queue = forwardQueue.length ? forwardQueue : (forwardSource ? [forwardSource] : []);
    if (!isCurrentSendScope() || !queue.length || forwardInFlightRef.current || forwarding) return;
    if (forwardProgress && forwardProgress.target.id !== target.id) return;
    forwardInFlightRef.current = true;
    setForwarding(true);
    setForwardError('');
    const completedBefore = forwardProgress?.completed || 0;
    const total = forwardProgress?.total || queue.length;
    let completed = 0;
    try {
      for (const item of queue) {
        const forwarded = await chatApi.forwardMessage(target.id, item.id);
        if (!isCurrentSendScope()) return;
        completed += 1;
        // Commit each ACK before starting the next request; never replay these items.
        setForwardQueue(queue.slice(completed));
        setForwardProgress({ target, completed: completedBefore + completed, total });
        setSelectedMessageIds((current) => current.filter((id) => id !== item.id));
        if (target.id === conversationId) {
          requestBottomAnchor('own-send');
          setMessages((current) => mergeMessages(current, forwarded, userId));
        }
      }
      setForwardSource(null);
      setForwardQueue([]);
      setForwardProgress(null);
      setSelectedMessageIds([]);
      showNativeToast(
        total > 1 ? 'Сообщения пересланы' : 'Сообщение переслано',
        `Диалог: ${target.title || 'Без названия'}`,
      );
    } catch {
      if (isCurrentSendScope()) {
        setForwardQueue(queue.slice(completed));
        setForwardSource(queue[completed] || null);
        setForwardProgress({ target, completed: completedBefore + completed, total });
        setForwardError('Не получено подтверждение следующего сообщения. Проверьте диалог перед повтором: оно могло быть доставлено. Уже подтверждённые сообщения повторно не отправятся.');
      }
    } finally {
      if (isCurrentSendScope()) {
        forwardInFlightRef.current = false;
        setForwarding(false);
      }
    }
  }, [isCurrentSendScope, conversationId, forwardQueue, forwardSource, forwardProgress, forwarding,
    requestBottomAnchor, setMessages, setSelectedMessageIds, userId]);

  return {
    forwardSource,
    forwardQueue,
    forwardConversations,
    forwarding,
    forwardProgress,
    forwardError,
    forwardInFlightRef,
    openForward,
    forwardToConversation,
    setForwardSource,
    setForwardQueue,
    setForwardProgress,
    setForwardError,
  };
}
