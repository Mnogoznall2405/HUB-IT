import { useEffect, useRef, type Dispatch, type SetStateAction, type MutableRefObject } from 'react';
import { Alert } from 'react-native';
import type { ChatMessage } from '../api/types';
import type { ChatAttachmentTransfer } from '../components/chat/ChatDocumentAttachment';
import {
  createNativeChatOutbox, subscribeNativeChatOutbox, subscribeNativeChatDelivery,
  getNativeChatQueueState, readNativeChatOutbox, type NativeChatQueuedUpload,
} from './nativeChatOutbox';
import { mergeMessages } from './chatState';

/** Queue updates/ACKs remain visible when delivery is owned by the shell. */
export function useNativeChatOutboxMessages(
  outbox: ReturnType<typeof createNativeChatOutbox>,
  userId: number,
  conversationId: string,
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  uploads: MutableRefObject<Map<string, NativeChatQueuedUpload>>,
  setTransfers: Dispatch<SetStateAction<Record<string, ChatAttachmentTransfer>>>,
  canRecoverReply: boolean,
) {
  const promptedReplies = useRef(new Set<string>());
  useEffect(() => {
    let active = true;
    let revision = 0;
    let previousIds = new Set<string>();
    let transferIds = new Set<string>();
    const reload = async () => {
      const request = ++revision;
      try {
        const [queued, files, rows] = await Promise.all([outbox.read(), outbox.readUploads(), readNativeChatOutbox(userId)]);
        if (!active || request !== revision) return;
        const ids = new Set(queued.map((message) => message.client_message_id || ''));
        const removedIds = new Set([...previousIds].filter((id) => !ids.has(id)));
        previousIds = ids;
        files.forEach(({ id, upload }) => uploads.current.set(id, upload));
        removedIds.forEach((id) => uploads.current.delete(id));
        if (queued.length || removedIds.size) setMessages((current) => mergeMessages(current.filter((message) => (
          !message.local_status || !removedIds.has(message.client_message_id || '')
        )), queued, userId));
        const previousTransfers = transferIds;
        transferIds = new Set(queued.flatMap((message) => message.local_status
          ? (message.attachments || []).map((attachment) => attachment.id) : []));
        setTransfers((current) => {
          const next = { ...current };
          previousTransfers.forEach((id) => { if (!transferIds.has(id)) delete next[id]; });
          queued.forEach((message) => {
            if (!getNativeChatQueueState(message)) return;
            (message.attachments || []).forEach((attachment) => {
              if (message.local_status === 'sending') {
                next[attachment.id] = { action: 'upload', status: 'active',
                  progress: next[attachment.id]?.progress ?? 0, cancellable: true };
              } else if (['paused', 'cancelled'].includes(getNativeChatQueueState(message) || '')) {
                next[attachment.id] = { action: 'upload', progress: 0, cancellable: false,
                  status: getNativeChatQueueState(message) === 'cancelled' ? 'cancelled' : 'failed' };
              } else delete next[attachment.id];
            });
          });
          return next;
        });
        if (canRecoverReply) rows.forEach((row) => {
          const id = row.message.client_message_id!;
          const key = JSON.stringify([userId, conversationId, id]);
          if (row.message.conversation_id !== conversationId || row.busy
            || !row.delivery?.replyMissing || promptedReplies.current.has(key)) return;
          promptedReplies.current.add(key);
          const current = () => active && canRecoverReply;
          Alert.alert('Исходное сообщение недоступно',
            'Ответ сохранён в очереди. Проверьте переписку: прежняя отправка могла пройти без подтверждения. Можно отправить заново без цитаты.', [
              { text: 'Оставить в очереди', style: 'cancel' },
              { text: 'Отправить без цитаты', onPress: () => {
                if (!current()) return;
                const replacement = `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
                void outbox.detachReply(id, replacement, current).then(async () => {
                  if (current()) await outbox.retryDelivery(replacement, current);
                }).catch(() => {
                  if (current()) Alert.alert('Не удалось изменить ответ', 'Проверьте очередь перед повтором.');
                });
              } },
            ]);
        });
      } catch { /* Keep visible messages and files on a transient storage read failure. */ }
    };
    let debounce: ReturnType<typeof setTimeout> | null = null;
    // Each send produces several storage notifies; a reload reads the full
    // queue, so coalescing bursts into one read is lossless.
    const offQueue = subscribeNativeChatOutbox(() => {
      if (debounce) return;
      debounce = setTimeout(() => {
        debounce = null;
        void reload();
      }, 60);
    });
    const offDelivery = subscribeNativeChatDelivery((event) => {
      if (!active || event.userId !== userId || event.message.conversation_id !== conversationId) return;
      if (event.loaded === undefined) setMessages((current) => mergeMessages(current, event.message, userId));
      if (event.loaded !== undefined) {
        setTransfers((current) => {
          const next = { ...current };
          (event.message.attachments || []).forEach((attachment) => {
            next[attachment.id] = { action: 'upload', status: 'active', cancellable: true,
              progress: event.total && event.total > 0 ? Math.min(1, Math.max(0, event.loaded! / event.total)) : null };
          });
          return next;
        });
      }
    });
    void reload();
    return () => {
      active = false;
      revision += 1;
      if (debounce) clearTimeout(debounce);
      offQueue();
      offDelivery();
    };
  }, [outbox, userId, conversationId, setMessages, uploads, setTransfers, canRecoverReply]);
}
