import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyReadReceiptDeltaToMessages,
  buildTimelineItems,
  detectChatBodyFormat,
  formatMessageTime,
  formatTaskConversationDue,
  getConversationDisplayTitle,
  getConversationHeaderSubtitle,
  getConversationStatusLine,
  getTaskConversationMetaLine,
  getAttachmentKind,
  getMessagePreview,
  getReplyPreviewText,
  getSearchResultPreview,
  hasChatMarkdownTable,
  isAudioAttachment,
  isVideoAttachment,
  normalizeChatText,
  pickBlobAttachmentUrl,
  sortSidebarConversations,
} from './chatHelpers';

describe('formatMessageTime', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date('2026-06-18T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty string for empty or invalid values', () => {
    expect(formatMessageTime('')).toBe('');
    expect(formatMessageTime('   ')).toBe('');
    expect(formatMessageTime('not-a-date')).toBe('');
  });

  it('returns time for today', () => {
    expect(formatMessageTime('2026-06-18T14:30:00.000Z')).toMatch(/^\d{2}:\d{2}$/);
  });

  it('returns time for yesterday, not date', () => {
    const result = formatMessageTime('2026-06-17T14:30:00.000Z');
    expect(result).toMatch(/^\d{2}:\d{2}$/);
    expect(result).not.toMatch(/\./);
  });

  it('returns time for older dates, not date', () => {
    const result = formatMessageTime('2026-06-10T09:15:00.000Z');
    expect(result).toMatch(/^\d{2}:\d{2}$/);
    expect(result).not.toMatch(/\./);
  });
});

describe('task conversation display helpers', () => {
  it('prefers task metadata over the compatibility conversation title', () => {
    const conversation = {
      kind: 'task',
      title: 'Задача: Старое название',
      task_title: 'Проверить новый сервер',
      task_assignee_full_name: 'Иван Исполнитель',
      task_due_at: '2026-06-29T19:00:00',
    };

    expect(getConversationDisplayTitle(conversation)).toBe('Проверить новый сервер');
    expect(getTaskConversationMetaLine(conversation)).toContain('Иван Исполнитель');
    expect(getTaskConversationMetaLine(conversation)).toContain('Срок:');
  });

  it('uses readable fallbacks when task assignment metadata is missing', () => {
    expect(getConversationDisplayTitle({ kind: 'task', title: 'Задача: Без метаданных' })).toBe('Без метаданных');
    expect(getTaskConversationMetaLine({ kind: 'task' })).toBe('Исполнитель не назначен • Без срока');
    expect(formatTaskConversationDue('')).toBe('Без срока');
  });
});

describe('chatHelpers file caption previews', () => {
  it('prefers file caption over attachment fallback in previews', () => {
    const message = {
      kind: 'file',
      body: 'Подпись к вложению',
      attachments: [
        { file_name: 'report.pdf' },
      ],
    };

    expect(getMessagePreview(message)).toBe('Подпись к вложению');
    expect(getSearchResultPreview(message)).toBe('Подпись к вложению');
  });

  it('keeps attachment fallback when file caption is empty', () => {
    const message = {
      kind: 'file',
      body: '   ',
      attachments: [
        { file_name: 'report.pdf' },
        { file_name: 'image.png' },
      ],
    };

    expect(getMessagePreview(message)).toBe('Файлы: 2');
    expect(getSearchResultPreview(message)).toBe('Файлы: 2');
  });
});

describe('chatHelpers attachment media kind', () => {
  it('keeps explicit audio webm attachments out of the video path', () => {
    const attachment = {
      kind: 'audio',
      media_kind: 'audio',
      file_name: 'voice_123.webm',
      mime_type: 'application/octet-stream',
    };

    expect(getAttachmentKind(attachment)).toBe('audio');
    expect(isAudioAttachment(attachment)).toBe(true);
    expect(isVideoAttachment(attachment)).toBe(false);
  });
});

describe('chatHelpers markdown format detection', () => {
  it('detects explicit markdown constructs', () => {
    expect(detectChatBodyFormat('## Inventory\n\nReady')).toBe('markdown');
    expect(detectChatBodyFormat('| Name | Value |\n| --- | --- |\n| A | B |')).toBe('markdown');
    expect(detectChatBodyFormat('- first\n- second')).toBe('markdown');
    expect(detectChatBodyFormat('```js\nconsole.log(1)\n```')).toBe('markdown');
    expect(detectChatBodyFormat('Use **bold** text')).toBe('markdown');
    expect(detectChatBodyFormat('[Open](https://example.com)')).toBe('markdown');
  });

  it('detects GFM tables separately for chat table layout', () => {
    expect(hasChatMarkdownTable('| Name | Value |\n| --- | --- |\n| A | B |')).toBe(true);
    expect(hasChatMarkdownTable('Name | Value\n--- | ---\nA | B')).toBe(true);
    expect(hasChatMarkdownTable('Plain text with | pipe')).toBe(false);
  });

  it('keeps ordinary multiline chat text plain', () => {
    expect(detectChatBodyFormat('Hello\nHow are you?\nSee you later')).toBe('plain');
  });

  it('strips markdown markers from reply and forward previews', () => {
    expect(getReplyPreviewText({
      kind: 'text',
      body: '## Inventory\n\n| Name | Value |\n| --- | --- |\n| Printer | Ready |\n\n**Source:** ITinvent',
    })).toBe('Inventory Name | Value Printer | Ready');
  });
});

