// Окно рендера ленты чата. Загруженные сообщения остаются в state целиком
// (merge, поиск, read receipts, failed-пузыри работают с полным списком), а в
// DOM монтируется только непрерывный срез ≤ CHAT_RENDER_WINDOW_MAX сообщений.
// Окно сдвигается страницами по CHAT_RENDER_WINDOW_STEP, когда прокрутка
// подходит к его краю; позиция удерживается якорем (как при prepend истории).
//
// Состояние окна хранится в идентификаторах сообщений, а не в индексах, чтобы
// prepend/append не сдвигали срез:
//   startId: null — окно прижато к началу загруженной истории (prepend страницы
//            истории попадает в окно), иначе id первого смонтированного;
//   endId:   null — окно следует за хвостом (новые сообщения монтируются),
//            иначе id последнего смонтированного;
//   keep:    какой край сохранять при превышении лимита: 'bottom' — хвост
//            (обрезается верх), 'top' — начало (обрезается низ).

export const CHAT_RENDER_WINDOW_MAX = 240;
export const CHAT_RENDER_WINDOW_STEP = 80;

export const CHAT_RENDER_WINDOW_TAIL = Object.freeze({ startId: null, endId: null, keep: 'bottom' });

const normalizeId = (value) => String(value || '').trim();

export function buildRenderWindowIndex(ids) {
  const indexById = new Map();
  (Array.isArray(ids) ? ids : []).forEach((id, index) => {
    const normalized = normalizeId(id);
    if (normalized && !indexById.has(normalized)) indexById.set(normalized, index);
  });
  return indexById;
}

/**
 * Разрешает состояние окна в полуинтервал [start, end) индексов сообщений.
 * `fallback` — предыдущий разрешённый срез: используется, если сообщение-граница
 * исчезло из списка (удаление/замена id), чтобы окно не прыгало в начало/хвост.
 */
export function resolveRenderWindow({
  ids,
  indexById = buildRenderWindowIndex(ids),
  state = CHAT_RENDER_WINDOW_TAIL,
  fallback = null,
  max = CHAT_RENDER_WINDOW_MAX,
  step = CHAT_RENDER_WINDOW_STEP,
} = {}) {
  const total = Array.isArray(ids) ? ids.length : 0;
  if (total <= 0) return { start: 0, end: 0, total: 0 };
  const clamp = (value) => Math.max(0, Math.min(total, Number(value) || 0));

  let start = 0;
  if (state?.startId) {
    const index = indexById.get(normalizeId(state.startId));
    start = Number.isInteger(index) ? index : clamp(fallback?.start);
  }
  let end = total;
  if (state?.endId) {
    const index = indexById.get(normalizeId(state.endId));
    end = Number.isInteger(index) ? index + 1 : clamp(fallback?.end || total);
  }
  if (end <= start) {
    // Повреждённые границы — ближайшее корректное окно вокруг start.
    end = Math.min(total, start + max);
    if (end <= start) start = Math.max(0, end - max);
  }

  const excess = (end - start) - max;
  if (excess > 0) {
    if (state?.keep === 'top') {
      end = start + max;
    } else {
      // Обрезаем верх порциями по `step`: первый смонтированный элемент меняется
      // раз в `step` новых сообщений, а не на каждом (меньше перестроек и
      // компенсаций прокрутки, когда лента следует за хвостом).
      const trimmed = Math.ceil(excess / Math.max(1, step)) * Math.max(1, step);
      start = Math.min(end - 1, start + trimmed);
    }
  }
  return { start, end, total };
}

const stateFromRange = (ids, start, end, keep) => {
  const total = ids.length;
  return {
    startId: start <= 0 ? null : normalizeId(ids[start]),
    endId: end >= total ? null : normalizeId(ids[end - 1]),
    keep,
  };
};

/** Показать ещё `step` более ранних сообщений (уже загруженных) над окном. */
export function expandRenderWindowOlder(ids, range, { max = CHAT_RENDER_WINDOW_MAX, step = CHAT_RENDER_WINDOW_STEP } = {}) {
  const list = Array.isArray(ids) ? ids : [];
  const start = Math.max(0, Number(range?.start || 0) - step);
  const end = Math.min(Number(range?.end ?? list.length), start + max);
  return stateFromRange(list, start, Math.max(start + 1, end), 'top');
}

