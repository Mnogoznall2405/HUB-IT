// Поиск и подсказки стикеров: локальный индекс по уже загруженным наборам,
// избранному и недавним. Объёмы малы (сотни стикеров), поэтому индекс строится
// в памяти за один проход без серверных запросов — как в Telegram Desktop.

import { containsEmoji, splitEmojiText } from '../../lib/chat/emojiImages';

const FE0F = '\uFE0F';

export const RECENT_STICKERS_LIMIT = 20;

// Событие «недавние изменились» — подсказки над композером и возможные
// параллельно смонтированные вкладки стикеров (поповер + скрытый док)
// держат одинаковый список без повторного чтения.
export const CHAT_STICKER_RECENTS_EVENT = 'chat-sticker-recents-changed';

// Ключ «недавних» привязан к scope пользователя И выбранной БД — та же
// пара, что в scope-ключе store (`userId::dbId` в api/chatStickers):
// списки разных БД-контекстов одного пользователя не смешиваются. Формат
// v2 появился с db-частью; v1 см. миграцию ниже.
export const buildRecentStorageKey = (currentUserId, databaseId = '') => (
  `hubit.chat.recent-stickers.v2:${String(currentUserId || 'device')}:${String(databaseId || '').trim() || 'default'}`
);

export const buildLegacyRecentStorageKey = (currentUserId) => (
  `hubit.chat.recent-stickers.v1:${String(currentUserId || 'device')}`
);

// Одноразовая миграция v1 → v2: legacy-ключ не нёс БД-контекста, поэтому
// его содержимое нельзя достоверно отнести к конкретной БД. Принимаем его
// в ПЕРВЫЙ текущий scope, который его прочитал, и сразу удаляем — иначе
// тот же список мигрировал бы повторно в scope другой БД.
export const migrateRecentStickerIds = (fromStorageKey, toStorageKey) => {
  if (typeof window === 'undefined' || !fromStorageKey || fromStorageKey === toStorageKey) return;
  try {
    const legacyRaw = window.localStorage.getItem(fromStorageKey);
    if (legacyRaw === null) return;
    if (window.localStorage.getItem(toStorageKey) === null) {
      window.localStorage.setItem(toStorageKey, legacyRaw);
    }
    window.localStorage.removeItem(fromStorageKey);
  } catch {
    // Без хранилища миграция не нужна.
  }
};

export const readRecentStickerIds = (storageKey) => {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || '[]');
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item || '').trim()).filter(Boolean).slice(0, RECENT_STICKERS_LIMIT)
      : [];
  } catch {
    return [];
  }
};

export const writeRecentStickerIds = (storageKey, stickerIds) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(stickerIds));
  } catch {
    // The picker still works when browser storage is unavailable.
  }
};

// Читает текущие «недавние», поднимает stickerId наверх и пишет обратно —
// общий шаг для всех поверхностей отправки (панель, подсказки).
export const rememberRecentStickerId = (storageKey, stickerId) => {
  const normalizedId = String(stickerId || '').trim();
  const current = readRecentStickerIds(storageKey);
  if (!normalizedId) return current;
  const next = [normalizedId, ...current.filter((item) => item !== normalizedId)]
    .slice(0, RECENT_STICKERS_LIMIT);
  writeRecentStickerIds(storageKey, next);
  return next;
};

export const notifyStickerRecentsChanged = (storageKey) => {
  try {
    window.dispatchEvent(new CustomEvent(CHAT_STICKER_RECENTS_EVENT, {
      detail: { storageKey: String(storageKey || '') },
    }));
  } catch {
    // CustomEvent может отсутствовать в очень старых оболочках.
  }
};

/* ─── Настройка «Предлагать стикеры при вводе эмодзи» ─── */

export const STICKER_SUGGESTIONS_STORAGE_KEY = 'hubit.chat.sticker-suggestions.v1';
export const STICKER_SUGGESTIONS_EVENT = 'hubit.chat.sticker-suggestions-changed';

