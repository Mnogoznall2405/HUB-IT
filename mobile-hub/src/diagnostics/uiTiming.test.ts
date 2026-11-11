import {
  getUiTimingSummary,
  noteInboxCacheReady,
  noteInboxLiveReady,
  noteInboxLoadStart,
  noteLoopLag,
  noteLiveVideoStickers,
  noteThreadMessageCount,
  setUiArea,
  noteThreadCacheReady,
  noteThreadLiveReady,
  noteThreadMounted,
  noteThreadOpenTap,
  resetUiTiming,
} from './uiTiming';

beforeEach(() => resetUiTiming());

it('computes conversation-open intervals and cache share', () => {
  noteThreadOpenTap('list', 1000);
  noteThreadMounted(1300);
  noteThreadCacheReady(1450);

  const summary = getUiTimingSummary();
  expect(summary.threadOpens.count).toBe(1);
  expect(summary.threadOpens.fromCache).toBe(1);
  expect(summary.threadOpens.sources.list).toBe(1);
  expect(summary.threadOpens.intervals.tap_to_mount).toEqual({ count: 1, p50: 300, p95: 300 });
  expect(summary.threadOpens.intervals.tap_to_ready).toEqual({ count: 1, p50: 450, p95: 450 });
  expect(summary.threadOpens.intervals.mount_to_ready).toEqual({ count: 1, p50: 150, p95: 150 });
});

it('marks a network-only open as not cached', () => {
  noteThreadOpenTap('search', 5000);
  noteThreadLiveReady(5900);

  const summary = getUiTimingSummary();
  expect(summary.threadOpens.count).toBe(1);
  expect(summary.threadOpens.fromCache).toBe(0);
  expect(summary.threadOpens.sources.search).toBe(1);
  expect(summary.threadOpens.intervals.tap_to_ready.p50).toBe(900);
  expect(summary.threadOpens.intervals.tap_to_mount.count).toBe(0);
  expect(summary.threadOpens.intervals.mount_to_ready.count).toBe(0);
});

it('ignores marks without a fresh pending tap', () => {
  noteThreadMounted(1000);
  noteThreadCacheReady(1200);
  noteThreadLiveReady(1500);
  expect(getUiTimingSummary().threadOpens.count).toBe(0);
});

it('drops a stale pending tap instead of pairing it with a later mount', () => {
  noteThreadOpenTap('list', 1000);
  noteThreadMounted(1000 + 61_000);
  noteThreadLiveReady(1000 + 61_500);
  expect(getUiTimingSummary().threadOpens.count).toBe(0);
});

it('bounds thread-open samples', () => {
  for (let i = 0; i < 40; i += 1) {
    const tap = i * 1000;
    noteThreadOpenTap('list', tap);
    noteThreadMounted(tap + 10);
    noteThreadLiveReady(tap + 20);
  }
  expect(getUiTimingSummary().threadOpens.count).toBe(32);
});

it('tracks inbox readiness with and without the cached snapshot', () => {
  noteInboxLoadStart(10_000);
  noteInboxCacheReady(10_150);
  noteInboxLiveReady(10_900);

  noteInboxLoadStart(20_000);
  noteInboxLiveReady(21_200);

  const { inbox } = getUiTimingSummary();
  expect(inbox.loads).toBe(2);
  expect(inbox.fromCache).toBe(1);
  expect(inbox.intervals.to_first_items.p50).toBe(150);
  expect(inbox.intervals.to_first_items.p95).toBe(1200);
  expect(inbox.intervals.to_live.p50).toBe(900);
});

it('counts loop stalls by severity and keeps the maximum', () => {
  noteLoopLag(200, 400);
  noteLoopLag(700, 400);
  noteLoopLag(2000, 400);
  noteLoopLag(40, 400);
  noteLoopLag(-5, 400);

  const { loopLag } = getUiTimingSummary();
  expect(loopLag.sampledSeconds).toBe(2);
  expect(loopLag.stalls150).toBe(1);
  expect(loopLag.stalls500).toBe(1);
  expect(loopLag.stalls1500).toBe(1);
  expect(loopLag.maxLagMs).toBe(2000);
});

it('attributes stalls to the screen area and keeps the worst ones with their context', () => {
  setUiArea('chat-thread');
  noteThreadMessageCount(120);
  noteLiveVideoStickers(4);
  noteLoopLag(300, 400);
  noteLoopLag(900, 400);
  setUiArea('database');
  noteThreadMessageCount(0);
  noteLiveVideoStickers(0);
  noteLoopLag(200, 400);
  setUiArea('Bad Area/With ids 123');
  noteLoopLag(160, 400);

  const { loopLag } = getUiTimingSummary();
  expect(loopLag.byArea['chat-thread']).toEqual({ stalls150: 2, stalls500: 1, maxLagMs: 900 });
  expect(loopLag.byArea.database).toEqual({ stalls150: 1, stalls500: 0, maxLagMs: 200 });
  expect(loopLag.byArea.other.maxLagMs).toBe(160);
  expect(loopLag.worst[0]).toMatchObject({ lagMs: 900, area: 'chat-thread', videoStickers: 4, threadMessages: 120 });
  expect(loopLag.worst.map((item) => item.lagMs)).toEqual([900, 300, 200, 160]);
});

it('bounds the worst-stall list to the eight longest', () => {
  for (let lag = 150; lag < 150 + 12 * 10; lag += 10) noteLoopLag(lag, 400);
  const { loopLag } = getUiTimingSummary();
  expect(loopLag.worst).toHaveLength(8);
  expect(loopLag.worst[0].lagMs).toBe(150 + 11 * 10);
  expect(loopLag.worst[7].lagMs).toBe(150 + 4 * 10);
});

it('serializes a summary without identifiers or content', () => {
  noteThreadOpenTap('list', 1000);
  noteThreadMounted(1100);
  noteThreadCacheReady(1300);
  const encoded = JSON.stringify(getUiTimingSummary());
  expect(encoded).not.toContain('conversation');
  expect(encoded).not.toContain('token');
});