describe('chatHelpers mojibake recovery', () => {
  it('decodes common utf8-cp1251 mojibake in chat previews', () => {
    expect(normalizeChatText('Р’СЃС‘ РЅРѕСЂРјР°Р»СЊРЅРѕ')).toBe('Всё нормально');
  });

  it('normalizes sidebar conversation previews that arrive broken from backend', () => {
    const conversation = {
      kind: 'direct',
      last_message_preview: 'РЎРµСЂРІР°Рє РЅРµРјРЅРѕРіРѕ РЅРµ РІС‹РІРѕР·РёС‚',
      direct_peer: {
        presence: {
          is_online: true,
        },
      },
    };

    expect(getConversationStatusLine(conversation)).toBe('В сети • Сервак немного не вывозит');
  });

  it('formats notes conversation preview without presence', () => {
    const conversation = {
      kind: 'notes',
      title: 'Заметки',
      last_message_preview: 'Вы: Купить кабель',
    };

    expect(getConversationHeaderSubtitle(conversation)).toBe('Личные заметки');
    expect(getConversationStatusLine(conversation)).toBe('Личные заметки • Вы: Купить кабель');
  });

  it('formats task discussion conversation preview with status', () => {
    const conversation = {
      kind: 'task',
      task_id: 'task-42',
      task_status: 'review',
      member_count: 3,
      last_message_preview: 'Вы: Готово',
    };

    expect(getConversationHeaderSubtitle(conversation)).toBe('Статус: На проверке • 3 участников');
    expect(getConversationStatusLine(conversation)).toBe('На проверке • Вы: Готово');
  });
});

describe('chatHelpers timeline keys', () => {
  it('prefers a stable render key for optimistic message replacements', () => {
    const timeline = buildTimelineItems([
      {
        id: 'msg-server-1',
        renderKey: 'optimistic:conv-1:123',
        created_at: '2026-04-14T10:00:00.000Z',
        body: 'Hello',
      },
    ], '');

    expect(timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'message',
        key: 'message:optimistic:conv-1:123',
      }),
    ]));
  });
});

describe('applyReadReceiptDeltaToMessages', () => {
  const messages = [
    { id: 'm1', is_own: true, delivery_status: 'sent', read_by_count: 0 },
    { id: 'm2', is_own: false, delivery_status: null, read_by_count: 0 },
    { id: 'm3', is_own: true, delivery_status: 'sent', read_by_count: 0 },
    { id: 'm4', is_own: true, delivery_status: 'sent', read_by_count: 0 },
  ];

  it('marks all own messages up to the read marker as read', () => {
    const next = applyReadReceiptDeltaToMessages(messages, {
      message_id: 'm4',
      delivery_status: 'read',
      read_by_count: 1,
    });

    expect(next[0].delivery_status).toBe('read');
    expect(next[2].delivery_status).toBe('read');
    expect(next[3].delivery_status).toBe('read');
    expect(next[1].delivery_status).toBeNull();
  });

  it('updates only the target message when read state is not confirmed', () => {
    const next = applyReadReceiptDeltaToMessages(messages, {
      message_id: 'm3',
      delivery_status: 'sent',
      read_by_count: 0,
    });

    expect(next[0].delivery_status).toBe('sent');
    expect(next[2].delivery_status).toBe('sent');
    expect(next[3].delivery_status).toBe('sent');
  });
});

describe('pickBlobAttachmentUrl', () => {
  it('returns the first blob url from candidates', () => {
    expect(pickBlobAttachmentUrl('', '/api/v1/file', 'blob:https://example.test/abc')).toBe('blob:https://example.test/abc');
    expect(pickBlobAttachmentUrl('/api/v1/file', null, undefined)).toBe('');
  });
});

describe('sortSidebarConversations', () => {
  it('keeps pinned chats above unpinned regardless of recent activity', () => {
    const conversations = [
      { id: 'active-1', kind: 'direct', is_pinned: false, is_archived: false, last_message_at: '2026-06-18T12:00:00.000Z' },
      { id: 'notes-1', kind: 'notes', is_pinned: true, is_archived: false, last_message_at: '2026-06-17T10:00:00.000Z' },
      { id: 'group-1', kind: 'group', is_pinned: false, is_archived: false, last_message_at: '2026-06-18T11:00:00.000Z' },
    ];

    expect(sortSidebarConversations(conversations).map((item) => item.id)).toEqual([
      'notes-1',
      'active-1',
      'group-1',
    ]);
  });
});