export const readStickerSuggestionsEnabled = () => {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(STICKER_SUGGESTIONS_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
};

export const writeStickerSuggestionsEnabled = (enabled) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STICKER_SUGGESTIONS_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Без хранилища настройка живёт до конца сессии в состоянии компонента.
  }
  try {
    window.dispatchEvent(new Event(STICKER_SUGGESTIONS_EVENT));
  } catch {
    // Нет подписчиков — не страшно.
  }
};

/* ─── Ключевые слова эмодзи (RU + EN) ─── */
// Локальный словарь синонимов для самых частых эмодзи — без внешних
// зависимостей. Ключи нормализуются (FE0F срезается), поэтому записаны
// в привычном «презентационном» виде.
const STICKER_EMOJI_KEYWORDS_RAW = {
  '😀': 'улыбка smile happy grin радость',
  '😃': 'улыбка smile happy радость',
  '😄': 'улыбка smile happy смех',
  '😁': 'улыбка smile grin счастье',
  '😂': 'смех laugh хаха lol rofl улыбка слёзы смешно',
  '🤣': 'смех laugh хаха lol rofl улыбка смешно',
  '😊': 'улыбка smile добрый нежность blush довольный',
  '😉': 'подмигивание wink шутка флирт намёк',
  '😍': 'любовь love восторг сердце hearts влюблён глаза',
  '😘': 'поцелуй kiss любовь',
  '🥰': 'нежность love любовь милота влюблён',
  '😋': 'вкусно yummy еда слюнки',
  '😎': 'крутой cool очки swagger уверенный',
  '🤓': 'умный nerd очки ботан',
  '🥳': 'праздник party ура вечеринка',
  '😏': 'хитрый smirk намёк усмешка',
  '😌': 'спокойствие relief умиротворение',
  '😔': 'грусть sad печально',
  '😢': 'грусть sad плач cry слёзы',
  '😭': 'плач cry грусть sad рыдаю слёзы',
  '😤': 'злость angry фырк гордо',
  '😠': 'злость angry гнев mad',
  '😡': 'злость angry гнев mad ругань',
  '🤬': 'мат rage злость angry ругань',
  '🤯': 'взрыв shock mind blown шок мозг',
  '😳': 'смущение blush ой embarrassed',
  '🥺': 'просьба please умоляю жалобно глаза',
  '😨': 'страх fear ужас',
  '😱': 'страх fear ужас shock крик',
  '😰': 'пот тревога anxious страх',
  '😴': 'сон sleep устал sleepy дрем',
  '😪': 'сонный sleepy устал',
  '🤔': 'думаю think размышление hmm сомнение',
  '🤨': 'сомнение hmm подозрение скептик бровь',
  '🙄': 'глаза eye roll раздражение закатил',
  '😬': 'кривая улыбка grimace неловко',
  '🤐': 'молчу zip тишина секрет',
  '🤫': 'тихо shh тишина секрет',
  '🤥': 'вру lie ложь нос пиноккио',
  '😷': 'маска mask болезнь вирус',
  '🤒': 'болею sick болезнь градусник',
  '🤕': 'больно hurt травма голова',
  '🤢': 'тошнит sick рвота',
  '🤮': 'тошнит vomit рвота',
  '🥵': 'жарко hot жара',
  '🥶': 'холодно cold мороз freeze',
  '😵': 'головокружение dizzy шок',
  '🤠': 'ковбой cowboy шляпа',
  '😇': 'ангел innocent нимб святой невинность',
  '😈': 'дьявол devil злой улыбка',
  '🤡': 'клоун clown дурак цирк',
  '💩': 'какашка poop говно',
  '👻': 'призрак ghost бу',
  '💀': 'череп skull смерть умер',
  '☠️': 'череп skull смерть пират',
  '🤖': 'робот robot бот',
  '👽': 'пришелец alien нло инопланетянин',
  '👋': 'привет hello пока bye wave рука приветствие',
  '🖐': 'рука hand привет стоп пять',
  '✋': 'стоп stop hand рука',
  '✌️': 'победа victory peace мир',
  '🤞': 'удача luck надеюсь fingers crossed',
  '🤟': 'рок rock люблю жест',
  '🤘': 'рок rock металл рога',
  '🤙': 'звони call шака привет',
  '👈': 'налево left указатель',
  '👉': 'направо right указатель',
  '👆': 'наверх up указатель',
  '👇': 'вниз down указатель',
  '☝️': 'наверх up указатель внимание',
  '👍': 'лайк like ок ok да класс approve хорошо',
  '👎': 'дизлайк dislike нет no плохо',
  '✊': 'кулак fist сила',
  '👊': 'кулак fist бам привет',
  '👏': 'аплодисменты clap браво молодец',
  '🙌': 'ура hooray руки вверх',
  '👐': 'обнимаю hug руки открыты',
  '🤲': 'ладони hands просьба',
  '🤝': 'рукопожатие handshake deal договорились сделка',
  '🙏': 'спасибо thanks please молюсь надеюсь просьба',
  '💪': 'сила strong мышцы бицепс power',
  '👀': 'глаза eyes смотрю look вижу',
  '👁': 'глаз eye вижу смотрю',
  '🧠': 'мозг brain умный идея',
  '💋': 'поцелуй kiss губы',
  '💯': 'сто 100 отлично perfect точно согласен',
  '💥': 'взрыв boom удар',
  '💫': 'звёзды dizzy звезда sparkle',
  '🔥': 'огонь fire горячо топ lit класс',
  '✨': 'блёстки sparkle звёзды magic новое',
  '⭐': 'звезда star избранное',
  '🌟': 'звезда star сияние',
  '⚡': 'молния lightning быстрый заряд',
  '🌈': 'радуга rainbow',
  '☀️': 'солнце sun лето',
  '🌙': 'луна moon ночь',
  '❄️': 'снег snow зима холод',
  '☔': 'дождь rain зонт',
  '🎉': 'праздник party ура congrats поздравляю',
  '🎊': 'праздник party ура confetti',
  '🎂': 'день рождения birthday торт cake',
  '🎁': 'подарок gift сюрприз',
  '🎈': 'шарик balloon праздник',
  '🏆': 'победа win кубок чемпион',
  '🥇': 'золото medal первый win победа',
  '🏅': 'медаль medal победа',
  '⚽': 'футбол football мяч спорт',
  '🏀': 'баскетбол basketball мяч спорт',
  '🎮': 'игра game геймпад играть',
  '🎯': 'цель target точно дартс',
  '🚀': 'ракета rocket запуск старт быстрый',
  '✈️': 'самолёт plane полёт путешествие',
  '🚗': 'машина car авто поездка',
  '🚲': 'велосипед bike вело',
  '⏰': 'будильник alarm время утро',
  '⌚': 'часы watch время',
  '📌': 'пин pin закреп точка',
  '📎': 'скрепка clip вложение файл',
  '💼': 'портфель work работа кейс',
  '📅': 'календарь calendar дата',
  '💡': 'идея idea лампочка решение',
  '📢': 'объявление announce мегафон важно',
  '💰': 'деньги money мешок богатство',
  '💸': 'деньги money траты улетели',
  '📈': 'рост growth график прибыль',
  '📉': 'падение down график убыток',
  '✅': 'готово done check да верно',
  '❌': 'нет no отмена крест',
  '❓': 'вопрос question что',
  '❗': 'важно exclamation внимание',
  '⚠️': 'внимание warning осторожно',
  '🔒': 'замок lock закрыто приватно',
  '🔑': 'ключ key доступ пароль',
  '🔧': 'ключ tool настройки fix ремонт',
  '⚙️': 'шестерёнка gear settings настройки',
  '🖥': 'компьютер computer монитор работа',
  '💻': 'ноутбук laptop работа код',
  '⌨️': 'клавиатура keyboard ввод',
  '📱': 'телефон phone мобильный',
  '📞': 'звонок call трубка',
  '🎧': 'наушники headphones музыка',
  '🎵': 'музыка music нота',
  '📚': 'книги books учёба чтение',
  '✏️': 'карандаш pencil писать',
  '📝': 'заметка note писать текст',
  '🔍': 'поиск search лупа найти',
  '💬': 'сообщение message чат диалог',
  '📦': 'коробка box посылка package',
  '❤️': 'любовь love сердце heart красное',
  '🧡': 'любовь love сердце heart оранжевое',
  '💛': 'любовь love сердце heart жёлтое',
  '💚': 'любовь love сердце heart зелёное',
  '💙': 'любовь love сердце heart синее',
  '💜': 'любовь love сердце heart фиолетовое',
  '🖤': 'любовь love сердце heart чёрное',
  '🤍': 'любовь love сердце heart белое',
  '🤎': 'любовь love сердце heart коричневое',
  '💔': 'разбитое сердце heart broken грусть расставание',
  '❣️': 'сердце heart любовь восклицание',
  '💕': 'сердца hearts любовь love',
  '💖': 'сердце heart любовь блеск',
  '💗': 'сердце heart любовь растущее',
  '💘': 'сердце heart любовь купидон стрела',
  '💝': 'сердце heart подарок любовь',
  '👑': 'корона crown король лучший',
  '🐈': 'кот cat кошка мяу',
  '🐱': 'кот cat кошка морда мяу',
  '🐶': 'собака dog пёс гав морда',
  '🐕': 'собака dog пёс гав',
  '🦆': 'утка duck кря',
  '🐭': 'мышь mouse мышка',
  '🐰': 'кролик rabbit заяц морда',
  '🐻': 'медведь bear мишка морда',
  '🐼': 'панда panda медведь морда',
  '🦊': 'лиса fox лиса морда',
  '🐸': 'лягушка frog жаба ква',
  '🐥': 'цыплёнок chick жёлтый',
  '🦄': 'единорог unicorn магия',
  '🐝': 'пчела bee мёд',
  '🦋': 'бабочка butterfly',
  '🐢': 'черепаха turtle медленно',
  '🐍': 'змея snake',
  '🌸': 'цветок flower весна сакура',
  '🌹': 'роза rose цветы любовь',
  '🌺': 'цветок flower гибискус',
  '🍀': 'клевер luck удача',
  '🍎': 'яблоко apple фрукт',
  '🍕': 'пицца pizza еда',
  '🍔': 'бургер burger еда фастфуд',
  '🍩': 'пончик donut сладкое',
  '🍦': 'мороженое ice cream сладкое',
  '🍰': 'торт cake десерт сладкое',
  '☕': 'кофе coffee чай перерыв',
  '🍺': 'пиво beer выпить',
  '🍷': 'вино wine бокал',
  '🥂': 'бокалы cheers тост шампанское праздник',
  '🍾': 'шампанское champagne праздник бутылка',
  '💊': 'таблетка pill лекарство',
  '💤': 'сон sleep zzz спать',
};

