import {
  createNativeChatOutbox,
  getNativeChatOutboxGeneration,
  readNativeChatOutbox,
  subscribeNativeChatOutbox,
  NATIVE_CHAT_MAX_DELIVERY_ATTEMPTS,
  type NativeChatOutboxEntry,
} from './nativeChatOutbox';
import type { ChatMessage } from '../api/types';

/** Foreground session-owned delivery, independent of the currently open dialog. */
export function createNativeChatDeliveryRunner(options: {
  userId: number;
  canDeliver: () => boolean;
  transport: (entry: NativeChatOutboxEntry, signal: AbortSignal) => Promise<ChatMessage>;
  persistConfirmed: (entry: NativeChatOutboxEntry, saved: ChatMessage) => Promise<boolean>;
  onError?: () => void;
}) {
  const generation = getNativeChatOutboxGeneration();
  const controller = new AbortController();
  let disposed = false;
  let reading = false;
  let rerun = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastPassAt = 0;
  const jobs = new Map<string, Promise<unknown>>();
  const commitRetryAt = new Map<string, number>();
  const current = () => !disposed && generation === getNativeChatOutboxGeneration() && options.canDeliver();
  const report = () => { try { options.onError?.(); } catch { /* Diagnostics cannot break delivery. */ } };

  // Coalesce claim/ACK notifications. Up to two dialogs can progress independently,
  // so one large upload cannot block text in every other dialog. FIFO stays in core.
  const wake = (delay = 0) => {
    if (!current()) return;
    if (reading) { rerun = true; return; }
    if (timer !== null) return;
    const wait = Math.max(delay, 500 - (Date.now() - lastPassAt), 0);
    timer = setTimeout(() => { timer = null; void pump(); }, wait);
  };
  const pump = async () => {
    if (!current() || reading) return;
    reading = true;
    lastPassAt = Date.now();
    let nextDelay: number | null = null;
    try {
      const rows = await readNativeChatOutbox(options.userId);
      if (!current()) return;
      const liveKeys = new Set(rows.map((row) => JSON.stringify([row.message.conversation_id, row.message.client_message_id])));
      for (const key of commitRetryAt.keys()) if (!liveKeys.has(key)) commitRetryAt.delete(key);
      const blockedDialogs = new Set<string>();
      for (const row of rows) {
        if (!current()) break;
        const state = row.delivery?.state;
        if (!state) continue; // No opt-in metadata on old/manual entries.
        const dialog = row.message.conversation_id;
        if (state !== 'confirmed' && blockedDialogs.has(dialog)) continue;
        if (state !== 'confirmed' && state !== 'cancelled') blockedDialogs.add(dialog);
        if (state === 'cancelled' || state === 'paused') continue;
        const rowKey = JSON.stringify([dialog, row.message.client_message_id]);
        if (jobs.has(rowKey)) continue;
        if (row.busy) { nextDelay = Math.min(nextDelay ?? 1000, 1000); continue; }
        if (state !== 'confirmed' && row.delivery!.attempts >= NATIVE_CHAT_MAX_DELIVERY_ATTEMPTS) continue;
        const deadline = state === 'confirmed' ? commitRetryAt.get(rowKey) || 0 : row.delivery!.notBefore;
        const delay = deadline - Date.now();
        if (delay > 0) { nextDelay = Math.min(nextDelay ?? delay, delay); continue; }
        if (jobs.size >= 2) continue; // Job completion wakes the pump.
        const job = createNativeChatOutbox(options.userId, dialog).deliverQueued(
          row.message.client_message_id!, options.transport, current,
          options.persistConfirmed, controller.signal,
        ).then(() => {
          // A confirmed entry can remain on a history write failure. Retry only
          // its local commit, at a bounded frequency, never the transport again.
          commitRetryAt.set(rowKey, Date.now() + 5000);
        }, (error: unknown) => {
          if ((error as { code?: string })?.code !== 'HUBIT_NO_DELIVERY') report();
        }).finally(() => {
          jobs.delete(rowKey);
          wake();
        });
        jobs.set(rowKey, job);
      }
    } catch {
      report();
      nextDelay = 5000;
    } finally {
      reading = false;
      if (rerun) { rerun = false; wake(); }
      else if (nextDelay !== null) wake(nextDelay);
    }
  };
  const unsubscribe = subscribeNativeChatOutbox(() => wake(500));
  wake();
  return {
    wake: () => wake(),
    dispose: () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      controller.abort();
      unsubscribe();
    },
  };
}
