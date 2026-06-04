import { describe, expect, it } from 'vitest';

import {
  buildTimelineItems,
  detectChatBodyFormat,
  getConversationStatusLine,
  getAttachmentKind,
  getMessagePreview,
  getReplyPreviewText,
  getSearchResultPreview,
  hasChatMarkdownTable,
  isAudioAttachment,
  isVideoAttachment,
  normalizeChatText,
} from './chatHelpers';

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
