import { describe, expect, it } from 'vitest';
import { buildFeedPostPath, buildFeedShareMessage, getFeedInitials, stripFeedMarkdown } from './feedUtils';

describe('feedUtils', () => {
  it('builds readable collapsed text from markdown', () => {
    expect(stripFeedMarkdown('## Заголовок\n- **Первый** [пункт](https://example.com)')).toBe('Заголовок Первый пункт');
  });

  it('builds a stable feed deep link and share message', () => {
    expect(buildFeedPostPath('post/1')).toBe('/feed?post=post%2F1');
    expect(buildFeedShareMessage({ title: 'Новость', preview: 'Коротко' }, 'https://hub/feed?post=1'))
      .toBe('Новость\n\nКоротко\n\nhttps://hub/feed?post=1');
  });

  it('uses two initials for the author avatar', () => {
    expect(getFeedInitials('Иван Петров')).toBe('ИП');
  });
});
