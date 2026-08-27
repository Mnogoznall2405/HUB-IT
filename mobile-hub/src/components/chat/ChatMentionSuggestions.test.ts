import { getTrailingMentionQuery, replaceTrailingMention } from './ChatMentionSuggestions';

describe('native Chat mentions', () => {
  it('opens suggestions only for a trailing mention token', () => {
    expect(getTrailingMentionQuery('Привет @mar')).toBe('mar');
    expect(getTrailingMentionQuery('@')).toBe('');
    expect(getTrailingMentionQuery('Почта test@example.com')).toBeNull();
    expect(getTrailingMentionQuery('Привет @mar дальше')).toBeNull();
  });

  it('replaces only the active trailing mention', () => {
    expect(replaceTrailingMention('Привет @mar', 'maria')).toBe('Привет @maria ');
  });
});
