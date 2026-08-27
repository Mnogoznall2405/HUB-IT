import type { ChatConversationSummary, ChatMessage } from '../api/types';
import {
  normalizeChatConversation,
  normalizeChatMessage,
  normalizeChatReactions,
} from './chatModels';

function timestamp(value: string | null | undefined): number {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Room broadcasts force `is_own: false` for peers. If the sender also
 * receives that event, trusting the flag flips their bubble to the incoming
 * side. Sender id vs current user is the source of truth.
 */
export function resolveChatMessageIsOwn(
  message: Pick<ChatMessage, 'is_own' | 'sender_user_id' | 'sender'>,
  currentUserId?: number | string | null,
): boolean | undefined {
  const senderId = Number(message.sender_user_id || message.sender?.id || 0);
  const viewerId = Number(currentUserId || 0);
  if (senderId > 0 && viewerId > 0) {
    return senderId === viewerId;
  }
  if (typeof message.is_own === 'boolean') return message.is_own;
  return undefined;
}

export function findLatestIncomingMessage(
  messages: ChatMessage[],
  currentUserId?: number | string | null,
): ChatMessage | null {
  return (Array.isArray(messages) ? messages : []).find((message) => (
    !message.local_status && resolveChatMessageIsOwn(message, currentUserId) !== true
  )) || null;
}

function canGroupMessages(left?: ChatMessage, right?: ChatMessage): boolean {
  if (!left || !right || left.is_deleted || right.is_deleted) return false;
  if (left.kind === 'system' || right.kind === 'system') return false;
  if (left.sender_user_id !== right.sender_user_id) return false;
  return Math.abs(timestamp(left.created_at) - timestamp(right.created_at)) <= 5 * 60 * 1000;
}

export function getMessageGroupPosition(
  messages: ChatMessage[],
  index: number,
): 'single' | 'first' | 'middle' | 'last' {
  const message = messages[index];
  if (!message) return 'single';
  // The native thread array is newest-first because FlatList is inverted.
  const connectsToNewer = canGroupMessages(message, messages[index - 1]);
  const connectsToOlder = canGroupMessages(message, messages[index + 1]);
  if (connectsToOlder && connectsToNewer) return 'middle';
  if (!connectsToOlder && connectsToNewer) return 'first';
  if (connectsToOlder && !connectsToNewer) return 'last';
  return 'single';
}

export function shouldShowMessageDateSeparator(messages: ChatMessage[], index: number): boolean {
  const message = messages[index];
  if (!message?.created_at) return false;
  const olderMessage = messages[index + 1];
  if (!olderMessage?.created_at) return true;
  return new Date(message.created_at).toDateString() !== new Date(olderMessage.created_at).toDateString();
}

export function formatChatThreadDate(value?: string | null): string {
  const date = new Date(value || 0);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Сегодня';
  if (date.toDateString() === yesterday.toDateString()) return 'Вчера';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export type ChatThreadRowDecoration = {
  showDate: boolean;
  dateLabel: string;
  groupPosition: ReturnType<typeof getMessageGroupPosition>;
  unreadBoundary: boolean;
};

export function buildChatThreadRowDecorations(
  messages: ChatMessage[],
  unreadBoundaryId?: string | null,
): ChatThreadRowDecoration[] {
  const boundaryId = String(unreadBoundaryId || '').trim();
  return messages.map((item, index) => ({
    showDate: shouldShowMessageDateSeparator(messages, index),
    dateLabel: formatChatThreadDate(item.created_at),
    groupPosition: getMessageGroupPosition(messages, index),
    unreadBoundary: Boolean(boundaryId && item.id === boundaryId),
  }));
}

export function getUnreadBoundaryMessageId(
  messages: ChatMessage[],
  viewerLastReadMessageId?: string | null,
): string | null {
  const lastReadId = String(viewerLastReadMessageId || '').trim();
  if (!lastReadId) return null;
  const lastReadIndex = messages.findIndex((message) => message.id === lastReadId);
  if (lastReadIndex <= 0) return null;
  return messages[lastReadIndex - 1]?.id || null;
}

export function mergeMessages(
  current: ChatMessage[],
  incoming: ChatMessage | ChatMessage[],
  currentUserId?: number,
): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  [...current, ...(Array.isArray(incoming) ? incoming : [incoming])].forEach((message) => {
    const id = String(message?.id || '').trim();
    if (!id) return;
    byId.set(id, {
      ...byId.get(id),
      ...message,
      is_own: resolveChatMessageIsOwn(message, currentUserId),
    });
  });
  const authoritativeClientIds = new Set(
    [...byId.values()]
      .filter((message) => !String(message.id).startsWith('pending:'))
      .map((message) => String(message.client_message_id || '').trim())
      .filter(Boolean),
  );
  [...byId.entries()].forEach(([id, message]) => {
    const clientMessageId = String(message.client_message_id || '').trim();
    if (id.startsWith('pending:') && clientMessageId && authoritativeClientIds.has(clientMessageId)) {
      byId.delete(id);
    }
  });
  return [...byId.values()].sort((a, b) => {
    const leftLocal = Boolean(a.local_status);
    const rightLocal = Boolean(b.local_status);
    if (leftLocal !== rightLocal) return leftLocal ? -1 : 1;
    const leftSeq = Number(a.conversation_seq || 0);
    const rightSeq = Number(b.conversation_seq || 0);
    if (leftSeq > 0 && rightSeq > 0 && leftSeq !== rightSeq) return rightSeq - leftSeq;
    const byTime = timestamp(b.created_at) - timestamp(a.created_at);
    return byTime || String(b.id).localeCompare(String(a.id));
  });
}

export function messageFromEnvelope(envelope: unknown): ChatMessage | null {
  const payload = (envelope as { payload?: Record<string, unknown> })?.payload;
  if (!payload) return null;
  const candidate = payload.message || payload;
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    const withConversation = {
      ...(candidate as Record<string, unknown>),
      conversation_id: (candidate as Record<string, unknown>).conversation_id || payload.conversation_id,
    };
    return normalizeChatMessage(withConversation);
  }
  return null;
}

