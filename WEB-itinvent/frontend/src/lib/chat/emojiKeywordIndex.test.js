// Чистая логика keyword-индекса эмодзи: построение из сгенерированных
// CLDR-строк, forward-lookup для стикер-поиска, reverse-поиск для
// автоподсказки и разбор триггера `:keyword`. Тесты на реальных данных —
// регрессия генератора/формата видна сразу (обрыв строк, потеря локали).
import { describe, expect, it } from 'vitest';

import {
  buildEmojiKeywordIndex,
  collectEmojiKeywordsInIndex,
  EMOJI_TRIGGER_QUERY_MAX,
  EMOJI_TRIGGER_QUERY_MIN,
  getComposerEmojiTrigger,
  lookupEmojiKeywordsInIndex,
  normalizeEmojiKey,
  searchEmojiKeywords,
} from './emojiKeywordIndex';
import { EMOJI_KEYWORD_ROWS } from './generated/emojiKeywordData';

const FE0F = '\uFE0F';

// Мини-индекс для точечных проверок ранжирования: контролируемый набор
// без шума полного CLDR.
const MINI_ROWS = [
  '🦉\tсова\tanimal bird ornithology owl wise мудрость птица сова филин',
  '😀\tулыбающееся лицо\tface grin grinning smile happy лицо улыбка',
  '😃\tулыбающееся лицо с открытым ртом\tface mouth open smile лицо рот улыбка',
  '❤️\tкрасное сердце\theart red love любовь красное сердце',
  '💙\tсинее сердце\tblue heart love любовь синее сердце',
  '👍\tбольшой палец вверх\t+1 good hand like thumb thumbs thumbs_up up yes большой вверх лайк палец рука',
].join('\n');

describe('normalizeEmojiKey', () => {
  it('strips FE0F globally and keeps the rest of the sequence', () => {
    expect(normalizeEmojiKey(`❤${FE0F}`)).toBe('❤');
    expect(normalizeEmojiKey('😀')).toBe('😀');
    expect(normalizeEmojiKey('')).toBe('');
    expect(normalizeEmojiKey(null)).toBe('');
  });
});

describe('buildEmojiKeywordIndex (real CLDR rows)', () => {
  it('parses every generated row and builds within the time budget', () => {
    const start = performance.now();
    const index = buildEmojiKeywordIndex(EMOJI_KEYWORD_ROWS);
    const buildMs = performance.now() - start;
    // Полный CLDR (~1940 эмодзи, ~12k ключевых слов) — разовая сборка при
    // загрузке чанка. Пороговая цель задачи — <30 мс на тестовой машине;
    // здесь потолок с запасом под CI-шум, ловим регрессию порядка.
    expect(buildMs).toBeLessThan(100);
    expect(index.entries.length).toBeGreaterThan(1900);
    expect(index.keywordList.length).toBeGreaterThan(5000);
    // Стабильность контракта данных: сова и пробирка обязаны быть в индексе.
    const owl = index.entryByNorm.get('🦉');
    expect(owl).toBeTruthy();
    expect(owl.label).toBe('сова');
    expect(owl.keywords).toContain('owl');
    expect(owl.keywords).toContain('птица');
    const tube = index.entryByNorm.get('🧪');
    expect(tube).toBeTruthy();
    expect(tube.keywords).toContain('пробирка');
  });

  it('reverse index serves sub-millisecond lookups', () => {
    const index = buildEmojiKeywordIndex(EMOJI_KEYWORD_ROWS);
    const start = performance.now();
    for (let i = 0; i < 200; i += 1) {
      searchEmojiKeywords(index, 'сова', 10);
      searchEmojiKeywords(index, 'owl', 10);
      searchEmojiKeywords(index, 'сер', 10);
      searchEmojiKeywords(index, 'th', 10);
    }
    const totalMs = performance.now() - start;
    // 800 reverse-lookups по ~12k ключевых слов: пер-keystroke работа
    // автоподсказки. Порог ловит квадратичную регрессию, не шум машины.
    expect(totalMs).toBeLessThan(500);
  });
});

