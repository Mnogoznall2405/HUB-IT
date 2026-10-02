import {
  buildChatFolderTabList,
  buildFolderUnreadCounts,
  conversationKindLabel,
  filterConversationsByFolder,
  isConversationEffectivelyMuted,
  isConversationInFolder,
  shouldShowConversationKindChip,
  toggleConversationIdInFolderMap,
  formatFolderUnreadBadge,
  normalizeFolderKey,
  resolveFolderSwipeTarget,
} from './chatFolders';
import type { ChatConversationSummary } from '../api/types';

describe('native chat folders', () => {
  const conversations: ChatConversationSummary[] = [
    { id: 'd1', kind: 'direct', title: 'Личный', unread_count: 2, is_archived: false },
    { id: 'g1', kind: 'group', title: 'Беседа', unread_count: 3, is_archived: false },
    { id: 't1', kind: 'task', title: 'Задача', unread_count: 1, is_archived: false },
    { id: 'a1', kind: 'direct', title: 'В архиве', unread_count: 4, is_archived: true },
    { id: 'ai1', kind: 'ai', title: 'Бот', unread_count: 5, is_archived: false },
    { id: 'c-work', kind: 'group', title: 'Склад', unread_count: 7, is_archived: false },
  ];
  const custom = [{ id: 'work', name: 'Работа', conversation_ids: ['c-work'], unread_count: 9 }];

  it('builds Telegram-like tabs from system folders then custom then archive', () => {
    expect(buildChatFolderTabList(custom).map((tab) => tab.key))
      .toEqual(['personal', 'unread', 'groups', 'tasks', 'work', 'archived']);
    expect(normalizeFolderKey('all')).toBe('personal');
  });

  it('filters archived chats out of ordinary folders', () => {
    expect(filterConversationsByFolder(conversations, 'personal').map((item) => item.id)).toEqual(['d1']);
    expect(filterConversationsByFolder(conversations, 'unread').map((item) => item.id))
      .toEqual(['d1', 'g1', 't1', 'c-work']);
    expect(filterConversationsByFolder(conversations, 'groups').map((item) => item.id)).toEqual(['g1', 'c-work']);
    expect(filterConversationsByFolder(conversations, 'archived').map((item) => item.id)).toEqual(['a1']);
    expect(filterConversationsByFolder(conversations, 'work', { work: ['c-work'] }).map((item) => item.id))
      .toEqual(['c-work']);
  });

  it('swipes only across the main folder row', () => {
    expect(resolveFolderSwipeTarget('personal', 'next', custom)).toBe('unread');
    expect(resolveFolderSwipeTarget('work', 'prev', custom)).toBe('tasks');
    expect(resolveFolderSwipeTarget('work', 'next', custom)).toBeNull();
    expect(resolveFolderSwipeTarget('archived', 'prev', custom)).toBe('personal');
  });

  // U1 (backend chat/folder_unread.py, web chatFolderUtils.js): AI-диалоги живут
  // в отдельном разделе «ИИ» и не входят ни в одну папку раздела «Чаты».
  it('keeps AI conversations and their unread out of every chat folder (U1)', () => {
    ['personal', 'unread', 'groups', 'tasks', 'archived', 'work'].forEach((key) => {
      expect(filterConversationsByFolder(conversations, key, { work: ['c-work'] })
        .map((item) => item.id)).not.toContain('ai1');
    });
    const counts = buildFolderUnreadCounts(conversations, custom, { work: ['c-work'] });
    expect(counts.personal).toBe(2);
    expect(counts.unread).toBe(13);
    expect(counts.groups).toBe(10);
    expect(counts.tasks).toBe(1);
    expect(counts.archived).toBe(4);
  });

  it('does not count AI unread in a custom folder even when its id is assigned', () => {
    const mixed = [{ id: 'mixed', name: 'Смешанная', conversation_ids: ['ai1', 'd1'] }];
    const counts = buildFolderUnreadCounts(conversations, mixed, { mixed: ['ai1', 'd1'] });
    expect(counts.mixed).toBe(2);
    expect(filterConversationsByFolder(conversations, 'mixed', { mixed: ['ai1', 'd1'] })
      .map((item) => item.id)).toEqual(['d1']);
  });

  it('uses loaded unread for system folders and server unread for custom folders', () => {
    const counts = buildFolderUnreadCounts(conversations, custom, { work: ['c-work'] });
    expect(counts.personal).toBe(2);
    expect(counts.unread).toBe(13);
    expect(counts.groups).toBe(10);
    expect(counts.archived).toBe(4);
    expect(counts.work).toBe(9);
    expect(formatFolderUnreadBadge(120)).toBe('99+');
  });

  it('prefers server unread for system folders when the folders payload includes them', () => {
    const counts = buildFolderUnreadCounts(conversations, custom, { work: ['c-work'] }, {
      personal: 21,
      unread: 25,
      groups: 4,
      tasks: 0,
      archived: 8,
    });
    expect(counts.personal).toBe(21);
    expect(counts.unread).toBe(25);
    expect(counts.groups).toBe(4);
    expect(counts.tasks).toBe(0);
    expect(counts.archived).toBe(8);
    expect(counts.work).toBe(9);
  });

  // A3-2 (backend folder_unread.py, web chatFolderUtils.js): сервер исключает
  // effectively-muted из бейджей; 'unread' ключ он не отдаёт, поэтому fallback
  // обязан фильтровать muted сам.
  it('keeps effectively-muted unread out of the unread folder list and fallback counts', () => {
    const muted = [
      { id: 'm-indef', kind: 'direct', title: 'Мьют навсегда', unread_count: 6, is_archived: false, is_muted: true, muted_until: null },
      { id: 'm-future', kind: 'group', title: 'Мьют до', unread_count: 5, is_archived: false, is_muted: true, muted_until: '2999-01-01T00:00:00Z' },
      { id: 'm-expired', kind: 'direct', title: 'Истёкший мьют', unread_count: 4, is_archived: false, is_muted: true, muted_until: '2020-01-01T00:00:00Z' },
      { id: 'm-archived', kind: 'group', title: 'Мьют в архиве', unread_count: 3, is_archived: true, is_muted: true, muted_until: null },
    ] as ChatConversationSummary[];
    const list = [...conversations, ...muted];

    expect(filterConversationsByFolder(list, 'unread').map((item) => item.id))
      .toEqual(['d1', 'g1', 't1', 'c-work', 'm-expired']);

    const counts = buildFolderUnreadCounts(list, custom, { work: ['c-work'] });
    expect(counts.unread).toBe(17); // 13 + 4 от чата с истёкшим мьютом
    expect(counts.personal).toBe(6); // muted direct не входит, истёкший входит
    expect(counts.groups).toBe(10);
    expect(counts.archived).toBe(4); // muted+archived не входит, как на сервере
    // Серверный ключ 'unread' (если бы он пришёл) по-прежнему выигрывает.
    expect(buildFolderUnreadCounts(list, custom, { work: ['c-work'] }, { unread: 42 }).unread).toBe(42);
  });

  it('treats mute as effective only while muted_until is in the future', () => {
    const base = { id: 'x', kind: 'direct' } as ChatConversationSummary;
    expect(isConversationEffectivelyMuted({ ...base, is_muted: false })).toBe(false);
    expect(isConversationEffectivelyMuted({ ...base, is_muted: true, muted_until: null })).toBe(true);
    expect(isConversationEffectivelyMuted({ ...base, is_muted: true, muted_until: '2999-01-01T00:00:00Z' })).toBe(true);
    expect(isConversationEffectivelyMuted({ ...base, is_muted: true, muted_until: '2020-01-01T00:00:00Z' })).toBe(false);
    expect(isConversationEffectivelyMuted(null)).toBe(false);
  });
});

describe('conversation kind labels', () => {
  it('names notes, task and AI separately from ordinary chats', () => {
    expect(conversationKindLabel('notes')).toBe('Заметки');
    expect(conversationKindLabel('task')).toBe('Задача');
    expect(conversationKindLabel('ai')).toBe('AI');
    expect(conversationKindLabel('direct')).toBe('Личный');
    expect(shouldShowConversationKindChip('task')).toBe(true);
    expect(shouldShowConversationKindChip('direct')).toBe(false);
  });
});

describe('folder membership', () => {
  it('toggles a conversation in a custom folder map', () => {
    const next = toggleConversationIdInFolderMap({ work: ['c1'] }, 'work', 'c2', true);
    expect(isConversationInFolder('c2', 'work', next)).toBe(true);
    expect(isConversationInFolder('c2', 'work', toggleConversationIdInFolderMap(next, 'work', 'c2', false))).toBe(false);
  });
});
