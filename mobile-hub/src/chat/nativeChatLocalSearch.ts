import type { ChatConversationSummary, ChatMember, ChatMessage, ChatUserSummary } from '../api/types';

export function normalizeNativeChatSearchText(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('ru-RU');
}

function participantHaystack(participants: Array<ChatMember | ChatUserSummary> | undefined): string {
  return (participants || [])
    .map((participant) => {
      if (participant && typeof participant === 'object' && 'user' in participant) {
        const user = (participant as ChatMember).user;
        return [user?.full_name, user?.username].filter(Boolean).join(' ');
      }
      const user = participant as ChatUserSummary;
      return [user?.full_name, user?.username].filter(Boolean).join(' ');
    })
    .join(' ');
}

export function conversationMatchesLocalQuery(
  conversation: ChatConversationSummary,
  query: string,
): boolean {
  const normalizedQuery = normalizeNativeChatSearchText(query);
  if (!normalizedQuery) return true;
  const haystack = normalizeNativeChatSearchText([
    conversation.title,
    conversation.last_message_preview,
    conversation.direct_peer?.full_name,
    conversation.direct_peer?.username,
    participantHaystack(conversation.members),
    participantHaystack(conversation.member_preview),
  ].filter(Boolean).join(' '));
  return haystack.includes(normalizedQuery);
}

export function filterConversationsByLocalQuery(
  conversations: ChatConversationSummary[],
  query: string,
): ChatConversationSummary[] {
  const normalizedQuery = normalizeNativeChatSearchText(query);
  if (!normalizedQuery) return [...conversations];
  return conversations.filter((item) => conversationMatchesLocalQuery(item, normalizedQuery));
}

export function filterMessagesByLocalQuery(
  messages: ChatMessage[],
  query: string,
): ChatMessage[] {
  const normalizedQuery = normalizeNativeChatSearchText(query);
  if (!normalizedQuery) return [];
  return messages.filter((message) => (
    normalizeNativeChatSearchText(message.body_text).includes(normalizedQuery)
  ));
}
