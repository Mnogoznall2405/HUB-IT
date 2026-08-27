import {
  applyNativeMailUnreadChange,
  publishNativeMailUnreadAbsolute,
  publishNativeMailUnreadDelta,
  subscribeNativeMailUnread,
} from './nativeMailUnreadEvents';

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
  expect(listener).toHaveBeenNthCalledWith(1, { kind: 'delta', value: -1 });
  expect(listener).toHaveBeenNthCalledWith(2, { kind: 'absolute', value: 0 });
});
