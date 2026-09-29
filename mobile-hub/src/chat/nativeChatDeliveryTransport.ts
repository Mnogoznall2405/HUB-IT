import * as chatApi from '../api/chatApi';
import type { ChatMessage } from '../api/types';
import { readNativeEntitySnapshot } from '../cache/nativeSnapshotCache';
import {
  publishNativeChatUploadProgress,
  type NativeChatDeliveryHelpers,
  type NativeChatOutboxEntry,
} from './nativeChatOutbox';
import { deliverNativeChatUpload } from './nativeChatUploadSession';
import {
  scheduleNativeChatThreadSnapshotWrite,
  type NativeChatThreadSnapshot,
} from './nativeChatThreadHistory';

export type NativeChatTransport = (
  entry: NativeChatOutboxEntry,
  signal: AbortSignal,
  helpers: NativeChatDeliveryHelpers,
) => Promise<ChatMessage>;

export function createNativeChatDeliveryTransport(canDeliver: () => boolean): NativeChatTransport {
  return async (entry, signal, helpers) => {
    if (!canDeliver() || signal.aborted) throw Object.assign(new Error('Delivery paused'), { code: 'HUBIT_OFFLINE_READ_ONLY' });
    const id = entry.message.client_message_id!;
    if (entry.upload) {
      // S8-B: chunked resumable delivery; the session id lives on the
      // durable row so a restart reattaches instead of re-uploading.
      return deliverNativeChatUpload(entry, {
        signal, helpers,
        onProgress: (loaded, total) => publishNativeChatUploadProgress(entry, loaded, total),
      });
    }
    // Abort releases the request on suspension; a lost ACK is retried with
    // the same ID because cancellation cannot undo server acceptance.
    return chatApi.sendTextMessage(entry.message.conversation_id, entry.message.body_text || '', {
      clientMessageId: id, replyToMessageId: entry.message.reply_preview?.id,
      kind: ['location', 'contact', 'poll'].includes(String(entry.message.kind || ''))
        ? entry.message.kind as 'location' | 'contact' | 'poll'
        : undefined,
      signal,
    });
  };
}

export function createNativeChatPersistConfirmed(options: {
  ownsSession: () => boolean;
  userId: number;
  historyGeneration: number;
}): (entry: NativeChatOutboxEntry, saved: ChatMessage) => Promise<boolean> {
  const { ownsSession, userId, historyGeneration } = options;
  return async (entry, saved) => {
    if (!ownsSession()) return false;
    const dialog = entry.message.conversation_id;
    const previous = await readNativeEntitySnapshot<NativeChatThreadSnapshot>('chat-thread-details', userId, dialog);
    if (!ownsSession()) return false;
    const snapshot: NativeChatThreadSnapshot = previous?.data || {
      conversation: null, title: entry.title || 'Диалог', messages: [], hasOlder: true,
      olderCursor: null, hasNewer: false, newerCursor: null, unreadBoundaryId: null,
      focusAnchorId: null, pinnedMessageId: null, historyMayHaveGaps: true,
    };
    // Await the scheduled write itself instead of reading the snapshot
    // back: the writer reports whether the durable merge actually landed.
    const persisted = await scheduleNativeChatThreadSnapshotWrite(userId, dialog,
      { ...snapshot, messages: [saved] },
      { generation: historyGeneration, currentUserId: userId });
    return ownsSession() && persisted;
  };
}
