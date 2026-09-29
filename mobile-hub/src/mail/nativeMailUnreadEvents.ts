import {
  clearPendingNativeMailUnread,
  stageNativeMailUnreadForPublish,
} from './nativeMailUnreadPending';

export type NativeMailUnreadChange =
  | { kind: 'delta'; value: number; mailboxId?: string; folder?: string }
  | { kind: 'absolute'; value: number; mailboxId?: string; folder?: string };

export type NativeMailUnreadListener = (change: NativeMailUnreadChange, source?: unknown) => void;

const listeners = new Set<NativeMailUnreadListener>();

export function subscribeNativeMailUnread(listener: NativeMailUnreadListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export type NativeMailUnreadMeta = {
  mailboxId?: string | number | null;
  folder?: string | null;
};

export function publishNativeMailUnreadDelta(delta: number, meta?: NativeMailUnreadMeta, source?: unknown): void {
  const value = Math.trunc(Number(delta));
  if (!Number.isFinite(value) || value === 0) return;
  const mailboxId = meta?.mailboxId == null ? '' : String(meta.mailboxId).trim();
  const folder = meta?.folder == null ? '' : String(meta.folder).trim();
  if (mailboxId && folder) {
    // Server unread counters lag locally applied changes (Exchange eventually
    // consistent). Stage the delta so freshly loaded summaries are corrected
    // until the server confirms the change.
    stageNativeMailUnreadForPublish(mailboxId, folder, value);
  }
  const change: NativeMailUnreadChange = {
    kind: 'delta',
    value,
    ...(mailboxId ? { mailboxId } : {}),
    ...(folder ? { folder } : {}),
  };
  listeners.forEach((listener) => {
    try {
      listener(change, source);
    } catch {
      // Notifications must not break the caller.
    }
  });
}

export function publishNativeMailUnreadAbsolute(value: number, source?: unknown): void {
  const unread = Math.max(0, Math.trunc(Number(value)));
  if (!Number.isFinite(unread)) return;
  clearPendingNativeMailUnread();
  const change: NativeMailUnreadChange = { kind: 'absolute', value: unread };
  listeners.forEach((listener) => {
    try {
      listener(change, source);
    } catch {
      // Notifications must not break the caller.
    }
  });
}

export function applyNativeMailUnreadChange(current: number, change: NativeMailUnreadChange): number {
  const safeCurrent = Number.isFinite(Number(current)) ? Math.max(0, Math.trunc(Number(current))) : 0;
  if (change.kind === 'absolute') return change.value;
  return Math.max(0, safeCurrent + change.value);
}
