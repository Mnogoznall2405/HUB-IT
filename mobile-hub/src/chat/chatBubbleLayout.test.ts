import type { ChatMessage } from '../api/types';
import {
  CHAT_PHOTO_DEFAULT_ASPECT,
  CHAT_PHOTO_MAX_ASPECT,
  CHAT_PHOTO_MIN_ASPECT,
  buildChatMetaPlainText,
  estimateChatMetaWidth,
  isPhotoChatAttachment,
  isStickerOnlyMessage,
  resolveChatBubbleMetaMode,
  resolveChatPhotoAspect,
  resolveChatPhotoWidth,
  shouldBleedBubbleMedia,
  shouldShowSenderAvatar,
  shouldShowSenderAvatarsForKind,
} from './chatBubbleLayout';

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    conversation_id: 'c1',
    body_text: '',
    created_at: '2026-08-23T10:00:00Z',
    ...overrides,
  } as ChatMessage;
}

describe('chatBubbleLayout meta mode', () => {
  it('keeps time on the last text line for plain text', () => {
    expect(resolveChatBubbleMetaMode({
      hasText: true,
      hasPhoto: false,
      isStickerOnly: false,
      hasTrailingBlock: false,
    })).toBe('inline');
  });

  it('floats time over a caption-less photo', () => {
    expect(resolveChatBubbleMetaMode({
      hasText: false,
      hasPhoto: true,
      isStickerOnly: false,
      hasTrailingBlock: false,
    })).toBe('overlay');
  });

  it('keeps a captioned photo inline so the caption is not covered', () => {
    expect(resolveChatBubbleMetaMode({
      hasText: true,
      hasPhoto: true,
      isStickerOnly: false,
      hasTrailingBlock: false,
    })).toBe('inline');
  });

  it('floats time over a sticker', () => {
    expect(resolveChatBubbleMetaMode({
      hasText: false,
      hasPhoto: false,
      isStickerOnly: true,
      hasTrailingBlock: false,
    })).toBe('overlay');
  });

  it('falls back to a separate row when a card follows the text', () => {
    expect(resolveChatBubbleMetaMode({
      hasText: true,
      hasPhoto: false,
      isStickerOnly: false,
      hasTrailingBlock: true,
    })).toBe('row');
  });

  it('falls back to a separate row for voice and files', () => {
    expect(resolveChatBubbleMetaMode({
      hasText: false,
      hasPhoto: false,
      isStickerOnly: false,
      hasTrailingBlock: false,
    })).toBe('row');
  });
});

describe('chatBubbleLayout meta spacer', () => {
  it('reserves room for time and read ticks', () => {
    expect(buildChatMetaPlainText({
      timeLabel: '14:03',
      sending: false,
      edited: false,
      showTicks: true,
      read: true,
    })).toBe('14:03 ✓✓');
  });

  it('reserves room for the edited marker and single tick', () => {
    expect(buildChatMetaPlainText({
      timeLabel: '14:03',
      sending: false,
      edited: true,
      showTicks: true,
      read: false,
    })).toBe('14:03 · изм. ✓');
  });

  it('reserves room for the sending state', () => {
    expect(buildChatMetaPlainText({
      timeLabel: '14:03',
      sending: true,
      edited: false,
      showTicks: false,
      read: false,
    })).toBe('Отправляется · 14:03');
  });

  it('omits ticks for incoming messages', () => {
    expect(buildChatMetaPlainText({
      timeLabel: '09:15',
      sending: false,
      edited: false,
      showTicks: false,
      read: true,
    })).toBe('09:15');
  });

  it('reserves a wider gap for a longer meta line', () => {
    const short = estimateChatMetaWidth('09:15');
    const long = estimateChatMetaWidth('14:03 · изм. ✓✓');
    expect(short).toBeGreaterThan(0);
    expect(long).toBeGreaterThan(short);
  });

  it('reserves nothing when there is no meta', () => {
    expect(estimateChatMetaWidth('')).toBe(0);
  });
});

describe('chatBubbleLayout media bleed', () => {
  const bare = {
    hasText: false,
    hasPhoto: true,
    hasSenderName: false,
    hasQuote: false,
    hasForwardNote: false,
    hasTrailingBlock: false,
  };

  it('lets a bare photo fill the bubble', () => {
    expect(shouldBleedBubbleMedia(bare)).toBe(true);
  });

  it('keeps padding when a caption, name or quote shares the bubble', () => {
    expect(shouldBleedBubbleMedia({ ...bare, hasText: true })).toBe(false);
    expect(shouldBleedBubbleMedia({ ...bare, hasSenderName: true })).toBe(false);
    expect(shouldBleedBubbleMedia({ ...bare, hasQuote: true })).toBe(false);
    expect(shouldBleedBubbleMedia({ ...bare, hasForwardNote: true })).toBe(false);
  });

  it('keeps padding for a failed photo so the retry line is not flush', () => {
    expect(shouldBleedBubbleMedia({ ...bare, hasTrailingBlock: true })).toBe(false);
  });

  it('never bleeds when there is no photo', () => {
    expect(shouldBleedBubbleMedia({ ...bare, hasPhoto: false })).toBe(false);
  });
});

