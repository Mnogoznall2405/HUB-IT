import {
  countAiUnread,
  filterAiConversations,
  groupAiSidebarRowsByDate,
  resolveAiBotForConversation,
} from './chatAiWorkspace';
import type { ChatConversationSummary } from '../api/types';

describe('native AI workspace', () => {
  const items: ChatConversationSummary[] = [
    {
      id: 'ai-today',
      kind: 'ai',
      title: 'HUB Ассистент',
      last_message_preview: 'Готово',
      last_message_at: '2026-08-23T10:00:00Z',
      unread_count: 2,
    },
    {
      id: 'ai-old',
      kind: 'ai',
      title: 'Архивный бот',
      last_message_at: '2026-08-01T10:00:00Z',
      is_archived: true,
    },
    { id: 'd1', kind: 'direct', title: 'Личный', unread_count: 4 },
  ];

  it('keeps only active AI conversations in the AI tab', () => {
    expect(filterAiConversations(items).map((item) => item.id)).toEqual(['ai-today']);
    expect(filterAiConversations(items, { archived: true }).map((item) => item.id)).toEqual(['ai-old']);
    expect(filterAiConversations(items, { query: 'ассистент' }).map((item) => item.id)).toEqual(['ai-today']);
    expect(countAiUnread(items)).toBe(2);
  });

  // A3-2: сервер исключает effectively-muted из бейджей — AI-счётчик повторяет это.
  it('excludes effectively-muted AI conversations from the unread counter', () => {
    const muted: ChatConversationSummary[] = [
      ...items,
      { id: 'ai-muted', kind: 'ai', title: 'Замьюченный бот', unread_count: 9, is_muted: true, muted_until: null },
      { id: 'ai-muted-future', kind: 'ai', title: 'Мьют до', unread_count: 7, is_muted: true, muted_until: '2999-01-01T00:00:00Z' },
      { id: 'ai-muted-expired', kind: 'ai', title: 'Истёкший мьют', unread_count: 3, is_muted: true, muted_until: '2020-01-01T00:00:00Z' },
      { id: 'ai-muted-archived', kind: 'ai', title: 'Мьют в архиве', unread_count: 5, is_muted: true, muted_until: null, is_archived: true },
    ];
    expect(countAiUnread(muted)).toBe(5); // 2 + 3 от чата с истёкшим мьютом
  });

  it('groups AI history by today, yesterday and earlier', () => {
    const groups = groupAiSidebarRowsByDate(filterAiConversations(items), new Date('2026-08-23T18:00:00Z'));
    expect(groups.map((group) => group.key)).toEqual(['today']);
    expect(groups[0].items[0].id).toBe('ai-today');
  });

  it('resolves the sandbox bot that owns a conversation', () => {
    expect(resolveAiBotForConversation([
      { id: 'other', name: 'Другой', conversation_ids: ['ai-x'] },
      { id: 'opencode', name: 'OpenCode', surface: 'sandbox', conversation_id: 'ai-today' },
    ], 'ai-today')?.id).toBe('opencode');
  });
});
