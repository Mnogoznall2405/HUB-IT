import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  containsEmoji,
  emojiImageCandidates,
  emojiImageUrl,
  emojiToUnified,
  splitEmojiText,
} from './emojiImages';
import { TELEGRAM_MESSAGE_MENU_REACTIONS, TELEGRAM_MESSAGE_MENU_REACTIONS_EXPANDED } from '../../components/chat/chatReactions';

const IMAGE_ROOT = resolve(__dirname, '../../../node_modules/emoji-datasource-apple/img/apple/64');
const imageExists = (unified) => existsSync(resolve(IMAGE_ROOT, `${unified}.png`));

describe('emoji images (R48)', () => {
  it('finds nothing in ordinary text without touching it', () => {
    expect(containsEmoji('Привет, мир 123 © ™ #1')).toBe(true); // cheap pre-check may say yes (©)
    expect(splitEmojiText('Привет, мир 123 #1')).toEqual([{ type: 'text', value: 'Привет, мир 123 #1' }]);
    expect(splitEmojiText('© ™ ↔')).toEqual([{ type: 'text', value: '© ™ ↔' }]); // text presentation stays text
    expect(splitEmojiText('')).toEqual([]);
  });

  it('splits text around emoji, keeping ZWJ sequences, flags, keycaps and skin tones whole', () => {
    expect(splitEmojiText('a😀b')).toEqual([
      { type: 'text', value: 'a' },
      { type: 'emoji', value: '😀' },
      { type: 'text', value: 'b' },
    ]);
    const emojiOf = (text) => splitEmojiText(text).filter((part) => part.type === 'emoji').map((part) => part.value);
    expect(emojiOf('👨‍💻 🇷🇺 1️⃣ 👍🏽 ❤️ 😀😀')).toEqual(['👨‍💻', '🇷🇺', '1️⃣', '👍🏽', '❤️', '😀', '😀']);
    expect(emojiOf('1 2 3 # *')).toEqual([]);
  });

  it('names image files by code points', () => {
    expect(emojiToUnified('😀')).toBe('1f600');
    expect(emojiToUnified('👨‍💻')).toBe('1f468-200d-1f4bb');
    expect(emojiImageUrl('1f600')).toBe('/emoji/apple/64/1f600.png');
  });

  it('every candidate set reaches a real file for the emoji used by the chat', () => {
    const samples = [
      ...TELEGRAM_MESSAGE_MENU_REACTIONS,
      ...TELEGRAM_MESSAGE_MENU_REACTIONS_EXPANDED,
      '😀', '👨‍💻', '🇷🇺', '1️⃣', '👍🏽', '❤️', '☺️', '⌚️', '🏳️‍🌈',
    ];
    samples.forEach((emoji) => {
      const reachable = emojiImageCandidates(emoji).some(imageExists);
      expect(reachable, `${emoji} ${emojiToUnified(emoji)}`).toBe(true);
    });
  });

  it('first row of reactions is the Telegram one and nothing was lost', () => {
    expect(TELEGRAM_MESSAGE_MENU_REACTIONS).toEqual(['👍', '❤️', '🔥', '🥰', '👏', '😁', '🤔', '🤯']);
    expect(TELEGRAM_MESSAGE_MENU_REACTIONS).not.toContain('🗿');
    expect(TELEGRAM_MESSAGE_MENU_REACTIONS).not.toContain('👎');
    expect(TELEGRAM_MESSAGE_MENU_REACTIONS_EXPANDED).toEqual(expect.arrayContaining(['🗿', '👎']));
    expect(new Set([...TELEGRAM_MESSAGE_MENU_REACTIONS, ...TELEGRAM_MESSAGE_MENU_REACTIONS_EXPANDED]).size).toBe(16);
  });
});
