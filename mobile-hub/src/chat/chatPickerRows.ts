import type { ChatSticker, ChatStickerPack } from '../api/types';
import type { ChatEmojiGroup } from './chatEmoji';

const EMOJI_COLUMNS = 8;
const STICKER_COLUMNS = 4;

export type EmojiPickerRow = {
  id: string;
  kind: 'header';
  title: string;
} | {
  id: string;
  kind: 'emojis';
  emojis: string[];
};

export type StickerPickerRow = {
  id: string;
  kind: 'header';
  title: string;
  pack?: ChatStickerPack;
} | {
  id: string;
  kind: 'stickers';
  stickers: ChatSticker[];
};

function chunks<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}

export function buildEmojiPickerRows(groups: ChatEmojiGroup[]): EmojiPickerRow[] {
  return groups.flatMap((group) => [
    { id: `emoji-header:${group.id}`, kind: 'header' as const, title: `${group.icon} ${group.name}` },
    ...chunks(group.emojis, EMOJI_COLUMNS).map((emojis, index) => ({
      id: `emoji-row:${group.id}:${index}`,
      kind: 'emojis' as const,
      emojis,
    })),
  ]);
}

export function buildStickerPickerRows(
  packs: ChatStickerPack[],
  recent: ChatSticker[],
): StickerPickerRow[] {
  const sections: Array<{ id: string; title: string; pack?: ChatStickerPack; stickers: ChatSticker[] }> = [];
  if (recent.length) sections.push({ id: 'recent', title: 'Недавние', stickers: recent });
  packs.forEach((pack) => sections.push({ id: `pack:${pack.id}`, title: pack.title, pack, stickers: pack.stickers }));

  return sections.flatMap((section) => [
    {
      id: `sticker-header:${section.id}`,
      kind: 'header' as const,
      title: section.title,
      pack: section.pack,
    },
    ...chunks(section.stickers, STICKER_COLUMNS).map((stickers, index) => ({
      id: `sticker-row:${section.id}:${index}`,
      kind: 'stickers' as const,
      stickers,
    })),
  ]);
}
