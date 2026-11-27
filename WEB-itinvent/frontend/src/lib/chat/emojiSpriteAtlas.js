// Issue #89 — sprite-атлас эмодзи по модели Telegram Desktop.
//
// Вместо ~180 отдельных PNG на холодное открытие панели эмодзи в picker'е
// рисуются фоном КНОПКИ из заранее собранных листов public/emoji-atlas/sheet-*.png
// (32x16 ячеек по 64px, lossless PNG — пиксели идентичны текущему рендеру).
// Позиции развешены сгенерированным CSS по data-unified, который picker ставит
// на каждую кнопку; getEmojiUrl для индексированных эмодзи возвращает прозрачный
// пиксель (сеть/декодирование 126+ мелких PNG уходят с критического пути), для
// неиндексированных (вариации тона кожи, 3 эмодзи без apple-ассета) — прежний PNG,
// так что поведение fallback не меняется.
//
// Фон именно на кнопке, а не на <img> (итерация 2): правый компаунд селектора
// `.epr-emoji[data-unified="x"]` матчится одним сравнением атрибута на самой
// кнопке, тогда как img-вариант заставлял каждый img прогонять все правила с
// обходом предков — это давало +67 ms к firstEmojiDom на 1895 правилах.
//
// CSS инжектится рантаймом, потому что абсолютный путь листов зависит от
// import.meta.env.BASE_URL (деплой в виртуальный каталог), которого статический
// CSS не знает.

import {
  EMOJI_SPRITE_CELLS_PER_SHEET,
  EMOJI_SPRITE_COLS,
  EMOJI_SPRITE_ORDER,
  EMOJI_SPRITE_SHEET_FILES,
} from './generated/emojiSpriteData';
import spriteCssTemplate from './generated/emojiSprites.css?raw';
import { emojiImageUrl } from './emojiImages';

// 1x1 прозрачный gif — одинаковый для всех индексированных эмодзи: браузер
// декодирует его один раз и переиспользует, сетевых запросов нет совсем.
const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

let spriteIndex = null;

function getSpriteIndex() {
  if (spriteIndex === null) {
    spriteIndex = new Map();
    EMOJI_SPRITE_ORDER.split(' ').forEach((unified, idx) => {
      spriteIndex.set(unified, idx);
    });
  }
  return spriteIndex;
}

// Измерительный seam для A/B-харнесса issue #89 (не пользовательский флаг):
// cold-контексты прогона выставляют window.__HUBIT_EMOJI_SPRITE_OFF__ до загрузки
// приложения — тогда панель работает точно как до атласа (отдельные PNG).
const spritesDisabled = () => Boolean(
  typeof window !== 'undefined' && window.__HUBIT_EMOJI_SPRITE_OFF__,
);

export function hasEmojiSprite(unified) {
  if (spritesDisabled()) return false;
  return getSpriteIndex().has(String(unified || '').toLowerCase());
}

// Имена листов содержат content-hash (см. генератор): при смене эмодзи-данных
// меняется URL, поэтому старый закэшированный лист никогда не встретит новые
// позиции CSS — cache-invalidation не зависит от max-age статики.
export function getEmojiSpriteSheetUrl(sheet) {
  return `${getEmojiSpriteAssetBase()}${EMOJI_SPRITE_SHEET_FILES[sheet]}`;
}

export function getEmojiSpriteAssetBase() {
  const base = String(import.meta.env?.BASE_URL || '/');
  return `${base.endsWith('/') ? base : `${base}/`}emoji-atlas/`;
}

// Инжектит сгенерированный CSS один раз за сессию. Возвращает true, если стили
// активны (в тестах jsdom CSS-inject тоже работает — поведение детерминировано).
export function ensureEmojiSpriteStyles() {
  if (typeof document === 'undefined') return false;
  if (spritesDisabled()) return false;
  if (document.getElementById('chat-emoji-sprite-styles')) return true;
  const style = document.createElement('style');
  style.id = 'chat-emoji-sprite-styles';
  style.textContent = spriteCssTemplate.replaceAll('{base}', getEmojiSpriteAssetBase());
  document.head.appendChild(style);
  return true;
}

// Unified с модификатором тона кожи как компонентом последовательности
// (1f3fb..1f3ff). В нейтральных эмодзи эти кодпоинты не встречаются.
const SKIN_TONE_COMPONENT_RE = /(^|-)1f3f[b-f](-|$)/;

// getEmojiUrl для picker'а: индексированные эмодзи рисуются спрайтом —
// img получает прозрачный пиксель; остальные — прежний apple PNG.
export function getSpriteAwareEmojiUrl(unified) {
  if (hasEmojiSprite(unified)) return TRANSPARENT_PIXEL;
  // Вариации тона кожи не индексированы в атласе, но и сеть для них не нужна:
  // в панели чата skinTonesDisabled (UI тонов скрыт), поэтому ОТРЕНДЕРИТЬ их
  // негде, а единственный реальный потребитель — preloadEmojiIfNeeded picker'а —
  // иначе грузит ~5 PNG на каждый эмодзи с вариациями чуть ниже вьюпорта
  // (~50 лишних запросов на холодное открытие) и конкурирует за 6 соединений
  // HTTP/1.1 с листом атласа в критическое окно.
  // ВНИМАНИЕ: это опирается на skinTonesDisabled панели чата. Если тоны когда-
  // либо включат, вариации станут невидимыми — сначала расширить атлас на
  // вариации или убрать эту ветку (см. раздел рисков отчёта issue #89).
  if (SKIN_TONE_COMPONENT_RE.test(String(unified || '').toLowerCase())) {
    return TRANSPARENT_PIXEL;
  }
  return emojiImageUrl(unified);
}

// Позиция ячейки для отладки/тестов: { sheet, x, y } или null.
export function getEmojiSpritePos(unified) {
  const key = String(unified || '').toLowerCase();
  const idx = getSpriteIndex().get(key);
  if (idx === undefined) return null;
  const sheet = Math.floor(idx / EMOJI_SPRITE_CELLS_PER_SHEET);
  const cell = idx % EMOJI_SPRITE_CELLS_PER_SHEET;
  return { sheet, x: cell % EMOJI_SPRITE_COLS, y: Math.floor(cell / EMOJI_SPRITE_COLS) };
}

export { TRANSPARENT_PIXEL as EMOJI_SPRITE_TRANSPARENT_PIXEL };
