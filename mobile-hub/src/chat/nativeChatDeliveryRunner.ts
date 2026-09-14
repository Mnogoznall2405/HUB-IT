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
  let timerAt = 0;
  let lastPassAt = 0;
  const PUMP_COALESCE_MS = 40;
  const jobs = new Map<string, Promise<unknown>>();
  const localRetryAt = new Map<string, number>();
  const current = () => !disposed && generation === getNativeChatOutboxGeneration() && options.canDeliver();
  const report = () => { try { options.onError?.(); } catch { /* Diagnostics cannot break delivery. */ } };

  // Coalesce claim/ACK notifications. Up to two dialogs can progress independently,
  // so one large upload cannot block text in every other dialog. FIFO stays in core.
  // A short coalescing window collapses the write-burst notifies (put → stamp →
  // claim → confirm) without making a fresh send wait half a second for pickup.
  const wake = (delay = 0) => {
    if (!current()) return;
    if (reading) { rerun = true; return; }
    const wait = Math.max(delay, PUMP_COALESCE_MS - (Date.now() - lastPassAt), 0);
    const deadline = Date.now() + wait;
    if (timer !== null) {
      if (timerAt <= deadline) return;
      clearTimeout(timer);
    }
    timerAt = deadline;
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
      for (const key of localRetryAt.keys()) if (!liveKeys.has(key)) localRetryAt.delete(key);
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
        // Transport failures already have a durable retry deadline. Failures
        // before claiming a row have none, so bound their local storage retry.
        const deadline = Math.max(state === 'confirmed' ? 0 : row.delivery!.notBefore,
          state === 'retry' ? 0 : localRetryAt.get(rowKey) || 0);
        const delay = deadline - Date.now();
        if (delay > 0) { nextDelay = Math.min(nextDelay ?? delay, delay); continue; }
        if (jobs.size >= 2) continue; // Job completion wakes the pump.
        const job = createNativeChatOutbox(options.userId, dialog).deliverQueued(
          row.message.client_message_id!, options.transport, current,
          options.persistConfirmed, controller.signal,
        ).then(() => {
          // A confirmed entry can remain on a history write failure. Retry only
          // its local commit, at a bounded frequency, never the transport again.
          localRetryAt.set(rowKey, Date.now() + 5000);
        }, async (error: unknown) => {
          if ((error as { code?: string })?.code !== 'HUBIT_NO_DELIVERY') {
            // Do not delay an explicit retry of a paused transport failure.
            // Only rows whose local transition failed need this extra backoff.
            const latest = await readNativeChatOutbox(options.userId).catch(() => null);
            const latestState = latest?.find((entry) => entry.message.conversation_id === dialog
              && entry.message.client_message_id === row.message.client_message_id)?.delivery?.state;
            if (latest === null || latestState === 'queued' || latestState === 'sending' || latestState === 'confirmed') {
              localRetryAt.set(rowKey, Date.now() + 5000);
            }
            report();
          }
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
  const unsubscribe = subscribeNativeChatOutbox(() => wake());
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