/** Показать ещё `step` более поздних сообщений под окном. */
export function expandRenderWindowNewer(ids, range, { max = CHAT_RENDER_WINDOW_MAX, step = CHAT_RENDER_WINDOW_STEP } = {}) {
  const list = Array.isArray(ids) ? ids : [];
  const end = Math.min(list.length, Number(range?.end || 0) + step);
  const start = Math.max(Number(range?.start || 0), end - max);
  return stateFromRange(list, start, end, 'bottom');
}

/** Окно с сообщением `messageId` посередине; null — сообщения нет в списке. */
export function centerRenderWindowOn(ids, messageId, { indexById = null, max = CHAT_RENDER_WINDOW_MAX } = {}) {
  const list = Array.isArray(ids) ? ids : [];
  const index = (indexById || buildRenderWindowIndex(list)).get(normalizeId(messageId));
  if (!Number.isInteger(index)) return null;
  let start = Math.max(0, index - Math.floor(max / 2));
  const end = Math.min(list.length, start + max);
  start = Math.max(0, end - max);
  return stateFromRange(list, start, end, 'top');
}

/**
 * Перед сетевой догрузкой старой истории окно прижимается к началу, чтобы
 * пришедшая страница смонтировалась над текущим якорем (а не скрылась).
 */
export function pinRenderWindowToHead(ids, range) {
  const list = Array.isArray(ids) ? ids : [];
  const end = Number(range?.end ?? list.length);
  return {
    startId: null,
    endId: end >= list.length ? null : normalizeId(list[end - 1]),
    keep: 'top',
  };
}

export function isSameRenderWindowState(left, right) {
  return normalizeId(left?.startId) === normalizeId(right?.startId)
    && normalizeId(left?.endId) === normalizeId(right?.endId)
    && String(left?.keep || 'bottom') === String(right?.keep || 'bottom');
}

/**
 * Срез timeline (даты, разделитель «Непрочитанные», сообщения) для окна.
 * Маркеры, стоящие прямо перед первым сообщением окна, входят в срез; если
 * окно начинается посреди дня — сверху показывается маркер этого дня.
 */
export function sliceTimelineForRenderWindow(timelineItems, range) {
  const items = Array.isArray(timelineItems) ? timelineItems : [];
  const start = Number(range?.start || 0);
  const end = Number(range?.end || 0);
  if (end <= start || !items.length) return [];
  let messageIndex = -1;
  let firstItemIndex = -1;
  let lastItemIndex = -1;
  for (let index = 0; index < items.length; index += 1) {
    if (items[index]?.type !== 'message') continue;
    messageIndex += 1;
    if (messageIndex === start) firstItemIndex = index;
    if (messageIndex === end - 1) {
      lastItemIndex = index;
      break;
    }
  }
  if (firstItemIndex < 0 || lastItemIndex < 0) return [];
  let sliceStart = firstItemIndex;
  while (sliceStart > 0 && items[sliceStart - 1]?.type !== 'message') sliceStart -= 1;
  const slice = items.slice(sliceStart, lastItemIndex + 1);
  if (slice[0]?.type !== 'date') {
    for (let index = sliceStart - 1; index >= 0; index -= 1) {
      if (items[index]?.type === 'date') {
        slice.unshift(items[index]);
        break;
      }
    }
  }
  return slice;
}

// Реестр контроллеров окна по scroll-контейнеру ленты: страница чата
// (переход к сообщению, «вниз», кнопка «к последним») обращается к окну через
// тот же threadScrollRef, не протаскивая новые пропсы через все слои.
const renderWindowRegistry = new WeakMap();

export function registerChatThreadRenderWindow(container, controller) {
  if (!container || typeof container !== 'object') return () => {};
  renderWindowRegistry.set(container, controller);
  return () => {
    if (renderWindowRegistry.get(container) === controller) renderWindowRegistry.delete(container);
  };
}

export function getChatThreadRenderWindow(container) {
  if (!container || typeof container !== 'object') return null;
  return renderWindowRegistry.get(container) || null;
}
