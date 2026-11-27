// Единый индекс ключевых слов эмодзи (Unicode CLDR, RU+EN) для двух
// потребителей:
//   1) поиск стикеров — forward-словарь «эмодзи → ключевые слова»
//      (components/chat/stickerSearchIndex.js);
//   2) автоподсказка эмодзи в композере по `:keyword` — reverse-поиск
//      «ключевое слово → эмодзи» (components/chat/ChatEmojiSuggestions.jsx).
//
// Данные — сгенерированный модуль generated/emojiKeywordData.js
// (emojibase-data, см. scripts/generate-emoji-keywords.mjs). Он тяжёлый
// (~370 КиБ исходника), поэтому загружается отдельным lazy-чанком: чистые
// функции buildEmojiKeywordIndex/searchEmojiKeywords принимают строки
// напрямую и тестируются без чанка, а ensureEmojiKeywordIndex() грузит и
// строит индекс один раз за сессию. Статичные данные не зависят от
// стикер-каталога — версия индекса монотонно растёт при готовности, и
// потребители перестраивают производные по этой версии.

import { splitEmojiText } from './emojiImages';

const FE0F = '\uFE0F';
// Модификаторы тона кожи: точное совпадение в forward-индексе не находит
// 👍🏻 (строки вариантов не генерируются), поэтому lookup повторяется
// после их срезки — базовая форма несёт те же ключевые слова.
const SKIN_TONE_MODIFIER = /[\u{1F3FB}-\u{1F3FF}]/gu;

// Та же нормализация, что у normalizeEmojiValue в stickerSearchIndex:
// FE0F срезается глобально, чтобы квалифицированные и неквалифицированные
// формы одного эмодзи сходились в один ключ.
export const normalizeEmojiKey = (value) => String(value || '').split(FE0F).join('');

/* ─── Чистое построение индекса (node-тестируемо) ─── */

// rows — строки формата `<emoji>\t<label>\t<keywords>`, склеенные \n.
// Возвращает:
//   forward:      Map<emojiNorm, keywordsString> — для стикер-поиска;
//   entries:      [{ emoji, emojiNorm, label, keywords }] в unicode-порядке;
//   entryByNorm:  Map<emojiNorm, entry>;
//   keywordMap:   Map<keyword, entry[]> — reverse-индекс, эмодзи в unicode-порядке;
//   keywordList:  отсортированный массив уникальных ключевых слов.
export function buildEmojiKeywordIndex(rows) {
  const forward = new Map();
  const entries = [];
  const entryByNorm = new Map();
  const keywordMap = new Map();

  String(rows || '').split('\n').forEach((row) => {
    if (!row) return;
    const tab1 = row.indexOf('\t');
    const tab2 = row.indexOf('\t', tab1 + 1);
    if (tab1 < 0 || tab2 < 0) return;
    const emoji = row.slice(0, tab1);
    const label = row.slice(tab1 + 1, tab2);
    const keywords = row.slice(tab2 + 1);
    const emojiNorm = normalizeEmojiKey(emoji);
    if (!emojiNorm) return;
    const entry = { emoji, emojiNorm, label, keywords };
    entries.push(entry);
    if (!entryByNorm.has(emojiNorm)) entryByNorm.set(emojiNorm, entry);
    forward.set(emojiNorm, keywords);
    keywords.split(' ').forEach((keyword) => {
      if (!keyword) return;
      let list = keywordMap.get(keyword);
      if (!list) {
        list = [];
        keywordMap.set(keyword, list);
      }
      list.push(entry);
    });
  });

  const keywordList = Array.from(keywordMap.keys()).sort();
  return { forward, entries, entryByNorm, keywordMap, keywordList };
}

