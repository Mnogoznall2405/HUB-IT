import { extractFirstChatUrl, hasUsableLinkPreview } from './chatLinkPreview';

describe('native chat link preview helpers', () => {
  it('extracts the first http url the same way as web', () => {
    expect(extractFirstChatUrl('Смотри https://example.com/path и еще')).toBe('https://example.com/path');
    expect(extractFirstChatUrl('без ссылки')).toBeNull();
  });

  it('hides empty previews so the bubble does not jump', () => {
    expect(hasUsableLinkPreview({ url: 'https://example.com' })).toBe(false);
    expect(hasUsableLinkPreview({ url: 'https://example.com', title: 'Example' })).toBe(true);
  });
});
