import {
  countStalledChatSends,
  getChatSendTimingSummary,
  markChatSend,
  recordChatQueueStorageOp,
  resetChatSendTiming,
  settleChatSend,
} from './chatSendTiming';

beforeEach(() => resetChatSendTiming());

it('computes tap intervals from send-path marks', () => {
  markChatSend('m-1', 'tap_send', 1000);
  markChatSend('m-1', 'bubble_visible', 1012);
  markChatSend('m-1', 'outbox_persisted', 1040);
  markChatSend('m-1', 'http_start', 1080);
  markChatSend('m-1', 'http_ack', 1240);
  markChatSend('m-1', 'ui_confirmed', 1250);

  const summary = getChatSendTimingSummary();
  expect(summary.sends).toBe(1);
  expect(summary.intervals.tap_to_bubble).toEqual({ count: 1, p50: 12, p95: 12 });
  expect(summary.intervals.tap_to_outbox_persisted.p50).toBe(40);
  expect(summary.intervals.tap_to_http_start.p50).toBe(80);
  expect(summary.intervals.tap_to_ack.p50).toBe(240);
  expect(summary.intervals.tap_to_ui_confirmed.p50).toBe(250);
});

it('aggregates queue storage durations and sizes per operation kind', () => {
  [10, 20, 30, 40].forEach((ms, index) => recordChatQueueStorageOp('write', ms, 100 * (index + 1)));
  recordChatQueueStorageOp('read', 5, 800);
  recordChatQueueStorageOp('delete', 3, 0);

  const { storageOps } = getChatSendTimingSummary();
  expect(storageOps.write).toEqual({ count: 4, p50: 20, p95: 40, bytesP95: 400 });
  expect(storageOps.read).toEqual({ count: 1, p50: 5, p95: 5, bytesP95: 800 });
  expect(storageOps.delete).toEqual({ count: 1, p50: 3, p95: 3, bytesP95: 0 });
});

it('keeps intervals incomplete until both marks of a pair exist', () => {
  markChatSend('m-1', 'tap_send', 1000);
  markChatSend('m-1', 'bubble_visible', 1010);

  const summary = getChatSendTimingSummary();
  expect(summary.intervals.tap_to_bubble.count).toBe(1);
  expect(summary.intervals.tap_to_ack.count).toBe(0);
  expect(summary.intervals.tap_to_ack.p50).toBeNull();
});

it('starts a fresh trace when tap_send repeats for the same message id', () => {
  markChatSend('m-1', 'tap_send', 1000);
  markChatSend('m-1', 'http_ack', 1600);
  markChatSend('m-1', 'tap_send', 2000);
  markChatSend('m-1', 'http_ack', 2500);

  const summary = getChatSendTimingSummary();
  expect(summary.sends).toBe(1);
  expect(summary.intervals.tap_to_ack.p50).toBe(500);
});

it('keeps the latest attempt timings when http marks repeat within a trace', () => {
  markChatSend('m-1', 'tap_send', 1000);
  markChatSend('m-1', 'http_start', 1100);
  markChatSend('m-1', 'http_start', 5000);
  markChatSend('m-1', 'http_ack', 5200);

  const summary = getChatSendTimingSummary();
  expect(summary.intervals.tap_to_http_start.p50).toBe(4000);
  expect(summary.intervals.tap_to_ack.p50).toBe(4200);
});

it('bounds traces and storage samples so release marks stay cheap', () => {
  for (let index = 0; index < 40; index += 1) markChatSend(`m-${index}`, 'tap_send', 1000 + index);
  for (let index = 0; index < 300; index += 1) recordChatQueueStorageOp('read', index, 1);

  const summary = getChatSendTimingSummary();
  expect(summary.sends).toBe(32);
  expect(summary.storageOps.read.count).toBe(240);
});

it('counts only sends stuck past the stall threshold', () => {
  markChatSend('m-1', 'http_start', 1000);
  markChatSend('m-2', 'http_start', 4000);
  markChatSend('m-3', 'tap_send', 1000);

  expect(countStalledChatSends(7000)).toBe(1);
  expect(countStalledChatSends(7000, 10_000)).toBe(0);
});

it('clears the stall on ack, settle or a manual retry', () => {
  markChatSend('m-1', 'http_start', 1000);
  markChatSend('m-1', 'http_ack', 2000);
  markChatSend('m-2', 'http_start', 1000);
  settleChatSend('m-2');
  markChatSend('m-3', 'http_start', 1000);
  markChatSend('m-3', 'tap_send', 2000);

  expect(countStalledChatSends(10_000)).toBe(0);
});

it('restarts the stall window when http_start repeats for a retry', () => {
  markChatSend('m-1', 'http_start', 1000);
  markChatSend('m-1', 'http_start', 9000);

  expect(countStalledChatSends(10_000)).toBe(0);
  expect(countStalledChatSends(14_100)).toBe(1);
});

it('contains no message text or identifiers in the exported summary', () => {
  markChatSend('private-client-id-1', 'tap_send', 1000);
  markChatSend('private-client-id-1', 'bubble_visible', 1005);
  recordChatQueueStorageOp('write', 7, 512);

  const encoded = JSON.stringify(getChatSendTimingSummary());
  expect(encoded).not.toContain('private-client-id-1');
  expect(encoded).not.toContain('body_text');
  expect(encoded).not.toContain('Приватный текст');
});