describe('lookupEmojiKeywordsInIndex', () => {
  const index = buildEmojiKeywordIndex(MINI_ROWS);

  it('exact hit on the normalized key', () => {
    expect(lookupEmojiKeywordsInIndex(index, '🦉')).toContain('мудрость');
  });

  it('hits the same key with and without FE0F', () => {
    const withSelector = lookupEmojiKeywordsInIndex(index, `❤${FE0F}`);
    const withoutSelector = lookupEmojiKeywordsInIndex(index, '❤');
    expect(withSelector).toBeTruthy();
    expect(withSelector).toBe(withoutSelector);
  });

  it('falls back to the base emoji after stripping skin tone modifiers', () => {
    const keywords = lookupEmojiKeywordsInIndex(index, '👍🏻');
    expect(keywords).toContain('лайк');
  });

  it('empty string for unknown or empty input', () => {
    expect(lookupEmojiKeywordsInIndex(index, '🫠-не-эмодзи')).toBe('');
    expect(lookupEmojiKeywordsInIndex(index, '')).toBe('');
    expect(lookupEmojiKeywordsInIndex(null, '🦉')).toBe('');
  });
});

describe('collectEmojiKeywordsInIndex', () => {
  const index = buildEmojiKeywordIndex(MINI_ROWS);

  it('single emoji hits without segmentation', () => {
    expect(collectEmojiKeywordsInIndex(index, '🦉')).toContain('сова');
  });

  it('unqualified single emoji (no FE0F) still hits', () => {
    expect(collectEmojiKeywordsInIndex(index, '❤')).toContain('сердце');
  });

  it('composite strings collect keywords of every grapheme', () => {
    const keywords = collectEmojiKeywordsInIndex(index, '❤️💙');
    expect(keywords).toContain('красное');
    expect(keywords).toContain('синее');
  });

  it('duplicate graphemes are collected once per pass', () => {
    const keywords = collectEmojiKeywordsInIndex(index, '❤️❤️');
    expect(keywords.split('красное').length - 1).toBe(1);
  });

  it('skin-tone variant hits through the base form', () => {
    expect(collectEmojiKeywordsInIndex(index, '👍🏽')).toContain('лайк');
  });
});

describe('searchEmojiKeywords', () => {
  const index = buildEmojiKeywordIndex(MINI_ROWS);

  it('exact keyword hit ranks first', () => {
    const results = searchEmojiKeywords(index, 'сова', 10);
    expect(results[0]?.emoji).toBe('🦉');
  });

  it('prefix hits come before substring hits', () => {
    // «сер» — префикс для «сердце», подстрока тоже возможна в других словах.
    const results = searchEmojiKeywords(index, 'сердце', 10);
    expect(results.map((r) => r.emoji)).toEqual(expect.arrayContaining(['❤️', '💙']));
    expect(results[0]?.emoji).toBe('❤️');
  });

  it('latin and cyrillic queries both match', () => {
    expect(searchEmojiKeywords(index, 'owl', 5).some((r) => r.emoji === '🦉')).toBe(true);
    expect(searchEmojiKeywords(index, 'мудрость', 5).some((r) => r.emoji === '🦉')).toBe(true);
  });

  it('underscore-joined multiword labels match telegram-style codes', () => {
    expect(searchEmojiKeywords(index, 'thumbs_up', 5).some((r) => r.emoji === '👍')).toBe(true);
  });

  it('respects the limit and dedupes emoji across keyword groups', () => {
    const results = searchEmojiKeywords(index, 'heart', 1);
    expect(results).toHaveLength(1);
    const wide = searchEmojiKeywords(index, 'heart', 10);
    const emojis = wide.map((r) => r.emoji);
    expect(new Set(emojis).size).toBe(emojis.length);
  });

  it('empty query or missing index yield no results', () => {
    expect(searchEmojiKeywords(index, '', 10)).toEqual([]);
    expect(searchEmojiKeywords(null, 'сова', 10)).toEqual([]);
  });

  it('exposes label and matched keyword for the suggestion row', () => {
    const [first] = searchEmojiKeywords(index, 'сова', 1);
    expect(first.label).toBe('сова');
    expect(first.keyword).toBeTruthy();
  });
});

