import type { ChatAiBot, ChatConversationSummary } from '../api/types';

export type ChatWorkspaceKey = 'chats' | 'ai';
export type AiSidebarDateGroup = {
  key: 'today' | 'yesterday' | 'earlier';
  label: string;
  items: ChatConversationSummary[];
};

export function isAiConversation(item?: ChatConversationSummary | null): boolean {
  return String(item?.kind || '').trim() === 'ai';
}

export function resolveAiBotForConversation(
  bots: ChatAiBot[] | undefined,
  conversationId?: string | null,
): ChatAiBot | null {
  const id = String(conversationId || '').trim();
  if (!id) return null;
  const items = Array.isArray(bots) ? bots : [];
  return items.find((bot) => (bot.conversation_ids || []).some((value) => String(value || '').trim() === id))
    || items.find((bot) => String(bot.conversation_id || '').trim() === id)
    || null;
}

export function filterAiConversations(
  conversations: ChatConversationSummary[],
  options: { archived?: boolean; query?: string } = {},
): ChatConversationSummary[] {
  const archived = Boolean(options.archived);
  const query = String(options.query || '').trim().toLocaleLowerCase('ru-RU');
  return (Array.isArray(conversations) ? conversations : []).filter((item) => (
    isAiConversation(item)
    && Boolean(item?.is_archived) === archived
    && (!query || [item?.title, item?.last_message_preview].some((value) => (
      String(value || '').toLocaleLowerCase('ru-RU').includes(query)
    )))
  ));
}

export function countAiUnread(conversations: ChatConversationSummary[]): number {
  return (Array.isArray(conversations) ? conversations : [])
    .filter((item) => isAiConversation(item) && !item?.is_archived)
    .reduce((total, item) => total + Number(item?.unread_count || 0), 0);
}

export function groupAiSidebarRowsByDate(
  rows: ChatConversationSummary[],
  nowValue: Date = new Date(),
): AiSidebarDateGroup[] {
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
  const groups: AiSidebarDateGroup[] = [
    { key: 'today', label: 'Сегодня', items: [] },
    { key: 'yesterday', label: 'Вчера', items: [] },
    { key: 'earlier', label: 'Ранее', items: [] },
  ];
  (Array.isArray(rows) ? rows : []).forEach((item) => {
    const timestamp = Date.parse(String(item?.last_message_at || ''));
    const group = Number.isFinite(timestamp) && timestamp >= todayStart
      ? groups[0]
      : (Number.isFinite(timestamp) && timestamp >= yesterdayStart ? groups[1] : groups[2]);
    group.items.push(item);
  });
  groups.forEach((group) => {
    group.items.sort((left, right) => {
      const pinnedDelta = Number(Boolean(right?.is_pinned)) - Number(Boolean(left?.is_pinned));
      if (pinnedDelta) return pinnedDelta;
      return Date.parse(String(right?.last_message_at || ''))
        - Date.parse(String(left?.last_message_at || ''));
    });
  });
  return groups.filter((group) => group.items.length > 0);
}
