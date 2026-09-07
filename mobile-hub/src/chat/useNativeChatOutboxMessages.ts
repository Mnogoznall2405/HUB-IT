import { useEffect, type Dispatch, type SetStateAction, type MutableRefObject } from 'react';
import type { ChatMessage } from '../api/types';
import type { ChatAttachmentTransfer } from '../components/chat/ChatDocumentAttachment';
import {
  createNativeChatOutbox, subscribeNativeChatOutbox, subscribeNativeChatDelivery,
  getNativeChatQueueState, type NativeChatQueuedUpload,
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
) {
  useEffect(() => {
    let active = true;
    let revision = 0;
    let previousIds = new Set<string>();
    let transferIds = new Set<string>();
    const reload = async () => {
      const request = ++revision;
      try {
        const [queued, files] = await Promise.all([outbox.read(), outbox.readUploads()]);
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
                  progress: next[attachment.id]?.progress ?? null, cancellable: true };
              } else delete next[attachment.id];
            });
          });
          return next;
        });
      } catch { /* Keep visible messages and files on a transient storage read failure. */ }
    };
    const offQueue = subscribeNativeChatOutbox(() => { void reload(); });
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
    return () => { active = false; revision += 1; offQueue(); offDelivery(); };
  }, [outbox, userId, conversationId, setMessages, uploads, setTransfers]);
}
