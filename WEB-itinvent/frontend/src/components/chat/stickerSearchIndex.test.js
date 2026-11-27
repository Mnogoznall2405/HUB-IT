// Поиск стикеров поверх полного CLDR keyword-индекса (issue #82):
// ключевые слова всех эмодзи из Unicode CLDR (RU+EN) доступны поиску
// панели, ручной curated-словарь остаётся fallback-override поверх.
// Модульный lazy-индекс подменяется prebuilt-экземпляром через
// resetEmojiKeywordIndexForTests — тесты не зависят от загрузки чанка.
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildEmojiKeywordIndex,
  resetEmojiKeywordIndexForTests,
} from '../../lib/chat/emojiKeywordIndex';
import { EMOJI_KEYWORD_ROWS } from '../../lib/chat/generated/emojiKeywordData';
import {
  buildStickerSearchIndex,
  collectStickerSuggestions,
  searchStickerIndex,
} from './stickerSearchIndex';

const makeSticker = (id, emoji) => ({
  id,
  emoji,
  format: 'static',
  file_url: `/api/v1/chat/stickers/${id}/file`,
  preview_url: `/api/v1/chat/stickers/${id}/preview`,
});

const makeSections = (stickers) => [
  { id: 'recent', title: 'Недавние', stickers: [], recent: true },
  { id: 'favorites', title: 'Избранные', stickers: [], favorites: true },
  {
    id: 'pack-1',
    title: 'Тестовый набор',
    short_name: 'test_pack',
    stickers,
  },
];

const searchIds = (index, query) => (
  searchStickerIndex(index, query).flatMap((group) => group.stickers.map((sticker) => String(sticker.id)))
);

const realCldrIndex = buildEmojiKeywordIndex(EMOJI_KEYWORD_ROWS);

afterEach(() => {
  // Модульный индекс — процессно-глобальный: возвращаем «не загружен»,
  // чтобы соседние suites решали сами, нужен ли им CLDR-словарь.
  resetEmojiKeywordIndexForTests(null);
});

describe('sticker search with the full CLDR keyword index', () => {
  it('finds a sticker by a RU keyword missing from the manual dictionary', () => {
    resetEmojiKeywordIndexForTests(realCldrIndex);
    // 🦉/«сова» — в ручном словаре совы нет: до CLDR индекса поиск
    // не находил ничего, это и есть целевое расширение покрытия.
    const index = buildStickerSearchIndex(makeSections([makeSticker('st-owl', '🦉')]));
    expect(searchIds(index, 'сова')).toEqual(['st-owl']);
  });

  it('finds a sticker by an EN keyword missing from the manual dictionary', () => {
    resetEmojiKeywordIndexForTests(realCldrIndex);
    const index = buildStickerSearchIndex(makeSections([makeSticker('st-owl', '🦉')]));
    expect(searchIds(index, 'owl')).toEqual(['st-owl']);
  });

  it('finds test-tube stickers by «пробирка» (e2e seed scenario)', () => {
    resetEmojiKeywordIndexForTests(realCldrIndex);
    const index = buildStickerSearchIndex(makeSections([makeSticker('st-tube', '🧪')]));
    expect(searchIds(index, 'пробирка')).toEqual(['st-tube']);
    expect(searchIds(index, 'химия')).toEqual(['st-tube']);
  });

  it('collects keywords across composite emoji tags', () => {
    resetEmojiKeywordIndexForTests(realCldrIndex);
    // Составной тег «🦉🧪» — сегментация по графемам: обе ветки ключевых
    // слов доступны, ни одна не теряется.
    const index = buildStickerSearchIndex(makeSections([makeSticker('st-mix', '🦉🧪')]));
    expect(searchIds(index, 'сова')).toEqual(['st-mix']);
    expect(searchIds(index, 'пробирка')).toEqual(['st-mix']);
  });

  it('resolves skin-tone sticker emoji through the base form keywords', () => {
    resetEmojiKeywordIndexForTests(realCldrIndex);
    // 🤏 в ручном словаре нет; строка варианта 🤏🏻 в индексе тоже —
    // попадание идёт через срезку модификатора тона до базовой формы.
    const index = buildStickerSearchIndex(makeSections([makeSticker('st-pin', '🤏🏻')]));
    expect(searchIds(index, 'немного')).toEqual(['st-pin']);
  });

  it('keeps manual curated synonyms working on top of CLDR', () => {
    resetEmojiKeywordIndexForTests(realCldrIndex);
    // «хаха» — разговорный синоним из ручного словаря; CLDR для 😂
    // несёт «ха-ха»/haha, но не «хаха» — override не должен потеряться.
    const index = buildStickerSearchIndex(makeSections([makeSticker('st-lol', '😂')]));
    expect(searchIds(index, 'хаха')).toEqual(['st-lol']);
    // И CLDR-ветка того же эмодзи работает одновременно.
    expect(searchIds(index, 'ржач')).toEqual(['st-lol']);
  });

  it('multi-word queries still require every word to hit', () => {
    resetEmojiKeywordIndexForTests(realCldrIndex);
    const index = buildStickerSearchIndex(makeSections([makeSticker('st-owl', '🦉')]));
    expect(searchIds(index, 'мудрость сова')).toEqual(['st-owl']);
    expect(searchIds(index, 'мудрость пробирка')).toEqual([]);
  });

  it('falls back to the manual dictionary when the CLDR chunk is not loaded', () => {
    resetEmojiKeywordIndexForTests(null);
    // «кот» есть в ручном словаре — прежнее поведение сохраняется без
    // lazy-данных; «сова» при этом честно не находится (деградация к
    // исходному покрытию, а не к поломке).
    const index = buildStickerSearchIndex(makeSections([
      makeSticker('st-cat', '🐈'),
      makeSticker('st-owl', '🦉'),
    ]));
    expect(searchIds(index, 'кот')).toEqual(['st-cat']);
    expect(searchIds(index, 'сова')).toEqual([]);
  });

  it('keyword enrichment does not change emoji-token suggestions semantics', () => {
    resetEmojiKeywordIndexForTests(realCldrIndex);
    const index = buildStickerSearchIndex(makeSections([
      makeSticker('st-owl', '🦉'),
      makeSticker('st-cat', '🐈'),
    ]));
    const suggestions = collectStickerSuggestions(index, '🦉', 12);
    expect(suggestions.map((sticker) => sticker.id)).toEqual(['st-owl']);
  });
});

describe('sticker search regression without CLDR (manual dictionary only)', () => {
  it('emoji query matches the sticker emoji itself', () => {
    resetEmojiKeywordIndexForTests(null);
    const index = buildStickerSearchIndex(makeSections([makeSticker('st-duck', '🦆')]));
    expect(searchIds(index, '🦆')).toEqual(['st-duck']);
    expect(searchIds(index, 'утка')).toEqual(['st-duck']);
  });
});
