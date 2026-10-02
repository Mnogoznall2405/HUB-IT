import {
  createNativeChatOutbox,
  getNativeChatOutboxGeneration,
  readNativeChatOutbox,
  subscribeNativeChatOutbox,
  NATIVE_CHAT_MAX_DELIVERY_ATTEMPTS,
  type NativeChatDeliveryHelpers,
  type NativeChatOutboxEntry,
} from './nativeChatOutbox';
import type { ChatMessage } from '../api/types';

// Confirm-commit retries and read failures get bounded growing backoffs: a
// confirmed row whose local history commit keeps failing must not rewrite the
// storage blob every few seconds forever, and a broken store must not spin.
const CONFIRM_COMMIT_MAX_ATTEMPTS = 10;
const CONFIRM_COMMIT_RETRY_BASE_MS = 5000;
const CONFIRM_COMMIT_RETRY_CAP_MS = 5 * 60 * 1000;
const READ_FAILURE_MAX = 5;
const READ_FAILURE_BASE_MS = 5000;
const READ_FAILURE_CAP_MS = 5 * 60 * 1000;

// A WorkManager background drain and the foreground runner must never pump at
// once — otherwise they double every transport and storage read. The active
// drain owns the module token; runners without it idle until the drain ends.
let drainOwner: symbol | null = null;
const liveRunnerWakes = new Set<() => void>();
export function acquireNativeChatDeliveryDrain(): symbol | null {
  if (drainOwner) return null;
  drainOwner = Symbol('hubit-native-chat-drain');
  return drainOwner;
}
export function releaseNativeChatDeliveryDrain(token: symbol): void {
  if (drainOwner !== token) return;
  drainOwner = null;
  // Rows left behind by a drained budget (retry deadlines, partial work) are
  // picked up by the foreground runner immediately instead of next wake.
  liveRunnerWakes.forEach((wake) => { try { wake(); } catch { /* Observers only. */ } });
}
export function isNativeChatDeliveryDrainActive(): boolean { return drainOwner !== null; }

/** Session-owned delivery, independent of the currently open dialog. */
export function createNativeChatDeliveryRunner(options: {
  userId: number;
  canDeliver: () => boolean;
  transport: (entry: NativeChatOutboxEntry, signal: AbortSignal, helpers: NativeChatDeliveryHelpers) => Promise<ChatMessage>;
  persistConfirmed: (entry: NativeChatOutboxEntry, saved: ChatMessage) => Promise<boolean>;
  onError?: () => void;
  /** Owned drain token: the runner that belongs to the active drain. */
  drainToken?: symbol;
}) {
  const generation = getNativeChatOutboxGeneration();
  const controller = new AbortController();
  const drainToken = options.drainToken;
  let disposed = false;
  let reading = false;
  let rerun = false;
  let readFailures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timerAt = 0;
  let lastPassAt = 0;
  const PUMP_COALESCE_MS = 40;
  const jobs = new Map<string, Promise<unknown>>();
  const localRetryAt = new Map<string, number>();
  // Consecutive confirm-commit failures per row; reaching the cap parks the
  // row (it stays confirmed) until an external wake re-arms the commit pass.
  const confirmFailures = new Map<string, number>();
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
    if (!current() || reading || (drainOwner !== null && drainOwner !== drainToken)) return;
    reading = true;
    lastPassAt = Date.now();
    let nextDelay: number | null = null;
    try {
      const rows = await readNativeChatOutbox(options.userId);
      readFailures = 0;
      if (!current()) return;
      const liveKeys = new Set(rows.map((row) => JSON.stringify([row.message.conversation_id, row.message.client_message_id])));
      for (const key of localRetryAt.keys()) if (!liveKeys.has(key)) localRetryAt.delete(key);
      for (const key of confirmFailures.keys()) if (!liveKeys.has(key)) confirmFailures.delete(key);
      const blockedDialogs = new Set<string>();
      for (const row of rows) {
        // A background drain that acquired the token while this pass was in
        // flight stops new jobs here; already-running transports finish.
        if (!current() || (drainOwner !== null && drainOwner !== drainToken)) break;
        const state = row.delivery?.state;
        if (!state) continue; // No opt-in metadata on old/manual entries.
        const dialog = row.message.conversation_id;
        const unconfirmed = state !== 'confirmed' && state !== 'cancelled';
        // A row that cannot send right now (paused, retry waiting on
        // notBefore, attempts exhausted, cancelled) must not hold the FIFO
        // position against other live messages of the same dialog.
        const canAttemptNow = unconfirmed && state !== 'paused'
          && row.delivery!.attempts < NATIVE_CHAT_MAX_DELIVERY_ATTEMPTS
          && (state !== 'retry' || (row.delivery!.notBefore || 0) <= Date.now());
        if (canAttemptNow || row.busy) {
          if (blockedDialogs.has(dialog)) continue;
          blockedDialogs.add(dialog);
        }
        if (state === 'cancelled' || state === 'paused') continue;
        const rowKey = JSON.stringify([dialog, row.message.client_message_id]);
        if (jobs.has(rowKey)) continue;
        if (row.busy) { nextDelay = Math.min(nextDelay ?? 1000, 1000); continue; }
        if (state === 'confirmed' && (confirmFailures.get(rowKey) || 0) >= CONFIRM_COMMIT_MAX_ATTEMPTS) continue;
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
          // its local commit, on a growing bounded backoff, never the transport
          // again; at the cap the row stays confirmed until an external wake.
          if (state === 'confirmed') {
            const failures = (confirmFailures.get(rowKey) || 0) + 1;
            confirmFailures.set(rowKey, failures);
            if (failures < CONFIRM_COMMIT_MAX_ATTEMPTS) {
              const backoff = Math.min(CONFIRM_COMMIT_RETRY_BASE_MS * 2 ** (failures - 1), CONFIRM_COMMIT_RETRY_CAP_MS);
              localRetryAt.set(rowKey, Date.now() + backoff);
            }
          } else {
            localRetryAt.set(rowKey, Date.now() + 5000);
          }
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
      readFailures += 1;
      report();
      // A persistently broken store stops the pump after a bounded number of
      // growing retries; an external wake (queue write, reconnect) re-arms it.
      nextDelay = readFailures >= READ_FAILURE_MAX ? null
        : Math.min(READ_FAILURE_BASE_MS * 2 ** (readFailures - 1), READ_FAILURE_CAP_MS);
    } finally {
      reading = false;
      if (rerun) { rerun = false; wake(); }
      else if (nextDelay !== null) wake(nextDelay);
    }
  };
  const unsubscribe = subscribeNativeChatOutbox(() => wake());
  const wakeExternal = () => {
    readFailures = 0;
    confirmFailures.clear();
    wake();
  };
  liveRunnerWakes.add(wakeExternal);
  wake();
  return {
    wake: wakeExternal,
    dispose: () => {
      disposed = true;
      liveRunnerWakes.delete(wakeExternal);
      if (timer !== null) clearTimeout(timer);
      timer = null;
      controller.abort();
      unsubscribe();
    },
  };
}