const normalizeEmojiValue = (value) => String(value || '').split(FE0F).join('');

const STICKER_EMOJI_KEYWORDS = new Map(
  Object.entries(STICKER_EMOJI_KEYWORDS_RAW)
    .map(([emoji, keywords]) => [normalizeEmojiValue(emoji), keywords]),
);

export const normalizeStickerSearchQuery = (value) => (
  String(value || '').trim().toLowerCase()
);

// Все ключевые слова, относящиеся к эмодзи стикера: подстроки покрывают
// составные теги вроде «🔥😂» без отдельного разбора.
const keywordsForEmoji = (emojiNorm) => {
  if (!emojiNorm) return '';
  const collected = [];
  STICKER_EMOJI_KEYWORDS.forEach((keywords, emojiKey) => {
    if (emojiNorm.includes(emojiKey)) collected.push(keywords);
  });
  return collected.join(' ');
};

/* ─── Индекс по секциям стикеров ─── */
// Секции — та же модель, что у вкладки: pseudo «Недавние»/«Избранные»,
// затем наборы. Индекс лишь предвычисляет нормализованные haystack-строки.
export const buildStickerSearchIndex = (sections) => (
  (Array.isArray(sections) ? sections : []).map((section) => {
    const kind = section?.recent ? 'recent' : (section?.favorites ? 'favorites' : 'pack');
    return {
      id: String(section?.id || kind),
      title: String(section?.title || ''),
      kind,
      packNorm: kind === 'pack'
        ? normalizeStickerSearchQuery(`${section?.title || ''} ${section?.short_name || ''}`)
        : '',
      entries: (Array.isArray(section?.stickers) ? section.stickers : []).map((sticker) => {
        const emojiNorm = normalizeEmojiValue(sticker?.emoji);
        return {
          sticker,
          emojiNorm,
          keywordNorm: keywordsForEmoji(emojiNorm),
        };
      }),
    };
  })
);

