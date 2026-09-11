// AppLockGate publishes its existing UI lock; this does not change lock policy.
let blocked = true;
const listeners = new Set<() => void>();
export function isNativeChatDeliveryBlocked() { return blocked; }
export function setNativeChatDeliveryBlocked(value: boolean) {
  if (blocked === value) return;
  blocked = value;
  listeners.forEach((listener) => { try { listener(); } catch { /* Observers only. */ } });
}
export function subscribeNativeChatDeliveryGate(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
