export type NativeMailUnreadChange =
  | { kind: 'delta'; value: number }
  | { kind: 'absolute'; value: number };

type Listener = (change: NativeMailUnreadChange) => void;

const listeners = new Set<Listener>();

function normalizedCount(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : 0;
}

export function applyNativeMailUnreadChange(current: number, change: NativeMailUnreadChange): number {
  if (change.kind === 'absolute') return normalizedCount(change.value);
  return normalizedCount(normalizedCount(current) + Number(change.value || 0));
}

export function publishNativeMailUnreadDelta(delta: number): void {
  const value = Math.trunc(Number(delta));
  if (!Number.isFinite(value) || value === 0) return;
  listeners.forEach((listener) => listener({ kind: 'delta', value }));
}

export function publishNativeMailUnreadAbsolute(value: number): void {
  const next = normalizedCount(value);
  listeners.forEach((listener) => listener({ kind: 'absolute', value: next }));
}

export function subscribeNativeMailUnread(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
