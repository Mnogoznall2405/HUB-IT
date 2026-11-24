// Матрица гонок единого sticker store. E2E/компонентные тесты покрывают
// happy path вкладки; здесь — переходы состояний, которые через UI
// воспроизводятся только таймингом: сериализация мутаций избранного,
// проигрыш журнала операций поверх поздних ответов, точечный откат,
// сброс по смене поколения и самовосстановление после устаревшего
// ответа listPacks.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  chatStickersAPI,
  peekStickerPacksCache,
  scheduleRecentStickersSync,
} from '../api/chatStickers';
import {
  applyStickerPacks,
  clearRecentStickers,
  ensureChatStickerData,
  getStickerScopeDerived,
  invalidateChatStickerStore,
  peekStickerScopeRecord,
  rememberRecentSticker,
  removeRecentSticker,
  setStickerPackItems,
  subscribeChatStickerStore,
  toggleFavoriteSticker,
} from './chatStickerStore';

const stickerEpochRef = { value: 0 };
vi.mock('../api/chatStickers', () => {
  const chatStickersAPI = {
    listPacks: vi.fn(),
    listFavorites: vi.fn(),
    addFavoriteSticker: vi.fn(),
    removeFavoriteSticker: vi.fn(),
    listRecentStickers: vi.fn(),
    pushRecentStickers: vi.fn(),
  };
  return {
    chatStickersAPI,
    scheduleRecentStickersSync: vi.fn(),
    cancelRecentStickersSync: vi.fn(),
    getStickerPacksEpoch: vi.fn(() => stickerEpochRef.value),
    peekStickerPacksCache: vi.fn(() => null),
    primeStickerPacksCache: vi.fn((scope, payload) => payload),
    invalidateStickerPacksCache: vi.fn(() => { stickerEpochRef.value += 1; }),
    resolveStickerScope: vi.fn((options) => (
      `${String(options?.userId || 'anon')}::${String(window.localStorage.getItem('selected_database') || 'default')}`
    )),
  };
});

// Микротасковые каскады (then-цепочки очереди избранного и рефетч) честнее
// всего дожидаться макротаском — он пропускает вперёд всю очередь промисов.
const flushPromises = () => new Promise((resolve) => { setTimeout(resolve, 0); });

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const makeSticker = (id, emoji = '😀') => ({
  id,
  emoji,
  format: 'static',
  mime_type: 'image/webp',
  file_url: `/api/v1/chat/stickers/${id}/file`,
  preview_url: `/api/v1/chat/stickers/${id}/preview`,
});

const stickerX = makeSticker('sticker-x', '🐈');
const stickerY = makeSticker('sticker-y', '🦆');

const packA = {
  id: 'pack-a',
  short_name: 'PackA',
  title: 'Набор А',
  sticker_type: 'regular',
  stickers: [stickerX],
};
const packB = {
  id: 'pack-b',
  short_name: 'PackB',
  title: 'Набор Б',
  sticker_type: 'regular',
  stickers: [stickerY],
};

const scope = { userId: 42 };
const scopeKey = () => peekStickerScopeRecord(scope).key;
const record = () => peekStickerScopeRecord(scope);
const favoriteIds = () => record().favorites.items.map((item) => String(item.id));

