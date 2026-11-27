// Консистентность sprite-атласа (issue #89): сгенерированные CSS-позиции
// обязаны совпадать с порядком unified в сгенерированных данных — иначе
// после перегенерации глифы разъедутся. Плюс рантайм-контракты fallback:
// индексированные эмодзи -> прозрачный пиксель, остальные -> прежний PNG.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  EMOJI_SPRITE_CELLS_PER_SHEET,
  EMOJI_SPRITE_COLS,
  EMOJI_SPRITE_ORDER,
  EMOJI_SPRITE_SHEET_COUNT,
  EMOJI_SPRITE_SHEET_FILES,
} from './generated/emojiSpriteData';
import {
  EMOJI_SPRITE_TRANSPARENT_PIXEL,
  getEmojiSpritePos,
  getSpriteAwareEmojiUrl,
  hasEmojiSprite,
} from './emojiSpriteAtlas';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, 'generated', 'emojiSprites.css'), 'utf8');

const order = EMOJI_SPRITE_ORDER.split(' ');

describe('emoji sprite atlas generated data', () => {
  it('order list is unique and sizeable', () => {
    expect(order.length).toBeGreaterThan(1800);
    expect(new Set(order).size).toBe(order.length);
  });

  it('every css rule matches the order index position math', () => {
    const axisPos = (cells) => (cells === 0
      ? '0px'
      : `calc(var(--epr-emoji-size)*-${cells})`);
    const ruleRe = /\.chat-emoji-sprite-scope \.epr-emoji\[data-unified="([^"]+)"\]\{background-image:url\("\{base\}(sheet-(\d+)\.[0-9a-f]{10}\.png)"\),var\(--epr-sprite-fill\);background-position:([^;]+);\}/g;
    const rules = [...css.matchAll(ruleRe)];
    expect(rules.length).toBe(order.length);
    const seen = new Set();
    rules.forEach(([, unified, file, sheet, pos]) => {
      expect(seen.has(unified)).toBe(false);
      seen.add(unified);
      const idx = order.indexOf(unified);
      expect(idx, `unified ${unified} in order`).toBeGreaterThanOrEqual(0);
      const expectSheet = Math.floor(idx / EMOJI_SPRITE_CELLS_PER_SHEET);
      const cell = idx % EMOJI_SPRITE_CELLS_PER_SHEET;
      const x = cell % EMOJI_SPRITE_COLS;
      const y = Math.floor(cell / EMOJI_SPRITE_COLS);
      expect(Number(sheet)).toBe(expectSheet);
      expect(file).toBe(EMOJI_SPRITE_SHEET_FILES[expectSheet]);
      expect(pos).toBe(`${axisPos(x)} ${axisPos(y)},0px 0px`);
    });
  });

  it('sheet files referenced by css exist in public/emoji-atlas and carry a content hash', () => {
    expect(EMOJI_SPRITE_SHEET_FILES.length).toBe(EMOJI_SPRITE_SHEET_COUNT);
    EMOJI_SPRITE_SHEET_FILES.forEach((name, sheet) => {
      expect(name, `sheet ${sheet} name carries content hash`).toMatch(/^sheet-\d+\.[0-9a-f]{10}\.png$/);
      const file = resolve(here, '..', '..', '..', 'public', 'emoji-atlas', name);
      expect(() => readFileSync(file), `${name} exists`).not.toThrow();
      // Cache-invalidation держится на том, что хэш в имени — это sha256 содержимого:
      // иначе при обновлении эмодзи-данных новые позиции CSS могут встретить
      // старый закэшированный лист (IIS static отдаёт max-age 7 дней).
      const digest = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 10);
      expect(name, `${name} name hash must match content sha256`).toContain(`.${digest}.`);
    });
  });
});

describe('emoji sprite runtime contracts', () => {
  it('indexed emoji resolves to its cell position', () => {
    const first = order[0];
    expect(getEmojiSpritePos(first)).toEqual({ sheet: 0, x: 0, y: 0 });
    const deepIdx = 600;
    const deep = order[deepIdx];
    const cell = deepIdx % EMOJI_SPRITE_CELLS_PER_SHEET;
    expect(getEmojiSpritePos(deep)).toEqual({
      sheet: Math.floor(deepIdx / EMOJI_SPRITE_CELLS_PER_SHEET),
      x: cell % EMOJI_SPRITE_COLS,
      y: Math.floor(cell / EMOJI_SPRITE_COLS),
    });
  });

  it('indexed emoji gets the transparent pixel; unknown gets the apple png path', () => {
    expect(getSpriteAwareEmojiUrl(order[0])).toBe(EMOJI_SPRITE_TRANSPARENT_PIXEL);
    // вариации тона кожи в атлас не входят, но и сети не требуют: в панели чата
    // skinTonesDisabled — их негде отрендерить, а preload picker'а иначе грузит
    // ~5 PNG на эмодзи вхолостую (см. предупреждение в emojiSpriteAtlas.js)
    expect(hasEmojiSprite('1f600-1f3fb')).toBe(false);
    expect(getSpriteAwareEmojiUrl('1f600-1f3fb')).toBe(EMOJI_SPRITE_TRANSPARENT_PIXEL);
    expect(getSpriteAwareEmojiUrl('1f469-1f3fb-200d-2764-fe0f-200d-1f48b-200d-1f468-1f3fd'))
      .toBe(EMOJI_SPRITE_TRANSPARENT_PIXEL);
    // неизвестные unified без тонового модификатора — прежний PNG-путь
    expect(getSpriteAwareEmojiUrl('1f600-unknown')).toMatch(/emoji\/apple\/64\/1f600-unknown\.png$/);
    // три эмодзи без apple-ассета тоже не в атласе (native fallback как раньше)
    expect(hasEmojiSprite('2640-fe0f')).toBe(false);
  });
});
