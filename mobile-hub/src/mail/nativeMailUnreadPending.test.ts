import {
  applyPendingNativeMailUnread,
  clearPendingNativeMailUnread,
  stageNativeMailUnreadDelta,
} from './nativeMailUnreadPending';
import { publishNativeMailUnreadDelta } from './nativeMailUnreadEvents';

beforeEach(() => clearPendingNativeMailUnread());
afterEach(() => clearPendingNativeMailUnread());

it('passes server counters through while nothing is pending', () => {
  expect(applyPendingNativeMailUnread('box-1', 'inbox', 7)).toBe(7);
  expect(applyPendingNativeMailUnread(null, null, 12)).toBe(12);
});

it('corrects a lagging server counter until it confirms the staged delta', () => {
  // Первое наблюдение сервера фиксирует baseline ещё до прочтения письма.
  expect(applyPendingNativeMailUnread('box-1', 'inbox', 3)).toBe(3);

  stageNativeMailUnreadDelta('box-1', 'inbox', -1);

  // Exchange ещё отдаёт старое значение — показываем скорректированное.
  expect(applyPendingNativeMailUnread('box-1', 'inbox', 3)).toBe(2);
  expect(applyPendingNativeMailUnread('box-1', 'inbox', 3)).toBe(2);
  // Сервер применил дельту — pending снимается, дальше живёт честный счётчик.
  expect(applyPendingNativeMailUnread('box-1', 'inbox', 2)).toBe(2);
  expect(applyPendingNativeMailUnread('box-1', 'inbox', 2)).toBe(2);
});

it('does not double-count when the server applies only part of the delta', () => {
  applyPendingNativeMailUnread('box-1', 'inbox', 5);
  stageNativeMailUnreadDelta('box-1', 'inbox', -2);

  // Сервер подтвердил только одно прочтение из двух.
  expect(applyPendingNativeMailUnread('box-1', 'inbox', 4)).toBe(3);
  // Полное подтверждение.
  expect(applyPendingNativeMailUnread('box-1', 'inbox', 3)).toBe(3);
  expect(applyPendingNativeMailUnread('box-1', 'inbox', 3)).toBe(3);
});

it('keeps the full delta when new unread mail lifts the counter above the baseline', () => {
  applyPendingNativeMailUnread('box-1', 'inbox', 3);
  stageNativeMailUnreadDelta('box-1', 'inbox', -1);

  // Пришло новое непрочитанное: сервер 4 = старые 3 + 1 новое.
  expect(applyPendingNativeMailUnread('box-1', 'inbox', 4)).toBe(3);
});

it('handles a positive delta (marked unread) symmetrically', () => {
  applyPendingNativeMailUnread('box-1', 'inbox', 2);
  stageNativeMailUnreadDelta('box-1', 'inbox', 1);

  expect(applyPendingNativeMailUnread('box-1', 'inbox', 2)).toBe(3);
  expect(applyPendingNativeMailUnread('box-1', 'inbox', 3)).toBe(3);
  expect(applyPendingNativeMailUnread('box-1', 'inbox', 3)).toBe(3);
});

it('scopes corrections per mailbox and folder without cross-talk', () => {
  applyPendingNativeMailUnread('box-1', 'inbox', 4);
  applyPendingNativeMailUnread('box-2', 'inbox', 4);
  stageNativeMailUnreadDelta('box-1', 'inbox', -1);

  expect(applyPendingNativeMailUnread('box-1', 'inbox', 4)).toBe(3);
  expect(applyPendingNativeMailUnread('box-2', 'inbox', 4)).toBe(4);
  expect(applyPendingNativeMailUnread('box-1', 'trash', 9)).toBe(9);
});

it('nets out staged deltas and drops the pending entry at zero', () => {
  stageNativeMailUnreadDelta('box-1', 'inbox', -1);
  stageNativeMailUnreadDelta('box-1', 'inbox', 1);

  expect(applyPendingNativeMailUnread('box-1', 'inbox', 3)).toBe(3);
});

it('publishes delta events that also correct the cross-mailbox total', () => {
  applyPendingNativeMailUnread(null, null, 8);
  publishNativeMailUnreadDelta(-1, { mailboxId: 'box-1', folder: 'inbox' });

  expect(applyPendingNativeMailUnread(null, null, 8)).toBe(7);
  expect(applyPendingNativeMailUnread(null, null, 7)).toBe(7);
});