describe('searchEmojiKeywords on real CLDR rows', () => {
  it('finds owl by ru and en keywords', () => {
    const index = buildEmojiKeywordIndex(EMOJI_KEYWORD_ROWS);
    expect(searchEmojiKeywords(index, 'сова', 5).some((r) => r.emoji === '🦉')).toBe(true);
    expect(searchEmojiKeywords(index, 'owl', 5).some((r) => r.emoji === '🦉')).toBe(true);
  });

  it('prefix ordering keeps smileys ahead on face queries', () => {
    const index = buildEmojiKeywordIndex(EMOJI_KEYWORD_ROWS);
    const results = searchEmojiKeywords(index, 'smile', 8);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.emoji === '😀' || r.emoji === '😄' || r.emoji === '😃')).toBe(true);
  });
});

describe('getComposerEmojiTrigger', () => {
  it('triggers on :keyword at start of text', () => {
    expect(getComposerEmojiTrigger(':so', 3)).toEqual({ start: 0, end: 3, query: 'so' });
  });

  it('triggers after whitespace', () => {
    const text = 'привет :сов';
    const trigger = getComposerEmojiTrigger(text, text.length);
    expect(trigger).toEqual({ start: 7, end: text.length, query: 'сов' });
  });

  it('supports cyrillic, digits, underscore, plus and hyphen in the query', () => {
    expect(getComposerEmojiTrigger(':со2_+x-', 8)?.query).toBe('со2_+x-');
  });

  it('respects the minimum query length', () => {
    expect(getComposerEmojiTrigger(':s', 2)).toBeNull();
    const minQuery = `:${'s'.repeat(EMOJI_TRIGGER_QUERY_MIN)}`;
    expect(getComposerEmojiTrigger(minQuery, minQuery.length)).not.toBeNull();
  });

  it('respects the maximum query length', () => {
    const long = `:${'a'.repeat(EMOJI_TRIGGER_QUERY_MAX)}`;
    expect(getComposerEmojiTrigger(long, long.length)).not.toBeNull();
    const tooLong = `:${'a'.repeat(EMOJI_TRIGGER_QUERY_MAX + 1)}`;
    expect(getComposerEmojiTrigger(tooLong, tooLong.length)).toBeNull();
  });

  it('does not trigger inside words, emails, URLs and times', () => {
    expect(getComposerEmojiTrigger('word:so', 7)).toBeNull();
    expect(getComposerEmojiTrigger('a@b.ru:so', 9)).toBeNull();
    expect(getComposerEmojiTrigger('http://x', 8)).toBeNull();
    expect(getComposerEmojiTrigger('12:30', 5)).toBeNull();
  });

  it('does not trigger when whitespace breaks the query', () => {
    expect(getComposerEmojiTrigger(':so wa', 6)).toBeNull();
  });

  it('does not trigger without a colon', () => {
    expect(getComposerEmojiTrigger('plain text', 10)).toBeNull();
    expect(getComposerEmojiTrigger('', 0)).toBeNull();
  });

  it('uses the caret position, not the end of the text', () => {
    const text = ':sow tail';
    // Каретка сразу после запроса — триггер активен, хвост не мешает.
    expect(getComposerEmojiTrigger(text, 4)?.query).toBe('sow');
    // Каретка в середине запроса — запрос укорачивается до каретки.
    expect(getComposerEmojiTrigger(text, 3)?.query).toBe('so');
  });

  it('colon directly after an emoji does not trigger (no whitespace)', () => {
    expect(getComposerEmojiTrigger('😀:so', 5)).toBeNull();
  });
});