// Ключевые слова одного эмодзи-графемы: точное совпадение, затем повтор
// без модификаторов тона (👍🏻 → 👍). Вход нормализуется внутри — вызывающий
// может передавать как квалифицированную, так и сырую форму. Пустая
// строка, если эмодзи неизвестен.
export function lookupEmojiKeywordsInIndex(index, emojiValue) {
  const emojiNorm = normalizeEmojiKey(emojiValue);
  if (!index || !emojiNorm) return '';
  const exact = index.forward.get(emojiNorm);
  if (exact !== undefined) return exact;
  const stripped = emojiNorm.replace(SKIN_TONE_MODIFIER, '');
  if (stripped && stripped !== emojiNorm) {
    return index.forward.get(stripped) || '';
  }
  return '';
}

// Ключевые слова для произвольной эмодзи-строки стикера. Принимает СЫРОЕ
// значение (с FE0F, если оно было): сегментация графем корректно узнаёт
// текстово-презентационные эмодзи только в квалифицированной форме.
// Порядок работы:
//   1) точное совпадение всей строки (одиночный эмодзи — основной случай,
//    заодно покрывает неквалифицированный ввод вроде «❤» без FE0F —
//    ключи индекса нормализованы так же);
//   2) составная строка «🔥😂» — сегментация на графемы и сбор по каждой.
// Это O(графемы) вместо сканирования всего словаря подстрокой — критично
// при полном CLDR-индексе (~2k ключей).
export function collectEmojiKeywordsInIndex(index, emojiRaw) {
  const raw = String(emojiRaw || '');
  if (!index || !raw) return '';
  const wholeNorm = normalizeEmojiKey(raw);
  const wholeHit = lookupEmojiKeywordsInIndex(index, wholeNorm);
  if (wholeHit) return wholeHit;
  const collected = [];
  const seenGraphemes = new Set();
  splitEmojiText(raw).forEach((part) => {
    if (part.type !== 'emoji') return;
    const graphemeNorm = normalizeEmojiKey(part.value);
    if (!graphemeNorm || seenGraphemes.has(graphemeNorm)) return;
    seenGraphemes.add(graphemeNorm);
    const keywords = lookupEmojiKeywordsInIndex(index, graphemeNorm);
    if (keywords) collected.push(keywords);
  });
  return collected.join(' ');
}

/* ─── Reverse-поиск для автоподсказки ─── */

// Ранжирование: точное совпадение ключевого слова → префикс (короче —
// раньше) → подстрока. Внутри ключевого слова эмодзи идут в unicode-порядке
// (смайлы раньше объектов). Один проход по отсортированному списку
// ключевых слов — субмиллисекундная работа на ~12k слов, без debounce.
export function searchEmojiKeywords(index, rawQuery, limit = 10) {
  const query = String(rawQuery || '').trim().toLowerCase();
  if (!index || !query) return [];
  const exact = [];
  const prefix = [];
  const substring = [];
  const { keywordList } = index;
  for (let i = 0; i < keywordList.length; i += 1) {
    const keyword = keywordList[i];
    if (keyword === query) exact.push(keyword);
    else if (keyword.startsWith(query)) prefix.push(keyword);
    else if (keyword.includes(query)) substring.push(keyword);
  }
  const byLengthAsc = (a, b) => (a.length - b.length) || (a < b ? -1 : 1);
  prefix.sort(byLengthAsc);
  substring.sort(byLengthAsc);

  const seen = new Set();
  const out = [];
  const cap = Math.max(1, Number(limit) || 10);
  const pushKeyword = (keyword) => {
    const list = index.keywordMap.get(keyword) || [];
    for (let i = 0; i < list.length; i += 1) {
      const entry = list[i];
      if (seen.has(entry.emojiNorm)) continue;
      seen.add(entry.emojiNorm);
      out.push({ emoji: entry.emoji, emojiNorm: entry.emojiNorm, label: entry.label, keyword });
      if (out.length >= cap) return true;
    }
    return false;
  };
  for (const tier of [exact, prefix, substring]) {
    for (const keyword of tier) {
      if (pushKeyword(keyword)) return out;
    }
  }
  return out;
}

/* ─── Триггер `:keyword` в композере ─── */