// Совпадение по названию/short_name набора показывает набор целиком;
// иначе группа собирается из точечных попаданий по эмодзи и ключевым словам.
export const searchStickerIndex = (index, rawQuery) => {
  const query = normalizeStickerSearchQuery(rawQuery);
  if (!query) return [];
  const emojiNormQuery = normalizeEmojiValue(query);
  const emojiTokens = splitEmojiText(query)
    .filter((part) => part.type === 'emoji')
    .map((part) => normalizeEmojiValue(part.value))
    .filter(Boolean);
  // Текстовая часть запроса без эмодзи-символов — для совпадений по словам.
  const textNeedle = emojiTokens
    .reduce((acc, token) => acc.split(token).join(' '), emojiNormQuery)
    .replace(/\s+/g, ' ')
    .trim();
  const words = textNeedle ? textNeedle.split(' ') : [];

  const results = [];
  (Array.isArray(index) ? index : []).forEach((group) => {
    if (
      group.kind === 'pack'
      && group.packNorm
      && (group.packNorm.includes(query) || (words.length > 0 && words.every((word) => group.packNorm.includes(word))))
    ) {
      results.push({
        id: group.id,
        title: group.title,
        stickers: group.entries.map((entry) => entry.sticker),
      });
      return;
    }
    const matched = group.entries.filter(({ emojiNorm, keywordNorm }) => {
      const emojiHit = emojiTokens.some((token) => emojiNorm.includes(token))
        || emojiNorm.includes(emojiNormQuery);
      const keywordHit = words.length > 0
        && words.every((word) => keywordNorm.includes(word));
      return emojiHit || keywordHit;
    });
    if (matched.length > 0) {
      results.push({
        id: group.id,
        title: group.title,
        stickers: matched.map((entry) => entry.sticker),
      });
    }
  });
  return results;
};