export function applyReactionEnvelope(
  current: ChatMessage[],
  envelope: unknown,
): { items: ChatMessage[]; handled: boolean } {
  const payload = (envelope as { payload?: Record<string, unknown> })?.payload || {};
  const messageId = String(payload.message_id || '').trim();
  const conversationId = String(payload.conversation_id || '').trim();
  if (!messageId || !Array.isArray(payload.reactions)) {
    return { items: current, handled: false };
  }
  let handled = false;
  const items = current.map((message) => {
    if (message.id !== messageId || (conversationId && message.conversation_id !== conversationId)) {
      return message;
    }
    handled = true;
    return { ...message, reactions: normalizeChatReactions(payload.reactions) };
  });
  return { items, handled };
}

export function toggleReactionOptimistic(
  reactions: ChatMessage['reactions'],
  emoji: string,
  currentUserId?: number,
): NonNullable<ChatMessage['reactions']> {
  const current = [...(reactions || [])];
  const index = current.findIndex((reaction) => reaction.emoji === emoji);
  if (index < 0) {
    return [...current, {
      emoji,
      count: 1,
      user_ids: currentUserId ? [currentUserId] : undefined,
      reacted_by_me: true,
    }];
  }

  const reaction = current[index];
  if (reaction.reacted_by_me) {
    const nextCount = Math.max(0, reaction.count - 1);
    if (nextCount === 0) return current.filter((_, itemIndex) => itemIndex !== index);
    current[index] = {
      ...reaction,
      count: nextCount,
      user_ids: reaction.user_ids?.filter((id) => id !== currentUserId),
      reacted_by_me: false,
    };
    return current;
  }

  current[index] = {
    ...reaction,
    count: reaction.count + 1,
    user_ids: currentUserId && !reaction.user_ids?.includes(currentUserId)
      ? [...(reaction.user_ids || []), currentUserId]
      : reaction.user_ids,
    reacted_by_me: true,
  };
  return current;
}

export function clearConversationUnread(
  current: ChatConversationSummary[],
  conversationId?: string | null,
): ChatConversationSummary[] {
  const id = String(conversationId || '').trim();
  if (!id || !Array.isArray(current) || !current.length) return current;
  let changed = false;
  const items = current.map((item) => {
    if (String(item.id) !== id || !Number(item.unread_count || 0)) return item;
    changed = true;
    return { ...item, unread_count: 0 };
  });
  return changed ? items : current;
}

export function applyConversationEnvelope(
  current: ChatConversationSummary[],
  envelope: unknown,
  currentUserId?: number | string | null,
  activeConversationId?: string | null,
): { items: ChatConversationSummary[]; handled: boolean } {
  const payload = (envelope as { payload?: Record<string, unknown> })?.payload || {};
  const conversation = normalizeChatConversation(payload.conversation || payload.item);
  const message = normalizeChatMessage(payload.message || payload);
  const conversationId = String(
    conversation?.id || payload.conversation_id || message?.conversation_id || '',
  ).trim();
  if (!conversationId) return { items: current, handled: false };

  const index = current.findIndex((item) => String(item.id) === conversationId);
  if (index < 0 && !conversation?.id) return { items: current, handled: false };

  const previous = index >= 0 ? current[index] : ({ id: conversationId } as ChatConversationSummary);
  const next: ChatConversationSummary = {
    ...previous,
    ...(conversation || {}),
  };
  const isActiveConversation = String(activeConversationId || '').trim() === conversationId;
  if (message) {
    const previousSeq = Number(previous.last_message_seq || 0);
    const incomingSeq = Number(message.conversation_seq || 0);
    const previousTime = timestamp(previous.last_message_at);
    const incomingTime = timestamp(message.created_at);
    const advancesConversation = incomingSeq > 0
      ? incomingSeq > previousSeq
      : incomingTime > previousTime;
    const updatesCurrentPreview = advancesConversation || (incomingSeq > 0 && incomingSeq === previousSeq);
    if (updatesCurrentPreview) {
      next.last_message_preview = message.body_text
        || (message.attachments?.length ? 'Вложение' : 'Новое сообщение');
      next.last_message_at = message.created_at || next.last_message_at;
      next.last_message_seq = Math.max(previousSeq, incomingSeq);
    }
    const isOwn = resolveChatMessageIsOwn(message, currentUserId) === true;
    if (isActiveConversation) {
      next.unread_count = 0;
    } else if (advancesConversation && !isOwn) {
      next.unread_count = Number(previous.unread_count || 0) + 1;
    }
  } else if (isActiveConversation) {
    next.unread_count = 0;
  }

  const items = index >= 0
    ? current.map((item, itemIndex) => (itemIndex === index ? next : item))
    : [next, ...current];
  items.sort((a, b) => timestamp(b.last_message_at) - timestamp(a.last_message_at));
  return { items, handled: true };
}