// Порог как в Telegram Desktop: одиночный символ после двоеточия ещё не
// открывает подсказку — иначе «:)»-подобный ввод мешал бы печатать.
export const EMOJI_TRIGGER_QUERY_MIN = 2;
export const EMOJI_TRIGGER_QUERY_MAX = 32;
// Буквы любого алфавита (latin+cyrillic покрыты \p{L}), цифры, `_+-` —
// как в токене упоминания. Пробелы и прочая пунктуация разрывают запрос.
const EMOJI_TRIGGER_QUERY_RE = /^[\p{L}\p{N}_+-]*$/u;

// Тот же контур, что у getComposerMentionTrigger: триггер `:` действует
// только в начале строки или после whitespace — время «12:30», URL-схемы
// и двоеточия внутри слов подсказку не открывают.
export function getComposerEmojiTrigger(value, caretPosition) {
  const text = String(value || '');
  const caret = Math.max(0, Math.min(Number(caretPosition ?? text.length), text.length));
  const beforeCaret = text.slice(0, caret);
  const colonIndex = beforeCaret.lastIndexOf(':');
  if (colonIndex < 0) return null;
  const charBeforeColon = colonIndex > 0 ? beforeCaret[colonIndex - 1] : '';
  if (charBeforeColon && !/\s/.test(charBeforeColon)) return null;
  const query = beforeCaret.slice(colonIndex + 1);
  if (query.length < EMOJI_TRIGGER_QUERY_MIN || query.length > EMOJI_TRIGGER_QUERY_MAX) return null;
  if (!EMOJI_TRIGGER_QUERY_RE.test(query)) return null;
  return {
    start: colonIndex,
    end: caret,
    query,
  };
}

/* ─── Ленивая загрузка сгенерированных данных ─── */

const loaderState = {
  status: 'idle', // idle | loading | ready | error
  index: null,
  version: 0,
  promise: null,
};
const listeners = new Set();

export const subscribeEmojiKeywordIndex = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// Растёт один раз при готовности индекса — store стикеров перестраивает
// производные по смене версии, подсказки перечитывают выдачу.
export const getEmojiKeywordIndexVersion = () => loaderState.version;
export const peekEmojiKeywordIndex = () => loaderState.index;
export const getEmojiKeywordIndexStatus = () => loaderState.status;

export function ensureEmojiKeywordIndex() {
  if (loaderState.promise) return loaderState.promise;
  loaderState.status = 'loading';
  loaderState.promise = import('./generated/emojiKeywordData.js')
    .then((module) => {
      const index = buildEmojiKeywordIndex(module.EMOJI_KEYWORD_ROWS);
      loaderState.index = index;
      loaderState.status = 'ready';
      loaderState.version += 1;
      listeners.forEach((listener) => {
        try { listener(); } catch { /* подписчик не должен ломать загрузку */ }
      });
      return index;
    })
    .catch(() => {
      // Ошибка чанка (офлайн-старт) не навсегда: следующий ensure повторит.
      loaderState.status = 'error';
      loaderState.promise = null;
      return null;
    });
  return loaderState.promise;
}

// Прогрев в idle-время: первый `:keyword` или поиск стикеров встречает
// готовый индекс. Вызывается при монтировании композера; повторы — no-op.
export function prefetchEmojiKeywordIndex() {
  if (loaderState.status === 'ready' || loaderState.status === 'loading') return;
  if (typeof window === 'undefined') return;
  const schedule = typeof window.requestIdleCallback === 'function'
    ? window.requestIdleCallback.bind(window)
    : (cb) => window.setTimeout(cb, 1500);
  schedule(() => { void ensureEmojiKeywordIndex(); }, { timeout: 4000 });
}

// Тестовый сброс: индекс процессно-глобальный, между suites состояние
// не должно перетекать (аналог invalidateChatStickerStore).
export const resetEmojiKeywordIndexForTests = (prebuiltIndex = null) => {
  loaderState.status = prebuiltIndex ? 'ready' : 'idle';
  loaderState.index = prebuiltIndex;
  loaderState.version = prebuiltIndex ? loaderState.version + 1 : 0;
  loaderState.promise = null;
  listeners.forEach((listener) => {
    try { listener(); } catch { /* noop */ }
  });
};