describe('chatBubbleLayout photo sizing', () => {
  it('keeps the natural aspect ratio', () => {
    expect(resolveChatPhotoAspect(1600, 1200)).toBeCloseTo(1.3333, 3);
  });

  it('clamps panoramas and very tall shots', () => {
    expect(resolveChatPhotoAspect(4000, 500)).toBe(CHAT_PHOTO_MAX_ASPECT);
    expect(resolveChatPhotoAspect(500, 4000)).toBe(CHAT_PHOTO_MIN_ASPECT);
  });

  it('falls back to a default before the image is measured', () => {
    expect(resolveChatPhotoAspect(0, 0)).toBe(CHAT_PHOTO_DEFAULT_ASPECT);
    expect(resolveChatPhotoAspect(undefined, undefined)).toBe(CHAT_PHOTO_DEFAULT_ASPECT);
    expect(resolveChatPhotoAspect(Number.NaN, 100)).toBe(CHAT_PHOTO_DEFAULT_ASPECT);
  });

  it('scales the photo with the screen but stays within bounds', () => {
    expect(resolveChatPhotoWidth(360)).toBe(230);
    expect(resolveChatPhotoWidth(1000)).toBe(272);
    expect(resolveChatPhotoWidth(200)).toBe(180);
    expect(resolveChatPhotoWidth(0)).toBe(240);
  });
});

describe('chatBubbleLayout sender avatars', () => {
  it('shows an avatar only on the newest bubble of an incoming run', () => {
    const base = { isOwn: false, showSenderAvatars: true } as const;
    expect(shouldShowSenderAvatar({ ...base, groupPosition: 'single' })).toBe(true);
    expect(shouldShowSenderAvatar({ ...base, groupPosition: 'last' })).toBe(true);
    expect(shouldShowSenderAvatar({ ...base, groupPosition: 'first' })).toBe(false);
    expect(shouldShowSenderAvatar({ ...base, groupPosition: 'middle' })).toBe(false);
  });

  it('never shows an avatar for own messages or direct chats', () => {
    expect(shouldShowSenderAvatar({
      isOwn: true,
      showSenderAvatars: true,
      groupPosition: 'single',
    })).toBe(false);
    expect(shouldShowSenderAvatar({
      isOwn: false,
      showSenderAvatars: false,
      groupPosition: 'single',
    })).toBe(false);
  });

  it('enables avatars only for multi-party conversation kinds', () => {
    expect(shouldShowSenderAvatarsForKind('group')).toBe(true);
    expect(shouldShowSenderAvatarsForKind('task')).toBe(true);
    expect(shouldShowSenderAvatarsForKind('direct')).toBe(false);
    expect(shouldShowSenderAvatarsForKind('notes')).toBe(false);
    expect(shouldShowSenderAvatarsForKind('ai')).toBe(false);
    expect(shouldShowSenderAvatarsForKind(null)).toBe(false);
  });
});

describe('chatBubbleLayout attachment kinds', () => {
  it('detects photos by kind and mime type', () => {
    expect(isPhotoChatAttachment({ id: 'a', kind: 'image' })).toBe(true);
    expect(isPhotoChatAttachment({ id: 'a', mime_type: 'image/png' })).toBe(true);
    expect(isPhotoChatAttachment({ id: 'a', kind: 'file' })).toBe(false);
    expect(isPhotoChatAttachment({ id: 'a', kind: 'file', mime_type: 'image/png' })).toBe(false);
    expect(isPhotoChatAttachment({
      id: 'a',
      kind: 'image',
      media_kind: 'file',
      mime_type: 'image/png',
    })).toBe(false);
    expect(isPhotoChatAttachment(null)).toBe(false);
  });

  it('does not treat stickers as photos', () => {
    expect(isPhotoChatAttachment({ id: 'a', kind: 'sticker', mime_type: 'image/webp' })).toBe(false);
  });

  it('detects sticker-only messages', () => {
    expect(isStickerOnlyMessage(message({
      attachments: [{ id: 'a', kind: 'sticker' }],
    }))).toBe(true);
    expect(isStickerOnlyMessage(message({
      body_text: 'привет',
      attachments: [{ id: 'a', kind: 'sticker' }],
    }))).toBe(false);
    expect(isStickerOnlyMessage(message({
      attachments: [{ id: 'a', kind: 'sticker' }, { id: 'b', kind: 'image' }],
    }))).toBe(false);
    expect(isStickerOnlyMessage(message({ attachments: [] }))).toBe(false);
    expect(isStickerOnlyMessage(message({
      attachments: [{ id: 'a', kind: 'file', media_kind: 'sticker' }],
    }))).toBe(true);
    expect(isStickerOnlyMessage(message({
      body_text: '📎',
      attachments: [{ id: 'a', kind: 'sticker', file_name: '📎' }],
    }))).toBe(true);
  });
});