describe('chatStickerStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stickerEpochRef.value = 0;
    window.localStorage.clear();
    invalidateChatStickerStore();
    // mockResolvedValue/mockReturnValue переживают clearAllMocks — дефолты
    // выставляем явно, чтобы once-очередь прошлого теста не подтекала.
    peekStickerPacksCache.mockReturnValue(null);
    chatStickersAPI.listPacks.mockResolvedValue({ items: [] });
    chatStickersAPI.listFavorites.mockResolvedValue({ items: [] });
    chatStickersAPI.addFavoriteSticker.mockResolvedValue({ items: [] });
    chatStickersAPI.removeFavoriteSticker.mockResolvedValue({ items: [] });
    chatStickersAPI.listRecentStickers.mockResolvedValue({ items: [] });
    chatStickersAPI.pushRecentStickers.mockResolvedValue({ items: [], version: 1 });
  });

  it('serializes concurrent favorite toggles and replays queued ops over stale lists', async () => {
    const addX = deferred();
    const addY = deferred();
    chatStickersAPI.addFavoriteSticker
      .mockImplementationOnce(() => addX.promise)
      .mockImplementationOnce(() => addY.promise);
    ensureChatStickerData(scope);
    await flushPromises();

    const promiseX = toggleFavoriteSticker(scopeKey(), stickerX);
    // Оптимистичное применение — до первого ответа сервера.
    expect(favoriteIds()).toEqual(['sticker-x']);

    const promiseY = toggleFavoriteSticker(scopeKey(), stickerY);
    expect(favoriteIds()).toEqual(['sticker-x', 'sticker-y']);
    await flushPromises();
    // Очередь сериализована: второй PUT не уходит, пока первый в пути.
    expect(chatStickersAPI.addFavoriteSticker).toHaveBeenCalledTimes(1);

    // Ответ add X пришёл со списком БЕЗ Y (сервер ещё не видел операцию Y) —
    // отложенная операция проигрывается поверх, Y не пропадает.
    addX.resolve({ items: [stickerX] });
    await flushPromises();
    expect(chatStickersAPI.addFavoriteSticker).toHaveBeenCalledTimes(2);
    expect(chatStickersAPI.addFavoriteSticker.mock.calls.map((call) => call[0]))
      .toEqual(['sticker-x', 'sticker-y']);
    expect(favoriteIds()).toEqual(['sticker-x', 'sticker-y']);

    addY.resolve({ items: [stickerX, stickerY] });
    await expect(promiseX).resolves.toEqual({ ok: true });
    await expect(promiseY).resolves.toEqual({ ok: true });
    expect(favoriteIds()).toEqual(['sticker-x', 'sticker-y']);
  });

  it('does not resurrect a sticker removed while its add was still in flight', async () => {
    const add = deferred();
    const remove = deferred();
    chatStickersAPI.addFavoriteSticker.mockImplementationOnce(() => add.promise);
    chatStickersAPI.removeFavoriteSticker.mockImplementationOnce(() => remove.promise);
    ensureChatStickerData(scope);
    await flushPromises();

    const addPromise = toggleFavoriteSticker(scopeKey(), stickerX);
    // Быстрый повторный клик — уже «убрать»: операция встаёт в очередь.
    const removePromise = toggleFavoriteSticker(scopeKey(), stickerX);
    expect(favoriteIds()).toEqual([]);
    expect(chatStickersAPI.removeFavoriteSticker).not.toHaveBeenCalled();

    // Ответ add'а принёс список без X — воскрешать оптимистичный X нельзя:
    // эффект remove живёт в журнале и проигрывается поверх ответа.
    add.resolve({ items: [stickerX] });
    await flushPromises();
    expect(favoriteIds()).toEqual([]);
    expect(chatStickersAPI.removeFavoriteSticker).toHaveBeenCalledTimes(1);

    remove.resolve({ items: [] });
    await expect(addPromise).resolves.toEqual({ ok: true });
    await expect(removePromise).resolves.toEqual({ ok: true });
    expect(favoriteIds()).toEqual([]);
  });

  it('rolls back only the failed op while keeping the others', async () => {
    const addX = deferred();
    const addY = deferred();
    chatStickersAPI.addFavoriteSticker
      .mockImplementationOnce(() => addX.promise)
      .mockImplementationOnce(() => addY.promise);
    ensureChatStickerData(scope);
    await flushPromises();

    toggleFavoriteSticker(scopeKey(), stickerX);
    toggleFavoriteSticker(scopeKey(), stickerY);
    expect(favoriteIds()).toEqual(['sticker-x', 'sticker-y']);

    // Отказ первой операции: её эффект исключается из проигрыша, вторая
    // операция остаётся и держит Y в списке.
    addX.reject(new Error('conflict'));
    await flushPromises();
    expect(favoriteIds()).toEqual(['sticker-y']);

    addY.resolve({ items: [stickerY] });
    await flushPromises();
    expect(favoriteIds()).toEqual(['sticker-y']);
  });

  it('drops queued mutations after store invalidation (session switch)', async () => {
    const add = deferred();
    chatStickersAPI.addFavoriteSticker.mockImplementationOnce(() => add.promise);
    ensureChatStickerData(scope);
    await flushPromises();

    const pending = toggleFavoriteSticker(scopeKey(), stickerX);
    invalidateChatStickerStore();
    // Ответ прилетает уже в новое поколение — операция помечается dropped,
    // запись прежнего scope не засоряется.
    add.resolve({ items: [stickerX] });
    await expect(pending).resolves.toMatchObject({ ok: false, dropped: true });
    await flushPromises();
    expect(favoriteIds()).toEqual([]);
  });

  it('dedups concurrent ensure calls and skips an already loaded slice', async () => {
    const packs = deferred();
    chatStickersAPI.listPacks.mockImplementationOnce(() => packs.promise);

    ensureChatStickerData(scope);
    ensureChatStickerData(scope);
    ensureChatStickerData(scope);
    await flushPromises();
    expect(chatStickersAPI.listPacks).toHaveBeenCalledTimes(1);
    expect(chatStickersAPI.listFavorites).toHaveBeenCalledTimes(1);
    expect(chatStickersAPI.listRecentStickers).toHaveBeenCalledTimes(1);

    packs.resolve({ items: [packA] });
    await flushPromises();
    expect(record().packs.status).toBe('ready');

    // Повторный ensure по готовому срезу — no-op: сети нет.
    ensureChatStickerData(scope);
    await flushPromises();
    expect(chatStickersAPI.listPacks).toHaveBeenCalledTimes(1);
  });

  it('drops a stale packs response and self-heals with a refetch', async () => {
    const first = deferred();
    chatStickersAPI.listPacks
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue({ items: [packA] });
    ensureChatStickerData(scope);
    await flushPromises();

    // Инвалидация кэша между запросом и ответом: ответ устарел.
    stickerEpochRef.value += 1;
    first.resolve({ items: [packB] });

    // Store сам перезапросил список (макротаск после снятия in-flight) —
    // устаревший packB не применился.
    await vi.waitFor(() => {
      expect(chatStickersAPI.listPacks).toHaveBeenCalledTimes(2);
    });
    await flushPromises();
    expect(record().packs.status).toBe('ready');
    expect(record().packs.items.map((item) => item.id)).toEqual(['pack-a']);
  });

  it('starts from the warm api cache and refetches only on demand', async () => {
    const { peekStickerPacksCache } = await import('../api/chatStickers');
    peekStickerPacksCache.mockReturnValue({ items: [packA] });
    invalidateChatStickerStore();

    const warmed = peekStickerScopeRecord(scope);
    expect(warmed.packs.status).toBe('ready');
    expect(warmed.packs.items.map((item) => item.id)).toEqual(['pack-a']);
    ensureChatStickerData(scope);
    await flushPromises();
    // Горячий кэш закрыл срез наборов — сеть не нужна.
    expect(chatStickersAPI.listPacks).not.toHaveBeenCalled();
    expect(chatStickersAPI.listFavorites).toHaveBeenCalledTimes(1);
  });

  it('applies pack mutations through applyStickerPacks/setStickerPackItems', async () => {
    ensureChatStickerData(scope);
    await flushPromises();

    // Оптимистичная перестановка — без прайма кэша, с бампом dv.
    applyStickerPacks(scopeKey(), { items: [packA, packB] }, stickerEpochRef.value);
    expect(record().packs.items.map((item) => item.id)).toEqual(['pack-a', 'pack-b']);
    const dvBefore = record().dv.packs;
    setStickerPackItems(scopeKey(), [packB, packA]);
    expect(record().packs.items.map((item) => item.id)).toEqual(['pack-b', 'pack-a']);
    expect(record().dv.packs).toBe(dvBefore + 1);

    // Ответ с устаревшей эпохой отбрасывается.
    stickerEpochRef.value += 1;
    const applied = applyStickerPacks(scopeKey(), { items: [packB] }, 0);
    expect(applied).toBe(false);
    expect(record().packs.items.map((item) => item.id)).toEqual(['pack-b', 'pack-a']);
  });

  it('bumps data version only on data change, not on status flips', async () => {
    const packs = deferred();
    chatStickersAPI.listPacks.mockImplementationOnce(() => packs.promise);
    ensureChatStickerData(scope);
    await flushPromises();

    const idleDv = record().dv.packs;
    packs.resolve({ items: [] });
    await flushPromises();
    // Ответ совпал с текущими данными ([]) — dv не растёт, хотя статус
    // прошёл idle → loading → ready: подписчики на dv не просыпаются.
    expect(record().packs.status).toBe('ready');
    expect(record().dv.packs).toBe(idleDv);
  });

  it('notifies subscribers on commits and keeps a stable snapshot otherwise', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeChatStickerStore(listener);
    const before = peekStickerScopeRecord(scope);

    // Без коммитов snapshot — тот же объект: useSyncExternalStore
    // перерендера не делает.
    expect(peekStickerScopeRecord(scope)).toBe(before);
    expect(listener).not.toHaveBeenCalled();

    setStickerPackItems(scopeKey(), [packA]);
    expect(listener).toHaveBeenCalled();
    expect(peekStickerScopeRecord(scope)).not.toBe(before);
    unsubscribe();
  });

  it('moves a remembered recent sticker to the head and schedules the sync', () => {
    ensureChatStickerData(scope);
    const storageKey = record().storageKey;

    rememberRecentSticker(scopeKey(), 'sticker-x');
    rememberRecentSticker(scopeKey(), 'sticker-y');
    rememberRecentSticker(scopeKey(), 'sticker-x');

    expect(record().recents.ids).toEqual(['sticker-x', 'sticker-y']);
    expect(JSON.parse(window.localStorage.getItem(storageKey))).toEqual(['sticker-x', 'sticker-y']);
    expect(scheduleRecentStickersSync).toHaveBeenLastCalledWith(['sticker-x', 'sticker-y'], storageKey);
  });

  it('removes and clears recents with an immediate clear:true push', async () => {
    ensureChatStickerData(scope);
    await flushPromises();
    rememberRecentSticker(scopeKey(), 'sticker-x');
    rememberRecentSticker(scopeKey(), 'sticker-y');

    await removeRecentSticker(scopeKey(), 'sticker-y');
    expect(record().recents.ids).toEqual(['sticker-x']);
    // Без clear:true merge-синк сервера вернул бы удалённый id хвостом.
    expect(chatStickersAPI.pushRecentStickers).toHaveBeenLastCalledWith(['sticker-x'], { clear: true });

    await clearRecentStickers(scopeKey());
    expect(record().recents.ids).toEqual([]);
    expect(chatStickersAPI.pushRecentStickers).toHaveBeenLastCalledWith([], { clear: true });
    expect(JSON.parse(window.localStorage.getItem(record().storageKey))).toEqual([]);
  });

  it('derives shared sections and reuses them until data changes', async () => {
    chatStickersAPI.listPacks.mockResolvedValue({ items: [packA, packB] });
    ensureChatStickerData(scope);
    await flushPromises();

    const derived = getStickerScopeDerived(scopeKey());
    // Модель секций вкладки: «Недавние», «Избранные», затем наборы —
    // стикеры набора получают pack_short_name для отправки.
    expect(derived.stickerSections.map((section) => section.id))
      .toEqual(['recent', 'favorites', 'pack-a', 'pack-b']);
    expect(derived.stickerSections[2].stickers[0].pack_short_name).toBe('PackA');
    // Кэш по ссылкам массивов: без смены данных — та же производная.
    expect(getStickerScopeDerived(scopeKey())).toBe(derived);

    setStickerPackItems(scopeKey(), [packB, packA]);
    expect(getStickerScopeDerived(scopeKey())).not.toBe(derived);
  });
});
