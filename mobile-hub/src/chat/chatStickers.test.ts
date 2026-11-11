import {
  collectRecentStickers,
  deriveStickerPreviewUrl,
  isStickerChatAttachment,
  pickStickerPlaybackUrl,
  pickStickerImageUrl,
  stickerEmojiLabel,
  stickerFromChatAttachment,
} from './chatStickers';

describe('native chat sticker helpers', () => {
  it('detects sticker attachments and prefers a preview url', () => {
    expect(isStickerChatAttachment({ id: '1', kind: 'sticker' })).toBe(true);
    expect(isStickerChatAttachment({ id: '2', mime_type: 'application/x-tgsticker' })).toBe(true);
    expect(isStickerChatAttachment({ id: 'file-sticker', kind: 'file', media_kind: 'sticker' })).toBe(true);
    expect(isStickerChatAttachment({ id: '3', kind: 'image' })).toBe(false);
    expect(isStickerChatAttachment({
      id: '4',
      kind: 'sticker',
      media_kind: 'file',
      mime_type: 'application/x-tgsticker',
      file_name: 'sticker-demo.tgs',
    })).toBe(false);
    expect(pickStickerImageUrl({
      preview_url: '/api/v1/chat/stickers/s1/preview',
      file_url: '/api/v1/chat/stickers/s1/file',
    })).toBe('/api/v1/chat/stickers/s1/preview');
    expect(pickStickerImageUrl({
      mime_type: 'application/x-tgsticker',
      file_url: '/api/v1/chat/messages/m1/attachments/a1/file',
    })).toBeNull();
    expect(pickStickerPlaybackUrl({
      mime_type: 'application/x-tgsticker',
      file_url: '/api/v1/chat/messages/m1/attachments/a1/file',
    })).toBe('/api/v1/chat/messages/m1/attachments/a1/file');
    expect(pickStickerPlaybackUrl({
      mime_type: 'video/webm',
      file_url: '/api/v1/chat/stickers/s2/file',
    })).toBe('/api/v1/chat/stickers/s2/file');
    expect(pickStickerPlaybackUrl({
      mime_type: 'image/webp',
      file_url: '/api/v1/chat/stickers/s3/file',
    })).toBeNull();
    expect(pickStickerPlaybackUrl({
      format: 'animated',
      mime_type: 'application/octet-stream',
      file_url: '/api/v1/chat/stickers/s4/file',
    } as never)).toBe('/api/v1/chat/stickers/s4/file');
    expect(pickStickerPlaybackUrl({
      file_name: 'sticker-office.webm',
      mime_type: 'application/octet-stream',
      file_url: '/api/v1/chat/messages/m1/attachments/a2/file',
    } as never)).toBe('/api/v1/chat/messages/m1/attachments/a2/file');
    expect(deriveStickerPreviewUrl('/api/v1/chat/stickers/s1/file')).toBe(
      '/api/v1/chat/stickers/s1/preview',
    );
    expect(pickStickerImageUrl({
      mime_type: 'application/x-tgsticker',
      file_url: '/api/v1/chat/sticker-packs/preview/office/stickers/s1/file',
    })).toBe('/api/v1/chat/sticker-packs/preview/office/stickers/s1/preview');
    expect(stickerEmojiLabel('sticker-office.tgs')).toBe('');
    expect(stickerEmojiLabel('📎')).toBe('📎');
    expect(stickerFromChatAttachment({
      id: 'a1',
      kind: 'file',
      media_kind: 'sticker',
      file_name: 'sticker-office.tgs',
      preview_url: '/api/v1/chat/stickers/s1/preview',
    })).toMatchObject({
      preview_url: '/api/v1/chat/stickers/s1/preview',
      file_name: 'sticker-office.tgs',
      format: 'animated',
    });
  });

  it('rebuilds the recent row from installed packs', () => {
    const packs = [{
      id: 'office',
      short_name: 'office',
      title: 'Офис',
      stickers: [
        { id: 's2', emoji: '📎' },
        { id: 's1', emoji: '🙂' },
      ],
    }];
    expect(collectRecentStickers(packs, ['s1', 'missing', 's2']).map((item) => item.id))
      .toEqual(['s1', 's2']);
  });
});
