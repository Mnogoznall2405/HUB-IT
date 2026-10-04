import { describe, expect, it } from 'vitest';

import {
  centerRenderWindowOn,
  expandRenderWindowNewer,
  expandRenderWindowOlder,
  pinRenderWindowToHead,
  resolveRenderWindow,
  sliceTimelineForRenderWindow,
} from './chatThreadRenderWindow';

// Чистая арифметика окна рендера ленты. Unit-тест оправдан: off-by-one на
// границах навсегда скрывает сообщение, потеря id границы роняет окно в
// начало/хвост, а порционная обрезка и прижатие к началу при prepend
// определяют, прыгает ли лента, — E2E ловит это только частично и медленно.

const ids = (count, prefix = 'm') => Array.from({ length: count }, (_, i) => `${prefix}${i}`);
const OPTS = { max: 10, step: 4 };

describe('resolveRenderWindow', () => {
  it('короткая лента монтируется целиком', () => {
    expect(resolveRenderWindow({ ids: ids(7), ...OPTS })).toEqual({ start: 0, end: 7, total: 7 });
    expect(resolveRenderWindow({ ids: [], ...OPTS })).toEqual({ start: 0, end: 0, total: 0 });
  });

  it('хвост обрезается сверху порциями по step, а не по одному сообщению', () => {
    // 11..14 сообщений: превышение 1..4 → срезано 4, первый элемент стабилен.
    [11, 12, 13, 14].forEach((count) => {
      expect(resolveRenderWindow({ ids: ids(count), ...OPTS }).start).toBe(4);
    });
    expect(resolveRenderWindow({ ids: ids(15), ...OPTS })).toEqual({ start: 8, end: 15, total: 15 });
    const range = resolveRenderWindow({ ids: ids(100), ...OPTS });
    expect(range.end).toBe(100);
    expect(range.end - range.start).toBeLessThanOrEqual(10);
    expect(range.end - range.start).toBeGreaterThan(10 - 4);
  });

  it('окно по id не сдвигается при prepend и append', () => {
    const state = { startId: 'm20', endId: 'm29', keep: 'top' };
    const base = ids(50);
    expect(resolveRenderWindow({ ids: base, state, ...OPTS })).toMatchObject({ start: 20, end: 30 });
    const prepended = [...ids(5, 'old'), ...base, ...ids(3, 'new')];
    const range = resolveRenderWindow({ ids: prepended, state, ...OPTS });
    expect(prepended.slice(range.start, range.end)).toEqual(base.slice(20, 30));
  });

  it('окно, прижатое к началу, включает пришедшую страницу истории и срезает низ', () => {
    const base = ids(10);
    const pinned = pinRenderWindowToHead(base, { start: 0, end: 10 });
    expect(pinned).toEqual({ startId: null, endId: null, keep: 'top' });
    const withOlder = [...ids(4, 'old'), ...base];
    const range = resolveRenderWindow({ ids: withOlder, state: pinned, ...OPTS });
    expect(range).toMatchObject({ start: 0, end: 10 });
    expect(withOlder[0]).toBe('old0');
  });

  it('исчезнувшая граница берётся из предыдущего среза, а не сбрасывает окно', () => {
    const list = ids(50).filter((id) => id !== 'm20');
    const range = resolveRenderWindow({
      ids: list,
      state: { startId: 'm20', endId: 'm29', keep: 'top' },
      fallback: { start: 20, end: 30 },
      ...OPTS,
    });
    expect(range.start).toBe(20);
    expect(range.end).toBe(29);
  });
});

describe('сдвиг окна', () => {
  it('вверх: step ранних сообщений, низ срезается до max', () => {
    const list = ids(100);
    const state = expandRenderWindowOlder(list, { start: 90, end: 100 }, OPTS);
    expect(state).toEqual({ startId: 'm86', endId: 'm95', keep: 'top' });
    expect(resolveRenderWindow({ ids: list, state, ...OPTS })).toMatchObject({ start: 86, end: 96 });
  });

  it('вверх до начала — окно прижимается к началу (startId null)', () => {
    const state = expandRenderWindowOlder(ids(100), { start: 2, end: 12 }, OPTS);
    expect(state.startId).toBeNull();
    expect(resolveRenderWindow({ ids: ids(100), state, ...OPTS })).toMatchObject({ start: 0, end: 10 });
  });

  it('вниз до хвоста — окно снова следует за новыми сообщениями', () => {
    const list = ids(100);
    const state = expandRenderWindowNewer(list, { start: 86, end: 96 }, OPTS);
    expect(state).toEqual({ startId: 'm90', endId: null, keep: 'bottom' });
    const grown = [...list, 'm100'];
    expect(resolveRenderWindow({ ids: grown, state, ...OPTS }).end).toBe(101);
  });

  it('центрирование на сообщении у краёв не выходит за список', () => {
    const list = ids(100);
    expect(resolveRenderWindow({ ids: list, state: centerRenderWindowOn(list, 'm50', OPTS), ...OPTS }))
      .toMatchObject({ start: 45, end: 55 });
    expect(resolveRenderWindow({ ids: list, state: centerRenderWindowOn(list, 'm1', OPTS), ...OPTS }))
      .toMatchObject({ start: 0, end: 10 });
    expect(resolveRenderWindow({ ids: list, state: centerRenderWindowOn(list, 'm99', OPTS), ...OPTS }))
      .toMatchObject({ start: 90, end: 100 });
    expect(centerRenderWindowOn(list, 'missing', OPTS)).toBeNull();
  });
});

describe('sliceTimelineForRenderWindow', () => {
  const timeline = [
    { type: 'date', key: 'date:1' },
    { type: 'message', key: 'message:a' },
    { type: 'message', key: 'message:b' },
    { type: 'unread', key: 'unread:c' },
    { type: 'message', key: 'message:c' },
    { type: 'date', key: 'date:2' },
    { type: 'message', key: 'message:d' },
    { type: 'message', key: 'message:e' },
  ];
  const keys = (items) => items.map((item) => item.key);

  it('маркеры прямо перед первым сообщением окна входят в срез', () => {
    expect(keys(sliceTimelineForRenderWindow(timeline, { start: 2, end: 4 })))
      .toEqual(['date:1', 'unread:c', 'message:c', 'date:2', 'message:d']);
  });

  it('окно посреди дня начинается с маркера этого дня, без дублей', () => {
    expect(keys(sliceTimelineForRenderWindow(timeline, { start: 4, end: 5 })))
      .toEqual(['date:2', 'message:e']);
    expect(keys(sliceTimelineForRenderWindow(timeline, { start: 0, end: 5 }))).toEqual(keys(timeline));
  });
});
