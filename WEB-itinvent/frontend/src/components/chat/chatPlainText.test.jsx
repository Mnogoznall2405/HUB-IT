import { describe, expect, it } from 'vitest';

import { extractFirstChatUrl, renderChatPlainTextBody } from './chatPlainText';

describe('chatPlainText', () => {
  it('extracts the first http(s) url from message text', () => {
    expect(extractFirstChatUrl('Смотри https://example.com/path и еще')).toBe('https://example.com/path');
  });

  it('renders urls as anchor elements with the provided link color', () => {
    const body = renderChatPlainTextBody('Открой https://example.com', {
      mentionColor: '#3390ec',
      linkColor: '#3d7d2b',
    });

    expect(body).not.toBe('Открой https://example.com');
    expect(Array.isArray(body)).toBe(true);
    const link = body.find((node) => node?.props?.href === 'https://example.com');
    expect(link).toBeTruthy();
    expect(link.props.sx.color).toBe('#3d7d2b');
  });

  it('keeps mention highlighting alongside urls', () => {
    const body = renderChatPlainTextBody('Привет @ivan https://example.com', {
      mentionColor: '#3390ec',
      linkColor: '#3d7d2b',
    });

    const mention = body.find((node) => node?.props?.children === '@ivan');
    const link = body.find((node) => node?.props?.href === 'https://example.com');
    expect(mention?.props?.sx?.color).toBe('#3390ec');
    expect(link?.props?.sx?.color).toBe('#3d7d2b');
  });
});
