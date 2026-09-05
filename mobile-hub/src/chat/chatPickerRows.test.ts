import type { ChatStickerPack } from '../api/types';
import { buildEmojiPickerRows, buildStickerPickerRows } from './chatPickerRows';

describe('native chat picker row models', () => {
  it('splits emoji groups into virtualizable rows without changing order', () => {
    const rows = buildEmojiPickerRows([{
      id: 'faces',
      name: 'Faces',
      icon: 'face',
      emojis: Array.from({ length: 18 }, (_, index) => `emoji-${index}`),
    }]);

    expect(rows.map((row) => row.kind)).toEqual(['header', 'emojis', 'emojis', 'emojis']);
    expect(rows.filter((row) => row.kind === 'emojis').every((row) => row.emojis.length <= 8)).toBe(true);
    expect(rows.flatMap((row) => row.kind === 'emojis' ? row.emojis : []))
      .toEqual(Array.from({ length: 18 }, (_, index) => `emoji-${index}`));
  });

  it('splits sticker packs into four-column rows and keeps pack actions on headers', () => {
    const packs: ChatStickerPack[] = [{
      id: 'office',
      short_name: 'office',
      title: 'Office',
      stickers: Array.from({ length: 10 }, (_, index) => ({ id: `sticker-${index}` })),
    }];
    const rows = buildStickerPickerRows(packs, [packs[0].stickers[1]]);

    expect(rows.map((row) => row.kind)).toEqual([
      'header', 'stickers',
      'header', 'stickers', 'stickers', 'stickers',
    ]);
    expect(rows.filter((row) => row.kind === 'stickers').every((row) => row.stickers.length <= 4)).toBe(true);
    expect(rows.filter((row) => row.kind === 'header').find((row) => row.pack)?.pack?.id).toBe('office');
  });
});
