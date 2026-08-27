import { CHAT_EMOJI_GROUPS, filterEmojiGroups } from './chatEmoji';

describe('native chat emoji catalog', () => {
  it('keeps the same everyday groups as the web emoji panel', () => {
    expect(CHAT_EMOJI_GROUPS.map((group) => group.id)).toEqual([
      'smileys',
      'gestures',
      'hearts',
      'animals',
      'food',
    ]);
    expect(CHAT_EMOJI_GROUPS[0].emojis).toContain('😀');
    expect(CHAT_EMOJI_GROUPS[1].emojis).toContain('👍');
  });

  it('filters groups by name for a Telegram-like search', () => {
    expect(filterEmojiGroups('еда').map((group) => group.id)).toEqual(['food']);
    expect(filterEmojiGroups('🍕')[0]?.emojis).toEqual(['🍕']);
    expect(filterEmojiGroups('').length).toBe(CHAT_EMOJI_GROUPS.length);
  });
});
