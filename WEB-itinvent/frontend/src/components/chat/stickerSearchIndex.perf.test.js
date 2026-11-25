// Perf smoke: поисковый индекс строится один раз на поколение данных и
// разделяется вкладкой и подсказками — регрессия в «индекс на каждый
// потребитель/токен» стоила бы O(наборы × стикеры) на каждый ввод.
// Пороги с запасом под CI — тест про объёмные порядки, не микробенчмарк.
import { describe, expect, it } from 'vitest';

import {
  buildStickerSearchIndex,
  collectStickerSuggestions,
  searchStickerIndex,
} from './stickerSearchIndex';

const STICKERS_TOTAL = 5000;
const LOOKUPS = 1000;

const makeSections = (total) => {
  const perPack = 100;
  const packs = Array.from({ length: Math.ceil(total / perPack) }, (_, packIndex) => ({
    id: `pack-${packIndex}`,
    title: `Набор ${packIndex}`,
    short_name: `Pack${packIndex}`,
    stickers: Array.from({ length: perPack }, (_, stickerIndex) => {
      const id = `st-${packIndex}-${stickerIndex}`;
      return {
        id,
        // Разброс эмодзи по словарю: часть стикеров бьётся с токеном 😂,
        // остальные — разные, чтобы проход фильтра был честным.
        emoji: ['😂', '👍', '🔥', '😎', '🎉'][stickerIndex % 5],
        format: 'static',
        file_url: `/api/v1/chat/stickers/${id}/file`,
        preview_url: `/api/v1/chat/stickers/${id}/preview`,
      };
    }),
  }));
  return [
    { id: 'recent', title: 'Недавние', stickers: [], recent: true },
    { id: 'favorites', title: 'Избранные', stickers: [], favorites: true },
    ...packs,
  ];
};

describe('stickerSearchIndex perf smoke', () => {
  it('builds the index for ~5000 stickers and serves 1000 lookups fast', () => {
    const sections = makeSections(STICKERS_TOTAL);

    const buildStart = performance.now();
    const index = buildStickerSearchIndex(sections);
    const buildMs = performance.now() - buildStart;

    const lookupStart = performance.now();
    let hits = 0;
    for (let i = 0; i < LOOKUPS; i += 1) {
      hits += collectStickerSuggestions(index, '😂', 12).length;
      hits += searchStickerIndex(index, 'набор').length;
    }
    const lookupMs = performance.now() - lookupStart;

    expect(hits).toBeGreaterThan(0);
    // Индекс на 5000 стикеров — десятки мс; lookups — проход по готовым
    // нормализованным строкам. Потолки в 10+ раз выше ожидаемого: ловим
    // регрессию порядка (повторная сборка/квадратика), не шум машины.
    expect(buildMs).toBeLessThan(500);
    expect(lookupMs).toBeLessThan(1000);
  });
});
