import {
  applyNativeMailUnreadChange,
  publishNativeMailUnreadAbsolute,
  publishNativeMailUnreadDelta,
  subscribeNativeMailUnread,
} from './nativeMailUnreadEvents';
import {
  applyPendingNativeMailUnread,
  clearPendingNativeMailUnread,
} from './nativeMailUnreadPending';

beforeEach(() => clearPendingNativeMailUnread());
afterEach(() => clearPendingNativeMailUnread());

it('applies bounded unread changes and notifies active subscribers', () => {
  expect(applyNativeMailUnreadChange(3, { kind: 'delta', value: -1 })).toBe(2);
  expect(applyNativeMailUnreadChange(0, { kind: 'delta', value: -4 })).toBe(0);
  expect(applyNativeMailUnreadChange(7, { kind: 'absolute', value: 2 })).toBe(2);

  const listener = jest.fn();
  const unsubscribe = subscribeNativeMailUnread(listener);
  publishNativeMailUnreadDelta(-1);
  publishNativeMailUnreadAbsolute(0);
  unsubscribe();
  publishNativeMailUnreadDelta(1);

  expect(listener).toHaveBeenCalledTimes(2);
  expect(listener).toHaveBeenNthCalledWith(1, { kind: 'delta', value: -1 }, undefined);
  expect(listener).toHaveBeenNthCalledWith(2, { kind: 'absolute', value: 0 }, undefined);
});

it('carries mailbox/folder scope and the publisher source to subscribers', () => {
  const listener = jest.fn();
  const unsubscribe = subscribeNativeMailUnread(listener);
  const source = { id: 'inbox-screen' };

  publishNativeMailUnreadDelta(-2, { mailboxId: 'box-1', folder: 'inbox' }, source);

  expect(listener).toHaveBeenCalledWith(
    { kind: 'delta', value: -2, mailboxId: 'box-1', folder: 'inbox' },
    source,
  );
  unsubscribe();
});

it('stages a pending correction for scoped deltas and clears it on absolute values', () => {
  publishNativeMailUnreadDelta(-1, { mailboxId: 'box-1', folder: 'inbox' });
  expect(applyPendingNativeMailUnread('box-1', 'inbox', 3)).toBe(2);
  expect(applyPendingNativeMailUnread(null, null, 5)).toBe(4);

  publishNativeMailUnreadAbsolute(0);
  expect(applyPendingNativeMailUnread('box-1', 'inbox', 3)).toBe(3);
  expect(applyPendingNativeMailUnread(null, null, 5)).toBe(5);
});
