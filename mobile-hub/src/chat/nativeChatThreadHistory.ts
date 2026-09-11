import { mergeMessages } from './chatState';
import type { ChatConversationSummary, ChatMessage } from '../api/types';
import {
  readNativeEntitySnapshot,
  writeNativeEntitySnapshot,
} from '../cache/nativeSnapshotCache';
import { recordDiagnosticEvent } from '../diagnostics/diagnostics';

export const CHAT_THREAD_HISTORY_MAX_MESSAGES = 1500;

export type NativeChatThreadSnapshot = {
  conversation: ChatConversationSummary | null;
  title: string;
  messages: ChatMessage[];
  hasOlder: boolean;
  olderCursor: string | null;
  hasNewer: boolean;
  newerCursor: string | null;
  unreadBoundaryId: string | null;
  focusAnchorId: string | null;
  pinnedMessageId: string | null;
  historyMayHaveGaps?: boolean;
};

type ScheduledThreadWrite = {
  generation: number;
  userId: number;
  conversationId: string;
  snapshot: NativeChatThreadSnapshot;
};

let writeGeneration = 0;
let writeChain: Promise<void> = Promise.resolve();

export function bumpNativeChatThreadHistoryGeneration(): number {
  writeGeneration += 1;
  return writeGeneration;
}

export function getNativeChatThreadHistoryGeneration(): number {
  return writeGeneration;
}

function capThreadHistory(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= CHAT_THREAD_HISTORY_MAX_MESSAGES) return messages;
  // mergeMessages is newest-first (the native list is inverted). Keep the head,
  // otherwise a full cache permanently drops every newly received message.
  return messages.slice(0, CHAT_THREAD_HISTORY_MAX_MESSAGES);
}

/** Merge a display window into the durable history without treating gaps as a continuous full archive. */
export function mergeNativeChatThreadHistory(
  accumulated: ChatMessage[],
  incoming: ChatMessage[],
  currentUserId?: number | null,
): ChatMessage[] {
  return capThreadHistory(mergeMessages(accumulated, incoming, currentUserId ?? undefined));
}

/**
 * Schedule a durable thread snapshot write that survives screen unmount.
 * Ownership lives outside the React effect timer: unmount does not cancel the write.
 */
export function scheduleNativeChatThreadSnapshotWrite(
  userId: number,
  conversationId: string,
  snapshot: NativeChatThreadSnapshot,
  options: { generation?: number; currentUserId?: number | null } = {},
): Promise<void> {
  const owner = Number(userId || 0);
  const key = String(conversationId || '').trim();
  if (!Number.isInteger(owner) || owner <= 0 || !key) return Promise.resolve();
  const generation = options.generation ?? writeGeneration;
  const job: ScheduledThreadWrite = {
    generation,
    userId: owner,
    conversationId: key,
    snapshot: {
      ...snapshot,
      messages: (snapshot.messages || []).filter((message) => !message.local_status),
    },
  };
  const operation = writeChain.then(async () => {
    if (job.generation !== writeGeneration) return;
    const existing = await readNativeEntitySnapshot<NativeChatThreadSnapshot>(
      'chat-thread-details',
      job.userId,
      job.conversationId,
      Number.MAX_SAFE_INTEGER,
    );
    if (job.generation !== writeGeneration) return;
    const mergedMessages = mergeNativeChatThreadHistory(
      existing?.data.messages || [],
      job.snapshot.messages,
      options.currentUserId ?? job.userId,
    );
    const next: NativeChatThreadSnapshot = {
      ...job.snapshot,
      messages: mergedMessages,
      historyMayHaveGaps: Boolean(
        job.snapshot.historyMayHaveGaps
        || existing?.data.historyMayHaveGaps
        || job.snapshot.hasOlder
        || job.snapshot.hasNewer
        || existing?.data.hasOlder
        || existing?.data.hasNewer,
      ),
    };
    await writeNativeEntitySnapshot('chat-thread-details', job.userId, job.conversationId, next);
  }).catch(() => {
    void recordDiagnosticEvent('native_file_error');
  });
  writeChain = operation.then(() => undefined, () => undefined);
  return operation;
}

export function waitForNativeChatThreadSnapshotWrites(): Promise<void> {
  return writeChain;
}
