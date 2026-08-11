import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ChatStickerThumbnail from './ChatStickerThumbnail';

vi.mock('./ChatStickerMedia', () => ({
  default: ({ src, autoPlay }) => (
    <div
      data-testid="mock-chat-sticker-media"
      data-src={src}
      data-autoplay={String(Boolean(autoPlay))}
    />
  ),
}));

describe('ChatStickerThumbnail', () => {
  it('renders a paused TGS first frame when Telegram did not provide a preview', () => {
    render(
      <ChatStickerThumbnail
        sticker={{
          id: 'animated-1',
          format: 'animated',
          mime_type: 'application/x-tgsticker',
          file_url: '/api/v1/chat/stickers/animated-1/file',
          preview_url: null,
          emoji: '👊',
        }}
        size={68}
        staticOnly
      />,
    );

    expect(screen.getByTestId('mock-chat-sticker-media')).toHaveAttribute(
      'data-src',
      '/api/v1/chat/stickers/animated-1/file',
    );
    expect(screen.getByTestId('mock-chat-sticker-media')).toHaveAttribute('data-autoplay', 'false');
    expect(screen.queryByTestId('chat-sticker-thumbnail-placeholder')).not.toBeInTheDocument();
  });
});