/* ─── Подсказки над композером ─── */

// Последний токен ввода, если он эмодзи. Сегментируется только хвост строки:
// крайняя графема короче окна, а обрезка посередине ZWJ-последовательности
// всё равно оставляет валидный конечный токен.
export const getTrailingEmojiToken = (text) => {
  const value = String(text || '');
  if (!value || !containsEmoji(value)) return '';
  const tail = value.slice(-64);
  const parts = splitEmojiText(tail);
  const last = parts[parts.length - 1];
  return last && last.type === 'emoji' ? last.value : '';
};

// Подбор стикеров под введённый эмодзи: «недавние» и «избранные» идут
// первыми (порядок групп в индексе), дубликаты по id отсекаются.
export const collectStickerSuggestions = (index, emojiToken, limit = 12) => {
  const tokenNorm = normalizeEmojiValue(emojiToken);
  if (!tokenNorm) return [];
  const seen = new Set();
  const out = [];
  for (const group of Array.isArray(index) ? index : []) {
    for (const { sticker, emojiNorm } of group.entries) {
      const stickerId = String(sticker?.id || '');
      if (!stickerId || seen.has(stickerId)) continue;
      if (emojiNorm && (emojiNorm === tokenNorm || emojiNorm.includes(tokenNorm) || tokenNorm.includes(emojiNorm))) {
        seen.add(stickerId);
        out.push(sticker);
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
};
