import type { ChatConversationKind, ChatMessage } from '../api/types';

export function canSelectChatMessage(message?: ChatMessage | null): boolean {
  if (!message?.id || message.is_deleted || message.local_status) return false;
  return String(message.kind || 'text').trim() !== 'system';
}

export function canDeleteChatMessage(
  message?: ChatMessage | null,
  options: {
    conversationKind?: ChatConversationKind | string | null;
    currentUserId?: number;
  } = {},
): boolean {
  if (!message?.id || message.is_deleted || message.local_status) return false;
  if (String(message.kind || '').trim() === 'system') return false;
  const isOwn = Boolean(
    message.is_own
    ?? (options.currentUserId != null && message.sender_user_id === options.currentUserId),
  );
  if (isOwn) return true;
  return String(options.conversationKind || '').trim() === 'group';
}

export function toggleSelectedMessageId(ids: string[], messageId: string): string[] {
  const normalizedId = String(messageId || '').trim();
  if (!normalizedId) return ids;
  return ids.includes(normalizedId)
    ? ids.filter((id) => id !== normalizedId)
    : [...ids, normalizedId];
}

export function startMessageSelection(messageId: string): string[] {
  const normalizedId = String(messageId || '').trim();
  return normalizedId ? [normalizedId] : [];
}

export function selectedMessagesFromIds(messages: ChatMessage[], ids: string[]): ChatMessage[] {
  const order = new Map(ids.map((id, index) => [id, index]));
  return messages
    .filter((message) => order.has(message.id))
    .sort((left, right) => Number(order.get(left.id)) - Number(order.get(right.id)));
}

export function getSelectedMessagesCopyText(messages: ChatMessage[]): string {
  return messages
    .map((message) => {
      if (message.is_deleted) return '';
      if (message.kind === 'task_share') return message.task_preview?.title || 'Задача';
      const body = String(message.body_text || '').trim();
      if (body) return body;
      const fileName = message.attachments?.[0]?.file_name;
      return fileName ? `Файл: ${fileName}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

export function canReplyToSelectedMessages(messages: ChatMessage[]): boolean {
  return messages.length === 1 && canSelectChatMessage(messages[0]);
}

export function canDeleteSelectedMessages(
  messages: ChatMessage[],
  options: {
    conversationKind?: ChatConversationKind | string | null;
    currentUserId?: number;
  } = {},
): boolean {
  return messages.length > 0 && messages.every((message) => canDeleteChatMessage(message, options));
}
