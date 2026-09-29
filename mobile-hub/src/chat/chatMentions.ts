import type { ChatMessage } from '../api/types';

export function findUnreadMentionMessageId(
  messages: ChatMessage[],
  myId: number,
  lastReadSeq: number,
): string | null {
  const viewerId = Number(myId) || 0;
  if (viewerId <= 0) return null;
  const lastRead = Number(lastReadSeq) || 0;
  // `messages` is newest-first: walk towards older and keep the last match —
  // the oldest unread mention. Once seq drops to/below lastRead everything
  // older is read too.
  let found: string | null = null;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const seq = Number(message.conversation_seq || 0);
    if (seq && seq <= lastRead) break;
    if (message.is_deleted || message.local_status) continue;
    if (Number(message.sender_user_id || 0) === viewerId) continue;
    if ((message.mentioned_user_ids || []).includes(viewerId)) found = message.id;
  }
  return found;
}
