import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ChatEmojiImage, renderChatEmojiText } from './ChatEmoji';
import { renderChatPlainTextBody } from './chatPlainText';
import MarkdownRenderer from '../hub/MarkdownRenderer';

describe('ChatEmojiImage (R48)', () => {
  it('draws an Apple image from our own path and keeps the real character in alt', () => {
    render(<ChatEmojiImage emoji="😀" />);
    const image = screen.getByRole('img', { name: '😀' });
    expect(image).toHaveAttribute('src', '/emoji/apple/64/1f600.png');
    expect(image.getAttribute('src')).not.toMatch(/^https?:/);
  });

  it('retries the other variation-selector form, then falls back to the glyph', () => {
    render(<ChatEmojiImage emoji="⌚️" />);
    const image = screen.getByRole('img', { name: '⌚️' });
    expect(image.getAttribute('src')).toBe('/emoji/apple/64/231a-fe0f.png');
    fireEvent.error(image);
    expect(screen.getByRole('img', { name: '⌚️' }).getAttribute('src')).toBe('/emoji/apple/64/231a.png');
    fireEvent.error(screen.getByRole('img', { name: '⌚️' }));
    expect(screen.queryByRole('img')).toBeNull();
    expect(document.querySelector('[data-chat-emoji-native]')).toHaveTextContent('⌚️');
  });

  it('starts again from the first candidate when the emoji in the slot changes', () => {
    const { rerender } = render(<ChatEmojiImage emoji="⌚️" />);
    fireEvent.error(screen.getByRole('img'));
    rerender(<ChatEmojiImage emoji="😀" />);
    expect(screen.getByRole('img', { name: '😀' }).getAttribute('src')).toBe('/emoji/apple/64/1f600.png');
  });
});

describe('emoji in message text', () => {
  it('leaves emoji-free text as the same string', () => {
    expect(renderChatEmojiText('обычный текст')).toBe('обычный текст');
    expect(renderChatPlainTextBody('обычный текст')).toBe('обычный текст');
  });

  it('plain text: emoji become images between the text parts, mentions and links stay', () => {
    const { container } = render(
      <p>{renderChatPlainTextBody('Привет 😀 @ivan см. https://example.com/a 👍', { mentionColor: 'red', linkColor: 'blue' })}</p>,
    );
    expect(container.querySelectorAll('img[data-chat-emoji]')).toHaveLength(2);
    expect(container.textContent).toContain('@ivan');
    expect(container.querySelector('a')).toHaveAttribute('href', 'https://example.com/a');
    expect(Array.from(container.querySelectorAll('img')).map((image) => image.alt)).toEqual(['😀', '👍']);
  });

  it('markdown: emoji become images in prose, never inside code', () => {
    const { container } = render(<MarkdownRenderer variant="chat" value={'Готово 🎉\n\n`код 😀`'} />);
    expect(container.querySelectorAll('img[data-chat-emoji]')).toHaveLength(1);
    expect(container.querySelector('img').alt).toBe('🎉');
    expect(container.querySelector('code').textContent).toBe('код 😀');
  });

  it('markdown outside the chat keeps native emoji text', () => {
    const { container } = render(<MarkdownRenderer value="Готово 🎉" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('🎉');
  });
});
